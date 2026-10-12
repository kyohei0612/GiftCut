// 画像の背景を透過する（切り抜き）を、どの区画からでも触れるようにする。
//
// ## なぜ囲いにしたか（2026-08-04）
//
// `useCutout` は**引数を1つも取らない葉**なのに、`useAppWiring` が呼んで
// 各フックへ配り、束へ詰め直して心臓へ戻していた。**配るだけの名前は配線から消せる**
//（数え方と順番は `npm run passthrough`）。
//
// **中身はここで作る。** 上で作って渡す形にすると、囲いを描き直すたびに
// 作り直されて、持っていた値が消える。
//
// ## 中身
//
// - `CutoutValue` … `useCutout` が返す物（**手で書かず実体から引く**）
// - `CutoutProvider` … 囲い。中で `useCutout()` を1回だけ呼ぶ
// - `useCutoutCtx` … 見に行く。囲いの外で呼んだら、その場で落とす
import { createContext, useContext, type ReactNode } from 'react'
import { useCutout } from './useCutout'

/** **手で書かない。** 作っている側から引く（ズレようがない） */
export type CutoutValue = ReturnType<typeof useCutout>

const Ctx = createContext<CutoutValue | null>(null)

export function CutoutProvider({ children }: { children: ReactNode }): React.JSX.Element {
  return <Ctx.Provider value={useCutout()}>{children}</Ctx.Provider>
}

/** 画像の背景を透過する（切り抜き）を見に行く。囲いの外で呼んだら、その場で落とす */
export function useCutoutCtx(): CutoutValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useCutoutCtx は CutoutProvider の中でしか使えません')
  return v
}
