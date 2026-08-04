// 本編の切片の並び（と、その「いまこの瞬間」用の写し）を、どの区画からでも触れるようにする。
//
// ## なぜ囲いにしたか（2026-08-04）
//
// `useSegLayout` が要るのは**切片の配列だけ**で、それは心臓（`useDoc`）にある。
// つまり配線を経由する理由が無いのに、`useAppWiring` が呼んで **12本のフックへ配って**いた。
// 上げると、その12本も順に上げられるようになる（`npm run passthrough` の「先を解く」）。
//
// **中身はここで作る。** 上で作って渡すと、囲いを描き直すたびに作り直される。
//
// ## 中身
//
// - `SegLayoutValue` … `useSegLayout` が返す物（**手で書かず実体から引く**）
// - `SegLayoutProvider` … 囲い。中で切片を心臓から読んで1回だけ呼ぶ
// - `useSegLayoutCtx` … 見に行く。囲いの外で呼んだら、その場で落とす
import { createContext, useContext, type ReactNode } from 'react'
import { useDoc } from './contentContext'
import { useSegLayout } from './useSegLayout'

/** **手で書かない。** 作っている側から引く（ズレようがない） */
export type SegLayoutValue = ReturnType<typeof useSegLayout>

const Ctx = createContext<SegLayoutValue | null>(null)

export function SegLayoutProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { segments } = useDoc()
  return <Ctx.Provider value={useSegLayout(segments)}>{children}</Ctx.Provider>
}

/** 切片の並びを見に行く。囲いの外で呼んだら、その場で落とす */
export function useSegLayoutCtx(): SegLayoutValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useSegLayoutCtx は SegLayoutProvider の中でしか使えません')
  return v
}
