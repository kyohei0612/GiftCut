// 画面に出ている物だけを作る箱。
//
// 素材の置き場は、開いた折りたたみが同じスクロールの中に何段も並ぶ。
// なので箱ごとに「自分がスクロールの中のどこから始まるか」を測り、
// そこから見えている範囲だけを作る。上下には見えていないぶんの高さを空きで置くので、
// スクロールの長さもつまみの動きも今までどおりになる。
//
// 1件の高さは**実際に作った物から測る**（中身の高さ ÷ 作った行数）。
// 決め打ちにすると、パネルの幅を変えてカードの大きさが変わったときに、
// 空きの高さと中身がずれる。

import { useLayoutEffect, useRef, useState, type JSX, type ReactNode } from 'react'
import { gridWindow, columnsFor } from '../../../shared/virtualList'
import type { Viewport } from './useVirtual'

export function VirtualBlock<T>({
  items,
  viewport,
  className,
  grid,
  fixedRowHeight,
  children,
  onVisible
}: {
  items: T[]
  viewport: Viewport
  className?: string
  /** 格子のとき: カードの最低幅とすき間（CSS と同じ値にする） */
  grid?: { minWidth: number; gap: number }
  /** 1件の高さが分かっているとき（縦一列の一覧など） */
  fixedRowHeight?: number
  children: (item: T, index: number) => ReactNode
  /** いま見えている物（サムネや波形を、見えている物だけ用意するため） */
  onVisible?: (items: T[]) => void
}): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null)
  const innerRef = useRef<HTMLDivElement | null>(null)
  /**
   * スクロールの中で、この箱が始まる位置。
   *
   * **測る前を 0 と決め打ってはいけない。** 前は `useState(0)` で始めていたので、
   * 一覧を下まで送った状態で別の節を開くと、その節の1回目の描画で
   * `scrollTop - 0` ＝ 送った量そのものが「この箱の中でのスクロール量」になり、
   * **一覧の途中から描き始めていた**（本人から「1からではなく途中から表示される」）。
   * 測れるまでは null にして、下の `ready` で「まだ窓を掛けない」に倒す。
   */
  const [top, setTop] = useState<number | null>(null)
  const [rowH, setRowH] = useState(fixedRowHeight ?? 0)

  const columns = grid ? columnsFor(viewport.width, grid.minWidth, grid.gap) : 1
  // **測れていないうちは全部作る。** 高さも位置も、実物が無いと測れない。
  // 窓を掛けるのは両方が分かってから（片方でも当て推量にすると、上の事故が起きる）
  const ready = rowH > 0 && top != null
  const w = gridWindow({
    count: items.length,
    columns,
    rowHeight: rowH,
    viewportHeight: ready ? viewport.height : 0,
    scrollTop: Math.max(0, viewport.scrollTop - (top ?? 0)),
    overscan: 2
  })
  const shown = items.slice(w.start, w.end)

  // **描き直すたびに測らない。** `offsetTop` / `offsetHeight` を読むと、その場で
  // 画面全体のレイアウトが走る（強制レイアウト）。前はこの effect に依存が無く、
  // 再生中は親が毎コマ描き直るので**毎コマ、テロップ168本・切片51本の画面を測り直して
  // いた**。速い PC で 64ms/秒、本人のサブPCでは 1コマ 100ms 超＝音のカクつきの正体
  //（2026-10-12 の動きの記録。再生中の「塞いだ時間」が 150〜230ms/秒、落コマは 0）。
  // 測るのは、形が変わりうるとき＝見える範囲・件数・列数が変わったときと、
  // 周りの大きさが変わったとき（ResizeObserver。上の折りたたみが開いて offsetTop が動く）だけ
  const [bump, setBump] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (el && el.offsetTop !== top) setTop(el.offsetTop)
    if (fixedRowHeight) return
    const inner = innerRef.current
    const rows = Math.ceil(shown.length / Math.max(1, columns))
    if (inner && rows > 0) {
      const gap = grid?.gap ?? 0
      const h = (inner.offsetHeight + gap) / rows
      if (h > 0 && Math.abs(h - rowH) > 1) setRowH(h)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewport.width, viewport.height, viewport.scrollTop, items.length, columns, fixedRowHeight, bump])
  useLayoutEffect(() => {
    const el = ref.current
    const parent = el?.parentElement
    if (!parent || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setBump((b) => b + 1))
    ro.observe(parent)
    if (innerRef.current) ro.observe(innerRef.current)
    return () => ro.disconnect()
  }, [])

  useLayoutEffect(() => {
    onVisible?.(shown)
    // 見えている範囲が変わったときだけ知らせる
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w.start, w.end, items])

  return (
    <div ref={ref}>
      {w.padTop > 0 && <div style={{ height: w.padTop }} aria-hidden="true" />}
      <div className={className} ref={innerRef}>
        {shown.map((item, i) => children(item, w.start + i))}
      </div>
      {w.padBottom > 0 && <div style={{ height: w.padBottom }} aria-hidden="true" />}
    </div>
  )
}
