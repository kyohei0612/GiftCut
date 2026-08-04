// 選んでいる物を書き換える操作を、どの区画からでも触れるようにする。
//
// ## なぜ囲いにしたか（2026-08-04）
//
// 要る物が全部 心臓にあるのに、配線が呼んで各フックへ配っていた。
// **中身はここで作る**（上で作って渡すと、描き直すたびに作り直される）。
//
// ## 中身
//
// - `EditValue` … `useEdit` が返す物（**手で書かず実体から引く**）
// - `EditProvider` … 囲い。中で要る物を心臓から読んで1回だけ呼ぶ
// - `useEditCtx` … 見に行く。囲いの外で呼んだら、その場で落とす
import { createContext, useContext, type ReactNode } from 'react'
import { useEdit } from './useEdit'

/** **手で書かない。** 作っている側から引く（ズレようがない） */
export type EditValue = ReturnType<typeof useEdit>

const Ctx = createContext<EditValue | null>(null)

export function EditProvider({ children }: { children: ReactNode }): React.JSX.Element {
  return <Ctx.Provider value={useEdit()}>{children}</Ctx.Provider>
}

/** 選んでいる物を書き換える操作を見に行く。囲いの外で呼んだら、その場で落とす */
export function useEditCtx(): EditValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useEditCtx は EditProvider の中でしか使えません')
  return v
}
