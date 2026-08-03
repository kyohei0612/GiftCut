// テロップの「出入りの演出」（頭・尻・テロップ同士の間）。
//
// ## なぜ分けてあるか
//
// 元は `state/useTelopEdit` に同居していたが、**ファイル自身のコメントが
// 2つの見出しで話題を分けていた**——「足す・書き換える」と「出入りの演出」。
// ここの10個は**互いにだけ呼び合い、向こうの関数を1つも呼ばない**（逆も同じ）。
// 線は最初から引かれていたので、そこで切った（2026-08-03。中身は変えていない）。
//
// ## 落とすと3分割で決まる
//
// テロップの帯へ演出を落とすとき、掴んだ位置で行き先が変わる:
//
//   前1/3 … 頭（in）
//   中1/3 … **次のテロップとの間**（左の尻＋右の頭に同じ物を付ける）
//   後1/3 … 尻（out）
//
// **駐禁は出さない。** どこへ落としても必ずどれかになる（次のテロップが無ければ尻）。
// 落とせない場所があると「なぜ置けないのか」を毎回考える羽目になる。

import { defaultAnim, hasAnim, type AnimIn, type TelopAnim } from '../lib/telopStyle'
import type { Cue } from '../lib/srt'
import { useDoc } from './contentContext'
import { useSel } from './selectionContext'
import { useToastCtx } from './toastContext'
import { useViewCtx } from './viewContext'

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface UseTelopAnimDeps {
  /** そのテロップが載っている段 */
  cueTrack: (c: Cue) => string
  /** その段が鍵で守られているか（守られていたら触らない） */
  telopLocked: (c: Cue) => boolean
  /** 演出の名前（吹き出しに出す） */
  motionLabel: (t: AnimIn) => string
  /** いま掴んで運んでいる演出（掴んでいなければ null） */
  draggingTelopAnimRef: any
  /** 落としたあとに開くタブ */
  setRightTab: any
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function useTelopAnim(deps: UseTelopAnimDeps) {
  const { cueTrack, telopLocked, motionLabel, draggingTelopAnimRef, setRightTab } = deps
  const { cues, setCues } = useDoc()
  const {
    selectedIds,
    setSelectedIds,
    setSelectedTrackId,
    setEditingId,
    setSelectedVideoIds,
    setSelectedAudioIds,
    setSelectedSeIds,
    setSelectedTrans,
    setVideoSelected,
    selectedTelopTrans,
    setSelectedTelopTrans
  } = useSel()
  const { showToast } = useToastCtx()
  const { zoomRef } = useViewCtx()

  function patchCueAnim(cueId: number, patch: Partial<TelopAnim>): void {
    setCues((prev) =>
      prev.map((c) => {
        if (c.id !== cueId) return c
        const cur = c.style.anim ?? defaultAnim()
        const next = { ...cur, ...patch }
        return { ...c, style: { ...c.style, anim: hasAnim(next) ? next : undefined } }
      })
    )
  }

  // 頭/尻にモーションを付与（長さは既存 or 既定0.3s）。
  function applyTelopAnimSide(cueId: number, kind: 'in' | 'out', type: AnimIn): void {
    const cur = cues.find((c) => c.id === cueId)?.style.anim ?? defaultAnim()
    if (kind === 'in') patchCueAnim(cueId, { in: type, inDur: cur.inDur > 0 ? cur.inDur : 0.3 })
    else patchCueAnim(cueId, { out: type, outDur: cur.outDur > 0 ? cur.outDur : 0.3 })
  }

  // 同じテロップトラック上で、指定テロップの直後に来る次のテロップ（間トランジション用）。
  function nextCueAfter(cue: Cue): Cue | null {
    const following = cues.filter(
      (c) => c.id !== cue.id && cueTrack(c) === cueTrack(cue) && c.start >= cue.end - 0.001
    )
    if (!following.length) return null
    return following.reduce((a, b) => (b.start < a.start ? b : a))
  }

  // テロップアニメD&D: テロップクリップ上のローカルXで 前半=in / 後半=out を判別。
  function resolveTelopTransDrop(
    cue: Cue,
    clientX: number,
    rect: DOMRect
  ): {
    kind: 'in' | 'out' | 'between'
    left: number
    width: number
    label: string
    outId?: number
    inId?: number
  } {
    // マウス位置で3分割: 前1/3=頭 / 中1/3=間(次テロップと) / 後1/3=尻。駐禁なし。
    const z = zoomRef.current
    const type = draggingTelopAnimRef.current?.type ?? 'fade'
    const len = cue.end - cue.start
    const wSec = Math.min(0.3, len)
    const w = wSec * z
    const bw = 0.3 // またぎ帯の総幅（各テロップに半分ずつ）
    const f = (clientX - rect.left) / Math.max(1, rect.width)
    if (f < 1 / 3)
      return { kind: 'in', left: cue.start * z, width: w, label: `頭 ${motionLabel(type)}` }
    if (f < 2 / 3) {
      // 間＝このテロップと次テロップの間。次が無ければ尻にフォールバック。
      const nb = nextCueAfter(cue)
      if (nb) {
        const boundary = (cue.end + nb.start) / 2
        return {
          kind: 'between',
          outId: cue.id,
          inId: nb.id,
          left: (boundary - bw / 2) * z,
          width: bw * z,
          label: `間 ${motionLabel(type)}（次のテロップと）`
        }
      }
    }
    return { kind: 'out', left: (cue.end - wSec) * z, width: w, label: `尻 ${motionLabel(type)}` }
  }

  function applyTelopTransDrop(cue: Cue, clientX: number, rect: DOMRect): void {
    if (telopLocked(cue)) return
    const drag = draggingTelopAnimRef.current
    if (!drag) return
    const r = resolveTelopTransDrop(cue, clientX, rect)
    if (r.kind === 'between' && r.outId != null && r.inId != null) {
      // 左テロップの尻＋右テロップの頭に同じモーション＝テロップ同士の間の切り替え
      applyTelopAnimSide(r.outId, 'out', drag.type)
      applyTelopAnimSide(r.inId, 'in', drag.type)
    } else {
      applyTelopAnimSide(cue.id, r.kind === 'between' ? 'in' : r.kind, drag.type)
    }
    // 落とした先を選んでおく（テンプレート・アイコンを落としたときと同じ扱い）。
    // 落とした直後は長さを詰めたくなるので、選ばれていないと押し直しが要る
    setSelectedIds(
      r.kind === 'between' && r.outId != null && r.inId != null ? [r.outId, r.inId] : [cue.id]
    )
  }

  // 帯クリックでテロップアニメを選択（クリップ本体は選択しない）。
  function selectTelopTrans(cueId: number, kind: 'in' | 'out'): void {
    setSelectedTrackId(null)
    setSelectedIds([])
    setEditingId(null)
    setSelectedVideoIds([])
    setSelectedAudioIds([])
    setSelectedSeIds([])
    setSelectedTrans(null)
    setVideoSelected(false)
    setSelectedTelopTrans({ cueId, kind })
    setRightTab('transition')
  }

  function updateTelopTransDur(dur: number): void {
    if (!selectedTelopTrans) return
    const { cueId, kind } = selectedTelopTrans
    patchCueAnim(cueId, kind === 'in' ? { inDur: dur } : { outDur: dur })
  }

  function setTelopTransType(type: AnimIn): void {
    if (!selectedTelopTrans) return
    const { cueId, kind } = selectedTelopTrans
    patchCueAnim(cueId, kind === 'in' ? { in: type } : { out: type })
  }

  function deleteSelectedTelopTrans(): void {
    if (!selectedTelopTrans) return
    const { cueId, kind } = selectedTelopTrans
    patchCueAnim(cueId, kind === 'in' ? { in: 'none' } : { out: 'none' })
    setSelectedTelopTrans(null)
  }

  // 強調（揺れ/脈動）は範囲を持たないので選択テロップにトグルで付与/解除。
  function toggleTelopEmphasis(em: 'shake' | 'pulse'): void {
    const ids = selectedIds.length ? selectedIds : selectedTelopTrans ? [selectedTelopTrans.cueId] : []
    if (!ids.length) {
      showToast('先にテロップを選択してください（またはタイムラインのテロップに帯をドラッグ）。')
      return
    }
    ids.forEach((id) => {
      const cur = cues.find((c) => c.id === id)?.style.anim
      patchCueAnim(id, { emphasis: cur?.emphasis === em ? 'none' : em })
    })
  }

  // `applyTelopAnimSide` と `nextCueAfter` は返さない。外から呼ぶ所が無く、
  // 前は返していたが誰も受け取っていなかった（return の中は noUnusedLocals が見ない）
  return {
    patchCueAnim,
    resolveTelopTransDrop,
    applyTelopTransDrop,
    selectTelopTrans,
    updateTelopTransDur,
    setTelopTransType,
    deleteSelectedTelopTrans,
    toggleTelopEmphasis
  }
}
