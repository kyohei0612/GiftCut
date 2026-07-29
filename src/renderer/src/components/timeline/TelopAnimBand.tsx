// テロップの帯の中に出る「出入りの動き」の帯。
//
// 頭（出現）と尻（消失）で、置く側が左か右かと、つまみが右端か左端かが
// 逆になるだけで、あとは全く同じ。以前は同じものが2回書いてあった。
//
// 動画クリップのトランジションと同じ流儀にしてある
// （範囲を帯で見せる → クリックで選ぶ → 端をドラッグで長さ変更）。
// 片方だけ別の操作にすると、置き方を2つ覚えることになる。

import type { JSX } from 'react'

export function TelopAnimBand({
  side,
  label,
  dur,
  clipWidth,
  zoom,
  selected,
  onSelect,
  onResizeStart
}: {
  side: 'in' | 'out'
  /** 動きの名前（フェード・スライドなど） */
  label: string
  dur: number
  /** 帯そのものの幅（px）。動きの帯は半分までに収める */
  clipWidth: number
  zoom: number
  selected: boolean
  onSelect: () => void
  /** つまみを掴んだとき。dir は伸びる向き（頭=+1 / 尻=-1） */
  onResizeStart: (e: React.PointerEvent, dir: 1 | -1) => void
}): JSX.Element {
  const isIn = side === 'in'
  // 帯の半分を超えない。超えると頭と尻が重なって、どちらを掴んでいるか分からない
  const width = Math.max(Math.min(dur * zoom, clipWidth * 0.5), 8)
  return (
    <div
      className={`ttrans ttrans-telop ${isIn ? '' : 'ttrans-telop-out'} ${selected ? 'ttrans-sel' : ''}`}
      style={isIn ? { left: 0, width } : { right: 0, width }}
      title={`${isIn ? '頭' : '尻'} ${label} ${dur.toFixed(2)}s（クリックで選択・Deleteで削除）`}
      onPointerDown={(e) => {
        e.stopPropagation()
        if (e.button === 0) onSelect()
      }}
    >
      <span className="ttrans-lb">{isIn ? `▶${label}` : `${label}◀`}</span>
      <div
        className={`ttrans-resize ${isIn ? 'ttrans-resize-r' : 'ttrans-resize-l'}`}
        title="ドラッグで長さ変更"
        onPointerDown={(e) => {
          onSelect()
          onResizeStart(e, isIn ? 1 : -1)
        }}
      />
    </div>
  )
}
