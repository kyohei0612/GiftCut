// 段の数え方・太さ・どの段に居るかを、どの区画からでも触れるようにする。
//
// ## なぜ囲いにしたか（2026-08-04）
//
// **これが配線でいちばん詰まっていた**——14本のフックがこれを待っていた
//（`npm run passthrough` の「何が来るのを待っているか」）。要る物は段（`useTracksCtx`）と
// 段の高さ（`./laneHeightsContext`）だけで、どちらも心臓にある。
//
// **中身はここで作る。** 上で作って渡すと、囲いを描き直すたびに作り直される。
//
// ## 中身
//
// - `TrackGeomValue` … `useTrackGeom` が返す物（**手で書かず実体から引く**）
// - `TrackGeomProvider` … 囲い。中で段と高さを心臓から読んで1回だけ呼ぶ
// - `useTrackGeomCtx` … 見に行く。囲いの外で呼んだら、その場で落とす
import { createContext, useContext, type ReactNode } from 'react'
import { useTracksCtx } from './tracksContext'
import { useLaneHeightsCtx } from './laneHeightsContext'
import { useTrackGeom } from './useTrackGeom'

/** **手で書かない。** 作っている側から引く（ズレようがない） */
export type TrackGeomValue = ReturnType<typeof useTrackGeom>

const Ctx = createContext<TrackGeomValue | null>(null)

export function TrackGeomProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { tracks, trackStates } = useTracksCtx()
  const { laneH, videoTrackH, audioTrackH } = useLaneHeightsCtx()
  const value = useTrackGeom({ tracks, trackStates, laneH, videoTrackH, audioTrackH })
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** 段の数え方・太さを見に行く。囲いの外で呼んだら、その場で落とす */
export function useTrackGeomCtx(): TrackGeomValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useTrackGeomCtx は TrackGeomProvider の中でしか使えません')
  return v
}
