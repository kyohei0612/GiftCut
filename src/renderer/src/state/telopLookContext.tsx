// テロップの見た目（全体／選んだ文字だけ）を、どの区画からでも触れるようにする。
//
// ## なぜ囲いにしたか（2026-08-04）
//
// 要る物が全部 心臓にあるのに、配線が呼んで各フックへ配っていた。
// **中身はここで作る**（上で作って渡すと、描き直すたびに作り直される）。
//
// ## 中身
//
// - `TelopLookValue` … `useTelopLook` が返す物（**手で書かず実体から引く**）
// - `TelopLookProvider` … 囲い。中で要る物を心臓から読んで1回だけ呼ぶ
// - `useTelopLookCtx` … 見に行く。囲いの外で呼んだら、その場で落とす
import { createContext, useContext, type ReactNode } from 'react'
import { useTelopLook } from './useTelopLook'

/** **手で書かない。** 作っている側から引く（ズレようがない） */
export type TelopLookValue = ReturnType<typeof useTelopLook>

const Ctx = createContext<TelopLookValue | null>(null)

export function TelopLookProvider({ children }: { children: ReactNode }): React.JSX.Element {
  return <Ctx.Provider value={useTelopLook()}>{children}</Ctx.Provider>
}

/** テロップの見た目（全体／選んだ文字だけ）を見に行く。囲いの外で呼んだら、その場で落とす */
export function useTelopLookCtx(): TelopLookValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useTelopLookCtx は TelopLookProvider の中でしか使えません')
  return v
}
