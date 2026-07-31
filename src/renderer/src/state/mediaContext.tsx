// 素材と元動画を、どの区画からでも触れるようにする。
// 置き場所の考え方は state/layoutContext.tsx と同じ。

import { createContext, useContext, type ReactNode } from 'react'
import { useMedia, type Media } from './useMedia'

const Ctx = createContext<Media | null>(null)

export function MediaProvider({ children }: { children: ReactNode }): React.JSX.Element {
  return <Ctx.Provider value={useMedia()}>{children}</Ctx.Provider>
}

/** 素材と元動画を見に行く。囲いの外で呼んだら、その場で落とす */
export function useMediaCtx(): Media {
  const v = useContext(Ctx)
  if (!v) throw new Error('useMediaCtx は MediaProvider の中でしか使えません')
  return v
}
