// 「詰まる」— 境目より後ろをまとめてずらす規則。
//
// **1つでもずらし忘れると、そこだけ置き去りになる。**
// 切片を消して詰めたのに文字だけ元の位置に残る、効果音だけずれる——
// 編集中は気づきにくく、書き出してから分かる類。

import { describe, expect, it } from 'vitest'
import { RIPPLE_EPS, isAfter, shiftRange, shiftStart } from './ripple'

describe('境目より後ろか', () => {
  it('後ろなら true', () => {
    expect(isAfter(5, 3)).toBe(true)
  })

  it('手前なら false', () => {
    expect(isAfter(1, 3)).toBe(false)
  })

  it('**ちょうど境目は「後ろ」として扱う**（切った直後の物を取り残さない）', () => {
    expect(isAfter(3, 3)).toBe(true)
  })

  it('浮動小数の誤差ぶんは大目に見る', () => {
    // 3.0 のつもりが 2.9999999 になっていても、取り残さない
    expect(isAfter(3 - RIPPLE_EPS / 2, 3)).toBe(true)
    // ただし、はっきり手前の物まで巻き込まない
    expect(isAfter(2.9, 3)).toBe(false)
  })
})

describe('始まりだけを持つ物（効果音・画像・映像クリップ・目印）', () => {
  it('後ろの物はずれる', () => {
    expect(shiftStart(5, 3, 2)).toBe(7)
    expect(shiftStart(5, 3, -2)).toBe(3)
  })

  it('手前の物は動かない', () => {
    expect(shiftStart(1, 3, 2)).toBe(1)
    expect(shiftStart(1, 3, -2)).toBe(1)
  })

  it('**前へはみ出させない**（マイナスの位置に置くと以後の計算が全部ずれる）', () => {
    expect(shiftStart(1, 0, -5)).toBe(0)
  })
})

describe('始まりと終わりを持つ物（テロップ）', () => {
  it('後ろの物は、長さを変えずにずれる', () => {
    expect(shiftRange({ start: 5, end: 8 }, 3, 2)).toEqual({ start: 7, end: 10 })
  })

  it('手前の物は動かない（同じ物をそのまま返す）', () => {
    const r = { start: 1, end: 2 }
    expect(shiftRange(r, 3, 2)).toBe(r)
  })

  it('**こちらは 0 で止めない**（止めると長さが変わって、出ている時間が縮む）', () => {
    const r = shiftRange({ start: 1, end: 4 }, 0, -5)
    expect(r.end - r.start).toBe(3)
    expect(r.start).toBe(-4)
  })
})
