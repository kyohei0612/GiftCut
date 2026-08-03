// 波形を描く幅の決め方。**canvas は幅の上限を超えると丸ごと無効になる。**
//
// ## 直した症状（2026-08-03）
//
// 本人「最大で拡大したら波形が消えて白くなる」。
//
// 帯の幅は「長さ × 拡大率」なので、451秒の素材を目一杯（240px/秒）寄せると
// **108,240px**。Chrome の canvas は 65,535px までで、超えると**例外も出さずに
// 何も描かれない**——背景だけが残って白く見える。
//
// e2e では**絶対に再現しない**（確認用の素材は数秒〜数十秒なので、
// 目一杯寄せても数千px にしかならない）。**症状を押さえるのはここの役目。**
import { describe, expect, it } from 'vitest'
import { waveBufWidth } from './WaveformCanvas'

describe('波形を描く幅', () => {
  it('ふつうの幅はそのまま描く（今までと同じ）', () => {
    expect(waveBufWidth(800, 1)).toBe(800)
    expect(waveBufWidth(4000, 1.25)).toBe(4000)
  })

  it('**実データで上限に当たる**（451秒 × 240px/秒 = 108,240px）', () => {
    const W = Math.floor(451 * 240)
    expect(W).toBeGreaterThan(65535) // ← ここが canvas の限界を超えている
    const bw = waveBufWidth(W, 1.25)
    expect(bw).toBeLessThan(W)
    // 実画素（bw × dpr）が Chrome の限界を確実に下回ること
    expect(bw * 1.25).toBeLessThanOrEqual(65535)
  })

  it('**画素比が高くても限界を超えない**（dpr を掛けた後で見る）', () => {
    for (const dpr of [1, 1.25, 1.5, 2, 3]) {
      const bw = waveBufWidth(999999, dpr)
      expect(bw * dpr).toBeLessThanOrEqual(65535)
    }
  })

  it('0 や壊れた値でも 1 以上を返す（幅0の canvas は例外になる）', () => {
    expect(waveBufWidth(0, 1)).toBe(1)
    expect(waveBufWidth(-10, 1)).toBe(1)
    // dpr が 0 や NaN でも 1 として扱う（0 で割らない）
    expect(waveBufWidth(800, 0)).toBe(800)
    expect(waveBufWidth(800, NaN)).toBe(800)
  })
})
