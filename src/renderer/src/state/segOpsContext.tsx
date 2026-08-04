// 切片の切り方・空きの作り方を、どの区画からでも触れるようにする。
//
// ## なぜ囲いにしたか（2026-08-04）
//
// 要る物が全部 心臓にあるのに、配線が呼んで各フックへ配っていた。
// 上げると、これを待っていたフックも順に上げられるようになる（`npm run passthrough`）。
//
// **中身はここで作る。** 上で作って渡すと、囲いを描き直すたびに作り直される。
//
// ## 中身
//
// - `SegOpsValue` … `useSegOps` が返す物（**手で書かず実体から引く**）
// - `SegOpsProvider` … 囲い。中で要る物を心臓から読んで1回だけ呼ぶ
// - `useSegOpsCtx` … 見に行く。囲いの外で呼んだら、その場で落とす
import { createContext, useContext, type ReactNode } from 'react'
import { useDoc } from './contentContext'
import { useSegOps } from './useSegOps'

/** **手で書かない。** 作っている側から引く（ズレようがない） */
export type SegOpsValue = ReturnType<typeof useSegOps>

const Ctx = createContext<SegOpsValue | null>(null)

export function SegOpsProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { segIdCounter } = useDoc()
  return <Ctx.Provider value={useSegOps({ segIdCounter })}>{children}</Ctx.Provider>
}

/** 切片の切り方・空きの作り方を見に行く。囲いの外で呼んだら、その場で落とす */
export function useSegOpsCtx(): SegOpsValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useSegOpsCtx は SegOpsProvider の中でしか使えません')
  return v
}
