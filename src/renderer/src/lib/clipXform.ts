// 重ねた物（映像レイヤー・画像）の CSS transform を作る。
//
// ## なぜ「落とす」から出したか
//
// 元は `state/useMediaDrop` に居たが、あちらの頭のコメントが宣言しているのは
// 「素材を掴んでタイムラインへ落とす。どの段の、どこへ置くか」だけで、
// **描画の話は1行も無かった**。読む相手も `PreviewLayers` / `PreviewArea` で、
// 落とす動作とは一度も交わらない。React の状態も心臓も要らない。
//
// ## 2つあったのを1つにした
//
// `vcXform`（映像レイヤー用）と `imgXform`（画像用）は、**本体が1文字も
// 違わなかった**（引数の型だけ違った）。片方だけ直して片方が置き去りになる形
// だったので、構造的な型で受ける1本にまとめた
// （2026-08-03。計算は変えていない）。

import { zoomAt, type ClipMotion } from '../../../shared/clipMotion'
import { isNeutralZoom } from './clipLook'

/**
 * 回転／反転＋ズームを、CSS の transform 文字列にする。
 *
 * `localT` はクリップの先頭からの秒。動きが付いていればその瞬間のズームになる
 * （印が無ければ `zoomAt` は固定値をそのまま返すので、今までと同じ絵）。
 * 何も掛かっていなければ `undefined`（style に空文字を置かないため）。
 */
export function clipXform(
  c: {
    rotate?: number
    flipH?: boolean
    flipV?: boolean
    zoom?: { scale: number; x: number; y: number }
    motion?: ClipMotion
  },
  localT = 0
): string | undefined {
  const parts: string[] = []
  if (c.rotate) parts.push(`rotate(${c.rotate}deg)`)
  if (c.flipH) parts.push('scaleX(-1)')
  if (c.flipV) parts.push('scaleY(-1)')
  const z = zoomAt(c.zoom, c.motion, localT)
  if (!isNeutralZoom(z))
    parts.push(
      `translate(${(z.x * 100).toFixed(3)}%, ${(z.y * 100).toFixed(3)}%) scale(${z.scale.toFixed(4)})`
    )
  return parts.length ? parts.join(' ') : undefined
}
