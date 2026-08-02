// 同じ段で重なったとき、置いた物を勝たせる（プレミアの「上書き」）。
//
// ## なぜ画面から出すか
//
// **消える方の計算だから。** 削りすぎれば文字が消え、削り足りなければ
// 重なったまま残る。どちらも掴んで落としてみるまで分からず、
// 気づいたときには元の文字が無い。
//
// 計算そのものは「この区間から、この区間を引く」だけなので、
// 画面が無くても確かめられる。
//
// ## 真ん中を抜かれたら2つに割れる
//
// 端に食い込まれたときは削るだけだが、**真ん中に落とされたら左右が残る**。
// ここで片方を捨てると、残せたはずの文字が黙って消える。
// テロップは元の素材を持たない（文字だけ）ので、割っても失う物は無い。

/** 時間の区間（秒） */
export interface Range {
  start: number
  end: number
}

/**
 * 短すぎる残りは捨てる。
 *
 * `shared/clipEdit` の MIN_CLIP と同じ値。1コマにも満たない切れ端が残ると、
 * タイムラインでは線にしか見えず、掴むことも消すこともできない物になる。
 */
export const MIN_KEEP = 0.1

/**
 * `span` から `cuts` の重なりを取り除き、残った区間を返す（0〜2個）。
 *
 * @param cuts 置いた側（勝つ方）の区間。順番は問わない
 */
export function subtractRanges(
  span: Range,
  cuts: readonly Range[],
  minKeep = MIN_KEEP
): Range[] {
  let parts: Range[] = [{ start: span.start, end: span.end }]
  for (const c of cuts) {
    const next: Range[] = []
    for (const p of parts) {
      // 触れていない（端が接しているだけも「重なっていない」）
      if (c.end <= p.start || c.start >= p.end) {
        next.push(p)
        continue
      }
      if (c.start > p.start) next.push({ start: p.start, end: Math.min(c.start, p.end) })
      if (c.end < p.end) next.push({ start: Math.max(c.end, p.start), end: p.end })
    }
    parts = next
    if (!parts.length) break // 丸ごと覆われた
  }
  return parts.filter((p) => p.end - p.start >= minKeep)
}

/** 何も削られていないか（＝手を付けなくてよいか）を見る */
export function isUntouched(span: Range, parts: readonly Range[]): boolean {
  return parts.length === 1 && parts[0].start === span.start && parts[0].end === span.end
}
