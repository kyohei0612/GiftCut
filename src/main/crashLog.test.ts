// 落ちた記録のうち、**外へ出したくない物を落とせているか**。
//
// ここを間違えると、送るのが怖くなって結局誰も送らない。
// 「念のため全部入れる」は、送られない記録を作るのと同じ。

import { describe, it, expect } from 'vitest'
import { scrubPath } from './crashLog'

describe('人の名前が混ざる所を落とす', () => {
  it('**Windows の道から利用者名を落とす**（そのままだと本名が載る）', () => {
    expect(scrubPath('C:\\Users\\kyohei\\GiftCut\\out\\main\\index.js')).toBe(
      'C:\\Users\\<利用者>\\GiftCut\\out\\main\\index.js'
    )
  })

  it('mac / Linux の形も落とす', () => {
    expect(scrubPath('/Users/kyohei/Movies/a.mp4')).toBe('/Users/<利用者>/Movies/a.mp4')
    expect(scrubPath('/home/kyohei/a.mp4')).toBe('/home/<利用者>/a.mp4')
  })

  it('1つの文にいくつ出てきても全部落とす（スタックトレースは道だらけ）', () => {
    const stack =
      'Error: x\n  at f (C:\\Users\\kyohei\\a.js:1:1)\n  at g (C:\\Users\\kyohei\\b.js:2:2)'
    expect(scrubPath(stack)).not.toContain('kyohei')
    expect(scrubPath(stack).match(/<利用者>/g)).toHaveLength(2)
  })

  // **落としすぎない。** どの層で落ちたかは残らないと、記録の意味が無い
  it('落ちた場所の手がかりは残す', () => {
    const s = scrubPath('at exportRun (C:\\Users\\kyohei\\GiftCut\\out\\main\\index.js:120:5)')
    expect(s).toContain('exportRun')
    expect(s).toContain('index.js:120:5')
  })

  it('利用者の名前が入っていない道は、そのまま', () => {
    expect(scrubPath('C:\\Program Files\\GiftCut\\app.exe')).toBe(
      'C:\\Program Files\\GiftCut\\app.exe'
    )
  })

  it('道が1つも無い文言でも壊れない', () => {
    expect(scrubPath('Out of memory')).toBe('Out of memory')
    expect(scrubPath('')).toBe('')
  })
})
