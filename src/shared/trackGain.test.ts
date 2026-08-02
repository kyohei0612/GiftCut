// 音のトラック1本ぶんの音量。
//
// **この規則は「鳴らない」方に倒れると気づけない。** 目で見える物と違って、
// そこを聴くまで分からず、書き出したあとに気づく。だから固定する。
//
// もともと同じ式が**聴く側と書き出す側の2か所に書き直されていて**、
// 片方だけ直して食い違っていた（2026-08-03 に1つへ寄せた）。

import { describe, expect, it } from 'vitest'
import { trackGain, trackGainForExport } from './trackGain'

describe('聴くときの音量', () => {
  it('**状態が無いトラックは、そのまま鳴らす**（無い＝既定であって消音ではない）', () => {
    // 触っていないトラックの状態は保存されないことがある。無い物を消音として
    // 扱っていたため、開き直すと SE が1つも鳴らなくなっていた
    expect(trackGain(undefined, 1, false)).toBe(1)
  })

  it('ミュートは黙る', () => {
    expect(trackGain({ muted: true, volume: 1 }, 1, false)).toBe(0)
  })

  it('誰かがソロなら、ソロでない物は黙る', () => {
    expect(trackGain({ volume: 1 }, 1, true)).toBe(0)
    expect(trackGain({ volume: 1, solo: true }, 1, true)).toBe(1)
  })

  it('全体の音量が掛かる', () => {
    expect(trackGain({ volume: 0.5 }, 0.5, false)).toBe(0.25)
  })

  it('0〜1 に収める（掛け算ではみ出さない）', () => {
    expect(trackGain({ volume: 2 }, 2, false)).toBe(1)
    expect(trackGain({ volume: -1 }, 1, false)).toBe(0)
  })
})

describe('書き出すときの音量', () => {
  it('**ソロは効かせない**（BGMだけソロにしたまま書き出して全部無音、を防ぐ）', () => {
    // ソロはモニタリング専用の約束（プレミアでも各DAWでも同じ）
    expect(trackGainForExport({ volume: 1 }, 1)).toBe(1)
    expect(trackGainForExport({ volume: 1, solo: true }, 1)).toBe(1)
  })

  it('ミュートと音量は効く', () => {
    expect(trackGainForExport({ muted: true }, 1)).toBe(0)
    expect(trackGainForExport({ volume: 0.4 }, 1)).toBeCloseTo(0.4)
  })

  it('状態が無ければ、そのまま鳴らす（聴くときと同じ）', () => {
    expect(trackGainForExport(undefined, 1)).toBe(1)
  })
})

describe('聴くときと書き出すときで食い違わない', () => {
  it('**ソロが1つも無ければ、2つは必ず同じ答えを返す**', () => {
    // ここが崩れると「聴いた音と出てきた音が違う」になる。
    // ソロを使っていない普段の編集では、必ず一致していなければならない
    const states = [
      undefined,
      {},
      { volume: 0 },
      { volume: 0.3 },
      { volume: 1 },
      { muted: true },
      { muted: true, volume: 0.5 }
    ]
    for (const st of states)
      for (const master of [0, 0.5, 1])
        expect(trackGain(st, master, false), JSON.stringify({ st, master })).toBe(
          trackGainForExport(st, master)
        )
  })
})
