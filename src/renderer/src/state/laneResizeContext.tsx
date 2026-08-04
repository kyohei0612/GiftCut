// 段見出しの境目を掴んで高さを変えるを、どの区画からでも触れるようにする。
//
// ## なぜ囲いにしたか（2026-08-04）
//
// 要る物が全部 心臓にあるのに、配線が呼んで各フックへ配っていた。
// **中身はここで作る**（上で作って渡すと、描き直すたびに作り直される）。
//
// ## 中身
//
// - `LaneResizeValue` … `useLaneResize` が返す物（**手で書かず実体から引く**）
// - `LaneResizeProvider` … 囲い。中で要る物を心臓から読んで1回だけ呼ぶ
// - `useLaneResizeCtx` … 見に行く。囲いの外で呼んだら、その場で落とす
import { createContext, useContext, type ReactNode } from 'react'
import { useTrackGeomCtx } from './trackGeomContext'
import { useLaneHeightsCtx } from './laneHeightsContext'
import { useLaneResize } from './useLaneResize'

/** **手で書かない。** 作っている側から引く（ズレようがない） */
export type LaneResizeValue = ReturnType<typeof useLaneResize>

const Ctx = createContext<LaneResizeValue | null>(null)

export function LaneResizeProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { trackHOf } = useTrackGeomCtx()
  const { videoTrackHRef, audioTrackHRef, setVideoTrackH, setAudioTrackH, setLaneH } = useLaneHeightsCtx()
  return <Ctx.Provider value={useLaneResize({ trackHOf, videoTrackHRef, audioTrackHRef, setVideoTrackH, setAudioTrackH, setLaneH })}>{children}</Ctx.Provider>
}

/** 段見出しの境目を掴んで高さを変えるを見に行く。囲いの外で呼んだら、その場で落とす */
export function useLaneResizeCtx(): LaneResizeValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useLaneResizeCtx は LaneResizeProvider の中でしか使えません')
  return v
}
