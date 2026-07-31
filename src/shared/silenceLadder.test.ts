import { describe, it, expect } from 'vitest'
import { DB_LADDER, enoughSilences } from './silenceLadder'

describe('無音のしきい値選び', () => {
  it('厳しい方から順に並んでいる', () => {
    expect([...DB_LADDER]).toEqual([...DB_LADDER].sort((a, b) => a - b))
  })

  it('短い素材では5個あれば足りる', () => {
    expect(enoughSilences(5, 10)).toBe(true)
    expect(enoughSilences(4, 10)).toBe(false)
  })

  it('長い素材では長さに応じて求める', () => {
    // 4分（240秒）なら60個は欲しい
    expect(enoughSilences(60, 240)).toBe(true)
    expect(enoughSilences(59, 240)).toBe(false)
  })

  it('前に取りこぼしていた「4分で11個」は足りないと判定する', () => {
    // これを合格にしていたせいで、位置合わせが効かないまま素通ししていた
    expect(enoughSilences(11, 240)).toBe(false)
  })
})
