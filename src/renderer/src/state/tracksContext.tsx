// 段（トラック）と鍵を、どの区画からでも触れるようにする。
//
// 置き場所の考え方は state/layoutContext.tsx と同じ。
// **中身は入口（App）で作って渡す。** ここで作ると、囲いを描き直すたびに
// 作り直されて、持っていた値が消える。

import { createContext, useContext, type ReactNode } from 'react'
import type { Tracks } from './useTracks'

const Ctx = createContext<Tracks | null>(null)

export function TracksProvider({
  value,
  children
}: {
  value: Tracks
  children: ReactNode
}): React.JSX.Element {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** 段（トラック）と鍵を見に行く。囲いの外で呼んだら、その場で落とす */
export function useTracksCtx(): Tracks {
  const v = useContext(Ctx)
  if (!v) throw new Error('useTracksCtx は TracksProvider の中でしか使えません')
  return v
}
