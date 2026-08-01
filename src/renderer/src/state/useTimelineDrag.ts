// タイムラインの上で掴む。目盛りを擦る・段をまとめて選ぶ・空きを囲う・
// クリップを動かす・端を摘む。
//
// プレビューの上で掴む話（state/useTelopBox）とは別物。こちらは**時刻と段**が
// 相手で、位置は秒とレーン名で決まる。
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

import { clamp } from '../../../shared/timeline'
import { formatTime, type Cue } from '../lib/srt'
import { type SegLayout } from '../lib/projectTypes'
import { useClipDrag } from './useClipDrag'
import { useDoc } from './contentContext'
import { useSel } from './selectionContext'
import { useTracksCtx } from './tracksContext'
import { useToastCtx } from './toastContext'
import { usePlaybackCtx } from './playbackContext'

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface UseTimelineDragDeps {
  /** いまの道具（選択・レザー・トラック選択） */
  tool: any
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
  vcLen: (c: any) => number
  idCounter: React.MutableRefObject<number>

  /** 掴んでいる最中の見た目 */
  setDragTip: (v: { x: number; y: number; text: string } | null) => void
  setMarquee: any
  setSnapLineX: (v: number | null) => void
  /** 吸い付き先の計算 */
  snapClipStart: any
  snapTime: any
  /** クリックした所の時刻 */
  scrubFromClientX: (clientX: number) => void
  /** 段を用意する／落とし先を覚えておく */
  reserveTrackPairForVideo: (vTrack: string) => string
  pendingLaneRef: React.MutableRefObject<string | null>
  /** 右クリックの品書きを出す */
  setMenu: any
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function useTimelineDrag(deps: UseTimelineDragDeps) {
  const {
    tool, duration, laneAtY, blurActiveInput, stopPlayback,
    trackInnerRef, scrollRef, zoomRef, videoTrackHRef, audioTrackHRef, padTop, rulerH,
    segLayout, segLayoutRef, v1Index, a1Index,
    cueTrack, telopLocked, trackNum, vcLen, idCounter,
    setDragTip, setMarquee, setSnapLineX, snapClipStart, snapTime,
    scrubFromClientX, reserveTrackPairForVideo, pendingLaneRef, setMenu
  } = deps
  const { cues, setCues, segments, seClips, imgClips, vClips } = useDoc()
  const {
    selectedIds, setSelectedIds, setSelectedVideoIds, setSelectedAudioIds,
    setSelectedSeIds, setSelectedImgIds, setSelectedVClipIds,
    setSelectedTrans, setSelectedTelopTrans, setSelectedTrackId, setSelectedMarkerId,
    setVideoSelected, setSelectedMediaId, setEditingId,
    isSelected, clearAll: clearAllSelections, clearSegSel
  } = useSel()
  const { tracks, trackStates } = useTracksCtx()
  const { showToast } = useToastCtx()
  const { currentTimeRef, fpsRef } = usePlaybackCtx()

  function startScrub(e: React.PointerEvent): void {
    blurActiveInput()
    e.preventDefault()
    e.stopPropagation()
    stopPlayback()
    scrubFromClientX(e.clientX)
    // プレミア風: ヘッドを端まで持っていく（画面外含む）とタイムラインが追従スクロール
    const scroll = scrollRef.current
    let lastCx = e.clientX
    let raf: number | null = null
    const EDGE = 56 // 端からこの範囲でオートスクロール開始（バッファ）
    const MAXV = 28 // 1フレームの最大スクロール量(px)
    const autoScroll = (): void => {
      raf = requestAnimationFrame(autoScroll)
      if (!scroll) return
      const r = scroll.getBoundingClientRect()
      let dv = 0
      if (lastCx > r.right - EDGE) dv = Math.min(MAXV, ((lastCx - (r.right - EDGE)) / EDGE) * MAXV)
      else if (lastCx < r.left + EDGE)
        dv = -Math.min(MAXV, ((r.left + EDGE - lastCx) / EDGE) * MAXV)
      if (dv !== 0) {
        const before = scroll.scrollLeft
        scroll.scrollLeft = before + dv
        if (scroll.scrollLeft !== before) scrubFromClientX(lastCx) // スクロール分ヘッドを進める
      }
    }
    raf = requestAnimationFrame(autoScroll)
    const onMove = (ev: PointerEvent): void => {
      lastCx = ev.clientX
      scrubFromClientX(ev.clientX)
    }
    const onUp = (): void => {
      if (raf) cancelAnimationFrame(raf)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  // ---- トラック選択ツール（プレミア準拠: クリック位置から左/右を全選択）----
  /** 各トラック行の縦位置（trackInner の上端からの相対 px） */
  // 段の縦位置と落とし先の判定は shared/lanes（画面を起動せずに確かめられる）。
  // **外したときに本編へ落とさない**決まりもそこに書いてある

  function trackSelect(e: React.PointerEvent, dir: number): void {
    const inner = trackInnerRef.current
    if (!inner) return
    const rect = inner.getBoundingClientRect()
    const T = (e.clientX - rect.left) / zoomRef.current
    const single = e.shiftKey // Shift = マウスのいるレーンだけ
    const laneId = laneAtY(e.clientY - rect.top)
    const fwd = dir > 0
    const want = (id: string): boolean => !single || laneId === id
    // 右方向=クリップが T より右に伸びている / 左方向=T より左から始まっている
    setSelectedIds(
      want('V2') || want('V3')
        ? cues
            .filter(
              (c) => (fwd ? c.end > T : c.start < T) && (!single || cueTrack(c) === laneId)
            )
            .map((c) => c.id)
        : []
    )
    const segHit = (L: SegLayout): boolean => (fwd ? L.tEnd > T : L.tStart < T)
    setSelectedVideoIds(want('V1') ? segLayout.filter(segHit).map((L) => L.seg.id) : [])
    setSelectedAudioIds(want('A1') ? segLayout.filter(segHit).map((L) => L.seg.id) : [])
    // SE/BGM・画像は「そのクリップが載っているトラック」で判定（A2決め打ちにしない）
    const clipHit = (c: { tStart: number; duration: number }): boolean =>
      fwd ? c.tStart + c.duration > T : c.tStart < T
    setSelectedSeIds(
      seClips.filter((c) => want(c.track) && clipHit(c)).map((c) => c.id)
    )
    setSelectedImgIds(
      imgClips.filter((c) => want(c.track) && clipHit(c)).map((c) => c.id)
    )
    // 映像レイヤー（映像側の行 or 対の音声側の行を指していれば対象）
    setSelectedVClipIds(
      vClips
        .filter((c) => {
          const len = Math.max(0.05, c.srcEnd - c.srcStart)
          const hit = fwd ? c.tStart + len > T : c.tStart < T
          return hit && (want(c.track) || want('A' + trackNum(c.track)))
        })
        .map((c) => c.id)
    )
  }
  // トラック選択ツール中なら選択して true。各ポインタハンドラの先頭で使う。
  function maybeTrackSelect(e: React.PointerEvent): boolean {
    if (tool !== 'trackFwd' && tool !== 'trackBack') return false
    if (e.button !== 0) return false
    e.stopPropagation()
    e.preventDefault()
    setSelectedTrackId(null)
    setSelectedIds([])
    clearSegSel()
    trackSelect(e, tool === 'trackFwd' ? 1 : -1)
    return true
  }
  // 効果音・画像・映像クリップの掴み方は state/useClipDrag（決め事は共通なので1か所）
  const { onSePointerDown, onImgPointerDown, onVClipPointerDown } = useClipDrag({
    trackInnerRef,
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
    clearSegSel()
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
            const len = Math.max(0.05, c.srcEnd - c.srcStart)
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

  // クリップの pointerdown（選択・複数まとめてドラッグ・レザー分割）
  function onClipPointerDown(cue: Cue, e: React.PointerEvent): void {
    if (maybeTrackSelect(e)) return
    e.stopPropagation()
    if (e.button !== 0) return // 右/中クリックは contextmenu に任せる
    setSelectedTrackId(null)
    clearSegSel() // テロップ選択時は動画切片の選択を解除
    if (telopLocked(cue)) return // このテロップの載っているトラックがロック中は編集不可
    if (tool === 'razor') {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      const t = cue.start + (e.clientX - rect.left) / zoomRef.current
      if (t <= cue.start + 0.05 || t >= cue.end - 0.05) return
      const nid = idCounter.current++ // id は updater の外で確定（StrictMode 二重実行対策）
      setCues((prev) => {
        const rest = prev.filter((c) => c.id !== cue.id)
        const a: Cue = { ...structuredClone(cue), end: t }
        const b: Cue = { ...structuredClone(cue), id: nid, start: t }
        return [...rest, a, b].sort((x, y) => x.start - y.start)
      })
      return
    }
    // Ctrl/Cmd+クリック: 選択トグル（ドラッグしない）
    if (e.ctrlKey || e.metaKey) {
      setSelectedIds((prev) =>
        prev.includes(cue.id) ? prev.filter((id) => id !== cue.id) : [...prev, cue.id]
      )
      return
    }
    // プレミア準拠: 選択済みクリップを掴んだら選択全体をまとめて移動。
    // 未選択クリップを掴んだらそれだけを選択して移動。選択しても再生ヘッドは動かさない。
    const alreadySel = selectedIds.includes(cue.id)
    const dragIds = alreadySel ? [...selectedIds] : [cue.id]
    if (!alreadySel) setSelectedIds([cue.id])
    // テロップ配置可能トラック（上→下）。上下ドラッグでこの間を移動できる
    // テロップは V1 以外の全映像トラックに置ける（V4以降へ退避したテロップも扱えるように）
    const TELOP_ORDER = tracks
      .filter((t) => t.kind === 'video' && t.id !== 'V1')
      .map((t) => t.id)
      .reverse()
    // 各テロップ行の実際の行番号（V4等の追加レーンで行がずれても正しく対応させる）
    const TELOP_ROWS = TELOP_ORDER.map((id) => tracks.findIndex((t) => t.id === id))
    const startMap = new Map(
      cues
        .filter((c) => dragIds.includes(c.id))
        .map((c) => [c.id, { s: c.start, e: c.end, tr: cueTrack(c) }])
    )
    const grabbed = startMap.get(cue.id)
    if (!grabbed) return
    const grabbedIdx = Math.max(0, TELOP_ORDER.indexOf(grabbed.tr))
    const minStart = Math.min(...[...startMap.values()].map((v) => v.s))
    const innerRect = trackInnerRef.current?.getBoundingClientRect()
    const sx = e.clientX
    const sy = e.clientY
    let moved = false
    const onMove = (ev: PointerEvent): void => {
      const dxPx = ev.clientX - sx
      const dyPx = ev.clientY - sy
      // 横=時間, 縦=トラック移動。どちらかがしきい値を超えたらドラッグ開始
      if (!moved && Math.abs(dxPx) + Math.abs(dyPx) < 3) return
      moved = true
      let delta = dxPx / zoomRef.current
      delta = snapTime(grabbed.s + delta, dragIds) - grabbed.s
      if (minStart + delta < 0) delta = -minStart
      // 掴んだクリップがどのテロップ行に来たか → 相対トラックシフト量
      // （追加レーンでテロップ行の位置がずれても、実際の行番号に最も近いテロップ行へ吸着）
      let trackShift = 0
      if (innerRect) {
        const yRel = ev.clientY - innerRect.top - rulerH - padTop
        const row = Math.floor(yRel / videoTrackHRef.current)
        let ti = grabbedIdx
        let best = Infinity
        TELOP_ROWS.forEach((r, i) => {
          const d = Math.abs(r - row)
          if (d < best) {
            best = d
            ti = i
          }
        })
        trackShift = ti - grabbedIdx
      }
      setCues((prev) =>
        prev.map((c) => {
          const st = startMap.get(c.id)
          if (!st) return c
          const idx = Math.max(0, TELOP_ORDER.indexOf(st.tr))
          const ntr = TELOP_ORDER[clamp(idx + trackShift, 0, TELOP_ORDER.length - 1)]
          return { ...c, start: st.s + delta, end: st.e + delta, track: ntr }
        })
      )
      setDragTip({ x: ev.clientX, y: ev.clientY, text: formatTime(Math.max(0, grabbed.s + delta)) })
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      setSnapLineX(null)
      setDragTip(null)
      // ドラッグせずクリックのみ → そのクリップ単体を選択（プレミア準拠）
      if (!moved && alreadySel) setSelectedIds([cue.id])
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  function onClipContextMenu(cue: Cue, e: React.MouseEvent): void {
    e.preventDefault()
    e.stopPropagation()
    if (!isSelected(cue.id)) setSelectedIds([cue.id])
    setMenu({ x: e.clientX, y: e.clientY, cueId: cue.id })
  }

  // クリップ端のトリム（イン/アウト調整＋時間ツールチップ）
  // 注意: snapTime/setDragTip は setState の updater 内で呼ばない（updater は純粋関数であること）
  function onTrimStart(cue: Cue, edge: 'l' | 'r', e: React.PointerEvent): void {
    e.stopPropagation()
    e.preventDefault()
    if (e.button !== 0) return
    if (telopLocked(cue)) return
    const inner = trackInnerRef.current
    if (!inner) return
    const rect = inner.getBoundingClientRect()
    const fixedStart = cue.start // 反対側の端はドラッグ開始時の値で固定
    const fixedEnd = cue.end
    const onMove = (ev: PointerEvent): void => {
      const t = (ev.clientX - rect.left) / zoomRef.current
      if (edge === 'l') {
        const ns = Math.max(0, Math.min(snapTime(t, [cue.id]), fixedEnd - 0.1))
        setDragTip({
          x: ev.clientX,
          y: ev.clientY,
          text: `イン ${formatTime(ns)} | 長さ ${formatTime(fixedEnd - ns)}`
        })
        setCues((prev) => prev.map((c) => (c.id === cue.id ? { ...c, start: ns } : c)))
      } else {
        const ne = Math.max(snapTime(t, [cue.id]), fixedStart + 0.1)
        setDragTip({
          x: ev.clientX,
          y: ev.clientY,
          text: `アウト ${formatTime(ne)} | 長さ ${formatTime(ne - fixedStart)}`
        })
        setCues((prev) => prev.map((c) => (c.id === cue.id ? { ...c, end: ne } : c)))
      }
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      setSnapLineX(null)
      setDragTip(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }
  return {
    startScrub,
    trackSelect,
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
