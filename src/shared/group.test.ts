// 「組」の判定。
//
// **ここで固定したいのは「片方だけ組が効かない」状態が作れないこと。**
// 半分だけ番号が付く／半分だけ残る／片方の種類だけ広がらない——
// どれも画面では普通に見えて、掴んで動かしたときに初めて分かる。

import { describe, expect, it } from 'vitest'
import {
  applyGroup,
  canGroup,
  canUngroup,
  countSelected,
  expandSelectionByGroup,
  groupIdsInSelection,
  makeGroup,
  membersOfGroups,
  nextGroupId,
  remapGroups,
  sanitizeGroupId,
  ungroup
} from './group'

/** 種類は呼ぶ側が決める。ここでは3種類で確かめる */
type K = 'telop' | 'se' | 'vclip'

const pool = {
  telop: [{ id: 1, group: 7 }, { id: 2 }, { id: 3, group: 9 }],
  se: [{ id: 1, group: 7 }, { id: 2 }],
  vclip: [{ id: 5, group: 9 }, { id: 6 }]
} as const satisfies Record<K, readonly { id: number; group?: number }[]>

const none = { telop: [], se: [], vclip: [] } as const

describe('壊れた値を捨てる', () => {
  it('数でなければ捨てる', () => {
    expect(sanitizeGroupId('7')).toBeUndefined()
    expect(sanitizeGroupId(null)).toBeUndefined()
    expect(sanitizeGroupId(undefined)).toBeUndefined()
    expect(sanitizeGroupId({})).toBeUndefined()
  })

  it('整数でなければ捨てる', () => {
    expect(sanitizeGroupId(1.5)).toBeUndefined()
    expect(sanitizeGroupId(NaN)).toBeUndefined()
    expect(sanitizeGroupId(Infinity)).toBeUndefined()
  })

  it('**0 と負の数は捨てる**（0 が通ると「組に入っていない」と見分けが付かない）', () => {
    expect(sanitizeGroupId(0)).toBeUndefined()
    expect(sanitizeGroupId(-1)).toBeUndefined()
    expect(sanitizeGroupId(1)).toBe(1)
  })
})

describe('次の番号', () => {
  it('いま使われている中の最大＋1', () => {
    expect(nextGroupId(pool)).toBe(10)
  })

  it('1つも組が無ければ 1', () => {
    expect(nextGroupId({ telop: [{ id: 1 }], se: [], vclip: [] })).toBe(1)
  })

  it('**空きを詰めない**（詰めると消した組の番号が再利用される）', () => {
    // 7 が消えても 9 の次から振る
    const after = { telop: [{ id: 3, group: 9 }], se: [], vclip: [] }
    expect(nextGroupId(after)).toBe(10)
  })

  it('壊れた値は数えない', () => {
    const broken = { telop: [{ id: 1, group: -3 }], se: [], vclip: [] }
    expect(nextGroupId(broken)).toBe(1)
  })
})

describe('選択が属している組', () => {
  it('組に入っていない物だけなら空', () => {
    expect(groupIdsInSelection(pool, { ...none, telop: [2] })).toEqual([])
  })

  it('小さい順・重複なし', () => {
    expect(groupIdsInSelection(pool, { telop: [1, 3], se: [1], vclip: [5] })).toEqual([7, 9])
  })

  it('選んでいない物の組は拾わない', () => {
    expect(groupIdsInSelection(pool, { ...none, se: [1] })).toEqual([7])
  })
})

describe('選択を組ごとに広げる', () => {
  it('**種類をまたいで広がる**（段をまたぐ組が本来やりたいこと）', () => {
    // テロップ1（組7）を掴むと、同じ組の効果音1も付いてくる
    const got = expandSelectionByGroup(pool, { ...none, telop: [1] })
    expect(got).toEqual({ telop: [1], se: [1], vclip: [] })
  })

  it('2つの組にまたがって選んでいたら、両方まるごと', () => {
    const got = expandSelectionByGroup(pool, { ...none, telop: [1, 3] })
    expect(got).toEqual({ telop: [1, 3], se: [1], vclip: [5] })
  })

  it('組に入っていない物は、そのまま', () => {
    const sel = { ...none, telop: [2] }
    expect(expandSelectionByGroup(pool, sel)).toEqual({ telop: [2], se: [], vclip: [] })
  })

  it('**押した順を壊さない**（足す分は後ろへ付ける）', () => {
    const got = expandSelectionByGroup(pool, { ...none, telop: [3, 2] })
    expect(got.telop).toEqual([3, 2])
    expect(got.vclip).toEqual([5])
  })

  it('同じ物を2回入れない', () => {
    const got = expandSelectionByGroup(pool, { telop: [1], se: [1], vclip: [] })
    expect(got.se).toEqual([1])
  })

  it('**変わらない種類は同じ配列をそのまま返す**（毎回作ると帯が全部描き直しになる）', () => {
    const sel = { telop: [1], se: [1], vclip: [] }
    const got = expandSelectionByGroup(pool, sel)
    expect(got.se).toBe(sel.se)
    expect(got.vclip).toBe(sel.vclip)
  })

  it('組が1つも絡まないときも、配列をそのまま返す', () => {
    const sel = { ...none, telop: [2] }
    const got = expandSelectionByGroup(pool, sel)
    expect(got.telop).toBe(sel.telop)
  })
})

describe('組にできるか', () => {
  it('1つでは組にしない', () => {
    expect(canGroup(pool, { ...none, telop: [1] })).toBe(false)
  })

  it('種類をまたいで2つあれば組にできる', () => {
    expect(canGroup(pool, { ...none, telop: [2], se: [2] })).toBe(true)
  })

  it('選んでいない id を渡されても数えない', () => {
    expect(countSelected(pool, { ...none, telop: [99, 98] })).toBe(0)
  })

  it('何も選んでいなければ解けない', () => {
    expect(canUngroup(pool, none)).toBe(false)
  })

  it('組に入っている物を選んでいれば解ける', () => {
    expect(canUngroup(pool, { ...none, se: [1] })).toBe(true)
  })
})

describe('組にする', () => {
  it('番号と相手を返す', () => {
    const got = makeGroup(pool, { ...none, telop: [2], se: [2] })
    expect(got).toEqual({ group: 10, ids: { telop: [2], se: [2], vclip: [] } })
  })

  it('1つしか選んでいなければ何もしない', () => {
    expect(makeGroup(pool, { ...none, telop: [2] })).toBeNull()
  })

  it('**既にある組を巻き込んだら、その組ごと吸収する**（半分だけ移すと片方が取り残される）', () => {
    // テロップ1（組7）と テロップ2 を選ぶ → 組7の効果音1 も新しい組へ
    const got = makeGroup(pool, { ...none, telop: [1, 2] })
    expect(got?.group).toBe(10)
    expect(got?.ids).toEqual({ telop: [1, 2], se: [1], vclip: [] })
  })
})

describe('組を解く', () => {
  it('**選んでいない仲間からも消す**（残ると、その2人だけで組が生き続ける）', () => {
    // 効果音1 だけ選んで解く → 同じ組7のテロップ1 からも消える
    expect(ungroup(pool, { ...none, se: [1] })).toEqual({ telop: [1], se: [1], vclip: [] })
  })

  it('組に入っていなければ何もしない', () => {
    expect(ungroup(pool, { ...none, telop: [2] })).toBeNull()
  })

  it('2つの組を選んでいたら両方解く', () => {
    expect(ungroup(pool, { ...none, telop: [1, 3] })).toEqual({
      telop: [1, 3],
      se: [1],
      vclip: [5]
    })
  })
})

describe('印を付け直す', () => {
  const items = [{ id: 1 }, { id: 2, group: 4 }, { id: 3 }]

  it('付ける', () => {
    expect(applyGroup(items, [1, 3], 8)).toEqual([{ id: 1, group: 8 }, { id: 2, group: 4 }, { id: 3, group: 8 }])
  })

  it('消す（項目ごと落とす。undefined を残さない）', () => {
    const got = applyGroup(items, [2], undefined)
    expect(got[1]).toEqual({ id: 2 })
    expect('group' in got[1]).toBe(false)
  })

  it('関係ない物には触らない（同じ物をそのまま返す）', () => {
    const got = applyGroup(items, [1], 8)
    expect(got[1]).toBe(items[1])
  })

  it('**変わらなければ配列ごとそのまま返す**', () => {
    expect(applyGroup(items, [], 8)).toBe(items)
    expect(applyGroup(items, [2], 4)).toBe(items)
    expect(applyGroup(items, [1], undefined)).toBe(items)
  })

  it('元の配列を書き換えない', () => {
    applyGroup(items, [1], 8)
    expect(items[0]).toEqual({ id: 1 })
  })
})

describe('写した物の番号を振り直す', () => {
  it('**写しは元と別の組になる**（同じままだと写しを動かすと元まで動く）', () => {
    const m = remapGroups([7, 7, 9], 10)
    expect(m.get(7)).toBe(10)
    expect(m.get(9)).toBe(11)
  })

  it('組に入っていなかった物は表に載らない', () => {
    expect(remapGroups([undefined, 0, -1, 'x' as unknown as number], 5).size).toBe(0)
  })

  it('元が2つの組なら、写しも2つのまま', () => {
    expect(remapGroups([7, 9, 7, 9], 1).size).toBe(2)
  })
})

describe('組に属する物を引く', () => {
  it('番号を渡さなければ空', () => {
    expect(membersOfGroups(pool, [])).toEqual({ telop: [], se: [], vclip: [] })
  })

  it('**0 を渡しても、組に入っていない物は拾わない**', () => {
    expect(membersOfGroups(pool, [0])).toEqual({ telop: [], se: [], vclip: [] })
  })
})
