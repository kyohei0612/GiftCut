// パネルの境目を掴んで動かしたとき、どこまで動かせるか。
//
// ## なぜ画面から出すか
//
// **数字が式の途中に直接書いてあった。**
//
//   setLeftW(clamp(sLeft + (ev.clientX - sx), 170, 520))
//
// この 170 と 520 が何なのかは、掴んで動かして端に当たるまで分からない。
// 狭すぎて中身が読めない／広すぎてプレビューが潰れる、はどちらも
// 「動かしてみて初めて気づく」類で、直すときも当てずっぽうになる。
//
// 名前を付けて外に出せば、限界がいくつなのかを読んで分かるようになり、
// 画面を起動せずに確かめられる。

/** 掴める境目と、その動かせる範囲（px） */
export const PANEL_LIMITS = {
  /** 左パネル。狭いと項目名が折り返して読めなくなる */
  left: { min: 170, max: 520 },
  /** 右パネル。素材の一覧が並ぶので、左より少し広く取れる */
  right: { min: 200, max: 560 },
  /**
   * タイムラインの高さ。
   *
   * **上限を切ってあるのは、プレビューを潰さないため。**
   * 620 を超えると映像が画面の3割程度になり、切り抜き作業が成立しない。
   */
  timeline: { min: 150, max: 620 }
} as const

export type PanelEdge = keyof typeof PANEL_LIMITS

/**
 * 掴んだ時の大きさと、動かした量から、次の大きさを出す。
 *
 * **向きが辺によって違う。** 左パネルは右へ動かすと広がるが、
 * 右パネルとタイムラインは逆（右／下へ動かすと狭くなる）。
 * ここを取り違えると「掴むと逆に動く」になる。
 *
 * @param base  掴んだ時点の大きさ（px）
 * @param delta 掴んでからの移動量（左右なら X、タイムラインなら Y）
 */
export function nextPanelSize(edge: PanelEdge, base: number, delta: number): number {
  const { min, max } = PANEL_LIMITS[edge]
  const raw = edge === 'left' ? base + delta : base - delta
  return Math.min(Math.max(raw, min), max)
}
