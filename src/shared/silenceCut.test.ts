import { describe, it, expect } from 'vitest'
import {
  cutsFromSilences,
  mergeRanges,
  totalCutLen,
  DEFAULT_SILENCE_CUT,
  type Silence
} from './silenceCut'

// 素材10秒をそのまま1切片で置いた状態
const one = [{ srcStart: 0, srcEnd: 10 }]

describe('無音カット: 消す範囲を出す', () => {
  it('無音が無ければ、何も切らない', () => {
    expect(cutsFromSilences(one, [])).toEqual([])
  })

  it('真ん中の無音を、余白を残して切る', () => {
    // 3.0〜6.0 が無音。余白 0.15 なので 3.15〜5.85 を切る
    const s: Silence[] = [{ start: 3, dur: 3 }]
    const cuts = cutsFromSilences(one, s)
    expect(cuts.length).toBe(1)
    expect(cuts[0].start).toBeCloseTo(3.15, 5)
    expect(cuts[0].end).toBeCloseTo(5.85, 5)
  })

  it('余白を引いて短くなりすぎたものは切らない', () => {
    // 0.5秒の無音。余白0.15を両側から引くと0.2秒 → 最短0.4秒に満たない
    const cuts = cutsFromSilences(one, [{ start: 2, dur: 0.5 }])
    expect(cuts).toEqual([])
  })

  it('余白ゼロ・最短ゼロなら、そのままの範囲になる', () => {
    const cuts = cutsFromSilences(one, [{ start: 2, dur: 0.5 }], { pad: 0, minLen: 0 })
    expect(cuts[0].start).toBeCloseTo(2, 5)
    expect(cuts[0].end).toBeCloseTo(2.5, 5)
  })

  it('切片が素材の一部だけを使っている場合、その中の無音だけを切る', () => {
    // 素材の 5〜10 秒を、タイムラインの 0秒から置いている
    const segs = [{ srcStart: 5, srcEnd: 10 }]
    // 素材の 2〜3 秒（使っていない所）と 6〜8 秒（使っている所）が無音
    const cuts = cutsFromSilences(segs, [
      { start: 2, dur: 1 },
      { start: 6, dur: 2 }
    ])
    expect(cuts.length).toBe(1)
    // 素材6.15 → タイムラインでは 6.15-5 = 1.15
    expect(cuts[0].start).toBeCloseTo(1.15, 5)
    expect(cuts[0].end).toBeCloseTo(2.85, 5)
  })

  it('切片をまたぐ無音は、切片ごとの位置に分かれる', () => {
    // 素材 0〜5 と 5〜10 を、間に別の素材を挟まずに並べた
    const segs = [
      { srcStart: 0, srcEnd: 5 },
      { srcStart: 5, srcEnd: 10 }
    ]
    // 素材の 4〜6 秒が無音（2つの切片にまたがる）
    const cuts = cutsFromSilences(segs, [{ start: 4, dur: 2 }], { pad: 0, minLen: 0 })
    // 切片の切れ目で1つにつながる（4.0〜6.0）
    expect(cuts.length).toBe(1)
    expect(cuts[0].start).toBeCloseTo(4, 5)
    expect(cuts[0].end).toBeCloseTo(6, 5)
  })

  it('切った順に並び替えても、時間が前後しない', () => {
    const cuts = cutsFromSilences(one, [
      { start: 7, dur: 2 },
      { start: 1, dur: 2 }
    ])
    expect(cuts.map((c) => c.start)).toEqual([...cuts.map((c) => c.start)].sort((a, b) => a - b))
  })

  it('2倍速の切片では、タイムライン上の長さが半分になる', () => {
    const segs = [{ srcStart: 0, srcEnd: 10, speed: 2 }]
    // 素材の 2〜6 秒が無音 → タイムラインでは 1〜3 秒
    const cuts = cutsFromSilences(segs, [{ start: 2, dur: 4 }], { pad: 0, minLen: 0 })
    expect(cuts[0].start).toBeCloseTo(1, 5)
    expect(cuts[0].end).toBeCloseTo(3, 5)
  })

  it('2倍速だと、最短の長さもタイムライン基準で判定する', () => {
    const segs = [{ srcStart: 0, srcEnd: 10, speed: 2 }]
    // 素材で0.6秒の無音 → タイムラインでは0.3秒。最短0.4秒に満たないので切らない
    const cuts = cutsFromSilences(segs, [{ start: 2, dur: 0.6 }], { pad: 0, minLen: 0.4 })
    expect(cuts).toEqual([])
  })
})

describe('無音カット: 範囲の後始末', () => {
  it('重なった範囲はまとめる', () => {
    expect(
      mergeRanges([
        { start: 0, end: 2 },
        { start: 1.5, end: 3 },
        { start: 5, end: 6 }
      ])
    ).toEqual([
      { start: 0, end: 3 },
      { start: 5, end: 6 }
    ])
  })

  it('合計の長さが出る（何秒短くなるかを先に見せるため）', () => {
    expect(
      totalCutLen([
        { start: 0, end: 2 },
        { start: 5, end: 6.5 }
      ])
    ).toBeCloseTo(3.5, 5)
  })

  it('既定は余白0.15秒・最短0.4秒（ブツ切りにならない値）', () => {
    expect(DEFAULT_SILENCE_CUT).toEqual({ pad: 0.15, minLen: 0.4 })
  })
})
