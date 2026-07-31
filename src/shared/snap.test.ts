import { describe, expect, it } from 'vitest'
import { nearestSnap } from './snap'

describe('クリップの吸い付き', () => {
  it('近くに当て先が無ければ動かさない', () => {
    expect(nearestSnap(5, 2, [100], 0.2)).toEqual({ start: 5, line: null })
  })

  it('頭を当て先に合わせる', () => {
    expect(nearestSnap(5.05, 2, [5], 0.2)).toEqual({ start: 5, line: 5 })
  })

  it('**尻も当て先に合わせる**（頭だけ見ていると後ろを揃えられない）', () => {
    // 長さ2のクリップを 3.05 に置こうとすると、尻は 5.05。当て先 5 に寄る
    expect(nearestSnap(3.05, 2, [5], 0.2)).toEqual({ start: 3, line: 5 })
  })

  it('一番近い当て先を選ぶ', () => {
    expect(nearestSnap(5.05, 2, [5, 5.2], 0.3).start).toBe(5)
    expect(nearestSnap(5.15, 2, [5, 5.2], 0.3).start).toBe(5.2)
  })

  it('前へはみ出させない', () => {
    // 左端より前まで引っぱった状態。尻を 1 に合わせると頭は -1 になるので 0 で止める
    expect(nearestSnap(-0.9, 2, [1], 0.2).start).toBe(0)
  })

  it('当て先が無くても壊れない', () => {
    expect(nearestSnap(5, 2, [], 0.2)).toEqual({ start: 5, line: null })
  })
})
