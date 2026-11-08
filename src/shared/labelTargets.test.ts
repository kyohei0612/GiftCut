import { describe, expect, it } from 'vitest'
import { labelTargetCount, labelTargets, type LabelSelection } from './labelTargets'

const mixed: LabelSelection = { telop: [1, 2], seg: [10], se: [20, 21], img: [30], vclip: [] }

describe('ラベルカラーをどれに付けるか', () => {
  it('選んでいる物を右クリックしたら、選んでいる全部・全種類に付く', () => {
    // 2026-11-08 までは、右クリックした種類しか変わらなかった（本人の報告）
    expect(labelTargets(mixed, 'telop', 1)).toEqual({
      telop: [1, 2], seg: [10], se: [20, 21], img: [30], vclip: []
    })
    // 効果音から開いても同じ相手になる（道が2本あって食い違っていた所）
    expect(labelTargets(mixed, 'se', 21)).toEqual(labelTargets(mixed, 'telop', 1))
  })

  it('選んでいない物を右クリックしたら、その1つだけ', () => {
    expect(labelTargets(mixed, 'img', 99)).toEqual({
      telop: [], seg: [], se: [], img: [99], vclip: []
    })
  })

  it('総数は全種類を足した数', () => {
    expect(labelTargetCount(labelTargets(mixed, 'seg', 10))).toBe(6)
    expect(labelTargetCount(labelTargets(mixed, 'vclip', 5))).toBe(1)
  })

  it('返す配列は選択の写し（元の選択を書き換えない）', () => {
    const t = labelTargets(mixed, 'telop', 1)
    t.telop.push(3)
    expect(mixed.telop).toEqual([1, 2])
  })
})
