// コピーの控えを、どの区画からでも触れるようにする。
// 置き場所の考え方は state/layoutContext.tsx と同じ。

import { createContext, useContext, type ReactNode } from 'react'
import { useClipboard, type Clipboard } from './useClipboard'

export type { CopiedAttrs } from './useClipboard'

const Ctx = createContext<Clipboard | null>(null)

export function ClipboardProvider({ children }: { children: ReactNode }): React.JSX.Element {
  return <Ctx.Provider value={useClipboard()}>{children}</Ctx.Provider>
}

/** コピーの控えを見に行く。囲いの外で呼んだら、その場で落とす */
export function useClipboardCtx(): Clipboard {
  const v = useContext(Ctx)
  if (!v) throw new Error('useClipboardCtx は ClipboardProvider の中でしか使えません')
  return v
}
