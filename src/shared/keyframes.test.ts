import { describe, it, expect } from 'vitest'
import {
  valueAt,
  putKey,
  removeKey,
  keyAt,
  prevKeyTime,
  nextKeyTime,
  hasKeys,
  keysToExpr,
  sanitizeKeys,
  type Keys
} from './keyframes'

const K: Keys = [
  { t: 0, v: 1 },
  { t: 2, v: 2 }
]

describe('その時刻の値', () => {
  it('キーが無ければ固定値のまま', () => {
    expect(valueAt(undefined, 5, 1.5)).toBe(1.5)
    expect(valueAt([], 5, 1.5)).toBe(1.5)
  })
  it('キーが1つなら、ずっとその値', () => {
    expect(valueAt([{ t: 1, v: 3 }], 0, 1)).toBe(3)
    expect(valueAt([{ t: 1, v: 3 }], 99, 1)).toBe(3)
  })
  it('間はまっすぐつながる', () => {
    expect(valueAt(K, 0, 1)).toBe(1)
    expect(valueAt(K, 1, 1)).toBe(1.5)
    expect(valueAt(K, 2, 1)).toBe(2)
  })
  it('端より外は、端の値で止まる（プレミアと同じ）', () => {
    expect(valueAt(K, -5, 9)).toBe(1)
    expect(valueAt(K, 99, 9)).toBe(2)
  })
  it('hold は次のキーまで値を変えない（カクッと切り替わる）', () => {
    const k: Keys = [
      { t: 0, v: 1, e: 'hold' },
      { t: 2, v: 2 }
    ]
    expect(valueAt(k, 1.99, 0)).toBe(1)
    // **ちょうど次のキーの時刻で切り替わる。** ここを「まだ手前の値」にすると、
    // 書き出しの式と1フレームぶんズレる
    expect(valueAt(k, 2, 0)).toBe(2)
  })

  it('境目は次の区間として扱う（まっすぐつなぐ場合も同じ）', () => {
    const k: Keys = [
      { t: 0, v: 0 },
      { t: 1, v: 10 },
      { t: 2, v: 0 }
    ]
    expect(valueAt(k, 1, 0)).toBe(10)
  })
  it('なめらかは、真ん中でちょうど半分・両端がゆっくり', () => {
    const k: Keys = [
      { t: 0, v: 0, e: 'ease' },
      { t: 1, v: 10 }
    ]
    expect(valueAt(k, 0.5, 0)).toBeCloseTo(5)
    expect(valueAt(k, 0.25, 0)).toBeLessThan(2.5) // 出だしはゆっくり
    expect(valueAt(k, 0.75, 0)).toBeGreaterThan(7.5) // 終わりもゆっくり
  })
  it('キーが3つ以上でも、その区間だけを見る', () => {
    const k: Keys = [
      { t: 0, v: 0 },
      { t: 1, v: 10 },
      { t: 2, v: 0 }
    ]
    expect(valueAt(k, 0.5, 0)).toBeCloseTo(5)
    expect(valueAt(k, 1.5, 0)).toBeCloseTo(5)
  })
})

describe('キーの置き方・消し方', () => {
  it('置くと時刻順に並ぶ', () => {
    const k = putKey(putKey(undefined, 2, 20), 1, 10)
    expect(k.map((x) => x.t)).toEqual([1, 2])
  })
  it('同じ時刻に置き直すと、置き換わる（増えない）', () => {
    const k = putKey(putKey(undefined, 1, 10), 1, 99)
    expect(k).toHaveLength(1)
    expect(k[0].v).toBe(99)
  })
  it('消して0個になったら、固定値に戻す（undefined）', () => {
    expect(removeKey([{ t: 1, v: 1 }], 1)).toBeUndefined()
    expect(removeKey(K, 0)).toHaveLength(1)
  })
  it('その時刻にキーがあるか分かる（◆の点灯）', () => {
    expect(keyAt(K, 0)).toBeTruthy()
    expect(keyAt(K, 1)).toBeUndefined()
  })
  it('前後のキーへ移動できる', () => {
    expect(prevKeyTime(K, 1)).toBe(0)
    expect(nextKeyTime(K, 1)).toBe(2)
    expect(prevKeyTime(K, 0)).toBeNull()
    expect(nextKeyTime(K, 2)).toBeNull()
  })
  it('動きが付いているかが分かる', () => {
    expect(hasKeys(undefined)).toBe(false)
    expect(hasKeys([])).toBe(false)
    expect(hasKeys(K)).toBe(true)
  })
})

describe('ffmpeg の式（プレビューと同じ折れ線になること）', () => {
  // 式を実際に評価して、valueAt と一致するかを見る。
  // ここがズレると「プレビューでは動いたのに書き出したら動かない」になる。
  const evalExpr = (expr: string, t: number): number => {
    const js = expr
      .replace(/\bif\(/g, 'IF(')
      .replace(/\blt\(/g, 'LT(')
      .replace(/\bT\b/g, String(t))
    // eslint-disable-next-line no-new-func
    return new Function(
      'IF',
      'LT',
      't',
      `return ${js.replace(/\bt\b/g, String(t))}`
    )((c: boolean, a: number, b: number) => (c ? a : b), (a: number, b: number) => a < b, t)
  }


  // ---- ベジェ（Premiere / AE から写し取った動き）----
  //
  // 式では三次方程式を解けないので折れ線に潰している。**潰した式と、画面で
  // 見ている値が一致するか**がすべて。ここが開くと写し取った意味が無くなる。
  it('ベジェの区間も、式と画面の値が一致する', () => {
    const k: Keys = [
      { t: 0, v: 0, to: { speed: 0, influence: 1 / 3 } },
      { t: 1, v: 100, ti: { speed: 0, influence: 1 / 3 } }
    ]
    const expr = keysToExpr(k, 0, 't', 30)
    for (let t = 0; t <= 1.0001; t += 0.02) {
      expect(evalExpr(expr, t)).toBeCloseTo(valueAt(k, t, 0), 0)
    }
  })

  it('接線が付いていても、まっすぐな区間は式を刻まない（長くなるだけ）', () => {
    // 速度＝直線の傾き＝実質リニア。読み込んだ素材の6割がこれ
    const straight: Keys = [
      { t: 0, v: 0, to: { speed: 100, influence: 1 / 6 } },
      { t: 1, v: 100, ti: { speed: 100, influence: 1 / 6 } }
    ]
    const curvy: Keys = [
      { t: 0, v: 0, to: { speed: 0, influence: 1 / 3 } },
      { t: 1, v: 100, ti: { speed: 0, influence: 1 / 3 } }
    ]
    expect(keysToExpr(straight, 0, 't', 30).length).toBeLessThan(
      keysToExpr(curvy, 0, 't', 30).length / 4
    )
  })

  it('端は打った値そのもの（刻んでも動かない）', () => {
    const k: Keys = [
      { t: 0, v: 20, to: { speed: 0, influence: 0.5 } },
      { t: 2, v: 80, ti: { speed: 0, influence: 0.5 } }
    ]
    const expr = keysToExpr(k, 0, 't', 30)
    expect(evalExpr(expr, 0)).toBeCloseTo(20, 3)
    expect(evalExpr(expr, 2)).toBeCloseTo(80, 3)
  })

  it('キーが無ければ、ただの数', () => {
    expect(keysToExpr(undefined, 1.25, 't')).toBe('1.25')
  })

  it('まっすぐつなぐ式が、折れ線と一致する', () => {
    const expr = keysToExpr(K, 1, 't')
    for (let t = -0.5; t <= 3; t += 0.1) {
      expect(evalExpr(expr, t)).toBeCloseTo(valueAt(K, t, 1), 3)
    }
  })

  it('なめらかも一致する', () => {
    const k: Keys = [
      { t: 0, v: 1, e: 'ease' },
      { t: 2, v: 2 }
    ]
    const expr = keysToExpr(k, 1, 't')
    for (let t = 0; t <= 2; t += 0.1) {
      expect(evalExpr(expr, t)).toBeCloseTo(valueAt(k, t, 1), 3)
    }
  })

  it('hold も一致する（カクッと切り替わる）', () => {
    const k: Keys = [
      { t: 0, v: 1, e: 'hold' },
      { t: 1, v: 5 },
      { t: 2, v: 9 }
    ]
    const expr = keysToExpr(k, 0, 't')
    for (const t of [0, 0.5, 0.99, 1, 1.5, 2, 3]) {
      expect(evalExpr(expr, t)).toBeCloseTo(valueAt(k, t, 0), 3)
    }
  })

  it('時刻の変数名は呼ぶ側が決められる（zoompan は on/fps を使う）', () => {
    expect(keysToExpr(K, 1, '(on/30)')).toContain('(on/30)')
  })
})

describe('保存して開き直したとき、接線が残るか', () => {
  // **拾い忘れると、写し取った動きが開き直した瞬間にただの直線に戻る。**
  // しかも動いてはいるので、見ただけでは気づけない。
  it('接線を拾う', () => {
    const k = sanitizeKeys([
      { t: 0, v: 0, to: { speed: 3, influence: 0.25 } },
      { t: 1, v: 10, ti: { speed: 0, influence: 1 / 3 } }
    ])
    expect(k?.[0].to).toEqual({ speed: 3, influence: 0.25 })
    expect(k?.[1].ti?.speed).toBe(0)
  })
  it('壊れた接線は付けない（直線になるだけで落ちない）', () => {
    const k = sanitizeKeys([
      { t: 0, v: 0, to: { speed: 'x', influence: 0.25 } },
      { t: 1, v: 10, ti: null }
    ])
    expect(k?.[0].to).toBeUndefined()
    expect(k?.[1].ti).toBeUndefined()
    expect(k?.length).toBe(2)
  })
  it('影響は 0〜1 に収める', () => {
    const k = sanitizeKeys([{ t: 0, v: 0, to: { speed: 1, influence: 9 } }])
    expect(k?.[0].to?.influence).toBe(1)
  })
})
