// クリップを掴んで動かすときの決め事。
//
// ## 修飾キーで何が変わるか
//
// プレミアと同じにしてある。ここが違うと、慣れている人ほど事故る
//（割り込みのつもりが上書きになって、後ろの素材が消える）。
//
//   そのまま … 上書きで移動
//   Alt      … 複製（元はその場に残る）
//   Ctrl / Shift … 割り込み（後ろがずれる。上書きせず、置いてある物が後ろへ動く）
//
// ## 何px から「動かした」とみなすか
//
// **押しただけで動かすと、選ぶつもりがクリップを動かしてしまう。**
// 指やマウスは押した瞬間に数px震えるので、そのぶんは無視する。
//
// ※ いま App の中では、切片は4px・効果音や画像は3pxと**揃っていない**。
//   同じ手つきなのに種類で違うのは本来おかしいが、触ると手触りが変わるので、
//   ここでは既定値だけ決めて、呼ぶ側が今の値を渡せるようにしてある。

/** 掴んで落としたときに何が起きるか */
export type SegDropMode = 'move' | 'copy' | 'insert'

/** 押しただけの震えを無視する幅（px） */
export const DRAG_SLOP_PX = 4

/**
 * 修飾キーから、落としたときの動きを決める。
 *
 * **Alt を先に見る。** 両方押されているときは複製を優先する
 *（割り込みながら複製、という動きは無いので、どちらかに倒す必要がある）。
 */
export function dragModeOf(ev: {
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  shiftKey?: boolean
}): SegDropMode {
  if (ev.altKey) return 'copy'
  // **Shift だけでも割り込みにする。** 一番よく使う動きなのに
  // Ctrl+Shift の2つ押しが要り、片手で置けなかった。Ctrl も残す（今までの手が効く）
  if (ev.ctrlKey || ev.metaKey || ev.shiftKey) return 'insert'
  return 'move'
}

/** その移動量なら「動かした」とみなすか（押しただけの震えを弾く） */
export function movedEnough(dx: number, slop = DRAG_SLOP_PX): boolean {
  return Math.abs(dx) >= slop
}
