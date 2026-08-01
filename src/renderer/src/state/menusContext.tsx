// 右クリックで出る品書きが要る物の受け渡し。
//
// ## なぜ心臓を挟むか
//
// 品書きは「その場で何ができるか」を並べる所なので、**編集の入口をほぼ全部**
// 呼ぶ。素直に渡すと50個以上の受け渡しが App の JSX に並び、そこを読むだけで
// 画面の組み立てが見えなくなる。区画（左・右・プレビュー・タイムライン）は
// すでにこの形なので、品書きだけ流儀が違う状態だった。
import { createContext, useContext } from 'react'
import type { AppMenusProps } from '../components/AppMenus'

export type MenusValue = AppMenusProps

const Ctx = createContext<MenusValue | null>(null)

export function MenusProvider({
  value,
  children
}: {
  value: MenusValue
  children: React.ReactNode
}): React.JSX.Element {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useMenus(): MenusValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('MenusProvider の外で useMenus を呼んでいる')
  return v
}
