// 字幕を作る（聞き取り → 割る → 音に合わせる）。
//
// ## 手順
//
//   1. 音だけ取り出す
//   2. 聞き取る（whisper.cpp）
//   3. 話の切れ目で割る（shared/splitTelop）
//   4. 無音とカット点に合わせて頭を吸い付ける（shared/alignCues）
//   5. 短すぎる札をくっつけ、読む間もない札を少し延ばす
//
// ## なぜ画面から出すか
//
// **何分もかかる処理**なので、途中で何をしているかを画面に出し続ける必要がある。
// その進み具合の受け渡しが App.tsx の中に散ると、どこまで進んだのかを
// 読み取るだけで骨が折れる。
import { alignCues, speechRanges } from '../../../shared/alignCues'
import { DB_LADDER, enoughSilences } from '../../../shared/silenceLadder'
import { ensureMinShow, mergeShreds, splitAtPauses } from '../../../shared/splitTelop'
import { defaultTelopStyle } from '../lib/telopStyle'
import { parseSrt, type Cue } from '../lib/srt'
import { DEFAULT_LABEL } from '../lib/labels'
import { useDoc } from './contentContext'
import { useSel } from './selectionContext'
import { useMediaCtx } from './mediaContext'
import { useToastCtx } from './toastContext'
import { useIconsCtx } from './iconsContext'

export interface UseSubtitlesDeps {
  /** 聞き取りの前に止める（流したままだと音が混ざる） */
  stopPlayback: () => void
  seekTo: (t: number) => void
  /** 切片の並び（カット点を「音より強い手がかり」として使う） */
  segLayout: { tStart: number }[]
  /* eslint-disable @typescript-eslint/no-explicit-any */
  resetHistory: (snap: any) => void
  askConfirm: (o: any) => Promise<boolean>
  /* eslint-enable @typescript-eslint/no-explicit-any */
  idCounter: React.MutableRefObject<number>
  /** 1枚に載せる文字数の上限 */
  subMaxChars: number
  /** すでにあるテロップを置き換えるか */
  subReplace: boolean
  /** 次に足すテロップの既定の見た目 */
  newTelopStyle: import('../lib/telopStyle').TelopStyle
  setSrtPath: (v: string | null) => void
  setSubtitleOpen: (v: boolean) => void
  setSubtitleState: (v: any) => void
}

export function useSubtitles(deps: UseSubtitlesDeps) {
  const { stopPlayback, seekTo, segLayout, resetHistory, askConfirm, idCounter, subMaxChars, subReplace, newTelopStyle, setSrtPath, setSubtitleOpen, setSubtitleState } = deps
  const { cues, setCues, cuesRef, segsRef, seClipsRef } = useDoc()
  const { setSelectedIds } = useSel()
  const { videoPath, sources, videoDuration } = useMediaCtx()
  const { showToast } = useToastCtx()
  const { iconAuto, iconAnchorPos } = useIconsCtx()

  async function runSubtitles(): Promise<void> {
    const src = sources[0]?.path ?? videoPath
    if (!src) {
      showToast('先に動画を読み込んでください。')
      return
    }
    setSubtitleState({ phase: 'extract' })
    const r = await window.giftcut.runSubtitles(src)
    if (r?.canceled) {
      setSubtitleState({ phase: 'idle' })
      return
    }
    if (!r?.ok || !r.segs?.length) {
      setSubtitleState({ phase: 'error', message: r?.error ?? '字幕を作れませんでした' })
      return
    }
    setSubtitleState({ phase: 'align' })
    const total = r.duration || videoDuration || 0
    // **無音のしきい値は素材で変わる。**
    // 雑音の多い動画では -35dB だと「どこも無音でない」ことになり、
    // 合わせる先が1つも取れない（実測: -35dB で1区間、-30dB で37区間）。
    // 取れるまで少しずつ緩める。緩めすぎると小さい音まで無音扱いになるので、
    // **十分な数が取れた所で止める**。
    // 足りているかの判定は src/shared/silenceLadder.ts（測る道具と揃えるため）
    let silences: { start: number; dur: number }[] = []
    for (const db of DB_LADDER) {
      const r = await window.giftcut.detectSilences?.(src, db, 0.2).catch(() => null)
      const got = r?.ok ? (r.silences ?? []) : []
      if (got.length > silences.length) silences = got
      if (enoughSilences(silences.length, total)) break
    }
    // **まず「間」で割る。** 1枚＝1つの話の区切りにする。
    // 文字数だけで割ると、読み終わる前に次へ進んで「音より速い」と感じる
    //（youtube-pipeline の品質記録にある R-sync 違反と同じ現象）。
    // こちらは本物の音があるので、実際に黙った所で割れる。
    const ranges = speechRanges(silences, total)
    const split = r.segs.flatMap((s) => splitAtPauses(s, ranges, subMaxChars))
    // 合わせる → 短すぎる札をくっつける → 読む間もない札を少し延ばす、の順。
    // くっつける方が先。先に延ばすと、隣にぶつかってくっつけられなくなる。
    const aligned = ensureMinShow(
      mergeShreds(
        alignCues(split, silences, total, {
          // 切ったのは本人。音より強い手がかりとして使う
          cuts: segLayout.map((L) => L.tStart)
        }),
        subMaxChars
      )
    )
    const base = subReplace ? [] : cues
    let id = Math.max(0, ...cues.map((c) => c.id)) + 1
    const made: Cue[] = aligned.map((a) => ({
      id: id++,
      start: a.start,
      end: a.end,
      text: a.text,
      track: 'V2',
      // 見た目は「次に足すテロップ」の既定に合わせる。
      // 字幕だけ別の見た目になると、あとで揃え直す手間が増える
      label: DEFAULT_LABEL,
      pos: { x: 0.5, y: 0.85 },
      style: { ...newTelopStyle }
    }))
    setCues([...base, ...made].sort((a, b) => a.start - b.start))
    setSubtitleState({ phase: 'idle' })
    setSubtitleOpen(false)
    showToast(`字幕を ${made.length}枚 作りました。`)
  }

  // ================= 読み込み =================
  async function handleImportSrt(): Promise<void> {
    const res = await window.giftcut.importSrt()
    if (!res) return
    stopPlayback() // 再生中に読み込むとヘッドと動画がズレるため必ず停止
    let parsed = parseSrt(res.content)
    // アイコン軸が有効なら読み込んだテロップも軸に整列（アイコンが飛ばないように）
    if (iconAuto && iconAnchorPos) {
      parsed = parsed.map((c) => ({
        ...c,
        pos: { ...iconAnchorPos },
        style: (() => {
          const st = { ...c.style, anchor: { h: 'l' as const, v: 'm' as const }, align: 'left' as const }
          delete st.box
          return st
        })()
      }))
    }
    // 既存テロップを全置換するので、消える前に確認する（動画差し替えには確認が
    // あるのに、こちらは無確認でスタイル済みテロップが全部消え、Undoも効かなかった）
    if (cuesRef.current.length) {
      const okToReplace = await askConfirm({
        title: `現在のテロップ ${cuesRef.current.length} 件をすべて置き換えます`,
        body: 'スタイルや位置の調整も失われます。この操作は元に戻せません。',
        okLabel: '置き換える',
        cancelLabel: '中止',
        danger: true
      })
      if (!okToReplace) return
    }
    idCounter.current = parsed.length + 1
    resetHistory({ cues: parsed, segments: segsRef.current, seClips: seClipsRef.current }) // 履歴リセット（動画切片・SEは維持）
    setCues(parsed)
    setSrtPath(res.path)
    setSelectedIds(parsed[0] ? [parsed[0].id] : [])
    seekTo(parsed[0]?.start ?? 0)
  }

  return { runSubtitles, handleImportSrt }
}
