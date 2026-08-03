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
// ## 中身は AppInner で作って渡す
//
// 囲いの中で作ると、描き直しのたびに作り直されて、掴んでいる途中の状態が消える。
// ※ 中身は毎レンダー作り直しているので、心臓にしたことで描き直しが減るわけではない
//   （置き場を決めるためのもの）。

import { createContext, useContext, type ReactNode } from 'react'
import type { Wired } from './wiredValue'

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
  packPct: W['packPct']

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
  /** 落として付ける（テンプレ・アイコン） */
  draggingTemplateRef: W['draggingTemplateRef']
  draggingIconRef: W['draggingIconRef']
  /** 強調（揺れ・脈打ち）を運んでいる最中。持ち物は state/useBandDrag */
  draggingEmphasisRef: W['draggingEmphasisRef']
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
