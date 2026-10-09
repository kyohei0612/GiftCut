// @vitest-environment jsdom
// テロップの置き場所。既定の高さと、重なるときに上へ積む決まり。
// 箱の大きさは buildTelopSVG で測る（canvas が要る）ので、ゴールデン試験と同じく jsdom。
import { describe, expect, it } from 'vitest'
import { DEFAULT_TELOP_POS, STACK_GAP, placeNewTelops, stackAbove, telopVSpan } from './telopPlace'
import { defaultTelopStyle } from './telopStyle'
import { DEFAULT_LABEL } from './labels'
import type { Cue } from './srt'

const cue = (id: number, start: number, end: number, text = 'あいう'): Cue => ({
  id,
  start,
  end,
  text,
  style: defaultTelopStyle(),
  label: DEFAULT_LABEL,
  pos: { ...DEFAULT_TELOP_POS }
})

describe('既定の置き場所', () => {
  it('中心は 989px（1080 基準）・横は中央（編集者の指定）', () => {
    expect(DEFAULT_TELOP_POS.y * 1080).toBeCloseTo(989, 6)
    expect(DEFAULT_TELOP_POS.x).toBe(0.5)
  })
})

describe('上へ積む（純粋な計算）', () => {
  const base = 0.9
  it('誰とも当たらなければ既定のまま', () => {
    expect(stackAbove(0.05, [], base)).toBe(base)
    expect(stackAbove(0.05, [{ top: 0.1, bottom: 0.2 }], base)).toBe(base)
  })
  it('当たる相手の真上（隙間つき）に乗る', () => {
    const y = stackAbove(0.05, [{ top: 0.85, bottom: 0.95 }], base)
    expect(y).toBeCloseTo(0.85 - STACK_GAP - 0.05, 9)
  })
  it('避けた先でまた当たれば、さらに上へ（2段積み）', () => {
    const y = stackAbove(0.05, [{ top: 0.85, bottom: 0.95 }, { top: 0.7, bottom: 0.8 }], base)
    expect(y).toBeCloseTo(0.7 - STACK_GAP - 0.05, 9)
  })
  it('画面の上端は越えない（見えない所に置かない）', () => {
    const y = stackAbove(0.3, [{ top: 0.0, bottom: 1.0 }], base)
    expect(y).toBe(0.3)
  })
})

describe('足すテロップに置き場所を付ける', () => {
  it('同じ時刻に相手が居なければ既定の位置', () => {
    const [c] = placeNewTelops([cue(1, 0, 1)], [cue(2, 5, 6)])
    expect(c.pos).toEqual(DEFAULT_TELOP_POS)
  })
  it('時間が重なる相手が居れば、その箱より上に乗る（被らない）', () => {
    const other = cue(1, 0, 2)
    const [c] = placeNewTelops([other], [cue(2, 1, 3)])
    const mine = telopVSpan(c)
    const theirs = telopVSpan(other)
    expect(mine.bottom).toBeLessThanOrEqual(theirs.top)
    expect(c.pos.y).toBeLessThan(DEFAULT_TELOP_POS.y)
  })
  it('端が接しているだけなら重なりではない（既定のまま）', () => {
    const [c] = placeNewTelops([cue(1, 0, 2)], [cue(2, 2, 3)])
    expect(c.pos).toEqual(DEFAULT_TELOP_POS)
  })
  it('同じ群の中で時刻が重なる2枚でも、2枚目が1枚目の上に乗る', () => {
    const [a, b] = placeNewTelops([], [cue(1, 0, 2), cue(2, 1, 3)])
    expect(a.pos).toEqual(DEFAULT_TELOP_POS)
    expect(telopVSpan(b).bottom).toBeLessThanOrEqual(telopVSpan(a).top)
  })
  it('本文が空（追加した直後）でも1行ぶんの高さで測る', () => {
    const s = telopVSpan({ ...cue(1, 0, 1, ''), pos: DEFAULT_TELOP_POS })
    expect(s.bottom - s.top).toBeGreaterThan(0)
  })
})
