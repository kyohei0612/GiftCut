// 「詰まる」— 境目より後ろをまとめてずらす規則。
//
// **1つでもずらし忘れると、そこだけ置き去りになる。**
// 切片を消して詰めたのに文字だけ元の位置に残る、効果音だけずれる——
// 編集中は気づきにくく、書き出してから分かる類。

import { describe, expect, it } from 'vitest'
import { RIPPLE_EPS, collapseAt, collapseRange, isAfter, shiftRange, shiftStart } from './ripple'

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

describe('区間を捨てて詰める', () => {
  // [2, 5] の3秒を捨てる、という想定で通す
  const at = (t: number): number => collapseAt(t, 2, 5, 3)

  it('捨てる区間より後ろは、捨てた長さだけ手前へ寄る', () => {
    expect(at(8)).toBe(5)
  })

  it('捨てる区間より前は動かない', () => {
    expect(at(1)).toBe(1)
  })

  it('**区間の中に居た物は、区間の頭で止める**（消さない）', () => {
    expect(at(3)).toBe(2)
    expect(at(4.9)).toBe(2)
  })

  it('区間の両端は、詰めたあと同じ位置に重なる', () => {
    expect(at(2)).toBe(2)
    expect(at(5)).toBe(2)
  })

  it('**捨てる長さが区間の幅と違うこともある**（切片の残り丈で頭打ちになる）', () => {
    // [2, 5] にかかっているが、実際に詰められるのは1秒だけ、という場合
    expect(collapseAt(8, 2, 5, 1)).toBe(7)
  })

  it('頭だけ区間にかかった文字は、失わずに尻だけ残る', () => {
    // [3, 9] の文字。頭は捨てる区間の中、尻は後ろ
    expect(collapseRange({ start: 3, end: 9 }, 2, 5, 3)).toEqual({ start: 2, end: 6 })
  })

  it('丸ごと区間に入った文字は長さ0になる（落とすかは呼んだ側の判断）', () => {
    expect(collapseRange({ start: 3, end: 4 }, 2, 5, 3)).toEqual({ start: 2, end: 2 })
  })
})
