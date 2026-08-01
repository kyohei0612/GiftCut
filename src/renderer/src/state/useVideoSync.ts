// 画面の <video> と <audio> を、タイムラインの「いま」に追従させる。
//
// ここにあるのは全部「見えている物を合わせに行く」処理で、**どれも副作用**。
// 値を計算する所（state/usePreviewFrame）や、時間を進める所（state/usePlaybackEngine）
// とは役割が違うので分けてある。
//
// ## 合わせる相手は5つ
//
//   本編の映像（A面/B面）… 元動画の切り替え・先回りシーク・重ねの追従
//   本編の音            … ミュート・音量・フェード
//   効果音             … 区間に入ったら鳴らす、出たら止める
//   映像レイヤー        … 位置合わせ・再生/停止・音量
//   使われなくなった元動画 … 片付ける
//
// ## 重ねている最中は触らない
//
// カットの継ぎ目で2本を重ねている間に音量を書き換えると、重ねが上書きされて
// 継ぎ目が元に戻る。重ねが終わるまで待つ。
//
// ## 使われなくなった元動画は捨てる
//
// 残すと、見えていない <video> がずっと焼き直した映像を読み続ける。
// 書き出しの入力にも無駄に載る。ただし**主ソースは残す**（戻せなくなる）。

import { useEffect } from 'react'
import { clamp, tToSource } from '../../../shared/timeline'
import { perf } from '../lib/perfMonitor'
import type { Source } from '../lib/projectTypes'
import { useDoc } from './contentContext'
import { useTracksCtx } from './tracksContext'
import { useMediaCtx } from './mediaContext'
import { usePlaybackCtx } from './playbackContext'
import { useExportCtx } from './exportContext'

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface UseVideoSyncDeps {
  /** 本編の <video>（A面/B面）と、その一覧 */
  videoRef: any
  videoBRef: any
  videoElsRef: any
  /** どの面を使うか（元動画ごとに A/B が決まる） */
  halfOf: any
  elKey: any
  elOf: any
  /** 効果音の <audio> と、試聴用 */
  seAudioRefs: any
  /** 映像レイヤーの <video> */
  vcElsRef: any
  /** 重ねが効いている間（この間は音量を触らない） */
  xfadeUntilRef: any
  /** いま画面に出す重ねの状態（state/usePreviewFrame） */
  xfPreview: any
  segLayout: any
  srcOfSeg: any
  previewUrl: any
  /** 焼き直した映像の対応表と、いまの画質 */
  proxyMap: any
  previewRes: any
  lastPreviewResRef: any
  /** 元動画をいつ足したか（足した直後だけ先読みを急ぐ） */
  srcAddedAtRef: any
  /** 音量の計算 */
  audioTrackGain: any
  duckGainAt: any
  seFadeGain: any
  vcFadeGain: any
  trackNum: (id: string) => number
  /** 履歴。捨てた元動画がまだ要るかを見る */
  undoStackRef: any
  redoStackRef: any
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function useVideoSync(deps: UseVideoSyncDeps): void {
  const {
    videoRef, videoBRef, videoElsRef, halfOf, elKey, elOf, seAudioRefs, vcElsRef,
    xfadeUntilRef, xfPreview, segLayout, srcOfSeg, previewUrl, proxyMap, previewRes,
    lastPreviewResRef, srcAddedAtRef, audioTrackGain, duckGainAt, seFadeGain, vcFadeGain,
    trackNum, undoStackRef, redoStackRef
  } = deps
  const { segments, seClips, vClips, vClipsRef } = useDoc()
  const { trackStates } = useTracksCtx()
  const {
    videoSrc, setVideoSrc, sources, setSources, curSourceIdRef, setActiveSrcId,
    setVideoDuration
  } = useMediaCtx()
  const { currentTime, playing, playRateRef, rafRef, setFps } = usePlaybackCtx()
  const { masterVolume } = useExportCtx()

  // 音声ミュート/音量を動画要素に反映（A1トラック＝メイン音声。切片ミュート・音量・フェードも合成）
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    // カットで音を重ねている最中は触らない（重ねを上書きすると継ぎ目が戻る）
    if (performance.now() < xfadeUntilRef.current) return
    const src = tToSource(segLayout, currentTime)
    const L = src ? segLayout[src.index] : undefined
    const seg = L?.seg
    // **消音は muted ではなく音量0で行う。**
    // 音のある動画では、メディア時計が音声側に従っている。muted を切り替えると
    // 時計の張り替えが起きて、その間**絵まで止まる**（1080p の実測で約250ms）。
    // カットのたびに引っかかっていたのはこれ。音量なら再生は途切れない。
    const segMuted = seg ? !!seg.muted : false
    // 切片の音量倍率×フェード（頭/尻の指定秒で 0→1 / 1→0）
    let segGain = segMuted ? 0 : (seg?.vol ?? 1)
    if (L && seg) {
      const local = currentTime - L.tStart
      if (seg.afadeIn && seg.afadeIn > 0) segGain *= clamp(local / seg.afadeIn, 0, 1)
      if (seg.afadeOut && seg.afadeOut > 0)
        segGain *= clamp((L.len - local) / seg.afadeOut, 0, 1)
    }
    const g = clamp(audioTrackGain('A1') * segGain, 0, 4)
    if (Math.abs(v.volume - Math.min(g, 1)) > 1e-3) v.volume = Math.min(g, 1) // HTMLは0..1
  }, [trackStates, masterVolume, videoSrc, currentTime, segments, segLayout])

  // どの切片からも参照されなくなった元動画を片付ける（主ソースは残す）。
  // 残すと非表示の <video> がプロキシを読み続け、書き出しの入力にも無駄に載る。
  useEffect(() => {
    if (sources.length <= 1) return
    const used = new Set<number>()
    for (const g of segments) used.add(g.srcId ?? sources[0].id)
    // Undo/Redo で戻ってくる切片が参照しているソースも「使用中」とみなす。
    // これをしないと「動画を追加→Undo（GCがソースを削除）→Redo」で切片の srcId が
    // 迷子になり、srcOfSeg のフォールバックで別の動画に無言ですり替わる。
    for (const snap of [...undoStackRef.current, ...redoStackRef.current])
      for (const g of snap.segments) used.add(g.srcId ?? sources[0].id)
    const now = performance.now()
    // 登録直後（3秒以内）は消さない。ソース登録→切片配置は2段階なので、
    // 間で走ると置く前のソースを消してしまう。
    const keep = (s: Source, i: number): boolean =>
      i === 0 || used.has(s.id) || now - (srcAddedAtRef.current.get(s.id) ?? 0) < 3000
    if (sources.every(keep)) return
    setSources((prev) => prev.filter(keep))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments, sources])

  // SE の再生: 順再生(等速)中、再生ヘッドが SE 区間に入ったら該当 audio を鳴らす
  useEffect(() => {
    seClips.forEach((clip) => {
      const a = seAudioRefs.current.get(clip.id)
      if (!a) return
      const active =
        playing &&
        playRateRef.current === 1 &&
        currentTime >= clip.tStart &&
        currentTime < clip.tStart + clip.duration
      if (active) {
        const local = currentTime - clip.tStart
        // 音源内の再生位置＝クリップ内ローカル秒＋トリム済みオフセット
        const target = local + (clip.srcOffset ?? 0)
        // シーク中は頼み直さない（着く前に書くと取り消されて、永久に追いつけない）
        // **音の位置を直すと、そこで必ず途切れる**（プチッと鳴る）ので記録に残す
        if (!a.seeking && Math.abs(a.currentTime - target) > 0.3) {
          perf.mark(`音の位置を直した ${clip.name}`)
          a.currentTime = target
        }
        // 載っているトラック音量×フェード（頭/尻の指定秒で 0→1 / 1→0）※クリップ内ローカル秒で判定
        const fade = seFadeGain(clip, local)
        // 声が入っている間は下げる（ダッキング）。書き出しと同じ折れ線を使う
        const duck = duckGainAt(clip, currentTime)
        // **同じ値を毎コマ書き直さない。**
        // ここは毎レンダー（秒60〜240回）通る。音量を書くたびに音の作り直しが
        // 走るので、変わっていないのに書くと、それだけで音が荒れる。
        const want = clamp(clip.volume * fade * duck * audioTrackGain(clip.track), 0, 1)
        if (Math.abs(a.volume - want) > 0.002) a.volume = want
        if (a.paused) {
          perf.mark(`音を鳴らし始めた ${clip.name}`)
          void a.play().catch(() => {})
        }
      } else if (!a.paused) {
        a.pause()
      }
    })
  }, [currentTime, playing, seClips, trackStates, masterVolume])

  // マルチソース: 再生ヘッドのセグメントの元動画へ<video>のsrcを切り替える。
  // 単一ソース（sources.length<=1）なら何もしない＝従来動作を完全維持。
  useEffect(() => {
    if (!sources.length) return
    const src = tToSource(segLayout, currentTime)
    const seg = src ? segLayout[src.index]?.seg : undefined
    const s = srcOfSeg(seg)
    if (!s) return
    const desired = previewUrl(s.path, s.origUrl)
    // 表示対象を切替（要素はソースごとに常設済み＝src差し替えが起きないのでちらつかない）
    if (s.id !== curSourceIdRef.current) {
      curSourceIdRef.current = s.id
      setActiveSrcId(s.id)
      const el = elOf(s.id)
      // 切り替える前の音量を控えておく（下で引き継ぐ。理由は入れ替えの所と同じ）
      const prevVol = videoRef.current?.volume ?? 1
      if (el) {
        videoRef.current = el
        // 切替先を今の位置へ即シーク（再生中は再生クロックが追従させるが、初手のズレを詰める）
        if (src) {
          const want = seg ? seg.srcStart + (currentTime - segLayout[src.index].tStart) * src.speed : 0
          if (Math.abs(el.currentTime - want) > 0.15) el.currentTime = want
        }
      }
      // 直前まで表示していた要素は止める（裏で音が鳴り続けるのを防ぐ）
      // 直前まで表示していた物は止める。**映していない面も必ず黙らせる**
      //（2枚組にしたので、放っておくと裏の面から音が出る）
      videoElsRef.current.forEach((v: HTMLVideoElement, k: string) => {
        if (k === elKey(s.id, halfOf(s.id))) return
        if (!v.paused) v.pause()
        v.volume = 0 // 消すのは音量で（muted を触ると時計が張り替わる／上の effect 参照）
      })
      // **音量を引き継いでから鳴らす。**
      // 音量を書く effect はこれより前に並んでいるので、今の描画では
      // まだ「切り替える前の要素」に書かれている。ここで黙らせたまま渡すと、
      // 次の描画までの数十msだけ既定の 1.0（最大）で鳴ってしまう。
      if (el) el.volume = prevVol
      // duration 未取得(0)なら据え置き（0にすると再生開始条件が壊れる）。metadata到達時に更新される。
      if (s.duration > 0) setVideoDuration(s.duration)
      setFps(s.fps)
    }
    // 後追いのプロキシ/fps/尺が届いたら反映（届くまで原本再生・既定30のままになるのを防ぐ）
    // プレビュー解像度を変えたときもここで src を差し替える（再生ヘッド位置は触らないので維持される）
    //
    // **ただし、流している最中に黙って差し替えない。**
    // 差し替えは要素の読み込み直しになるので、そこで音が切れる。
    // 実測（npm run stutter --fresh）: 焼き直しが終わった瞬間に
    // 「音の抜け 64ms」。しかも出るのは毎回**測り終わり際＝変換の完了時**だった。
    // 変換の重さのせいだと思って優先度を最低まで下げたが、それでは消えなかった。
    //
    // 焼き上がったぶんは、止めてから入れ替える（見えている絵は原本のままでも、
    // 画質が少し眠いだけで、音が切れるより遥かにまし）。
    // **画質を自分で変えたときは、その場で差し替える**——待たされると
    // 「効いていない」と見えるため。
    const resChanged = lastPreviewResRef.current !== previewRes
    lastPreviewResRef.current = previewRes
    if (!playing || resChanged) setVideoSrc((prev) => (prev === desired ? prev : desired))
    setFps((prev) => (Math.abs(prev - s.fps) > 1e-3 ? s.fps : prev))
    if (s.duration > 0)
      setVideoDuration((prev) => (Math.abs(prev - s.duration) > 1e-3 ? s.duration : prev))
    // playing を見るのは「止めた瞬間に、待たせていた差し替えを入れる」ため
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTime, segLayout, sources, previewRes, proxyMap, playing])

  // 次に来る別ソースの映像を先回りシークして待機させる（切替の瞬間に正しいフレームが即出る）
  useEffect(() => {
    if (sources.length <= 1) return
    const cur = segLayout.find((l: { tStart: number; tEnd: number; index: number }) => currentTime >= l.tStart && currentTime < l.tEnd)
    const nxt = cur ? segLayout[cur.index + 1] : segLayout[0]
    if (!nxt || nxt.tStart - currentTime > 6) return // 6秒前から準備
    const s = srcOfSeg(nxt.seg)
    if (!s || s.id === curSourceIdRef.current) return
    const el = elOf(s.id)
    if (!el) return
    // シーク中は頼み直さない（着く前に書くと取り消されて、永久に追いつけない）
    if (!el.seeking && Math.abs(el.currentTime - nxt.seg.srcStart) > 0.3)
      el.currentTime = nxt.seg.srcStart
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTime, segLayout, sources])

  // 映像レイヤーの追従: 位置合わせ・再生/停止・音量（クリップ音量×トラック×フェード）
  useEffect(() => {
    const rate = playRateRef.current
    vcElsRef.current.forEach((el: HTMLVideoElement, id: number) => {
      const c = vClipsRef.current.find((x) => x.id === id)
      if (!c || !el) return
      const local = currentTime - c.tStart
      const len = Math.max(0.05, c.srcEnd - c.srcStart)
      const inRange = local >= 0 && local < len
      if (!inRange) {
        // 窓に入っているだけ（区間外）の要素は必ず止める。要素は残るのでここが効く
        if (!el.paused) el.pause()
        // 出番前なら頭に置いておく（境界で正しいフレームが即出る）
        if (!el.seeking && local < 0 && Math.abs(el.currentTime - c.srcStart) > 0.3)
          el.currentTime = c.srcStart
        return
      }
      const want = c.srcStart + local
      // シーク中は頼み直さない（着く前に書くと取り消されて、永久に追いつけない）
      if (!el.seeking && Math.abs(el.currentTime - want) > 0.25) el.currentTime = want
      const gain = c.muted ? 0 : (c.vol ?? 1) * vcFadeGain(c, local)
      el.volume = clamp(gain * audioTrackGain('A' + trackNum(c.track)), 0, 1)
      el.muted = !!c.muted
      if (playing && rate === 1) {
        if (el.paused && !el.ended) void el.play().catch(() => {})
      } else if (!el.paused) el.pause()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTime, playing, vClips, trackStates, masterVolume])

  // 2本目video(videoB)を xfPreview に追従させる（シーク/再生/レート）。ドリフトしたら再シーク。
  useEffect(() => {
    const vb = videoBRef.current
    if (!vb) return
    if (!xfPreview || xfPreview.blank) {
      if (!vb.paused) vb.pause()
      return
    }
    const rate = playRateRef.current
    if (rate > 0) {
      // シーク中は頼み直さない（着く前に書くと取り消されて、永久に追いつけない）
      if (!vb.seeking && Math.abs(vb.currentTime - xfPreview.srcTime) > 0.25)
        vb.currentTime = xfPreview.srcTime
      const r = Math.min(rate * xfPreview.speed, 16)
      if (Math.abs(vb.playbackRate - r) > 1e-3) vb.playbackRate = r
      if (vb.paused && !vb.ended) void vb.play().catch(() => {})
    } else {
      // 停止中/逆再生はフレームシークのみ（スクラブでもディゾルブが見える）
      if (!vb.paused) vb.pause()
      if (Math.abs(vb.currentTime - xfPreview.srcTime) > 0.05) vb.currentTime = xfPreview.srcTime
    }
    // xfPreviewはcurrentTime由来のため毎フレーム評価される。srcTime/blankも依存に入れて、
    // 停止中に間トランジション付与/トリム等で xfPreview が変化した場合も即シーク（古フレーム防止）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTime, videoSrc, xfPreview?.srcTime, xfPreview?.blank])

  // アンマウント時にクロック停止
  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [])
}
