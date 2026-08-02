// タイムラインの下に置く「拡大バー」。**掴む所で意味が変わる。**
//
//   真ん中を掴む … 見ている所を左右へ動かす（移動）
//   端のボッチ   … その端だけを動かす＝見える範囲が伸び縮みする（拡大・縮小）
//
// プレミアと同じ形。スライダーと横スクロールが別々にあると、
// 「どこを見ているか」と「どれだけ寄っているか」を2か所で操ることになる。
//
// ## なぜ画面から出すか
//
// **端を動かしたときに、反対の端が動いてはいけない。**
// 右のボッチを掴んだのに左まで動くと、見ていた場所を見失う。
// 画面では「なんとなく動いた」ようにしか見えず、ずれても気づけない。
//
// 計算そのものは「割合 ↔ 秒 ↔ 拡大率」の行き来だけなので、画面が無くても確かめられる。
//
// ## つまみの「最小の幅」は、ここでは決めない
//
// 寄るほどつまみは細くなり、細すぎると掴めない。ただし**ここで細さに下限を置くと、
// 拡大の上限（ZOOM_MAX）と2つの制限がぶつかる**——短い素材では、
// つまみの下限に先に当たって**上限まで寄れなくなる**（実際にそうなって試験で出た）。
// しかも Ctrl+ホイールは別の道なので、そちらでは寄れてしまい、
// つまみだけが「もう寄れない」と言う食い違いになる。
//
// 制限は**拡大率の上限・下限だけ**にして、細くなりすぎたつまみは
// **描くときに最低幅を持たせる**（CSS）。掴めればよいので、それで足りる。

/** 見えている範囲（バー全体に対する割合。0..1） */
export interface BarSpan {
  a: number
  b: number
}

/**
 * いま見えている範囲を、バー全体に対する割合で返す。
 *
 * @param scrollLeft いま左端が何px目か
 * @param viewW      見えている幅（px）
 * @param totalSec   タイムライン全体の長さ（秒）
 * @param zoom       px/秒
 */
export function barSpan(
  scrollLeft: number,
  viewW: number,
  totalSec: number,
  zoom: number
): BarSpan {
  const contentW = Math.max(1, totalSec * zoom)
  const a = Math.min(1, Math.max(0, scrollLeft / contentW))
  const b = Math.min(1, Math.max(a, (scrollLeft + viewW) / contentW))
  // 全部見えているときは端から端まで（つまみが消えない）
  return b - a >= 1 ? { a: 0, b: 1 } : { a, b }
}

/**
 * つまみを動かした結果から、拡大率と見ている位置を出す。
 *
 * **端を動かしたときは、反対の端をそのまま残す。** 右を掴んだのに左が動くと、
 * 見ていた場所を見失う。ここでは渡された a・b をそのまま信じて、
 * 「その範囲が画面いっぱいになる拡大率」を出すだけにしてある。
 *
 * 拡大率が限界に当たったときは、**掴んでいない側を動かさない**ように
 * 位置の方を詰める（両端が同時に動くと、何を掴んだのか分からなくなる）。
 *
 * @param anchor どちらの端を掴んでいるか。'l' なら右端を、'r' なら左端を残す
 */
export function zoomFromSpan(
  span: BarSpan,
  totalSec: number,
  viewW: number,
  limits: { min: number; max: number },
  anchor: 'l' | 'r' | 'move' = 'move'
): { zoom: number; scrollLeft: number } {
  const a = Math.min(Math.max(0, span.a), 1)
  // 端どうしが重なると秒数が 0 になって割り算が壊れる。ほんの少しだけ空ける
  const b = Math.min(Math.max(a + 1e-6, span.b), 1)
  const sec = Math.max(1e-6, (b - a) * totalSec)
  const zoom = Math.min(limits.max, Math.max(limits.min, viewW / sec))
  // 限界に当たると、その範囲は画面いっぱいにならない。
  // 掴んでいない端を残すように左端を決め直す
  const shownSec = viewW / zoom
  const startSec =
    anchor === 'l' ? Math.max(0, b * totalSec - shownSec) : a * totalSec
  return { zoom, scrollLeft: Math.max(0, startSec * zoom) }
}

/** つまみを丸ごと動かしたとき（移動だけ。拡大率は変えない） */
export function panFromSpan(
  aNext: number,
  span: BarSpan,
  totalSec: number,
  zoom: number
): number {
  const w = span.b - span.a
  const a = Math.min(Math.max(0, aNext), Math.max(0, 1 - w))
  return Math.max(0, a * totalSec * zoom)
}
