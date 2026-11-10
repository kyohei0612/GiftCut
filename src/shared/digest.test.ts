// 写しを先頭に並べる（ダイジェスト）の置き場所の計算。
import { describe, expect, it } from 'vitest'
import { digestPieces, placeInDigest } from './digest'

describe('digestPieces — 選んだ区間を先頭へ並べる', () => {
  it('選んだ順ではなく、元の時刻が早い順に、隙間なく 0 秒から並べる', () => {
    const { pieces, total } = digestPieces([
      { tStart: 30, tEnd: 35 },
      { tStart: 10, tEnd: 12 }
    ])
    expect(pieces).toEqual([
      { from: 10, to: 12, at: 0 },
      { from: 30, to: 35, at: 2 }
    ])
    expect(total).toBe(7)
  })

  it('隣り合う区間は1つに繋ぐ（またがるテロップを2枚に割らないため）', () => {
    const { pieces, total } = digestPieces([
      { tStart: 5, tEnd: 8 },
      { tStart: 8, tEnd: 9.5 }
    ])
    expect(pieces).toEqual([{ from: 5, to: 9.5, at: 0 }])
    expect(total).toBe(4.5)
  })

  it('長さの無い区間は数えない', () => {
    expect(digestPieces([{ tStart: 3, tEnd: 3 }])).toEqual({ pieces: [], total: 0 })
  })
})

describe('placeInDigest — 載っている物を先頭側へ写す', () => {
  const { pieces } = digestPieces([
    { tStart: 10, tEnd: 12 },
    { tStart: 30, tEnd: 35 }
  ])

  it('区間の中の物は、区間の頭からの位置を保って写る', () => {
    expect(placeInDigest(pieces, 10.5, 11.5)).toEqual({ start: 0.5, end: 1.5 })
    expect(placeInDigest(pieces, 31, 33)).toEqual({ start: 3, end: 5 })
  })

  it('尻がはみ出す物は、区間の終わりで切る（隣の見せ場の上に残らない）', () => {
    expect(placeInDigest(pieces, 11, 20)).toEqual({ start: 1, end: 2 })
  })

  it('頭が区間より前の物・選んでいない所の物・区間の終わりちょうどに始まる物は写さない', () => {
    expect(placeInDigest(pieces, 9, 11)).toBeNull()
    expect(placeInDigest(pieces, 20, 25)).toBeNull()
    expect(placeInDigest(pieces, 12, 14)).toBeNull()
  })

  it('切って短くなりすぎる物は写さない', () => {
    expect(placeInDigest(pieces, 11.98, 15)).toBeNull()
  })
})
