// ProjectTemplates を、どの区画からでも触れるようにする。
//
// ## なぜ囲いにしたか（2026-08-04）
//
// `useProjectTemplates` が要る物は**全部すでに心臓から取れる**のに、配線が取り出して渡し、
// 返ってきた物を束へ詰め直して心臓へ戻していた（`npm run passthrough`）。
//
// **中身はここで作る。** 上で作って渡すと、囲いを描き直すたびに作り直される。
//
// ## 中身
//
// - `ProjectTemplatesValue` … `useProjectTemplates` が返す物（**手で書かず実体から引く**）
// - `ProjectTemplatesProvider` … 囲い。中で `useProjectTemplates()` を1回だけ呼ぶ
// - `useProjectTemplatesCtx` … 見に行く。囲いの外で呼んだら、その場で落とす
import { createContext, useContext, type ReactNode } from 'react'
import { useAppLayoutCtx } from './appLayoutContext'
import { useAskCtx } from './askContext'
import { useLibraryCtx } from './libraryContext'
import { kindOf } from './useSegOps'
import { useProjectTemplates } from './useProjectTemplates'

/** **手で書かない。** 作っている側から引く（ズレようがない） */
export type ProjectTemplatesValue = ReturnType<typeof useProjectTemplates>

const Ctx = createContext<ProjectTemplatesValue | null>(null)

export function ProjectTemplatesProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { layoutNow, applyLayout } = useAppLayoutCtx()
  const { askText } = useAskCtx()
  const { saveLS } = useLibraryCtx()
  const value = useProjectTemplates({ kindOf, layoutNow, applyLayout, askText, saveLS })
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** ProjectTemplates を見に行く。囲いの外で呼んだら、その場で落とす */
export function useProjectTemplatesCtx(): ProjectTemplatesValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useProjectTemplatesCtx は ProjectTemplatesProvider の中でしか使えません')
  return v
}
