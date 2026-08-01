// 左パネル（プロパティ／モーション）が要る物の受け渡し。
//
// ## なぜ心臓を挟むか
//
// 左パネルは「選んでいる物の設定」を出す所なので、**アプリのほぼ全部**に
// 触れる。素直に渡すと26個の受け渡しが App の JSX に並び、そこを読むだけで
// 画面の組み立てが見えなくなる。
//
// 右パネル・プレビュー・タイムラインは既にこの形にしてあり、左だけが
// 取り残されていた。**4つの区画で受け渡し方が揃っていない**と、次に触る人が
// 「ここはどっちの流儀か」を毎回確かめることになる。
import { createContext, useContext } from 'react'
import type { LeftPanelProps } from '../components/LeftPanel'

export type LeftPanelValue = LeftPanelProps

const Ctx = createContext<LeftPanelValue | null>(null)

export function LeftPanelProvider({
  value,
  children
}: {
  value: LeftPanelValue
  children: React.ReactNode
}): React.JSX.Element {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useLeftPanel(): LeftPanelValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('LeftPanelProvider の外で useLeftPanel を呼んでいる')
  return v
}
