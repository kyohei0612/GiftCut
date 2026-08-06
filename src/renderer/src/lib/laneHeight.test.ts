// 段の高さの決まり方。
//
// **「A3 だけ大きい」の答えを、起動せずに出せるようにする**のがここの目的
// （2026-08-06）。前はアプリを立ち上げて実寸を測るしかなかった。
import { describe, it, expect } from 'vitest'
import { laneHeightOf, type LaneHeightSource } from './laneHeight'
import { DEFAULT_LANE_H, TRACK_H_MIN } from '../state/useLaneHeights'

/** 既定の並び（V1〜V3 / A1〜A3） */
const kindOf = (id: string): 'video' | 'audio' | undefined =>
  id.startsWith('V') ? 'video' : id.startsWith('A') ? 'audio' : undefined

/** 入れ立ての状態（種類の既定は両方とも下限、段ごとは DEFAULT_LANE_H） */
const fresh = (): LaneHeightSource => ({
  laneH: { ...DEFAULT_LANE_H },
  videoTrackH: TRACK_H_MIN,
  audioTrackH: TRACK_H_MIN,
  kindOf
})

describe('入れ立ての高さ', () => {
  // **これが「なんで A3 だけ？」への答え。**
  // 既定では A3 も V3 も種類の既定（どちらも下限）を見るので、同じ高さになる。
  // 揃わなくなるのは、種類の既定が片方だけ動いたとき
  it('**A3 と V3 は同じ高さ**（どちらも種類の既定を見る）', () => {
    const s = fresh()
    expect(laneHeightOf(s, 'A3')).toBe(laneHeightOf(s, 'V3'))
    expect(laneHeightOf(s, 'A3')).toBe(TRACK_H_MIN)
  })

  it('A2 と V2 も同じ', () => {
    const s = fresh()
    expect(laneHeightOf(s, 'A2')).toBe(laneHeightOf(s, 'V2'))
  })

  it('**本編（V1 / A1）だけ高い**（どれが背骨か絵で分かるように）', () => {
    const s = fresh()
    expect(laneHeightOf(s, 'V1')).toBe(DEFAULT_LANE_H.V1)
    expect(laneHeightOf(s, 'A1')).toBe(DEFAULT_LANE_H.A1)
    expect(laneHeightOf(s, 'V1')).toBeGreaterThan(laneHeightOf(s, 'V3'))
  })

  it('**高い段は2本だけ**（増やすと「本編だけ高い」の意味が消える）', () => {
    expect(Object.keys(DEFAULT_LANE_H).sort()).toEqual(['A1', 'V1'])
  })
})

describe('決まる順番', () => {
  it('段ごとの指定があれば、それが勝つ', () => {
    const s = { ...fresh(), laneH: { A3: 80 } }
    expect(laneHeightOf(s, 'A3')).toBe(80)
  })

  it('無ければ種類の既定へ落ちる', () => {
    const s = { ...fresh(), laneH: {}, audioTrackH: 96.5 }
    expect(laneHeightOf(s, 'A3')).toBe(96.5)
  })

  it('種類そのものを渡してもよい', () => {
    const s = { ...fresh(), audioTrackH: 50 }
    expect(laneHeightOf(s, 'audio')).toBe(50)
    expect(laneHeightOf(s, 'video')).toBe(TRACK_H_MIN)
  })

  it('知らない段でも 0 にしない（0 だと段が消えて掴む所も無くなる）', () => {
    expect(laneHeightOf(fresh(), 'なぞ')).toBe(TRACK_H_MIN)
  })
})

// **実際に起きた形をそのまま置いておく**（作り話の入力を使わない）。
// 本人の画面から読み出した値で、これが「A3 だけ大きい」の正体だった
describe('2026-08-06 に起きた形', () => {
  const 実際 = (): LaneHeightSource => ({
    laneH: { A1: 44, A2: 26 },
    videoTrackH: 26,
    audioTrackH: 96.5,
    kindOf
  })

  it('A1・A2 は指定どおり、**A3 だけ音声の既定を見て 96.5**', () => {
    const s = 実際()
    expect(laneHeightOf(s, 'A1')).toBe(44)
    expect(laneHeightOf(s, 'A2')).toBe(26)
    expect(laneHeightOf(s, 'A3')).toBe(96.5)
  })

  it('**V3 は揃って見えた**（映像の既定だけ動いていなかったから）', () => {
    const s = 実際()
    expect(laneHeightOf(s, 'V3')).toBe(26)
    // 同じ「種類の既定を見る」段なのに、片方だけ大きい。
    // A3 が特別なのではなく、**音声の既定だけが動いていた**
    expect(laneHeightOf(s, 'A3')).not.toBe(laneHeightOf(s, 'V3'))
  })
})
