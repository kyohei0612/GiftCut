// タイムラインの中身を、どの区画からでも触れるようにする。
// 置き場所の考え方は state/layoutContext.tsx と同じ。

import { createContext, useContext, type ReactNode } from 'react'
import { useContent, type Content } from './useContent'

const Ctx = createContext<Content | null>(null)

export function ContentProvider({ children }: { children: ReactNode }): React.JSX.Element {
  return <Ctx.Provider value={useContent()}>{children}</Ctx.Provider>
}

/** 中身を見に行く。囲いの外で呼んだら、その場で落とす */
export function useDoc(): Content {
  const v = useContext(Ctx)
  if (!v) throw new Error('useDoc は ContentProvider の中でしか使えません')
  return v
}
