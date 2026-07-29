import { describe, it, expect } from 'vitest'
import { toMotion, isFullyCopyable } from './prfpsetImport'
import { PR_TICKS_PER_SEC, type PrPreset } from './prfpset'
import { valueAt } from './keyframes'

const key = (t: number, v: number, sp?: number): { t: number; v: number; out?: { speed: number; influence: number } } =>
  sp === undefined ? { t, v } : { t, v, out: { speed: sp, influence: 1 / 3 } }

const preset = (
  matchName: string,
  paramName: string,
  keys: { t: number; v: number }[][],
  extra: PrPreset['effects'] = []
): PrPreset => ({
  name: 'テスト',
  effects: [{ matchName, params: [{ name: paramName, value: [], keys }] }, ...extra]
})

describe('単位を合わせる（ここを間違えると量だけ違う）', () => {
  it('位置: 割合（0.5が中央）→ 中央からのズレ px', () => {
    const p = preset('AE.ADBE Motion', '位置', [
      [key(0, 1.5), key(0.2, 0.5)], // x
      [key(0, 0.5), key(0.2, 0.5)] // y
    ])
    const { motion } = toMotion(p)
    // 割合はフレームの幅が1。1.5 は中央（0.5）からフレーム1つぶん右＝+1920px。
    // 0.5 は中央なので 0
    expect(motion.tx?.map((k) => k.v)).toEqual([1920, 0])
    expect(motion.ty?.map((k) => k.v)).toEqual([0, 0])
  })

  it('スケール: 100 が等倍 → 1', () => {
    const { motion } = toMotion(preset('AE.ADBE Motion', 'スケール', [[key(0, 100), key(1, 250)]]))
    expect(motion.sc?.map((k) => k.v)).toEqual([1, 2.5])
  })

  it('不透明度: 100 が不透明 → 1', () => {
    const { motion } = toMotion(preset('AE.ADBE Opacity', '不透明度', [[key(0, 0), key(1, 100)]]))
    expect(motion.op?.map((k) => k.v)).toEqual([0, 1])
  })

  it('回転は度どうしなのでそのまま', () => {
    const { motion } = toMotion(preset('AE.ADBE Motion', '回転', [[key(0, 0), key(1, 90)]]))
    expect(motion.rot?.map((k) => k.v)).toEqual([0, 90])
  })

  // **速度も同じ倍率で直さないと、曲がり方だけ元のままになる。**
  // 値だけ1/100にして速度を放置すると、100倍の速度で飛び出して戻る形になる。
  it('接線（速度）も値と同じ倍率で直す', () => {
    const { motion } = toMotion(
      preset('AE.ADBE Motion', 'スケール', [[key(0, 100, 50), key(1, 200)]])
    )
    expect(motion.sc?.[0].to?.speed).toBeCloseTo(0.5, 6) // 50/秒 → 0.5/秒
    expect(motion.sc?.[0].to?.influence).toBeCloseTo(1 / 3, 6)
  })

  it('位置の速度も px に直る', () => {
    const { motion } = toMotion(
      preset('AE.ADBE Motion', '位置', [[key(0, 1.5, 1), key(0.2, 0.5)]])
    )
    expect(motion.tx?.[0].to?.speed).toBeCloseTo(1920, 3)
  })
})

describe('取り込んだ動きが、実際にその値になるか', () => {
  it('端と途中を引いてみる', () => {
    const { motion } = toMotion(
      preset('AE.ADBE Motion', 'スケール', [[key(0, 100), key(1, 200)]])
    )
    expect(valueAt(motion.sc, 0, 1)).toBeCloseTo(1, 6)
    expect(valueAt(motion.sc, 0.5, 1)).toBeCloseTo(1.5, 6)
    expect(valueAt(motion.sc, 1, 1)).toBeCloseTo(2, 6)
  })
})

describe('持ってこられない物を黙って捨てない', () => {
  // 「取り込んだのに一部だけ効いていない」が一番たちが悪い。名前を返す。
  it('対応していないエフェクトは名前を返す', () => {
    const p = preset('AE.ADBE Motion', 'スケール', [[key(0, 100), key(1, 200)]], [
      { matchName: 'AE.ADBE Wave Warp', params: [{ name: '波形の幅', value: [], keys: [[key(0, 1)]] }] }
    ])
    const { motion, skipped } = toMotion(p)
    expect(motion.sc).toBeDefined()
    expect(skipped).toContain('AE.ADBE Wave Warp')
  })

  it('動きが付いていないエフェクトは、知らせなくてよい', () => {
    const p = preset('AE.ADBE Motion', 'スケール', [[key(0, 100), key(1, 200)]], [
      { matchName: 'AE.ADBE ProcAmp', params: [{ name: '明度', value: [1], keys: [] }] }
    ])
    expect(toMotion(p).skipped).toEqual([])
  })

  it('知らない項目も名前で返す（アンカーポイントなど）', () => {
    const p = preset('AE.ADBE Motion', 'アンカーポイント', [[key(0, 0.5), key(1, 0.6)]])
    expect(toMotion(p).skipped).toContain('AE.ADBE Motion/アンカーポイント')
  })
})

describe('そのまま再現できるプリセットか', () => {
  it('Motion と Opacity だけなら再現できる', () => {
    expect(
      isFullyCopyable({
        name: 'x',
        effects: [
          { matchName: 'AE.ADBE Motion', params: [] },
          { matchName: 'AE.ADBE Opacity', params: [] }
        ]
      })
    ).toBe(true)
  })
  it('他が混ざっていれば再現できない', () => {
    expect(
      isFullyCopyable({
        name: 'x',
        effects: [
          { matchName: 'AE.ADBE Motion', params: [] },
          { matchName: 'AE.ADBE Gaussian Blur 2', params: [] }
        ]
      })
    ).toBe(false)
  })
})

describe('時刻の刻み', () => {
  it('1秒あたりの刻みは Premiere と同じ', () => {
    expect(PR_TICKS_PER_SEC).toBe(254016000000)
  })
})

describe('トランスフォーム（動きはこちらに付いていることが多い）', () => {
  const tf = (name: string, keys: { t: number; v: number }[][]): PrPreset => ({
    name: 'テスト',
    effects: [{ matchName: 'AE.ADBE Geometry2', params: [{ name, value: [], keys }] }]
  })

  it('位置・スケールは「モーション」と同じように読める', () => {
    const { motion, skipped } = toMotion(tf('位置', [[key(0, 1.5), key(0.2, 0.5)], [key(0, 0.5), key(0.2, 0.5)]]))
    expect(motion.tx?.map((k) => k.v)).toEqual([1920, 0])
    expect(skipped).toEqual([])
  })

  // **これが 03.SLIDE_R2 のような「弾む」演出の正体。**
  it('スケール(幅): 横だけ伸び縮みする', () => {
    const { motion } = toMotion(tf('スケール (幅)', [[key(0, 200), key(0.3, 98.8)]]))
    expect(motion.scx?.map((k) => k.v)).toEqual([2, 0.988])
  })

  it('歪曲: 度どうしなのでそのまま', () => {
    const { motion } = toMotion(tf('歪曲', [[key(0, 0), key(0.3, -5.9)]]))
    expect(motion.skew?.map((k) => k.v)).toEqual([0, -5.9])
  })

  it('見た目に効かない項目は、知らせずに捨てる', () => {
    for (const n of ['歪曲軸', 'アンチフリッカー', 'シャッター角度', 'サンプリング']) {
      expect(toMotion(tf(n, [[key(0, 0), key(1, 90)]])).skipped).toEqual([])
    }
  })

  it('トランスフォームだけのプリセットも、そのまま再現できる扱い', () => {
    expect(isFullyCopyable({ name: 'x', effects: [{ matchName: 'AE.ADBE Geometry2', params: [] }] })).toBe(true)
  })
})
