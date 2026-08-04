// 重ねる動画の <video>を、どの区画からでも触れるようにする。
//
// ## なぜ囲いにしたか（2026-08-04）
//
// 要る物が全部 心臓にあるのに、配線が呼んで各フックへ配っていた。
// **中身はここで作る**（上で作って渡すと、描き直すたびに作り直される）。
//
// ## 中身
//
// - `VClipElsValue` … `useVClipEls` が返す物（**手で書かず実体から引く**）
// - `VClipElsProvider` … 囲い。中で要る物を心臓から読んで1回だけ呼ぶ
// - `useVClipElsCtx` … 見に行く。囲いの外で呼んだら、その場で落とす
import { createContext, useContext, type ReactNode } from 'react'
import { useDoc } from './contentContext'
import { usePlaybackCtx } from './playbackContext'
import { useTracksCtx } from './tracksContext'
import { useVClipEls } from './useVClipEls'

/** **手で書かない。** 作っている側から引く（ズレようがない） */
export type VClipElsValue = ReturnType<typeof useVClipEls>

const Ctx = createContext<VClipElsValue | null>(null)

export function VClipElsProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { vClips } = useDoc()
  const { currentTime } = usePlaybackCtx()
  const { tracks } = useTracksCtx()
  return <Ctx.Provider value={useVClipEls(vClips, currentTime, tracks)}>{children}</Ctx.Provider>
}

/** 重ねる動画の <video>を見に行く。囲いの外で呼んだら、その場で落とす */
export function useVClipElsCtx(): VClipElsValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useVClipElsCtx は VClipElsProvider の中でしか使えません')
  return v
}
