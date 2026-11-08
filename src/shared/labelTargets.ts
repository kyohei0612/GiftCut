// ラベルカラーを**どれに付けるか**を決める。
//
// ## なぜ画面から出すか
//
// 2026-11-08 まで、色を付ける道が**2本**あった。テロップの品書きは「選んでいる
// テロップ全部」、それ以外（本編・効果音・画像・映像レイヤー）の品書きは
// 「右クリックした1つだけ」。範囲選択や Ctrl+A で種類をまたいで選んでから
// 色を選ぶと、**右クリックした種類しか変わらない**（本人の報告どおり）。
// 道が2本あると決まりが食い違うので、判定をここ1つにして両方の品書きが通る。
//
// ## 決まり
//
// 右クリックした物が**選ばれている**なら、選んでいる物**全部・全種類**に付ける。
// 選ばれていない物を右クリックしたなら、その1つだけ（品書きを開く側が、
// 開く前にそれだけを選び直しているので、実際はこの道も「選んでいる全部」と同じ）。

export type LabelKind = 'telop' | 'seg' | 'se' | 'img' | 'vclip'

/** いま選んでいる物の ID を種類ごとに */
export type LabelSelection = Record<LabelKind, readonly number[]>

/** 色を付ける相手。種類ごとの ID の配列 */
export type LabelTargets = Record<LabelKind, number[]>

export const LABEL_KINDS: readonly LabelKind[] = ['telop', 'seg', 'se', 'img', 'vclip']

export function labelTargets(sel: LabelSelection, kind: LabelKind, id: number): LabelTargets {
  const empty: LabelTargets = { telop: [], seg: [], se: [], img: [], vclip: [] }
  if (!sel[kind].includes(id)) return { ...empty, [kind]: [id] }
  for (const k of LABEL_KINDS) empty[k] = [...sel[k]]
  return empty
}

/** 付ける相手の総数（品書きの見出し「（N個）」用） */
export function labelTargetCount(t: LabelTargets): number {
  return LABEL_KINDS.reduce((n, k) => n + t[k].length, 0)
}
