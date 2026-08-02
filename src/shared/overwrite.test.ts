import { describe, it, expect } from 'vitest'
import { subtractRanges, isUntouched } from './overwrite'

const R = (start: number, end: number): { start: number; end: number } => ({ start, end })

describe('重なった分を削る（上書き）', () => {
  it('触れていなければ、そのまま残る', () => {
    const p = subtractRanges(R(1, 2), [R(3, 4)])
    expect(p).toEqual([R(1, 2)])
    expect(isUntouched(R(1, 2), p)).toBe(true)
  })

  // 端がぴったり接しているのは「重なっていない」。ここを重なりと見ると、
  // 隙間なく並べたテロップが、置き直すたびに削られていく
  it('端が接しているだけなら削らない', () => {
    expect(subtractRanges(R(1, 2), [R(2, 3)])).toEqual([R(1, 2)])
    expect(subtractRanges(R(1, 2), [R(0, 1)])).toEqual([R(1, 2)])
  })

  // 本人が言っていたのはこれ。「1個目が2個目の頭に重なった」
  it('頭に食い込まれたら、その分だけ頭が削れる', () => {
    expect(subtractRanges(R(1, 3), [R(0.5, 2)])).toEqual([R(2, 3)])
  })

  it('尻に食い込まれたら、その分だけ尻が削れる', () => {
    expect(subtractRanges(R(1, 3), [R(2, 5)])).toEqual([R(1, 2)])
  })

  it('丸ごと覆われたら消える', () => {
    expect(subtractRanges(R(1, 3), [R(0, 5)])).toEqual([])
  })

  // **ここで片方を捨てると、残せたはずの文字が黙って消える。**
  it('真ん中を抜かれたら、左右2つに割れる', () => {
    expect(subtractRanges(R(0, 10), [R(4, 6)])).toEqual([R(0, 4), R(6, 10)])
  })

  it('複数に削られても、残りが正しく出る', () => {
    expect(subtractRanges(R(0, 10), [R(2, 3), R(6, 7)])).toEqual([R(0, 2), R(3, 6), R(7, 10)])
  })

  // 1コマにも満たない切れ端は、線にしか見えず掴むことも消すこともできない
  it('短すぎる残りは捨てる', () => {
    expect(subtractRanges(R(0, 10), [R(0.05, 10)])).toEqual([])
    expect(subtractRanges(R(0, 10), [R(0.5, 10)])).toEqual([R(0, 0.5)])
  })

  it('削る側が空なら、何も起きない', () => {
    const p = subtractRanges(R(1, 2), [])
    expect(isUntouched(R(1, 2), p)).toBe(true)
  })
})
