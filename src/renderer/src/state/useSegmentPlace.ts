// 本編の切片を「どこへ置くか」。動かす・新しく置く・落とした所へ置く。
//
// ## 切片は隙間なく並ぶ
//
// 重ねたクリップと違って、本編は切片が連続していることが前提。
// だから「動かす」は必ず**置き先を上書きするか、割り込んで後ろをずらすか**のどちらか。
//
//   move   … 置き先を上書きし、元の位置は空白になる。他は動かない
//   copy   … Alt。元を残して、複製を置き先へ上書き
//   insert … Ctrl。元の位置を詰めてから割り込む。後ろは文字・効果音・目印・画像ごとずれる
//
// ## 末尾より先に置いたら、隙間を空白で埋める
//
// 埋めないと切片の並びが飛び、以後の位置計算が全部ずれる。
//
// ## 1本目も落とした場所に置く
//
// 以前はここだけ先頭固定で、1本目にかぎってドロップ位置が無視されていた。
// 尺を先に取ってから読み込み、読み込み側の自動配置は止める。
//
// ## 位置の計算そのものは shared/timeline
//
// 画面を起動せずに確かめられるように分けてある。

import {
  cutRange, layoutSegs, moveSegTo, moveSegsTo, segTLen, totalSegLen
} from '../../../shared/timeline'
import type { SegDropMode } from '../../../shared/dragMode'
import { formatTime } from '../lib/srt'
import type { VSeg } from '../lib/projectTypes'
import { useDoc } from './contentContext'
import { useTracksCtx } from './tracksContext'
import { useToastCtx } from './toastContext'
import { useMediaCtx } from './mediaContext'

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface UseSegmentPlaceDeps {
  /** 本編（V1）に鍵が掛かっているか */
  mainLocked: () => boolean
  /** 切片を分ける・空白を作るの決まり（shared/timeline へ渡す形） */
  segOps: any
  segSplit: any
  /** 境目より後ろを、種類を跨いでまとめてずらす */
  shiftAfter: (boundaryT: number, delta: number) => void
  /** 素材を読む・登録する */
  loadVideo: any
  registerSource: any
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function useSegmentPlace(deps: UseSegmentPlaceDeps) {
  const { mainLocked, segOps, segSplit, shiftAfter, loadVideo, registerSource } = deps
  const {
    setCues, setSegments, segsRef, segIdCounter, setSeClips, setImgClips, setMarkers, setVClips
  } = useDoc()
  const { trackStates } = useTracksCtx()
  const { showToast } = useToastCtx()
  const { sourcesRef } = useMediaCtx()

  /**
   * タイムライン範囲 [tA, tB) を切り出して除去した切片配列を返す（プレミアの「上書き」の下ごしらえ）。
   * 端にかかる切片は速度を考慮してトリムし、insertAt ＝ 新クリップを挿す位置（配列index）を返す。
   */
  function cutRangeFromSegs(segs: VSeg[], tA: number, tB: number): { out: VSeg[]; insertAt: number } {
    return cutRange(segs, tA, tB, segSplit)
  }
  /**
   * 本編の切片をドラッグで動かしたときの確定処理（プレミア準拠）。
   *
   * - move  : 置き先を上書きし、元の位置は空白になる。他のクリップの位置は動かない。
   * - copy  : Alt。元はその場に残し、複製を置き先へ上書き配置する。
   * - insert: Ctrl。元の位置を詰めてから置き先で割り込む。後続はテロップ/SE/
   *           マーカー/画像ごと後ろへずれる。
   *
   * 位置の計算そのものは shared/timeline 側（moveSegTo）。
   */
  function moveSegmentTo(
    segId: number,
    t: number,
    mode: SegDropMode = 'move',
    alsoIds: number[] = []
  ): void {
    if (mainLocked()) return
    const segs = segsRef.current
    const idx = segs.findIndex((s) => s.id === segId)
    if (idx < 0) return
    const L = layoutSegs(segs)[idx]
    if (!L) return
    const tt = Math.max(0, t)
    // 複数の切片を選んで掴んだ場合は、相対位置を保ったまままとめて動かす。
    // 複製・割り込みは「1本を差し込む」操作なので、掴んだ1本だけを対象にする。
    const groupIdx = [...new Set([segId, ...alsoIds])]
      .map((id) => segs.findIndex((s) => s.id === id))
      .filter((i) => i >= 0)
    if (mode === 'move' && groupIdx.length > 1) {
      const out = moveSegsTo(segs, groupIdx, tt - L.tStart, segOps)
      if (out === segs) return
      setSegments(out)
      showToast(`${groupIdx.length} 個のクリップを移動しました。`, 'success')
      return
    }
    if (mode === 'copy') {
      placeSegAt({ ...L.seg, id: segIdCounter.current++ }, tt, false)
      return
    }
    if (mode === 'insert') {
      // 元の位置を詰める（後続のテロップ/SE/マーカー/画像も一緒に前へ）。
      // 詰めたぶん、元より後ろへ置く場合は目標位置も同じだけ手前に寄る。
      const target = tt > L.tStart ? Math.max(0, tt - L.len) : tt
      const rest = segs.filter((_, i) => i !== idx)
      shiftAfter(L.tEnd, -L.len)
      setSegments(rest)
      segsRef.current = rest // placeSegAt は segsRef を見るので先に反映させる
      placeSegAt(L.seg, target, true)
      return
    }
    const out = moveSegTo(segs, idx, tt, segOps)
    if (out === segs) return // 動いていない＝履歴を汚さない
    setSegments(out)
  }
  // 新しい切片をタイムライン位置 t へ配置（プレミア準拠）。
  // 既定=上書き: [t, t+len) の既存内容を置き換え、後続クリップの位置は変えない。
  // insert=true: t で分割して割り込み挿入し、後続（テロップ/SE/マーカー含む）を len ぶん後ろへシフト。
  // 末尾より先に置いた場合はギャップ（映像なし・無音の空白切片）で隙間を埋める。
  function placeSegAt(newSeg: VSeg, t: number, insert: boolean): void {
    const segsNow = segsRef.current
    const total = totalSegLen(segsNow)
    const len = segTLen(newSeg)
    if (t >= total - 1e-3) {
      const pieces: VSeg[] = []
      const gapLen = t - total
      if (gapLen > 0.05)
        pieces.push({
          id: segIdCounter.current++,
          srcId: newSeg.srcId,
          srcStart: 0,
          srcEnd: gapLen,
          videoBlank: true,
          muted: true,
          gap: true
        })
      pieces.push(newSeg)
      setSegments((prev) => [...prev, ...pieces])
      return
    }
    if (insert) {
      const { out, insertAt } = cutRangeFromSegs(segsNow, t, t) // 幅0=分割のみ
      out.splice(insertAt, 0, newSeg)
      setSegments(out)
      // 挿入位置より後ろのテロップ/SE/マーカーを新クリップぶん後ろへ（プレミアのインサート）
      setCues((prev) =>
        prev.map((c) => (c.start >= t - 1e-6 ? { ...c, start: c.start + len, end: c.end + len } : c))
      )
      setSeClips((prev) => prev.map((x) => (x.tStart >= t - 1e-6 ? { ...x, tStart: x.tStart + len } : x)))
      setMarkers((prev) => prev.map((m) => (m.t >= t - 1e-6 ? { ...m, t: m.t + len } : m)))
      setImgClips((prev) =>
        prev.map((c) => (c.tStart >= t - 1e-6 ? { ...c, tStart: c.tStart + len } : c))
      )
      setVClips((prev) =>
        prev.map((c) => (c.tStart >= t - 1e-6 ? { ...c, tStart: c.tStart + len } : c))
      )
    } else {
      const { out, insertAt } = cutRangeFromSegs(segsNow, t, Math.min(t + len, total))
      out.splice(insertAt, 0, newSeg)
      setSegments(out)
    }
  }
  // 動画をドロップ位置へ配置（タイムラインD&D）。insert=Ctrl押下で挿入、それ以外は上書き。
  async function placeVideoAtDrop(path: string, t: number, insert: boolean): Promise<void> {
    // V1 がロック中なら本編を書き換えない（画像/SE/映像レイヤーのドロップは
    // 既に拒否してトーストを出しているので、そこに揃える）
    if (trackStates['V1']?.locked) {
      showToast('このトラックはロックされています。')
      return
    }
    if (!sourcesRef.current.length) {
      // 最初の1本も「落とした位置」に置く。以前はここだけ先頭固定だったため、
      // 1本目にかぎってドロップ位置が無視され、勝手に頭から始まっていた。
      // 尺を先に取ってから読み込み、loadVideo 側の自動配置は止める。
      const d = await window.giftcut.getDuration(path)
      const dur = d?.ok && d.duration ? d.duration : 0
      if (dur <= 0) {
        showToast('動画の長さを取得できませんでした。', 'error')
        return
      }
      void loadVideo(path, { placed: true })
      // segIdCounter は loadVideo が同期的に 1 へ戻すので、採番はその後で行う
      placeSegAt({ id: segIdCounter.current++, srcStart: 0, srcEnd: dur }, Math.max(0, t), insert)
      return
    }
    const reg = await registerSource(path)
    if (!reg) return
    placeSegAt({ id: segIdCounter.current++, srcId: reg.id, srcStart: 0, srcEnd: reg.dur }, Math.max(0, t), insert)
    showToast(
      insert
        ? `${formatTime(t)} に挿入しました（後続は後ろへシフト）。`
        : `${formatTime(t)} に配置しました（上書き）。`,
      'success'
    )
  }

  return { cutRangeFromSegs, moveSegmentTo, placeSegAt, placeVideoAtDrop }
}
