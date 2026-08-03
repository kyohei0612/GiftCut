// ものさしの目盛りを、**見えている範囲だけ**作る。
//
// ## なぜ範囲を絞るか
//
// 前は「タイムラインの端から端まで」作っていた（上限20,000個）。
// 実データ（451秒）で寄せると **目盛りだけで 4,538 個の要素**になり、
// 帯（クリップ）は23個しか描いていないのに DOM が 1,679 → 10,412 に膨らんでいた。
//
// **帯は元から窓の分だけ描いていたのに、目盛りだけが全部だった。**
// 「編集すればするほど重い、特にタイムライン」の形と合う——長い動画ほど、
// 寄るほど増える。
//
// ## 刻みの決め方は変えていない
//
// 大きい目盛りは「文字が入る幅が取れる」いちばん細かい刻み。
// 小さい目盛りは、その間が 7px 以上あく範囲でいちばん細かく割る。
// **変えたのは「どこからどこまで作るか」だけ。**
//
// ## 少しはみ出して作る
//
// 見えている範囲ぴったりで切ると、送った瞬間に端が空く。
// 画面1つぶんを前後に足しておく（送っている間に作り足す）。

/** 目盛り1本 */
export interface Tick {
  /** 左からの位置（px） */
  left: number
  /** 数字を出す太い方か */
  major: boolean
  /** 秒数の文字（太い方だけ） */
  time?: number
}

/** 大きい目盛りの候補（秒）。fps 由来の細かい物から1時間まで */
export const tickCandidates = (fps: number): number[] => [
  1 / fps,
  2 / fps,
  5 / fps,
  0.5,
  1,
  2,
  5,
  10,
  15,
  30,
  60,
  120,
  300,
  600,
  1800,
  3600
]

/** その拡大率で使う「大きい目盛り」と「小さい目盛り」の刻み（秒） */
export function tickStep(zoom: number, fps: number): { major: number; minor: number } {
  const cands = tickCandidates(fps)
  const minLabelPx = 84
  let major = cands[cands.length - 1]
  for (const c of cands)
    if (c * zoom >= minLabelPx) {
      major = c
      break
    }
  const majorPx = major * zoom
  const sub = [10, 5, 4, 2, 1].find((n) => majorPx / n >= 7) ?? 1
  return { major, minor: major / sub }
}

/**
 * 見えている範囲の目盛りを作る。
 *
 * @param zoom      px / 秒
 * @param duration  タイムライン全体の長さ（秒）
 * @param fps       コマ数（いちばん細かい刻みに使う）
 * @param viewLeft  いま見えている左端（px）。分からなければ 0
 * @param viewWidth 見えている幅（px）。**0 なら全部作る**（幅が測れない時の逃げ道）
 */
export function visibleTicks(
  zoom: number,
  duration: number,
  fps: number,
  viewLeft: number,
  viewWidth: number
): Tick[] {
  const { major, minor } = tickStep(zoom, fps)
  const endPx = duration * zoom
  // 幅が取れないうちは全部（起動直後の1回だけ通る）。ただし上限は残す
  const from = viewWidth > 0 ? Math.max(0, viewLeft - viewWidth) : 0
  const to = viewWidth > 0 ? Math.min(endPx, viewLeft + viewWidth * 2) : endPx
  const first = Math.max(0, Math.floor(from / zoom / minor))
  const last = Math.floor(to / zoom / minor)
  const out: Tick[] = []
  // **作りすぎない歯止めは残す。** 幅が取れない時や、極端に細かい刻みでも
  // ここで止まる（前の 20,000 から下げた。画面1つぶん×3 に収まる数）
  const LIMIT = 3000
  for (let i = first; i <= last && out.length < LIMIT; i++) {
    const time = i * minor
    const isMajor = Math.abs(time / major - Math.round(time / major)) < 1e-6
    out.push({ left: time * zoom, major: isMajor, time: isMajor ? time : undefined })
  }
  return out
}
