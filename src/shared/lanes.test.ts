// 段の縦位置と落とし先。
//
// **掴んで落としてみるまで分からない**類なので、ここで固定する。
// 特に「外したときに本編へ落とさない」は、間違えると元の映像が消える。

import { describe, expect, it } from 'vitest'
import { dropLaneAt, laneAtY, laneRows, pickAudioLane } from './lanes'

/** V1 V2 V3 / A1 A2 の5段。映像40px・音声30px・目盛り24px */
const TRACKS = [
  { id: 'V3', kind: 'video' as const },
  { id: 'V2', kind: 'video' as const },
  { id: 'V1', kind: 'video' as const },
  { id: 'A1', kind: 'audio' as const },
  { id: 'A2', kind: 'audio' as const }
]
const rows = laneRows(TRACKS, 40, 30, 24)

describe('段を並べる', () => {
  it('上から順に積む', () => {
    expect(rows.map((r) => [r.id, r.top, r.h])).toEqual([
      ['V3', 24, 40],
      ['V2', 64, 40],
      ['V1', 104, 40],
      ['A1', 144, 30],
      ['A2', 174, 30]
    ])
  })

  it('種類ごとに高さが違う（映像は太く、音声は細く）', () => {
    expect(rows.find((r) => r.id === 'V1')?.h).toBe(40)
    expect(rows.find((r) => r.id === 'A1')?.h).toBe(30)
  })
})

describe('その高さにある段', () => {
  it('行の中なら見つかる', () => {
    expect(laneAtY(rows, 24)).toBe('V3')
    expect(laneAtY(rows, 63)).toBe('V3')
    expect(laneAtY(rows, 64)).toBe('V2')
    expect(laneAtY(rows, 150)).toBe('A1')
  })

  it('行の外なら null（目盛りの上・一番下の余白）', () => {
    expect(laneAtY(rows, 0)).toBeNull()
    expect(laneAtY(rows, 999)).toBeNull()
  })
})

describe('落とし先を決める', () => {
  it('行の上ならそこへ置く', () => {
    expect(dropLaneAt(rows, 70, 'video')).toBe('V2')
    expect(dropLaneAt(rows, 150, 'audio')).toBe('A1')
  })

  it('**行の外でも必ずどこかへ置く**（駐禁マークを出さない）', () => {
    expect(dropLaneAt(rows, 0, 'video')).not.toBeNull()
    expect(dropLaneAt(rows, 9999, 'audio')).not.toBeNull()
  })

  it('**外したときは本編へ落とさない**（元の映像を上書きして消すため）', () => {
    // 一番下の余白（本編 A1 より下）へ落ちても、A1 は選ばない
    expect(dropLaneAt(rows, 9999, 'audio')).toBe('A2')
    // 目盛りより上（V3 より上）へ落ちても、V1 は選ばない
    expect(dropLaneAt(rows, 0, 'video')).toBe('V3')
  })

  it('本編の行を狙っているなら、本編でよい', () => {
    expect(dropLaneAt(rows, 110, 'video')).toBe('V1')
    expect(dropLaneAt(rows, 150, 'audio')).toBe('A1')
  })

  it('画像や重ねる映像は、狙っても本編には置けない', () => {
    expect(dropLaneAt(rows, 110, 'video', true)).not.toBe('V1')
  })

  it('置ける段が無ければ null', () => {
    const only = laneRows([{ id: 'V1', kind: 'video' }], 40, 30, 0)
    expect(dropLaneAt(only, 10, 'audio')).toBeNull()
    // 本編しか無い所へ「本編以外」を求められたら、置き場所が無い
    expect(dropLaneAt(only, 10, 'video', true)).toBeNull()
  })

  it('本編しか候補が無いときは、やむを得ず本編へ寄せる', () => {
    const only = laneRows([{ id: 'A1', kind: 'audio' }], 40, 30, 0)
    expect(dropLaneAt(only, 9999, 'audio')).toBe('A1')
  })
})

describe('音を置く段を選ぶ', () => {
  const lanes = ['A2', 'A3', 'A4']
  const busy = [{ track: 'A2', tStart: 0, duration: 5 }]

  it('段を選んであるなら、そこへ置く（空いていなくても）', () => {
    expect(pickAudioLane(lanes, busy, 1, 'A2', 'A3')).toBe('A3')
    expect(pickAudioLane(lanes, busy, 1, 'A2', 'A2')).toBe('A2')
  })

  // **「いつも A2」をやめるのがこの関数の目的。** 埋まっていたら次の段へ
  it('選んでいなければ、その時刻が空いている一番上の段', () => {
    expect(pickAudioLane(lanes, busy, 1, 'A2')).toBe('A3')
    expect(pickAudioLane(lanes, busy, 9, 'A2')).toBe('A2') // 5秒より後は空いている
  })

  it('どこも埋まっていれば既定へ（置かないより分かりやすい）', () => {
    const full = lanes.map((track) => ({ track, tStart: 0, duration: 5 }))
    expect(pickAudioLane(lanes, full, 1, 'A2')).toBe('A2')
  })

  it('無い段を選んであっても、そこには置かない', () => {
    expect(pickAudioLane(lanes, busy, 1, 'A2', 'A1')).toBe('A3')
  })
})
