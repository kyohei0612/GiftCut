import { describe, it, expect } from 'vitest'
import { mergeFavorites, mergeAssignments, mergeFolders, mergeNamed } from './templateMerge'

describe('テンプレートを開いても、育てた設定が消えない', () => {
  it('お気に入りは足し算（重複は1つに）', () => {
    expect(mergeFavorites(['A', 'B'], ['B', 'C'])).toEqual(['A', 'B', 'C'])
  })

  it('報告された不具合: テンプレートを開いても、いまのお気に入りは残る', () => {
    expect(mergeFavorites(['自分の1', '自分の2'], [])).toEqual(['自分の1', '自分の2'])
  })

  it('分類の割り当ては、いまの設定が勝つ', () => {
    // 「赤」を自分で 見出し に入れてある。テンプレは 本文 と言っているが、自分の勝ち
    const cur = { 赤: '見出し' }
    const tpl = { 赤: '本文', 青: '補足' }
    expect(mergeAssignments(cur, tpl)).toEqual({ 赤: '見出し', 青: '補足' })
  })

  it('自作フォルダは、いまの並びを保って、まだ無いものだけ足す', () => {
    const cur = [{ key: 'a', label: 'あ' }]
    const tpl = [
      { key: 'a', label: '別名' },
      { key: 'b', label: 'い' }
    ]
    expect(mergeFolders(cur, tpl)).toEqual([
      { key: 'a', label: 'あ' },
      { key: 'b', label: 'い' }
    ])
  })

  it('自作テロップは、同じ名前があれば足さない（上書きしない）', () => {
    const cur = [{ name: '見出し', style: 1 }]
    const tpl = [
      { name: '見出し', style: 999 },
      { name: '注釈', style: 2 }
    ]
    expect(mergeNamed(cur, tpl)).toEqual([
      { name: '見出し', style: 1 },
      { name: '注釈', style: 2 }
    ])
  })
})

describe('壊れたテンプレートでも落ちない', () => {
  it('配列でない・物でない値は、いまの設定をそのまま返す', () => {
    expect(mergeFavorites(['A'], null)).toEqual(['A'])
    expect(mergeFavorites(['A'], 'こわれ')).toEqual(['A'])
    expect(mergeAssignments({ a: 'x' }, null)).toEqual({ a: 'x' })
    expect(mergeFolders([{ key: 'a' }], 42)).toEqual([{ key: 'a' }])
    expect(mergeNamed([{ name: 'a' }], undefined)).toEqual([{ name: 'a' }])
  })

  it('中身に変な物が混ざっていても、それだけ捨てる', () => {
    expect(mergeFavorites(['A'], ['B', 3, null])).toEqual(['A', 'B'])
    expect(mergeFolders([], [{ key: 'ok' }, null, {}])).toEqual([{ key: 'ok' }])
    expect(mergeNamed([], [{ name: 'ok' }, { name: 3 }, null])).toEqual([{ name: 'ok' }])
  })
})
