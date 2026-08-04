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

import { createContext, useContext, useRef, useState, type ReactNode } from 'react'
import type { Wired } from './wiredValue'
// 束の中身の取り先。**配線を通さず、ここで集める**（下の useTimelineViewValue）
import { motionLabel } from './useLabelsPresets'
import { useAppChromeCtx } from './appChromeContext'
import { useLaneHeightsCtx } from './laneHeightsContext'
import { useMediaCtx } from './mediaContext'
import { useMediaMetaCtx } from './mediaMetaContext'
import { useSegLayoutCtx } from './segLayoutContext'
import { useShortcutPrefsCtx } from './shortcutPrefsContext'
import { useSilenceDuckCtx } from './silenceDuckContext'
import { useTimelineBoxCtx } from './timelineBoxContext'
import { useTimelineSpanCtx } from './timelineSpanContext'
import { useTrackGeomCtx } from './trackGeomContext'
import { useViewNavCtx } from './viewNavContext'

// 型は手で書かず、詰めている実体から引く。**なぜ・どう腐らないかは state/wiredValue.ts**
type W = Wired<'timelineView'>

export interface TimelineView {
  // ---- 帯を描くのに要る「読み方」----
  // 区画へ prop で渡していた物。**心臓を持っているのに prop も受ける**という
  // 二重の受け渡しになっていたので、こちらへ寄せた。
  cueTrack: W['cueTrack']
  vcLen: W['vcLen']
  srcOfSeg: W['srcOfSeg']
  pairedAudioOf: W['pairedAudioOf']
  trackNum: W['trackNum']
  motionLabel: W['motionLabel']
  /** 素材の下ごしらえ（波形をそのまま帯に出す） */
  mediaMeta: W['mediaMeta']
  /** 静かな所の探索結果（切る位置の下敷きを帯に出す） */
  silenceCut: W['silenceCut']
  shortcuts: W['shortcuts']
  /** 画面に出すタイムラインの長さ */
  duration: W['duration']

  // ---- いま持っている道具 ----
  tool: W['tool']
  setTool: W['setTool']
  /** マグネットが入っているか */
  snap: W['snap']

  // ---- 指している所 ----
  /** マウスが指している横位置（px）。目盛りの上に線を出す */
  hoverX: W['hoverX']
  setHoverX: W['setHoverX']
  /** 印を出し直す間隔を頭打ちにするための記録（秒60回で足りる） */
  lastHoverPaintRef: W['lastHoverPaintRef']

  // ---- 測り物 ----
  /** 切片の位置（秒）。横位置はここから決まる */
  segLayout: W['segLayout']
  /** 目盛りの刻み */
  rulerTicks: W['rulerTicks']
  /** 上下の余白 */
  padTop: W['padTop']
  padBottom: W['padBottom']
  /** その段の高さ（px） */
  trackHOf: W['trackHOf']
  /** 画面に出ているか。出ていない帯は作らない */
  inView: W['inView']

  // ---- 入れ物 ----
  /** 横スクロールする枠 */
  scrollRef: W['scrollRef']
  /** 目盛りとクリップが乗っている中身。**当たり判定はここを基準にする** */
  trackInnerRef: W['trackInnerRef']
  /** 段の見出しの中身（本体と一緒に縦へ送る） */
  thBodyRef: W['thBodyRef']
  /** 縦に送ったとき、見出し・掴み手・目盛りをついて来させる */
  syncTimelineVScroll: W['syncTimelineVScroll']

  // ---- 寄る・引く ----
  fitTimelineZoom: W['fitTimelineZoom']
}

/**
 * 束の**中身をここで集める**（2026-08-04）。理由は state/timelineOpsContext と同じ——
 * 取り出す所と詰める所が同じなら、間の配線は要らない（`npm run passthrough` の②）。
 *
 * マウスの縦線（`hoverX`）だけは**ここで作る**。配線が持っていたが、
 * 読むのも書くのもタイムラインの見え方だけで、外へ出る先が1つも無かった。
 */
export function useTimelineViewValue() {
  const { cueTrack, vcLen, pairedAudioOf, trackNum, trackHOf } = useTrackGeomCtx()
  const { mediaMeta } = useMediaMetaCtx()
  const { srcOfSeg } = useMediaCtx()
  const { silenceCut } = useSilenceDuckCtx()
  const { shortcuts } = useShortcutPrefsCtx()
  const { duration, rulerTicks } = useTimelineSpanCtx()
  const { tool, setTool, snap } = useAppChromeCtx()
  const { segLayout } = useSegLayoutCtx()
  const { padTop, padBottom } = useLaneHeightsCtx()
  const { inView, scrollRef, trackInnerRef, thBodyRef, syncTimelineVScroll } = useTimelineBoxCtx()
  const { fitTimelineZoom } = useViewNavCtx()
  /** マウスの縦線を出す位置（タイムラインの上をなぞっている所） */
  const [hoverX, setHoverX] = useState<number | null>(null)
  /** マウスの印の間引き用（毎回描くと動かすだけで重くなる） */
  const lastHoverPaintRef = useRef(0)
  return {
    cueTrack, vcLen, mediaMeta, srcOfSeg, pairedAudioOf, trackNum, motionLabel,
    silenceCut, shortcuts, duration,
    tool, setTool, snap,
    hoverX, setHoverX, lastHoverPaintRef,
    segLayout, rulerTicks, padTop, padBottom, trackHOf, inView,
    scrollRef, trackInnerRef, thBodyRef, syncTimelineVScroll,
    fitTimelineZoom
  }
}

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
