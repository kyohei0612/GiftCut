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
  const [top, setTop] = useState(0)
  const [rowH, setRowH] = useState(fixedRowHeight ?? 0)

  const columns = grid ? columnsFor(viewport.width, grid.minWidth, grid.gap) : 1
  // 高さがまだ測れていないうちは全部作る（測る相手が要るので）
  const w = gridWindow({
    count: items.length,
    columns,
    rowHeight: rowH,
    viewportHeight: rowH > 0 ? viewport.height : 0,
    scrollTop: Math.max(0, viewport.scrollTop - top),
    overscan: 2
  })
  const shown = items.slice(w.start, w.end)

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
  })

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
