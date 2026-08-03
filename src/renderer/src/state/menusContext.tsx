// 右クリックで出る品書きが要る物の受け渡し。
//
// ## なぜ心臓を挟むか
//
// 品書きは「その場で何ができるか」を並べる所なので、**編集の入口をほぼ全部**
// 呼ぶ。素直に渡すと50個以上の受け渡しが App の JSX に並び、そこを読むだけで
// 画面の組み立てが見えなくなる。区画（左・右・プレビュー・タイムライン）は
// すでにこの形なので、品書きだけ流儀が違う状態だった。
//
// ## 型はここに置く
//
// 2026-08-03 まで `MenusValue` は `components/AppMenus` の `AppMenusProps` を
// 輸入していた。**心臓が部品から型を借りる逆向き**で、しかも AppMenus は
// props を1つも受け取っていない（＝「Props」という名前が実体と合っていない）。
// 品書きの中身を3つに割ったとき、借りる先が無くなるのでこちらへ移した。
import { createContext, useContext } from 'react'

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface MenusValue {
  /** いま開いている品書き（どれも「開いていなければ null」） */
  menu: any
  setMenu: any
  clipMenu: any
  setClipMenu: any
  tabMenu: any
  setTabMenu: any
  tabOverflow: any
  setTabOverflow: any
  tplMenu: any
  setTplMenu: any
  orgMenu: any
  setOrgMenu: any
  /** 画面の端からはみ出さない位置へ寄せる */
  clampMenu: any
  /** 区画（パネル）まわり */
  PANE_LABEL: Record<string, string>
  TAB_DEFS: any
  orderedTabs: any
  pickTab: any
  setTabOrder: any
  isPopped: (id: any) => boolean
  popPane: any
  unpopPane: any
  monitorTab: string
  rightTab: string
  /** テロップのフォルダ（カテゴリ）まわり */
  allCats: any
  customCats: any
  setTplCat: any
  isFav: any
  toggleFav: any
  /** ラベル色 */
  setLabelFor: any
  selectByLabel: any
  setClipLabel: any
  /** 編集の操作 */
  deleteSelected: any
  rippleDeleteSelected: any
  deleteSelectedSE: any
  deleteSelectedImg: any
  deleteSelectedVClip: any
  deleteVideoSegmentsLeavingGap: any
  rippleDeleteVideoSegments: any
  duplicateClipsFromMenu: any
  splitVideoAtPlayhead: any
  toggleBlankSelectedVideo: any
  findSilences: any
  silenceCut: any
  setDuckOpen: any
  /** コピーと貼り付け */
  copySelected: any
  copyAttributes: any
  pasteAttributes: any
  copiedAttrs: any
  attrSummary: any
  /** キーの割り当て（品書きに出す） */
  shortcuts: any
}
/* eslint-enable @typescript-eslint/no-explicit-any */

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
