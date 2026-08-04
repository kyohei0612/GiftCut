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
import type { Wired } from './wiredValue'
// 束の中身の取り先。**配線を通さず、ここで集める**（下の useDialogsValue）
import { useAppChromeCtx } from './appChromeContext'
import { useAskCtx } from './askContext'
import { useAutosaveMarkCtx } from './autosaveMarkContext'
import { useExportCtx } from './exportContext'
import { useExportRunCtx } from './exportRunContext'
import { useIconLibraryCtx } from './iconLibraryContext'
import { useLibraryCtx } from './libraryContext'
import { useProjectFileCtx } from './projectFileContext'
import { useProjectStateCtx } from './projectStateContext'
import { useProjectTemplatesCtx } from './projectTemplatesContext'
import { useSeAudioCtx } from './seAudioContext'
import { useShortcutPrefsCtx } from './shortcutPrefsContext'
import { useSilenceDuckCtx } from './silenceDuckContext'
import { useSubtitlePrefsCtx } from './subtitlePrefsContext'
import { useSubtitlesCtx } from './subtitlesContext'
import { useTimelineEditCtx } from './timelineEditContext'
import { useToastCtx } from './toastContext'

// 型は手で書かず、詰めている実体から引く。**なぜ・どう腐らないかは state/wiredValue.ts**
type W = Wired<'dialogs'>

export interface DialogsValue {
  silenceCut: W['silenceCut']
  templatePicker: W['templatePicker']
  setTemplatePicker: W['setTemplatePicker']
  cropSrc: W['cropSrc']
  setShowExportDialog: W['setShowExportDialog']
  exportStatus: W['exportStatus']
  restorePrompt: W['restorePrompt']
  setRestorePrompt: W['setRestorePrompt']
  silenceCuts: W['silenceCuts']
  findSilences: W['findSilences']
  shortcuts: W['shortcuts']
  capturingId: W['capturingId']
  setCropSrc: W['setCropSrc']
  promptState: W['promptState']
  setPromptState: W['setPromptState']
  confirmState: W['confirmState']
  showExportDialog: W['showExportDialog']
  fpsLabel: W['fpsLabel']
  srcFpsForExport: W['srcFpsForExport']
  exportProject: W['exportProject']
  exportPct: W['exportPct']
  setExportStatus: W['setExportStatus']
  applyProjectData: W['applyProjectData']
  subMaxChars: W['subMaxChars']
  saveLS: W['saveLS']
  subReplace: W['subReplace']
  runSubtitles: W['runSubtitles']
  setSubtitleOpen: W['setSubtitleOpen']
  pickTemplate: W['pickTemplate']
  silenceOpen: W['silenceOpen']
  setSilenceCut: W['setSilenceCut']
  applySilenceCut: W['applySilenceCut']
  setSilenceOpen: W['setSilenceOpen']
  duckOpen: W['duckOpen']
  duckOpts: W['duckOpts']
  setDuckOpts: W['setDuckOpts']
  duckEnv: W['duckEnv']
  setDuckOpen: W['setDuckOpen']
  seRefCb: W['seRefCb']
  prefsOpen: W['prefsOpen']
  setIconForColor: W['setIconForColor']
  setIconForLane: W['setIconForLane']
  setPerfOpen: W['setPerfOpen']
  toasts: W['toasts']
  closeConfirm: W['closeConfirm']
  iconAssign: W['iconAssign']
  laneIconAssign: W['laneIconAssign']
  iconLibrary: W['iconLibrary']
}

/**
 * 束の**中身をここで集める**（2026-08-04）。理由は state/timelineOpsContext と同じ。
 * **糊は1つも要らなかった**——覆いかぶさる物は全部どこかの心臓が持っている。
 */
export function useDialogsValue() {
  const { templatePicker, setTemplatePicker, pickTemplate } = useProjectTemplatesCtx()
  const { cropSrc, setCropSrc, setIconForColor, setIconForLane, iconLibrary } =
    useIconLibraryCtx()
  const {
    setShowExportDialog, exportStatus, showExportDialog, fpsLabel, srcFpsForExport,
    exportPct, setExportStatus
  } = useExportCtx()
  const { restorePrompt, setRestorePrompt } = useAutosaveMarkCtx()
  const {
    silenceCut, silenceCuts, silenceOpen, setSilenceCut, setSilenceOpen,
    duckOpen, duckOpts, setDuckOpts, duckEnv, setDuckOpen
  } = useSilenceDuckCtx()
  const { capturingId, prefsOpen, shortcuts } = useShortcutPrefsCtx()
  const { promptState, setPromptState, confirmState, closeConfirm } = useAskCtx()
  const { exportProject } = useExportRunCtx()
  const { applyProjectData } = useProjectFileCtx()
  const { subMaxChars, subReplace, setSubtitleOpen } = useSubtitlePrefsCtx()
  const { saveLS } = useLibraryCtx()
  const { runSubtitles } = useSubtitlesCtx()
  const { applySilenceCut, findSilences } = useTimelineEditCtx()
  const { seRefCb } = useSeAudioCtx()
  const { setPerfOpen } = useAppChromeCtx()
  const { toasts } = useToastCtx()
  const { iconAssign, laneIconAssign } = useProjectStateCtx()
  return {
    silenceCut, templatePicker, setTemplatePicker, cropSrc, setShowExportDialog,
    exportStatus, restorePrompt, setRestorePrompt, silenceCuts, findSilences, shortcuts,
    capturingId, setCropSrc, promptState, setPromptState, confirmState,
    showExportDialog, fpsLabel, srcFpsForExport, exportProject, exportPct, setExportStatus,
    applyProjectData, subMaxChars,
    saveLS, subReplace, runSubtitles, setSubtitleOpen, pickTemplate,
    silenceOpen, setSilenceCut, applySilenceCut, setSilenceOpen, duckOpen, duckOpts,
    setDuckOpts, duckEnv, setDuckOpen, seRefCb, prefsOpen,
    setIconForColor, setIconForLane, setPerfOpen,
    toasts, closeConfirm, iconAssign, laneIconAssign, iconLibrary
  }
}

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
