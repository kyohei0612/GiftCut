// タイムラインの**時間の写像**（波形・コマ・フェード・clamp）。
//
// ## なぜ分かれているか（2026-08-05）
//
// もとは `timeline.test.ts` 1本で 755行あった（決まり: 600超は500以下に割る）。
// 話題で3つに分けた:
//
//   timeline.test.ts       切片の並びと写像（layoutSegs / tToSource / xfade）
//   timeline.move.test.ts  切片の移動とリップル
//   timeline.time.test.ts  ここ。波形・コマ・フェード・clamp
//
// **乱数と切片づくりは `./timelineTestRandom`**（3つとも使うので、写すと重複になる）。

import { describe, expect, it } from 'vitest'
import { clamp, fadeGain, formatTimecode, normFps, qFrame, waveIndexAt } from './timeline'
import { mulberry32 } from './timelineTestRandom'

describe('波形の写像', () => {
  it('端点がぴったり合う: t=0 → 0, t=audioDur → buckets', () => {
    expect(waveIndexAt(0, 10, 3000)).toBe(0)
    expect(waveIndexAt(10, 10, 3000)).toBeCloseTo(3000, 9)
  })

  it('線形（中間点は真ん中）', () => {
    expect(waveIndexAt(5, 10, 3000)).toBeCloseTo(1500, 9)
  })

  it('回帰: 動画の尺ではなく音声の実尺で写像する', () => {
    // 実測したファイル: 映像/音声/コンテナはどれも 35.300 と申告するが、
    // 実デコードした音声は 35.3067 秒だった。動画の尺で割ると末尾がバケット外へ出る。
    const audioDur = 35.306667
    const videoDur = 35.3
    const buckets = Math.round(audioDur * 300) // perSec=300

    // 正しい写像: 音声の末尾がちょうど末尾バケットに来る
    expect(waveIndexAt(audioDur, audioDur, buckets)).toBeCloseTo(buckets, 6)

    // 誤った写像（動画の尺で割る）は末尾を超え、しかもズレは 1 バケット以上ある
    const wrong = waveIndexAt(audioDur, videoDur, buckets)
    expect(wrong).toBeGreaterThan(buckets)
    expect(wrong - buckets).toBeGreaterThan(1)
  })

  it('ズレは時間に比例して増える（冒頭は合うのに後半だけ合わない、の説明）', () => {
    const audioDur = 35.306667
    const videoDur = 35.3
    const buckets = 10593
    const errAt = (t: number): number =>
      Math.abs(waveIndexAt(t, videoDur, buckets) - waveIndexAt(t, audioDur, buckets))
    // 冒頭はほぼ 0、末尾で最大
    expect(errAt(0)).toBeCloseTo(0, 9)
    expect(errAt(35)).toBeGreaterThan(errAt(1))
    expect(errAt(1)).toBeGreaterThan(errAt(0.1))
  })

  it('不正な尺/バケット数でも 0 を返す（NaN を描画に流さない）', () => {
    expect(waveIndexAt(1, 0, 100)).toBe(0)
    expect(waveIndexAt(1, -5, 100)).toBe(0)
    expect(waveIndexAt(1, 10, 0)).toBe(0)
    expect(Number.isNaN(waveIndexAt(1, NaN, 100))).toBe(false)
  })
})

// ===========================================================================
describe('フレーム量子化とタイムコード', () => {
  it('qFrame は冪等（2回かけても変わらない）', () => {
    const rnd = mulberry32(7)
    for (const fps of [24, 25, 30, 29.97, 50, 59.94, 60]) {
      for (let i = 0; i < 100; i++) {
        const t = rnd() * 600
        const a = qFrame(t, fps)
        expect(qFrame(a, fps)).toBeCloseTo(a, 12)
      }
    }
  })

  it('qFrame はフレームグリッド上に乗る', () => {
    for (const fps of [24, 30, 60]) {
      const q = qFrame(1.2345, fps)
      expect(Math.abs(q * fps - Math.round(q * fps))).toBeLessThan(1e-9)
    }
  })

  it('qFrame の誤差は半フレーム以内', () => {
    const rnd = mulberry32(8)
    for (const fps of [24, 29.97, 30, 60]) {
      for (let i = 0; i < 200; i++) {
        const t = rnd() * 1000
        expect(Math.abs(qFrame(t, fps) - t)).toBeLessThanOrEqual(0.5 / fps + 1e-12)
      }
    }
  })

  it('normFps は不正値をフォールバックに落とす', () => {
    expect(normFps(0)).toBe(30)
    expect(normFps(-1)).toBe(30)
    expect(normFps(NaN)).toBe(30)
    expect(normFps(undefined)).toBe(30)
    expect(normFps(null)).toBe(30)
    expect(normFps(Infinity)).toBe(30)
    expect(normFps(29.97)).toBeCloseTo(29.97, 9)
  })

  it('タイムコードの桁と繰り上がり', () => {
    expect(formatTimecode(0, 30)).toBe('00:00:00:00')
    expect(formatTimecode(1, 30)).toBe('00:00:01:00')
    expect(formatTimecode(61.5, 30)).toBe('00:01:01:15')
    expect(formatTimecode(3600, 30)).toBe('01:00:00:00')
    expect(formatTimecode(3661, 30)).toBe('01:01:01:00')
  })

  it('最終フレームで秒に繰り上がる（29/30 → 次の秒の 00 にならない）', () => {
    expect(formatTimecode(29 / 30, 30)).toBe('00:00:00:29')
    expect(formatTimecode(30 / 30, 30)).toBe('00:00:01:00')
  })

  it('負値と NaN でも壊れた文字列を返さない', () => {
    expect(formatTimecode(-5, 30)).toBe('00:00:00:00')
    expect(formatTimecode(0, 0)).toBe('00:00:00:00')
  })

  it('フレーム番号は必ず fps 未満', () => {
    const rnd = mulberry32(9)
    for (const fps of [24, 25, 29.97, 30, 59.94, 60]) {
      const r = Math.max(1, Math.round(fps))
      for (let i = 0; i < 200; i++) {
        const f = Number(formatTimecode(rnd() * 7200, fps).split(':')[3])
        expect(f).toBeLessThan(r)
        expect(f).toBeGreaterThanOrEqual(0)
      }
    }
  })
})

// ===========================================================================
describe('音声フェード', () => {
  it('フェードなしは常に 1', () => {
    expect(fadeGain(0, 10)).toBe(1)
    expect(fadeGain(5, 10)).toBe(1)
    expect(fadeGain(10, 10)).toBe(1)
  })

  it('フェードインは 0 → 1', () => {
    expect(fadeGain(0, 10, 2)).toBeCloseTo(0, 9)
    expect(fadeGain(1, 10, 2)).toBeCloseTo(0.5, 9)
    expect(fadeGain(2, 10, 2)).toBeCloseTo(1, 9)
    expect(fadeGain(5, 10, 2)).toBeCloseTo(1, 9)
  })

  it('フェードアウトは 1 → 0', () => {
    expect(fadeGain(8, 10, 0, 2)).toBeCloseTo(1, 9)
    expect(fadeGain(9, 10, 0, 2)).toBeCloseTo(0.5, 9)
    expect(fadeGain(10, 10, 0, 2)).toBeCloseTo(0, 9)
  })

  it('イン/アウトが重なっても 0..1 に収まる（谷が二重に掛からない）', () => {
    const rnd = mulberry32(10)
    for (let i = 0; i < 500; i++) {
      const len = 0.2 + rnd() * 5
      const fi = rnd() * len * 1.5
      const fo = rnd() * len * 1.5
      const t = rnd() * len
      const g = fadeGain(t, len, fi, fo)
      expect(g).toBeGreaterThanOrEqual(0)
      expect(g).toBeLessThanOrEqual(1)
      expect(Number.isNaN(g)).toBe(false)
    }
  })
})

// ===========================================================================
describe('clamp', () => {
  it('範囲に収める', () => {
    expect(clamp(-1, 0, 1)).toBe(0)
    expect(clamp(2, 0, 1)).toBe(1)
    expect(clamp(0.5, 0, 1)).toBe(0.5)
  })
})
