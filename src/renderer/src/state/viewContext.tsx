// タイムラインの見え方（拡大率）を、どの区画からでも触れるようにする。
//
// 置き場所の考え方は state/layoutContext.tsx と同じ。
// **中身は入口（App）で作って渡す。** ここで作ると、囲いを描き直すたびに
// 作り直されて、持っていた値が消える。

import { createContext, useContext, type ReactNode } from 'react'
import type { View } from './useView'

const Ctx = createContext<View | null>(null)

export function ViewProvider({
  value,
  children
}: {
  value: View
  children: ReactNode
}): React.JSX.Element {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** タイムラインの見え方（拡大率）を見に行く。囲いの外で呼んだら、その場で落とす */
export function useViewCtx(): View {
  const v = useContext(Ctx)
  if (!v) throw new Error('useViewCtx は ViewProvider の中でしか使えません')
  return v
}
