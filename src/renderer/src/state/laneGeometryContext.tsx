// LaneGeometry を、どの区画からでも触れるようにする。
//
// ## なぜ囲いにしたか（2026-08-04）
//
// `useLaneGeometry` が要る物は**全部すでに心臓から取れる**のに、配線が取り出して渡し、
// 返ってきた物を束へ詰め直して心臓へ戻していた（`npm run passthrough`）。
//
// **中身はここで作る。** 上で作って渡すと、囲いを描き直すたびに作り直される。
//
// ## 中身
//
// - `LaneGeometryValue` … `useLaneGeometry` が返す物（**手で書かず実体から引く**）
// - `LaneGeometryProvider` … 囲い。中で `useLaneGeometry()` を1回だけ呼ぶ
// - `useLaneGeometryCtx` … 見に行く。囲いの外で呼んだら、その場で落とす
import { createContext, useContext, type ReactNode } from 'react'
import { RULER_H } from '../lib/appConst'
import { useLaneHeightsCtx } from './laneHeightsContext'
import { useLaneGeometry } from './useLaneGeometry'

/** **手で書かない。** 作っている側から引く（ズレようがない） */
export type LaneGeometryValue = ReturnType<typeof useLaneGeometry>

const Ctx = createContext<LaneGeometryValue | null>(null)

export function LaneGeometryProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { videoTrackHRef, audioTrackHRef, padTop } = useLaneHeightsCtx()
  const value = useLaneGeometry({
    videoTrackHRef,
    audioTrackHRef,
    topOffset: RULER_H + padTop
  })
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** LaneGeometry を見に行く。囲いの外で呼んだら、その場で落とす */
export function useLaneGeometryCtx(): LaneGeometryValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useLaneGeometryCtx は LaneGeometryProvider の中でしか使えません')
  return v
}
