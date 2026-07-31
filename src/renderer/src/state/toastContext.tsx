// 右下のお知らせを、どの区画からでも触れるようにする。
//
// 置き場所の考え方は state/layoutContext.tsx と同じ。
// **中身は入口（App）で作って渡す。** ここで作ると、囲いを描き直すたびに
// 作り直されて、持っていた値が消える。

import { createContext, useContext, type ReactNode } from 'react'
import type { Toaster } from './useToast'

const Ctx = createContext<Toaster | null>(null)

export function ToasterProvider({
  value,
  children
}: {
  value: Toaster
  children: ReactNode
}): React.JSX.Element {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** 右下のお知らせを見に行く。囲いの外で呼んだら、その場で落とす */
export function useToastCtx(): Toaster {
  const v = useContext(Ctx)
  if (!v) throw new Error('useToastCtx は ToasterProvider の中でしか使えません')
  return v
}
