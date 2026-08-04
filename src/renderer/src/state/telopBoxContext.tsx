// TelopBox を、どの区画からでも触れるようにする。
//
// ## なぜ囲いにしたか（2026-08-04）
//
// `useTelopBox` が要る物は**全部すでに心臓から取れる**のに、配線が取り出して渡し、
// 返ってきた物を束へ詰め直して心臓へ戻していた（`npm run passthrough`）。
//
// **中身はここで作る。** 上で作って渡すと、囲いを描き直すたびに作り直される。
//
// ## 中身
//
// - `TelopBoxValue` … `useTelopBox` が返す物（**手で書かず実体から引く**）
// - `TelopBoxProvider` … 囲い。中で `useTelopBox()` を1回だけ呼ぶ
// - `useTelopBoxCtx` … 見に行く。囲いの外で呼んだら、その場で落とす
import { createContext, useContext, type ReactNode } from 'react'
import { useIconsCtx } from './iconsContext'
import { usePlaybackEngineCtx } from './playbackEngineContext'
import { useTimelineBoxCtx } from './timelineBoxContext'
import { useTracksAdminCtx } from './tracksAdminContext'
import { useTelopBox } from './useTelopBox'

/** **手で書かない。** 作っている側から引く（ズレようがない） */
export type TelopBoxValue = ReturnType<typeof useTelopBox>

const Ctx = createContext<TelopBoxValue | null>(null)

export function TelopBoxProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { iconAuto, setIconAnchorPos } = useIconsCtx()
  const { stopPlayback, seekTo } = usePlaybackEngineCtx()
  const { screenRef } = useTimelineBoxCtx()
  const { telopLocked } = useTracksAdminCtx()
  const value = useTelopBox({
    screenRef,
    telopLocked,
    stopPlayback,
    seekTo,
    iconAuto,
    setIconAnchorPos
  })
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** TelopBox を見に行く。囲いの外で呼んだら、その場で落とす */
export function useTelopBoxCtx(): TelopBoxValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useTelopBoxCtx は TelopBoxProvider の中でしか使えません')
  return v
}
