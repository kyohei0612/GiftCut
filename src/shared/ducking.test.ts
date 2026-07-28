import { describe, it, expect } from 'vitest'
import {
  voiceRegions,
  duckEnvelope,
  gainAt,
  dbToGain,
  envToFfmpegExpr,
  DEFAULT_DUCK
} from './ducking'

describe('ダッキング: 声のある所を出す', () => {
  it('無音の隙間が声になる', () => {
    // 10秒のうち 2〜3秒 と 6〜7秒 が無音
    const v = voiceRegions(
      [
        { start: 2, dur: 1 },
        { start: 6, dur: 1 }
      ],
      10
    )
    expect(v).toEqual([
      { start: 0, end: 2 },
      { start: 3, end: 6 },
      { start: 7, end: 10 }
    ])
  })

  it('無音が無ければ、全部が声', () => {
    expect(voiceRegions([], 5)).toEqual([{ start: 0, end: 5 }])
  })

  it('頭から無音なら、そこは声にしない', () => {
    expect(voiceRegions([{ start: 0, dur: 2 }], 5)).toEqual([{ start: 2, end: 5 }])
  })

  it('重なった無音はまとめて扱う', () => {
    const v = voiceRegions(
      [
        { start: 2, dur: 2 },
        { start: 3, dur: 2 }
      ],
      10
    )
    expect(v).toEqual([
      { start: 0, end: 2 },
      { start: 5, end: 10 }
    ])
  })
})

describe('ダッキング: 音量の折れ線', () => {
  const opts = { amountDb: -12, attack: 0.2, release: 0.5 }

  it('声の手前で下げ始め、終わってから戻す', () => {
    const env = duckEnvelope([{ start: 5, end: 8 }], opts)
    const low = dbToGain(-12)
    // 手前（4.8秒）はまだ1倍
    expect(gainAt(env, 4.79)).toBeCloseTo(1, 3)
    // 声の頭では下がりきっている
    expect(gainAt(env, 5)).toBeCloseTo(low, 3)
    // 声の間はずっと下がったまま
    expect(gainAt(env, 6.5)).toBeCloseTo(low, 3)
    // 終わった直後はまだ下がっていて、release 後に戻る
    expect(gainAt(env, 8)).toBeCloseTo(low, 3)
    expect(gainAt(env, 8.5)).toBeCloseTo(1, 3)
  })

  it('下げる途中は、なめらかに変わる（ブツッと切り替わらない）', () => {
    const env = duckEnvelope([{ start: 5, end: 8 }], opts)
    const mid = gainAt(env, 4.9) // attack の途中
    expect(mid).toBeLessThan(1)
    expect(mid).toBeGreaterThan(dbToGain(-12))
  })

  it('声が続けて来るときは、間で戻さない（音量が波打たない）', () => {
    // 0.2秒しか空いていない2つの声。release 0.5秒より短い
    const env = duckEnvelope(
      [
        { start: 2, end: 3 },
        { start: 3.2, end: 4 }
      ],
      opts
    )
    // 隙間（3.1秒）でも下がったまま
    expect(gainAt(env, 3.1)).toBeLessThan(0.5)
  })

  it('下げ幅0dBなら、何も変わらない', () => {
    const env = duckEnvelope([{ start: 2, end: 3 }], { ...opts, amountDb: 0 })
    expect(gainAt(env, 2.5)).toBeCloseTo(1, 5)
  })

  it('既定は -12dB・0.15秒で下げ・0.4秒で戻す', () => {
    expect(DEFAULT_DUCK).toEqual({ amountDb: -12, attack: 0.15, release: 0.4 })
  })
})

describe('ダッキング: 書き出し用の式', () => {
  /**
   * ffmpeg の式を、そのままの意味で評価する。
   * if(cond,a,b) と lt(a,b) は ffmpeg と同じ働きの関数を渡すだけでよい。
   */
  const evalExpr = (expr: string, t: number): number =>
    (
      Function(
        't',
        'iff',
        'lt',
        `return ${expr.replace(/\bif\(/g, 'iff(')}`
      ) as (t: number, iff: (c: number, a: number, b: number) => number, lt: (a: number, b: number) => number) => number
    )(
      t,
      (c, a, b) => (c ? a : b),
      (a, b) => (a < b ? 1 : 0)
    )

  it('式の値が、プレビューの折れ線とぴったり同じになる', () => {
    // ここがずれると「聴いた音と書き出した音が違う」という一番たちの悪い形になる
    const env = duckEnvelope(
      [
        { start: 5, end: 8 },
        { start: 12, end: 13 }
      ],
      { amountDb: -12, attack: 0.2, release: 0.5 }
    )
    const expr = envToFfmpegExpr(env)
    for (let t = 0; t <= 15; t += 0.05) {
      expect(evalExpr(expr, t), `t=${t.toFixed(2)} で食い違う`).toBeCloseTo(gainAt(env, t), 4)
    }
  })

  it('折れ線が空なら、そのままの音量', () => {
    expect(envToFfmpegExpr([])).toBe('1')
  })
})
