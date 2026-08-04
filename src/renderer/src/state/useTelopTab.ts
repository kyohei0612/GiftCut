// 右パネル「テロップ」タブの配線。**画面（TelopTemplatesTab）が要る形にして渡す。**
//
// なぜ画面から出したか・`useAppWiring` が太らない理由は `state/useIconTab` の冒頭に
// 1つだけ書いてある（同じ話を5回書かない）。
//
// ※ **名前の付け替えはここ。** 画面は `categories` / `openSection` と自分の言葉で受け、
//   配線側は `allCats` / `openTplSec`。混ぜると、どちらかの都合でもう片方が変わる。
import { useBandDragCtx } from './bandDragContext'
import { useLibraryCtx } from './libraryContext'
import { BUILTIN_TEMPLATES, type TelopTemplate } from '../lib/telopTemplates'
import { useRightPanel } from './rightPanelContext'
import { useProjectStateCtx } from './projectStateContext'
import { useSel } from './selectionContext'

export function useTelopTab() {
  const {
    rightBodyRef, localTemplates, openTplSec, tplSecRefs, saveCurrentAsTemplate,
    refreshPresets, applyTemplate, deleteUserTemplate, setTplMenu
  } = useRightPanel()
  const { draggingTemplateRef } = useBandDragCtx()
  // 置き場（★・フォルダ・畳み）は**配線を通さず、直に見に行く**
  //（2026-08-04。往復していた34個を state/libraryContext へ寄せた）
  const {
    allCats, isFav, catOf, toggleTplSec, addCustomCat, deleteCustomCat, toggleFav, setTplCat
  } = useLibraryCtx()
  const { userTemplates, customCats } = useProjectStateCtx()
  const { selectedIds } = useSel()

  return {
    bodyRef: rightBodyRef,
    hasSelection: selectedIds.length > 0,
    userTemplates,
    builtinTemplates: BUILTIN_TEMPLATES,
    localTemplates,
    categories: allCats,
    customCategories: customCats,
    openSection: openTplSec,
    sectionRefs: tplSecRefs,
    isFav,
    catOf,
    onToggleSection: toggleTplSec,
    onSaveCurrent: saveCurrentAsTemplate,
    onAddFolder: addCustomCat,
    onDeleteFolder: deleteCustomCat,
    onRefresh: refreshPresets,
    onApply: applyTemplate,
    onDeleteUserTemplate: deleteUserTemplate,
    onToggleFav: toggleFav,
    onSetCat: setTplCat,
    /** 札の右クリック。**既定の動きを止める**（ブラウザの品書きが出てしまう） */
    onCardContextMenu: (t: TelopTemplate, e: React.MouseEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      setTplMenu({ x: e.clientX, y: e.clientY, name: t.name, curCat: catOf(t) })
    },
    onDragStartTpl: (style: TelopTemplate['style']): void => {
      draggingTemplateRef.current = style
    },
    onDragEndTpl: (): void => {
      draggingTemplateRef.current = null
    }
  }
}
