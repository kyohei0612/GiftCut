import { describe, it, expect } from 'vitest'
import { colorAdjustFilter, isNeutralAdjust } from './colorAdjust'

describe('無調整のときは何も足さない', () => {
  it('未指定・1のときは空', () => {
    expect(colorAdjustFilter(undefined)).toBe('')
    expect(colorAdjustFilter({ b: 1, c: 1, s: 1 })).toBe('')
    // 誤差の範囲も無調整として扱う（フィルタを1段増やすだけ無駄）
    expect(colorAdjustFilter({ b: 1.0005, c: 0.9995, s: 1 })).toBe('')
  })
  it('1つでも動いていれば付く', () => {
    expect(colorAdjustFilter({ b: 1.2, c: 1, s: 1 })).not.toBe('')
    expect(isNeutralAdjust({ b: 1, c: 1.2, s: 1 })).toBe(false)
  })
})

describe('GPL の eq を使わない', () => {
  // **同梱の ffmpeg（LGPL）に eq は無い。** 使うと配布物で書き出しが止まる。
  // 開発機は PATH の GPL 版で通ってしまうので、ここで文字列として見張る。
  it('eq を出さない', () => {
    const f = colorAdjustFilter({ b: 1.2, c: 1.3, s: 1.4 })
    expect(f).not.toContain('eq=')
    expect(f).toContain('lutyuv=')
  })

  // yuv の maxval は制限レンジ（235）を指す。255 のつもりで使うと絵が変わる。
  it('maxval / minval を使わない（制限レンジを指すため）', () => {
    const f = colorAdjustFilter({ b: 1.2, c: 1.3, s: 1.4 })
    expect(f).not.toContain('maxval')
    expect(f).not.toContain('minval')
  })
})

describe('式の中身（eq の対応表から割り出したもの）', () => {
  const f = colorAdjustFilter({ b: 1.15, c: 1.3, s: 1.4 })

  it('明るさは倍率ではなく足し算で渡す（1.15 → +0.150）', () => {
    expect(f).toContain('(0.150)*255')
  })
  it('コントラストは 128 を中心に掛ける', () => {
    expect(f).toContain('1.300*(val-128)+128')
  })
  it('彩度は U と V に同じ式を使う', () => {
    const uv = /u='([^']*)':v='([^']*)'/.exec(f)
    expect(uv).not.toBeNull()
    expect(uv![1]).toBe(uv![2])
    expect(uv![1]).toContain('1.400*(val-128)+128')
  })
  it('0..255 に収める（外れると色が回り込む）', () => {
    expect(f.match(/clip\(/g)?.length).toBe(3)
  })
})

// 式を実際に評価して、eq と同じ計算になっているかを見る。
// 文字列の見た目だけ合っていても、括弧が1つ違えば別の絵になる。
describe('計算そのものが eq と合っているか', () => {
  const evalExpr = (expr: string, val: number): number => {
    const js = expr.replace(/\bclip\(/g, 'CLIP(').replace(/\bval\b/g, String(val))
    // eslint-disable-next-line no-new-func
    return new Function('CLIP', `return ${js}`)((v: number, lo: number, hi: number) =>
      Math.max(lo, Math.min(hi, v))
    )
  }
  /** eq の中身（実測で割り出したもの） */
  const eqY = (val: number, b: number, c: number): number =>
    Math.max(0, Math.min(255, c * (val - 128) + 128 + (b - 1) * 255))
  const eqUV = (val: number, s: number): number =>
    Math.max(0, Math.min(255, s * (val - 128) + 128))

  it('明るさ・コントラスト（Y）', () => {
    const f = colorAdjustFilter({ b: 1.15, c: 1.3, s: 1 })
    const y = /y='([^']*)'/.exec(f)![1]
    for (const v of [0, 32, 64, 128, 200, 255]) {
      expect(evalExpr(y, v)).toBeCloseTo(eqY(v, 1.15, 1.3), 2)
    }
  })
  it('彩度（U/V）', () => {
    const f = colorAdjustFilter({ b: 1, c: 1, s: 0.6 })
    const u = /u='([^']*)'/.exec(f)![1]
    for (const v of [0, 64, 128, 192, 255]) {
      expect(evalExpr(u, v)).toBeCloseTo(eqUV(v, 0.6), 2)
    }
  })
})
