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

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface RightPanelValue {
  accSec: any
  rightBodyRef: any
  importSeInto: any
  addMediaAtPlayhead: any
  catOf: any
  srtPath: any
  labelGroups: any
  removeMedia: any
  beginMediaDrag: any
  draggingMediaRef: any
  localTemplates: any
  isFav: any
  draggingTemplateRef: any
  iconFavs: any
  toggleIconFav: any
  draggingIconRef: any
  seLibrary: any
  seFavs: any
  setSeFolderOf: any
  toggleSeFav: any
  TELOP_MOTIONS: any
  addFilesToProject: any
  addFolderToProject: any
  handleImportSrt: any
  loadVideo: any
  selectByLabel: any
  genThumbFor: any
  prepareMediaMeta: any
  allCats: any
  openTplSec: any
  tplSecRefs: any
  toggleTplSec: any
  saveCurrentAsTemplate: any
  addCustomCat: any
  deleteCustomCat: any
  refreshPresets: any
  applyTemplate: any
  deleteUserTemplate: any
  toggleFav: any
  setTplCat: any
  iconLibrary: any
  iconFolders: any
  iconOv: any
  addIconImages: any
  addIconFiles: any
  addIconFolder: any
  deleteIconFolder: any
  removeIconImage: any
  setIconFolderOf: any
  seFolders: any
  seOv: any
  addSeFolder: any
  deleteSeFolder: any
  refreshSE: any
  previewSE: any
  setSelectedTransType: any
  updateSelectedTransDur: any
  deleteSelectedTrans: any
  setTelopTransType: any
  updateTelopTransDur: any
  deleteSelectedTelopTrans: any
}
/* eslint-enable @typescript-eslint/no-explicit-any */

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
