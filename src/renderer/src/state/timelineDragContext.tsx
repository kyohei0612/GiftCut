// TimelineDrag を、どの区画からでも触れるようにする。
//
// ## なぜ囲いにしたか（2026-08-04）
//
// `useTimelineDrag` が要る物は**全部すでに心臓から取れる**のに、配線が取り出して渡し、
// 返ってきた物を束へ詰め直して心臓へ戻していた（`npm run passthrough`）。
//
// **中身はここで作る。** 上で作って渡すと、囲いを描き直すたびに作り直される。
//
// ## 中身
//
// - `TimelineDragValue` … `useTimelineDrag` が返す物（**手で書かず実体から引く**）
// - `TimelineDragProvider` … 囲い。中で `useTimelineDrag()` を1回だけ呼ぶ
// - `useTimelineDragCtx` … 見に行く。囲いの外で呼んだら、その場で落とす
import { createContext, useContext, type ReactNode } from 'react'
import { useAppChromeCtx } from './appChromeContext'
import { useDragPreviewCtx } from './dragPreviewContext'
import { useLaneGeometryCtx } from './laneGeometryContext'
import { useLaneHeightsCtx } from './laneHeightsContext'
import { usePlaybackEngineCtx } from './playbackEngineContext'
import { useSegLayoutCtx } from './segLayoutContext'
import { useSnapCtx } from './snapContext'
import { useTimelineBoxCtx } from './timelineBoxContext'
import { useTimelineSpanCtx } from './timelineSpanContext'
import { useTrackGeomCtx } from './trackGeomContext'
import { useTracksAdminCtx } from './tracksAdminContext'
import { useViewCtx } from './viewContext'
import { useViewNavCtx } from './viewNavContext'
import { RULER_H } from '../lib/appConst'
import { blurActiveInput } from '../lib/focus'
import { useTimelineDrag } from './useTimelineDrag'

/** **手で書かない。** 作っている側から引く（ズレようがない） */
export type TimelineDragValue = ReturnType<typeof useTimelineDrag>

const Ctx = createContext<TimelineDragValue | null>(null)

export function TimelineDragProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { tool, idCounter, setMenu } = useAppChromeCtx()
  const { setDragTip, setMarquee, setSnapLineX } = useDragPreviewCtx()
  const { laneAtY } = useLaneGeometryCtx()
  const { videoTrackHRef, audioTrackHRef, padTop } = useLaneHeightsCtx()
  const { stopPlayback } = usePlaybackEngineCtx()
  const { segLayout, segLayoutRef } = useSegLayoutCtx()
  const { snapClipStart, snapTime } = useSnapCtx()
  const { trackInnerRef, scrollRef } = useTimelineBoxCtx()
  const { duration } = useTimelineSpanCtx()
  const { v1Index, a1Index, cueTrack, trackNum, vcLen } = useTrackGeomCtx()
  const { telopLocked, reserveTrackPairForVideo, addVideoTrack } = useTracksAdminCtx()
  const { zoomRef } = useViewCtx()
  const { scrubFromClientX } = useViewNavCtx()
  const value = useTimelineDrag({
    tool, duration, laneAtY, blurActiveInput, stopPlayback,
    trackInnerRef, scrollRef, zoomRef, videoTrackHRef, audioTrackHRef,
    padTop, rulerH: RULER_H,
    segLayout, segLayoutRef, v1Index, a1Index,
    cueTrack, telopLocked, trackNum, vcLen, idCounter,
    setDragTip, setMarquee, setSnapLineX, snapClipStart, snapTime,
    scrubFromClientX, reserveTrackPairForVideo, addVideoTrack, setMenu
  })
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** TimelineDrag を見に行く。囲いの外で呼んだら、その場で落とす */
export function useTimelineDragCtx(): TimelineDragValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useTimelineDragCtx は TimelineDragProvider の中でしか使えません')
  return v
}
