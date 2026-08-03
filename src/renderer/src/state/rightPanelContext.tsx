// 右パネル（素材の置き場・テロップテンプレ・アイコン・効果音・トランジション）。
//
// ## 中身は全部タブの中身
//
// どのタブも「一覧を出す」「掴んで持っていく」「整理する（お気に入り・フォルダ）」の
// 組み合わせでできている。実体は components/panels/*Tab.tsx にあり、ここはその受け渡し。
//
// ## props で配ると100個を超える
//
// タイムライン・プレビューと同じで、区画の側から見に行く形にしてある。
// ※ 中身は毎レンダー作り直しているので、心臓にしたことで描き直しが減るわけではない
//   （置き場を決めるためのもの）。

import { createContext, useContext, type ReactNode } from 'react'
import type { Wired } from './wiredValue'

// 型は手で書かず、詰めている実体から引く。**なぜ・どう腐らないかは state/wiredValue.ts**
type W = Wired<'rightPanel'>

export interface RightPanelValue {
  // 区画へ prop で渡していた物。**心臓を持っているのに prop も受ける**という
  // 二重の受け渡しになっていたので、こちらへ寄せた。
  PANE_LABEL: W['PANE_LABEL']
  orderedTabs: W['orderedTabs']
  TAB_DEFS: W['TAB_DEFS']
  pickTab: W['pickTab']
  setTabOrder: W['setTabOrder']
  setTabMenu: W['setTabMenu']
  setTabOverflow: W['setTabOverflow']
  setTplMenu: W['setTplMenu']
  setOrgMenu: W['setOrgMenu']
  rightTab: W['rightTab']
  setTransDrop: W['setTransDrop']
  draggingTransRef: W['draggingTransRef']
  draggingTelopAnimRef: W['draggingTelopAnimRef']
  setTelopDrop: W['setTelopDrop']
  toggleTelopEmphasis: W['toggleTelopEmphasis']
  myMotions: W['myMotions']
  motionPresets: W['motionPresets']
  applyMotionPreset: W['applyMotionPreset']
  deleteMyMotion: W['deleteMyMotion']
  accSec: W['accSec']
  rightBodyRef: W['rightBodyRef']
  importSeInto: W['importSeInto']
  addMediaAtPlayhead: W['addMediaAtPlayhead']
  catOf: W['catOf']
  srtPath: W['srtPath']
  labelGroups: W['labelGroups']
  removeMedia: W['removeMedia']
  beginMediaDrag: W['beginMediaDrag']
  draggingMediaRef: W['draggingMediaRef']
  localTemplates: W['localTemplates']
  isFav: W['isFav']
  draggingTemplateRef: W['draggingTemplateRef']
  iconFavs: W['iconFavs']
  toggleIconFav: W['toggleIconFav']
  draggingIconRef: W['draggingIconRef']
  /** 強調（揺れ・脈打ち）を運んでいる最中。持ち物は state/useBandDrag */
  draggingEmphasisRef: W['draggingEmphasisRef']
  seLibrary: W['seLibrary']
  seFavs: W['seFavs']
  setSeFolderOf: W['setSeFolderOf']
  toggleSeFav: W['toggleSeFav']
  TELOP_MOTIONS: W['TELOP_MOTIONS']
  addFilesToProject: W['addFilesToProject']
  addFolderToProject: W['addFolderToProject']
  handleImportSrt: W['handleImportSrt']
  loadVideo: W['loadVideo']
  selectByLabel: W['selectByLabel']
  genThumbFor: W['genThumbFor']
  prepareMediaMeta: W['prepareMediaMeta']
  allCats: W['allCats']
  openTplSec: W['openTplSec']
  tplSecRefs: W['tplSecRefs']
  toggleTplSec: W['toggleTplSec']
  saveCurrentAsTemplate: W['saveCurrentAsTemplate']
  addCustomCat: W['addCustomCat']
  deleteCustomCat: W['deleteCustomCat']
  refreshPresets: W['refreshPresets']
  applyTemplate: W['applyTemplate']
  deleteUserTemplate: W['deleteUserTemplate']
  toggleFav: W['toggleFav']
  setTplCat: W['setTplCat']
  iconLibrary: W['iconLibrary']
  iconFolders: W['iconFolders']
  iconOv: W['iconOv']
  addIconImages: W['addIconImages']
  addIconFiles: W['addIconFiles']
  addIconFolder: W['addIconFolder']
  deleteIconFolder: W['deleteIconFolder']
  removeIconImage: W['removeIconImage']
  setIconFolderOf: W['setIconFolderOf']
  seFolders: W['seFolders']
  seOv: W['seOv']
  addSeFolder: W['addSeFolder']
  deleteSeFolder: W['deleteSeFolder']
  refreshSE: W['refreshSE']
  previewSE: W['previewSE']
  setSelectedTransType: W['setSelectedTransType']
  updateSelectedTransDur: W['updateSelectedTransDur']
  deleteSelectedTrans: W['deleteSelectedTrans']
  setTelopTransType: W['setTelopTransType']
  updateTelopTransDur: W['updateTelopTransDur']
  deleteSelectedTelopTrans: W['deleteSelectedTelopTrans']
}

const Ctx = createContext<RightPanelValue | null>(null)

export function RightPanelProvider({
  value,
  children
}: {
  value: RightPanelValue
  children: ReactNode
}): React.JSX.Element {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** RightPanel を見に行く。囲いの外で呼んだら、その場で落とす */
export function useRightPanel(): RightPanelValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useRightPanel は RightPanelProvider の中でしか使えません')
  return v
}
