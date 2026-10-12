// ペンの線 → 残す／消すの指定。雑な線が境界を読むか（smart）もここで見る。
import { describe, expect, it } from 'vitest'
import { rasterizeStrokes, stampDisc } from './strokes'
import type { CutoutStroke } from './types'

const count = (l: Uint8Array | null, v: number): number => (l ? l.reduce((n, x) => n + (x === v ? 1 : 0), 0) : 0)

describe('丸を打つ（stampDisc）', () => {
  it('半径の中だけ塗る。枠の外へは出ない', () => {
    const l = new Uint8Array(10 * 10)
    stampDisc(l, 10, 10, 0, 0, 2, 1)
    expect(l[0]).toBe(1)
    expect(l[2]).toBe(1)
    expect(l[3]).toBe(0)
    expect(l[5 * 10 + 5]).toBe(0)
  })
})

describe('線を指定にする（rasterizeStrokes）', () => {
  it('線が無ければ null（指定なしを配列で持たない）', () => {
    expect(rasterizeStrokes([], 4, 4)).toBeNull()
  })
  it('2点を結ぶと途中も塗られる（速く引いても途切れない）', () => {
    const st: CutoutStroke = { mode: 'drop', size: 2, smart: false, pts: [[0, 5], [19, 5]] }
    const l = rasterizeStrokes([st], 20, 10)!
    for (let x = 0; x < 20; x++) expect(l[5 * 20 + x]).toBe(2)
    expect(l[0]).toBe(0)
  })
  it('後から塗った線が勝つ', () => {
    const a: CutoutStroke = { mode: 'drop', size: 2, smart: false, pts: [[3, 3]] }
    const b: CutoutStroke = { mode: 'keep', size: 2, smart: false, pts: [[3, 3]] }
    expect(rasterizeStrokes([a, b], 8, 8)![3 * 8 + 3]).toBe(1)
  })
  it('かしこく塗ると、似た色の面へ広がり、違う色では止まる', () => {
    // 左半分が赤・右半分が青の 20×10
    const w = 20
    const h = 10
    const rgba = new Uint8ClampedArray(w * h * 4)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const p = (y * w + x) * 4
        rgba[p] = x < 10 ? 220 : 10
        rgba[p + 2] = x < 10 ? 10 : 220
        rgba[p + 3] = 255
      }
    const st: CutoutStroke = { mode: 'keep', size: 2, smart: true, pts: [[2, 5], [4, 5]] }
    const l = rasterizeStrokes([st], w, h, rgba)!
    // 赤の面は線（太さ2）から離れた所まで塗られる（届くのは太さの3倍＝6px まで）
    expect(l[5 * w + 8]).toBe(1)
    expect(l[2 * w + 6]).toBe(1)
    // 青の面には1画素も入らない
    for (let y = 0; y < h; y++) for (let x = 10; x < w; x++) expect(l[y * w + x]).toBe(0)
    expect(count(l, 1)).toBeGreaterThan(20)
  })
  it('かしこく塗っても、線の太さの数倍より遠くへは広がらない', () => {
    const w = 60
    const h = 4
    const rgba = new Uint8ClampedArray(w * h * 4).fill(200) // 全部同じ色
    const st: CutoutStroke = { mode: 'drop', size: 4, smart: true, pts: [[2, 2]] }
    const l = rasterizeStrokes([st], w, h, rgba)!
    expect(l[2 * w + 2]).toBe(2)
    expect(l[2 * w + 59]).toBe(0)
  })
})
