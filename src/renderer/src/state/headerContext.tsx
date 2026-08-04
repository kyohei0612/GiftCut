// 画面のいちばん上（更新の帯とメニューバー）が要る物の受け渡し。
//
// メニューバーは「ファイル」「編集」…の中身をすべて呼ぶので、素直に渡すと
// 24個の受け渡しが App の JSX に並ぶ。区画・品書きと同じ流儀に揃えてある。
import { createContext, useContext } from 'react'
// **部品の props 型に別名付けしない。** あちらの `[k: string]: any` が
// そのまま抜け道になり、束から名前を外しても型検査が1件も出なかった
//（2026-08-04。決まりは shared/ctxTypes.test.ts の R4）
import type { Wired } from './wiredValue'
// 束の中身の取り先。**配線を通さず、ここで集める**（下の useHeaderValue）
import type { Ratio } from './useExportSettings'
import { useAppChromeCtx } from './appChromeContext'
import { useAutosaveMarkCtx } from './autosaveMarkContext'
import { useExportRunCtx } from './exportRunContext'
import { useLibraryCtx } from './libraryContext'
import { useProjectFileCtx } from './projectFileContext'
import { useProjectIOCtx } from './projectIOContext'
import { useProjectStateCtx } from './projectStateContext'
import { useProjectTemplatesCtx } from './projectTemplatesContext'
import { useShortcutPrefsCtx } from './shortcutPrefsContext'
import { useSubtitlePrefsCtx } from './subtitlePrefsContext'
import { useSubtitlesCtx } from './subtitlesContext'
import { useTelopEditCtx } from './telopEditContext'

export type HeaderValue = Wired<'header'>

/**
 * 束の**中身をここで集める**（2026-08-04）。理由は state/timelineOpsContext と同じ。
 *
 * `changeRatio` だけ配線から受ける——比率を変えるとテロップの箱と文字サイズも
 * 一緒に補正する**配線にしか実体が無い糊**。
 */
export function useHeaderValue(deps: { changeRatio: (r: Ratio) => void }) {
  const { setUpdateState, appVersion } = useAppChromeCtx()
  const { shortcuts } = useShortcutPrefsCtx()
  const { unsaved } = useAutosaveMarkCtx()
  const { saveProjectFn, openProjectFn } = useProjectFileCtx()
  const { packProjectFn, openPackFn, handleAppendVideo, handleReplaceVideo } = useProjectIOCtx()
  const { saveAsTemplateFn, openTemplateFn } = useProjectTemplatesCtx()
  const { exportSrtFn, openExportDialog } = useExportRunCtx()
  const { setSubtitleOpen } = useSubtitlePrefsCtx()
  const { handleImportSrt } = useSubtitlesCtx()
  const { refreshPresets } = useLibraryCtx()
  const { addTelop } = useTelopEditCtx()
  const { projectPath } = useProjectStateCtx()
  return {
    setUpdateState, shortcuts, appVersion, unsaved,
    saveProjectFn, openProjectFn, packProjectFn, openPackFn, saveAsTemplateFn, openTemplateFn,
    handleAppendVideo, handleReplaceVideo, handleImportSrt, exportSrtFn,
    refreshPresets, setSubtitleOpen,
    openExportDialog, addTelop, changeRatio: deps.changeRatio, projectPath
  }
}

const Ctx = createContext<HeaderValue | null>(null)

export function HeaderProvider({
  value,
  children
}: {
  value: HeaderValue
  children: React.ReactNode
}): React.JSX.Element {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useHeader(): HeaderValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('HeaderProvider の外で useHeader を呼んでいる')
  return v
}
