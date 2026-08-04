// クリップの端の扱い。
//
// **耳で確かめるしかなかった所**を、ここで固定する。
// 音がずれる・切ったのに元の所から鳴る、は全部この計算の間違い。

import { describe, expect, it } from 'vitest'
import { MIN_CLIP, shiftGroup, splitAt, toggleSelect, trimLeft, trimRight } from './clipEdit'

/** 5秒の音源のうち、1秒目から3秒ぶんを 10秒の位置に置いたクリップ */
const clip = { tStart: 10, duration: 3, srcOffset: 1, srcDur: 5 }

describe('右端を動かす', () => {
  it('伸ばせる', () => {
    expect(trimRight(clip, 14).duration).toBe(4)
  })

  it('**元の音の残りを超えて伸ばさない**（超えた分は無音になる）', () => {
    // 5秒の音源を1秒目から使っているので、残りは4秒
    expect(trimRight(clip, 99).duration).toBe(4)
  })

  it('潰れない', () => {
    expect(trimRight(clip, 10).duration).toBe(MIN_CLIP)
  })

  it('元の音の長さが分からないときは、上限を見ない', () => {
    expect(trimRight({ tStart: 0, duration: 1 }, 60).duration).toBe(60)
  })
})

describe('左端を動かす', () => {
  it('終わりは動かない', () => {
    const r = trimLeft(clip, 11)
    expect(r.tStart + r.duration).toBeCloseTo(13, 6)
  })

  it('**元の音のどこから使うかも一緒に動く**（忘れると中身がずれる）', () => {
    // 1秒ぶん右へ縮めたので、使い始めも1秒進む
    expect(trimLeft(clip, 11).srcOffset).toBeCloseTo(2, 6)
    // 0.5秒ぶん左へ伸ばしたので、使い始めは0.5秒戻る
    expect(trimLeft(clip, 9.5).srcOffset).toBeCloseTo(0.5, 6)
  })

  it('**元の音の頭より前へは戻せない**', () => {
    // 捨てているのは1秒ぶんだけ。それ以上は戻れない
    const r = trimLeft(clip, 0)
    expect(r.tStart).toBe(9)
    expect(r.srcOffset).toBe(0)
  })

  it('潰れない', () => {
    const r = trimLeft(clip, 99)
    expect(r.duration).toBeCloseTo(MIN_CLIP, 6)
  })
})

describe('分ける', () => {
  it('左右に分かれ、合計の長さは変わらない', () => {
    const r = splitAt(clip, 11)!
    expect(r.left.duration).toBeCloseTo(1, 6)
    expect(r.right.duration).toBeCloseTo(2, 6)
    expect(r.right.tStart).toBe(11)
  })

  it('**右側は、左で使った分だけ元の音の先から鳴る**', () => {
    // ここを忘れると、切ったのに両方が同じ所から鳴る
    expect(splitAt(clip, 11)!.right.srcOffset).toBeCloseTo(2, 6)
  })

  it('つなぎ目のフェードは外す（切れ目で音が沈むのを防ぐ）', () => {
    const r = splitAt(clip, 11)!
    expect(r.left.fadeOut).toBe(0)
    expect(r.right.fadeIn).toBe(0)
  })

  it('端に寄りすぎている所では分けない（掴めない欠片を作らない）', () => {
    expect(splitAt(clip, 10.01)).toBeNull()
    expect(splitAt(clip, 12.99)).toBeNull()
    expect(splitAt(clip, 99)).toBeNull()
  })
})

describe('Ctrl クリックの選び足し', () => {
  it('入っていなければ足す', () => {
    expect(toggleSelect([1, 2], 3)).toEqual([1, 2, 3])
  })

  it('入っていれば外す', () => {
    expect(toggleSelect([1, 2, 3], 2)).toEqual([1, 3])
  })

  it('同じ物を2回入れない（まとめて動かすとき二重にずれる）', () => {
    expect(toggleSelect(toggleSelect([1], 2), 2)).toEqual([1])
  })
})

describe('束をまとめてずらす（shiftGroup）', () => {
  // **段を変えるのは掴んだ1つだけ。** 全部を同じ段へ寄せると重なって壊れる。
  // 2026-08-04 まで useClipDrag に同じ12行が3回書いてあった。
  const list = [
    { id: 1, tStart: 10, track: 'A2' },
    { id: 2, tStart: 14, track: 'A2' },
    { id: 3, tStart: 20, track: 'A3' } // 束の外
  ]
  const base = new Map([
    [1, 10],
    [2, 14]
  ])

  it('束の中身だけ、同じだけずれる', () => {
    const out = shiftGroup(list, [1, 2], base, 2.5, 1, null)
    expect(out.map((c) => c.tStart)).toEqual([12.5, 16.5, 20])
  })

  it('**段が変わるのは掴んだ1つだけ**', () => {
    const out = shiftGroup(list, [1, 2], base, 0, 1, 'A4')
    expect(out.map((c) => c.track)).toEqual(['A4', 'A2', 'A3'])
  })

  it('落とし先が無ければ段は変えない', () => {
    const out = shiftGroup(list, [1, 2], base, 0, 1, null)
    expect(out.map((c) => c.track)).toEqual(['A2', 'A2', 'A3'])
  })

  it('**0より手前へは出さない**', () => {
    const out = shiftGroup(list, [1, 2], base, -100, 1, null)
    expect(out.map((c) => c.tStart)).toEqual([0, 0, 20])
  })

  it('**動かしている最中の値ではなく、掴んだ時の控えから測る**（流れていかない）', () => {
    const moved = [
      { id: 1, tStart: 99, track: 'A2' },
      { id: 2, tStart: 99, track: 'A2' }
    ]
    const out = shiftGroup(moved, [1, 2], base, 1, 1, null)
    expect(out.map((c) => c.tStart)).toEqual([11, 15])
  })
})
