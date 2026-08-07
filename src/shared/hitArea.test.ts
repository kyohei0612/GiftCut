// 押せる範囲（当たり判定）が、**隣と重なっていない**ことを見る。
//
// ## なぜ「24px 以上」だけでは足りないか
//
// WCAG 2.2 の下限は 24 × 24（SC 2.5.8・AA）だが、**広げるほど良い訳ではない。**
// 隣り合ったボタンの判定が重なると、重なった所は後ろの要素が勝つので、
// **M の右端を押すと S が反応する**——小さいままより悪い。
//
// つまり本当の決まりは「大きさ」ではなく **「大きさ ≦ 隣との間隔」**。
// 数字だけ試験で固定しても、あとから間隔（gap）を詰められたら黙って壊れる。
// ここでは**両方を CSS から読んで突き合わせる**。
//
// ※ 見た目の大きさ（16px）は変えていない。透明な `::before` で判定だけ広げてある。

import { describe, it, expect } from 'vitest'
import { readAppCss } from './appCss'

// **区画に割ってあるので、繋いだ物を見る**（`shared/appCss`）。
// 改行も向こうで `\n` に揃えてある——CRLF のままだと、複数行のセレクタが
// `\n` で探しても当たらない（`.th-btn::before,\r\n.th-ms::before`）
const CSS = readAppCss()

/**
 * セレクタ → 中身。**規則を1つずつ切り出してから、セレクタ全体で照合する。**
 *
 * 文字列を探すだけにすると、`.th-ms` が `.th-btn,\n.th-ms {` の中にも当たって
 * **別の規則の数字を読んだまま通る**（実際そうなった）。
 * 同じセレクタが2回書かれていたら、後から書いた方が効くので繋げて持つ。
 */
const RULES = new Map<string, string>()
for (const [, sel, body] of CSS.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(
  /([^{}]+)\{([^{}]*)\}/g
)) {
  const key = sel.trim().replace(/\s+/g, ' ')
  RULES.set(key, (RULES.get(key) ?? '') + body)
}

function rule(selector: string): string {
  const body = RULES.get(selector.replace(/\s+/g, ' '))
  if (body === undefined)
    throw new Error(`CSS に「${selector}」が無い（消したか名前を変えた）`)
  return body
}

/** 規則の中から `prop: 12px` を数として読む（同じ物が2回あれば後の方が効く） */
function px(selector: string, prop: string): number {
  const m = [...rule(selector).matchAll(new RegExp(`\\b${prop}:\\s*(-?[\\d.]+)px`, 'g'))]
  if (m.length === 0) throw new Error(`「${selector}」に ${prop} が無い`)
  return Number(m[m.length - 1][1])
}

describe('トラック見出しのボタン（🔒 / 👁 / M / S）', () => {
  const hitW = px('.th-btn::before,\n.th-ms::before', 'width')
  const hitH = px('.th-btn::before,\n.th-ms::before', 'height')

  it('絵は小さいままでも、押せる範囲は縦 24px ある（WCAG 2.2 の下限）', () => {
    expect(hitH).toBeGreaterThanOrEqual(24)
    // 絵の方は 16 × 15 のまま。広げたのは判定だけ
    expect(px('.th-btn', 'width')).toBe(16)
    expect(px('.th-ms', 'height')).toBe(15)
  })

  it('**隣と重ならない**（間隔より広げない）', () => {
    // 並びは横一列。中心の間隔＝絵の幅＋すき間
    const pitch = px('.th-btn', 'width') + px('.th-icons', 'gap')
    expect(hitW).toBeLessThanOrEqual(pitch)
    // 広げた意味があること（絵より広い）
    expect(hitW).toBeGreaterThan(px('.th-btn', 'width'))
  })

  // 段の高さは変えられるので、24px が段より高くなることがある。
  // `.th` の `overflow: hidden` が段の外を切っているので、**下の段の M を
  // 押してしまう事故が起きない**。ここを消すときは判定も見直すこと
  it('段からはみ出した分は切られている（下の段を押さない）', () => {
    expect(rule('.th')).toMatch(/overflow:\s*hidden/)
  })
})

describe('拡大バーの●', () => {
  const hitW = px('.zoom-bar-knob::before', 'width')

  it('絵は 12px のまま、押せる範囲だけ広い', () => {
    expect(px('.zoom-bar-knob', 'width')).toBe(12)
    expect(hitW).toBeGreaterThan(12)
    expect(px('.zoom-bar-knob::before', 'height')).toBeGreaterThan(12)
  })

  // **●の中心はつまみの両端にある**ので、間隔＝つまみの幅そのもの。
  // つまみが細くなるほど近づくため、判定は「いちばん細いとき」で測る
  it('**左右の●が重ならない**（つまみが下限まで細っても）', () => {
    expect(hitW).toBeLessThanOrEqual(px('.zoom-bar-thumb', 'min-width'))
  })

  it('**真ん中を掴んで動かす所が残る**（●で埋め尽くさない）', () => {
    const move = px('.zoom-bar-thumb', 'min-width') - hitW
    expect(move).toBeGreaterThanOrEqual(8)
  })

  it('**横は 24px ある**（WCAG 2.2 の下限）', () => {
    expect(hitW).toBeGreaterThanOrEqual(24)
  })

  // **縦は 24 にしない。** バーの上の余白は 2px しかないので、24 にすると
  // 上へ 6px はみ出して **4px がタイムラインの中へ食い込む**。●はつまみと
  // 一緒に動くため、段のいちばん下に「押すと拡大が始まる帯」が現れて左右へ動く。
  // 小さいままより悪い形（CLAUDE.md の hitArea の行）。
  // 縦を伸ばすならバー自体を高くする話で、それはタイムラインの高さを削る判断。
  it('**上の段へ食い込まない**（縦に広げすぎない）', () => {
    const 上のはみ出し =
      (px('.zoom-bar-knob::before', 'height') - px('.zoom-bar', 'height')) / 2
    // バーの上余白（margin の1つ目）を超えて出た分が、タイムラインを盗む
    const 上余白 = Number(/margin:\s*(-?[\d.]+)px/.exec(rule('.zoom-bar'))?.[1] ?? NaN)
    expect(上余白, '.zoom-bar の margin が読めない（書き方が変わった）').not.toBeNaN()
    expect(上のはみ出し - 上余白).toBeLessThanOrEqual(2)
  })
})
