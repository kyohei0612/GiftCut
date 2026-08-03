import { describe, it, expect } from 'vitest'
import { barSpan, zoomFromSpan, panFromSpan, fitZoom, minZoom } from './zoomBar'

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

// **目一杯引いたら全体が見える**（2026-08-03。プレミアに揃えた）。
//
// 前は下限が 6px/秒 の固定で、しかも「↔ 全体表示」も同じ 6 で頭打ちだったので、
// **長い素材では全体を見る手段が1つも無かった**。
describe('引ける下限と、全体が収まる率', () => {
  it('全体が収まる率は「見えている幅 ÷ 長さ」（余白ぶんだけ引く）', () => {
    // 1,000px の窓に 100秒 → 余白40を引いて 960/100 = 9.6px/秒
    expect(fitZoom(1000, 100)).toBeCloseTo(9.6, 6)
  })

  it('**短すぎる中身は 10秒として扱う**（0 除算と、寄りすぎで消えるのを防ぐ）', () => {
    expect(fitZoom(1000, 2)).toBeCloseTo(96, 6)
    expect(fitZoom(1000, 0)).toBeCloseTo(96, 6)
  })

  it('**長い素材では下限が下がる**（451秒の実データ。6px/秒では全体が入らない）', () => {
    const z = minZoom(1000, 451, 6)
    expect(z).toBeCloseTo(960 / 451, 6) // ≒ 2.13px/秒
    expect(z).toBeLessThan(6)
    // ここまで引ければ、451秒 × 2.13 ≒ 960px ＝ 窓に収まる
    expect(451 * z).toBeLessThanOrEqual(1000)
  })

  it('**短い素材では今までどおり**（引ける範囲を狭めない）', () => {
    // 20秒なら全体が収まる率は 48px/秒。そこを下限にすると**今より引けなくなる**ので、
    // 小さい方（＝これまでの下限 6）を採る
    expect(minZoom(1000, 20, 6)).toBe(6)
  })

  it('幅が測れないときは、これまでの下限のまま（起動直後に 0 で潰れない）', () => {
    expect(minZoom(0, 451, 6)).toBe(6)
    expect(minZoom(NaN, 451, 6)).toBe(6)
  })
})
