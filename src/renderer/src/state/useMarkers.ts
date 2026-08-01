// タイムライン上の目印（マーカー）。頭出しとメモ用で、**書き出しには影響しない**。
//
// ## 掴んだときの見分け
//
// 押しただけならその位置へ頭出し、動かしたら移動。3px 動くまでは「押しただけ」と
// 見なす。マウスは押した瞬間に微妙に動くので、区別しないと頭出しのつもりが
// 目印を動かしてしまう。
//
// ## 選び直しは他を全部外す
//
// 目印を選ぶときは、テロップ・切片・段の選択を落とす。残っていると
// Delete がどれに効くのか分からなくなる（消したいのは押した目印のはず）。
//
// ## 同じ場所には作らない
//
// 1コマぶんより近い所に既にあれば、作らずにそれを選ぶ。
// 重なって置くと、以後どちらを掴んでいるのか分からなくなる。

import { formatTime } from '../lib/srt'
import type { Marker } from '../lib/projectTypes'
import { useDoc } from './contentContext'
import { useSel } from './selectionContext'
import { usePlaybackCtx } from './playbackContext'
import { useViewCtx } from './viewContext'
import { useDragPreviewCtx } from './dragPreviewContext'

export interface UseMarkersDeps {
  stopPlayback: () => void
  seekTo: (t: number) => void
  /** 飛んで、そこを見せる（枠の外なら連れてくる） */
  seekAndReveal: (t: number) => void
  /** カット点・クリップ端への吸着 */
  snapTime: (t: number) => number
}

export interface Markers {
  addMarkerAtPlayhead: () => void
  deleteMarker: (id: number) => void
  jumpMarker: (dir: 1 | -1) => void
  onMarkerPointerDown: (mk: Marker, e: React.PointerEvent) => void
}

export function useMarkers(deps: UseMarkersDeps): Markers {
  const { stopPlayback, seekTo, seekAndReveal, snapTime } = deps
  const { markers, setMarkers, markerIdCounter } = useDoc()
  const {
    selectedMarkerId, setSelectedMarkerId, editingMarkerId, setEditingMarkerId,
    setSelectedIds, clearSegSel, setSelectedTrackId
  } = useSel()
  const { currentTimeRef, fpsRef } = usePlaybackCtx()
  const { zoomRef } = useViewCtx()
  const { setDragTip } = useDragPreviewCtx()

  function addMarkerAtPlayhead(): void {
    const t = currentTimeRef.current
    const near = markers.find((m) => Math.abs(m.t - t) < 1 / fpsRef.current)
    if (near) {
      setSelectedMarkerId(near.id)
      return
    }
    const id = markerIdCounter.current++
    setMarkers((prev) => [...prev, { id, t, label: '' }].sort((a, b) => a.t - b.t))
    setSelectedMarkerId(id)
  }
  function deleteMarker(id: number): void {
    setMarkers((prev) => prev.filter((m) => m.id !== id))
    if (selectedMarkerId === id) setSelectedMarkerId(null)
    if (editingMarkerId === id) setEditingMarkerId(null)
  }
  // 前/次のマーカーへ頭出し
  function jumpMarker(dir: 1 | -1): void {
    const t = currentTimeRef.current
    const sorted = [...markers].sort((a, b) => a.t - b.t)
    const target =
      dir > 0
        ? sorted.find((m) => m.t > t + 1e-3)
        : [...sorted].reverse().find((m) => m.t < t - 1e-3)
    if (target) {
      stopPlayback()
      // 飛んだ先のめじるしが枠の外なら、そこを見せる
      seekAndReveal(target.t)
      setSelectedMarkerId(target.id)
    }
  }
  // マーカーの掴み＝選択＋ドラッグで移動。動かさなければクリック＝その位置へ頭出し。
  function onMarkerPointerDown(mk: Marker, e: React.PointerEvent): void {
    e.stopPropagation()
    if (e.button !== 0) return
    // 選択は排他に（他のクリップ選択が残っていると Delete がどれに効くか分からなくなる）
    setSelectedIds([])
    clearSegSel()
    setSelectedTrackId(null)
    setSelectedMarkerId(mk.id)
    const sx = e.clientX
    const t0 = mk.t
    let moved = false
    const onMove = (ev: PointerEvent): void => {
      if (!moved && Math.abs(ev.clientX - sx) < 3) return
      moved = true
      // カット点/クリップ端に吸着（他のクリップと同じ操作感）
      const nt = Math.max(0, snapTime(t0 + (ev.clientX - sx) / zoomRef.current))
      setMarkers((prev) => prev.map((m) => (m.id === mk.id ? { ...m, t: nt } : m)))
      setDragTip({ x: ev.clientX, y: ev.clientY, text: `🚩 ${formatTime(nt)}` })
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      if (!moved) {
        stopPlayback()
        seekTo(t0)
      } else {
        setMarkers((prev) => [...prev].sort((a, b) => a.t - b.t))
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  return { addMarkerAtPlayhead, deleteMarker, jumpMarker, onMarkerPointerDown }
}
