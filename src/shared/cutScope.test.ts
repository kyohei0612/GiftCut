// 「何を切るか」の決まり。
//
// 種類が6つ（動画・テロップ・効果音・画像・映像レイヤー・BGM）あるので、
// 目で全部確かめるのは現実的でない。決め方そのものを固定する。

import { describe, expect, it } from 'vitest'
import { shouldCut, spansCut } from './cutScope'

describe('何も選んでいないとき', () => {
  it('載っている物は全部切る', () => {
    expect(shouldCut(false, false)).toBe(true)
    expect(shouldCut(false, true)).toBe(true)
  })
})

describe('何かを選んでいるとき', () => {
  it('選んだ物だけ切る', () => {
    expect(shouldCut(true, true)).toBe(true)
  })

  it('**選んでいない物は切らない**', () => {
    // ここが本題。以前は動画だけ常に切れていて、
    // 「テロップを選んで切ったのに、下地の動画にもカット点が増える」状態だった
    expect(shouldCut(true, false)).toBe(false)
  })

  it('種類をまたいでも同じ（テロップを選んでいたら効果音は切らない）', () => {
    // 呼ぶ側は「どこかで何か選ばれているか」だけを渡す。
    // 種類ごとに別の判断をしないことが、揃った挙動になる条件
    const anySel = true
    expect(shouldCut(anySel, false)).toBe(false)
  })
})

describe('切り口がその物の中にあるか', () => {
  it('真ん中なら切る', () => {
    expect(spansCut(0, 10, 5)).toBe(true)
  })

  it('外なら切らない', () => {
    expect(spansCut(0, 10, 12)).toBe(false)
    expect(spansCut(5, 10, 1)).toBe(false)
  })

  it('**端ぎりぎりでは切らない**（長さ0のかけらを作らない）', () => {
    // 掴めないゴミがタイムラインに残ると、消すこともできない
    expect(spansCut(0, 10, 0)).toBe(false)
    expect(spansCut(0, 10, 10)).toBe(false)
    expect(spansCut(0, 10, 0.01)).toBe(false)
    expect(spansCut(0, 10, 9.99)).toBe(false)
  })

  it('余裕の幅は変えられる', () => {
    expect(spansCut(0, 10, 0.05, 0.02)).toBe(true)
    expect(spansCut(0, 10, 0.05, 0.1)).toBe(false)
  })
})
