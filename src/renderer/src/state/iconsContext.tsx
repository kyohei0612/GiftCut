// アイコンの出し方を、どの区画からでも触れるようにする。
// 置き場所の考え方は state/layoutContext.tsx と同じ。

import { createContext, useContext, type ReactNode } from 'react'
import { useIcons, type Icons } from './useIcons'

const Ctx = createContext<Icons | null>(null)

export function IconsProvider({ children }: { children: ReactNode }): React.JSX.Element {
  return <Ctx.Provider value={useIcons()}>{children}</Ctx.Provider>
}

/** アイコンの出し方を見に行く。囲いの外で呼んだら、その場で落とす */
export function useIconsCtx(): Icons {
  const v = useContext(Ctx)
  if (!v) throw new Error('useIconsCtx は IconsProvider の中でしか使えません')
  return v
}
