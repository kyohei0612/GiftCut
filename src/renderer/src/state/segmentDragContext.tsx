// SegmentDrag を、どの区画からでも触れるようにする。
//
// ## なぜ囲いにしたか（2026-08-04）
//
// `useSegmentDrag` が要る物は**全部すでに心臓から取れる**のに、配線が取り出して渡し、
// 返ってきた物を束へ詰め直して心臓へ戻していた（`npm run passthrough`）。
//
// **中身はここで作る。** 上で作って渡すと、囲いを描き直すたびに作り直される。
//
// ## 中身
//
// - `SegmentDragValue` … `useSegmentDrag` が返す物（**手で書かず実体から引く**）
// - `SegmentDragProvider` … 囲い。中で `useSegmentDrag()` を1回だけ呼ぶ
// - `useSegmentDragCtx` … 見に行く。囲いの外で呼んだら、その場で落とす
import { createContext, useContext, type ReactNode } from 'react'
import { useAppChromeCtx } from './appChromeContext'
import { useContentShiftCtx } from './contentShiftContext'
import { useDragPreviewCtx } from './dragPreviewContext'
import { useHistoryCtx } from './historyContext'
import { useMediaCtx } from './mediaContext'
import { usePlaybackEngineCtx } from './playbackEngineContext'
import { useSegmentPlaceCtx } from './segmentPlaceContext'
import { useSnapCtx } from './snapContext'
import { useTimelineBoxCtx } from './timelineBoxContext'
import { useTimelineDragCtx } from './timelineDragContext'
import { useTimelineEditCtx } from './timelineEditContext'
import { useTracksAdminCtx } from './tracksAdminContext'
import { useViewCtx } from './viewContext'
import { useSegmentDrag } from './useSegmentDrag'

/** **手で書かない。** 作っている側から引く（ズレようがない） */
export type SegmentDragValue = ReturnType<typeof useSegmentDrag>

const Ctx = createContext<SegmentDragValue | null>(null)

export function SegmentDragProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { tool } = useAppChromeCtx()
  const { shiftAfter } = useContentShiftCtx()
  const { setDragTip, setSnapLineX, setVideoGhost, setOverwriteIds } = useDragPreviewCtx()
  const { undo } = useHistoryCtx()
  const { srcOfSeg, videoDurationRef, videoName, videoPath } = useMediaCtx()
  const { stopPlayback } = usePlaybackEngineCtx()
  const { moveSegmentTo } = useSegmentPlaceCtx()
  const { snapClipStart, snapTime } = useSnapCtx()
  const { trackInnerRef, scrollRef } = useTimelineBoxCtx()
  const { maybeTrackSelect } = useTimelineDragCtx()
  const { razorSegment } = useTimelineEditCtx()
  const { mainLocked } = useTracksAdminCtx()
  const { zoomRef } = useViewCtx()
  const value = useSegmentDrag({
    tool, mainLocked, maybeTrackSelect, stopPlayback, undo,
    moveSegmentTo,
    razorSegment,
    srcOfSeg, shiftAfter,
    trackInnerRef, scrollRef, zoomRef, videoDurationRef, videoName, videoPath,
    setDragTip, setSnapLineX, setVideoGhost, setOverwriteIds,
    snapClipStart, snapTime
  })
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** SegmentDrag を見に行く。囲いの外で呼んだら、その場で落とす */
export function useSegmentDragCtx(): SegmentDragValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useSegmentDragCtx は SegmentDragProvider の中でしか使えません')
  return v
}
