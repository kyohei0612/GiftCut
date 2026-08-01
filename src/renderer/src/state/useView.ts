// タイムラインの見え方（横の拡大率）。
//
// ## なぜ ref も一緒に持つか
//
// **拡大率は「描くとき」と「掴んでいる最中」の両方から読む。**
// 掴んでいる最中は毎フレーム読むので、描き直しを待つ state ではなく
// ref から読む必要がある。2つを別々の場所に置くと、
// **片方だけ古いまま**になって「掴んだ位置と実際の位置がずれる」。
//
// ここでは state を変えたら ref も必ず追いつくように、1か所で面倒を見る。

import { useEffect, useRef, useState } from 'react'

/** 既定の拡大率（px / 秒） */
export const DEFAULT_ZOOM = 24

// ## 寄れる限界（px / 秒）
//
// **上限は 240。** 以前は 120 だったが、テロップの出入りの動き（0.05〜2秒）や
// フレーム単位の合わせでは 120 でも足りず、限界まで寄せても帯が細いままだった。
// 倍にすると、1秒が画面の4分の1ほどを占める＝コマの境目まで見える。
//
// **下限は 6 のまま。** これより引くと、1時間の素材でも全体が画面に収まってしまい、
// クリップが線になって掴めない。全体を見たいときは「↔（フィット）」がある。
export const ZOOM_MIN = 6
export const ZOOM_MAX = 240

/**
 * 読み直した拡大率を、使える範囲へ収める。
 *
 * **保存してある値をそのまま信じない。** 0 や NaN が入ると、
 * 秒→px の掛け算が全部 0／NaN になり、クリップも目盛りも消えて
 * 「起動したら中身が無い」になる。壊れていたら既定へ戻す
 * （段の高さを読み直すとき（useLaneHeights）と同じ考え方）。
 */
export function clampZoom(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return DEFAULT_ZOOM
  return Math.min(Math.max(v, ZOOM_MIN), ZOOM_MAX)
}

export interface View {
  zoom: number
  setZoom: React.Dispatch<React.SetStateAction<number>>
  /** 掴んでいる最中に読む用（描き直しを待たない） */
  zoomRef: React.MutableRefObject<number>
}

export function useView(): View {
  const [zoom, setZoom] = useState(DEFAULT_ZOOM)
  const zoomRef = useRef(DEFAULT_ZOOM)
  useEffect(() => {
    zoomRef.current = zoom
  }, [zoom])
  return { zoom, setZoom, zoomRef }
}
