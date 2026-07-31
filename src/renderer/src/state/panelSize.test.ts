import { describe, expect, it } from 'vitest'
import { PANEL_LIMITS, nextPanelSize } from './panelSize'

describe('パネルの境目を動かす', () => {
  it('左パネルは、右へ動かすと広がる', () => {
    expect(nextPanelSize('left', 250, 50)).toBe(300)
    expect(nextPanelSize('left', 250, -50)).toBe(200)
  })

  it('**右パネルは逆向き**（右へ動かすと狭くなる）', () => {
    // ここを取り違えると「掴むと逆に動く」になる
    expect(nextPanelSize('right', 300, 50)).toBe(250)
    expect(nextPanelSize('right', 300, -50)).toBe(350)
  })

  it('タイムラインは、下へ動かすと低くなる', () => {
    expect(nextPanelSize('timeline', 370, 50)).toBe(320)
    expect(nextPanelSize('timeline', 370, -50)).toBe(420)
  })

  it('狭くしすぎない（中身が読めなくなる）', () => {
    expect(nextPanelSize('left', 250, -9999)).toBe(PANEL_LIMITS.left.min)
    expect(nextPanelSize('right', 300, 9999)).toBe(PANEL_LIMITS.right.min)
    expect(nextPanelSize('timeline', 370, 9999)).toBe(PANEL_LIMITS.timeline.min)
  })

  it('**広くしすぎない**（プレビューが潰れる）', () => {
    expect(nextPanelSize('left', 250, 9999)).toBe(PANEL_LIMITS.left.max)
    expect(nextPanelSize('right', 300, -9999)).toBe(PANEL_LIMITS.right.max)
    expect(nextPanelSize('timeline', 370, -9999)).toBe(PANEL_LIMITS.timeline.max)
  })

  it('限界の値は、狭い方が広い方より小さい（設定の取り違え避け）', () => {
    for (const [name, v] of Object.entries(PANEL_LIMITS))
      expect(v.min, name).toBeLessThan(v.max)
  })
})
