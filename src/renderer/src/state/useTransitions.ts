// つなぎ目の演出（トランジション）。選ぶ・付ける・長さを変える・外す。
//
// ## 帯は「実際に効いている区間」に描く
//
// 頭・尻・間（クロスフェード）の3種類があり、どこに何秒ぶん効くかは切片の並びで決まる。
// 見た目と実際の効き方がずれると、詰めたはずの所で音だけ残る。
//
// ## 落とす場所の判定に駐禁を作らない
//
// どこへ落としても必ずどれかに決まる（置けない場所を作らない）。
// カットの境目の近く（画面で22px）なら「間」、それ以外はクリップの
// 前半なら頭・後半なら尻。**種類は関係ない**（どの演出でも同じ判定）。
//
// ## 迷子の演出は捨てる
//
// クリップを消したり並べ替えたりすると、どこにも掛からない演出が残る。
// 残ったままだと、書き出しのときだけ知らない所に効く。

import { clamp, layoutSegs, xfadeDurAt } from '../../../shared/timeline'
import { transIco } from '../lib/transitions'
import type { SegTrans, TransType } from '../lib/transitions'
import type { SegLayout, VSeg } from '../lib/projectTypes'
import { useDoc } from './contentContext'
import { useSel } from './selectionContext'
import { useViewCtx } from './viewContext'

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface UseTransitionsDeps {
  segLayout: SegLayout[]
  segLayoutRef: React.MutableRefObject<SegLayout[]>
  /** いま演出を掴んで運んでいるか */
  draggingTransRef: React.MutableRefObject<{ type: TransType } | null>
  trackInnerRef: React.RefObject<HTMLDivElement>
  setRightTab: any
  clearSegSel: () => void
  mainLocked: () => boolean
  showToast: any
  transDur: number
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function useTransitions(deps: UseTransitionsDeps) {
  const {  segLayoutRef, draggingTransRef, trackInnerRef, setRightTab,  mainLocked, showToast, transDur } = deps
  const { segments, setSegments } = useDoc()
  const {
    selectedTrans, setSelectedTrans, setSelectedIds, setSelectedTrackId, setEditingId,
    setSelectedVideoIds, setSelectedAudioIds, setSelectedSeIds, 
     setSelectedTelopTrans, setVideoSelected
  } = useSel()
  const { zoomRef } = useViewCtx()

  // タイムラインのトランジション枠を選択（動画クリップは選択しない＝トランジションだけを編集対象に）。
  function selectTransition(segId: number, kind: 'in' | 'out' | 'xfade'): void {
    setSelectedTrackId(null)
    setSelectedIds([])
    setEditingId(null)
    setSelectedVideoIds([])
    setSelectedAudioIds([])
    setSelectedSeIds([])
    setVideoSelected(false)
    setSelectedTelopTrans(null)
    setSelectedTrans({ segId, kind })
    setRightTab('transition') // 設定パネルを開く
  }
  // 選択中トランジションの or 指定 seg/kind の1プロパティ(dur/type)を更新するヘルパー。
  function patchSegTrans(
    segId: number,
    kind: 'in' | 'out' | 'xfade',
    patch: Partial<SegTrans>
  ): void {
    const key = kind === 'in' ? 'transIn' : kind === 'out' ? 'transOut' : 'xfade'
    setSegments((prev) =>
      prev.map((s) => (s.id === segId && s[key] ? { ...s, [key]: { ...s[key], ...patch } } : s))
    )
  }
  // 選択中トランジションの長さ／種類を変更。
  function updateSelectedTransDur(dur: number): void {
    if (selectedTrans) patchSegTrans(selectedTrans.segId, selectedTrans.kind, { dur })
  }
  function setSelectedTransType(type: TransType): void {
    if (selectedTrans) patchSegTrans(selectedTrans.segId, selectedTrans.kind, { type })
  }
  // 選択中トランジションを削除。
  function deleteSelectedTrans(): void {
    if (!selectedTrans) return
    const { segId, kind } = selectedTrans
    setSegments((prev) =>
      prev.map((s) =>
        s.id !== segId
          ? s
          : kind === 'xfade'
            ? { ...s, xfade: undefined }
            : kind === 'in'
              ? { ...s, transIn: undefined }
              : { ...s, transOut: undefined }
      )
    )
    setSelectedTrans(null)
  }

  // タイムライン上でトランジションの端をドラッグして長さを変える（プレミア風）。
  // sign: ドラッグ方向→長さの符号（頭/尻/中央で異なる）。apply(dur) で実際の適用。
  function startTransResize(
    e: React.PointerEvent,
    startDur: number,
    sign: number,
    apply: (d: number) => void,
    maxDur = 2
  ): void {
    e.stopPropagation()
    e.preventDefault()
    const startX = e.clientX
    const z = zoomRef.current
    // 上限は選択パネルのスライダー(max=2s)と揃える（表示矛盾を防ぐ）
    const cap = Math.min(maxDur, 2)
    const onMove = (ev: PointerEvent): void => {
      apply(clamp(startDur + (sign * (ev.clientX - startX)) / z, 0.05, cap))
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }
  // 動画トランジションの長さを直接設定（帯の端リサイズ用）。type は保持。
  function setVideoTransDur(segId: number, kind: 'in' | 'out' | 'xfade', dur: number): void {
    patchSegTrans(segId, kind, { dur })
  }

  // トランジションD&D: マウス位置で配置先を判別（駐禁なし＝どこでも置ける・種類は無関係）。
  // ・カット境界（クリップの境目）の近く → 間。
  // ・それ以外はクリップ本体で 前半=頭 / 後半=尻。
  const BOUNDARY_PX = 22 // カット境界の当たり幅（画面px）。この範囲に入ったら間。
  function resolveTransDrop(
    clientX: number
  ): {
    segId: number
    kind: 'in' | 'out' | 'xfade'
    left: number
    width: number
    label: string
  } | null {
    const drag = draggingTransRef.current
    const rect = trackInnerRef.current?.getBoundingClientRect()
    const lay = segLayoutRef.current
    if (!drag || !rect || !lay.length) return null
    const z = zoomRef.current
    const t = Math.max(0, (clientX - rect.left) / z)
    // 最寄りの内部カット（クリップの境目）を探す
    let cutIdx = -1
    let cutPx = Infinity
    for (let i = 0; i < lay.length - 1; i++) {
      const dpx = Math.abs(lay[i].tEnd - t) * z
      if (dpx < cutPx) {
        cutPx = dpx
        cutIdx = i
      }
    }
    // カット境界の近く → 間（左クリップに付与）。
    // **予告帯も「実際に掛かる区間」に出す＝カットの手前 d 秒。**
    // 置いたあとの帯と位置が食い違うと、置いた場所が動いたように見える。
    if (cutIdx >= 0 && cutPx <= BOUNDARY_PX) {
      const A = lay[cutIdx]
      const d = Math.min(transDur, A.len, lay[cutIdx + 1].len)
      return {
        segId: A.seg.id,
        kind: 'xfade',
        left: (A.len - d) * z,
        width: d * z,
        label: `間 ${transIco(drag.type)}`
      }
    }
    // 境界でない → クリップ本体で 前半=頭 / 後半=尻
    const L = lay.find((l) => t >= l.tStart && t < l.tEnd) ?? lay[lay.length - 1]
    const f = (t - L.tStart) / Math.max(1e-6, L.len)
    const w = Math.min(transDur, L.len) * z
    if (f < 0.5)
      return { segId: L.seg.id, kind: 'in', left: 0, width: w, label: `頭 ${transIco(drag.type)}` }
    return {
      segId: L.seg.id,
      kind: 'out',
      left: L.len * z - w,
      width: w,
      label: `尻 ${transIco(drag.type)}`
    }
  }
  // トランジションD&Dのドロップ確定。resolveTransDrop の判別（頭/間/尻）に drag.type を付与。
  function applyTransDrop(clientX: number): void {
    if (mainLocked()) return
    const drag = draggingTransRef.current
    const r = resolveTransDrop(clientX)
    if (!drag || !r) return
    const nt: SegTrans = { type: drag.type, dur: transDur }
    if (r.kind === 'xfade') {
      const next = segments.map((s, i) =>
        s.id === r.segId && i < segments.length - 1 ? { ...s, xfade: nt } : s
      )
      setSegments(next)
      const idx = next.findIndex((s) => s.id === r.segId)
      if (idx >= 0 && xfadeDurAt(layoutSegs(next), idx) <= 0)
        showToast(
          '次のクリップの頭に素材の余白がないため間トランジションが効きません。\n（次のクリップの頭を少しトリムすると余白ができます）'
        )
    } else {
      setSegments((prev) =>
        prev.map((s) => {
          if (s.id !== r.segId) return s
          if (r.kind === 'in') return { ...s, transIn: nt }
          return { ...s, transOut: nt }
        })
      )
    }
  }
  // 切片が消えたときに、隣に取り残されるトランジションを掃除する。
  // 残すと別の2クリップ間でディゾルブが勝手に復活する。
  function cleanupOrphanTrans(list: VSeg[], removedIds: Set<number>): VSeg[] {
    const out: VSeg[] = []
    for (let i = 0; i < list.length; i++) {
      const cur = list[i]
      if (removedIds.has(cur.id)) continue
      let g = cur
      if (i + 1 < list.length && removedIds.has(list[i + 1].id) && g.xfade)
        g = { ...g, xfade: undefined }
      if (i > 0 && removedIds.has(list[i - 1].id) && g.transIn) g = { ...g, transIn: undefined }
      out.push(g)
    }
    return out
  }

  return {
    selectTransition, patchSegTrans, updateSelectedTransDur, setSelectedTransType,
    deleteSelectedTrans, startTransResize, setVideoTransDur, resolveTransDrop,
    applyTransDrop, cleanupOrphanTrans
  }
}
