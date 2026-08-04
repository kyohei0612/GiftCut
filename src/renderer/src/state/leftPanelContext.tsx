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
// **部品の props 型に別名付けしない**（shared/ctxTypes.test.ts の R4）
import type { Wired } from './wiredValue'
// 束の中身の取り先。**配線を通さず、ここで集める**（下の useLeftPanelValue）
import { useCueIcon } from './cueIconContext'
import { useCurrentLookCtx } from './currentLookContext'
import { useIconLibraryCtx } from './iconLibraryContext'
import { useLabelsPresetsCtx } from './labelsPresetsContext'
import { useMotionCtx } from './motionContext'
import { usePlaybackCtx } from './playbackContext'
import { usePlaybackEngineCtx } from './playbackEngineContext'
import { useProjectStateCtx } from './projectStateContext'
import { useTelopBoxCtx } from './telopBoxContext'
import { useTelopEditCtx } from './telopEditContext'
import { useTelopLookCtx } from './telopLookContext'
import { useTelopTemplateCtx } from './telopTemplateContext'
import { useTimelineEditCtx } from './timelineEditContext'
import { useTrackGeomCtx } from './trackGeomContext'

export type LeftPanelValue = Wired<'leftPanel'>

/**
 * 束の**中身をここで集める**（2026-08-04）。理由は state/timelineOpsContext と同じ。
 *
 * `resetCount` だけ配線から受ける——**配線にしか実体が無い糊**で、
 * リセットが何個に効くかをテロップ・切片・画像の3種類にまたがって数える。
 */
export function useLeftPanelValue(deps: { resetCount: () => number }) {
  const { alignTelop } = useTelopEditCtx()
  const { applyTemplate } = useTelopTemplateCtx()
  const { changeIconAuto, setPersonIconForSelected } = useIconLibraryCtx()
  const {
    clearClipMotions, motionSelRef, motionRowsRef, nudgeClips, resetClipChannel, toggleKeys
  } = useMotionCtx()
  const { currentTime } = usePlaybackCtx()
  const { pairedAudioOf } = useTrackGeomCtx()
  const { panelStyleFor, updateSelectedStyle, updateSelectedText } = useTelopLookCtx()
  const { reframeTarget } = useCurrentLookCtx()
  const { savePreset } = useLabelsPresetsCtx()
  const { seekTo } = usePlaybackEngineCtx()
  const { setBoxAnchor } = useTelopBoxCtx()
  const { setSelectedSegSpeed } = useTimelineEditCtx()
  const { userTemplates } = useProjectStateCtx()
  const { iconForCue } = useCueIcon()
  return {
    alignTelop, applyTemplate, changeIconAuto, clearClipMotions, currentTime,
    motionSelRef, motionRowsRef, nudgeClips, pairedAudioOf, panelStyleFor, reframeTarget,
    resetClipChannel,
    resetCount: deps.resetCount, savePreset, seekTo, setBoxAnchor, setPersonIconForSelected,
    setSelectedSegSpeed, toggleKeys, updateSelectedStyle, updateSelectedText, userTemplates,
    iconForCue
  }
}

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
