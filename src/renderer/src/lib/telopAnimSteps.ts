// アニメの「変化する区間」を、書き出し用に刻む。
//
// ## なぜ編集の入れ物から出したか
//
// `state/useMotion` は**編集の操作**（印を打つ・消す・寄せる）を集めた所で、
// これだけが**書き出しの下ごしらえ**だった。React の状態を1つも触らない純関数で、
// 使い手も編集画面ではなく `state/useExport`。
//
// 出したことで `useAppWiring` の中継と `UseExportDeps` の項目が1つ消えた
// ＝**渡し物が減る方向の切り出し**（2026-08-03。中身は1文字も変えていない）。
//
// ## 何をしているか
//
// 動きの付いたテロップは、書き出しのときに**その瞬間の絵を1枚ずつ焼く**。
// 全区間を刻むと枚数が爆発するので、**変わっている所だけ**を刻んで、
// 途中の静止区間は1枚で済ませる。

import { hasMotion, type Motion, type TelopAnim } from './telopStyle'

/** アニメの「変化する区間」の分割点（ローカル秒）を返す。中間の静止区間は1枚で済ませる。 */
export function animBreakpoints(
  anim: TelopAnim | undefined,
  motion: Motion | undefined,
  dur: number,
  fps: number
): number[] {
  const step = 1 / fps
  const set = new Set<number>([0])
  const addRange = (a: number, b: number): void => {
    for (let t = a; t < b - 1e-4; t += step) set.add(Math.round(t / step) * step)
  }
  // 自分で打った動き（モーション）が付いていたら、全区間を刻む。
  // どこで値が変わるか決め打ちできないので、通しで並べるしかない。
  if (hasMotion(motion) || anim?.emphasis === 'shake' || anim?.emphasis === 'pulse') {
    addRange(0, dur)
  } else if (anim) {
    if (anim.in !== 'none') addRange(0, Math.min(anim.inDur, dur))
    if (anim.out !== 'none') addRange(Math.max(0, dur - anim.outDur), dur)
  }
  return [...set].filter((t) => t < dur - 1e-4).sort((a, b) => a - b)
}
