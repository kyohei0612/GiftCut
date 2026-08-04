// IconLibrary を、どの区画からでも触れるようにする。
//
// ## なぜ囲いにしたか（2026-08-04）
//
// `useIconLibrary` が要る物は**全部すでに心臓から取れる**のに、配線が取り出して渡し、
// 返ってきた物を束へ詰め直して心臓へ戻していた（`npm run passthrough`）。
//
// **中身はここで作る。** 上で作って渡すと、囲いを描き直すたびに作り直される。
//
// ## 中身
//
// - `IconLibraryValue` … `useIconLibrary` が返す物（**手で書かず実体から引く**）
// - `IconLibraryProvider` … 囲い。中で `useIconLibrary()` を1回だけ呼ぶ
// - `useIconLibraryCtx` … 見に行く。囲いの外で呼んだら、その場で落とす
import { createContext, useContext, type ReactNode } from 'react'
import { useLibraryCtx } from './libraryContext'
import { usePlaybackEngineCtx } from './playbackEngineContext'
import { useProjectStateCtx } from './projectStateContext'
import { useSelectedCue } from './selectedCueContext'
import { useTelopBoxCtx } from './telopBoxContext'
import { useTimelineBoxCtx } from './timelineBoxContext'
import { useIconLibrary } from './useIconLibrary'

/** **手で書かない。** 作っている側から引く（ズレようがない） */
export type IconLibraryValue = ReturnType<typeof useIconLibrary>

const Ctx = createContext<IconLibraryValue | null>(null)

export function IconLibraryProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { setIconOv, setIconFavs, setOpenAccSec, saveLS } = useLibraryCtx()
  const { seekTo, stopPlayback } = usePlaybackEngineCtx()
  const { setIconAssignState, setLaneIconAssign } = useProjectStateCtx()
  const { selected } = useSelectedCue()
  const { applyIconAutoLeft } = useTelopBoxCtx()
  const { screenRef } = useTimelineBoxCtx()
  const value = useIconLibrary({
    setIconAssignState, setLaneIconAssign,
    setIconOv, setIconFavs, applyIconAutoLeft, setOpenAccSec, saveLS, screenRef,
    seekTo, stopPlayback, selected
  })
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** IconLibrary を見に行く。囲いの外で呼んだら、その場で落とす */
export function useIconLibraryCtx(): IconLibraryValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useIconLibraryCtx は IconLibraryProvider の中でしか使えません')
  return v
}
