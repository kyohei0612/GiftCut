// 新しいテロップを置く段の選び方。
//
// **「頭だけ重なる」「尻だけ重なる」を取りこぼさないこと**が要点。
// 片方しか見ていないと、半分重なった所に作られて文字が二重に出る。

import { describe, expect, it } from 'vitest'
import { firstFreeLane, overlaps, type LaneItem } from './telopLane'

const LANES = ['V2', 'V3', 'V4'] // 下から上の順

describe('重なりの判定', () => {
  it('丸ごと重なる', () => {
    expect(overlaps(1, 3, 0, 5)).toBe(true)
  })

  it('**頭だけ重なる**', () => {
    expect(overlaps(1, 3, 0, 2)).toBe(true)
  })

  it('**尻だけ重なる**', () => {
    expect(overlaps(1, 3, 2, 9)).toBe(true)
  })

  it('中に丸ごと入っている', () => {
    expect(overlaps(1, 9, 3, 4)).toBe(true)
  })

  it('**端が接しているだけは重ならない**（隙間なく並べたいときに段が増えない）', () => {
    expect(overlaps(1, 3, 3, 5)).toBe(false)
    expect(overlaps(3, 5, 1, 3)).toBe(false)
  })

  it('離れていれば重ならない', () => {
    expect(overlaps(1, 2, 5, 6)).toBe(false)
  })
})

describe('空いている段を下から探す', () => {
  it('何も無ければ一番下', () => {
    expect(firstFreeLane(LANES, 0, 2, [])).toBe('V2')
  })

  it('下が埋まっていたら1つ上', () => {
    const items: LaneItem[] = [{ track: 'V2', start: 0, end: 5 }]
    expect(firstFreeLane(LANES, 1, 3, items)).toBe('V3')
  })

  it('**尻だけ被っていても、その段は使わない**', () => {
    const items: LaneItem[] = [{ track: 'V2', start: 2, end: 9 }]
    expect(firstFreeLane(LANES, 1, 3, items)).toBe('V3')
  })

  it('**頭だけ被っていても、その段は使わない**', () => {
    const items: LaneItem[] = [{ track: 'V2', start: 0, end: 2 }]
    expect(firstFreeLane(LANES, 1, 3, items)).toBe('V3')
  })

  it('端が接しているだけなら、その段を使う', () => {
    const items: LaneItem[] = [{ track: 'V2', start: 0, end: 1 }]
    expect(firstFreeLane(LANES, 1, 3, items)).toBe('V2')
  })

  it('**相手はテロップとは限らない**（画像・重ねた動画も避ける）', () => {
    // 同じ段に絵が居ると、作った瞬間から文字が絵の裏に隠れる
    const items: LaneItem[] = [
      { track: 'V2', start: 0, end: 9 }, // 画像
      { track: 'V3', start: 0, end: 9 } // 重ねた動画
    ]
    expect(firstFreeLane(LANES, 1, 3, items)).toBe('V4')
  })

  it('全部埋まっていたら null（呼ぶ側が段を足す）', () => {
    const items: LaneItem[] = LANES.map((track) => ({ track, start: 0, end: 9 }))
    expect(firstFreeLane(LANES, 1, 3, items)).toBeNull()
  })

  it('離れた時間で埋まっていても、そこは空いている扱い', () => {
    const items: LaneItem[] = [{ track: 'V2', start: 20, end: 30 }]
    expect(firstFreeLane(LANES, 1, 3, items)).toBe('V2')
  })
})
