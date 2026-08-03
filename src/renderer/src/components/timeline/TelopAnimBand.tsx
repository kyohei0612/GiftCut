// テロップの帯の中に出る「出入りの動き」の帯。
//
// 頭（出現）と尻（消失）で、置く側が左か右かと、つまみが右端か左端かが
// 逆になるだけで、あとは全く同じ。以前は同じものが2回書いてあった。
//
// 動画クリップのトランジションと同じ流儀にしてある
// （範囲を帯で見せる → クリックで選ぶ → 端をドラッグで長さ変更）。
// 片方だけ別の操作にすると、置き方を2つ覚えることになる。

import type { JSX } from 'react'

/**
 * これより細くなるなら出さない（px）。
 * **掴める最小の幅**でもある——これ未満だと、出しても掴めない。
 */
const MIN_BAND_PX = 8

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
}): JSX.Element | null {
  const isIn = side === 'in'
  // 帯の半分を超えない。超えると頭と尻が重なって、どちらを掴んでいるか分からない
  // **押し上げる前の、本来の幅で判断する。**
  // 先に MIN_BAND_PX まで押し上げてから「細いか」を見ても、必ず 8 以上なので
  // 何も減らない（最初そう書いて、実測で1つも減らずに気づいた）。
  const want = Math.min(dur * zoom, clipWidth * 0.5)
  const width = Math.max(want, MIN_BAND_PX)
  // **細すぎるときは作らない。**
  //
  // 全体表示だと 0.3秒の演出は約2px で、**見えていないのに要素だけ増える**。
  // 1つの演出で6個（頭・尻 × 帯・名前・つまみ）なので、演出248個で 1,488個。
  // 実測: 演出0個で DOM 1,678 / 248個で 3,166、再生ヘッドを掴んだときの重さも
  //       1,221 → 1,369ms とそれに比例して増えていた（2026-08-03）。
  //
  // **本人の症状は「再生ヘッドがカクつく。タイムラインだけ」。**
  // 掴んでいる間はタイムラインが描き直されるので、要素が多いほど直に効く。
  // 見えない物を作らなければ、見た目は何も変わらないまま軽くなる。
  //
  // 寄れば出てくる（`zoom` が上がれば幅が広がる）ので、**細かい調整は寄ってからやる**
  // ——どのみち 2px の帯は掴めない。
  if (want < MIN_BAND_PX) return null
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
