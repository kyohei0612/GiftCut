// 素材の fps を、ffprobe の返事から決める。
//
// ## なぜ `r_frame_rate` をそのまま使ってはいけないか（2026-08-05 に実測して直した）
//
// `r_frame_rate` は「その素材の**全タイムスタンプを表現できる最小の共通レート**」で、
// **平均のコマ数ではない。** コマが等間隔（CFR）なら両者は一致するが、
// **可変フレームレート（VFR）だと大きく食い違う。**
//
// VFR は配信の録画（OBS など）で普通に出てくる形なので、切り抜きに特化した
// このアプリでは**むしろ主流の入力**になりうる。実際に作って測った:
//
// ```
// r_frame_rate   = 60/1        ← 前はこれを使っていた
// avg_frame_rate = 4800/199    ← 実際は 24.1fps
// 実コマ数 240 / 9.95秒        = 24.1fps（avg と一致）
// ```
//
// **2.5倍ずれる。** 起きるのは音ズレではなく（書き出しは切片ごとに `fps=` で
// CFR 化し、音は `atrim`+`adelay` の絶対秒で置くので累積ドリフトは無い）、
//
//   ・「素材と同じ fps」で書き出すと、**2.5倍のコマを水増し**して焼く（遅い・重い）
//   ・**1コマ送りの刻みが素材と合わない**（60分の1で送るが、実際のコマは24分の1）
//   ・タイムコードのコマ欄が実素材と対応しない
//
// ## 決め方: **avg を採る。読めないときだけ r へ落ちる**
//
// `avg_frame_rate` は「コマ数 ÷ 尺」そのものなので、CFR では r と一致し、
// VFR では実態を指す。**両方で正しいのは avg だけ**なので、既定を avg にする。
//
// ただし avg は `0/0` で返ることがある（尺が分からない・断片だけ、など）。
// そのときだけ r へ落ちる。**どちらも読めなければ「分からない」を返す**
// ——0 や 30 を勝手に埋めない（CLAUDE.md 7番。黙って間違った刻みで動くより、
// 分からないと言われた方が直せる）。

/** `"30000/1001"` や `"60/1"` を数にする。読めなければ null */
export function parseRational(s: string | undefined | null): number | null {
  if (!s) return null
  const m = /^(-?\d+)\s*\/\s*(-?\d+)$/.exec(s.trim())
  if (m) {
    const d = Number(m[2])
    if (d === 0) return null // ffprobe は分からないとき `0/0` を返す
    const v = Number(m[1]) / d
    return Number.isFinite(v) && v > 0 ? v : null
  }
  const v = parseFloat(s)
  return Number.isFinite(v) && v > 0 ? v : null
}

/**
 * 素材の fps を決める。
 *
 * @param rFrameRate   ffprobe の `r_frame_rate`（タイムスタンプの最小共通レート）
 * @param avgFrameRate ffprobe の `avg_frame_rate`（コマ数 ÷ 尺）
 * @returns 使う fps。どちらも読めなければ null
 */
export function pickSourceFps(
  rFrameRate: string | undefined | null,
  avgFrameRate: string | undefined | null
): number | null {
  return parseRational(avgFrameRate) ?? parseRational(rFrameRate)
}

/**
 * 可変フレームレート（VFR）とみなせるか。
 *
 * **警告を出すためだけに使う。** 直せるものではない（素材がそうなっている）が、
 * 「書き出しが遅い」「コマ送りが変」と言われたときに**まずここを疑える**ようにする。
 *
 * 1割の差までは誤差扱い（29.97 と 30 の食い違いで毎回警告を出さない）。
 */
export function looksVariable(
  rFrameRate: string | undefined | null,
  avgFrameRate: string | undefined | null
): boolean {
  const r = parseRational(rFrameRate)
  const a = parseRational(avgFrameRate)
  if (r === null || a === null) return false
  return Math.abs(r - a) / Math.max(r, a) > 0.1
}
