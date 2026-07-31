import { describe, expect, it } from 'vitest'
import { DEFAULT_LANE_H, TRACK_H_MAX, TRACK_H_MIN, loadLaneH } from './useLaneHeights'

describe('保存してある段の高さを読む', () => {
  it('普通に読める', () => {
    expect(loadLaneH('{"A1":50,"V2":80}')).toEqual({ A1: 50, V2: 80 })
  })

  it('**範囲外は捨てる**（潰れた段や、画面から溢れる段を作らない）', () => {
    expect(loadLaneH(`{"A1":${TRACK_H_MIN - 1},"V2":60}`)).toEqual({ V2: 60 })
    expect(loadLaneH(`{"A1":${TRACK_H_MAX + 1},"V2":60}`)).toEqual({ V2: 60 })
  })

  it('数でない値は捨てる', () => {
    expect(loadLaneH('{"A1":"たかさ","V2":60}')).toEqual({ V2: 60 })
  })

  it('壊れていたら既定に戻す（本編の音だけ波形が読める高さ）', () => {
    expect(loadLaneH('こわれている')).toEqual(DEFAULT_LANE_H)
    expect(loadLaneH(null)).toEqual(DEFAULT_LANE_H)
    expect(loadLaneH('{}')).toEqual(DEFAULT_LANE_H)
  })

  it('既定を書き換えない（読むたびに新しい物を返す）', () => {
    const a = loadLaneH(null)
    a.A1 = 999
    expect(loadLaneH(null).A1).toBe(DEFAULT_LANE_H.A1)
  })
})
