// マグネット（吸着）。掴んで動かしている物を、近くの区切りへ寄せる。
//
// ## 寄せ先は6種類
//
// 再生ヘッド / 原点(0) / テロップの端 / 動画のカット位置 / 効果音・画像・映像レイヤーの端 /
// 目印。**自分自身の端は外す**（外さないと、自分の左端が自分の右端に吸い付いて動けない）。
//
// ## 効く距離は「画面で8px」
//
// 秒ではなく画面の距離で決める。秒で決めると、引いているときは吸着が強すぎて
// 置きたい所に置けず、寄っているときは弱すぎて効かない。
// 拡大率は**掴んでいる最中にも変わる**ので ref から読む。
//
// ## どこへ寄せるかの判定そのものは shared/snap
//
// 画面を起動せずに確かめられるように分けてある。こちら側の仕事は
// 「寄せ先を集めて、吸い付いた所に縦線を出す」まで。
//
// ## 切っているときは縦線を消す
//
// 消さずに戻ると、線だけが残って「まだ効いている」ように見える。

import { nearestSnap } from '../../../shared/snap'
import type { SegLayout } from '../lib/projectTypes'
import { useDoc } from './contentContext'
import { usePlaybackCtx } from './playbackContext'
import { useViewCtx } from './viewContext'

export interface UseSnapDeps {
  /** マグネットが入っているか */
  snap: boolean
  /** 吸い付いた所に出す縦線。useDragPreview は心臓（context）ではないので受け取る */
  setSnapLineX: (x: number | null) => void
  /** 切片の位置。掴んでいる最中に読むので ref */
  segLayoutRef: React.MutableRefObject<SegLayout[]>
}

export interface Snap {
  /** 寄せ先の時刻を全部集める */
  snapTargets: (
    excludeCueIds?: number[],
    excludeSeIds?: number[],
    excludeImgIds?: number[],
    excludeVcIds?: number[]
  ) => number[]
  /** 時刻を1つ寄せる（テロップの移動・端の摘み・目盛りを擦る） */
  snapTime: (
    t: number,
    excludeCueIds?: number[],
    excludeSeIds?: number[],
    excludeImgIds?: number[],
    excludeVcIds?: number[]
  ) => number
  /** クリップの左右どちらの端が近くても寄せて、直した開始時刻を返す */
  snapClipStart: (
    tStart: number,
    dur: number,
    excludeSeIds?: number[],
    excludeImgIds?: number[],
    excludeVcIds?: number[]
  ) => number
}

export function useSnap(deps: UseSnapDeps): Snap {
  const { snap, segLayoutRef, setSnapLineX } = deps
  const { cues, seClipsRef, imgClipsRef, vClipsRef, markersRef } = useDoc()
  const { currentTimeRef } = usePlaybackCtx()
  const { zoomRef } = useViewCtx()

  function snapTargets(
    excludeCueIds: number[] = [],
    excludeSeIds: number[] = [],
    excludeImgIds: number[] = [],
    excludeVcIds: number[] = []
  ): number[] {
    const targets = [currentTimeRef.current, 0] // 再生ヘッド・原点
    for (const c of cues) if (!excludeCueIds.includes(c.id)) targets.push(c.start, c.end) // テロップ端
    for (const L of segLayoutRef.current) targets.push(L.tStart, L.tEnd) // 動画カット位置
    for (const s of seClipsRef.current)
      if (!excludeSeIds.includes(s.id)) targets.push(s.tStart, s.tStart + s.duration) // SE端
    for (const c of imgClipsRef.current)
      if (!excludeImgIds.includes(c.id)) targets.push(c.tStart, c.tStart + c.duration) // 画像端
    for (const c of vClipsRef.current)
      if (!excludeVcIds.includes(c.id))
        targets.push(c.tStart, c.tStart + Math.max(0.05, c.srcEnd - c.srcStart)) // 映像レイヤー端
    for (const m of markersRef.current) targets.push(m.t) // マーカー位置
    return targets
  }
  // 単一の時刻を吸着（テロップ移動・トリム・スクラブ用）
  function snapTime(
    t: number,
    excludeCueIds: number[] = [],
    excludeSeIds: number[] = [],
    excludeImgIds: number[] = [],
    excludeVcIds: number[] = []
  ): number {
    if (!snap) {
      setSnapLineX(null)
      return Math.max(0, t)
    }
    const targets = snapTargets(excludeCueIds, excludeSeIds, excludeImgIds, excludeVcIds)
    const thr = 8 / zoomRef.current // ドラッグ中のズーム変更にも追従するよう ref を参照
    let best = t
    let bestD = thr
    let snapped = false
    for (const tg of targets) {
      const d = Math.abs(tg - t)
      if (d < bestD) {
        bestD = d
        best = tg
        snapped = true
      }
    }
    setSnapLineX(snapped ? Math.max(0, best) * zoomRef.current : null)
    return Math.max(0, best)
  }
  // クリップ（SE等）の左右どちらの端が近くても吸着し、補正後の開始時刻を返す
  function snapClipStart(
    tStart: number,
    dur: number,
    excludeSeIds: number[] = [],
    excludeImgIds: number[] = [],
    excludeVcIds: number[] = []
  ): number {
    if (!snap) {
      setSnapLineX(null)
      return Math.max(0, tStart)
    }
    // どこへ寄せるかの判定は shared/snap（画面を起動せずに確かめられる）。
    // 画面側の仕事は「当て先を集めて、縦線を出す」ところまで。
    const targets = snapTargets([], excludeSeIds, excludeImgIds, excludeVcIds)
    const r = nearestSnap(tStart, dur, targets, 8 / zoomRef.current)
    setSnapLineX(r.line != null ? r.line * zoomRef.current : null)
    return r.start
  }

  return { snapTargets, snapTime, snapClipStart }
}
