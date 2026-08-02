import { describe, it, expect } from 'vitest'
import { edgeScrollDelta, EDGE_PX, EDGE_MAX_V } from './edgeScroll'

const L = 100
const R = 900

describe('端まで持っていったら送る', () => {
  it('中ほどでは送らない', () => {
    expect(edgeScrollDelta(500, L, R)).toBe(0)
    expect(edgeScrollDelta(L + EDGE_PX + 1, L, R)).toBe(0)
    expect(edgeScrollDelta(R - EDGE_PX - 1, L, R)).toBe(0)
  })

  it('右の端に入ると右へ、左の端に入ると左へ', () => {
    expect(edgeScrollDelta(R - 10, L, R)).toBeGreaterThan(0)
    expect(edgeScrollDelta(L + 10, L, R)).toBeLessThan(0)
  })

  // **一定の速さにすると、少し外れただけで飛んでいく。**
  // 端からの距離に比例させて、「ちょっと送る」も同じ手つきで出せるようにする
  it('めり込むほど速くなる', () => {
    const a = edgeScrollDelta(R - EDGE_PX + 5, L, R)
    const b = edgeScrollDelta(R - 5, L, R)
    expect(b).toBeGreaterThan(a)
  })

  it('どれだけ外へ出しても、上限を超えない', () => {
    expect(edgeScrollDelta(R + 10000, L, R)).toBe(EDGE_MAX_V)
    expect(edgeScrollDelta(L - 10000, L, R)).toBe(-EDGE_MAX_V)
  })

  // 幅が端の判定より狭いと、左右の判定が重なって同時に引っぱられる。
  // 送らないのが正しい（狭すぎて「端」に意味が無い）
  it('見えている幅が狭すぎるときは送らない', () => {
    expect(edgeScrollDelta(50, 0, 80)).toBe(0)
    expect(edgeScrollDelta(10, 0, 80)).toBe(0)
  })
})
