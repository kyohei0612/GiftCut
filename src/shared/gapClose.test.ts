// 空きをどこまで詰めてよいか。**カットをまたぐ字幕があっても詰まる**ことを押さえる。
import { describe, expect, it } from 'vitest'
import { AT_START_EPS, TINY_GAP, planGapClose } from './gapClose'

const gap = { start: 10, end: 14 }

describe('空きを詰める判断', () => {
  it('何も載っていなければ尻まで詰め切る', () => {
    const p = planGapClose(gap, [])
    expect(p).toEqual({ to: 14, len: 4, blocked: null, whole: true })
  })

  it('**前のクリップから続いて空きに掛かっている字幕は、詰めるのを邪魔しない**', () => {
    // 2026-10-10 までここで止まっていた（「先頭に別のクリップが重なっています」）。
    // カットをまたぐ字幕は編集ではいくらでもあるので、ほとんどの空きが消せなかった
    const p = planGapClose(gap, [{ start: 8, end: 12 }])
    expect(p.blocked).toBeNull()
    expect(p.len).toBe(4)
    expect(p.whole).toBe(true)
  })

  it('空きの頭に置いた物は止める（空きに合わせて置いた物を巻き込まない）', () => {
    expect(planGapClose(gap, [{ start: 10, end: 11 }]).blocked).toBe('start')
    // 頭の直前（0.05秒未満手前）から始まる物も同じ扱い。詰めると長さが 0.05 を切って消えるため
    expect(planGapClose(gap, [{ start: 10 - AT_START_EPS / 2, end: 11 }]).blocked).toBe('start')
    expect(planGapClose(gap, [{ start: 10 - AT_START_EPS * 2, end: 11 }]).blocked).toBeNull()
  })

  it('空きの途中に置いた物の手前で止まる（巻き込まない）', () => {
    const p = planGapClose(gap, [{ start: 12, end: 13 }])
    expect(p).toEqual({ to: 12, len: 2, blocked: null, whole: false })
  })

  it('途中に置いた物が複数なら、いちばん手前', () => {
    const p = planGapClose(gap, [{ start: 13, end: 13.5 }, { start: 11.5, end: 12 }])
    expect(p.to).toBe(11.5)
  })

  it('空きの尻にぴったり始まる物は「途中」ではない（尻まで詰め切る）', () => {
    const p = planGapClose(gap, [{ start: 14, end: 15 }])
    expect(p.whole).toBe(true)
  })

  it('極小の空き（1コマ未満）は、何も載っていなければそのまま詰め切る', () => {
    const p = planGapClose({ start: 10, end: 10 + TINY_GAP / 2 }, [])
    expect(p.whole).toBe(true)
    expect(p.len).toBeLessThanOrEqual(TINY_GAP)
  })
})
