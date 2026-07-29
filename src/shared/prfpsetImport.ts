// 読み込んだ Premiere のプリセットを、GiftCut の「動き」に変換する。
//
// ## 単位を合わせるのが仕事
//
// 向こうとこちらで、同じ物を違う単位で持っている。ここを間違えると
// **動きはするが量が違う**という、一番気づきにくいズレになる。
//
//   位置     … 向こう: フレームに対する割合（0.5,0.5 が中央）
//              こちら: 中央からのズレを 1920x1080 基準の px で持つ
//              → (割合 - 0.5) × 1920（縦は 1080）
//   スケール … 向こう: 100 が等倍     こちら: 1 が等倍   → ÷100
//   回転     … 度どうしなのでそのまま
//   不透明度 … 向こう: 100 が不透明   こちら: 1 が不透明 → ÷100
//
// **接線（速度）も同じ倍率で直す。** 速度は「値/秒」なので、値を100で割ったなら
// 速度も100で割らないと、曲がり方だけ元のままになる（直線に見えたり暴れたりする）。
//
// ## 何を持ってくるか
//
// いまは Motion（位置・スケール・回転）と Opacity（不透明度）だけ。
// この2つだけでできているプリセットは、**そのまま完全に再現できる**。
// 色やブラーが混ざっている物は、焼き方を足してから。

import type { Motion } from './telopMotion'
import type { BezierKey } from './bezierKeys'
import type { PrPreset } from './prfpset'

/** GiftCut 側の動き（テロップの Motion と同じ形。lib/telopStyle から独立させてある） */
export type { Motion } from './telopMotion'

/** 向こうの MatchName */
const MOTION = 'AE.ADBE Motion'
const OPACITY = 'AE.ADBE Opacity'
/**
 * 「トランスフォーム」エフェクト。**動きはこちらに付いていることが多い。**
 * 素の「モーション」ではなくこちらを使うと、歪曲やシャッター角度が足せるため。
 * 中身（位置・スケール・回転・不透明度）は同じ意味なので、同じように読める。
 */
const GEOMETRY = 'AE.ADBE Geometry2'

const HANDLED = new Set([MOTION, OPACITY, GEOMETRY])

/** そのプリセットが、こちらで持てるエフェクトだけでできているか */
export function isFullyCopyable(p: PrPreset): boolean {
  return p.effects.every((e) => HANDLED.has(e.matchName))
}

/** 値と接線に同じ倍率を掛ける（速度は「値/秒」なので同じ倍率でよい） */
function scaleKeys(keys: BezierKey[], mul: number, add = 0): BezierKey[] {
  return keys.map((k) => ({
    t: k.t,
    v: k.v * mul + add,
    ...(k.in ? { in: { speed: k.in.speed * mul, influence: k.in.influence } } : null),
    ...(k.out ? { out: { speed: k.out.speed * mul, influence: k.out.influence } } : null)
  }))
}

/** GiftCut の Keys（keyframes.ts の形）へ。接線の名前だけ違う */
function toKeys(keys: BezierKey[]): Motion['tx'] {
  if (!keys.length) return undefined
  return keys.map((k) => ({
    t: k.t,
    v: k.v,
    ...(k.in ? { ti: k.in } : null),
    ...(k.out ? { to: k.out } : null)
  }))
}

/**
 * プリセット1つを GiftCut の動きにする。
 * 対応していないエフェクトは**黙って捨てず**、呼ぶ側へ名前を返す
 * （「取り込んだのに一部だけ効いていない」を隠さないため）。
 */
export function toMotion(p: PrPreset): { motion: Motion; skipped: string[] } {
  const motion: Motion = {}
  const skipped: string[] = []
  for (const e of p.effects) {
    if (!HANDLED.has(e.matchName)) {
      if (e.params.some((q) => q.keys.length)) skipped.push(e.matchName)
      continue
    }
    for (const q of e.params) {
      if (!q.keys.length) continue
      const [x, y] = q.keys
      switch (q.name) {
        case '位置':
          // 割合（0.5 が中央）→ 中央からのズレ（px）
          motion.tx = toKeys(scaleKeys(x, 1920, -960))
          if (y) motion.ty = toKeys(scaleKeys(y, 1080, -540))
          break
        case 'スケール':
          motion.sc = toKeys(scaleKeys(x, 0.01))
          break
        case '回転':
          motion.rot = toKeys(x)
          break
        case '不透明度':
          motion.op = toKeys(scaleKeys(x, 0.01))
          break
        case 'スケール (幅)':
        case 'スケール（幅）':
          // 横だけの拡大。100 が等倍
          motion.scx = toKeys(scaleKeys(x, 0.01))
          break
        case '歪曲':
          // 度どうしなのでそのまま
          motion.skew = toKeys(x)
          break
        case '歪曲軸':
        case 'アンチフリッカー':
        case 'シャッター角度':
        case 'サンプリング':
          // 見た目にほぼ効かない・こちらに概念が無い。動いていても無視してよい
          break
        default:
          // アンカーポイントやアンチフリッカーなど。動きが付いていれば知らせる
          skipped.push(`${e.matchName}/${q.name}`)
      }
    }
  }
  return { motion, skipped }
}
