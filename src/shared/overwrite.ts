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

/**
 * 上書きの結果、テロップの並びがどうなるかを組み立てる。
 *
 * ## なぜ「判定」だけでなく「組み立て」もここに置くか
 *
 * このファイルの頭に「画面が無くても確かめられる」と書いてあるのに、
 * **`subtractRanges` を束ねる所だけが画面側（`state/useTimelineDrag`）に居た**。
 * 一番怖いのは「削りすぎて文字が消える」ことなのに、その最終形だけが
 * アプリを起動しないと見られない状態だった（2026-08-03 にこちらへ移した）。
 *
 * ## 新しい id は呼ぶ側が採る
 *
 * 真ん中を抜かれたテロップは2つに割れるので、片方に新しい id が要る。
 * setState の中で採番すると **StrictMode の2回走りで番号が飛ぶ**ので、
 * 採る役は呼ぶ側（`nextId`）に預け、ここは受け取った番号を使うだけにする。
 *
 * ## 先頭は元の id のまま
 *
 * 割れた左側は元の id を引き継ぐ。選択や、打った動きの行き先が変わらないように。
 *
 * @param nextId 新しい id を1つ返す（呼ぶたびに違う番号）
 * @returns 変わらなければ null（呼ぶ側は setState しないで済む）
 */
export function overwriteCues<T extends Range & { id: number }>(
  all: readonly T[],
  winnerIds: readonly number[],
  trackOf: (c: T) => string,
  nextId: () => number,
  clone: (c: T) => T = (c) => ({ ...c })
): T[] | null {
  const winners = all.filter((c) => winnerIds.includes(c.id))
  if (!winners.length) return null
  const out: T[] = []
  let changed = false
  for (const c of all) {
    if (winnerIds.includes(c.id)) {
      out.push(c)
      continue
    }
    // 削るのは**同じ段に居る物だけ**（段が違えば重なって当然）
    const cuts = winners
      .filter((w) => trackOf(w) === trackOf(c))
      .map((w) => ({ start: w.start, end: w.end }))
    const parts = subtractRanges({ start: c.start, end: c.end }, cuts)
    if (isUntouched({ start: c.start, end: c.end }, parts)) {
      out.push(c)
      continue
    }
    changed = true
    parts.forEach((p, i) => {
      out.push(
        i === 0
          ? { ...c, start: p.start, end: p.end }
          : { ...clone(c), id: nextId(), start: p.start, end: p.end }
      )
    })
  }
  if (!changed) return null
  return out.sort((a, b) => a.start - b.start)
}
