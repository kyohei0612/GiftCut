// Markers を、どの区画からでも触れるようにする。
//
// ## なぜ囲いにしたか（2026-08-04）
//
// `useMarkers` が要る物は**全部すでに心臓から取れる**のに、配線が取り出して渡し、
// 返ってきた物を束へ詰め直して心臓へ戻していた（`npm run passthrough`）。
//
// **中身はここで作る。** 上で作って渡すと、囲いを描き直すたびに作り直される。
//
// ## 中身
//
// - `MarkersValue` … `useMarkers` が返す物（**手で書かず実体から引く**）
// - `MarkersProvider` … 囲い。中で `useMarkers()` を1回だけ呼ぶ
// - `useMarkersCtx` … 見に行く。囲いの外で呼んだら、その場で落とす
import { createContext, useContext, type ReactNode } from 'react'
import { usePlaybackEngineCtx } from './playbackEngineContext'
import { useSnapCtx } from './snapContext'
import { useMarkers } from './useMarkers'

/** **手で書かない。** 作っている側から引く（ズレようがない） */
export type MarkersValue = ReturnType<typeof useMarkers>

const Ctx = createContext<MarkersValue | null>(null)

export function MarkersProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { stopPlayback, seekTo, seekAndReveal } = usePlaybackEngineCtx()
  const { snapTime } = useSnapCtx()
  const value = useMarkers({
    stopPlayback, seekTo, seekAndReveal, snapTime
  })
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** Markers を見に行く。囲いの外で呼んだら、その場で落とす */
export function useMarkersCtx(): MarkersValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useMarkersCtx は MarkersProvider の中でしか使えません')
  return v
}
