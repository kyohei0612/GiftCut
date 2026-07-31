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

// ## 区間を丸ごと捨てて詰める（カット点まで詰める操作）
//
// 上の shiftStart / shiftRange は「境目より後ろを、まとめてずらす」だけ。
// カット点まで詰めるときは **捨てる区間の中に居た物**の行き先も要る。
//
// 行き先は3通りしかない。
//
//   捨てる区間より後ろ … 捨てた長さだけ手前へ寄る
//   捨てる区間の中     … 区間の頭で止める（**消さずに潰す**）
//   捨てる区間より前   … 動かない
//
// **中に居た物を消さないのは、テロップの片端だけが区間に入っている場合があるから。**
// 消すと、頭だけ区間にかかっていた文字が丸ごと失われる。頭を区間の入口で
// 止めておけば、残った尻のぶんはそのまま出る。長さが0になった物だけは
// 呼んだ側で落とす（ここでは判断しない）。

/**
 * 区間 [rmStart, rmEnd] を捨てて詰めたあとの時刻。
 *
 * @param removeLen 実際に捨てる長さ。**rmEnd - rmStart とは限らない**
 *                  （切片の残り丈で頭打ちになることがある）ので、別に受け取る
 */
export function collapseAt(
  t: number,
  rmStart: number,
  rmEnd: number,
  removeLen: number
): number {
  if (t >= rmEnd) return t - removeLen
  if (t > rmStart) return rmStart
  return t
}

/** 始まりと終わりを持つ物（テロップ）を、区間を捨てて詰めた形にする */
export function collapseRange(
  r: { start: number; end: number },
  rmStart: number,
  rmEnd: number,
  removeLen: number
): { start: number; end: number } {
  return {
    start: collapseAt(r.start, rmStart, rmEnd, removeLen),
    end: collapseAt(r.end, rmStart, rmEnd, removeLen)
  }
}
