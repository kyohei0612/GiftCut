import { describe, it, expect } from 'vitest'
import { clipXform } from './clipXform'

// **画面と書き出しで、絵が同じ場所に出るか。**
//
// テロップには同じ押さえが `shared/clipMotion.test.ts` にあるが、
// **画像と映像レイヤーには無かった**。実際、2026-08-03 まで
//
//   反転した絵は、右へ掴んで動かすと**左へ動いた**（実測で 0.497 ずれ）
//   回した絵は、掴んだ向きではなく**回った向きへ**動いた（同 0.228）
//
// という食い違いがあり、書き出すまで気づけなかった。
//
// ## ここで見ているのは「順番」
//
// CSS は**右にある物から先に**当たる。書き出し（main/exportRun）は
// 反転 → 回転 → 動かす の順で組んでいるので、CSS では
// **動かす（translate）が左端**でなければ揃わない。
//
// 掴む側（state/usePreviewManip）は画面の実寸の差をそのまま zoom.x へ足している
// ＝**画面の向きで動く**前提。だから「動かす」は最後に当てる（＝左端）。

/** transform 文字列を 2x3 の行列にする（ブラウザと同じ左→右の掛け方） */
function toMatrix(css: string, w: number, h: number): number[] {
  const mul = (A: number[], B: number[]): number[] => [
    A[0] * B[0] + A[2] * B[1],
    A[1] * B[0] + A[3] * B[1],
    A[0] * B[2] + A[2] * B[3],
    A[1] * B[2] + A[3] * B[3],
    A[0] * B[4] + A[2] * B[5] + A[4],
    A[1] * B[4] + A[3] * B[5] + A[5]
  ]
  let M = [1, 0, 0, 1, 0, 0]
  for (const m of css.matchAll(/(\w+)\(([^)]*)\)/g)) {
    const fn = m[1]
    const args = m[2].split(',').map((s) => s.trim())
    if (fn === 'translate') {
      const px = (v: string, base: number): number =>
        v.endsWith('%') ? (parseFloat(v) / 100) * base : parseFloat(v)
      M = mul(M, [1, 0, 0, 1, px(args[0], w), px(args[1] ?? '0', h)])
    } else if (fn === 'scale') {
      const s = parseFloat(args[0])
      M = mul(M, [s, 0, 0, parseFloat(args[1] ?? args[0]), 0, 0])
    } else if (fn === 'scaleX') M = mul(M, [parseFloat(args[0]), 0, 0, 1, 0, 0])
    else if (fn === 'scaleY') M = mul(M, [1, 0, 0, parseFloat(args[0]), 0, 0])
    else if (fn === 'rotate') {
      const r = (parseFloat(args[0]) * Math.PI) / 180
      M = mul(M, [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0])
    }
  }
  return M
}

const W = 1920
const H = 1080
/** 絵の真ん中が、枠のどこに出るか（0〜1の割合） */
const centerOf = (c: Parameters<typeof clipXform>[0]): { x: number; y: number } => {
  const css = clipXform(c)
  if (!css) return { x: 0.5, y: 0.5 }
  const M = toMatrix(css, W, H)
  return { x: 0.5 + M[4] / W, y: 0.5 + M[5] / H }
}
/**
 * 書き出し側（main/exportRun）が置く場所。
 * 反転 → 回転 → 動かす の順。**動かすのは画面の向きのまま**（回さない・反転しない）。
 */
const exportCenter = (c: {
  rotate?: number
  flipH?: boolean
  flipV?: boolean
  zoom?: { scale: number; x: number; y: number }
}): { x: number; y: number } => {
  // 絵の真ん中は、反転しても回しても真ん中のまま。動かした分だけ動く
  const z = c.zoom
  return { x: 0.5 + (z?.x ?? 0), y: 0.5 + (z?.y ?? 0) }
}

describe('画面と書き出しで、絵が同じ場所に出る', () => {
  const CASES: { name: string; c: Parameters<typeof clipXform>[0] }[] = [
    { name: 'そのまま', c: {} },
    { name: '右下へ動かす', c: { zoom: { scale: 1, x: 0.2, y: 0.1 } } },
    { name: '寄せて動かす', c: { zoom: { scale: 1.5, x: 0.15, y: -0.1 } } },
    { name: '**動かして左右反転**', c: { flipH: true, zoom: { scale: 1, x: 0.25, y: 0 } } },
    { name: '**動かして上下反転**', c: { flipV: true, zoom: { scale: 1, x: 0, y: 0.25 } } },
    { name: '**動かして回す**', c: { rotate: 30, zoom: { scale: 1, x: 0.25, y: 0 } } },
    {
      name: '全部いっぺんに',
      c: { rotate: 45, flipH: true, flipV: true, zoom: { scale: 1.3, x: -0.2, y: 0.15 } }
    }
  ]
  for (const { name, c } of CASES) {
    it(name, () => {
      const a = centerOf(c)
      const b = exportCenter(c)
      expect(a.x).toBeCloseTo(b.x, 5)
      expect(a.y).toBeCloseTo(b.y, 5)
    })
  }

  it('動かす指定が無ければ、transform は出さない（style に空文字を置かない）', () => {
    expect(clipXform({})).toBeUndefined()
  })

  it('**動かすのは左端**（CSS は右から当たるので、最後に効かせる）', () => {
    const css = clipXform({ rotate: 20, flipH: true, zoom: { scale: 1, x: 0.3, y: 0 } })!
    expect(css.indexOf('translate')).toBe(0)
    expect(css.indexOf('rotate')).toBeGreaterThan(css.indexOf('translate'))
    expect(css.indexOf('scaleX')).toBeGreaterThan(css.indexOf('rotate'))
  })

  it('回しても反転しても、**寄せ方（scale）は変わらない**', () => {
    for (const c of [
      { zoom: { scale: 2, x: 0, y: 0 } },
      { rotate: 30, zoom: { scale: 2, x: 0, y: 0 } },
      { flipH: true, zoom: { scale: 2, x: 0, y: 0 } }
    ]) {
      const M = toMatrix(clipXform(c)!, W, H)
      // 行列の伸び具合（行の長さ）が倍率そのもの
      expect(Math.hypot(M[0], M[1])).toBeCloseTo(2, 5)
    }
  })
})
