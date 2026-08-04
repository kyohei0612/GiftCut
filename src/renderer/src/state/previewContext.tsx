// プレビュー（中央の映像）まわりを1か所に集める。
//
// ## タイムラインと違って1つにまとめてある
//
// タイムラインは「操作の入口」と「見え方」で2つに分けた（大きいので、
// 直したい物がどちらにあるかで迷わないように）。プレビューはその半分ほどの
// 大きさで、しかも中身の大半が**映像1本に紐づく物**なので、分けると
// かえって行き来が増える。
//
// ## A面／B面が出てくる理由
//
// 切片の境目で毎回シークすると数百ms 止まるので、裏でもう1本を次の位置へ
// 合わせておき、境目では表示を入れ替える。だから <video> は常に2本ある。
// 詳しくは state/usePlaybackEngine.ts。
//
// ## 束を組み立てるのは、このファイルの `usePreviewCtxValue`
//
// **配線（useAppWiring）は呼ぶだけ**で、中身を1つも知らない（2026-08-04 に寄せた）。
//
// **`<PreviewProvider>` の中で組んではいけない。** 囲いの中で作ると、描き直しの
// たびに作り直されて、掴んでいる途中の状態が消える。組むのは囲いの**外**。
// ※ 中身は毎レンダー作り直しているので、心臓にしたことで描き直しが減るわけではない
//   （置き場を決めるためのもの）。

import { createContext, useContext, type ReactNode } from 'react'
import type { Wired } from './wiredValue'
// 束の中身の取り先。**配線を通さず、ここで集める**（下の usePreviewCtxValue）
import { TransportInfo } from '../components/panels/PreviewBars'
import { clipXform } from '../lib/clipXform'
import { startFader } from '../lib/faderDrag'
import { useAppChromeCtx } from './appChromeContext'
import { useAppLayoutCtx } from './appLayoutContext'
import { useCueIcon } from './cueIconContext'
import { useDoc } from './contentContext'
import { useCurrentLookCtx } from './currentLookContext'
import { useDragPreviewCtx } from './dragPreviewContext'
import { useExportCtx } from './exportContext'
import { useHistoryCtx } from './historyContext'
import { useLayout } from './layoutContext'
import { useMarkersCtx } from './markersContext'
import { useMediaCtx } from './mediaContext'
import { useMediaOpsCtx } from './mediaOpsContext'
import { useNowShowingCtx } from './nowShowingContext'
import { usePlaybackCtx } from './playbackContext'
import { usePlaybackEngineCtx } from './playbackEngineContext'
import { usePreviewFrameCtx } from './previewFrameContext'
import { usePreviewManipCtx } from './previewManipContext'
import { useProxyCtx } from './proxyContext'
import { useScreenshotCtx } from './screenshotContext'
import { useSegLayoutCtx } from './segLayoutContext'
import { useSel } from './selectionContext'
import { useShortcutPrefsCtx } from './shortcutPrefsContext'
import { useTelopBoxCtx } from './telopBoxContext'
import { useTelopEditCtx } from './telopEditContext'
import { useTelopLookCtx } from './telopLookContext'
import { useTelopTemplateCtx } from './telopTemplateContext'
import { useTimelineBoxCtx } from './timelineBoxContext'
import { useTimelineSpanCtx } from './timelineSpanContext'
import { useTrackGeomCtx } from './trackGeomContext'
import { useTracksAdminCtx } from './tracksAdminContext'
import { useTracksCtx } from './tracksContext'
import { useVClipElsCtx } from './vClipElsContext'
import { useVideoElsCtx } from './videoElsContext'

// 型は手で書かず、詰めている実体から引く。**なぜ・どう腐らないかは state/wiredValue.ts**
type W = Wired<'previewCtx'>

export interface PreviewCtxValue {
  // 区画へ prop で渡していた物。**心臓を持っているのに prop も受ける**という
  // 二重の受け渡しになっていたので、こちらへ寄せた。
  orderedTabs: W['orderedTabs']
  TAB_DEFS: W['TAB_DEFS']
  monitorTab: W['monitorTab']
  pickTab: W['pickTab']
  setTabMenu: W['setTabMenu']
  setTabOverflow: W['setTabOverflow']
  setTabOrder: W['setTabOrder']
  shortcuts: W['shortcuts']
  cueTrack: W['cueTrack']
  srcOfSeg: W['srcOfSeg']
  loadVideo: W['loadVideo']
  updateSource: W['updateSource']
  segLayoutRef: W['segLayoutRef']
  segsRef: W['segsRef']
  segIdCounter: W['segIdCounter']
  suppressHistoryRef: W['suppressHistoryRef']
  initializedForPathRef: W['initializedForPathRef']
  stopPlayback: W['stopPlayback']
  clearSegSel: W['clearSegSel']
  toggleTrack: W['toggleTrack']
  duration: W['duration']
  draggingMediaRef: W['draggingMediaRef']
  // ---- 映像の入れ物 ----
  /** 映している枠。掴んだ位置はここを基準に測る */
  screenRef: W['screenRef']
  /** 本編の <video>。A面/B面の2本と、その一覧 */
  videoRef: W['videoRef']
  videoBRef: W['videoBRef']
  videoElsRef: W['videoElsRef']
  elKey: W['elKey']
  activeHalf: W['activeHalf']
  /** いま出している元動画 */
  effActiveSrcId: W['effActiveSrcId']
  previewSources: W['previewSources']
  previewUrl: W['previewUrl']
  /** 枠の縦横比（16:9 など） */
  monitorAspect: W['monitorAspect']

  // ---- いま出す絵 ----
  /** 重ね（クロスディゾルブ）の状態と、その見た目 */
  xfPreview: W['xfPreview']
  xfBStyle: W['xfBStyle']
  xfNextBUrl: W['xfNextBUrl']
  xfDipOverlay: W['xfDipOverlay']
  /** 頭/尻の演出の色の覆い */
  transOverlay: W['transOverlay']
  /** 本編の映像に掛ける CSS（回転・拡大・演出を合成した物） */
  videoMainStyle: W['videoMainStyle']
  curAdjustCss: W['curAdjustCss']
  /** 映像を消してある区間か */
  curBlank: W['curBlank']
  v1Hidden: W['v1Hidden']
  videoTLen: W['videoTLen']
  /** いま出ているテロップ・重ねた動画 */
  activeCues: W['activeCues']
  windowVClips: W['windowVClips']
  /** 重ねた動画・画像の置き方 */
  vcRefCb: W['vcRefCb']
  /** 回転・反転・ズームの CSS。**映像レイヤーと画像で同じ物**（lib/clipXform） */
  clipXform: W['clipXform']
  vcLen: W['vcLen']
  /** テロップに添える絵 */
  iconForCue: W['iconForCue']
  /** 焼き直し・持ち出しの進み具合 */
  proxyPct: W['proxyPct']

  // ---- 掴む・押す ----
  /** 映像そのものを掴む（動かす・拡げる・回す） */
  onVideoReframeStart: W['onVideoReframeStart']
  onVideoRotateStart: W['onVideoRotateStart']
  resetVideoZoom: W['resetVideoZoom']
  /** 拡大の中心（マーカーを出していなければ null）。**画面だけの持ち物** */
  zoomAnchor: W['zoomAnchor']
  toggleZoomAnchor: W['toggleZoomAnchor']
  onZoomAnchorStart: W['onZoomAnchorStart']
  /** テロップの位置・大きさ・動きを戻す（プレビューのバーから） */
  resetSelectedTelops: W['resetSelectedTelops']
  telopResetCount: W['telopResetCount']
  resetCount: W['resetCount']
  selectPreviewOverlay: W['selectPreviewOverlay']
  reframeTarget: W['reframeTarget']
  /** テロップを掴む */
  onTelopPointerDown: W['onTelopPointerDown']
  onTelopResizeStart: W['onTelopResizeStart']
  /** テロップの文字を打ち替える */
  editorTextRef: W['editorTextRef']
  updateCueText: W['updateCueText']
  setEditorSel: W['setEditorSel']
  clearRunsInSelection: W['clearRunsInSelection']
  applyTemplateToCue: W['applyTemplateToCue']
  applyIconToCue: W['applyIconToCue']
  /** 再生の操作 */
  togglePlay: W['togglePlay']
  skipSec: W['skipSec']
  stepFrame: W['stepFrame']
  jumpMarker: W['jumpMarker']
  addMarkerAtPlayhead: W['addMarkerAtPlayhead']
  captureScreenshot: W['captureScreenshot']
  seekAndReveal: W['seekAndReveal']
  handleVideoEnded: W['handleVideoEnded']
  /** 音量（ミキサー） */
  startFader: W['startFader']
  setTrackVolume: W['setTrackVolume']
  setMasterVolume: W['setMasterVolume']
  /** 操作バーの右に出す状態（画質・fps・尺） */
  transportInfo: W['transportInfo']
}

/**
 * 束の**中身をここで集める**（2026-08-04）。理由は state/timelineOpsContext と同じ。
 *
 * 配線から一緒に連れてきた物が2つある。どちらも**プレビューの見出し行の話**で、
 * 配線に置く理由が無かった:
 *
 *   `monitorAspect`  … 枠の形（比率の設定そのまま）
 *   `transportInfo`  … 右端に出す「状態」。**押す物ではないので操作バーに置かない**
 *                      （混ぜると再生ボタンが端へ押しやられる。1段で済むと縦が26px 広がる）
 *
 * `resetCount` だけ配線から受ける——3種類にまたがって数える糊なので、
 * どの心臓の持ち物でもない。
 */
export function usePreviewCtxValue(deps: { resetCount: () => number }) {
  const { orderedTabs, TAB_DEFS, pickTab, setTabMenu, setTabOverflow } = useAppLayoutCtx()
  const { monitorTab, setTabOrder } = useLayout()
  const { shortcuts } = useShortcutPrefsCtx()
  const { cueTrack, vcLen } = useTrackGeomCtx()
  const { srcOfSeg, proxyPct, videoSrc } = useMediaCtx()
  const { loadVideo, updateSource } = useMediaOpsCtx()
  const { segLayoutRef, videoTLen } = useSegLayoutCtx()
  const { segsRef, segIdCounter } = useDoc()
  const { suppressHistoryRef } = useHistoryCtx()
  const { initializedForPathRef } = useAppChromeCtx()
  const {
    stopPlayback, xfBStyle, togglePlay, skipSec, stepFrame, seekAndReveal, handleVideoEnded
  } = usePlaybackEngineCtx()
  const { clearSegSel } = useSel()
  const { toggleTrack } = useTracksCtx()
  const { updateCueText, applyIconToCue } = useTelopEditCtx()
  const { applyTemplateToCue } = useTelopTemplateCtx()
  const { duration } = useTimelineSpanCtx()
  const { draggingMediaRef } = useDragPreviewCtx()
  const { screenRef } = useTimelineBoxCtx()
  const { videoRef, videoBRef, videoElsRef, elKey, activeHalf } = useVideoElsCtx()
  const { effActiveSrcId, curAdjustCss, curBlank, reframeTarget } = useCurrentLookCtx()
  const { previewSources, activeCues } = useNowShowingCtx()
  const { previewUrl, previewRes, setPreviewRes } = useProxyCtx()
  const { xfPreview, xfNextBUrl, xfDipOverlay, transOverlay, videoMainStyle } =
    usePreviewFrameCtx()
  const { v1Hidden, setTrackVolume } = useTracksAdminCtx()
  const { windowVClips, vcRefCb } = useVClipElsCtx()
  const { iconForCue } = useCueIcon()
  const {
    onVideoReframeStart, onVideoRotateStart, resetVideoZoom, zoomAnchor, toggleZoomAnchor,
    onZoomAnchorStart, selectPreviewOverlay
  } = usePreviewManipCtx()
  const { resetSelectedTelops, telopResetCount, onTelopPointerDown, onTelopResizeStart } =
    useTelopBoxCtx()
  const { editorTextRef, setEditorSel, clearRunsInSelection } = useTelopLookCtx()
  const { jumpMarker, addMarkerAtPlayhead } = useMarkersCtx()
  const { captureScreenshot } = useScreenshotCtx()
  const { ratio, masterVolume, setMasterVolume } = useExportCtx()
  const { fps, playRateUI } = usePlaybackCtx()
  /** プレビューの枠の形（比率の設定そのまま） */
  const monitorAspect = ratio === '16:9' ? '16 / 9' : ratio === '9:16' ? '9 / 16' : '1 / 1'
  const transportInfo = (
    <TransportInfo
      previewRes={previewRes}
      onPreviewRes={setPreviewRes}
      hasVideo={!!videoSrc}
      fps={fps}
      playRate={playRateUI}
      duration={duration}
      master={masterVolume}
      onMaster={(v) => setMasterVolume(Math.min(1, Math.max(0, v)))}
    />
  )
  return {
    orderedTabs, TAB_DEFS, monitorTab, pickTab, setTabMenu, setTabOverflow, setTabOrder,
    shortcuts, cueTrack, srcOfSeg, loadVideo, updateSource, segLayoutRef, segsRef, segIdCounter,
    suppressHistoryRef, initializedForPathRef, stopPlayback, clearSegSel, toggleTrack, duration,
    draggingMediaRef,
    screenRef, videoRef, videoBRef, videoElsRef, elKey, activeHalf, effActiveSrcId,
    previewSources, previewUrl, monitorAspect,
    xfPreview, xfBStyle, xfNextBUrl, xfDipOverlay, transOverlay, videoMainStyle,
    curAdjustCss, curBlank, v1Hidden, videoTLen, activeCues, windowVClips,
    vcRefCb, clipXform, vcLen, iconForCue, proxyPct,
    onVideoReframeStart, onVideoRotateStart, resetVideoZoom, resetCount: deps.resetCount,
    zoomAnchor, toggleZoomAnchor, onZoomAnchorStart,
    resetSelectedTelops, telopResetCount,
    selectPreviewOverlay, reframeTarget, onTelopPointerDown, onTelopResizeStart,
    editorTextRef, updateCueText, setEditorSel, clearRunsInSelection,
    applyTemplateToCue, applyIconToCue,
    togglePlay, skipSec, stepFrame, jumpMarker, addMarkerAtPlayhead, captureScreenshot,
    seekAndReveal, handleVideoEnded, startFader, setTrackVolume, setMasterVolume,
    transportInfo
  }
}

const Ctx = createContext<PreviewCtxValue | null>(null)

export function PreviewProvider({
  value,
  children
}: {
  value: PreviewCtxValue
  children: ReactNode
}): React.JSX.Element {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** プレビューまわりを見に行く。囲いの外で呼んだら、その場で落とす */
export function usePreviewCtx(): PreviewCtxValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('usePreviewCtx は PreviewProvider の中でしか使えません')
  return v
}
