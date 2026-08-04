// 段の高さ（種類ごと＋段ごと）を、どの区画からでも触れるようにする。
//
// ## なぜ囲いにしたか（2026-08-04）
//
// `useLaneHeights` は**引数を1つも取らない葉**なのに、`useAppWiring` が呼んで
// 各フックへ配り、束へ詰め直して心臓へ戻していた。**配るだけの名前は配線から消せる**
//（数え方と順番は `npm run passthrough`）。
//
// **中身はここで作る。** 上で作って渡す形にすると、囲いを描き直すたびに
// 作り直されて、持っていた値が消える。
//
// ## 中身
//
// - `LaneHeightsValue` … `useLaneHeights` が返す物（**手で書かず実体から引く**）
// - `LaneHeightsProvider` … 囲い。中で `useLaneHeights()` を1回だけ呼ぶ
// - `useLaneHeightsCtx` … 見に行く。囲いの外で呼んだら、その場で落とす
import { createContext, useContext, type ReactNode } from 'react'
import { useLaneHeights } from './useLaneHeights'

/** **手で書かない。** 作っている側から引く（ズレようがない） */
export type LaneHeightsValue = ReturnType<typeof useLaneHeights>

const Ctx = createContext<LaneHeightsValue | null>(null)

export function LaneHeightsProvider({ children }: { children: ReactNode }): React.JSX.Element {
  return <Ctx.Provider value={useLaneHeights()}>{children}</Ctx.Provider>
}

/** 段の高さ（種類ごと＋段ごと）を見に行く。囲いの外で呼んだら、その場で落とす */
export function useLaneHeightsCtx(): LaneHeightsValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useLaneHeightsCtx は LaneHeightsProvider の中でしか使えません')
  return v
}
