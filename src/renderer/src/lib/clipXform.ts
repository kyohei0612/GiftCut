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
  // **並べる順が意味を持つ。** CSS は右にある物から先に当たるので、
  // ここは「最後に当てたい物ほど左」。動かす（translate）を左端に置いて、
  // **画面の向きのまま動く**ようにする。
  //
  // 2026-08-03 まで逆だった（回す・反転が左）。そのせいで:
  //
  //   反転した絵は、右へ掴んで動かすと**左へ動いた**（左右が真逆）
  //   回した絵は、掴んだ向きではなく**回った向きへ**動いた
  //
  // 掴む側（state/usePreviewManip）は画面の実寸の差をそのまま zoom.x に
  // 足している＝**画面の向きで動く前提**。書き出し（main/exportRun）も
  // 反転→回転→動かす の順で組んでいる。**画面だけが違っていた。**
  // 実測: 反転＋移動で 0.497（左右が真逆）、回転＋移動で 0.228 ずれていた。
  const parts: string[] = []
  const z = zoomAt(c.zoom, c.motion, localT)
  if (!isNeutralZoom(z))
    parts.push(
      `translate(${(z.x * 100).toFixed(3)}%, ${(z.y * 100).toFixed(3)}%) scale(${z.scale.toFixed(4)})`
    )
  if (c.rotate) parts.push(`rotate(${c.rotate}deg)`)
  if (c.flipH) parts.push('scaleX(-1)')
  if (c.flipV) parts.push('scaleY(-1)')
  return parts.length ? parts.join(' ') : undefined
}

/**
 * つなぎ目の演出（slide）と、切片の見た目（`clipXform`）を1つの transform にする。
 *
 * **動かす物ほど左**——上と同じ決まり。演出は「画面の上で右へ流す」ものなので、
 * 反転・回転より外側（左）でなければ、反転した切片だけ逆へ流れる。
 *
 * 2026-08-17 に足した。プレビューの本線（`state/usePreviewFrame`）が
 * **反転・回転を左に置いていた**——`clipXform` を 08-03 に直したときの
 * 取り残しで、掴んで動かすと左右が真逆になる。同じ間違いを2か所で
 * 別々に書いていたので、**繋ぎ方そのものをここへ出した**
 * （B面＝`state/useSegClock` の `xfBStyle` も、いまはここを通る）。
 */
export function moveThen(move?: string, look?: string): string | undefined {
  const s = [move, look].filter(Boolean).join(' ')
  return s || undefined
}
