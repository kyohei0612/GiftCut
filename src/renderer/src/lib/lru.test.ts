import { describe, it, expect } from 'vitest'
import { makeLru } from './lru'

describe('控えの上限', () => {
  // **ここが本題。** 上限が無かったせいで、1文字打つたびに控えが増え続けていた
  // （鍵に文字の中身が入っている）。「編集した分だけ重くなる」の正体。
  it('上限を超えたら、古い方から捨てる', () => {
    const c = makeLru<number>(3)
    for (const k of ['a', 'b', 'c', 'd']) c.set(k, 1)
    expect(c.size).toBe(3)
    expect(c.get('a')).toBeUndefined() // 一番古い物が消えている
    expect(c.get('d')).toBe(1)
  })

  it('いくら入れても、上限より増えない', () => {
    const c = makeLru<number>(10)
    for (let i = 0; i < 1000; i++) c.set('k' + i, i)
    expect(c.size).toBe(10)
  })

  // **使っている物が、通りすがりの物に押し出されてはいけない。**
  // 入れた順のまま捨てると、1つのテロップを直し続けている間に
  // その控えが消える（＝毎回測り直しになって、上限を付けた意味が薄れる）。
  it('取り出した物は生き残る（しばらく使っていない方から捨てる）', () => {
    const c = makeLru<number>(3)
    c.set('a', 1)
    c.set('b', 2)
    c.set('c', 3)
    c.get('a') // a を使う → 最後尾へ回る
    c.set('d', 4) // あふれる。捨てられるのは、使っていない b
    expect(c.get('a')).toBe(1)
    expect(c.get('b')).toBeUndefined()
  })

  it('同じ鍵を入れ直しても件数は増えない', () => {
    const c = makeLru<number>(3)
    c.set('a', 1)
    c.set('a', 2)
    expect(c.size).toBe(1)
    expect(c.get('a')).toBe(2)
  })
})
