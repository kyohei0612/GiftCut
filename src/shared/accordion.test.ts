// 節の開け閉め。
//
// **一番よく使う所が、他を触るたびに畳まれる**という壊れ方をしていた。
// 画面を作らずに規則だけ試せるようにしてある（開け閉めは中身の量に左右されない）。

import { describe, expect, it } from 'vitest'
import { KEEP_OPEN_SEC, nextOpenSecs } from './accordion'

describe('1つだけ開くタブ（テロップ・アイコン）', () => {
  it('別の節を開くと、前のは閉じる', () => {
    expect(nextOpenSecs(['red'], 'blue', false)).toEqual(['blue'])
  })
  it('**お気に入りは道連れにしない**', () => {
    expect(nextOpenSecs([KEEP_OPEN_SEC], 'blue', false)).toEqual([KEEP_OPEN_SEC, 'blue'])
  })
  it('お気に入りが開いたまま、別の節を次々開ける', () => {
    const a = nextOpenSecs([KEEP_OPEN_SEC], 'red', false)
    const b = nextOpenSecs(a, 'blue', false)
    expect(b).toContain(KEEP_OPEN_SEC)
    expect(b).toContain('blue')
    expect(b).not.toContain('red')
  })
  it('お気に入りを自分で押せば閉じる（閉じる自由は残す）', () => {
    expect(nextOpenSecs([KEEP_OPEN_SEC, 'red'], KEEP_OPEN_SEC, false)).toEqual(['red'])
  })
  it('お気に入りを開くとき、他は閉じる（お気に入りだけ特別扱いしすぎない）', () => {
    expect(nextOpenSecs(['red'], KEEP_OPEN_SEC, false)).toEqual([KEEP_OPEN_SEC])
  })
})

describe('複数開けるタブ（素材ビン・効果音）', () => {
  it('足していく', () => {
    expect(nextOpenSecs(['video'], 'audio', true)).toEqual(['video', 'audio'])
  })
  it('もう一度押せば閉じる', () => {
    expect(nextOpenSecs(['video', 'audio'], 'video', true)).toEqual(['audio'])
  })
})
