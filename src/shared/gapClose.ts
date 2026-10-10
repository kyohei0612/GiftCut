// 本編の「空き」をどこまで詰めてよいか（判断だけ。動かすのは state/useGapClose）。
//
// ## 3種類を分ける
//
// 空きの上に掛かっている物は、同じ「重なり」でも意味が違う:
//
//   前のクリップから続いている物   … カットをまたぐ字幕・効果音。**詰めてよい**。
//                                    空きに掛かっていた尻は空きの頭で止める（collapseAt）
//   空きの頭（直前を含む）に置いた物 … 空きに合わせて置いた物。詰めると巻き込むので**止める**
//   空きの途中に置いた物           … その手前まで詰める（巻き込まない）
//
// 2026-10-10 まで前の2つを区別せず「先頭に重なっていたら止める」にしていた。
// テロップ186枚・カット77の編集では、カットをまたぐ字幕はいくらでもあるので、
// **ほとんどの空きが「何をしても消せない」**になっていた（編集者＝本人の妻の報告）。
//
// ## 極小の空き
//
// 掴んで置いたときの丸めで、1コマに満たない空き（数ms）ができることがある。
// 拡大しないと見えないのに、「残り幅が1ms以下＝別のクリップが来ている」の判定に
// 引っかかって**永久に消せなかった**。空きそのものが極小なら、黙って消してよい。
//
// ## 中身
//
// - `planGapClose` … 空きと、載っている物の区間から「どこまで・何秒」詰めるかを返す
import { RIPPLE_EPS } from './ripple'

export interface Span {
  start: number
  end: number
}

export interface GapPlan {
  /** ここまで詰める（空きの頭からこの時刻までを捨てる） */
  to: number
  /** 捨てる長さ（秒）。0 なら詰められない */
  len: number
  /** 詰められない理由。null なら詰められる（部分でも） */
  blocked: 'start' | null
  /** 空きの尻まで詰め切るか（途中で止まるなら false） */
  whole: boolean
}

/**
 * 「空きの頭に置いた物」と見なす範囲（秒）。空きの頭より少し前から始まる物も、
 * 置いたつもりの物なので止める。詰めると長さが 0.05 秒を切って消えてしまう
 * （`mapContentTimes` が 0.05 秒未満のテロップを落とす）ので、その境と揃えてある
 */
export const AT_START_EPS = 0.05

/** 空きそのものがこれ以下なら、何も聞かずに消す（1コマに満たない。拡大しないと見えない） */
export const TINY_GAP = 1e-3

export function planGapClose(gap: Span, spans: readonly Span[]): GapPlan {
  const { start, end } = gap
  // 空きの頭（直前を含む）から始まって、空きに掛かっている物 → 止める
  const atStart = spans.some(
    (s) => s.start > start - AT_START_EPS && s.start <= start + RIPPLE_EPS && s.end > start + RIPPLE_EPS
  )
  if (atStart) return { to: start, len: 0, blocked: 'start', whole: false }
  // 空きの途中から始まる物 → その手前まで
  const inside = spans
    .map((s) => s.start)
    .filter((t) => t > start + RIPPLE_EPS && t < end - RIPPLE_EPS)
  const to = inside.length ? Math.min(...inside) : end
  return { to, len: to - start, blocked: null, whole: !inside.length }
}
