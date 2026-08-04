// TelopTemplate を、どの区画からでも触れるようにする。
//
// ## なぜ囲いにしたか（2026-08-04）
//
// `useTelopTemplate` が要る物は**全部すでに心臓から取れる**のに、配線が取り出して渡し、
// 返ってきた物を束へ詰め直して心臓へ戻していた（`npm run passthrough`）。
//
// **中身はここで作る。** 上で作って渡すと、囲いを描き直すたびに作り直される。
//
// ## 中身
//
// - `TelopTemplateValue` … `useTelopTemplate` が返す物（**手で書かず実体から引く**）
// - `TelopTemplateProvider` … 囲い。中で `useTelopTemplate()` を1回だけ呼ぶ
// - `useTelopTemplateCtx` … 見に行く。囲いの外で呼んだら、その場で落とす
import { createContext, useContext, type ReactNode } from 'react'
import { useAskCtx } from './askContext'
import { useSelectedCue } from './selectedCueContext'
import { useTelopLookCtx } from './telopLookContext'
import { useTelopTemplate } from './useTelopTemplate'

/** **手で書かない。** 作っている側から引く（ズレようがない） */
export type TelopTemplateValue = ReturnType<typeof useTelopTemplate>

const Ctx = createContext<TelopTemplateValue | null>(null)

export function TelopTemplateProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { askText } = useAskCtx()
  const { selected } = useSelectedCue()
  const { curSel, applyRunRange } = useTelopLookCtx()
  const value = useTelopTemplate({ askText, selected, curSel, applyRunRange })
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** TelopTemplate を見に行く。囲いの外で呼んだら、その場で落とす */
export function useTelopTemplateCtx(): TelopTemplateValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useTelopTemplateCtx は TelopTemplateProvider の中でしか使えません')
  return v
}
