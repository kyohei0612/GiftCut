// ProjectGuard を、どの区画からでも触れるようにする。
//
// ## なぜ囲いにしたか（2026-08-04）
//
// `useProjectGuard` が要る物は**全部すでに心臓から取れる**のに、配線が取り出して渡し、
// 返ってきた物を束へ詰め直して心臓へ戻していた（`npm run passthrough`）。
//
// **中身はここで作る。** 上で作って渡すと、囲いを描き直すたびに作り直される。
//
// ## 中身
//
// - `ProjectGuardValue` … `useProjectGuard` が返す物（**手で書かず実体から引く**）
// - `ProjectGuardProvider` … 囲い。中で `useProjectGuard()` を1回だけ呼ぶ
// - `useProjectGuardCtx` … 見に行く。囲いの外で呼んだら、その場で落とす
import { createContext, useContext, type ReactNode } from 'react'
import { RECENT_MAX } from '../lib/appConst'
import { useAskCtx } from './askContext'
import { useAutosaveMarkCtx } from './autosaveMarkContext'
import { useProjectGuard } from './useProjectGuard'

/** **手で書かない。** 作っている側から引く（ズレようがない） */
export type ProjectGuardValue = ReturnType<typeof useProjectGuard>

const Ctx = createContext<ProjectGuardValue | null>(null)

export function ProjectGuardProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { askConfirm } = useAskCtx()
  const { hasProjectContent, savedJsonRef, currentJsonRef } = useAutosaveMarkCtx()
  const value = useProjectGuard({
    hasProjectContent, savedJsonRef, currentJsonRef, askConfirm, recentMax: RECENT_MAX
  })
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** ProjectGuard を見に行く。囲いの外で呼んだら、その場で落とす */
export function useProjectGuardCtx(): ProjectGuardValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useProjectGuardCtx は ProjectGuardProvider の中でしか使えません')
  return v
}
