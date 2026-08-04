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

// 乱数と切片づくりは ./timelineTestRandom（**3本とも使うので、写すと重複になる**）
import { mulberry32, randomSegs } from './timelineTestRandom'

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
