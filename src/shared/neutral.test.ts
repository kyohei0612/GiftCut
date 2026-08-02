import { describe, expect, it } from 'vitest'
import { isNeutralAdjust, isNeutralCrop, isNeutralZoom } from './neutral'

describe('触っていないのと同じか', () => {
  it('無ければ「触っていない」', () => {
    expect(isNeutralZoom(undefined)).toBe(true)
    expect(isNeutralCrop(undefined)).toBe(true)
    expect(isNeutralAdjust(undefined)).toBe(true)
  })

  it('素の値は「触っていない」', () => {
    expect(isNeutralZoom({ scale: 1, x: 0, y: 0 })).toBe(true)
    expect(isNeutralCrop({ l: 0, t: 0, r: 0, b: 0 })).toBe(true)
    expect(isNeutralAdjust({ b: 1, c: 1, s: 1 })).toBe(true)
  })

  it('**つまみで戻したときの誤差は「触っていない」扱い**（ここが揃っていないと画面と書き出しがズレる）', () => {
    expect(isNeutralZoom({ scale: 1.0000001, x: 0, y: 0 })).toBe(true)
    expect(isNeutralZoom({ scale: 1, x: 1e-9, y: -1e-9 })).toBe(true)
    expect(isNeutralCrop({ l: 1e-9, t: 0, r: 0, b: 0 })).toBe(true)
    expect(isNeutralAdjust({ b: 0.9999999, c: 1, s: 1 })).toBe(true)
  })

  it('本当に触っていたら「触っている」', () => {
    expect(isNeutralZoom({ scale: 1.2, x: 0, y: 0 })).toBe(false)
    expect(isNeutralZoom({ scale: 1, x: 0.5, y: 0 })).toBe(false)
    expect(isNeutralCrop({ l: 0.1, t: 0, r: 0, b: 0 })).toBe(false)
    expect(isNeutralAdjust({ b: 1, c: 1.2, s: 1 })).toBe(false)
  })

  it('幅のすぐ外は「触っている」（ゆるすぎない）', () => {
    expect(isNeutralZoom({ scale: 1.01, x: 0, y: 0 })).toBe(false)
    expect(isNeutralCrop({ l: 0.001, t: 0, r: 0, b: 0 })).toBe(false)
    expect(isNeutralAdjust({ b: 1.01, c: 1, s: 1 })).toBe(false)
  })
})
