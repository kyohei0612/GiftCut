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
import type { Wired } from './wiredValue'

// 型は手で書かず、詰めている実体から引く。**なぜ・どう腐らないかは state/wiredValue.ts**
type W = Wired<'menus'>

export interface MenusValue {
  /** いま開いている品書き（どれも「開いていなければ null」） */
  menu: W['menu']
  setMenu: W['setMenu']
  clipMenu: W['clipMenu']
  setClipMenu: W['setClipMenu']
  tabMenu: W['tabMenu']
  setTabMenu: W['setTabMenu']
  tabOverflow: W['tabOverflow']
  setTabOverflow: W['setTabOverflow']
  tplMenu: W['tplMenu']
  setTplMenu: W['setTplMenu']
  /** 画面の端からはみ出さない位置へ寄せる */
  clampMenu: W['clampMenu']
  /** 区画（パネル）まわり */
  PANE_LABEL: W['PANE_LABEL']
  TAB_DEFS: W['TAB_DEFS']
  orderedTabs: W['orderedTabs']
  pickTab: W['pickTab']
  setTabOrder: W['setTabOrder']
  isPopped: W['isPopped']
  popPane: W['popPane']
  unpopPane: W['unpopPane']
  monitorTab: W['monitorTab']
  rightTab: W['rightTab']
  customCats: W['customCats']
  /** ラベル色 */
  setLabelFor: W['setLabelFor']
  selectByLabel: W['selectByLabel']
  setClipLabel: W['setClipLabel']
  /** 編集の操作 */
  deleteSelected: W['deleteSelected']
  rippleDeleteSelected: W['rippleDeleteSelected']
  deleteSelectedSE: W['deleteSelectedSE']
  deleteSelectedImg: W['deleteSelectedImg']
  deleteSelectedVClip: W['deleteSelectedVClip']
  deleteVideoSegmentsLeavingGap: W['deleteVideoSegmentsLeavingGap']
  rippleDeleteVideoSegments: W['rippleDeleteVideoSegments']
  duplicateClipsFromMenu: W['duplicateClipsFromMenu']
  splitVideoAtPlayhead: W['splitVideoAtPlayhead']
  toggleBlankSelectedVideo: W['toggleBlankSelectedVideo']
  findSilences: W['findSilences']
  silenceCut: W['silenceCut']
  setDuckOpen: W['setDuckOpen']
  /** コピーと貼り付け */
  copySelected: W['copySelected']
  copyAttributes: W['copyAttributes']
  pasteAttributes: W['pasteAttributes']
  copiedAttrs: W['copiedAttrs']
  attrSummary: W['attrSummary']
  /** キーの割り当て（品書きに出す） */
  shortcuts: W['shortcuts']
}

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
