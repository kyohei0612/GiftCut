// 再生の「今」を、どの区画からでも触れるようにする。
//
// 置き場所の考え方は state/layoutContext.tsx と同じ。
// **中身は入口（App）で作って渡す**（囲いの中で作ると描き直しのたびに作り直される）。

import { createContext, useContext, type ReactNode } from 'react'
import type { Playback } from './usePlayback'

const Ctx = createContext<Playback | null>(null)

export function PlaybackProvider({
  value,
  children
}: {
  value: Playback
  children: ReactNode
}): React.JSX.Element {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** 再生の「今」を見に行く。囲いの外で呼んだら、その場で落とす */
export function usePlaybackCtx(): Playback {
  const v = useContext(Ctx)
  if (!v) throw new Error('usePlaybackCtx は PlaybackProvider の中でしか使えません')
  return v
}
