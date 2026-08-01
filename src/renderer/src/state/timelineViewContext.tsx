// タイムラインの「見え方」を1か所に集める。どの道具を持っているか、どこを指しているか、
// 段がどの高さで、どこからどこまでを描くか。
//
// ## 操作の入口とは分けてある
//
// 掴む・落とす・押すは state/timelineOpsContext.tsx。
// 分けてあるのは**探す場所を決めるため**で、描き直しの回数は変わらない
//（どちらも毎レンダー作り直している。詳しくは向こうのファイル頭）。
//
// ## 位置は「秒 × 拡大率」だけで決まる
//
// 横は時間、縦は段の積み上げ。ここにある物を組み合わせれば、
// どの帯もどの印も同じ式で置ける。当たり判定も同じ基準（track-inner）で測る。
//
// ## 見えない物は描かない
//
// `inView` から外れた帯は作らない。並んでいる数だけ作ると、
// マウスを動かすたびに全部が作り直される（クリップ1000個で1操作 68ms かかっていた）。

import { createContext, useContext, type ReactNode } from 'react'

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface TimelineView {
  // ---- いま持っている道具 ----
  tool: any
  setTool: any
  /** マグネットが入っているか */
  snap: boolean

  // ---- 指している所 ----
  /** マウスが指している横位置（px）。目盛りの上に線を出す */
  hoverX: number | null
  setHoverX: any
  /** 印を出し直す間隔を頭打ちにするための記録（秒60回で足りる） */
  lastHoverPaintRef: any
  /** 落とそうとしている先の予告 */
  telopDrop: any
  setTelopDrop: any
  transDrop: any
  setTransDrop: any

  // ---- 測り物 ----
  /** 切片の位置（秒）。横位置はここから決まる */
  segLayout: any
  /** 目盛りの刻み */
  rulerTicks: any
  /** 上下の余白 */
  padTop: number
  padBottom: number
  /** その段の高さ（px） */
  trackHOf: (idOrKind: string) => number
  /** 画面に出ているか。出ていない帯は作らない */
  inView: (tStart: number, tEnd: number) => boolean

  // ---- 入れ物 ----
  /** 横スクロールする枠 */
  scrollRef: React.RefObject<HTMLDivElement>
  /** 目盛りとクリップが乗っている中身。**当たり判定はここを基準にする** */
  trackInnerRef: React.RefObject<HTMLDivElement>
  /** 段の見出しの中身（本体と一緒に縦へ送る） */
  thBodyRef: any
  /** 縦に送ったとき、見出し・掴み手・目盛りをついて来させる */
  syncTimelineVScroll: any

  // ---- 寄る・引く ----
  zoomAroundPlayhead: any
  fitTimelineZoom: any
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const Ctx = createContext<TimelineView | null>(null)

export function TimelineViewProvider({
  value,
  children
}: {
  value: TimelineView
  children: ReactNode
}): React.JSX.Element {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** タイムラインの見え方を見に行く。囲いの外で呼んだら、その場で落とす */
export function useTimelineView(): TimelineView {
  const v = useContext(Ctx)
  if (!v) throw new Error('useTimelineView は TimelineViewProvider の中でしか使えません')
  return v
}
