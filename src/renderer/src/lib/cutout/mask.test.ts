// 透過（切り抜き）のアルファ計算。**画面を起動せずに確かめる。**
// 順番（足切り→ペン→縮め広げ→なめらか→ぼかし）が変わると同じ設定で違う絵になるので、
// 順番に寄りかかる所を1つずつ固定する。
import { describe, expect, it } from 'vitest'
import {
  applyLabels, applyThreshold, boxBlur, composeAlpha, matteFromKey, runCutoutPipeline, shiftEdge, smoothEdge
} from './mask'
import { DEFAULT_CUTOUT } from './types'

/** w×h の一様なアルファ */
const flat = (w: number, h: number, v: number): Uint8ClampedArray => new Uint8ClampedArray(w * h).fill(v)
/** 真ん中に r 四方の不透明な四角 */
const square = (w: number, h: number, r: number): Uint8ClampedArray => {
  const a = flat(w, h, 0)
  for (let y = (h - r) / 2; y < (h + r) / 2; y++) for (let x = (w - r) / 2; x < (w + r) / 2; x++) a[y * w + x] = 255
  return a
}
const count = (a: Uint8ClampedArray, pred: (v: number) => boolean): number => a.reduce((n, v) => n + (pred(v) ? 1 : 0), 0)

describe('色で抜く（matteFromKey）', () => {
  it('拾った色そのものは透明、遠い色は不透明、間はなだらか', () => {
    const rgba = new Uint8ClampedArray([0, 0, 255, 255, 255, 0, 0, 255, 0, 0, 200, 255])
    // tol 20 → 距離 44 まで透明・70 から不透明。(0,0,200) は距離 55 で間に入る
    const a = matteFromKey(rgba, 3, 1, { r: 0, g: 0, b: 255, tol: 20 })
    expect(a[0]).toBe(0)
    expect(a[1]).toBe(255)
    expect(a[2]).toBeGreaterThan(0)
    expect(a[2]).toBeLessThan(255)
  })
  it('tol を上げるほど多く抜ける', () => {
    const rgba = new Uint8ClampedArray([0, 0, 200, 255])
    expect(matteFromKey(rgba, 1, 1, { r: 0, g: 0, b: 255, tol: 10 })[0]).toBeGreaterThan(
      matteFromKey(rgba, 1, 1, { r: 0, g: 0, b: 255, tol: 60 })[0]
    )
  })
})

describe('どこまで透過するか（applyThreshold）', () => {
  it('0 なら触らない（同じ物を返す）', () => {
    const a = flat(2, 2, 100)
    expect(applyThreshold(a, 0)).toBe(a)
  })
  it('しきい値以下は 0、255 は 255 のまま、間は伸びる', () => {
    const a = new Uint8ClampedArray([0, 100, 200, 255])
    const out = applyThreshold(a, 50)
    expect(out[0]).toBe(0)
    expect(out[1]).toBe(0)
    expect(out[2]).toBeGreaterThan(100)
    expect(out[3]).toBe(255)
  })
})

describe('ペンの指定（applyLabels）', () => {
  it('残す＝255、消す＝0、指定なしは据え置き', () => {
    const a = new Uint8ClampedArray([10, 20, 30])
    const out = applyLabels(a, new Uint8Array([1, 2, 0]))
    expect([...out]).toEqual([255, 0, 30])
  })
  it('指定が無ければ同じ物を返す', () => {
    const a = flat(1, 1, 7)
    expect(applyLabels(a, null)).toBe(a)
  })
})

describe('境界を縮める／広げる（shiftEdge）', () => {
  it('正で不透明が増え、負で減る。0 は触らない', () => {
    const a = square(16, 16, 6)
    const n0 = count(a, (v) => v === 255)
    expect(count(shiftEdge(a, 16, 16, 2), (v) => v === 255)).toBeGreaterThan(n0)
    expect(count(shiftEdge(a, 16, 16, -2), (v) => v === 255)).toBeLessThan(n0)
    expect(shiftEdge(a, 16, 16, 0)).toBe(a)
  })
  it('広げてから同じだけ縮めると、角を除いて元に戻る（四角の中は残る）', () => {
    const a = square(20, 20, 8)
    const back = shiftEdge(shiftEdge(a, 20, 20, 2), 20, 20, -2)
    expect(back[10 * 20 + 10]).toBe(255)
    expect(back[0]).toBe(0)
  })
})

describe('ぼかし（boxBlur）となめらか（smoothEdge）', () => {
  it('一様な絵はぼかしても変わらない（端で痩せない）', () => {
    const a = flat(8, 8, 255)
    expect([...boxBlur(a, 8, 8, 2)].every((v) => v === 255)).toBe(true)
  })
  it('ぼかすと縁に中間の値ができる', () => {
    const a = square(16, 16, 6)
    const b = boxBlur(a, 16, 16, 1)
    expect(count(b, (v) => v > 0 && v < 255)).toBeGreaterThan(0)
  })
  it('なめらかにすると、1px のゴミが消えて四角は残る', () => {
    const a = square(24, 24, 10)
    a[1] = 255 // 隅のゴミ
    const s = smoothEdge(a, 24, 24, 2)
    expect(s[1]).toBe(0)
    expect(s[12 * 24 + 12]).toBe(255)
    // 2値のまま（ぼかしの中間値を残さない）
    expect(count(s, (v) => v !== 0 && v !== 255)).toBe(0)
  })
})

describe('一本道（runCutoutPipeline）', () => {
  it('「残す」と塗った所は、足切りで消えない', () => {
    const matte = flat(4, 4, 40) // 全部あやしい
    const labels = new Uint8Array(16)
    labels[5] = 1
    const out = runCutoutPipeline(matte, labels, { ...DEFAULT_CUTOUT, threshold: 80, feather: 0 }, 4, 4)
    expect(out[5]).toBe(255)
    expect(out[0]).toBe(0)
  })
  it('ぼかし 0・ずらし 0 なら模型の答えがそのまま通る', () => {
    const matte = square(10, 10, 4)
    const out = runCutoutPipeline(matte, null, { ...DEFAULT_CUTOUT, threshold: 0, feather: 0 }, 10, 10)
    expect([...out]).toEqual([...matte])
  })
})

describe('RGBA の A を差し替える（composeAlpha）', () => {
  it('色は触らず A だけ入れ替わる', () => {
    const rgba = new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 255])
    const out = composeAlpha(rgba, new Uint8ClampedArray([0, 128]))
    expect([...out]).toEqual([1, 2, 3, 0, 4, 5, 6, 128])
  })
})
