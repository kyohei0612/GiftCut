// 書き出し（動画にする・字幕ファイルを出す）。
//
// ## なぜ画面から出すか
//
// **やり直しが利かない操作**なので、設定と実行の道すじが読めることが要る。
// App.tsx の中にあると、書き出しの流れを追うのに画面の話を読み飛ばしながら
// 探すことになる。
//
// ## 押してすぐ始めない
//
// 何分もかかり、途中でやめると中途半端なファイルが残る。必ず設定の窓を挟む。
import { buildExportPayload } from '../../../shared/exportPayload'
import { joinOut, outputBaseName, resPFromHeight } from '../../../shared/exportDefaults'
import { clamp, layoutSegs, segSpeed, totalSegLen, xfadeDurAt } from '../../../shared/timeline'
import { envToFfmpegExpr } from '../../../shared/ducking'
import { buildSrt } from '../lib/srt'
import { hasAnim, hasMotion, telopStateAt } from '../lib/telopStyle'
import { renderCueToPng } from '../lib/rasterize'
import type { VSeg } from '../lib/projectTypes'
import { useDoc } from './contentContext'
import { useTracksCtx } from './tracksContext'
import { EXPORT_DIR_KEY } from './useExportSettings'
import { useExportCtx } from './exportContext'
import { useMediaCtx } from './mediaContext'
import { useIconsCtx } from './iconsContext'
import { useToastCtx } from './toastContext'

export interface UseExportDeps {
  /** 書き出す前に必ず止める（流したまま焼くと途中で音がずれる） */
  stopPlayback: () => void
  /** その切片が使っている元動画 */
  srcOfSeg: (seg: VSeg | undefined) => import('../lib/projectTypes').Source | undefined
  cueTrack: (c: import('../lib/srt').Cue) => string
  iconForCue: (c: import('../lib/srt').Cue) => string | undefined
  /** 実際に使う fps（'素材と同じ' を数値へ読み替える） */
  resolveExportFps: () => number
  /** 動きが変わる時刻（そこだけ画像を焼き直す） */
  animBreakpoints: (
    anim: import('../lib/telopStyle').TelopAnim | undefined,
    motion: import('../lib/telopStyle').Motion | undefined,
    dur: number,
    fps: number
  ) => number[]
  /** 声に合わせて BGM を下げる曲線 */
  duckEnv: import('../../../shared/ducking').GainPoint[]
  /** 効果音の終わり（タイムラインの長さに含める） */
  seEnd: number
  /** 本編の映像を隠しているか */
  v1Hidden: boolean
}

export function useExport(deps: UseExportDeps) {
  const { stopPlayback, srcOfSeg, cueTrack, iconForCue, resolveExportFps, animBreakpoints, duckEnv, seEnd, v1Hidden } = deps
  const { cues, segments, seClips, imgClips, vClips } = useDoc()  const { tracks, trackStates } = useTracksCtx()
  const {
    ratio, exportOpts, setExportOpts, masterVolume, loudnormLUFS, setShowExportDialog,
    setExportStatus, setExportPct, exportStatus,
    exportDir, setExportDir, exportName, setExportName, exportExt
  } = useExportCtx()
  const { videoPath,  sourcesRef } = useMediaCtx()
  const { iconSide, iconOffset, iconScale, iconAuto } = useIconsCtx()
  const { showToast } = useToastCtx()

  // 書き出し用のゲイン。ソロはモニタリング専用（Premiere でも各DAWでも同じ約束）
  // なので書き出しには効かせない。BGMだけ確認しようとソロにしたまま書き出して
  // 本編音声もSEも全部無音の動画ができる事故を防ぐ。反映するのはミュートと音量のみ。
  function audioTrackGainForExport(id: string): number {
    const st = trackStates[id]
    // 上と同じ理由。**書き出しでも無音になっていた**ので、こちらの方が実害が大きい
    if (st?.muted) return 0
    return clamp((st?.volume ?? 1) * masterVolume, 0, 1)
  }

  // SRT 書き出し（編集後のテロップを SRT に戻す）
  async function exportSrtFn(): Promise<void> {
    if (!cues.length) {
      showToast('テロップがありません。')
      return
    }
    const res = await window.giftcut.exportSrt(buildSrt(cues))
    if (res?.ok && res.path) showToast('SRT を書き出しました:\n' + res.path, 'success')
    else if (res?.error && res.error !== 'キャンセル') showToast('書き出し失敗: ' + res.error, 'error')
  }

  /**
   * 書き出しの設定画面を開く。
   *
   * **中身が無いときは開かない。** 以前は空でも開き、設定を選んで
   * 「書き出す」を押して初めて「動画を読み込んでください」と怒られた。
   * 押す前に分かる方が親切。
   */
  function openExportDialog(): void {
    if (!videoPath || !segments.length) {
      showToast('書き出す中身がありません。先に動画を読み込んでタイムラインに置いてください。')
      return
    }
    if (exportStatus) return // 書き出し中は受け付けない
    // **開くたびに素材へ合わせ直す。** 素材を差し替えたのに前の素材の大きさで
    // 出る、が起きない（決め方と理由は shared/exportDefaults）。
    const primary = sourcesRef.current.find((s) => s.path === videoPath) ?? sourcesRef.current[0]
    setExportOpts((o) => ({ ...o, resP: resPFromHeight(primary?.h) }))
    // 覚えている置き場も読み直す（別の窓で選び直していても、開いた方が新しい）
    const remembered = localStorage.getItem(EXPORT_DIR_KEY)
    if (remembered) setExportDir(remembered)
    // 名前は一度決めたら触らない（打ち替えた名前を、開くたびに戻されると腹が立つ）
    if (!exportName) setExportName(outputBaseName(null, videoPath))
    setShowExportDialog(true)
  }

  async function exportProject(): Promise<void> {
    if (!videoPath) {
      showToast('先に動画を読み込んでください。\n右の「プロジェクト」タブ →「＋ファイル追加」から追加できます。')
      return
    }
    // テロップが無くても書き出せる（カット＋BGM＋画像だけの動画も作れる）
    if (!segments.length) {
      showToast('動画の準備が完了していません。少し待ってから再度お試しください。')
      return
    }
    stopPlayback()
    // 書き出し設定: 1080基準の解像度を resP 倍率でスケール（偶数化）。fps/画質(crf)も反映。
    const base =
      ratio === '16:9'
        ? { width: 1920, height: 1080 }
        : ratio === '9:16'
          ? { width: 1080, height: 1920 }
          : { width: 1080, height: 1080 }
    const k = exportOpts.resP / 1080
    const even = (n: number): number => Math.round((n * k) / 2) * 2
    const size = { width: even(base.width), height: even(base.height) }
    const crf = exportOpts.quality === 'high' ? 18 : exportOpts.quality === 'low' ? 28 : 23
    try {
      // 非表示（👁OFF）トラックのテロップは書き出しに含めない（プレビューと一致させる）
      const exportCues = cues.filter((c) => !trackStates[cueTrack(c)]?.hidden)
      // 動きの刻みは書き出しの fps に合わせる（出力の1フレームに1枚ずつ当てる）。
      // ただし**枚数の上限だけは要る**。
      //
      // テロップ1枚が ffmpeg の入力1つになり、その入力はコマンドラインに並ぶ。
      // Windows のコマンドライン長は 32767字。実測すると 2500枚で 31479字なので、
      // **その少し先に、絶対に越えられない崖がある**（越えると起動すらできない）。
      // 刻みを fps に合わせた結果、枚数は fps に比例して増えるようになった
      // （実測: 43本のテロップで 15fps=585枚 → 60fps=2253枚）ので、
      // 素材が長ければ誰でも崖に届く。
      //
      // ※ 2026-08-01 の「書き出しが失敗する」は**これが原因ではなかった**
      //   （2253枚のままでも通ることを再現で確かめた。原因は素通しの pad）。
      //   ここは崖への安全網であって、あの不具合の直しではない。混同しないこと。
      const expFps = resolveExportFps()
      const MAX_TELOP_PNGS = 2000
      const animSec = exportCues
        .filter((c) => hasAnim(c.style.anim) || hasMotion(c.motion))
        .reduce((a, c) => a + (c.end - c.start), 0)
      const stepFps =
        animSec > 0 ? Math.max(1, Math.min(expFps, Math.floor(MAX_TELOP_PNGS / animSec))) : expFps
      // 数コマぶんの差は見て分からないので黙って落とす。目に見えて変わるときだけ言う
      if (stepFps < expFps * 0.8) {
        showToast(
          `動きの付いたテロップが多いため、書き出しの動きを ${stepFps}fps 相当に落としました` +
            `（${expFps}fps のままだと ffmpeg に渡せる枚数を超えます）`
        )
      }
      setExportStatus(`テロップを画像化中… (0/${exportCues.length})`)
      // **書き出しの時間を、2つに分けて測る。**
      //
      // 「書き出しが遅い」と言われたとき、**GPU が効いていないのか、その手前の
      // 画像作りが重いのか**が分からないと、直す先を間違える（GPU は焼く所しか
      // 効かない。画像作りは画面側の Chromium で、GPU も ffmpeg も関係ない）。
      // 出来上がりの知らせに両方を載せるので、聞くだけで切り分けられる。
      const tPng0 = performance.now()
      const frames: { png: string; start: number; end: number }[] = []
      for (let i = 0; i < exportCues.length; i++) {
        const c = exportCues[i]
        const avatar = iconForCue(c)
        const asc = avatar ? iconScale : 1
        const dur = c.end - c.start
        if (!hasAnim(c.style.anim) && !hasMotion(c.motion)) {
          const png = await renderCueToPng(
            c,
            size.width,
            size.height,
            avatar,
            asc,
            undefined,
            iconSide,
            iconOffset.x,
            iconOffset.y,
            iconAuto
          )
          frames.push({ png, start: c.start, end: c.end })
        } else {
          // アニメあり: 変化する区間を時間分割し、各瞬間のPNGを短い区間で並べる。
          //
          // **刻みは書き出しの fps に合わせる。** 以前は 15 固定で、30fps や 60fps で
          // 書き出しても動きは秒15コマのままだった＝カクついて見える。
          // 出力の1フレームに1枚ずつ当たるようにすれば、プレビューと同じ滑らかさで焼ける。
          // そのぶん画像は増える（60fps なら 15fps の4倍）ので、書き出しは長くなる。
          //
          // 渡すのは expFps ではなく **stepFps**（上で枚数の上限に収めた刻み）。
          // ここを間違えると上限が一度も効かない＝安全網が死んだまま気づけない。
          const bps = animBreakpoints(c.style.anim, c.motion, dur, stepFps)
          for (let k = 0; k < bps.length; k++) {
            const t0 = bps[k]
            const t1 = k + 1 < bps.length ? bps[k + 1] : dur
            const st = telopStateAt(c.style.anim, c.motion, t0, dur)
            const png = await renderCueToPng(
              c,
              size.width,
              size.height,
              avatar,
              asc,
              st,
              iconSide,
              iconOffset.x,
              iconOffset.y,
              iconAuto
            )
            frames.push({ png, start: c.start + t0, end: c.start + t1 })
          }
        }
        setExportStatus(`テロップを画像化中… (${i + 1}/${exportCues.length})`)
      }
      const pngSec = (performance.now() - tPng0) / 1000
      setExportPct(0)
      setExportStatus('FFmpegで書き出し中…（動画の長さによっては時間がかかります）')
      // 実際に焼き込む素材（非表示トラックは除外）だけで「動画尻より後ろ」を判定する。
      // 全件で判定すると、非表示にした素材のために末尾へ静止画＋無音が付いてしまう。
      const expImgs = imgClips.filter((c) => !trackStates[c.track]?.hidden)
      const cueEnd = exportCues.length ? Math.max(...exportCues.map((c) => c.end)) : 0
      const expImgEnd = expImgs.length
        ? Math.max(...expImgs.map((c) => c.tStart + c.duration))
        : 0
      const expVcEnd = vClips.length
        ? Math.max(...vClips.map((c) => c.tStart + Math.max(0.05, c.srcEnd - c.srcStart)))
        : 0
      // マルチソース: 入力に使う元動画一覧（切片の srcId はこの並びの番号に直る）
      const srcList = sourcesRef.current.length
        ? sourcesRef.current
        : videoPath
          ? [{ id: 0, path: videoPath }]
          : []

      // 渡す中身の組み立ては shared/exportPayload（画面を起動せずに確かめられる）。
      // 「見えていない物は焼かない」「重なりは下から」「等倍・無調整は渡さない」
      // といった決まりはそちらに書いてある。
      const payload = buildExportPayload({
        videoPath,
        sources: srcList,
        size,
        frames,
        segments,
        seClips,
        vClips,
        imgClips,
        tracks,
        hidden: (id) => !!trackStates[id]?.hidden,
        v1Hidden,
        gainOf: audioTrackGainForExport,
        speedOf: (seg) => segSpeed(seg as VSeg),
        srcDurationOf: (seg) => srcOfSeg(seg as VSeg)?.duration || undefined,
        xfadeDurAt: (segs, i) => xfadeDurAt(layoutSegs(segs as VSeg[]), i),
        totalLen: (segs) => totalSegLen(segs as VSeg[]),
        duckExpr: duckEnv.length ? envToFfmpegExpr(duckEnv) : undefined,
        loudnormLUFS,
        fps: resolveExportFps(),
        crf,
        // 本編より後ろに置かれている物（ここまで伸ばして黒＋無音で埋める）
        tailEnds: [cueEnd, seEnd, expImgEnd, expVcEnd],
        // 出す先は窓で決まっている。**ここで渡せば、あとでもう一度聞かれない。**
        // 決まっていないときだけ渡さない（main 側が今までどおり選択の窓を出す）
        outPath:
          exportDir && exportName.trim()
            ? joinOut(exportDir, `${exportName.trim()}.${exportExt}`)
            : undefined
      })
      const tFf0 = performance.now()
      const res = await window.giftcut.exportVideo(
        payload as unknown as Parameters<typeof window.giftcut.exportVideo>[0]
      )
      const ffSec = (performance.now() - tFf0) / 1000
      setExportStatus(null)
      setExportPct(null)
      // 内訳を1行で残す（どちらが重いかは、これを見れば一目で決まる）
      const breakdown =
        `テロップ ${frames.length}枚の画像化 ${pngSec.toFixed(1)}秒 ／ ` +
        `ffmpeg ${ffSec.toFixed(1)}秒`
      console.log('[書き出し] ' + breakdown)
      if (res?.ok) showToast('書き出しが完了しました\n' + res.outPath + '\n' + breakdown, 'success')
      else if (
        res?.canceled ||
        res?.error === 'キャンセルされました' ||
        res?.error === 'キャンセル'
      ) {
        /* ユーザーがキャンセル: 通知不要（赤いエラーを出さない） */
      } else showToast('書き出しできませんでした\n' + (res?.error ?? '不明なエラー'), 'error')
    } catch (e) {
      setExportStatus(null)
      setExportPct(null)
      showToast('書き出しエラー: ' + String(e), 'error')
    }
  }

  return { audioTrackGainForExport, exportSrtFn, openExportDialog, exportProject }
}
