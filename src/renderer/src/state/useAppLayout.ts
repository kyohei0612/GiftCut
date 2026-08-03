// 画面の配置（区画の切り離し・幅と高さ・タブ帯）を覚えて、次に開いたとき同じ形で始める。
//
// ## 保存するその場で読む
//
// 「今のこの状態」が戻らないと意味が無い。窓の大きさ・位置は React の状態ではなく
// **実物から読む**（窓を動かしても描き直しは起きないので、状態に持つと必ず古くなる）。
//
// ## 切り離した窓は行方不明にならないようにする
//
// モニターを外して起動すると、覚えていた位置が画面の外になる。
// 位置を当てるときは画面の中へ収める。
//
// ## タブ帯には3つの逃げ道を用意する
//
// パネルを狭めるとタブが端から切れて、奥のタブへ一生たどり着けなかった。
//   1. 端の「送り」ボタン（押しっぱなしで送り続ける）
//   2. 「≫」から、いま見えていないタブを一覧で選ぶ
//   3. 掴んで横に引っぱる
//
// 並び順は勝手に変わらないよう固定。変えたいときだけ右クリックから動かす。
// **知らないタブは後ろに残す**（項目が増えても消えない）。
//
// ## 品書きは画面の中へ収める
//
// 押した場所にそのまま出していたので、画面の下や右の端で押すと項目がはみ出して
// 選べなかった。出したあとに測って、はみ出していたら内側へ寄せる。

import { useEffect, useState } from 'react'
import { readPaneGeometry } from '../components/PaneWindow'
import type { PaneId } from './usePanelLayout'
import { useToastCtx } from './toastContext'

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface UseAppLayoutDeps {
  /** 区画の名前（画面に出す文言） */
  PANE_LABEL: Record<string, string>
  /** 切り離している区画と、その窓の大きさ・位置 */
  popped: any
  setPopped: React.Dispatch<React.SetStateAction<Partial<Record<PaneId, true>>>>
  paneGeom: any
  setPaneGeom: any
  /** 幅・高さ */
  leftW: number
  setLeftW: any
  rightW: number
  setRightW: any
  timelineH: number
  setTimelineH: any
  videoTrackH: number
  setVideoTrackH: any
  audioTrackH: number
  setAudioTrackH: any
  /** タブの並び順と、いま選んでいるタブ */
  tabOrder: any
  setTabOrder: React.Dispatch<React.SetStateAction<Record<string, string[]>>>
  rightTab: string
  setRightTab: any
  monitorTab: string
  setMonitorTab: any
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function useAppLayout(deps: UseAppLayoutDeps) {
  const {
    PANE_LABEL, popped, setPopped, paneGeom, setPaneGeom,
    leftW, setLeftW, rightW, setRightW, timelineH, setTimelineH,
    videoTrackH, setVideoTrackH, audioTrackH, setAudioTrackH,
    tabOrder, setTabOrder, rightTab, setRightTab, monitorTab, setMonitorTab
  } = deps
  const { showToast } = useToastCtx()

  // 切り離した窓の大きさ・位置。開き直すときに使う
  function popPane(id: PaneId): void {
    setPopped((p) => ({ ...p, [id]: true }))
    showToast(`${PANE_LABEL[id]} を切り離しました。窓を閉じると元に戻ります。`)
  }

  // ---- 画面の配置（保存して、次に開いたときに同じ形で始めるためのもの）----
  //
  // 「今のこの状態」が戻らないと意味が無いので、**保存するその場で読む**。
  // 窓の大きさ・位置は React の状態ではなく実物から読む（動かしても
  // 描き直しは起きないので、状態に持つと必ず古くなる）。
  const layoutNow = (): Record<string, unknown> => ({
    panes: (Object.keys(popped) as PaneId[]).filter((id) => popped[id]),
    geom: { ...paneGeom, ...readPaneGeometry() },
    leftW,
    rightW,
    timelineH,
    videoTrackH,
    audioTrackH,
    tabOrder,
    rightTab,
    monitorTab
  })
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const applyLayout = (l: any): void => {
    if (!l || typeof l !== 'object') return
    const num = (v: unknown, set: (n: number) => void): void => {
      if (typeof v === 'number' && Number.isFinite(v)) set(v)
    }
    num(l.leftW, setLeftW)
    num(l.rightW, setRightW)
    num(l.timelineH, setTimelineH)
    num(l.videoTrackH, setVideoTrackH)
    num(l.audioTrackH, setAudioTrackH)
    if (l.tabOrder && typeof l.tabOrder === 'object') setTabOrder(l.tabOrder)
    if (typeof l.rightTab === 'string') setRightTab(l.rightTab)
    if (l.monitorTab === 'program' || l.monitorTab === 'mixer') setMonitorTab(l.monitorTab)
    if (l.geom && typeof l.geom === 'object') setPaneGeom(l.geom)
    if (Array.isArray(l.panes)) {
      const next: Partial<Record<PaneId, true>> = {}
      for (const raw of l.panes as unknown[]) {
        const id = String(raw)
        if (id === 'left' || id === 'right' || id === 'preview' || id === 'timeline') next[id] = true
      }
      setPopped(next)
    }
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */

  /** 保存した並び順を当てる。知らないタブは後ろに残す（項目が増えても消えない） */
  function orderedTabs<T extends { id: string }>(group: string, tabs: T[]): T[] {
    const saved = tabOrder[group]
    if (!saved?.length) return tabs
    const byId = new Map(tabs.map((t) => [t.id, t]))
    const out = saved.map((id: string) => byId.get(id)).filter((t: T | undefined): t is T => !!t)
    for (const t of tabs) if (!out.includes(t)) out.push(t)
    return out
  }
  function moveTab(group: string, tabs: { id: string }[], id: string, dir: -1 | 1 | 'head' | 'tail'): void {
    const cur = orderedTabs(group, tabs).map((t) => t.id)
    const i = cur.indexOf(id)
    if (i < 0) return
    cur.splice(i, 1)
    const at =
      dir === 'head' ? 0 : dir === 'tail' ? cur.length : Math.max(0, Math.min(cur.length, i + dir))
    cur.splice(at, 0, id)
    setTabOrder((p) => ({ ...p, [group]: cur }))
  }
  const [tabMenu, setTabMenu] = useState<{
    x: number
    y: number
    group: string
    id: string
    label: string
  } | null>(null)
  const [tabOverflow, setTabOverflow] = useState<{
    x: number
    y: number
    group: string
    hidden: string[]
  } | null>(null)
  useEffect(() => {
    if (!tabMenu && !tabOverflow) return
    const close = (): void => {
      setTabMenu(null)
      setTabOverflow(null)
    }
    // Escape でも閉じる。閉じられないと、裏のタブが押せなくなる
    const onEsc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('click', close)
    window.addEventListener('keydown', onEsc)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', onEsc)
    }
  }, [tabMenu, tabOverflow])

  /** タブの一覧（≫）とその並び順メニューで使う、グループごとのタブ定義 */
  const TAB_DEFS: Record<string, { id: string; label: string }[]> = {
    right: [
      { id: 'project', label: 'プロジェクト' },
      { id: 'telop', label: 'テロップ' },
      { id: 'icon', label: 'アイコン' },
      { id: 'se', label: 'SE' },
      { id: 'transition', label: 'トランジション' }
    ],
    monitor: [
      { id: 'program', label: 'プログラム' },
      { id: 'mixer', label: 'オーディオミキサー' }
    ]
  }
  const pickTab = (group: string, id: string): void => {
    if (group === 'right') setRightTab(id as typeof rightTab)
    else if (group === 'monitor') setMonitorTab(id as typeof monitorTab)
  }

  /**
   * 右クリックメニューを画面の中に収める。
   *
   * メニューは押した場所にそのまま出していたので、画面の下や右の端で押すと
   * 項目がはみ出して選べなかった（項目を増やしたときに実際に起きた）。
   * 出したあとに位置を測って、はみ出していたら内側へ寄せる。
   */
  const clampMenu = (el: HTMLDivElement | null): void => {
    if (!el) return
    const pad = 8
    const r = el.getBoundingClientRect()
    if (r.bottom > window.innerHeight - pad)
      el.style.top = `${Math.max(pad, window.innerHeight - pad - r.height)}px`
    if (r.right > window.innerWidth - pad)
      el.style.left = `${Math.max(pad, window.innerWidth - pad - r.width)}px`
  }

  return {
    popPane, layoutNow, applyLayout, orderedTabs, moveTab, TAB_DEFS, pickTab, clampMenu,
    tabMenu, setTabMenu, tabOverflow, setTabOverflow
  }
}
