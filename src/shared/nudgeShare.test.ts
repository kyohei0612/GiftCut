// まとめて選んでいるときの「配り方」。
//
// 間違えると**ばらばらに置いた物が1か所に揃う**という壊れ方をする。
// 見れば分かるが、単位（px・%・度）ごとに係数が違うので、
// どれか1つだけ間違えても気づきにくい。

import { describe, expect, it } from 'vitest'
import { keyDelta, neutralOf, type NudgeKey } from './nudgeShare'

describe('素のままの値', () => {
  it('掛け算で効く物は 1', () => {
    for (const k of ['sc', 'scx', 'scy', 'bright', 'op'] as NudgeKey[]) {
      expect(neutralOf(k), k).toBe(1)
    }
  })
  it('足し算で効く物は 0', () => {
    for (const k of ['tx', 'ty', 'rot', 'blur', 'hue', 'cl'] as NudgeKey[]) {
      expect(neutralOf(k), k).toBe(0)
    }
  })
})

describe('表示の差分 → 印の差分', () => {
  it('px と 度 は、そのまま', () => {
    expect(keyDelta('tx', 40)).toBe(40)
    expect(keyDelta('ty', -25)).toBe(-25)
    expect(keyDelta('rot', 15)).toBe(15)
    expect(keyDelta('blur', 3)).toBe(3)
  })

  it('% は 1/100 にする', () => {
    expect(keyDelta('op', 10)).toBeCloseTo(0.1, 6)
    expect(keyDelta('scx', 25)).toBeCloseTo(0.25, 6)
    expect(keyDelta('cl', 50)).toBeCloseTo(0.5, 6)
  })

  it('**拡大は、その子自身の元の大きさで割る**', () => {
    // 印は「元の大きさに対する倍率」。元が2倍の子に同じ倍率を足すと、
    // 見た目では2倍動いてしまう
    expect(keyDelta('sc', 10, 1)).toBeCloseTo(0.1, 6)
    expect(keyDelta('sc', 10, 2)).toBeCloseTo(0.05, 6)
    expect(keyDelta('sc', 10, 0.5)).toBeCloseTo(0.2, 6)
  })

  it('元の大きさが 0 でも壊れない', () => {
    expect(Number.isFinite(keyDelta('sc', 10, 0))).toBe(true)
  })

  it('動かさなければ 0（触っただけで値が動かない）', () => {
    for (const k of ['tx', 'sc', 'op'] as NudgeKey[]) expect(keyDelta(k, 0), k).toBe(0)
  })

  it('表に載っていない項目は、そのまま（px・度・数はこれで合う）', () => {
    // 波・ブラー・タービュレントのように、あとから足した項目。
    // 一覧を別に持たないので、書き忘れても「そのまま」で妥当な値になる
    for (const k of ['wavH', 'wavW', 'mbLen', 'mbDir', 'tbAmt', 'tbSeed'] as NudgeKey[]) {
      expect(keyDelta(k, 7), k).toBe(7)
    }
  })
})
