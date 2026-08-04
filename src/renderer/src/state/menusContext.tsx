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
// 束の中身の取り先。**配線を通さず、ここで集める**（下の useMenusValue）
import { useAppChromeCtx } from './appChromeContext'
import { useAppLayoutCtx } from './appLayoutContext'
import { useAttrCopyCtx } from './attrCopyContext'
import { useClipboardCtx } from './clipboardContext'
import { useCopyPasteCtx } from './copyPasteContext'
import { useLabelsPresetsCtx } from './labelsPresetsContext'
import { useLayout } from './layoutContext'
import { useMediaDropCtx } from './mediaDropContext'
import { useProjectStateCtx } from './projectStateContext'
import { useShortcutPrefsCtx } from './shortcutPrefsContext'
import { useSilenceDuckCtx } from './silenceDuckContext'
import { useTemplateShelfCtx } from './templateShelfContext'
import { useTimelineEditCtx } from './timelineEditContext'
import { useTracksAdminCtx } from './tracksAdminContext'

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
  /** 区画（パネル）まわり。題（`PANE_LABEL`）は state/usePanelLayout から直に引く */
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

/**
 * 束の**中身をここで集める**（2026-08-04）。理由は state/timelineOpsContext と同じ。
 * **糊は1つも要らなかった**——品書きに出る物は全部どこかの心臓が持っている。
 */
export function useMenusValue() {
  const { menu, setMenu, clipMenu, setClipMenu, rightTab } = useAppChromeCtx()
  const {
    tabMenu, setTabMenu, tabOverflow, setTabOverflow, clampMenu, TAB_DEFS, orderedTabs,
    pickTab, popPane
  } = useAppLayoutCtx()
  const { tplMenu, setTplMenu } = useTemplateShelfCtx()
  const { setTabOrder, isPopped, unpopPane, monitorTab } = useLayout()
  const { customCats } = useProjectStateCtx()
  const { setLabelFor, selectByLabel } = useLabelsPresetsCtx()
  const { setClipLabel } = useTracksAdminCtx()
  const {
    deleteSelected, rippleDeleteSelected, deleteSelectedSE, deleteVideoSegmentsLeavingGap,
    rippleDeleteVideoSegments, duplicateClipsFromMenu, splitVideoAtPlayhead,
    toggleBlankSelectedVideo, findSilences
  } = useTimelineEditCtx()
  const { deleteSelectedImg, deleteSelectedVClip } = useMediaDropCtx()
  const { silenceCut, setDuckOpen } = useSilenceDuckCtx()
  const { copySelected } = useCopyPasteCtx()
  const { copyAttributes, pasteAttributes, attrSummary } = useAttrCopyCtx()
  const { copiedAttrs } = useClipboardCtx()
  const { shortcuts } = useShortcutPrefsCtx()
  return {
    menu, setMenu, clipMenu, setClipMenu, tabMenu, setTabMenu, tabOverflow, setTabOverflow,
    tplMenu, setTplMenu, clampMenu, TAB_DEFS, orderedTabs,
    pickTab, setTabOrder, isPopped, popPane, unpopPane, monitorTab, rightTab, customCats,
    setLabelFor, selectByLabel, setClipLabel, deleteSelected,
    rippleDeleteSelected, deleteSelectedSE, deleteSelectedImg, deleteSelectedVClip,
    deleteVideoSegmentsLeavingGap, rippleDeleteVideoSegments, duplicateClipsFromMenu,
    splitVideoAtPlayhead, toggleBlankSelectedVideo, findSilences, silenceCut, setDuckOpen,
    copySelected, copyAttributes, pasteAttributes, copiedAttrs, attrSummary, shortcuts
  }
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
