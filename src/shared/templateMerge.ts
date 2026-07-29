// テンプレートを開いたときに、いまの設定とどう混ぜるか。
//
// **置き換えない。混ぜる。**
// テンプレートは「新規プロジェクトの開始状態を揃える」ためのもので、
// その人が育てた ★お気に入り・フォルダ分け・自作テロップを消してよい理由が無い。
// 置き換えにしていた頃は、テンプレートを1回開くだけで全部消えていた（戻せない）。
//
// 混ぜ方の向きも決まっている:
//
//   お気に入り        … 足し算（重複は1つに）
//   分類の割り当て    … **いまの設定が勝つ**（テンプレは「まだ決まっていない物」だけ埋める）
//   自作フォルダ      … いまの並びの後ろに、まだ無いものだけ足す
//   自作テロップ      … 同じ名前があれば足さない
//   アイコンの割り当て … いまの設定が勝つ
//
// 「いまの設定が勝つ」を守らないと、テンプレートを開くたびに自分の設定が
// 上書きされ、何度直しても戻る、という状態になる。

/** ★お気に入り（名前の一覧）。足し算で、重複は1つに */
export function mergeFavorites(current: string[], incoming: unknown): string[] {
  if (!Array.isArray(incoming)) return current
  return Array.from(new Set([...current, ...incoming.filter((x) => typeof x === 'string')]))
}

/** 分類の割り当て（名前→フォルダ）。いまの設定が勝つ */
export function mergeAssignments(
  current: Record<string, string>,
  incoming: unknown
): Record<string, string> {
  if (!incoming || typeof incoming !== 'object') return current
  return { ...(incoming as Record<string, string>), ...current }
}

/** 自作フォルダ。いまの並びを保ち、まだ無いキーだけ後ろに足す */
export function mergeFolders<T extends { key: string }>(current: T[], incoming: unknown): T[] {
  if (!Array.isArray(incoming)) return current
  const seen = new Set(current.map((c) => c.key))
  return [...current, ...(incoming as T[]).filter((c) => c && c.key && !seen.has(c.key))]
}

/** 自作テロップ。同じ名前があれば足さない（上書きしない） */
export function mergeNamed<T extends { name?: string }>(current: T[], incoming: unknown): T[] {
  if (!Array.isArray(incoming)) return current
  const have = new Set(current.map((t) => t.name))
  return [
    ...current,
    ...(incoming as T[]).filter((t) => t && typeof t.name === 'string' && !have.has(t.name))
  ]
}
