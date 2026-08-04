// MediaDrop を、どの区画からでも触れるようにする。
//
// ## なぜ囲いにしたか（2026-08-04）
//
// `useMediaDrop` が要る物は**全部すでに心臓から取れる**のに、配線が取り出して渡し、
// 返ってきた物を束へ詰め直して心臓へ戻していた（`npm run passthrough`）。
//
// **中身はここで作る。** 上で作って渡すと、囲いを描き直すたびに作り直される。
//
// ## 中身
//
// - `MediaDropValue` … `useMediaDrop` が返す物（**手で書かず実体から引く**）
// - `MediaDropProvider` … 囲い。中で `useMediaDrop()` を1回だけ呼ぶ
// - `useMediaDropCtx` … 見に行く。囲いの外で呼んだら、その場で落とす
import { createContext, useContext, type ReactNode } from 'react'
import { mediaInUse, staleSourceIds } from '../../../shared/mediaBin'
import { mediaQueue } from '../lib/schedule'
import { EXTRA_AUDIO_TRACK } from '../lib/trackState'
import { useDragPreviewCtx } from './dragPreviewContext'
import { useLaneGeometryCtx } from './laneGeometryContext'
import { useMediaMetaCtx } from './mediaMetaContext'
import { useSegmentPlaceCtx } from './segmentPlaceContext'
import { useSnapCtx } from './snapContext'
import { useTimelineBoxCtx } from './timelineBoxContext'
import { useTrackGeomCtx } from './trackGeomContext'
import { useTracksAdminCtx } from './tracksAdminContext'
import { useMediaDrop } from './useMediaDrop'

/** **手で書かない。** 作っている側から引く（ズレようがない） */
export type MediaDropValue = ReturnType<typeof useMediaDrop>

const Ctx = createContext<MediaDropValue | null>(null)

export function MediaDropProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { dragSeDurRef, draggingMediaRef, setImgGhost, setSeGhost, setVideoGhost, setSnapLineX } = useDragPreviewCtx()
  const { dropLaneAt } = useLaneGeometryCtx()
  const { mediaMetaRef, metaInFlightRef, setMediaMeta } = useMediaMetaCtx()
  const { placeVideoAtDrop } = useSegmentPlaceCtx()
  const { snapClipStart } = useSnapCtx()
  const { scrollRef, trackInnerRef } = useTimelineBoxCtx()
  const { cueTrack, pairedAudioOf, trackNum, vcLen } = useTrackGeomCtx()
  const { fallbackTrack, insertTrackOrdered, reserveTrackPairForVideo, trackFromEvent } = useTracksAdminCtx()
  const value = useMediaDrop({
    EXTRA_AUDIO_TRACK, dragSeDurRef, draggingMediaRef, dropLaneAt,
    fallbackTrack, cueTrack, insertTrackOrdered, mediaInUse, mediaMetaRef, mediaQueue,
    metaInFlightRef, pairedAudioOf, placeVideoAtDrop, reserveTrackPairForVideo,
    scrollRef, trackInnerRef, snapClipStart, staleSourceIds, trackFromEvent, trackNum,
    vcLen, setMediaMeta, setImgGhost, setSeGhost, setVideoGhost, setSnapLineX
  })
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** MediaDrop を見に行く。囲いの外で呼んだら、その場で落とす */
export function useMediaDropCtx(): MediaDropValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useMediaDropCtx は MediaDropProvider の中でしか使えません')
  return v
}
