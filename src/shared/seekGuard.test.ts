// シークの頼み直しを止める決まり。
//
// この壊れ方は**目で見ても分からない**（再生ヘッドは動き続けるし、コマ落ちも0で出る）。
// 記録を測って初めて「切片10個なのにシーク30回」と分かった類なので、
// 条件そのものをここで固定する。

import { describe, expect, it } from 'vitest'
import { shouldSeek } from './seekGuard'

const el = (currentTime: number, seeking = false): { seeking: boolean; currentTime: number } => ({
  currentTime,
  seeking
})

describe('シークを頼んでよいか', () => {
  it('大きくずれていれば頼む', () => {
    expect(shouldSeek(el(10), 12, 0.25)).toBe(true)
  })

  it('しきい値の内側なら頼まない（毎コマ細かく飛ぶと、かえって固まる）', () => {
    expect(shouldSeek(el(10), 10.1, 0.25)).toBe(false)
  })

  it('**シーク中は、どれだけずれていても頼まない**', () => {
    // ここが本体。着く前に書くと前の依頼が取り消され、永久に追いつけない
    expect(shouldSeek(el(10, true), 99, 0.25)).toBe(false)
    expect(shouldSeek(el(10, true), 10.3, 0.25)).toBe(false)
  })

  it('シークが着いたら、また頼めるようになる', () => {
    const v = el(10, true)
    expect(shouldSeek(v, 20, 0.25)).toBe(false)
    v.seeking = false
    expect(shouldSeek(v, 20, 0.25)).toBe(true)
  })

  it('狙いの位置が数でなければ頼まない（壊れた値で飛ばさない）', () => {
    expect(shouldSeek(el(10), Number.NaN, 0.25)).toBe(false)
  })

  it('相手が居なくても落ちない', () => {
    expect(shouldSeek(null, 5, 0.25)).toBe(false)
    expect(shouldSeek(undefined, 5, 0.25)).toBe(false)
  })
})
