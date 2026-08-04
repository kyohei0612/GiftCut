// 帯になる物を運んでいる最中の持ち物を、どの区画からでも触れるようにする。
//
// ## なぜ囲いにしたか（2026-08-04）
//
// `useBandDrag` は**引数を1つも取らない葉**なのに、`useAppWiring` が呼んで
// 各フックへ配り、束へ詰め直して心臓へ戻していた。**配るだけの名前は配線から消せる**
//（数え方と順番は `npm run passthrough`）。
//
// **中身はここで作る。** 上で作って渡す形にすると、囲いを描き直すたびに
// 作り直されて、持っていた値が消える。
//
// ## 中身
//
// - `BandDragValue` … `useBandDrag` が返す物（**手で書かず実体から引く**）
// - `BandDragProvider` … 囲い。中で `useBandDrag()` を1回だけ呼ぶ
// - `useBandDragCtx` … 見に行く。囲いの外で呼んだら、その場で落とす
import { createContext, useContext, type ReactNode } from 'react'
import { useBandDrag } from './useBandDrag'

/** **手で書かない。** 作っている側から引く（ズレようがない） */
export type BandDragValue = ReturnType<typeof useBandDrag>

const Ctx = createContext<BandDragValue | null>(null)

export function BandDragProvider({ children }: { children: ReactNode }): React.JSX.Element {
  return <Ctx.Provider value={useBandDrag()}>{children}</Ctx.Provider>
}

/** 帯になる物を運んでいる最中の持ち物を見に行く。囲いの外で呼んだら、その場で落とす */
export function useBandDragCtx(): BandDragValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useBandDragCtx は BandDragProvider の中でしか使えません')
  return v
}
