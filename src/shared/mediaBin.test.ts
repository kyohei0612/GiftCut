import { describe, it, expect } from 'vitest'
import { mediaInUse, staleSourceIds, type BinRefs } from './mediaBin'

const empty: BinRefs = { sources: [], segments: [], seClips: [], imgClips: [], vClips: [] }
const A = 'C:\\動画\\a.mp4'
const B = 'C:\\動画\\b.mp4'

describe('素材が使用中かどうか', () => {
  it('報告された不具合: 本編の切片を全部消したら、元動画も消せる', () => {
    const refs: BinRefs = { ...empty, sources: [{ id: 1, path: A }], segments: [] }
    expect(mediaInUse(A, refs)).toBe(false)
    expect(staleSourceIds(A, refs)).toEqual([1])
  })

  it('切片が1つでも残っていれば使用中', () => {
    const refs: BinRefs = { ...empty, sources: [{ id: 1, path: A }], segments: [{ srcId: 1 }] }
    expect(mediaInUse(A, refs)).toBe(true)
    expect(staleSourceIds(A, refs)).toEqual([])
  })

  it('srcId 未指定の切片は主ソースを使っているとみなす', () => {
    const refs: BinRefs = { ...empty, sources: [{ id: 7, path: A }], segments: [{}] }
    expect(mediaInUse(A, refs)).toBe(true)
  })

  it('別の動画の切片が残っていても、使っていない方は消せる', () => {
    const refs: BinRefs = {
      ...empty,
      sources: [
        { id: 1, path: A },
        { id: 2, path: B }
      ],
      segments: [{ srcId: 1 }]
    }
    expect(mediaInUse(B, refs)).toBe(false)
    expect(staleSourceIds(B, refs)).toEqual([2])
    expect(mediaInUse(A, refs)).toBe(true)
  })

  it('同じ動画を二重登録していても、使っている登録は残す', () => {
    const refs: BinRefs = {
      ...empty,
      sources: [
        { id: 1, path: A },
        { id: 2, path: A }
      ],
      segments: [{ srcId: 2 }]
    }
    expect(mediaInUse(A, refs)).toBe(true)
    expect(staleSourceIds(A, refs)).toEqual([1])
  })

  it('SE・画像・映像レイヤーで使っていれば使用中', () => {
    expect(mediaInUse(A, { ...empty, seClips: [{ path: A }] })).toBe(true)
    expect(mediaInUse(A, { ...empty, imgClips: [{ path: A }] })).toBe(true)
    expect(mediaInUse(A, { ...empty, vClips: [{ path: A }] })).toBe(true)
  })

  it('どこにも出てこない素材は使用中ではない', () => {
    expect(mediaInUse(A, { ...empty, sources: [{ id: 1, path: B }], segments: [{}] })).toBe(false)
  })

  it('主ソースが別ファイルでも、切片が指しているのはそちら（取り違えない）', () => {
    // 主ソース=A、切片は srcId 未指定 → A を使用中。B は無関係
    const refs: BinRefs = {
      ...empty,
      sources: [
        { id: 1, path: A },
        { id: 2, path: B }
      ],
      segments: [{}]
    }
    expect(mediaInUse(A, refs)).toBe(true)
    expect(mediaInUse(B, refs)).toBe(false)
  })
})
