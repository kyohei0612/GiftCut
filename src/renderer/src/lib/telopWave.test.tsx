// @vitest-environment jsdom
// 波形ワープ（文字を波で押し出す）の作り方。
//
// **url(#…) と定義（defs）は必ず対**。定義を置き忘れると、波が出ないだけでなく
// 参照が壊れて文字ごと消える。ここで対であることを固定する。

import { describe, expect, it } from 'vitest'
import { animWave, animMotionBlur, animTurbulence, NEUTRAL_ANIM } from './telopStyle'

const st = (o: Partial<typeof NEUTRAL_ANIM>): typeof NEUTRAL_ANIM => ({ ...NEUTRAL_ANIM, ...o })

describe('波形ワープ', () => {
  it('波が無ければ、何も足さない（既定のテロップに余計な物を被せない）', () => {
    const w = animWave(st({ wavH: 0 }))
    expect(w.css).toBe('')
    expect(w.defs).toBe('')
  })

  it('波があれば、url と定義が対で出る', () => {
    const w = animWave(st({ wavH: 40, wavW: 100 }), 1, 'w1')
    expect(w.css).toBe('url(#w1f)')
    expect(w.defs).toContain('id="w1f"')
    expect(w.defs).toContain('feDisplacementMap')
  })

  it('名札を変えれば別物になる（同じ画面に2つ出しても混ざらない）', () => {
    const a = animWave(st({ wavH: 40 }), 1, 'aa')
    const b = animWave(st({ wavH: 40 }), 1, 'bb')
    expect(a.css).not.toBe(b.css)
    expect(a.defs).not.toBe(b.defs)
  })

  it('高さは「ずらす量」に効く。倍にすれば倍ずれる', () => {
    const one = animWave(st({ wavH: 10 }), 1, 'x')
    const two = animWave(st({ wavH: 20 }), 1, 'x')
    const scaleOf = (s: string): number => Number(/scale="([\d.]+)"/.exec(s)?.[1])
    expect(scaleOf(two.defs)).toBeCloseTo(scaleOf(one.defs) * 2, 5)
  })

  it('高さが負でも波は出る（裏返るだけ。SPLITSLIDE は -1888）', () => {
    const w = animWave(st({ wavH: -1888, wavW: 8 }), 1, 'x')
    expect(w.css).not.toBe('')
    expect(Number(/scale="([\d.]+)"/.exec(w.defs)?.[1])).toBeGreaterThan(0)
  })

  it('書き出しの倍率ぶん、ずらす量も大きくなる（見た絵と焼いた絵を合わせる）', () => {
    const prev = animWave(st({ wavH: 10 }), 1, 'x')
    const exp2 = animWave(st({ wavH: 10 }), 2, 'x')
    const scaleOf = (s: string): number => Number(/scale="([\d.]+)"/.exec(s)?.[1])
    expect(scaleOf(exp2.defs)).toBeCloseTo(scaleOf(prev.defs) * 2, 5)
  })

  it('波形の幅が 0 でも落ちない（縞が潰れないよう下限を置く）', () => {
    expect(() => animWave(st({ wavH: 5, wavW: 0 }), 1, 'x')).not.toThrow()
    expect(animWave(st({ wavH: 5, wavW: 0 }), 1, 'x').css).not.toBe('')
  })
})

describe('ブラー（方向）', () => {
  const dxsOf = (s: string): number[] =>
    [...s.matchAll(/feOffset[^/]*dx="(-?[\d.]+)"/g)].map((m) => Number(m[1]))
  const dysOf = (s: string): number[] =>
    [...s.matchAll(/feOffset[^/]*dy="(-?[\d.]+)"/g)].map((m) => Number(m[1]))

  it('長さが 0 なら、何も足さない', () => {
    const b = animMotionBlur(st({ mbLen: 0 }))
    expect(b.css).toBe('')
    expect(b.defs).toBe('')
  })

  it('長さがあれば、url と定義が対で出る', () => {
    const b = animMotionBlur(st({ mbLen: 80, mbDir: 0 }), 1, 'b1')
    expect(b.css).toBe('url(#b1f)')
    expect(b.defs).toContain('id="b1f"')
    expect(b.defs).toContain('feMerge')
  })

  it('横向き（0度）なら、尾は横にだけ伸びる', () => {
    const b = animMotionBlur(st({ mbLen: 80, mbDir: 0 }), 1, 'x')
    expect(Math.max(...dxsOf(b.defs).map(Math.abs))).toBeGreaterThan(30)
    expect(Math.max(...dysOf(b.defs).map(Math.abs))).toBeLessThan(0.01)
  })

  it('縦向き（90度）なら、尾は縦にだけ伸びる', () => {
    const b = animMotionBlur(st({ mbLen: 80, mbDir: 90 }), 1, 'x')
    expect(Math.max(...dysOf(b.defs).map(Math.abs))).toBeGreaterThan(30)
    expect(Math.max(...dxsOf(b.defs).map(Math.abs))).toBeLessThan(0.01)
  })

  it('**向きが変われば形も変わる。** ここが同じだと 43.ブラー方向 が別物になる', () => {
    const a = animMotionBlur(st({ mbLen: 80, mbDir: 45 }), 1, 'x')
    const b = animMotionBlur(st({ mbLen: 80, mbDir: -45 }), 1, 'x')
    expect(a.defs).not.toBe(b.defs)
  })

  it('尾は前後に均等（真ん中は動かさない）', () => {
    const dxs = dxsOf(animMotionBlur(st({ mbLen: 80, mbDir: 0 }), 1, 'x').defs)
    expect(dxs[0]).toBeCloseTo(-dxs[dxs.length - 1], 3)
  })

  it('長さが負でも尾は出る（向きが裏返るだけ）', () => {
    expect(animMotionBlur(st({ mbLen: -50 }), 1, 'x').css).not.toBe('')
  })
})

describe('タービュレント（ぐにゃぐにゃ揺らす）', () => {
  const numOf = (s: string, attr: string): number =>
    Number(new RegExp(`${attr}="(-?[\\d.]+)"`).exec(s)?.[1])

  it('量が 0 なら、何も足さない', () => {
    const t = animTurbulence(st({ tbAmt: 0 }))
    expect(t.css).toBe('')
    expect(t.defs).toBe('')
  })

  it('量があれば、url と定義が対で出る', () => {
    const t = animTurbulence(st({ tbAmt: 40, tbSize: 300 }), 1, 't1')
    expect(t.css).toBe('url(#t1f)')
    expect(t.defs).toContain('feTurbulence')
    expect(t.defs).toContain('feDisplacementMap')
  })

  it('粗さ（サイズ）が大きいほど、周波数は小さくなる＝大きくうねる', () => {
    const coarse = animTurbulence(st({ tbAmt: 40, tbSize: 800 }), 1, 'x')
    const fine = animTurbulence(st({ tbAmt: 40, tbSize: 20 }), 1, 'x')
    expect(numOf(coarse.defs, 'baseFrequency')).toBeLessThan(numOf(fine.defs, 'baseFrequency'))
  })

  it('**シードが変われば模様が変わる。** ここが同じだと 14.揺れる動き_速 が止まって見える', () => {
    const a = animTurbulence(st({ tbAmt: 40, tbSeed: 50 }), 1, 'x')
    const b = animTurbulence(st({ tbAmt: 40, tbSeed: 7 }), 1, 'x')
    expect(numOf(a.defs, 'seed')).not.toBe(numOf(b.defs, 'seed'))
  })

  it('シードは整数にする（小数だと扱いがブラウザで割れる）', () => {
    const t = animTurbulence(st({ tbAmt: 40, tbSeed: 12.7 }), 1, 'x')
    expect(Number.isInteger(numOf(t.defs, 'seed'))).toBe(true)
  })

  it('複雑度は重ねる段数。範囲の外を渡しても壊れない', () => {
    expect(numOf(animTurbulence(st({ tbAmt: 40, tbOct: 0 }), 1, 'x').defs, 'numOctaves')).toBe(1)
    expect(numOf(animTurbulence(st({ tbAmt: 40, tbOct: 99 }), 1, 'x').defs, 'numOctaves')).toBe(6)
  })

  it('オフセットは模様の平行移動として出る', () => {
    const t = animTurbulence(st({ tbAmt: 40, tbOffX: 120, tbOffY: -30 }), 1, 'x')
    expect(t.defs).toContain('dx="120.00"')
    expect(t.defs).toContain('dy="-30.00"')
  })
})
