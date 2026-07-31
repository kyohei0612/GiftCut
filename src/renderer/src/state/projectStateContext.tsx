// プロジェクトの持ち物と設定を、どの区画からでも触れるようにする。
//
// 置き場所の考え方は state/layoutContext.tsx と同じ。
// **中身は入口（App）で作って渡す**（囲いの中で作ると描き直しのたびに作り直される）。

import { createContext, useContext, type ReactNode } from 'react'
import type { ProjectState } from './useProjectState'

const Ctx = createContext<ProjectState | null>(null)

export function ProjectStateProvider({
  value,
  children
}: {
  value: ProjectState
  children: ReactNode
}): React.JSX.Element {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** プロジェクトの持ち物を見に行く。囲いの外で呼んだら、その場で落とす */
export function useProjectStateCtx(): ProjectState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useProjectStateCtx は ProjectStateProvider の中でしか使えません')
  return v
}
