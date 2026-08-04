// ExportRun を、どの区画からでも触れるようにする。
//
// ## なぜ囲いにしたか（2026-08-04）
//
// `useExport` が要る物は**全部すでに心臓から取れる**のに、配線が取り出して渡し、
// 返ってきた物を束へ詰め直して心臓へ戻していた（`npm run passthrough`）。
//
// **中身はここで作る。** 上で作って渡すと、囲いを描き直すたびに作り直される。
//
// ## 中身
//
// - `ExportRunValue` … `useExport` が返す物（**手で書かず実体から引く**）
// - `ExportRunProvider` … 囲い。中で `useExport()` を1回だけ呼ぶ
// - `useExportRunCtx` … 見に行く。囲いの外で呼んだら、その場で落とす
import { createContext, useContext, type ReactNode } from 'react'
import { useCueIcon } from './cueIconContext'
import { useExportCtx } from './exportContext'
import { useMediaCtx } from './mediaContext'
import { usePlaybackEngineCtx } from './playbackEngineContext'
import { useSilenceDuckCtx } from './silenceDuckContext'
import { useTimelineSpanCtx } from './timelineSpanContext'
import { useTrackGeomCtx } from './trackGeomContext'
import { useTracksAdminCtx } from './tracksAdminContext'
import { useExport } from './useExport'

/** **手で書かない。** 作っている側から引く（ズレようがない） */
export type ExportRunValue = ReturnType<typeof useExport>

const Ctx = createContext<ExportRunValue | null>(null)

export function ExportRunProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { iconForCue } = useCueIcon()
  const { resolveExportFps } = useExportCtx()
  const { srcOfSeg } = useMediaCtx()
  const { stopPlayback } = usePlaybackEngineCtx()
  const { duckEnv } = useSilenceDuckCtx()
  const { seEnd } = useTimelineSpanCtx()
  const { cueTrack } = useTrackGeomCtx()
  const { v1Hidden } = useTracksAdminCtx()
  const value = useExport({
    stopPlayback,
    srcOfSeg,
    cueTrack,
    iconForCue,
    resolveExportFps,
    duckEnv,
    seEnd,
    v1Hidden
  })
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** ExportRun を見に行く。囲いの外で呼んだら、その場で落とす */
export function useExportRunCtx(): ExportRunValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useExportRunCtx は ExportRunProvider の中でしか使えません')
  return v
}
