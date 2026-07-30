// まとめて選んでいるとき、数値を変えたら**何を配るか**。
//
// 配るのは「変えた量（差分）」であって、値そのものではない。
// 値を配ると、ばらばらに置いてある物が1か所に揃ってしまう
// （3つの文字を別々の高さに置いて、まとめて下げたいだけなのに、
//   全部同じ高さに重なる、という壊れ方になる）。
//
// 画面に出ている単位（px・%・度）と、印に入れる値の単位は違うので、
// 掛ける係数もここに置く。**行の定義（toKey）と必ず対で直すこと。**

import type { MotionKeyName } from './telopMotion'

/**
 * 印を打つ項目。**本体の型をそのまま使う。**
 * ここで別の一覧を作ると、項目を足したときに片方だけ古くなる。
 */
export type NudgeKey = MotionKeyName

/**
 * 表示の1に対して、印がいくつ動くか。
 * **載っていない項目は 1**（px・度・そのままの数はこれで合う）。
 * ％で見せている物だけ書く。
 */
const KEY_PER_SHOWN: Partial<Record<NudgeKey, number>> = {
  sc: 0.01, op: 0.01, scx: 0.01, scy: 0.01,
  bright: 0.01, inv: 0.01, blind: 0.01,
  cl: 0.01, ct: 0.01, cr: 0.01, cb: 0.01
}

/** 掛け算で効く項目（素のままが 1）。足し算で効く項目は素のままが 0 */
const MULTIPLICATIVE: NudgeKey[] = ['sc', 'scx', 'scy', 'bright', 'op']

/** その項目の「何も付けていない状態」の値 */
export function neutralOf(key: NudgeKey): number {
  return MULTIPLICATIVE.includes(key) ? 1 : 0
}

/**
 * 表示の差分を、印に入れる差分へ直す。
 *
 * @param ownScale 拡大だけは**その子自身の元の大きさ**で割る
 *                 （印は「元の大きさに対する倍率」なので）
 */
export function keyDelta(key: NudgeKey, deltaShown: number, ownScale = 1): number {
  if (key === 'sc') return (deltaShown * 0.01) / (ownScale || 1)
  return deltaShown * (KEY_PER_SHOWN[key] ?? 1)
}
