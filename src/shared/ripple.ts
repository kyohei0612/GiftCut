// 「詰まる」— ある時刻より後ろにある物を、まとめて前後にずらす。
//
// ## なぜ画面から出すか
//
// **1つでもずらし忘れると、そこだけ音や文字が置き去りになる。**
// 切片を消して詰めたのに文字だけ元の位置に残る、効果音だけずれる——
// どれも編集中は気づきにくく、書き出してから分かる。
// ずらす相手は5種類（テロップ・効果音・画像・映像クリップ・目印）あり、
// **足すたびにここへ書き足す必要がある**ので、1か所にまとめておく。
//
// ## 境目の比べ方
//
// ちょうど境目に乗っている物は「後ろ」として扱う（ずらす）。
// 浮動小数の誤差で 3.0 が 2.9999999 になることがあるので、
// **わずかな余裕を持たせて比べる**。ここを厳密にすると、
// 切った直後の物だけ取り残される。

/** 境目を比べるときの余裕（浮動小数の誤差ぶん） */
export const RIPPLE_EPS = 1e-6

/** その時刻が、境目より後ろか（ちょうど境目も含む） */
export function isAfter(t: number, boundary: number): boolean {
  return t >= boundary - RIPPLE_EPS
}

/**
 * 始まりだけを持つ物（効果音・画像・映像クリップ・目印）をずらす。
 *
 * **前へはみ出させない。** 長さは変えずに 0 で止める
 * （マイナスの位置に置くと、以後の計算がすべてずれる）。
 */
export function shiftStart(t: number, boundary: number, delta: number): number {
  return isAfter(t, boundary) ? Math.max(0, t + delta) : t
}

/**
 * 始まりと終わりを持つ物（テロップ）をずらす。
 *
 * **こちらは 0 で止めない。** 止めると始まりだけ動いて長さが変わり、
 * 文字の出ている時間が勝手に縮む。前へはみ出したぶんは、
 * 呼んだ側で（例えば先頭を切ったときに）まとめて直す。
 */
export function shiftRange(
  r: { start: number; end: number },
  boundary: number,
  delta: number
): { start: number; end: number } {
  return isAfter(r.start, boundary) ? { start: r.start + delta, end: r.end + delta } : r
}
