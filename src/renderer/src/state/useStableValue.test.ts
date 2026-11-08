import { describe, expect, it } from 'vitest'
import { sameItems } from './useStableValue'

describe('配列の要素が同じ物か（毎コマ作り直る囲いの値を据え置く判定）', () => {
  const a = { id: 1 }
  const b = { id: 2 }
  it('同じ並び・同じ物なら真（配列そのものが別でも）', () => {
    expect(sameItems([a, b], [a, b])).toBe(true)
    expect(sameItems([], [])).toBe(true)
  })
  it('長さが違う・要素が入れ替わった・中身が別の物なら偽', () => {
    expect(sameItems([a], [a, b])).toBe(false)
    expect(sameItems([a, b], [b, a])).toBe(false)
    expect(sameItems([a], [{ id: 1 }])).toBe(false) // 中身が等しくても別の物は別
  })
})
