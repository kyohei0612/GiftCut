import { describe, it, expect } from 'vitest'
import { tickStep, visibleTicks } from './rulerTicks'

// **見えている分だけ作る**のが要点。
//
// 前は端から端まで作っていて、実データ（451秒）で寄せると目盛りだけで
// 4,538 個の要素になっていた（帯は23個しか描いていないのに）。

const FPS = 30

describe('刻みの決め方（ここは変えていない）', () => {
  it('寄るほど細かくなる', () => {
    const a = tickStep(6, FPS).major
    const b = tickStep(60, FPS).major
    const c = tickStep(600, FPS).major
    expect(a).toBeGreaterThan(b)
    expect(b).toBeGreaterThan(c)
  })

  it('大きい目盛りは、数字が入る幅（84px）を割らない', () => {
    for (const z of [6, 20, 60, 200, 600]) {
      expect(tickStep(z, FPS).major * z).toBeGreaterThanOrEqual(84)
    }
  })

  it('小さい目盛りは、7px 未満に詰まらない', () => {
    for (const z of [6, 20, 60, 200, 600]) {
      const { minor } = tickStep(z, FPS)
      expect(minor * z).toBeGreaterThanOrEqual(7 - 1e-9)
    }
  })

  it('いちばん細かくても1コマまで', () => {
    expect(tickStep(100000, FPS).major).toBeGreaterThanOrEqual(1 / FPS - 1e-9)
  })
})

describe('見えている範囲だけ作る', () => {
  it('**画面の外の分は作らない**（実データの形で桁が変わる）', () => {
    // 451秒・寄せた状態（1秒150px）で、見えているのは 1456px ぶんだけ
    const all = visibleTicks(150, 451, FPS, 0, 0).length // 幅が取れない＝全部
    const win = visibleTicks(150, 451, FPS, 20000, 1456).length
    expect(win).toBeLessThan(all / 5)
  })

  it('見えている所は必ず埋まっている（送っても端が空かない）', () => {
    const ticks = visibleTicks(150, 451, FPS, 20000, 1456)
    const lefts = ticks.map((t) => t.left)
    expect(Math.min(...lefts)).toBeLessThanOrEqual(20000)
    expect(Math.max(...lefts)).toBeGreaterThanOrEqual(20000 + 1456)
  })

  it('**前後に1画面ぶん余分に作る**（送っている間に作り足す）', () => {
    const ticks = visibleTicks(150, 451, FPS, 20000, 1456)
    expect(Math.min(...ticks.map((t) => t.left))).toBeLessThan(20000)
    expect(Math.max(...ticks.map((t) => t.left))).toBeGreaterThan(20000 + 1456)
  })

  it('左端では、0より手前を作らない', () => {
    const ticks = visibleTicks(150, 451, FPS, 0, 1456)
    expect(Math.min(...ticks.map((t) => t.left))).toBeGreaterThanOrEqual(0)
  })

  it('右端では、終わりより先を作らない', () => {
    const endPx = 451 * 150
    const ticks = visibleTicks(150, 451, FPS, endPx - 1456, 1456)
    expect(Math.max(...ticks.map((t) => t.left))).toBeLessThanOrEqual(endPx + 1e-6)
  })

  it('幅が取れないうちは全部作る（起動直後の1回だけ通る道）', () => {
    const ticks = visibleTicks(6, 60, FPS, 0, 0)
    expect(ticks[0].left).toBe(0)
    expect(Math.max(...ticks.map((t) => t.left))).toBeCloseTo(60 * 6, 0)
  })

  it('**作りすぎない歯止めがある**（極端に細かくても止まる）', () => {
    expect(visibleTicks(100000, 100000, FPS, 0, 0).length).toBeLessThanOrEqual(3000)
  })

  it('数字は太い目盛りにだけ付く', () => {
    const ticks = visibleTicks(60, 60, FPS, 0, 1456)
    for (const t of ticks) {
      if (t.major) expect(t.time).toBeTypeOf('number')
      else expect(t.time).toBeUndefined()
    }
  })

  it('太い目盛りは、刻みのちょうどの所に来る', () => {
    const { major } = tickStep(60, FPS)
    for (const t of visibleTicks(60, 60, FPS, 0, 1456).filter((x) => x.major)) {
      expect(Math.abs((t.time! / major) - Math.round(t.time! / major))).toBeLessThan(1e-6)
    }
  })

  it('長さ0でも落ちない', () => {
    expect(() => visibleTicks(60, 0, FPS, 0, 1456)).not.toThrow()
  })
})
