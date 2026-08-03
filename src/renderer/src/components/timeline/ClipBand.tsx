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

/** 端のつまみの幅（px）。styles.css の .clip-trim と同じ値 */
const TRIM_PX = 7

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
  group,
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
  /**
   * 「組」（ネスト）の番号。付いていれば帯に印を出す。
   *
   * **印が無いと、掴んだ物ではない帯が動いた理由が分からない。**
   * 中身を押し出さないよう、CSS の ::before で左上に小さく重ねるだけにしてある。
   */
  group?: number
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
  // **細い帯には端のつまみを出さない。**
  //
  // つまみは片側 7px。帯が 14px 以下だと**左右のつまみで全部埋まり、本体を
  // 掴んで動かせない**——出しても掴めないうえ、動かす操作の邪魔をしていた。
  //
  // 要素の数にも効く。実データ（451秒・248テロップ）の全体表示では
  // `clip-trim` が 558個（帯1つに2個）で、タイムラインの中で一番多かった。
  // **掴んでいる間はタイムラインが描き直される**ので、数が直に効く
  //（本人の症状は「再生ヘッドがカクつく。タイムラインだけ」。2026-08-03）。
  //
  // 端を摘みたいときは寄る。どのみち 12px の帯の端は狙えない。
  const wideEnoughToTrim = width > TRIM_PX * 2
  return (
    <div
      className={`clip ${className} ${selected ? 'clip-selected' : ''} ${group ? 'clip-nested' : ''}`}
      style={{
        // **`'none'` は色ではない。** CSS の `background: none` は「塗らない」なので、
        // そのまま渡すと帯が透明になって背景と同化する（古い保存に `'none'` が
        // 入っている。作る側は `lib/labels` のラベンダー）。色でない値は無視して、
        // CSS 側の既定の塗りに任せる
        background: label && label !== 'none' ? label : undefined,
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
      {onTrimLeft && wideEnoughToTrim && (
        <div className="clip-trim clip-trim-l" onPointerDown={onTrimLeft} />
      )}
      {children}
      {onDelete && (
        <button className="se-del" title={deleteTitle} onPointerDown={onDelete}>
          ✕
        </button>
      )}
      {onTrimRight && wideEnoughToTrim && (
        <div className="clip-trim clip-trim-r" onPointerDown={onTrimRight} />
      )}
    </div>
  )
}
