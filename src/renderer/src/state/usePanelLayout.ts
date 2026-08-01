// 画面の配置（左右のパネル幅・タイムラインの高さ）を持つ。
//
// ## なぜ最初にここを出したか
//
// **App.tsx から区画を切り出す前に、区画をまたぐ物をまとめる必要がある。**
// 試しに左パネルを部品にしてみたら、App から渡す物が **73個** になった。
// 内訳は状態22・操作51で、状態だけまとめても足りないことが分かった。
//
// そこで「状態＋その操作」を1つの塊として出す。ここはその最初の1つで、
// 作法を決めるための場所——**いちばん小さくて、外に手を伸ばさない塊**を選んだ。
// （測ったところ、アイコンの置き方は選択やプレビューの DOM に手を伸ばしていて
//   まだ切れない。配置は自分の仲間だけで閉じている。）

import { useEffect, useState } from 'react'
import { nextPanelSize, type PanelEdge } from './panelSize'
import type { PaneGeom } from '../components/PanelChrome'

/** 前に使っていた大きさを読む。無ければ既定値 */
function loadSize(key: string, def: number): number {
  try {
    const v = Number(localStorage.getItem(key))
    return Number.isFinite(v) && v > 0 ? v : def
  } catch {
    return def
  }
}

/** 切り離せるパネル */
export type PaneId = 'left' | 'right' | 'preview' | 'timeline'
// 窓の大きさ・位置の形は、窓を出す側（PanelChrome）が持っている物をそのまま使う。
// ここで似た型を作ると、片方だけ直したときに食い違う

/** 右パネルのタブの並び順を覚えておく鍵 */
const TAB_ORDER_KEY = 'gc.tabOrder'

export interface PanelLayout {
  leftW: number
  rightW: number
  timelineH: number
  setLeftW: (n: number) => void
  setRightW: (n: number) => void
  setTimelineH: (n: number) => void
  /** 境目を掴んだときに呼ぶ。離すまで追いかける */
  startResize: (edge: PanelEdge, e: { clientX: number; clientY: number; preventDefault: () => void }) => void

  /** どのタブを開いているか */
  leftTab: 'props' | 'motion'
  setLeftTab: React.Dispatch<React.SetStateAction<'props' | 'motion'>>
  monitorTab: 'program' | 'mixer'
  setMonitorTab: React.Dispatch<React.SetStateAction<'program' | 'mixer'>>
  /** タブの並び順（掴んで入れ替えられる。覚えておく） */
  tabOrder: Record<string, string[]>
  setTabOrder: React.Dispatch<React.SetStateAction<Record<string, string[]>>>

  /**
   * 別窓へ切り離しているパネル。
   *
   * **覚えさせない（localStorage に残さない）。** 起動しただけで窓が開くと、
   * モニターを外して起動したときに画面の外へ出たまま行方不明になる。
   */
  popped: Partial<Record<PaneId, true>>
  setPopped: React.Dispatch<React.SetStateAction<Partial<Record<PaneId, true>>>>
  isPopped: (id: PaneId) => boolean
  unpopPane: (id: PaneId) => void
  /** 切り離した窓の大きさ・位置（開き直すときに使う） */
  paneGeom: Record<string, PaneGeom>
  setPaneGeom: React.Dispatch<React.SetStateAction<Record<string, PaneGeom>>>
}

export function usePanelLayout(): PanelLayout {
  const [leftW, setLeftW] = useState(() => loadSize('gc.leftW', 250))
  const [rightW, setRightW] = useState(() => loadSize('gc.rightW', 300))
  // タイムラインの既定の高さ。
  //
  // 420 だと画面のほぼ半分をタイムラインが占め、**プレビューが枠の4割**しか
  // 使えていなかった（実測: 枠845pxに対し映像326px）。切り抜きは
  // 「プレビューを見ながらテロップを詰める」作業なので、映像側を優先する。
  // 配置は保存されるので、好みで広げればその形が次から続く。
  const [timelineH, setTimelineH] = useState(() => loadSize('gc.timelineH', 370))

  useEffect(() => {
    try {
      localStorage.setItem('gc.leftW', String(leftW))
      localStorage.setItem('gc.rightW', String(rightW))
      localStorage.setItem('gc.timelineH', String(timelineH))
    } catch {
      /* 保存できない環境では、その回だけの配置になる */
    }
  }, [leftW, rightW, timelineH])

  const startResize: PanelLayout['startResize'] = (edge, e) => {
    e.preventDefault()
    const sx = e.clientX
    const sy = e.clientY
    // **掴んだ時点の値を覚えておく。** 動くたびに現在値から足すと、
    // 取りこぼしたぶんだけずれていく（速く動かすと合わなくなる）
    const base = edge === 'left' ? leftW : edge === 'right' ? rightW : timelineH
    const set = edge === 'left' ? setLeftW : edge === 'right' ? setRightW : setTimelineH
    const onMove = (ev: PointerEvent): void => {
      const delta = edge === 'timeline' ? ev.clientY - sy : ev.clientX - sx
      set(nextPanelSize(edge, base, delta))
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      document.body.style.cursor = ''
    }
    document.body.style.cursor = edge === 'timeline' ? 'row-resize' : 'col-resize'
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  const [leftTab, setLeftTab] = useState<'props' | 'motion'>('props')
  const [monitorTab, setMonitorTab] = useState<'program' | 'mixer'>('program')
  const [tabOrder, setTabOrder] = useState<Record<string, string[]>>(() => {
    try {
      const v = JSON.parse(localStorage.getItem(TAB_ORDER_KEY) || '{}')
      return v && typeof v === 'object' ? v : {}
    } catch {
      return {}
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(TAB_ORDER_KEY, JSON.stringify(tabOrder))
    } catch {
      /* 保存できなくても動作には影響しない */
    }
  }, [tabOrder])

  // 切り離す＝**そのパネルを別の窓にする**。それだけ。
  // 以前は「画面の中で浮かせる」と「別ウィンドウで開く」の2つがあったが、
  // 窓なら本体の上にも別モニターにも自由に置けるので、分ける意味が無かった。
  //
  // **覚えさせない**（localStorage に残さない）。起動しただけで窓が開くと、
  // モニターを外して起動したときに画面の外へ出たまま行方不明になる。
  const [popped, setPopped] = useState<Partial<Record<PaneId, true>>>({})
  const [paneGeom, setPaneGeom] = useState<Record<string, PaneGeom>>({})

  return {
    leftW,
    rightW,
    timelineH,
    setLeftW,
    setRightW,
    setTimelineH,
    startResize,
    leftTab,
    setLeftTab,
    monitorTab,
    setMonitorTab,
    tabOrder,
    setTabOrder,
    popped,
    setPopped,
    isPopped: (id) => !!popped[id],
    unpopPane: (id) =>
      setPopped((p) => {
        const n = { ...p }
        delete n[id]
        return n
      }),
    paneGeom,
    setPaneGeom
  }
}
