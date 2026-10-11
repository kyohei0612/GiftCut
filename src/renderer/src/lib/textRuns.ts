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

/** run が持てる、見た目の項目（start/end 以外）。全体の設定を覆い隠す物 */
export const RUN_LOOK_KEYS = [
  'color', 'gradient', 'fontFamily', 'sizeScale', 'bgColor', 'strokes', 'shadows', 'join'
] as const
export type RunLookKey = (typeof RUN_LOOK_KEYS)[number]

/**
 * 全体の見た目を prev → next に変えたとき、**run の側で覆い隠してしまう項目**。
 *
 * 見本を文字範囲に当てると、フォント・色・縁が全文字ぶん run に入る。
 * その後で左のパネルからフォントを変えても、run が勝つので**何も変わらない**
 * （2026-10-12・本人「型をはめた後に編集しても反映されない」）。
 * 全体を変えたなら、その項目は run から外して全体の値を通す。
 */
export function changedRunKeys(prev: TelopStyle, next: TelopStyle): RunLookKey[] {
  const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)
  const out: RunLookKey[] = []
  if (!same(prev.fill?.gradient, next.fill?.gradient)) out.push('gradient', 'color')
  else if (prev.fill?.color !== next.fill?.color) out.push('color', 'gradient')
  if (prev.fontFamily !== next.fontFamily) out.push('fontFamily')
  if (!same(prev.strokes, next.strokes)) out.push('strokes')
  if (!same(prev.shadow, next.shadow) || !same(prev.shadows, next.shadows)) out.push('shadows')
  if ((prev.join ?? 'miter') !== (next.join ?? 'miter')) out.push('join')
  const bgOf = (s: TelopStyle): string | undefined =>
    s.background?.enabled ? s.background.color : undefined
  if (bgOf(prev) !== bgOf(next)) out.push('bgColor')
  return out
}

/** runs から keys の項目を外す。何も残らない run は落とす（空の run を残さない） */
export function stripRunKeys(
  runs: TextRun[] | undefined,
  keys: readonly RunLookKey[]
): TextRun[] | undefined {
  if (!runs || !runs.length || !keys.length) return runs
  const out: TextRun[] = []
  for (const r of runs) {
    const n: TextRun = { ...r }
    for (const k of keys) delete n[k]
    if (RUN_LOOK_KEYS.some((k) => n[k] !== undefined)) out.push(n)
  }
  return out.length ? out : undefined
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
