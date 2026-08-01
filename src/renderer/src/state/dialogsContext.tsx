// 画面に覆いかぶさる物（書き出し・字幕・無音カット・ダッキング・環境設定・
// アイコン割当・切り抜き・計測の小窓・確認・お知らせ）。
//
// ## どれも「開いている間だけ出す」
//
// 開いているかどうかは1つずつ別の状態で持つ。まとめて1つにすると、
// 2つ同時に出したい場面（書き出し中に不具合の知らせが出る、など）で困る。
//
// ## 閉じ方は必ず用意する
//
// ✕ と Escape の両方。閉じられない覆いは、裏を触れなくする一番きつい壊れ方をする。
//
// ## props で配ると70個近くになる
//
// 区画の側から見に行く形にしてある。
// ※ 中身は毎レンダー作り直しているので、心臓にしたことで描き直しが減るわけではない
//   （置き場を決めるためのもの）。

import { createContext, useContext, type ReactNode } from 'react'

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface DialogsValue {
  silenceCut: any
  perfStopped: any
  templatePicker: any
  setTemplatePicker: any
  cropSrc: any
  setShowExportDialog: any
  exportStatus: any
  restorePrompt: any
  setRestorePrompt: any
  silenceCuts: any
  findSilences: any
  shortcuts: any
  capturingId: any
  setCapturingId: any
  setCropSrc: any
  promptState: any
  setPromptState: any
  confirmState: any
  showExportDialog: any
  fpsLabel: any
  srcFpsForExport: any
  exportProject: any
  exportPct: any
  setExportStatus: any
  applyProjectData: any
  subtitleOpen: any
  subModel: any
  subtitleState: any
  subMaxChars: any
  setSubMaxChars: any
  saveLS: any
  subReplace: any
  setSubReplace: any
  runSubtitles: any
  setSubtitleOpen: any
  pickTemplate: any
  silenceOpen: any
  setSilenceCut: any
  applySilenceCut: any
  setSilenceOpen: any
  duckOpen: any
  duckOpts: any
  setDuckOpts: any
  duckEnv: any
  setDuckOpen: any
  seRefCb: any
  prefsOpen: any
  resetShortcuts: any
  setPrefsOpen: any
  setIconForColor: any
  setIconForLane: any
  perfOpen: any
  setPerfOpen: any
  setPerfStopped: any
  toasts: any
  closeConfirm: any
  iconAssign: any
  laneIconAssign: any
  iconLibrary: any
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const Ctx = createContext<DialogsValue | null>(null)

export function DialogsProvider({
  value,
  children
}: {
  value: DialogsValue
  children: ReactNode
}): React.JSX.Element {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** Dialogs を見に行く。囲いの外で呼んだら、その場で落とす */
export function useDialogs(): DialogsValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useDialogs は DialogsProvider の中でしか使えません')
  return v
}
