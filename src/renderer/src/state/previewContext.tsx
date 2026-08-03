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

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface PreviewCtxValue {
  // 区画へ prop で渡していた物。**心臓を持っているのに prop も受ける**という
  // 二重の受け渡しになっていたので、こちらへ寄せた。
  orderedTabs: any
  TAB_DEFS: any
  monitorTab: any
  pickTab: any
  setTabMenu: any
  setTabOverflow: any
  setTabOrder: any
  shortcuts: any
  cueTrack: any
  srcOfSeg: any
  loadVideo: any
  updateSource: any
  segLayoutRef: any
  segsRef: any
  segIdCounter: any
  suppressHistoryRef: any
  initializedForPathRef: any
  stopPlayback: any
  clearSegSel: any
  toggleTrack: any
  duration: any
  draggingMediaRef: any
  // ---- 映像の入れ物 ----
  /** 映している枠。掴んだ位置はここを基準に測る */
  screenRef: any
  /** 本編の <video>。A面/B面の2本と、その一覧 */
  videoRef: any
  videoBRef: any
  videoElsRef: any
  elKey: any
  activeHalf: any
  /** いま出している元動画 */
  effActiveSrcId: any
  previewSources: any
  previewUrl: any
  /** 枠の縦横比（16:9 など） */
  monitorAspect: any

  // ---- いま出す絵 ----
  /** 重ね（クロスディゾルブ）の状態と、その見た目 */
  xfPreview: any
  xfBStyle: any
  xfNextBUrl: any
  xfDipOverlay: any
  /** 頭/尻の演出の色の覆い */
  transOverlay: any
  /** 本編の映像に掛ける CSS（回転・拡大・演出を合成した物） */
  videoMainStyle: any
  curAdjustCss: any
  /** 映像を消してある区間か */
  curBlank: any
  v1Hidden: any
  videoTLen: any
  /** いま出ているテロップ・重ねた動画 */
  activeCues: any
  windowVClips: any
  /** 重ねた動画・画像の置き方 */
  vcRefCb: any
  /** 回転・反転・ズームの CSS。**映像レイヤーと画像で同じ物**（lib/clipXform） */
  clipXform: any
  vcLen: any
  /** テロップに添える絵 */
  iconForCue: any
  /** 焼き直し・持ち出しの進み具合 */
  proxyPct: any
  packPct: any

  // ---- 掴む・押す ----
  /** 映像そのものを掴む（動かす・拡げる・回す） */
  onVideoReframeStart: any
  onVideoRotateStart: any
  resetVideoZoom: any
  /** 拡大の中心（マーカーを出していなければ null）。**画面だけの持ち物** */
  zoomAnchor: { x: number; y: number } | null
  toggleZoomAnchor: () => void
  onZoomAnchorStart: (e: React.PointerEvent) => void
  /** テロップの位置・大きさ・動きを戻す（プレビューのバーから） */
  resetSelectedTelops: () => void
  telopResetCount: () => number
  resetCount: any
  selectPreviewOverlay: any
  reframeTarget: any
  /** テロップを掴む */
  onTelopPointerDown: any
  onTelopResizeStart: any
  /** テロップの文字を打ち替える */
  editorTextRef: any
  updateCueText: any
  setEditorSel: any
  clearRunsInSelection: any
  /** 落として付ける（テンプレ・アイコン） */
  draggingTemplateRef: any
  draggingIconRef: any
  applyTemplateToCue: any
  applyIconToCue: any
  /** 再生の操作 */
  togglePlay: any
  skipSec: any
  stepFrame: any
  jumpMarker: any
  addMarkerAtPlayhead: any
  captureScreenshot: any
  seekAndReveal: any
  handleVideoEnded: any
  /** 音量（ミキサー） */
  startFader: any
  setTrackVolume: any
  setMasterVolume: any
  /** 操作バーの右に出す状態（画質・fps・尺） */
  transportInfo: any
}
/* eslint-enable @typescript-eslint/no-explicit-any */

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
