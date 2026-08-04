// 切片の**移動**（プレミアの上書きドラッグ）と**リップル**。
//
// もとは `timeline.test.ts` 1本で 755行あった（決まり: 600超は500以下に割る）。
// 話題で3つに分けた——並び／移動／時間の写像。分け方は `./timeline.time.test.ts` の頭。
//
// **乱数と切片づくりは `./timelineTestRandom`**（3つとも使うので、写すと重複になる）。

import { describe, expect, it } from 'vitest'
import {
  EPS,
  edgesBetween,
  layoutSegs,
  moveSegTo,
  moveSegsTo,
  rippleEnd,
  rippleShifted,
  rippleStart,
  segTLen,
  totalSegLen,
  type SegOps,
  type TimeSeg
} from './timeline'
import { mulberry32, randomSegs } from './timelineTestRandom'

describe('切片の移動（プレミアの上書きドラッグ）', () => {
  // テスト用の切片。gap で空白かどうかを見分け、tag で「同じ切片か」を追う。
  interface T extends TimeSeg {
    tag?: string
    gap?: boolean
  }
  const ops: SegOps<T> = {
    split: (s, _part, srcStart, srcEnd) => ({ ...s, srcStart, srcEnd }),
    makeGap: (len) => ({ srcStart: 0, srcEnd: len, gap: true }),
    isGap: (s) => !!s.gap
  }
  /** 各切片の [開始, 終了, タグ] */
  const shape = (segs: T[]): [number, number, string][] =>
    layoutSegs(segs).map((L) => [
      Number(L.tStart.toFixed(6)),
      Number(L.tEnd.toFixed(6)),
      L.seg.tag ?? (L.seg.gap ? '空白' : '?')
    ])

  const abc = (): T[] => [
    { srcStart: 0, srcEnd: 10, tag: 'A' },
    { srcStart: 0, srcEnd: 10, tag: 'B' },
    { srcStart: 0, srcEnd: 10, tag: 'C' }
  ]

  it('後ろへ動かすと、元の位置は空白になり、他のクリップは動かない', () => {
    // A[0,10) B[10,20) C[20,30) の A を 30 へ
    const out = moveSegTo(abc(), 0, 30, ops)
    expect(shape(out)).toEqual([
      [0, 10, '空白'],
      [10, 20, 'B'],
      [20, 30, 'C'],
      [30, 40, 'A']
    ])
  })

  it('動かした先に居たクリップは上書きされる（後続の位置は変わらない）', () => {
    // A を 10 へ = B の居場所をまるごと踏む
    const out = moveSegTo(abc(), 0, 10, ops)
    expect(shape(out)).toEqual([
      [0, 10, '空白'],
      [10, 20, 'A'],
      [20, 30, 'C']
    ])
  })

  it('半分だけ重なると、重なった側は端をトリムされて残る', () => {
    const out = moveSegTo(abc(), 0, 15, ops)
    expect(shape(out)).toEqual([
      [0, 10, '空白'],
      [10, 15, 'B'], // 前半だけ残る
      [15, 25, 'A'],
      [25, 30, 'C'] // 後半だけ残る
    ])
  })

  it('末尾より先に置くと手前が空白で埋まる', () => {
    const out = moveSegTo(abc(), 0, 40, ops)
    expect(shape(out)).toEqual([
      [0, 10, '空白'],
      [10, 20, 'B'],
      [20, 30, 'C'],
      [30, 40, '空白'],
      [40, 50, 'A']
    ])
  })

  it('前へ動かすと、空になった末尾は詰められる（尺が伸びっぱなしにならない）', () => {
    // C[20,30) を 0 へ → A/B が上書きされ、末尾に残る空白は落ちる
    const out = moveSegTo(abc(), 2, 0, ops)
    expect(shape(out)).toEqual([
      [0, 10, 'C'],
      [10, 20, 'B']
    ])
    expect(totalSegLen(out)).toBeCloseTo(20, 9)
  })

  it('倍速クリップを上書きしても、切り口はソース秒に正しく換算される', () => {
    // B は 2倍速 = タイムライン10秒 ⇔ ソース20秒
    const segs: T[] = [
      { srcStart: 0, srcEnd: 10, tag: 'A' },
      { srcStart: 0, srcEnd: 20, speed: 2, tag: 'B' }
    ]
    const out = moveSegTo(segs, 0, 15, ops) // A を B の後半に重ねる
    const b = out.find((s) => s.tag === 'B')!
    // B の残りはタイムライン [10,15) の5秒ぶん = ソース 0〜10 秒
    expect(b.srcStart).toBeCloseTo(0, 9)
    expect(b.srcEnd).toBeCloseTo(10, 9)
    expect(segTLen(b)).toBeCloseTo(5, 9)
  })

  it('同じ位置へ動かしても配列は作り直さない（空振りで履歴を汚さない）', () => {
    const segs = abc()
    expect(moveSegTo(segs, 1, 10, ops)).toBe(segs)
    expect(moveSegTo(segs, 1, 10.00001, ops)).toBe(segs)
  })

  it('マイナス位置へ動かしても 0 で止まる', () => {
    const out = moveSegTo(abc(), 2, -5, ops)
    expect(layoutSegs(out)[0].tStart).toBe(0)
    expect(out[0].tag).toBe('C')
  })

  it('隣り合った空白は1つにまとまる（動かすたびに配列が伸びない）', () => {
    let segs = abc()
    // A→末尾、B→末尾 と2回動かしても、空白は先頭側にまとまって1つだけ
    segs = moveSegTo(segs, 0, 30, ops)
    segs = moveSegTo(segs, segs.findIndex((s) => s.tag === 'B'), 40, ops)
    expect(segs.filter((s) => s.gap)).toHaveLength(1)
    expect(shape(segs)).toEqual([
      [0, 20, '空白'],
      [20, 30, 'C'],
      [30, 40, 'A'],
      [40, 50, 'B']
    ])
  })

  it('複数まとめて動かすと、相対位置を保ったまま全部ずれる', () => {
    // A[0,10) B[10,20) C[20,30) の A と C を +30
    const out = moveSegsTo(abc(), [0, 2], 30, ops)
    expect(shape(out)).toEqual([
      [0, 10, '空白'],
      [10, 20, 'B'],
      [20, 30, '空白'],
      [30, 40, 'A'],
      [40, 50, '空白'],
      [50, 60, 'C']
    ])
  })

  it('まとめて動かしても、選んだ切片は1つずつしか残らない', () => {
    const out = moveSegsTo(abc(), [0, 1, 2], 15, ops)
    for (const tag of ['A', 'B', 'C']) {
      expect(out.filter((s) => s.tag === tag)).toHaveLength(1)
    }
    // 全部選んで +15 = 先頭に15秒の空白ができて全体が後ろへ
    expect(shape(out)).toEqual([
      [0, 15, '空白'],
      [15, 25, 'A'],
      [25, 35, 'B'],
      [35, 45, 'C']
    ])
  })

  it('左端に当たっても相対位置は崩れない（全員そろって止まる）', () => {
    // B と C を -15 → B は 0 未満になるので、ずれる量は -10 に丸められる
    const out = moveSegsTo(abc(), [1, 2], -15, ops)
    expect(shape(out)).toEqual([
      [0, 10, 'B'],
      [10, 20, 'C']
    ])
  })

  it('選択が1つのときは単体移動と完全に同じ結果になる', () => {
    const a = moveSegsTo(abc(), [0], 30, ops)
    const b = moveSegTo(abc(), 0, 30, ops)
    expect(shape(a)).toEqual(shape(b))
  })

  it('まとめて動かしても、切片は隙間なく連続したままになる', () => {
    const rnd = mulberry32(99)
    for (let iter = 0; iter < 200; iter++) {
      const base = randomSegs(rnd, 3 + Math.floor(rnd() * 4)).map((s, i) => ({
        ...s,
        xfade: undefined,
        tag: 'S' + i
      })) as T[]
      const idx = base.map((_, i) => i).filter(() => rnd() < 0.5)
      if (!idx.length) continue
      const out = moveSegsTo(base, idx, (rnd() - 0.3) * totalSegLen(base), ops)
      const lay = layoutSegs(out)
      for (let i = 1; i < lay.length; i++) {
        expect(lay[i].tStart).toBeCloseTo(lay[i - 1].tEnd, 9)
      }
      expect(out.every((s) => segTLen(s) > EPS)).toBe(true)
      // 選んだ切片は複製も消滅もしない
      for (const i of idx) {
        expect(out.filter((s) => s.tag === base[i].tag)).toHaveLength(1)
      }
    }
  })

  it('どこへ動かしても、切片は隙間なく連続したままになる', () => {
    const rnd = mulberry32(4242)
    for (let iter = 0; iter < 300; iter++) {
      const base = randomSegs(rnd, 2 + Math.floor(rnd() * 5)).map((s, i) => ({
        ...s,
        xfade: undefined, // 移動そのものの不変条件を見る
        tag: 'S' + i
      })) as T[]
      const idx = Math.floor(rnd() * base.length)
      const out = moveSegTo(base, idx, rnd() * (totalSegLen(base) * 1.5), ops)
      const lay = layoutSegs(out)
      for (let i = 1; i < lay.length; i++) {
        expect(lay[i].tStart).toBeCloseTo(lay[i - 1].tEnd, 9)
      }
      // 長さ0の切片も、末尾の空白も残らない
      expect(out.every((s) => segTLen(s) > EPS)).toBe(true)
      expect(out.length === 0 || !ops.isGap(out[out.length - 1])).toBe(true)
      // 動かした切片は必ず1つだけ残っている（複製も消滅もしない）
      expect(out.filter((s) => s.tag === base[idx].tag)).toHaveLength(1)
    }
  })
})

// ===========================================================================
describe('リップルトリムが止まる位置', () => {
  it('途中に編集点が無ければ切片の端まで削る（従来どおり）', () => {
    expect(rippleStart(0, 8, [])).toBe(0)
    expect(rippleEnd(3, 10, [])).toBe(10)
  })

  it('途中にテロップの端があればそこで止まる（テロップの巻き添え削除を防ぐ）', () => {
    // 切片頭0・テロップ[2,5]・再生ヘッド8 → [5,8] だけ削る
    expect(rippleStart(0, 8, [2, 5])).toBe(5)
    // 再生ヘッド3・テロップ[5,7]・切片尻10 → [3,5] だけ削る
    expect(rippleEnd(3, 10, [5, 7])).toBe(5)
  })

  it('編集点が複数あれば再生ヘッドに一番近いものを採る', () => {
    expect(rippleStart(0, 20, [2, 5, 9, 14])).toBe(14)
    expect(rippleEnd(0, 20, [2, 5, 9, 14])).toBe(2)
  })

  it('再生ヘッドが編集点の内側（テロップの上）にあっても、手前の端で止まる', () => {
    // テロップ[5,10]・再生ヘッド8。テロップの尻(10)は再生ヘッドより後ろなので対象外。
    // 手前の端＝テロップの頭(5)で止まるので、テロップは消えず短くなるだけ。
    expect(rippleStart(0, 8, [5, 10])).toBe(5)
  })

  it('切片の端ちょうどにある編集点は無視する（削る量が0になって無反応に見えるのを防ぐ）', () => {
    expect(rippleStart(0, 8, [0, 8])).toBe(0)
    expect(rippleEnd(3, 10, [3, 10])).toBe(10)
  })

  it('範囲外の編集点は影響しない', () => {
    expect(rippleStart(5, 8, [1, 2, 99])).toBe(5)
    expect(rippleEnd(3, 6, [1, 2, 99])).toBe(6)
  })

  it('削る範囲は必ず切片の内側に収まる（ランダム検証）', () => {
    const rnd = mulberry32(11)
    for (let i = 0; i < 500; i++) {
      const segStart = rnd() * 10
      const segEnd = segStart + 0.5 + rnd() * 20
      const playhead = segStart + rnd() * (segEnd - segStart)
      const edges = Array.from({ length: Math.floor(rnd() * 8) }, () => rnd() * 40)
      const a = rippleStart(segStart, playhead, edges)
      const b = rippleEnd(playhead, segEnd, edges)
      expect(a).toBeGreaterThanOrEqual(segStart)
      expect(a).toBeLessThanOrEqual(playhead)
      expect(b).toBeGreaterThanOrEqual(playhead)
      expect(b).toBeLessThanOrEqual(segEnd)
    }
  })

  it('edgesBetween は両端を含まない', () => {
    expect(edgesBetween([0, 5, 10], 0, 10)).toEqual([5])
  })
})

// ===========================================================================
describe('リップル削除で後続が詰まる位置', () => {
  it('同じトラックの、消した区間より後ろだけが詰まる', () => {
    const holes = [{ track: 'V2', start: 2, end: 5 }] // V2 の 3秒ぶんを削除
    expect(rippleShifted(holes, 'V2', 6)).toBeCloseTo(3, 9) // 後ろ → 詰まる
    expect(rippleShifted(holes, 'V2', 1)).toBeCloseTo(1, 9) // 前 → そのまま
  })

  it('別のトラックのものは動かない（V2を消してV3がずれない）', () => {
    const holes = [{ track: 'V2', start: 2, end: 5 }]
    expect(rippleShifted(holes, 'V3', 6)).toBeCloseTo(6, 9)
    expect(rippleShifted(holes, 'A2', 6)).toBeCloseTo(6, 9)
  })

  it('同じトラックで複数消しても、詰め量の合計が正しい', () => {
    // 消す順（配列の順）に関係なく同じ結果になること
    const holes = [
      { track: 'A2', start: 10, end: 12 },
      { track: 'A2', start: 2, end: 5 }
    ]
    expect(rippleShifted(holes, 'A2', 20)).toBeCloseTo(15, 9) // 3+2=5 詰まる
    expect(rippleShifted([...holes].reverse(), 'A2', 20)).toBeCloseTo(15, 9)
    expect(rippleShifted(holes, 'A2', 11)).toBeCloseTo(8, 9) // 穴の中は手前の穴ぶんだけ
  })

  it('トラックが混ざっていても、それぞれ自分のトラックぶんだけ詰まる', () => {
    const holes = [
      { track: 'V2', start: 0, end: 4 },
      { track: 'A2', start: 0, end: 1 }
    ]
    expect(rippleShifted(holes, 'V2', 10)).toBeCloseTo(6, 9)
    expect(rippleShifted(holes, 'A2', 10)).toBeCloseTo(9, 9)
  })

  it('詰めた結果がマイナスにならない', () => {
    const holes = [{ track: 'V2', start: 0, end: 100 }]
    expect(rippleShifted(holes, 'V2', 100)).toBe(0)
  })

  it('消した区間の直後にあったものは、その区間の開始位置へ来る', () => {
    const holes = [{ track: 'V2', start: 3, end: 7 }]
    expect(rippleShifted(holes, 'V2', 7)).toBeCloseTo(3, 9)
  })
})

// ===========================================================================
