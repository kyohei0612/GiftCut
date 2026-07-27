// ============================================================================
// タイムライン時間計算の不変条件テスト
//
// 目的は「個別のバグを1つ直す」ことではなく、ズレという型ごと閉じ込めること。
// ランダムなプロジェクトを大量に生成して、成り立っていなければならない性質
// （切片が隙間なく並ぶ / 往復変換が元に戻る / 端点がぴったり一致する）を検証する。
//
//   npm test          1回実行
//   npm run test:watch  変更を監視
// ============================================================================
import { describe, expect, it } from 'vitest'
import {
  EPS,
  clamp,
  edgesBetween,
  fadeGain,
  rippleEnd,
  rippleShifted,
  rippleStart,
  formatTimecode,
  layoutSegs,
  moveSegTo,
  moveSegsTo,
  normFps,
  qFrame,
  segSpeed,
  segTLen,
  sourceToT,
  tToSource,
  totalSegLen,
  type SegOps,
  type TimeSeg,
  waveIndexAt,
  xfadeDurAt
} from './timeline'

// ---- 決定論的な擬似乱数（テストを再現可能にする。失敗を再現できないと直せない） ----
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** ランダムな切片列を作る。速度・尺・トランジションを混ぜる。 */
function randomSegs(rnd: () => number, n: number): TimeSeg[] {
  const segs: TimeSeg[] = []
  for (let i = 0; i < n; i++) {
    const srcStart = rnd() * 20
    const srcEnd = srcStart + 0.1 + rnd() * 10
    const speedRoll = rnd()
    segs.push({
      srcStart,
      srcEnd,
      // 等速を多めに、倍速/スローも混ぜる
      speed: speedRoll < 0.5 ? undefined : 0.25 + rnd() * 3.75,
      xfade: rnd() < 0.3 ? { dur: rnd() * 2 } : undefined
    })
  }
  return segs
}

// ===========================================================================
describe('segSpeed / segTLen', () => {
  it('速度未指定・0・負値はすべて等速として扱う（0除算とマイナス長を防ぐ）', () => {
    expect(segSpeed({ srcStart: 0, srcEnd: 1 })).toBe(1)
    expect(segSpeed({ srcStart: 0, srcEnd: 1, speed: 0 })).toBe(1)
    expect(segSpeed({ srcStart: 0, srcEnd: 1, speed: -2 })).toBe(1)
  })

  it('タイムライン長 = ソース尺 / 速度', () => {
    expect(segTLen({ srcStart: 0, srcEnd: 10 })).toBeCloseTo(10, 10)
    expect(segTLen({ srcStart: 0, srcEnd: 10, speed: 2 })).toBeCloseTo(5, 10)
    expect(segTLen({ srcStart: 0, srcEnd: 10, speed: 0.5 })).toBeCloseTo(20, 10)
    expect(segTLen({ srcStart: 4, srcEnd: 10, speed: 2 })).toBeCloseTo(3, 10)
  })

  it('srcEnd < srcStart（不正データ）でも負の長さを返さない', () => {
    expect(segTLen({ srcStart: 10, srcEnd: 4 })).toBe(0)
  })
})

// ===========================================================================
describe('layoutSegs の不変条件', () => {
  it('先頭は必ず 0 から始まる', () => {
    const L = layoutSegs([
      { srcStart: 3, srcEnd: 5 },
      { srcStart: 0, srcEnd: 2 }
    ])
    expect(L[0].tStart).toBe(0)
  })

  it('隙間なく連続する: tEnd[i] === tStart[i+1]（リップル前提の要）', () => {
    const rnd = mulberry32(1)
    for (let trial = 0; trial < 200; trial++) {
      const L = layoutSegs(randomSegs(rnd, 1 + Math.floor(rnd() * 12)))
      for (let i = 0; i + 1 < L.length; i++) {
        expect(L[i].tEnd).toBe(L[i + 1].tStart)
      }
    }
  })

  it('末尾の tEnd === 合計長（表示尺と実尺が食い違わない）', () => {
    const rnd = mulberry32(2)
    for (let trial = 0; trial < 200; trial++) {
      const segs = randomSegs(rnd, 1 + Math.floor(rnd() * 12))
      const L = layoutSegs(segs)
      expect(L[L.length - 1].tEnd).toBeCloseTo(totalSegLen(segs), 9)
    }
  })

  it('各切片の len は単調増加する tStart と整合（len === tEnd - tStart）', () => {
    const rnd = mulberry32(3)
    const L = layoutSegs(randomSegs(rnd, 20))
    for (const l of L) expect(l.len).toBeCloseTo(l.tEnd - l.tStart, 12)
  })

  it('空の切片列は空のレイアウトを返す（クラッシュしない）', () => {
    expect(layoutSegs([])).toEqual([])
    expect(totalSegLen([])).toBe(0)
  })

  it('seg の具体型を保つ（Layout<S> がジェネリック）', () => {
    const L = layoutSegs([{ srcStart: 0, srcEnd: 1, id: 42 }])
    // id が型として生きていること（コンパイルが通ることが検証）
    expect(L[0].seg.id).toBe(42)
  })
})

// ===========================================================================
describe('tToSource / sourceToT', () => {
  it('切片の頭ちょうどは srcStart を厳密に返す（±1F ズレの主因を封じる）', () => {
    const segs: TimeSeg[] = [
      { srcStart: 2, srcEnd: 6 },
      { srcStart: 10, srcEnd: 14, speed: 2 },
      { srcStart: 1, srcEnd: 3, speed: 0.5 }
    ]
    const L = layoutSegs(segs)
    for (const l of L) {
      const at = tToSource(L, l.tStart)
      expect(at).not.toBeNull()
      expect(at!.index).toBe(l.index)
      expect(at!.srcTime).toBeCloseTo(l.seg.srcStart, 12)
    }
  })

  it('末尾ちょうどは最後の切片の srcEnd を返す（再生終端）', () => {
    const L = layoutSegs([{ srcStart: 2, srcEnd: 6 }])
    const at = tToSource(L, 4)
    expect(at!.srcTime).toBeCloseTo(6, 12)
    expect(at!.index).toBe(0)
  })

  it('負の時刻と空レイアウトは null', () => {
    const L = layoutSegs([{ srcStart: 0, srcEnd: 5 }])
    expect(tToSource(L, -1)).toBeNull()
    expect(tToSource([], 0)).toBeNull()
  })

  it('末尾より先は最終フレームへ丸める（終端クランプ。null にはならない）', () => {
    // プレビューのシーク用なので、尺を超えた位置では「最後の絵」を出すのが正しい。
    // ただし呼び出し側は「終端ちょうど」と「大きく超えている」を区別できない。
    // 超過を検出したい処理は totalSegLen と比較すること。
    const L = layoutSegs([{ srcStart: 0, srcEnd: 5 }])
    for (const t of [5, 5.5, 100, 1e6]) {
      const at = tToSource(L, t)
      expect(at, `t=${t}`).not.toBeNull()
      expect(at!.srcTime).toBeCloseTo(5, 12)
      expect(at!.index).toBe(0)
    }
  })

  it('往復変換が元に戻る: tl → src → tl（速度の掛け忘れ/割り忘れを検出）', () => {
    const rnd = mulberry32(4)
    for (let trial = 0; trial < 500; trial++) {
      const segs = randomSegs(rnd, 1 + Math.floor(rnd() * 8))
      const L = layoutSegs(segs)
      const total = totalSegLen(segs)
      if (total <= 0) continue
      // 末尾ちょうどは srcEnd に丸める仕様なので、内部の点だけ検証する
      const t = rnd() * total * 0.999
      const at = tToSource(L, t)
      expect(at).not.toBeNull()
      const back = sourceToT(L, at!.index, at!.srcTime)
      expect(back).not.toBeNull()
      expect(back!).toBeCloseTo(t, 9)
    }
  })

  it('倍速でも速度が正しく反映される（2倍速はソース時間が2倍進む）', () => {
    const L = layoutSegs([{ srcStart: 0, srcEnd: 10, speed: 2 }])
    expect(tToSource(L, 0)!.srcTime).toBeCloseTo(0, 12)
    expect(tToSource(L, 1)!.srcTime).toBeCloseTo(2, 12)
    expect(tToSource(L, 2.5)!.srcTime).toBeCloseTo(5, 12)
    expect(tToSource(L, 1)!.speed).toBe(2)
  })

  it('タイムライン全域どこでも null にならない（再生が途中で止まらない）', () => {
    const rnd = mulberry32(5)
    for (let trial = 0; trial < 100; trial++) {
      const segs = randomSegs(rnd, 1 + Math.floor(rnd() * 10))
      const L = layoutSegs(segs)
      const total = totalSegLen(segs)
      if (total <= 0) continue
      for (let k = 0; k <= 40; k++) {
        const t = (total * k) / 40
        expect(tToSource(L, t), `t=${t} total=${total}`).not.toBeNull()
      }
    }
  })

  it('sourceToT は存在しない index で null（落ちない）', () => {
    const L = layoutSegs([{ srcStart: 0, srcEnd: 1 }])
    expect(sourceToT(L, 5, 0)).toBeNull()
  })
})

// ===========================================================================
describe('xfadeDurAt のクランプ', () => {
  it('B のソース頭の余白を超えない（余白が無ければ 0）', () => {
    // B は srcStart=0 → 先読みできる余白が無い → クロスディゾルブ不可
    const L = layoutSegs([
      { srcStart: 0, srcEnd: 10, xfade: { dur: 1 } },
      { srcStart: 0, srcEnd: 10 }
    ])
    expect(xfadeDurAt(L, 0)).toBe(0)
  })

  it('余白があれば指定長、足りなければ余白まで縮む', () => {
    const full = layoutSegs([
      { srcStart: 0, srcEnd: 10, xfade: { dur: 1 } },
      { srcStart: 5, srcEnd: 15 }
    ])
    expect(xfadeDurAt(full, 0)).toBeCloseTo(1, 9)

    const short = layoutSegs([
      { srcStart: 0, srcEnd: 10, xfade: { dur: 2 } },
      { srcStart: 0.4, srcEnd: 10 }
    ])
    expect(xfadeDurAt(short, 0)).toBeCloseTo(0.4, 9)
  })

  it('B の余白は速度で割る（2倍速なら余白も半分の時間しか稼げない）', () => {
    const L = layoutSegs([
      { srcStart: 0, srcEnd: 10, xfade: { dur: 5 } },
      { srcStart: 1, srcEnd: 11, speed: 2 }
    ])
    expect(xfadeDurAt(L, 0)).toBeCloseTo(0.5, 9)
  })

  it('A/B のタイムライン長を超えない', () => {
    const L = layoutSegs([
      { srcStart: 0, srcEnd: 0.3, xfade: { dur: 5 } },
      { srcStart: 9, srcEnd: 20 }
    ])
    expect(xfadeDurAt(L, 0)).toBeCloseTo(0.3, 9)
  })

  it('次の切片が無い/xfade が無いなら 0', () => {
    const L = layoutSegs([{ srcStart: 5, srcEnd: 10, xfade: { dur: 1 } }])
    expect(xfadeDurAt(L, 0)).toBe(0)
    const L2 = layoutSegs([
      { srcStart: 5, srcEnd: 10 },
      { srcStart: 5, srcEnd: 10 }
    ])
    expect(xfadeDurAt(L2, 0)).toBe(0)
  })

  it('実効長は必ず A/B の長さ以下（ランダム検証）', () => {
    const rnd = mulberry32(6)
    for (let trial = 0; trial < 400; trial++) {
      const L = layoutSegs(randomSegs(rnd, 2 + Math.floor(rnd() * 6)))
      for (let i = 0; i + 1 < L.length; i++) {
        const d = xfadeDurAt(L, i)
        expect(d).toBeGreaterThanOrEqual(0)
        expect(d).toBeLessThanOrEqual(L[i].len + EPS)
        expect(d).toBeLessThanOrEqual(L[i + 1].len + EPS)
      }
    }
  })
})

// ===========================================================================
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
describe('波形の写像', () => {
  it('端点がぴったり合う: t=0 → 0, t=audioDur → buckets', () => {
    expect(waveIndexAt(0, 10, 3000)).toBe(0)
    expect(waveIndexAt(10, 10, 3000)).toBeCloseTo(3000, 9)
  })

  it('線形（中間点は真ん中）', () => {
    expect(waveIndexAt(5, 10, 3000)).toBeCloseTo(1500, 9)
  })

  it('回帰: 動画の尺ではなく音声の実尺で写像する', () => {
    // 実測したファイル: 映像/音声/コンテナはどれも 35.300 と申告するが、
    // 実デコードした音声は 35.3067 秒だった。動画の尺で割ると末尾がバケット外へ出る。
    const audioDur = 35.306667
    const videoDur = 35.3
    const buckets = Math.round(audioDur * 300) // perSec=300

    // 正しい写像: 音声の末尾がちょうど末尾バケットに来る
    expect(waveIndexAt(audioDur, audioDur, buckets)).toBeCloseTo(buckets, 6)

    // 誤った写像（動画の尺で割る）は末尾を超え、しかもズレは 1 バケット以上ある
    const wrong = waveIndexAt(audioDur, videoDur, buckets)
    expect(wrong).toBeGreaterThan(buckets)
    expect(wrong - buckets).toBeGreaterThan(1)
  })

  it('ズレは時間に比例して増える（冒頭は合うのに後半だけ合わない、の説明）', () => {
    const audioDur = 35.306667
    const videoDur = 35.3
    const buckets = 10593
    const errAt = (t: number): number =>
      Math.abs(waveIndexAt(t, videoDur, buckets) - waveIndexAt(t, audioDur, buckets))
    // 冒頭はほぼ 0、末尾で最大
    expect(errAt(0)).toBeCloseTo(0, 9)
    expect(errAt(35)).toBeGreaterThan(errAt(1))
    expect(errAt(1)).toBeGreaterThan(errAt(0.1))
  })

  it('不正な尺/バケット数でも 0 を返す（NaN を描画に流さない）', () => {
    expect(waveIndexAt(1, 0, 100)).toBe(0)
    expect(waveIndexAt(1, -5, 100)).toBe(0)
    expect(waveIndexAt(1, 10, 0)).toBe(0)
    expect(Number.isNaN(waveIndexAt(1, NaN, 100))).toBe(false)
  })
})

// ===========================================================================
describe('フレーム量子化とタイムコード', () => {
  it('qFrame は冪等（2回かけても変わらない）', () => {
    const rnd = mulberry32(7)
    for (const fps of [24, 25, 30, 29.97, 50, 59.94, 60]) {
      for (let i = 0; i < 100; i++) {
        const t = rnd() * 600
        const a = qFrame(t, fps)
        expect(qFrame(a, fps)).toBeCloseTo(a, 12)
      }
    }
  })

  it('qFrame はフレームグリッド上に乗る', () => {
    for (const fps of [24, 30, 60]) {
      const q = qFrame(1.2345, fps)
      expect(Math.abs(q * fps - Math.round(q * fps))).toBeLessThan(1e-9)
    }
  })

  it('qFrame の誤差は半フレーム以内', () => {
    const rnd = mulberry32(8)
    for (const fps of [24, 29.97, 30, 60]) {
      for (let i = 0; i < 200; i++) {
        const t = rnd() * 1000
        expect(Math.abs(qFrame(t, fps) - t)).toBeLessThanOrEqual(0.5 / fps + 1e-12)
      }
    }
  })

  it('normFps は不正値をフォールバックに落とす', () => {
    expect(normFps(0)).toBe(30)
    expect(normFps(-1)).toBe(30)
    expect(normFps(NaN)).toBe(30)
    expect(normFps(undefined)).toBe(30)
    expect(normFps(null)).toBe(30)
    expect(normFps(Infinity)).toBe(30)
    expect(normFps(29.97)).toBeCloseTo(29.97, 9)
  })

  it('タイムコードの桁と繰り上がり', () => {
    expect(formatTimecode(0, 30)).toBe('00:00:00:00')
    expect(formatTimecode(1, 30)).toBe('00:00:01:00')
    expect(formatTimecode(61.5, 30)).toBe('00:01:01:15')
    expect(formatTimecode(3600, 30)).toBe('01:00:00:00')
    expect(formatTimecode(3661, 30)).toBe('01:01:01:00')
  })

  it('最終フレームで秒に繰り上がる（29/30 → 次の秒の 00 にならない）', () => {
    expect(formatTimecode(29 / 30, 30)).toBe('00:00:00:29')
    expect(formatTimecode(30 / 30, 30)).toBe('00:00:01:00')
  })

  it('負値と NaN でも壊れた文字列を返さない', () => {
    expect(formatTimecode(-5, 30)).toBe('00:00:00:00')
    expect(formatTimecode(0, 0)).toBe('00:00:00:00')
  })

  it('フレーム番号は必ず fps 未満', () => {
    const rnd = mulberry32(9)
    for (const fps of [24, 25, 29.97, 30, 59.94, 60]) {
      const r = Math.max(1, Math.round(fps))
      for (let i = 0; i < 200; i++) {
        const f = Number(formatTimecode(rnd() * 7200, fps).split(':')[3])
        expect(f).toBeLessThan(r)
        expect(f).toBeGreaterThanOrEqual(0)
      }
    }
  })
})

// ===========================================================================
describe('音声フェード', () => {
  it('フェードなしは常に 1', () => {
    expect(fadeGain(0, 10)).toBe(1)
    expect(fadeGain(5, 10)).toBe(1)
    expect(fadeGain(10, 10)).toBe(1)
  })

  it('フェードインは 0 → 1', () => {
    expect(fadeGain(0, 10, 2)).toBeCloseTo(0, 9)
    expect(fadeGain(1, 10, 2)).toBeCloseTo(0.5, 9)
    expect(fadeGain(2, 10, 2)).toBeCloseTo(1, 9)
    expect(fadeGain(5, 10, 2)).toBeCloseTo(1, 9)
  })

  it('フェードアウトは 1 → 0', () => {
    expect(fadeGain(8, 10, 0, 2)).toBeCloseTo(1, 9)
    expect(fadeGain(9, 10, 0, 2)).toBeCloseTo(0.5, 9)
    expect(fadeGain(10, 10, 0, 2)).toBeCloseTo(0, 9)
  })

  it('イン/アウトが重なっても 0..1 に収まる（谷が二重に掛からない）', () => {
    const rnd = mulberry32(10)
    for (let i = 0; i < 500; i++) {
      const len = 0.2 + rnd() * 5
      const fi = rnd() * len * 1.5
      const fo = rnd() * len * 1.5
      const t = rnd() * len
      const g = fadeGain(t, len, fi, fo)
      expect(g).toBeGreaterThanOrEqual(0)
      expect(g).toBeLessThanOrEqual(1)
      expect(Number.isNaN(g)).toBe(false)
    }
  })
})

// ===========================================================================
describe('clamp', () => {
  it('範囲に収める', () => {
    expect(clamp(-1, 0, 1)).toBe(0)
    expect(clamp(2, 0, 1)).toBe(1)
    expect(clamp(0.5, 0, 1)).toBe(0.5)
  })
})
