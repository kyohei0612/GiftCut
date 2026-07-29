import { describe, it, expect } from 'vitest'
import {
  zoomAt,
  hasClipMotion,
  sanitizeClipMotion,
  clipMotionKeyTimes,
  NEUTRAL_ZOOM,
  type ClipMotion,
  type Zoom
} from './clipMotion'

const Z: Zoom = { scale: 1.5, x: 0.1, y: -0.2 }

describe('その時刻の zoom', () => {
  // **ここが一番大事**: 印を1つも打っていないクリップは、今までと1ミリも
  // 変わってはいけない。動きを足したせいで既存のプロジェクトの見た目が
  // 変わったら、それは不具合。
  it('印が無ければ、いまの固定値をそのまま返す', () => {
    expect(zoomAt(Z, undefined, 0)).toEqual(Z)
    expect(zoomAt(Z, {}, 3)).toEqual(Z)
    expect(zoomAt(Z, { sc: [] }, 3)).toEqual(Z)
    expect(zoomAt(undefined, undefined, 3)).toEqual(NEUTRAL_ZOOM)
  })

  it('印が1つなら、ずっとその値', () => {
    const m: ClipMotion = { sc: [{ t: 1, v: 2 }] }
    expect(zoomAt(Z, m, 0).scale).toBe(2)
    expect(zoomAt(Z, m, 99).scale).toBe(2)
  })

  it('間はまっすぐつながる（0.5秒で1倍→2倍なら、0.25秒で1.5倍）', () => {
    const m: ClipMotion = {
      sc: [
        { t: 0, v: 1 },
        { t: 0.5, v: 2 }
      ]
    }
    expect(zoomAt(Z, m, 0).scale).toBe(1)
    expect(zoomAt(Z, m, 0.25).scale).toBe(1.5)
    expect(zoomAt(Z, m, 0.5).scale).toBe(2)
  })

  it('打っていない項目は、その項目の固定値のまま（拡大だけ動かしても位置は動かない）', () => {
    const m: ClipMotion = {
      sc: [
        { t: 0, v: 1 },
        { t: 1, v: 2 }
      ]
    }
    const at = zoomAt(Z, m, 0.5)
    expect(at.scale).toBe(1.5)
    expect(at.x).toBe(Z.x)
    expect(at.y).toBe(Z.y)
  })

  it('位置だけ打てば、拡大は固定値のまま', () => {
    const m: ClipMotion = {
      x: [
        { t: 0, v: 0 },
        { t: 2, v: 0.4 }
      ]
    }
    const at = zoomAt(Z, m, 1)
    expect(at.x).toBeCloseTo(0.2, 6)
    expect(at.scale).toBe(Z.scale)
  })

  // 1未満（引く）は zoompan で焼けない。**画面だけ引けてしまうと書き出しとズレる**ので、
  // 計算の側で止める（UI で防ぐだけにしない）。
  it('拡大の印が1未満でも、1で止まる', () => {
    const m: ClipMotion = {
      sc: [
        { t: 0, v: 1 },
        { t: 2, v: 0.2 }
      ]
    }
    expect(zoomAt(Z, m, 2).scale).toBe(1)
    expect(zoomAt(Z, m, 1).scale).toBe(1)
  })

  it('固定の zoom は 1未満のままでよい（従来どおり引ける）', () => {
    expect(zoomAt({ scale: 0.5, x: 0, y: 0 }, undefined, 0).scale).toBe(0.5)
    // 位置だけ動かしているときも、拡大は固定値（0.5）のまま
    const m: ClipMotion = {
      x: [
        { t: 0, v: 0 },
        { t: 1, v: 0.2 }
      ]
    }
    expect(zoomAt({ scale: 0.5, x: 0, y: 0 }, m, 1).scale).toBe(0.5)
  })
})

describe('動きが付いているか', () => {
  it('印が1つでもあれば付いている', () => {
    expect(hasClipMotion(undefined)).toBe(false)
    expect(hasClipMotion({})).toBe(false)
    expect(hasClipMotion({ sc: [] })).toBe(false)
    expect(hasClipMotion({ sc: [{ t: 0, v: 1 }] })).toBe(true)
    expect(hasClipMotion({ y: [{ t: 0, v: 0 }] })).toBe(true)
  })
})

describe('保存ファイルから読み直すときの検査', () => {
  it('形が違う物は「動き無し」に落ちる（落ちない）', () => {
    expect(sanitizeClipMotion(undefined)).toBeUndefined()
    expect(sanitizeClipMotion('x')).toBeUndefined()
    expect(sanitizeClipMotion({ sc: 'no' })).toBeUndefined()
    expect(sanitizeClipMotion({ sc: [{ t: 'a', v: 1 }] })).toBeUndefined()
  })

  it('拡大の1未満は 1 に直す（手で書き換えられても、打てない値は残さない）', () => {
    const m = sanitizeClipMotion({
      sc: [
        { t: 0, v: 0.3 },
        { t: 1, v: 2 }
      ]
    })
    expect(m?.sc?.map((k) => k.v)).toEqual([1, 2])
  })

  it('時刻の順に並べ直す', () => {
    const m = sanitizeClipMotion({
      x: [
        { t: 2, v: 0.2 },
        { t: 0, v: 0 }
      ]
    })
    expect(m?.x?.map((k) => k.t)).toEqual([0, 2])
  })
})

describe('打たれている印の時刻', () => {
  it('項目をまたいで重複なく集める', () => {
    const m: ClipMotion = {
      sc: [
        { t: 0, v: 1 },
        { t: 2, v: 2 }
      ],
      x: [
        { t: 0, v: 0 },
        { t: 1, v: 0.1 }
      ]
    }
    expect(clipMotionKeyTimes(m)).toEqual([0, 1, 2])
    expect(clipMotionKeyTimes(undefined)).toEqual([])
  })
})
