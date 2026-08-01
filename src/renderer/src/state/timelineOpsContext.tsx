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

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface TimelineOps {
  // ---- 掴む（クリップ・切片・目印・段の空き）----
  onClipPointerDown: any
  onClipContextMenu: any
  onTrimStart: any
  onSegPointerDown: any
  onSegTrimStart: any
  onSePointerDown: any
  onImgPointerDown: any
  onVClipPointerDown: any
  onMarkerPointerDown: any
  onTrackAreaPointerDown: any
  /** 目盛りを擦る */
  startScrub: any
  /** 段の高さをまとめて変える */
  startGroupResize: any
  /** つなぎ目の演出の端を掴む */
  startTransResize: any
  /** 右クリックの品書きを開く（押した1つを選び直してから） */
  openClipMenu: any

  // ---- 落とす（素材をタイムラインへ）----
  updateDropGhost: any
  clearDropGhosts: any
  dropLaneAt: any
  videoDropLane: any
  placeSE: any
  placeImage: any
  placeVClip: any
  placeVideoAtDrop: any
  snapClipStart: any
  /** いま掴んで運んでいる物（種類ごと） */
  draggingMediaRef: any
  draggingTransRef: any
  draggingTelopAnimRef: any
  dragSeDurRef: any

  // ---- つなぎ目の演出 ----
  resolveTransDrop: any
  applyTransDrop: any
  selectTransition: any
  setVideoTransDur: any
  /** テロップの出入りの動き */
  resolveTelopTransDrop: any
  applyTelopTransDrop: any
  selectTelopTrans: any
  patchCueAnim: any

  // ---- 道具立て（ツールバー）----
  undo: any
  redo: any
  undoStackRef: any
  redoStackRef: any
  isDirty: any
  cutAtPlayhead: any
  findSilences: any
  setSilenceOpen: any
  toggleSnap: any

  // ---- 段（トラック）----
  selectTrack: any
  toggleTrack: any
  addVideoTrack: any
  addAudioTrack: any
  addBgm: any
  setTracks: any
  askText: any
  fallbackTrack: any

  // ---- 再生ヘッド ----
  stopPlayback: any
  seekTo: any
}
/* eslint-enable @typescript-eslint/no-explicit-any */

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
