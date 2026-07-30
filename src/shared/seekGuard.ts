// 「シークが着く前に、もう一度シークを頼まない」という決まりごと。
//
// ## なぜ要るか
//
// 再生中の追従（動画・音声を再生ヘッドに合わせる処理）は**毎コマ通る**。
// そこで素直に
//
//     if (ずれ > しきい値) el.currentTime = 狙いの位置
//
// と書くと、シークに時間がかかっている間は動画がまだ着いていない
// ＝ずれは大きいままなので、**毎コマ頼み直す**ことになる。
// 新しく書くたびに前の依頼は取り消されるので、いつまでも着かない。
//
// 実測（最高画質・切片10個）: 0.27秒おきにシークが走り、
// 110ms → 235ms → 478ms と伸びていった。カットをまたいだ回数は10回のはずが、
// 記録には30回出ていた。差はすべて頼み直し。
//
// 直し方は1つだけ。**いまシーク中なら何もしない。**

/** シークを頼んでよいか。true なら currentTime を書いてよい */
export function shouldSeek(
  el: { seeking: boolean; currentTime: number } | null | undefined,
  want: number,
  tolerance: number
): boolean {
  if (!el) return false
  // 着く前に重ねて頼まない。ここが本体
  if (el.seeking) return false
  if (!Number.isFinite(want)) return false
  return Math.abs(el.currentTime - want) > tolerance
}
