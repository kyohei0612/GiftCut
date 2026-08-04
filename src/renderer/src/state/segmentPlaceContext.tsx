// SegmentPlace を、どの区画からでも触れるようにする。
//
// ## なぜ囲いにしたか（2026-08-04）
//
// `useSegmentPlace` が要る物は**全部すでに心臓から取れる**のに、配線が取り出して渡し、
// 返ってきた物を束へ詰め直して心臓へ戻していた（`npm run passthrough`）。
//
// **中身はここで作る。** 上で作って渡すと、囲いを描き直すたびに作り直される。
//
// ## 中身
//
// - `SegmentPlaceValue` … `useSegmentPlace` が返す物（**手で書かず実体から引く**）
// - `SegmentPlaceProvider` … 囲い。中で `useSegmentPlace()` を1回だけ呼ぶ
// - `useSegmentPlaceCtx` … 見に行く。囲いの外で呼んだら、その場で落とす
import { createContext, useContext, type ReactNode } from 'react'
import { useContentShiftCtx } from './contentShiftContext'
import { useMediaOpsCtx } from './mediaOpsContext'
import { useSegOpsCtx } from './segOpsContext'
import { useTracksAdminCtx } from './tracksAdminContext'
import { useSegmentPlace } from './useSegmentPlace'

/** **手で書かない。** 作っている側から引く（ズレようがない） */
export type SegmentPlaceValue = ReturnType<typeof useSegmentPlace>

const Ctx = createContext<SegmentPlaceValue | null>(null)

export function SegmentPlaceProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { shiftAfter } = useContentShiftCtx()
  const { loadVideo, registerSource } = useMediaOpsCtx()
  const { segOps, segSplit } = useSegOpsCtx()
  const { mainLocked } = useTracksAdminCtx()
  const value = useSegmentPlace({
    mainLocked, segOps, segSplit, shiftAfter, loadVideo, registerSource
  })
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** SegmentPlace を見に行く。囲いの外で呼んだら、その場で落とす */
export function useSegmentPlaceCtx(): SegmentPlaceValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useSegmentPlaceCtx は SegmentPlaceProvider の中でしか使えません')
  return v
}
