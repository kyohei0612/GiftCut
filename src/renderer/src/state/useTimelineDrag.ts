// タイムラインの上で掴む。**目盛りを擦る**と**空きを囲う**（範囲選択）。
// 掴む入口を1つにまとめて外へ返す所でもある。
//
// プレビューの上で掴む話（state/useTelopBox）とは別物。こちらは**時刻と段**が
// 相手で、位置は秒とレーン名で決まる。
//
// ## 掴む物ごとに分かれている（2026-08-04。596行を3つへ）
//
//   ./useTrackSelectTool  トラック選択ツール（左／右を全部選ぶ）。**土台**——
//                         下の2つと、ここの入口すべてが先にこれを通る
//   ./useTelopDrag        テロップそのものを掴む（動かす・端を摘む・右クリック）
//   ./useClipDrag         効果音・画像・映像クリップを掴む（決め事は共通なので1か所）
//
// 測ったら、どの群も**連れて行く局所の名前が0**だった（受け取るのは import と
// `maybeTrackSelect` だけ）。経緯は `引き継ぎ-心臓の分け直し.md`。
//
// ## 掴む前に、入力から手を離させる
//
// 数値欄に打ち込んでいる最中にタイムラインを掴むと、打った値が確定しないまま
// 別の操作が始まる。掴む入口で blur してから始める。
//
// ## クリックと掴みを分ける
//
// 少し動いた時点で初めて「掴んだ」とみなす。押した指の微ジタで選択が
// 外れると、狙った物を選び直すことになる。
//
// ## 段の当たり判定は外から受け取る
//
// 「いま縦のどこか」は state/useLaneGeometry が持つ。ここは受け取るだけ
// （画面のあちこちから同じ問いが飛ぶので、掴む操作の持ち物にはしない）。

import { startEdgeScroll } from '../lib/edgeScroller'
import { type Cue } from '../lib/srt'
import { type SegLayout } from '../lib/projectTypes'
import { useClipDrag } from './useClipDrag'
// トラック選択ツール。**3つの入口すべてがここを通る＝土台**なので先に呼ぶ
import { useTrackSelectTool } from './useTrackSelectTool'
// テロップそのものを掴む所（動かす・端を摘む・右クリック）
import { useTelopDrag } from './useTelopDrag'
import { useDoc } from './contentContext'
import { useSel } from './selectionContext'
import { useTracksCtx } from './tracksContext'
import type { Tool, ContextMenu } from './useAppChrome'
import type { Marquee } from './useDragPreview'
// **useHistory の Snap と名前がぶつかる**ので別名で受ける
import type { Snap as SnapApi } from './useSnap'

export interface UseTimelineDragDeps {
  /** いまの道具（選択・レザー・トラック選択） */
  tool: Tool
  duration: number
  /** 段の当たり判定（state/useLaneGeometry） */
  laneAtY: (yRel: number) => string | null
  /** 掴む前に入力欄から手を離させる */
  blurActiveInput: () => void
  stopPlayback: () => void

  /** タイムラインの中身。当たり判定はこの矩形が基準 */
  trackInnerRef: React.RefObject<HTMLDivElement | null>
  scrollRef: React.RefObject<HTMLDivElement | null>
  /** 横の拡大率（px/秒）。掴んでいる最中にも読むので ref */
  zoomRef: React.MutableRefObject<number>
  videoTrackHRef: React.MutableRefObject<number>
  audioTrackHRef: React.MutableRefObject<number>
  padTop: number
  /** 目盛りの高さ。段の上端はここから始まる */
  rulerH: number

  /** 本編の並び（切片の時刻とレーン） */
  segLayout: SegLayout[]
  segLayoutRef: React.MutableRefObject<SegLayout[]>
  v1Index: number
  a1Index: number

  cueTrack: (c: Cue) => string
  telopLocked: (c: Cue) => boolean
  trackNum: (id: string) => number
  // **`any` で受けない。** ここは正典（shared/timeline の vcLen）を配る導線で、
  // `any` だと「まったく別の関数」を渡されても型検査が素通りする
  vcLen: (c: { srcStart: number; srcEnd: number }) => number
  idCounter: React.MutableRefObject<number>

  /** 掴んでいる最中の見た目 */
  setDragTip: (v: { x: number; y: number; text: string } | null) => void
  setMarquee: React.Dispatch<React.SetStateAction<Marquee | null>>
  setSnapLineX: (v: number | null) => void
  /** 吸い付き先の計算 */
  /** 形は書き写さず、作っている側（state/useSnap）から引く */
  snapClipStart: SnapApi['snapClipStart']
  snapTime: SnapApi['snapTime']
  /** クリックした所の時刻 */
  scrubFromClientX: (clientX: number) => void
  /** 段を用意する／落とし先を覚えておく */
  reserveTrackPairForVideo: (vTrack: string) => string
  /** 一番上より更に上へテロップを運んだときに、映像の段を1本足す */
  addVideoTrack: () => void
  pendingLaneRef: React.MutableRefObject<string | null>
  /** 右クリックの品書きを出す */
  setMenu: React.Dispatch<React.SetStateAction<ContextMenu | null>>
}

export function useTimelineDrag(deps: UseTimelineDragDeps) {
  const {
    tool, duration, laneAtY, blurActiveInput, stopPlayback,
    trackInnerRef, scrollRef, zoomRef, videoTrackHRef, audioTrackHRef, padTop, rulerH,
    segLayout, segLayoutRef, v1Index, a1Index,
    cueTrack, telopLocked, trackNum, vcLen, idCounter,
    setDragTip, setMarquee, setSnapLineX, snapClipStart, snapTime,
    scrubFromClientX, reserveTrackPairForVideo, addVideoTrack, pendingLaneRef, setMenu
  } = deps
  const { cues, seClips, imgClips, vClips } = useDoc()
  const {
    setSelectedIds, setSelectedVideoIds, setSelectedAudioIds,
    setSelectedSeIds, setSelectedImgIds, setSelectedVClipIds,
    setSelectedTrackId,
    setVideoSelected,
    // **名前を変えて受けない。** ここは「全部外す」（テロップの選択も消える）。
    // 以前は clearSegSel という名前で受けていたので、読んだ人が
    // 「切片の選択だけ外れる」と誤解し、Ctrl+クリックのまとめ選択が
    // 一度も成立しないまま気づかれなかった。
    clearAll
  } = useSel()
  const { tracks } = useTracksCtx()

  function startScrub(e: React.PointerEvent): void {
    blurActiveInput()
    e.preventDefault()
    e.stopPropagation()
    stopPlayback()
    scrubFromClientX(e.clientX)
    // プレミア風: ヘッドを端まで持っていく（画面外含む）とタイムラインが追従スクロール
    // 端まで持っていったら送る。**速さの決め方は shared/edgeScroll に1つ**
    // （掴んだクリップ側も同じ物を使う。別々に書くと手つきが場所で変わる）
    let lastCx = e.clientX
    const es = startEdgeScroll(scrollRef.current, () => scrubFromClientX(lastCx))
    es.track(e.clientX)
    const onMove = (ev: PointerEvent): void => {
      lastCx = ev.clientX
      es.track(ev.clientX)
      scrubFromClientX(ev.clientX)
    }
    const onUp = (): void => {
      es.stop()
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  // **土台。** トラック選択ツール中は、下のどの入口も自分の仕事をやめる。
  // 3つの入口すべてがここを見に来るので、先に呼んでおく（state/useTrackSelectTool）
  const { maybeTrackSelect } = useTrackSelectTool({
    tool, laneAtY, trackInnerRef, zoomRef, segLayout, cueTrack, trackNum, vcLen
  })
  // テロップそのものを掴む所（動かす・端を摘む・右クリック）は state/useTelopDrag
  const { onClipPointerDown, onClipContextMenu, onTrimStart } = useTelopDrag({
    tool, maybeTrackSelect, trackInnerRef, scrollRef, zoomRef, videoTrackHRef, padTop, rulerH,
    cueTrack, telopLocked, idCounter, setDragTip, setSnapLineX, snapClipStart, snapTime,
    addVideoTrack, setMenu
  })
  // 効果音・画像・映像クリップの掴み方は state/useClipDrag（決め事は共通なので1か所）
  const { onSePointerDown, onImgPointerDown, onVClipPointerDown } = useClipDrag({
    trackInnerRef,
    scrollRef,
    tool,
    duration,
    laneAtY,
    maybeTrackSelect,
    setDragTip,
    setSnapLineX,
    snapClipStart,
    snapTime,
    reserveTrackPairForVideo,
    pendingLaneRef,
    vcLen
  })


  // 空きトラックのドラッグ = 範囲選択（マーキー）。クリック = 選択解除（プレミア準拠）
  function onTrackAreaPointerDown(e: React.PointerEvent): void {
    blurActiveInput() // キー操作の対象をタイムラインへ戻す
    if (maybeTrackSelect(e)) return
    if (tool !== 'select') return
    if (e.button !== 0) return // 右/中クリックで選択解除・マーキーが始まらないように
    const inner = trackInnerRef.current
    if (!inner) return
    e.preventDefault()
    const rect = inner.getBoundingClientRect()
    const x0 = e.clientX - rect.left
    const y0 = e.clientY - rect.top
    setSelectedTrackId(null)
    setSelectedIds([])
    clearAll()
    setVideoSelected(false) // タイムライン空白クリックで動画リフレーム枠も閉じる
    let dragged = false
    const cuesNow = cues
    const onMove = (ev: PointerEvent): void => {
      const x1 = ev.clientX - rect.left
      const y1 = ev.clientY - rect.top
      if (!dragged && Math.abs(x1 - x0) + Math.abs(y1 - y0) < 4) return
      dragged = true
      setMarquee({ x0, y0, x1, y1 })
      const mx0 = Math.min(x0, x1)
      const mx1 = Math.max(x0, x1)
      const my0 = Math.min(y0, y1)
      const my1 = Math.max(y0, y1)
      const z = zoomRef.current
      // 矩形が縦に重なった行の種類を全部選択（どの方向からでも、テロップも巻き込める）
      // トラック高さが可変なので各行の top/高さを積み上げて判定
      const heights = tracks.map((t) =>
        t.kind === 'video' ? videoTrackHRef.current : audioTrackHRef.current
      )
      const overRow = (idx: number): boolean => {
        let top = rulerH + padTop
        for (let i = 0; i < idx; i++) top += heights[i]
        return my1 >= top && my0 <= top + heights[idx]
      }
      const segIds = segLayoutRef.current
        .filter((L) => L.tEnd * z >= mx0 && L.tStart * z <= mx1)
        .map((L) => L.seg.id)
      // テロップは配置トラック(V2/V3)の行が矩形に掛かっているものを選択
      setSelectedIds(
        cuesNow
          .filter(
            (c) =>
              c.end * z >= mx0 &&
              c.start * z <= mx1 &&
              overRow(tracks.findIndex((t) => t.id === cueTrack(c)))
          )
          .map((c) => c.id)
      )
      setSelectedVideoIds(overRow(v1Index) ? segIds : [])
      setSelectedAudioIds(overRow(a1Index) ? segIds : [])
      // SE/BGM クリップも矩形が掛かった音声行のぶんだけ選択（まとめてDeleteできる）
      setSelectedSeIds(
        seClips
          .filter(
            (c) =>
              (c.tStart + c.duration) * z >= mx0 &&
              c.tStart * z <= mx1 &&
              overRow(tracks.findIndex((t) => t.id === c.track))
          )
          .map((c) => c.id)
      )
      // 画像クリップも同様に
      setSelectedImgIds(
        imgClips
          .filter(
            (c) =>
              (c.tStart + c.duration) * z >= mx0 &&
              c.tStart * z <= mx1 &&
              overRow(tracks.findIndex((t) => t.id === c.track))
          )
          .map((c) => c.id)
      )
      // 映像レイヤーも矩形選択の対象（映像側の行 or 対の音声側の行に掛かっていれば）
      setSelectedVClipIds(
        vClips
          .filter((c) => {
            const len = vcLen(c)
            if (!((c.tStart + len) * z >= mx0 && c.tStart * z <= mx1)) return false
            return (
              overRow(tracks.findIndex((t) => t.id === c.track)) ||
              overRow(tracks.findIndex((t) => t.id === 'A' + trackNum(c.track)))
            )
          })
          .map((c) => c.id)
      )
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      setMarquee(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  return {
    startScrub,
    maybeTrackSelect,
    onTrackAreaPointerDown,
    onClipPointerDown,
    onClipContextMenu,
    onTrimStart,
    onSePointerDown,
    onImgPointerDown,
    onVClipPointerDown
  }
}
