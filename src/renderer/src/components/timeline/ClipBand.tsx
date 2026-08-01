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

/**
 * 帯を右クリックしたときに、クリップ用の品書きを開く。
 *
 * **手順が3つある。**「押した1つだけを選び直す → 元の品書きを閉じる →
 * クリップ用を開く」。選び直すのは、複数選んだまま右クリックしたときに
 * **押した物ではない方**へ操作が飛ぶのを防ぐため。
 * 同じ手順を帯の種類ごとに書くと片方だけ直す事故になるので、
 * 呼ぶ側（App）で1つにまとめて渡してもらう。
 */
export type OpenClipMenu = (
  e: React.MouseEvent,
  kind: 'seg' | 'se' | 'img' | 'vclip',
  clip: { id: number; name: string }
) => void

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
  onDoubleClick,
  onDragOver,
  onDragLeave,
  onDrop,
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
  onDoubleClick?: (e: React.MouseEvent) => void
  /** 帯の上に物を落とせる種類（テロップの出入りアニメなど）で使う */
  onDragOver?: (e: React.DragEvent) => void
  onDragLeave?: (e: React.DragEvent) => void
  onDrop?: (e: React.DragEvent) => void
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
      onDoubleClick={onDoubleClick}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
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
