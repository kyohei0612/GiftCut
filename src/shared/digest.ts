// 選んだ区間の**写しを先頭に並べる**（ダイジェスト）——どこへ置くかの計算だけ。
//
// ## 何に使うか
//
// YouTube の切り抜きで、冒頭に「この後こうなります」を見せる使い方。
// 本人の流れ（2026-11-11）: 見せ場の本編を色で分ける →「同じ色をまとめて選択」→
// 本編を右クリック →「コピーを先頭に並べる」。動かすのは state/useDigestToHead。
//
// ## 決まり
//
// - 区間は**元の時刻が早い順**（0秒に近い順）に、隙間なく 0 秒から並べる。
//   選んだ順ではない（範囲選択・色で選ぶと、選んだ順は意味を持たない）
// - **隣り合う区間は1つに繋ぐ。** 繋がないと、2つにまたがるテロップが
//   切れ目で2枚に割れる
// - 載っている物（テロップ・効果音・画像・映像レイヤー）は、**頭がその区間の中に
//   ある物だけ**写す。尻がはみ出していたら区間の終わりで切る——切らないと、
//   隣に並んだ別の見せ場の上まで文字や音が残る
// - **頭が区間より前にある物は写さない。** 頭を切ると、効果音は鳴り始めの位置
//  （srcOffset）を、動きは印の時刻（クリップの頭からの秒・shared/keyframes）を
//   全部ずらす必要があり、ずらし忘れると画面と書き出しで食い違う。
//   見せ場の切れ目とテロップの頭はふつう揃っているので、割に合わない
//
// ## 中身
//
// - `digestPieces` … 選んだ区間 → 並べ直した区間（元の位置・先頭での位置）と合計の長さ
// - `placeInDigest` … 載っている物の [頭, 尻] → 先頭側での [頭, 尻]（写さないなら null）
// - `DIGEST_MIN_LEN` … これより短くなる写しは捨てる

/** これより短くなる写しは捨てる（useContentShift の「潰れた物を落とす」と同じ値） */
export const DIGEST_MIN_LEN = 0.05

/** 区間の端を比べるときの余裕（浮動小数の誤差ぶん。shared/ripple の RIPPLE_EPS と同じ考え方） */
const EPS = 1e-6

/** 並べ直した区間。元の [from, to] を、先頭の at から置く */
export interface DigestPiece {
  from: number
  to: number
  at: number
}

/**
 * 選んだ区間を、0秒に近い順・隙間なしに先頭へ並べる。
 *
 * @returns pieces … 元の時刻が早い順。隣り合う区間は1つに繋いである
 *          total  … 並べた合計の長さ（後ろの中身をこれだけ後ろへ送る）
 */
export function digestPieces(
  ranges: readonly { tStart: number; tEnd: number }[]
): { pieces: DigestPiece[]; total: number } {
  const sorted = ranges
    .filter((r) => r.tEnd - r.tStart > EPS)
    .map((r) => ({ from: r.tStart, to: r.tEnd }))
    .sort((a, b) => a.from - b.from)
  const merged: { from: number; to: number }[] = []
  for (const r of sorted) {
    const last = merged[merged.length - 1]
    if (last && r.from <= last.to + EPS) last.to = Math.max(last.to, r.to)
    else merged.push({ ...r })
  }
  let at = 0
  const pieces = merged.map((r) => {
    const p = { ...r, at }
    at += r.to - r.from
    return p
  })
  return { pieces, total: at }
}

/**
 * 載っている物の [頭, 尻] を、先頭に並べた側の [頭, 尻] へ。
 *
 * **頭が区間の中にある物だけ**（区間の終わりちょうどに頭がある物は、次の物なので含めない）。
 * 尻は区間の終わりで切る。切って `DIGEST_MIN_LEN` より短くなるなら写さない。
 */
export function placeInDigest(
  pieces: readonly DigestPiece[],
  start: number,
  end: number
): { start: number; end: number } | null {
  const p = pieces.find((q) => start >= q.from - EPS && start < q.to - EPS)
  if (!p) return null
  const s = Math.max(start, p.from) - p.from + p.at
  const e = Math.min(end, p.to) - p.from + p.at
  return e - s < DIGEST_MIN_LEN ? null : { start: s, end: e }
}
