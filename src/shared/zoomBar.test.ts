import { describe, it, expect } from 'vitest'
import { barSpan, zoomFromSpan, panFromSpan } from './zoomBar'

const TOTAL = 100 // 秒
const VIEW = 800 // px
const LIM = { min: 6, max: 240 }

describe('拡大バーの範囲', () => {
  it('全部見えているときは端から端まで', () => {
    // 100秒 × 8px/秒 = 800px ＝ ちょうど画面いっぱい
    expect(barSpan(0, VIEW, TOTAL, 8)).toEqual({ a: 0, b: 1 })
  })

  it('寄っているときは、見えている割合だけになる', () => {
    // 100秒 × 32px/秒 = 3200px のうち 800px ぶん＝1/4
    const s = barSpan(0, VIEW, TOTAL, 32)
    expect(s.a).toBeCloseTo(0, 6)
    expect(s.b).toBeCloseTo(0.25, 6)
  })

  it('右へ送ると、つまみも右へ動く', () => {
    const s = barSpan(1600, VIEW, TOTAL, 32)
    expect(s.a).toBeCloseTo(0.5, 6)
    expect(s.b).toBeCloseTo(0.75, 6)
  })
})

describe('つまみから拡大率を出す', () => {
  it('つまみを狭めると寄る', () => {
    const wide = zoomFromSpan({ a: 0, b: 1 }, TOTAL, VIEW, LIM)
    const narrow = zoomFromSpan({ a: 0, b: 0.25 }, TOTAL, VIEW, LIM)
    expect(narrow.zoom).toBeGreaterThan(wide.zoom)
    expect(narrow.zoom).toBeCloseTo(32, 6) // 25秒を 800px で見る
  })

  // **右のボッチを掴んだのに左まで動くと、見ていた場所を見失う。**
  it('右の端を動かしても、左の端は動かない', () => {
    const r = zoomFromSpan({ a: 0.5, b: 0.75 }, TOTAL, VIEW, LIM, 'r')
    // 左端 50秒 のまま
    expect(r.scrollLeft / r.zoom).toBeCloseTo(50, 6)
  })

  it('左の端を動かしても、右の端は動かない', () => {
    const r = zoomFromSpan({ a: 0.5, b: 0.75 }, TOTAL, VIEW, LIM, 'l')
    // 右端 75秒 のまま（左端＝右端 − 見えている秒数）
    expect(r.scrollLeft / r.zoom + VIEW / r.zoom).toBeCloseTo(75, 6)
  })

  it('限界より寄れない・引けない', () => {
    expect(zoomFromSpan({ a: 0, b: 0.001 }, TOTAL, VIEW, LIM).zoom).toBe(LIM.max)
    expect(zoomFromSpan({ a: 0, b: 1 }, 10000, VIEW, LIM).zoom).toBe(LIM.min)
  })

  // **細さの下限をここに置いてはいけない。** 置くと、短い素材では
  // つまみの下限に先に当たって拡大の上限まで寄れなくなる（Ctrl+ホイールとも食い違う）。
  // 潰れたつまみは描くときに最低幅を持たせる（CSS）ので、ここは上限まで寄れてよい
  it('つまみを潰しても壊れず、上限まで寄れる', () => {
    const r = zoomFromSpan({ a: 0.5, b: 0.5 }, TOTAL, VIEW, LIM)
    expect(r.zoom).toBe(LIM.max)
    expect(Number.isFinite(r.scrollLeft)).toBe(true)
  })
})

describe('つまみを丸ごと動かす（移動）', () => {
  it('拡大率は変わらず、見る所だけ動く', () => {
    const span = { a: 0, b: 0.25 }
    expect(panFromSpan(0.5, span, TOTAL, 32)).toBeCloseTo(0.5 * TOTAL * 32, 6)
  })

  it('右へ行き過ぎない（つまみが端からはみ出さない）', () => {
    const span = { a: 0, b: 0.25 }
    // 0.9 まで動かしても、右端は 1.0 で止まる＝左端は 0.75
    expect(panFromSpan(0.9, span, TOTAL, 32)).toBeCloseTo(0.75 * TOTAL * 32, 6)
  })

  it('左へも行き過ぎない', () => {
    expect(panFromSpan(-0.5, { a: 0.3, b: 0.5 }, TOTAL, 32)).toBe(0)
  })
})
