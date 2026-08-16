// @vitest-environment jsdom
//
// 縦書き。
//
// **見るのは「自分で計算している所」だけ**＝枠の縦横と、書字方向の宣言。
// 中身の組版は `writing-mode` に任せてある（1文字ずつ座標を置きに行くと、
// 約物・合字・拡大文字が全部自前計算になり、横書きと縦書きで組版が2つに割れる）。
//
// ※ ここでは文字の実測ができない（jsdom の canvas は測れない）。
//   なので**測った幅に依る比較は書かない**。измеり方に依らない関係だけを固定する。

import { describe, expect, it } from 'vitest'
import { buildTelopSVG } from './telopSvg'
import { defaultTelopStyle, type TelopStyle } from './telopStyle'
import { autoIconHeight } from './telopLayout'

const box = (text: string, vertical: boolean): { textW: number; textH: number; svg: string } =>
  buildTelopSVG({ ...defaultTelopStyle(), vertical }, text)

describe('縦書きの枠', () => {
  it('**文字数で縦に伸びる**（横には伸びない）', () => {
    const short = box('あい', true)
    const long = box('あいうえおかきくけこ', true)
    expect(long.textH).toBeGreaterThan(short.textH)
    expect(long.textW).toBe(short.textW) // 1列のままなので幅は変わらない
  })

  it('**列（行）の数で横に伸びる**', () => {
    const one = box('あい', true)
    const two = box('あい\nうえ', true)
    expect(two.textW).toBeGreaterThan(one.textW)
    expect(two.textH).toBe(one.textH) // 一番長い列の長さは変わらない
  })
})

describe('横書きは今までどおり', () => {
  it('行の数で縦に伸びる', () => {
    const one = box('あい', false)
    const two = box('あい\nうえ', false)
    expect(two.textH).toBeGreaterThan(one.textH)
  })

  it('**文字数を増やしても、縦には伸びない**（縦書きと役目が入れ替わっている）', () => {
    expect(box('あいうえおかきくけこ', false).textH).toBe(box('あい', false).textH)
  })
})

describe('組版は書字方向の宣言に任せる', () => {
  it('縦書きのときだけ writing-mode を宣言する', () => {
    expect(box('あい', true).svg).toContain('vertical-rl')
    expect(box('あい', false).svg).not.toContain('vertical-rl')
  })

  it('**既定は横書き**（指定の無い今までのテロップが、勝手に縦にならない）', () => {
    const s = defaultTelopStyle()
    expect(s.vertical).toBeUndefined()
    expect(buildTelopSVG(s, 'あい').svg).not.toContain('vertical-rl')
  })
})

// ===========================================================================
// 自動調整のアイコンの高さ。**行数で変わらない**（2026-08-16・本人の指定）。
//
// 前は「テキストの塊の高さに合わせる」で `行の高さ × 行数 × 係数`（1行1.4/他1.15）
// だったので、**1行を2行にした瞬間にアイコンが 1.64倍**になった。
// いまは文字の大きさだけで決まる。式は `lib/telopLayout` の1か所で、
// 画面（`TelopText`）と書き出し（`lib/rasterize`）が同じ物を呼ぶ。
describe('自動調整のアイコンの大きさ', () => {
  const style = (over: Partial<TelopStyle> = {}): TelopStyle => ({
    ...defaultTelopStyle(),
    ...over
  })

  it('**文字の大きさに比例する**（行間ぶんも効く）', () => {
    const a = autoIconHeight(style({ fontSize: 60 }))
    const b = autoIconHeight(style({ fontSize: 120 }))
    expect(b).toBeCloseTo(a * 2, 6)
    expect(autoIconHeight(style({ fontSize: 60, leading: 50 }))).toBeGreaterThan(a)
  })

  it('**行数を受け取らない**（2行にしてもアイコンは動かない）', () => {
    // 引数に文字が無い＝構造として行数に依存できない。ここが崩れたら赤くする
    expect(autoIconHeight.length).toBe(1)
  })
})
