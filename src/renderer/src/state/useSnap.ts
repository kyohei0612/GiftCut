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
// ## 寄せるのは「掴んだ物」ではなく「動かしている束の全体」
//
// テロップをまとめて選んで動かすとき、掴んだ1つの頭だけを見ていると、
// 束の左端・右端はどこにも合わない。**束の頭とケツ**を寄せ先に照らす。
// 1つだけ選んでいるときも同じ道を通る（＝そのテロップの頭とケツ。
// 前は頭しか見ていなかったので「ケツに吸着が効かない」状態だった）。
//
// ## 元の位置も寄せ先にする
//
// 上下の段へ動かすだけのつもりでも、横に少し動けば近くの端に吸い付いて
// **横位置がずれる**。動かす前の位置を寄せ先に足しておけば、そこへ戻ってくる。
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
import { vcLen } from '../../../shared/timeline'

/**
 * 吸い付く距離（画面px）。
 *
 * **画面pxで持つ。** 秒で持つと、拡大するほど吸い付きが強くなって
 * 「近づけただけで勝手に付く」ようになり、細かく置けなくなる。
 * 見た目の距離で決めれば、どの拡大率でも手応えが同じになる。
 *
 * 8px では弱く「合わせたいのに付かない」と言われたので 18px にした。
 * これ以上広げると、隣の端まで巻き込んで**狙っていない所へ付く**。
 */
const SNAP_PX = 18
import type { SegLayout } from '../lib/projectTypes'
import { useDoc } from './contentContext'
import { usePlaybackCtx } from './playbackContext'
import { useViewCtx } from './viewContext'
import { useDragPreviewCtx } from './dragPreviewContext'

export interface UseSnapDeps {
  /** マグネットが入っているか */
  snap: boolean
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
    excludeVcIds?: number[],
    /**
     * テロップをまとめて動かすときに使う。
     * `cues`＝動かしている物を寄せ先から外す（自分に吸い付かないように）、
     * `extra`＝元の位置など、その場かぎりの寄せ先を足す。
     */
    more?: { cues?: number[]; extra?: number[] }
  ) => number
}

export function useSnap(deps: UseSnapDeps): Snap {
  const { snap, segLayoutRef } = deps
  const { cues, seClipsRef, imgClipsRef, vClipsRef, markersRef } = useDoc()
  const { currentTimeRef } = usePlaybackCtx()
  const { zoomRef } = useViewCtx()
  const { setSnapLineX } = useDragPreviewCtx()

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
        targets.push(c.tStart, c.tStart + vcLen(c)) // 映像レイヤー端
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
    const thr = SNAP_PX / zoomRef.current // ドラッグ中のズーム変更にも追従するよう ref を参照
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
    excludeVcIds: number[] = [],
    more?: { cues?: number[]; extra?: number[] }
  ): number {
    if (!snap) {
      setSnapLineX(null)
      return Math.max(0, tStart)
    }
    // どこへ寄せるかの判定は shared/snap（画面を起動せずに確かめられる）。
    // 画面側の仕事は「当て先を集めて、縦線を出す」ところまで。
    const targets = snapTargets(more?.cues ?? [], excludeSeIds, excludeImgIds, excludeVcIds)
    if (more?.extra) targets.push(...more.extra)
    const r = nearestSnap(tStart, dur, targets, SNAP_PX / zoomRef.current)
    setSnapLineX(r.line != null ? r.line * zoomRef.current : null)
    return r.start
  }

  return { snapTargets, snapTime, snapClipStart }
}
