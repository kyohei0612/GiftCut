// ProjectIO を、どの区画からでも触れるようにする。
//
// ## なぜ囲いにしたか（2026-08-04）
//
// `useProjectIO` が要る物は**全部すでに心臓から取れる**のに、配線が取り出して渡し、
// 返ってきた物を束へ詰め直して心臓へ戻していた（`npm run passthrough`）。
//
// **中身はここで作る。** 上で作って渡すと、囲いを描き直すたびに作り直される。
//
// ## 中身
//
// - `ProjectIOValue` … `useProjectIO` が返す物（**手で書かず実体から引く**）
// - `ProjectIOProvider` … 囲い。中で `useProjectIO()` を1回だけ呼ぶ
// - `useProjectIOCtx` … 見に行く。囲いの外で呼んだら、その場で落とす
import { createContext, useContext, type ReactNode } from 'react'
import { mediaQueue } from '../lib/schedule'
import { useAppChromeCtx } from './appChromeContext'
import { useAskCtx } from './askContext'
import { useAutosaveMarkCtx } from './autosaveMarkContext'
import { useMediaMetaCtx } from './mediaMetaContext'
import { useMediaOpsCtx } from './mediaOpsContext'
import { useProjectFileCtx } from './projectFileContext'
import { useProjectGuardCtx } from './projectGuardContext'
import { useProjectStateCtx } from './projectStateContext'
import { useProjectIO } from './useProjectIO'

/** **手で書かない。** 作っている側から引く（ズレようがない） */
export type ProjectIOValue = ReturnType<typeof useProjectIO>

const Ctx = createContext<ProjectIOValue | null>(null)

export function ProjectIOProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { packBusyRef, setPackPct } = useAppChromeCtx()
  const { askConfirm } = useAskCtx()
  const { autosaveNgRef, autosavedRevRef, lastAutosaveRef, setAutosaveNg } = useAutosaveMarkCtx()
  const { thumbDoneRef } = useMediaMetaCtx()
  const { loadVideo, registerSource, addMediaPaths } = useMediaOpsCtx()
  const { projectJson, applyProjectData } = useProjectFileCtx()
  const { confirmDiscard, rememberProject } = useProjectGuardCtx()
  const { projectPath } = useProjectStateCtx()
  const value = useProjectIO({
    projectPath, projectJson,
    applyProjectData, askConfirm, loadVideo, registerSource, addMediaPaths,
    mediaQueue, thumbDoneRef, packBusyRef, setPackPct, autosaveNgRef, autosavedRevRef,
    lastAutosaveRef, setAutosaveNg, confirmDiscard, rememberProject
  })
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** ProjectIO を見に行く。囲いの外で呼んだら、その場で落とす */
export function useProjectIOCtx(): ProjectIOValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useProjectIOCtx は ProjectIOProvider の中でしか使えません')
  return v
}
