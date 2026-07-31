// 聞き取りの出力の読み取り。
//
// **読めない行が混ざるのが普通**（進み具合・版の表示・空の区間）。
// そこで止まると字幕が1枚も出ないので、捨てる物と拾う物を固定しておく。

import { describe, expect, it } from 'vitest'
import { parseWhisperLine, parseWhisperOut } from './whisperOut'

describe('1行を読む', () => {
  it('時刻と文字を取り出す', () => {
    const s = parseWhisperLine('[00:00:01.000 --> 00:00:03.240]   こんにちは')
    expect(s).toEqual({ start: 1, end: 3.24, text: 'こんにちは' })
  })
  it('時・分もまたぐ', () => {
    const s = parseWhisperLine('[01:02:03.500 --> 01:02:04.000]  あ')
    expect(s?.start).toBeCloseTo(3723.5, 3)
  })
  it('小数点がカンマでも読める（版によって違う）', () => {
    expect(parseWhisperLine('[00:00:01,000 --> 00:00:02,000] あ')?.start).toBeCloseTo(1, 6)
  })
  it('**文字が無い行は字幕にしない**（無音の区間）', () => {
    expect(parseWhisperLine('[00:00:01.000 --> 00:00:02.000]   ')).toBeNull()
  })
  it('逆さま・0秒は捨てる', () => {
    expect(parseWhisperLine('[00:00:02.000 --> 00:00:01.000] あ')).toBeNull()
    expect(parseWhisperLine('[00:00:02.000 --> 00:00:02.000] あ')).toBeNull()
  })
  it('関係ない行は null（進み具合や版の表示で止まらない）', () => {
    for (const s of ['whisper_init_from_file', 'progress = 42%', '', '---']) {
      expect(parseWhisperLine(s), s).toBeNull()
    }
  })
})

describe('まとめて読む', () => {
  it('混ざっていても、時刻付きの行だけ拾う', () => {
    const out = parseWhisperOut(
      [
        'whisper_model_load: loading model',
        '[00:00:00.000 --> 00:00:02.000]  ひとつめ',
        'progress = 50%',
        '[00:00:02.000 --> 00:00:04.000]  ふたつめ',
        ''
      ].join('\n')
    )
    expect(out.map((x) => x.text)).toEqual(['ひとつめ', 'ふたつめ'])
  })
})
