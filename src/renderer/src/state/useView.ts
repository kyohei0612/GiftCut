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

import { useCallback, useEffect, useRef, useState } from 'react'

/** 既定の拡大率（px / 秒） */
export const DEFAULT_ZOOM = 24

// ## 寄れる限界（px / 秒）
//
// **上限は 240。** 以前は 120 だったが、テロップの出入りの動き（0.05〜2秒）や
// フレーム単位の合わせでは 120 でも足りず、限界まで寄せても帯が細いままだった。
// 倍にすると、1秒が画面の4分の1ほどを占める＝コマの境目まで見える。
//
// **下限の 6 は「ここから更に下げてよい床」**（2026-08-03 に意味が変わった）。
//
// 前は 6 が本当の下限で、理由は「これより引くとクリップが線になって掴めない。
// 全体を見たいときは↔（フィット）がある」だった。**その逃げ道も塞がっていた**
// ——`fitTimelineZoom` も 6 で頭打ちしていたので、**長い素材では ↔ を押しても
// 全体が見えなかった**（451秒の実データだと 2,706px 要る）。
//
// いまはプレミアと同じで「目一杯引いたら全体が見える」。実際の下限は
// **`shared/zoomBar` の `minZoom`**（＝この床と、全体が収まる率の小さい方）で、
// 拡大バーの端・Ctrl+ホイール・↔ の3つとも同じ所を通る。
// ここの 6 は、短い素材で「全体より更に引ける」ぶんを残すためだけに効く。
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
  /** **値だけ受ける**（関数で渡さない。理由は下） */
  setZoom: (v: number) => void
  /** 掴んでいる最中に読む用（描き直しを待たない） */
  zoomRef: React.MutableRefObject<number>
}

export function useView(): View {
  const [zoom, setZoomState] = useState(DEFAULT_ZOOM)
  const zoomRef = useRef(DEFAULT_ZOOM)

  /**
   * **控えは、その場で書く。**
   *
   * ## なぜ useEffect ではいけないか（2026-08-06）
   *
   * 前は `useEffect(() => { zoomRef.current = zoom }, [zoom])` だった。
   * 控えが新しくなるのは**描き直しが済んだ後**。
   *
   * ところがホイールは**1フレームに何発も来る**（トラックパッドや、
   * ホイールを勢いよく回したとき）。ホイールの処理はその場その場で
   * `zoomRef.current` を読んで次の倍率を出すので、
   * **同じフレームに来た分は全部が同じ古い値から計算する**
   * ——結果、何発回しても**1フレームぶんしか進まない**。
   *
   * 実測: Ctrl+ホイールを一度に30発送って、引き切れずに止まった
   * （中身 4928px。バーで引き切ると 1456px まで行く）。
   * **入口によって行ける所が違う**状態で、しかも「効きが悪い」としか見えない。
   *
   * → 控えを先に書く。描き直しは後から追いつけばよい
   *  （画面に出る値は state の方で、こちらは「いまこの瞬間」を読む用）。
   *
   * **関数で渡す形（`setZoom(p => p + 1)`）は受けない。** 受けると
   * ここで新しい値が分からず、控えを書けない。呼ぶ側は全部が値渡し
   * （2026-08-06 時点で6か所とも）。
   */
  const setZoom = useCallback((v: number): void => {
    zoomRef.current = v
    setZoomState(v)
  }, [])

  // 別の道（前回の続きの復元など）で state が変わったときの取りこぼし止め
  useEffect(() => {
    zoomRef.current = zoom
  }, [zoom])

  return { zoom, setZoom, zoomRef }
}
