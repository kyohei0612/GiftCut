// 「中身がある範囲」の出し方を固定する。
//
// **ここがズレると、書き出したテロップの位置がズレる。** しかも
// **プレビューは別の道を通るので、書き出してからしか分からない**——
// だから目視ではなくここで押さえる（`引き継ぎ-心臓の分け直し.md` の
// 「作り直しの前に網を張る」）。
import { describe, expect, it } from 'vitest'
import { opaqueBounds } from './opaqueBounds'

/** w×h の透明な絵を作り、`put` で好きな所を塗る道具 */
function canvas(w: number, h: number, put: (set: (x: number, y: number, a?: number) => void) => void) {
  const d = new Uint8ClampedArray(w * h * 4)
  put((x, y, a = 255) => {
    d[(y * w + x) * 4 + 3] = a
  })
  return d
}

describe('中身のある範囲を出す', () => {
  it('1画素だけ塗ったら、その1画素を含む枠になる（余白ぶんだけ広い）', () => {
    const d = canvas(100, 50, (set) => set(40, 20))
    // pad=0 なら、ちょうどその1画素
    expect(opaqueBounds(d, 100, 50, 0)).toEqual({ x: 40, y: 20, w: 1, h: 1 })
    // 既定の pad=2 なら上下左右へ2画素ずつ
    expect(opaqueBounds(d, 100, 50)).toEqual({ x: 38, y: 18, w: 5, h: 5 })
  })

  it('離れた2か所を塗ったら、両方を含む枠になる', () => {
    const d = canvas(100, 50, (set) => {
      set(10, 5)
      set(80, 40)
    })
    expect(opaqueBounds(d, 100, 50, 0)).toEqual({ x: 10, y: 5, w: 71, h: 36 })
  })

  it('**1画素も描かれていなければ null**（重ねる必要が無い＝入力ごと省ける）', () => {
    expect(opaqueBounds(canvas(20, 20, () => {}), 20, 20)).toBeNull()
  })

  it('**薄い画素も拾う**（しきい値を上げると、ぼかした影の裾が切れて絵が変わる）', () => {
    const d = canvas(60, 60, (set) => {
      set(30, 30, 255)
      set(5, 5, 1) // ほとんど見えないが、0 ではない
    })
    expect(opaqueBounds(d, 60, 60, 0)).toEqual({ x: 5, y: 5, w: 26, h: 26 })
  })

  it('**端に寄っていても画像からはみ出さない**（overlay の x/y が負になると位置がずれる）', () => {
    const d = canvas(40, 30, (set) => {
      set(0, 0)
      set(39, 29)
    })
    const b = opaqueBounds(d, 40, 30) // pad=2 だが、外へは出られない
    expect(b).toEqual({ x: 0, y: 0, w: 40, h: 30 })
  })

  it('全面が塗られていたら、そのまま全面（切り詰めても得はしないが壊れない）', () => {
    const d = canvas(16, 9, (set) => {
      for (let y = 0; y < 9; y++) for (let x = 0; x < 16; x++) set(x, y)
    })
    expect(opaqueBounds(d, 16, 9, 0)).toEqual({ x: 0, y: 0, w: 16, h: 9 })
  })

  /**
   * **これが本丸。** 切り詰めた絵を元の位置へ戻したとき、
   * 1画素も動いていないことを確かめる。
   *
   * 実際の書き出しでは
   *   ・切り詰めた PNG を `-i` で渡し
   *   ・`overlay=x=<枠.x>:y=<枠.y>` で戻す
   * ので、ここで確かめている足し算がそのまま ffmpeg の引数になる。
   */
  it('**切り詰めて元の位置へ戻すと、元の絵と1画素も変わらない**', () => {
    const W = 64
    const H = 48
    const src = canvas(W, H, (set) => {
      for (let y = 10; y < 20; y++) for (let x = 30; x < 50; x++) set(x, y, 128)
    })
    const b = opaqueBounds(src, W, H, 0)
    if (!b) throw new Error('枠が出ない')

    // 切り詰める（枠の中だけ写す）
    const cut = new Uint8ClampedArray(b.w * b.h * 4)
    for (let y = 0; y < b.h; y++) {
      for (let x = 0; x < b.w; x++) {
        const s = ((b.y + y) * W + (b.x + x)) * 4
        const t = (y * b.w + x) * 4
        for (let k = 0; k < 4; k++) cut[t + k] = src[s + k]
      }
    }
    // 元の位置へ戻す
    const back = new Uint8ClampedArray(W * H * 4)
    for (let y = 0; y < b.h; y++) {
      for (let x = 0; x < b.w; x++) {
        const s = (y * b.w + x) * 4
        const t = ((b.y + y) * W + (b.x + x)) * 4
        for (let k = 0; k < 4; k++) back[t + k] = cut[s + k]
      }
    }
    expect([...back]).toEqual([...src])
  })
})
