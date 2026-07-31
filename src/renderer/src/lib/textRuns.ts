// 文字の一部だけ色や大きさを変える指定（部分装飾）の計算。
//
// ## なぜ画面から出すか
//
// **ここは「保存したのに消える」事故が何度も出ている所。**
// 読み込み側の取りこぼしは projectLoad で押さえたが、
// 計算そのもの——打ち替えたときに範囲をどうずらすか——は
// 画面の中にあって確かめようがなかった。
//
// 打ち替えは日常操作なので、ずれると**気づかないうちに色が隣の字へ移る**。

import type { TelopStyle, TextRun } from './telopStyle'

// 部分装飾: 文字index gi を含む run（後勝ち）
export function runAtIndex(runs: TextRun[] | undefined, gi: number): TextRun | null {
  let hit: TextRun | null = null
  if (runs) for (const r of runs) if (gi >= r.start && gi < r.end) hit = r
  return hit
}

// run上書きを style にマージ＝「その選択文字の実効スタイル」。パネル表示＆変更検出の基準に使う。
export function styleWithRun(base: TelopStyle, r: TextRun | null): TelopStyle {
  if (!r) return base
  const st: TelopStyle = { ...base, fill: { ...base.fill } }
  if (r.gradient) st.fill.gradient = r.gradient
  else if (r.color) {
    st.fill.color = r.color
    st.fill.gradient = undefined
  }
  if (r.fontFamily) st.fontFamily = r.fontFamily
  if (r.sizeScale && r.sizeScale !== 1) st.fontSize = Math.round(base.fontSize * r.sizeScale)
  if (r.strokes) st.strokes = r.strokes
  if (r.shadows) {
    st.shadow = r.shadows[0]
      ? { ...r.shadows[0], enabled: true }
      : { ...base.shadow, enabled: false }
    st.shadows = r.shadows.slice(1)
  }
  if (r.join) st.join = r.join
  if (r.bgColor) st.background = { ...base.background, enabled: true, color: r.bgColor }
  return st
}

// run r から [s,e) を取り除く（分割）。重なりなしはそのまま。
export const splitRunRemoving = (r: TextRun, s: number, e: number): TextRun[] => {
  if (r.end <= s || r.start >= e) return [r]
  const out: TextRun[] = []
  if (r.start < s) out.push({ ...r, end: s })
  if (r.end > e) out.push({ ...r, start: e })
  return out
}

// テキスト編集(old→new)に合わせて runs の文字index をシフト/クランプ。
// 共通prefix/suffixから編集区間 [editStart,editEnd) と長さ変化 delta を求め、各runの端を移動。
export function adjustRuns(runs: TextRun[] | undefined, oldText: string, newText: string): TextRun[] | undefined {
  if (!runs || !runs.length || oldText === newText) return runs
  const minLen = Math.min(oldText.length, newText.length)
  let p = 0
  while (p < minLen && oldText[p] === newText[p]) p++
  let s = 0
  while (s < minLen - p && oldText[oldText.length - 1 - s] === newText[newText.length - 1 - s]) s++
  const editStart = p
  const editEnd = oldText.length - s
  const delta = newText.length - oldText.length
  const adj = (idx: number): number =>
    idx <= editStart ? idx : idx >= editEnd ? idx + delta : editStart
  const out: TextRun[] = []
  for (const r of runs) {
    const ns = adj(r.start)
    const ne = adj(r.end)
    if (ne > ns) out.push({ ...r, start: ns, end: ne })
  }
  return out.length ? out : undefined
}
