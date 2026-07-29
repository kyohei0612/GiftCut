import { describe, it, expect } from 'vitest'
import { listWindow, gridWindow, columnsFor } from './virtualList'

describe('縦一列の一覧', () => {
  const base = { count: 1000, rowHeight: 30, viewportHeight: 300, scrollTop: 0, overscan: 2 }

  it('先頭では、見えているぶん＋余分だけ作る（1000件でも十数件）', () => {
    const w = listWindow(base)
    expect(w.start).toBe(0)
    expect(w.end).toBe(14) // 10件見える + 余分2×2
    expect(w.padTop).toBe(0)
    expect(w.padBottom).toBe((1000 - 14) * 30)
  })

  it('下へ動かすと、その周りだけ作る', () => {
    const w = listWindow({ ...base, scrollTop: 3000 }) // 100件目あたり
    expect(w.start).toBe(98)
    expect(w.end).toBe(112)
    expect(w.padTop).toBe(98 * 30)
  })

  it('上下の空きを足すと、全部作ったときと同じ高さになる（つまみの動きが変わらない）', () => {
    for (const scrollTop of [0, 1234, 29000]) {
      const w = listWindow({ ...base, scrollTop })
      const made = (w.end - w.start) * 30
      expect(w.padTop + made + w.padBottom).toBe(1000 * 30)
    }
  })

  it('いちばん下では、最後の件で止まる', () => {
    const w = listWindow({ ...base, scrollTop: 1000 * 30 })
    expect(w.end).toBe(1000)
    expect(w.padBottom).toBe(0)
  })

  it('0件なら何も作らない', () => {
    expect(listWindow({ ...base, count: 0 })).toEqual({ start: 0, end: 0, padTop: 0, padBottom: 0 })
  })

  it('高さがまだ分からないときは、全部作る（初回に何も出ないのを防ぐ）', () => {
    const w = listWindow({ ...base, viewportHeight: 0 })
    expect(w.start).toBe(0)
    expect(w.end).toBe(1000)
  })

  it('報告された不具合: 1件の高さがまだ測れていなくても、全部作る', () => {
    // 高さは「実際に作った物」から測る。ここで0件にすると測る相手がいなくなり、
    // いつまでも何も出ない（ビンが空になった）
    const w = listWindow({ ...base, rowHeight: 0 })
    expect(w.start).toBe(0)
    expect(w.end).toBe(1000)
  })
})

describe('折り返す格子', () => {
  const base = { count: 100, rowHeight: 100, viewportHeight: 400, scrollTop: 0, columns: 3, overscan: 1 }

  it('行の単位で作る（行の途中で切れない）', () => {
    const w = gridWindow(base)
    expect(w.start % 3).toBe(0)
    expect(w.end % 3).toBe(0)
  })

  it('下へ動かすと、その行の周りだけ作る', () => {
    const w = gridWindow({ ...base, scrollTop: 1000 }) // 10行目
    expect(w.start).toBe(27) // 9行目の先頭
    expect(w.padTop).toBe(900)
  })

  it('端数の行も最後まで作る', () => {
    const w = gridWindow({ ...base, count: 10, scrollTop: 0 })
    expect(w.end).toBe(10)
    expect(w.padBottom).toBe(0)
  })

  it('列が0や負でも1列として扱う（0除算で固まらない）', () => {
    expect(() => gridWindow({ ...base, columns: 0 })).not.toThrow()
    expect(gridWindow({ ...base, columns: 0 }).start).toBe(0)
  })
})

describe('1行に何個並ぶか', () => {
  it('CSS の auto-fill と同じ数え方', () => {
    // 幅300・最低96・すき間8 → (300+8)/(96+8) = 2.96 → 2個
    expect(columnsFor(300, 96, 8)).toBe(2)
    expect(columnsFor(400, 96, 8)).toBe(3)
    expect(columnsFor(96, 96, 8)).toBe(1)
  })
  it('幅が取れていなくても1以上を返す', () => {
    expect(columnsFor(0, 96, 8)).toBe(1)
    expect(columnsFor(-10, 96, 8)).toBe(1)
  })
})
