import { describe, expect, it } from 'vitest'
import { DRAG_SLOP_PX, dragModeOf, movedEnough } from './dragMode'

const ev = (o: Partial<{ altKey: boolean; ctrlKey: boolean; metaKey: boolean }> = {}) => ({
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  ...o
})

describe('修飾キーで動きが変わる', () => {
  it('そのままなら上書きで移動', () => {
    expect(dragModeOf(ev())).toBe('move')
  })

  it('Alt で複製（元はその場に残る）', () => {
    expect(dragModeOf(ev({ altKey: true }))).toBe('copy')
  })

  it('Ctrl で割り込み（後ろがずれる）', () => {
    expect(dragModeOf(ev({ ctrlKey: true }))).toBe('insert')
  })

  it('Mac の command も割り込み', () => {
    expect(dragModeOf(ev({ metaKey: true }))).toBe('insert')
  })

  it('**両方押されていたら複製を優先**（どちらかに倒す必要がある）', () => {
    expect(dragModeOf(ev({ altKey: true, ctrlKey: true }))).toBe('copy')
  })
})

describe('押しただけの震えを弾く', () => {
  it('わずかな動きでは「動かした」ことにしない', () => {
    expect(movedEnough(0)).toBe(false)
    expect(movedEnough(DRAG_SLOP_PX - 1)).toBe(false)
  })

  it('しきい値に届いたら動かしたとみなす', () => {
    expect(movedEnough(DRAG_SLOP_PX)).toBe(true)
  })

  it('左へ動かしても同じ', () => {
    expect(movedEnough(-DRAG_SLOP_PX)).toBe(true)
    expect(movedEnough(-1)).toBe(false)
  })

  it('種類ごとに幅を変えられる（いまの App は切片4px・効果音3px）', () => {
    expect(movedEnough(3, 3)).toBe(true)
    expect(movedEnough(3, 4)).toBe(false)
  })
})
