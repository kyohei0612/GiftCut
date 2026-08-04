// TimelineEdit を、どの区画からでも触れるようにする。
//
// ## なぜ囲いにしたか（2026-08-04）
//
// `useTimelineEdit` が要る物は**全部すでに心臓から取れる**のに、配線が取り出して渡し、
// 返ってきた物を束へ詰め直して心臓へ戻していた（`npm run passthrough`）。
//
// **中身はここで作る。** 上で作って渡すと、囲いを描き直すたびに作り直される。
//
// ## 中身
//
// - `TimelineEditValue` … `useTimelineEdit` が返す物（**手で書かず実体から引く**）
// - `TimelineEditProvider` … 囲い。中で `useTimelineEdit()` を1回だけ呼ぶ
// - `useTimelineEditCtx` … 見に行く。囲いの外で呼んだら、その場で落とす
import { createContext, useContext, type ReactNode } from 'react'
import { useAppChromeCtx } from './appChromeContext'
import { useContentShiftCtx } from './contentShiftContext'
import { useCopyPasteCtx } from './copyPasteContext'
import { useHistoryCtx } from './historyContext'
import { useMediaDropCtx } from './mediaDropContext'
import { usePlaybackEngineCtx } from './playbackEngineContext'
import { useSegLayoutCtx } from './segLayoutContext'
import { useSegOpsCtx } from './segOpsContext'
import { useSegmentPlaceCtx } from './segmentPlaceContext'
import { useSilenceDuckCtx } from './silenceDuckContext'
import { useTimelineBoxCtx } from './timelineBoxContext'
import { useTrackGeomCtx } from './trackGeomContext'
import { useTracksAdminCtx } from './tracksAdminContext'
import { useTransitionsCtx } from './transitionsContext'
import { useVideoElsCtx } from './videoElsContext'
import { useTimelineEdit } from './useTimelineEdit'

/** **手で書かない。** 作っている側から引く（ズレようがない） */
export type TimelineEditValue = ReturnType<typeof useTimelineEdit>

const Ctx = createContext<TimelineEditValue | null>(null)

export function TimelineEditProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { idCounter } = useAppChromeCtx()
  const { shiftAfter } = useContentShiftCtx()
  const { copySelected } = useCopyPasteCtx()
  const { commitPending, setTime } = useHistoryCtx()
  const { deleteSelectedImg, deleteSelectedVClip } = useMediaDropCtx()
  const { seekTo, stopPlayback } = usePlaybackEngineCtx()
  const { segLayoutRef } = useSegLayoutCtx()
  const { makeGapSeg, segOps } = useSegOpsCtx()
  const { cutRangeFromSegs } = useSegmentPlaceCtx()
  const { silenceCut, setSilenceCut, setSilenceOpen, silenceCuts } = useSilenceDuckCtx()
  const { revealPlayhead } = useTimelineBoxCtx()
  const { cueTrack, vcLen } = useTrackGeomCtx()
  const { mainLocked, telopLocked } = useTracksAdminCtx()
  const { cleanupOrphanTrans } = useTransitionsCtx()
  const { videoRef } = useVideoElsCtx()
  const value = useTimelineEdit({
    cleanupOrphanTrans, commitPending, copySelected, cueTrack, cutRangeFromSegs,
    deleteSelectedImg, deleteSelectedVClip, idCounter, mainLocked, makeGapSeg,
    seekTo, revealPlayhead, segLayoutRef, segOps, silenceCut, setSilenceCut, setSilenceOpen, setTime,
    shiftAfter, silenceCuts, stopPlayback, telopLocked, vcLen, videoRef
  })
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** TimelineEdit を見に行く。囲いの外で呼んだら、その場で落とす */
export function useTimelineEditCtx(): TimelineEditValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useTimelineEditCtx は TimelineEditProvider の中でしか使えません')
  return v
}
