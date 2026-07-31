// 選んでいる物を、どの区画からでも触れるようにする。
//
// 置き場所の考え方は state/layoutContext.tsx と同じ。
// 区画は props で受け取らず、`useSel()` で自分から見に行く。

import { createContext, useContext, type ReactNode } from 'react'
import { useSelection, type Selection } from './useSelection'

const Ctx = createContext<Selection | null>(null)

export function SelectionProvider({ children }: { children: ReactNode }): React.JSX.Element {
  return <Ctx.Provider value={useSelection()}>{children}</Ctx.Provider>
}

/** 選んでいる物を見に行く。囲いの外で呼んだら、その場で落とす */
export function useSel(): Selection {
  const v = useContext(Ctx)
  if (!v) throw new Error('useSel は SelectionProvider の中でしか使えません')
  return v
}
