// タイムラインに並ぶ「帯」の共通の形。
//
// 効果音・画像・映像レイヤー・本編のカット……どれも見た目と操作は同じで、
//
//   左端をドラッグ = 頭を伸縮 / 右端をドラッグ = 尻を伸縮 / 本体をドラッグ = 移動
//   選ぶと縁が光る / ラベル色を付けると帯全体が塗られる
//
// この形を1か所に置く。ばらばらに書くと、種類によって
// 「左端が掴めない」「色が線だけ」といった食い違いが必ず出る
// （実際、色は線ではなく塗りにする、という判断を後から全種類に入れ直した）。

import type { JSX, ReactNode } from 'react'

export function ClipBand({
  className,
  label,
  left,
  width,
  height,
  top,
  title,
  selected,
  onPointerDown,
  onContextMenu,
  onTrimLeft,
  onTrimRight,
  onDelete,
  deleteTitle,
  children,
  style
}: {
  /** 種類ごとの見た目（se-clip / img-clip など） */
  className: string
  /** ラベル色。付いていれば帯全体を塗る（線だと見つけにくい） */
  label?: string
  left: number
  width: number
  height?: number
  top?: number
  title?: string
  selected?: boolean
  onPointerDown?: (e: React.PointerEvent) => void
  onContextMenu?: (e: React.MouseEvent) => void
  /** 端を掴んだときの伸縮。渡さなければ、その端は掴めない */
  onTrimLeft?: (e: React.PointerEvent) => void
  onTrimRight?: (e: React.PointerEvent) => void
  /** ✕ ボタン。渡さなければ出さない */
  onDelete?: (e: React.PointerEvent) => void
  deleteTitle?: string
  children?: ReactNode
  style?: React.CSSProperties
}): JSX.Element {
  return (
    <div
      className={`clip ${className} ${selected ? 'clip-selected' : ''}`}
      style={{
        background: label || undefined,
        left,
        width,
        ...(height != null ? { height } : null),
        ...(top != null ? { top } : null),
        ...style
      }}
      title={title}
      onPointerDown={onPointerDown}
      onContextMenu={onContextMenu}
    >
      {onTrimLeft && <div className="clip-trim clip-trim-l" onPointerDown={onTrimLeft} />}
      {children}
      {onDelete && (
        <button className="se-del" title={deleteTitle} onPointerDown={onDelete}>
          ✕
        </button>
      )}
      {onTrimRight && <div className="clip-trim clip-trim-r" onPointerDown={onTrimRight} />}
    </div>
  )
}
