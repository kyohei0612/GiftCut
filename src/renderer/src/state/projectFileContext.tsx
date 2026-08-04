// ProjectFile を、どの区画からでも触れるようにする。
//
// ## なぜ囲いにしたか（2026-08-04）
//
// `useProjectFile` が要る物は**全部すでに心臓から取れる**のに、配線が取り出して渡し、
// 返ってきた物を束へ詰め直して心臓へ戻していた（`npm run passthrough`）。
//
// **中身はここで作る。** 上で作って渡すと、囲いを描き直すたびに作り直される。
//
// ## 中身
//
// - `ProjectFileValue` … `useProjectFile` が返す物（**手で書かず実体から引く**）
// - `ProjectFileProvider` … 囲い。中で `useProjectFile()` を1回だけ呼ぶ
// - `useProjectFileCtx` … 見に行く。囲いの外で呼んだら、その場で落とす
import { createContext, useContext, type ReactNode } from 'react'
import { useAppChromeCtx } from './appChromeContext'
import { useAppLayoutCtx } from './appLayoutContext'
import { useAutosaveMarkCtx } from './autosaveMarkContext'
import { useHistoryCtx } from './historyContext'
import { useLibraryCtx } from './libraryContext'
import { useMediaDropCtx } from './mediaDropContext'
import { useMediaOpsCtx } from './mediaOpsContext'
import { usePlaybackEngineCtx } from './playbackEngineContext'
import { useProjectGuardCtx } from './projectGuardContext'
import { useTracksAdminCtx } from './tracksAdminContext'
import { useVideoElsCtx } from './videoElsContext'
import { useProjectFile } from './useProjectFile'

/** **手で書かない。** 作っている側から引く（ズレようがない） */
export type ProjectFileValue = ReturnType<typeof useProjectFile>

const Ctx = createContext<ProjectFileValue | null>(null)

export function ProjectFileProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { idCounter, initializedForPathRef, proxyForPathRef } = useAppChromeCtx()
  const { applyLayout, layoutNow } = useAppLayoutCtx()
  const { hasProjectContent, savedJsonRef, projectJsonRef, markUnsavedRef, lastAutosaveRef } = useAutosaveMarkCtx()
  const { setTime, snapNow, resetHistory, commitPending, baselineRef } = useHistoryCtx()
  const { saveLS } = useLibraryCtx()
  const { prepareMediaMeta } = useMediaDropCtx()
  const { hydrateSource, updateSource } = useMediaOpsCtx()
  const { stopPlayback } = usePlaybackEngineCtx()
  const { confirmDiscard, rememberProject } = useProjectGuardCtx()
  const { fallbackTrack } = useTracksAdminCtx()
  const { videoElsRef, videoRef } = useVideoElsCtx()
  const value = useProjectFile({
    stopPlayback, setTime, fallbackTrack, applyLayout, layoutNow, snapNow,
    resetHistory, confirmDiscard, hasProjectContent, rememberProject,
    prepareMediaMeta, commitPending, idCounter, savedJsonRef, projectJsonRef,
    markUnsavedRef, lastAutosaveRef, initializedForPathRef, proxyForPathRef,
    videoElsRef, videoRef, saveLS, baselineRef, hydrateSource,
    updateSource
  })
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** ProjectFile を見に行く。囲いの外で呼んだら、その場で落とす */
export function useProjectFileCtx(): ProjectFileValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useProjectFileCtx は ProjectFileProvider の中でしか使えません')
  return v
}
