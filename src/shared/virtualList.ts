// 「画面に出ている物だけ作る」ための計算。
//
// タイムラインの帯で効いたのと同じ考え方を、素材の置き場（ビン）にも使う。
// 素材が全部別ファイルだと 500件で操作が 94.5ms まで落ち、1000件増えるごとに
// +176.8ms・+26.7MB 増えていた。**画面には十数個しか映っていないのに、
// 全部ぶんの箱とサムネを作っていた**のが原因。
//
// ここは計算だけ。上下に「見えていないぶんの高さ」を空箱で置き、
// 見えている範囲だけを実際に作る。スクロールの長さは変わらないので、
// つまみの位置も動く量も今までどおりになる。

export interface Window {
  /** 作り始める番号 */
  start: number
  /** 作り終える番号（この番号は含まない） */
  end: number
  /** 上に置く空きの高さ */
  padTop: number
  /** 下に置く空きの高さ */
  padBottom: number
}

export interface ListOptions {
  count: number
  /** 1件の高さ（すき間込み） */
  rowHeight: number
  /** いま見えている高さ */
  viewportHeight: number
  scrollTop: number
  /** 上下に余分に作る件数。少ないと、速く動かしたときに空白が見える */
  overscan?: number
}

/** 縦に1列だけ並ぶ一覧（SE の一覧など） */
export function listWindow(o: ListOptions): Window {
  const over = o.overscan ?? 4
  if (o.count <= 0) return { start: 0, end: 0, padTop: 0, padBottom: 0 }
  // **まだ測れていないときは、全部作る。**
  // 1件の高さは「実際に作った物」から測るので、ここで 0 件にすると
  // 測る相手がいなくなり、いつまでも何も出ない（実際にそれで空になった）。
  if (o.rowHeight <= 0 || o.viewportHeight <= 0)
    return { start: 0, end: o.count, padTop: 0, padBottom: 0 }
  const first = Math.max(0, Math.floor(o.scrollTop / o.rowHeight) - over)
  const visible = Math.ceil(o.viewportHeight / o.rowHeight) + over * 2
  const end = Math.min(o.count, first + visible)
  return {
    start: first,
    end,
    padTop: first * o.rowHeight,
    padBottom: Math.max(0, (o.count - end) * o.rowHeight)
  }
}

export interface GridOptions extends ListOptions {
  /** 1行に並ぶ数 */
  columns: number
}

/** 折り返して並ぶ格子（素材のカード）。行の単位で作る */
export function gridWindow(o: GridOptions): Window {
  const columns = Math.max(1, o.columns)
  const rows = Math.ceil(o.count / columns)
  const w = listWindow({ ...o, count: rows })
  return {
    start: w.start * columns,
    end: Math.min(o.count, w.end * columns),
    padTop: w.padTop,
    padBottom: w.padBottom
  }
}

/**
 * 幅から、1行に何個並ぶかを出す。
 * CSS の `repeat(auto-fill, minmax(min, 1fr))` と同じ数え方
 * （最低幅 + すき間 で割り切れるだけ並ぶ）。
 */
export function columnsFor(containerWidth: number, minCardWidth: number, gap: number): number {
  if (containerWidth <= 0 || minCardWidth <= 0) return 1
  return Math.max(1, Math.floor((containerWidth + gap) / (minCardWidth + gap)))
}
