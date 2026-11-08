import { describe, expect, it } from 'vitest'
import { computeTelopAnim, defaultAnim, neutralAnimT, type TelopAnim } from './telopAnim'

const inOut: TelopAnim = { ...defaultAnim(), in: 'fade', inDur: 0.3, out: 'fade', outDur: 0.3 }

describe('プレビューへ渡す animT を中立の区間で固定する', () => {
  it('出現の最中・消失の最中は生の値のまま', () => {
    expect(neutralAnimT(inOut, 0.1, 5)).toBe(0.1)
    expect(neutralAnimT(inOut, 4.9, 5)).toBe(4.9)
  })

  it('あいだの区間は同じ値になる（毎コマ渡しても DOM が変わらない）', () => {
    const a = neutralAnimT(inOut, 1.0, 5)
    const b = neutralAnimT(inOut, 3.7, 5)
    expect(a).toBe(b)
    // 固定した値でも見た目は中立（出現が終わり、消失が始まっていない）
    const st = computeTelopAnim(inOut, a, 5)
    expect(st.opacity).toBe(1)
    expect(st.sc).toBe(1)
  })

  it('出入りが無ければ常に同じ値、アニメ自体が無ければ生の値', () => {
    const none = defaultAnim()
    expect(neutralAnimT(none, 0.2, 5)).toBe(neutralAnimT(none, 4.0, 5))
    expect(neutralAnimT(undefined, 2.5, 5)).toBe(2.5)
  })

  it('常時動く強調（shake / pulse）は毎コマ要るので生の値', () => {
    const shake: TelopAnim = { ...defaultAnim(), emphasis: 'shake' }
    expect(neutralAnimT(shake, 2.5, 5)).toBe(2.5)
  })

  it('短いクリップで出現と消失が重なっていても落ちない（全部が生の値）', () => {
    expect(neutralAnimT(inOut, 0.25, 0.4)).toBe(0.25)
  })
})
