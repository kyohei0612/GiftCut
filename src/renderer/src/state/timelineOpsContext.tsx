// タイムラインの上で「何かをする」入口を1か所に集める。
//
// ## なぜ心臓（context）にするか
//
// 区画（タイムライン・段の見出し・帯）を部品へ切り出すとき、これらを props で
// 配ると**渡す物が一気に増える**。実際に素直へ切り出そうとして約130個になり、
// プロパティの導管ができるだけになったので取り下げた。
//
// 部品の側から「自分で見に行く」形にすれば、区画の props は10個前後で済む。
//
// ## ここに入れる物・入れない物
//
// 入れる … 掴む・落とす・押す、つまり**人の操作の入口**
// 入れない … 見え方（いま持っている道具、影の位置、測り物）＝ state/timelineViewContext.tsx
//
// 分けてあるのは**探す場所を決めるため**。「何かをする物」と「何かを映す物」で
// 置き場を分けておくと、直したい物がどちらにあるかで迷わない。
//
// ※ **描き直しの回数は変わらない。** この中身は毎レンダー作り直しているので、
//   分けたことで下流の再描画が減るわけではない。減らしたくなったら
//   `useMemo` で包む必要があるが、そのときは依存を1つも取りこぼさないこと
//   （取りこぼすと、掴んでいる最中に古い関数を呼び続ける形で表に出る）。
//
// ## 中身は AppInner で作って渡す
//
// 囲いの中で作ると、描き直しのたびに作り直されて、掴んでいる途中の状態が消える。

import { createContext, useContext, type ReactNode } from 'react'
import type { Wired } from './wiredValue'
// **`W['openClipMenu']` で受けてはいけない**——`W` は配線の返り値から引くので、
// 配線がこの関数を呼んだ瞬間に型が輪になる（`ctxTypes` の R3 が言っているのと同じ形）。
// 実体の型で受ければ輪にならない。
import type { OpenClipMenu } from '../components/timeline/ClipBand'
// 束の中身の取り先。**配線を通さず、ここで集める**（下の useTimelineOpsValue）
import { useAppChromeCtx } from './appChromeContext'
import { useAskCtx } from './askContext'
import { useBandDragCtx } from './bandDragContext'
import { useDragPreviewCtx } from './dragPreviewContext'
import { useHistoryCtx } from './historyContext'
import { useLaneGeometryCtx } from './laneGeometryContext'
import { useLaneHeightsCtx } from './laneHeightsContext'
import { useLaneResizeCtx } from './laneResizeContext'
import { useMarkersCtx } from './markersContext'
import { useMediaDropCtx } from './mediaDropContext'
import { useMotionCtx } from './motionContext'
import { usePlaybackEngineCtx } from './playbackEngineContext'
import { useSegmentDragCtx } from './segmentDragContext'
import { useSegmentPlaceCtx } from './segmentPlaceContext'
import { useSilenceDuckCtx } from './silenceDuckContext'
import { useSnapCtx } from './snapContext'
import { useTelopAnimCtx } from './telopAnimContext'
import { useTimelineDragCtx } from './timelineDragContext'
import { useTimelineEditCtx } from './timelineEditContext'
import { useTracksAdminCtx } from './tracksAdminContext'
import { useTracksCtx } from './tracksContext'
import { useTransitionsCtx } from './transitionsContext'

// 型は手で書かず、詰めている実体から引く。**なぜ・どう腐らないかは state/wiredValue.ts**
type W = Wired<'timelineOps'>

export interface TimelineOps {
  // ---- 掴む（クリップ・切片・目印・段の空き）----
  onClipPointerDown: W['onClipPointerDown']
  onClipContextMenu: W['onClipContextMenu']
  onTrimStart: W['onTrimStart']
  onSegPointerDown: W['onSegPointerDown']
  onSegTrimStart: W['onSegTrimStart']
  onSePointerDown: W['onSePointerDown']
  onImgPointerDown: W['onImgPointerDown']
  onVClipPointerDown: W['onVClipPointerDown']
  onMarkerPointerDown: W['onMarkerPointerDown']
  onTrackAreaPointerDown: W['onTrackAreaPointerDown']
  /** 目盛りを擦る */
  startScrub: W['startScrub']
  /** 段の高さをまとめて変える */
  startGroupResize: W['startGroupResize']
  /** つなぎ目の演出の端を掴む */
  startTransResize: W['startTransResize']
  /** 右クリックの品書きを開く（押した1つを選び直してから） */
  openClipMenu: W['openClipMenu']

  // ---- 落とす（素材をタイムラインへ）----
  updateDropGhost: W['updateDropGhost']
  clearDropGhosts: W['clearDropGhosts']
  dropLaneAt: W['dropLaneAt']
  videoDropLane: W['videoDropLane']
  placeSE: W['placeSE']
  /** 画像を置く段（影と置き先で同じ判定を通す。shared/lanes の avoidBusyLane） */
  imgLaneAt: W['imgLaneAt']
  /** 落とした物を置く（まとめて選んでいればその順に続けて並べる） */
  placeDropped: W['placeDropped']
  placeImage: W['placeImage']
  placeVClip: W['placeVClip']
  placeVideoAtDrop: W['placeVideoAtDrop']
  snapClipStart: W['snapClipStart']
  /** いま掴んで運んでいる物（種類ごと） */
  draggingMediaRef: W['draggingMediaRef']
  draggingTransRef: W['draggingTransRef']
  draggingTelopAnimRef: W['draggingTelopAnimRef']
  dragSeDurRef: W['dragSeDurRef']

  // ---- つなぎ目の演出 ----
  resolveTransDrop: W['resolveTransDrop']
  applyTransDrop: W['applyTransDrop']
  selectTransition: W['selectTransition']
  setVideoTransDur: W['setVideoTransDur']
  /** テロップの出入りの動き */
  resolveTelopTransDrop: W['resolveTelopTransDrop']
  applyTelopTransDrop: W['applyTelopTransDrop']
  selectTelopTrans: W['selectTelopTrans']
  patchCueAnim: W['patchCueAnim']
  /** タイムラインの◆を1つ消す（右クリック） */
  removeKeyAtTime: W['removeKeyAtTime']

  // ---- 道具立て（ツールバー）----
  undo: W['undo']
  redo: W['redo']
  undoStackRef: W['undoStackRef']
  redoStackRef: W['redoStackRef']
  isDirty: W['isDirty']
  cutAtPlayhead: W['cutAtPlayhead']
  findSilences: W['findSilences']
  setSilenceOpen: W['setSilenceOpen']
  toggleSnap: W['toggleSnap']

  // ---- 段（トラック）----
  selectTrack: W['selectTrack']
  toggleTrack: W['toggleTrack']
  addVideoTrack: W['addVideoTrack']
  addAudioTrack: W['addAudioTrack']
  /** 段の高さを既定へ戻す（保存してある物を捨てる） */
  resetLaneH: W['resetLaneH']
  addBgm: W['addBgm']
  setTracks: W['setTracks']
  askText: W['askText']
  fallbackTrack: W['fallbackTrack']

  // ---- 再生ヘッド ----
  stopPlayback: W['stopPlayback']
  seekTo: W['seekTo']
}

/**
 * 束の**中身をここで集める**（2026-08-04）。
 *
 * 前は配線（`useAppWiring`）が55個を心臓から取り出し、この束へ詰め直して、
 * また心臓へ入れていた——**往復**（`npm run passthrough` の②）。
 * 取り出す所と詰める所が同じなら、間の配線は要らない。
 *
 * **返り値は配線がそのまま返す。** そうすると `Wired<'timelineOps'>` の
 * 引き先が変わらず、受け口の型（下の interface）も検査（`ctxTypes`）も
 * 1行も動かさずに済む。
 *
 * 引数の1つだけは配線に残る——`openClipMenu` は**このファイルにしか実体が無い糊**で、
 * 選択の見直しと品書きを同時に触るのでどの心臓の持ち物でもない。
 */
export function useTimelineOpsValue(deps: { openClipMenu: OpenClipMenu }) {
  const { removeKeyAtTime } = useMotionCtx()
  const {
    onClipPointerDown, onClipContextMenu, onTrimStart, onSePointerDown, onImgPointerDown,
    onVClipPointerDown, onTrackAreaPointerDown, startScrub
  } = useTimelineDragCtx()
  const { onSegPointerDown, onSegTrimStart } = useSegmentDragCtx()
  const { onMarkerPointerDown } = useMarkersCtx()
  const { startGroupResize } = useLaneResizeCtx()
  const {
    startTransResize, resolveTransDrop, applyTransDrop, selectTransition, setVideoTransDur
  } = useTransitionsCtx()
  const { toggleTrack, setTracks } = useTracksCtx()
  const {
    updateDropGhost, clearDropGhosts, videoDropLane, placeSE, placeImage, imgLaneAt,
    placeDropped, placeVClip, addBgm
  } = useMediaDropCtx()
  const { dropLaneAt } = useLaneGeometryCtx()
  const { placeVideoAtDrop } = useSegmentPlaceCtx()
  const { snapClipStart } = useSnapCtx()
  const { draggingMediaRef, dragSeDurRef } = useDragPreviewCtx()
  const { draggingTransRef, draggingTelopAnimRef } = useBandDragCtx()
  const {
    resolveTelopTransDrop, applyTelopTransDrop, selectTelopTrans, patchCueAnim
  } = useTelopAnimCtx()
  const { undo, redo, undoStackRef, redoStackRef, isDirty } = useHistoryCtx()
  const { cutAtPlayhead, findSilences } = useTimelineEditCtx()
  const { setSilenceOpen } = useSilenceDuckCtx()
  const { toggleSnap } = useAppChromeCtx()
  const { selectTrack, addVideoTrack, addAudioTrack, fallbackTrack } = useTracksAdminCtx()
  const { resetLaneH } = useLaneHeightsCtx()
  const { askText } = useAskCtx()
  const { stopPlayback, seekTo } = usePlaybackEngineCtx()
  return {
    removeKeyAtTime,
    onClipPointerDown, onClipContextMenu, onTrimStart, onSegPointerDown, onSegTrimStart,
    onSePointerDown, onImgPointerDown, onVClipPointerDown, onMarkerPointerDown,
    onTrackAreaPointerDown, startScrub, startGroupResize, startTransResize,
    openClipMenu: deps.openClipMenu,
    updateDropGhost, clearDropGhosts, dropLaneAt, videoDropLane, placeSE, placeImage,
    imgLaneAt, placeDropped,
    placeVClip, placeVideoAtDrop, snapClipStart, draggingMediaRef, draggingTransRef,
    draggingTelopAnimRef, dragSeDurRef,
    resolveTransDrop, applyTransDrop, selectTransition, setVideoTransDur,
    resolveTelopTransDrop, applyTelopTransDrop, selectTelopTrans, patchCueAnim,
    undo, redo, undoStackRef, redoStackRef, isDirty, cutAtPlayhead, findSilences,
    setSilenceOpen, toggleSnap,
    selectTrack, toggleTrack, addVideoTrack, addAudioTrack, addBgm, resetLaneH, setTracks,
    askText, fallbackTrack, stopPlayback, seekTo
  }
}

const Ctx = createContext<TimelineOps | null>(null)

export function TimelineOpsProvider({
  value,
  children
}: {
  value: TimelineOps
  children: ReactNode
}): React.JSX.Element {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** タイムラインの操作の入口を見に行く。囲いの外で呼んだら、その場で落とす */
export function useTimelineOps(): TimelineOps {
  const v = useContext(Ctx)
  if (!v) throw new Error('useTimelineOps は TimelineOpsProvider の中でしか使えません')
  return v
}
