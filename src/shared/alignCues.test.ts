// 字幕の時刻を喋りへ合わせ直す規則。
//
// **前に出した SRT が「開始位置がバラバラ」だった**のがきっかけ。
// 文字起こしの精度ではなく時刻の当て方の話なので、音を用意しなくても
// 試せる形（無音の区間を数字で渡す）で固定する。

import { describe, expect, it } from 'vitest'
import { alignCues, speechRanges } from './alignCues'

describe('喋っている区間', () => {
  it('無音の裏返しになる', () => {
    const r = speechRanges([{ start: 2, dur: 1 }], 5)
    expect(r).toEqual([
      { start: 0, end: 2 },
      { start: 3, end: 5 }
    ])
  })
  it('頭から無音なら、その後ろだけ', () => {
    expect(speechRanges([{ start: 0, dur: 1.5 }], 4)).toEqual([{ start: 1.5, end: 4 }])
  })
  it('無音が無ければ全部が喋り', () => {
    expect(speechRanges([], 3)).toEqual([{ start: 0, end: 3 }])
  })
  it('重なった無音でも壊れない', () => {
    expect(speechRanges([{ start: 1, dur: 2 }, { start: 2, dur: 2 }], 6)).toEqual([
      { start: 0, end: 1 },
      { start: 4, end: 6 }
    ])
  })
})

describe('合わせ直す', () => {
  const sil = [{ start: 0, dur: 1 }, { start: 3, dur: 1 }] // 喋り: 1〜3 と 4〜終わり
  it('**声が出た所へ開始を吸い付ける**', () => {
    const [c] = alignCues([{ start: 0.7, end: 2.9, text: 'あ' }], sil, 6)
    expect(c.start).toBeCloseTo(1, 3)
    expect(c.end).toBeCloseTo(3, 3)
  })
  it('遠すぎる所へは吸い付けない（別の音に貼り付くのを防ぐ）', () => {
    // 喋りは 1〜3。開始 0.0 は 1秒も離れているので動かさない（既定 0.6秒）
    const [c] = alignCues([{ start: 0, end: 2.9, text: 'あ' }], sil, 6)
    expect(c.start).toBeCloseTo(0, 3)
  })
  it('順番を入れ替えない・重ならない', () => {
    const r = alignCues(
      [
        { start: 2.9, end: 3.1, text: '前' },
        { start: 1.2, end: 2.8, text: '後' }
      ],
      sil,
      6
    )
    expect(r.map((x) => x.text)).toEqual(['後', '前'])
    expect(r[1].start).toBeGreaterThanOrEqual(r[0].end)
  })
  it('短すぎる字幕は最短の長さまで伸ばす（一瞬で消えると読めない）', () => {
    const [c] = alignCues([{ start: 1.0, end: 1.05, text: 'あ' }], [], 6, { minDur: 0.4 })
    // 1.4 - 1.0 が 0.3999… になる（小数の足し引きの誤差）。ミリ秒まで丸めて見る
    expect(Math.round((c.end - c.start) * 1000) / 1000).toBeGreaterThanOrEqual(0.4)
  })
  it('音の終わりを超えない', () => {
    const [c] = alignCues([{ start: 5.8, end: 9, text: 'あ' }], [], 6)
    expect(c.end).toBeLessThanOrEqual(6)
    expect(c.start).toBeLessThan(c.end)
  })
  it('**カット点があれば、そちらを優先して開始を合わせる**', () => {
    // 切ったのは編集した本人で、たいてい「ここから話が始まる」で切っている。
    // 音から測った喋りの始まり（1.0）より、カット点（1.2）を勝たせる
    const [c] = alignCues([{ start: 1.15, end: 2.5, text: 'あ' }], sil, 6, { cuts: [1.2] })
    expect(c.start).toBeCloseTo(1.2, 3)
  })
  it('カット点が遠ければ、そこへは寄せない', () => {
    const [c] = alignCues([{ start: 1.15, end: 2.5, text: 'あ' }], sil, 6, {
      cuts: [4.5],
      cutSnap: 0.35
    })
    expect(c.start).not.toBeCloseTo(4.5, 3)
  })
  it('カット点を渡さなくても今までどおり動く', () => {
    const [c] = alignCues([{ start: 1.15, end: 2.5, text: 'あ' }], sil, 6)
    expect(c.start).toBeCloseTo(1, 3)
  })
  it('無音が取れなくても壊れない（そのままの時刻で返す）', () => {
    const r = alignCues([{ start: 1, end: 2, text: 'あ' }], [], 10)
    expect(r[0].start).toBeCloseTo(1, 3)
    expect(r[0].end).toBeCloseTo(2, 3)
  })
})
