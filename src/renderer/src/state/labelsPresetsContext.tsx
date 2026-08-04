// 色ラベルと見本の保存を、どの区画からでも触れるようにする。
//
// ## なぜ囲いにしたか（2026-08-04）
//
// 要る物が全部 心臓にあるのに、配線が呼んで各フックへ配っていた。
// **中身はここで作る**（上で作って渡すと、描き直すたびに作り直される）。
//
// ## 中身
//
// - `LabelsPresetsValue` … `useLabelsPresets` が返す物（**手で書かず実体から引く**）
// - `LabelsPresetsProvider` … 囲い。中で要る物を心臓から読んで1回だけ呼ぶ
// - `useLabelsPresetsCtx` … 見に行く。囲いの外で呼んだら、その場で落とす
import { createContext, useContext, type ReactNode } from 'react'
import { useLabelsPresets } from './useLabelsPresets'

/** **手で書かない。** 作っている側から引く（ズレようがない） */
export type LabelsPresetsValue = ReturnType<typeof useLabelsPresets>

const Ctx = createContext<LabelsPresetsValue | null>(null)

export function LabelsPresetsProvider({ children }: { children: ReactNode }): React.JSX.Element {
  return <Ctx.Provider value={useLabelsPresets()}>{children}</Ctx.Provider>
}

/** 色ラベルと見本の保存を見に行く。囲いの外で呼んだら、その場で落とす */
export function useLabelsPresetsCtx(): LabelsPresetsValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useLabelsPresetsCtx は LabelsPresetsProvider の中でしか使えません')
  return v
}
