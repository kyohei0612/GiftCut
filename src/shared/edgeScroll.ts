// 掴んだまま端まで持っていったら、見ている所の方を動かす（ウェブページと同じ）。
//
// ## なぜ画面から出すか
//
// **速さの決め方を間違えても、画面では「ちょっと違う」にしか見えない。**
// 速すぎれば行き過ぎて戻せず、遅すぎれば端で止まったのと区別が付かない。
// どちらも掴んで動かして体感するしかなく、直したつもりが直っていない、が起きる。
//
// 計算そのものは「端からどれだけ入り込んだか」だけなので、画面が無くても確かめられる。
//
// ## 端から離れるほど遅く、めり込むほど速く
//
// 一定の速さにすると、少し外れただけで飛んでいく。端からの距離に比例させると、
// 「ちょっとだけ送りたい」も「一気に送りたい」も同じ手つきで出せる。

/** 端からこの範囲に入ったら送り始める（px） */
export const EDGE_PX = 56
/** 1コマで送る最大の量（px） */
export const EDGE_MAX_V = 28

/**
 * その位置なら1コマで何px送るか。**中ほどでは 0**（送らない）。
 *
 * 返す値は符号付き（右へ送るなら＋、左なら−）。
 *
 * @param x     いまのポインタの位置（画面の座標）
 * @param left  見えている範囲の左端
 * @param right 見えている範囲の右端
 */
export function edgeScrollDelta(
  x: number,
  left: number,
  right: number,
  edge = EDGE_PX,
  maxV = EDGE_MAX_V
): number {
  // 幅が端の判定より狭いと、左右の判定が重なって左右へ同時に引っぱられる。
  // その場合は送らない（狭すぎて「端」に意味が無い）
  if (right - left <= edge * 2) return 0
  if (x > right - edge) return Math.min(maxV, ((x - (right - edge)) / edge) * maxV)
  if (x < left + edge) return -Math.min(maxV, ((left + edge - x) / edge) * maxV)
  return 0
}
