import { describe, it, expect } from 'vitest'
import {
  bezierAt,
  bezierValueAt,
  flattenBezier,
  isStraight,
  DEFAULT_INFLUENCE,
  type BezierKey
} from './bezierKeys'

const A = (over: Partial<BezierKey> = {}): BezierKey => ({ t: 0, v: 0, ...over })
const B = (over: Partial<BezierKey> = {}): BezierKey => ({ t: 1, v: 10, ...over })

describe('速度を渡さなければ直線', () => {
  it('端も中も直線どおり', () => {
    const a = A()
    const b = B()
    expect(bezierValueAt(a, b, 0)).toBeCloseTo(0, 6)
    expect(bezierValueAt(a, b, 0.5)).toBeCloseTo(5, 6)
    expect(bezierValueAt(a, b, 1)).toBeCloseTo(10, 6)
  })

  // **読み込んだ素材の多くがこれ。** 速度が直線の傾きと同じなら、影響を
  // どう変えても制御点が一直線に並ぶので直線になる。
  it('速度＝傾きなら、影響が 1/6 でも 1/3 でも直線', () => {
    for (const inf of [1 / 6, 1 / 3, 0.5]) {
      const a = A({ out: { speed: 10, influence: inf } })
      const b = B({ in: { speed: 10, influence: inf } })
      for (const t of [0.1, 0.25, 0.5, 0.75, 0.9]) {
        expect(bezierValueAt(a, b, t)).toBeCloseTo(t * 10, 4)
      }
      expect(isStraight(a, b)).toBe(true)
    }
  })
})

describe('速度を変えると曲がる', () => {
  it('出だしを止めると（速度0）、前半が遅れて後半で追いつく', () => {
    const a = A({ out: { speed: 0, influence: 1 / 3 } })
    const b = B({ in: { speed: 0, influence: 1 / 3 } })
    expect(bezierValueAt(a, b, 0.25)).toBeLessThan(2.5) // 直線なら 2.5
    expect(bezierValueAt(a, b, 0.5)).toBeCloseTo(5, 4) // 真ん中は対称なので変わらない
    expect(bezierValueAt(a, b, 0.75)).toBeGreaterThan(7.5)
    expect(isStraight(a, b)).toBe(false)
  })

  it('端は必ず打った値どおり（ここがずれると印の意味が無くなる）', () => {
    const a = A({ out: { speed: 0, influence: 0.9 } })
    const b = B({ in: { speed: 0, influence: 0.9 } })
    expect(bezierValueAt(a, b, 0)).toBe(0)
    expect(bezierValueAt(a, b, 1)).toBe(10)
  })

  it('時刻に対して戻らない（単調に進む）', () => {
    const a = A({ out: { speed: 0, influence: 0.5 } })
    const b = B({ in: { speed: 0, influence: 0.5 } })
    let prev = -Infinity
    for (let t = 0; t <= 1.0001; t += 0.01) {
      const v = bezierValueAt(a, b, t)
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9)
      prev = v
    }
  })
})

describe('全区間', () => {
  const keys: BezierKey[] = [
    { t: 0, v: 0 },
    { t: 1, v: 10, out: { speed: 0, influence: 1 / 3 } },
    { t: 2, v: 0, in: { speed: 0, influence: 1 / 3 } }
  ]
  it('キーが無ければ固定値', () => {
    expect(bezierAt([], 5, 1.5)).toBe(1.5)
  })
  it('端より外は端の値で止まる', () => {
    expect(bezierAt(keys, -1, 99)).toBe(0)
    expect(bezierAt(keys, 99, 99)).toBe(0)
  })
  it('打った時刻ではその値', () => {
    expect(bezierAt(keys, 0, 0)).toBe(0)
    expect(bezierAt(keys, 1, 0)).toBe(10)
    expect(bezierAt(keys, 2, 0)).toBe(0)
  })
})

describe('書き出し用に折れ線へ潰す', () => {
  // ffmpeg の式では三次方程式を解けないので刻む。
  // **どれくらい刻めば元と同じに見えるか**を、ここで測っておく。
  it('曲がった区間は fps の刻みで点が増える', () => {
    const keys: BezierKey[] = [
      { t: 0, v: 0, out: { speed: 0, influence: 1 / 3 } },
      { t: 1, v: 10, in: { speed: 0, influence: 1 / 3 } }
    ]
    const flat = flattenBezier(keys, 30)
    expect(flat.length).toBeGreaterThan(25)
    expect(flat[0]).toEqual({ t: 0, v: 0 })
    expect(flat[flat.length - 1]).toEqual({ t: 1, v: 10 })
  })

  it('直線の区間は刻まない（式が長くなるだけ損）', () => {
    const keys: BezierKey[] = [
      { t: 0, v: 0 },
      { t: 1, v: 10 }
    ]
    expect(flattenBezier(keys, 30)).toEqual([
      { t: 0, v: 0 },
      { t: 1, v: 10 }
    ])
  })

  it('潰した折れ線が、元のベジェと見分けが付かない（30fps で 1% 未満）', () => {
    const keys: BezierKey[] = [
      { t: 0, v: 0, out: { speed: 0, influence: 1 / 3 } },
      { t: 1, v: 100, in: { speed: 0, influence: 1 / 3 } }
    ]
    const flat = flattenBezier(keys, 30)
    const lerp = (t: number): number => {
      for (let i = 0; i < flat.length - 1; i++) {
        if (t >= flat[i].t && t <= flat[i + 1].t) {
          const k = (t - flat[i].t) / (flat[i + 1].t - flat[i].t || 1)
          return flat[i].v + (flat[i + 1].v - flat[i].v) * k
        }
      }
      return flat[flat.length - 1].v
    }
    let worst = 0
    for (let t = 0; t <= 1; t += 0.005) {
      worst = Math.max(worst, Math.abs(lerp(t) - bezierAt(keys, t, 0)))
    }
    // 値の幅は100なので、1未満＝1%未満
    expect(worst).toBeLessThan(1)
  })

  it('キーが1つなら、そのまま1点', () => {
    expect(flattenBezier([{ t: 2, v: 5 }], 30)).toEqual([{ t: 2, v: 5 }])
  })
})

describe('既定値', () => {
  it('影響の既定は Premiere と同じ 1/6', () => {
    expect(DEFAULT_INFLUENCE).toBeCloseTo(1 / 6, 10)
  })
})
