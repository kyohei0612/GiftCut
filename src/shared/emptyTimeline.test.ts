// 空のタイムラインへ落としたら 0秒（`shared/emptyTimeline`）。
import { describe, it, expect } from 'vitest'
import { timelineIsEmpty, placeStartSec } from './emptyTimeline'

const 空 = { segments: [], vClips: [], cues: [], seClips: [], imgClips: [] }

describe('タイムラインが空か', () => {
  it('何も置いていなければ空', () => {
    expect(timelineIsEmpty(空)).toBe(true)
  })

  // **1本でもあれば空ではない。** 種類ごとに1つずつ確かめるのは、
  // 数え忘れた種類があると「空のはずが空でない」＝規則が効かなくなるため
  for (const 種類 of ['segments', 'vClips', 'cues', 'seClips', 'imgClips'] as const) {
    it(`${種類} が1本でもあれば空ではない`, () => {
      expect(timelineIsEmpty({ ...空, [種類]: [{}] })).toBe(false)
    })
  }
})

describe('置く時刻', () => {
  it('空なら、狙いがどこでも 0秒', () => {
    expect(placeStartSec(8.3, true)).toBe(0)
    expect(placeStartSec(0, true)).toBe(0)
  })

  it('空でなければ、狙った時刻のまま', () => {
    expect(placeStartSec(8.3, false)).toBe(8.3)
  })
})
