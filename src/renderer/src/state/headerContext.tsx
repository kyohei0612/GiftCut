// 画面のいちばん上（更新の帯とメニューバー）が要る物の受け渡し。
//
// メニューバーは「ファイル」「編集」…の中身をすべて呼ぶので、素直に渡すと
// 24個の受け渡しが App の JSX に並ぶ。区画・品書きと同じ流儀に揃えてある。
import { createContext, useContext } from 'react'
// **部品の props 型に別名付けしない。** あちらの `[k: string]: any` が
// そのまま抜け道になり、束から名前を外しても型検査が1件も出なかった
//（2026-08-04。決まりは shared/ctxTypes.test.ts の R4）
import type { Wired } from './wiredValue'

export type HeaderValue = Wired<'header'>

const Ctx = createContext<HeaderValue | null>(null)

export function HeaderProvider({
  value,
  children
}: {
  value: HeaderValue
  children: React.ReactNode
}): React.JSX.Element {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useHeader(): HeaderValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('HeaderProvider の外で useHeader を呼んでいる')
  return v
}
