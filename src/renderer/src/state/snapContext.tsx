// マグネット（吸着）を、どの区画からでも触れるようにする。
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
// - `SnapValue` … `useSnap` が返す物（**手で書かず実体から引く**）
// - `SnapProvider` … 囲い。中で要る物を心臓から読んで1回だけ呼ぶ
// - `useSnapCtx` … 見に行く。囲いの外で呼んだら、その場で落とす
import { createContext, useContext, type ReactNode } from 'react'
import { useAppChromeCtx } from './appChromeContext'
import { useSegLayoutCtx } from './segLayoutContext'
import { useSnap } from './useSnap'

/** **手で書かない。** 作っている側から引く（ズレようがない） */
export type SnapValue = ReturnType<typeof useSnap>

const Ctx = createContext<SnapValue | null>(null)

export function SnapProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { snap } = useAppChromeCtx()
  const { segLayoutRef } = useSegLayoutCtx()
  return <Ctx.Provider value={useSnap({ snap, segLayoutRef })}>{children}</Ctx.Provider>
}

/** マグネット（吸着）を見に行く。囲いの外で呼んだら、その場で落とす */
export function useSnapCtx(): SnapValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useSnapCtx は SnapProvider の中でしか使えません')
  return v
}
