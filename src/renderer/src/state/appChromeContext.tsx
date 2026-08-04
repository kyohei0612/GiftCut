// 画面の枠まわりの小さな状態（品書き・道具・マグネット・版）を、どの区画からでも触れるようにする。
//
// ## なぜ囲いにしたか（2026-08-04）
//
// `useAppChrome` は**引数を1つも取らない葉**なのに、`useAppWiring` が呼んで
// 各フックへ配り、束へ詰め直して心臓へ戻していた。**配るだけの名前は配線から消せる**
//（数え方と順番は `npm run passthrough`）。
//
// **中身はここで作る。** 上で作って渡す形にすると、囲いを描き直すたびに
// 作り直されて、持っていた値が消える。
//
// ## 中身
//
// - `AppChromeValue` … `useAppChrome` が返す物（**手で書かず実体から引く**）
// - `AppChromeProvider` … 囲い。中で `useAppChrome()` を1回だけ呼ぶ
// - `useAppChromeCtx` … 見に行く。囲いの外で呼んだら、その場で落とす
import { createContext, useContext, type ReactNode } from 'react'
import { useAppChrome } from './useAppChrome'

/** **手で書かない。** 作っている側から引く（ズレようがない） */
export type AppChromeValue = ReturnType<typeof useAppChrome>

const Ctx = createContext<AppChromeValue | null>(null)

export function AppChromeProvider({ children }: { children: ReactNode }): React.JSX.Element {
  return <Ctx.Provider value={useAppChrome()}>{children}</Ctx.Provider>
}

/** 画面の枠まわりの小さな状態（品書き・道具・マグネット・版）を見に行く。囲いの外で呼んだら、その場で落とす */
export function useAppChromeCtx(): AppChromeValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAppChromeCtx は AppChromeProvider の中でしか使えません')
  return v
}
