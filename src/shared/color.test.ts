import { describe, it, expect } from 'vitest'
import { alphaAt, hexToRgb, hsvToRgb, oklabLerp, rgbToHex, rgbToHsv } from './color'

// この試験の要点は「**統合前の2つが同じ答えを出すか**」。
//
// 統合前、`components/FillPicker`（画面）と `lib/telopSvg`（書き出し）に
// 同じ計算が別々に書かれていた。片方だけ直せば、**見た色と出来た色が
// 静かにズレる**。1本にした以上、その1本が両方の言い分を満たすことを押さえる。

describe('16進とRGBの行き来', () => {
  it('6桁を読む', () => {
    expect(hexToRgb('#ff8000')).toEqual({ r: 255, g: 128, b: 0 })
    expect(hexToRgb('336699')).toEqual({ r: 0x33, g: 0x66, b: 0x99 })
  })

  it('**3桁も読む**（統合前、書き出し側はこれを黒にしていた）', () => {
    expect(hexToRgb('#abc')).toEqual(hexToRgb('#aabbcc'))
    expect(hexToRgb('#f00')).toEqual({ r: 255, g: 0, b: 0 })
  })

  it('壊れた入力は黒（落ちない）', () => {
    expect(hexToRgb('')).toEqual({ r: 0, g: 0, b: 0 })
    expect(hexToRgb('#zzzzzz')).toEqual({ r: 0, g: 0, b: 0 })
  })

  it('往復しても変わらない', () => {
    for (const h of ['#000000', '#ffffff', '#ff8000', '#123456']) {
      const { r, g, b } = hexToRgb(h)
      expect(rgbToHex(r, g, b)).toBe(h)
    }
  })

  it('範囲の外は 00〜ff に収める（NaN を書き出さない）', () => {
    expect(rgbToHex(-20, 300, 128)).toBe('#00ff80')
  })
})

describe('HSV の行き来', () => {
  it('灰色は彩度0', () => {
    expect(rgbToHsv(128, 128, 128).s).toBe(0)
  })

  it('往復しても色が変わらない', () => {
    for (const [r, g, b] of [
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
      [255, 128, 0],
      [17, 34, 51]
    ]) {
      const { h, s, v } = rgbToHsv(r, g, b)
      const back = hsvToRgb(h, s, v)
      expect(Math.round(back.r)).toBe(r)
      expect(Math.round(back.g)).toBe(g)
      expect(Math.round(back.b)).toBe(b)
    }
  })
})

describe('不透明度の補間', () => {
  it('無い・空は不透明', () => {
    expect(alphaAt(undefined, 0.5)).toBe(1)
    expect(alphaAt([], 0.5)).toBe(1)
  })

  it('両端の外は端の値のまま（伸ばさない）', () => {
    const ops = [
      { opacity: 20, pos: 0.25 },
      { opacity: 80, pos: 0.75 }
    ]
    expect(alphaAt(ops, 0)).toBeCloseTo(0.2, 6)
    expect(alphaAt(ops, 1)).toBeCloseTo(0.8, 6)
  })

  it('間は線形', () => {
    const ops = [
      { opacity: 0, pos: 0 },
      { opacity: 100, pos: 1 }
    ]
    expect(alphaAt(ops, 0.5)).toBeCloseTo(0.5, 6)
    expect(alphaAt(ops, 0.25)).toBeCloseTo(0.25, 6)
  })

  it('**並び順が逆でも同じ**（位置で並べ直してから見る）', () => {
    const asc = [
      { opacity: 0, pos: 0 },
      { opacity: 100, pos: 1 }
    ]
    const desc = [...asc].reverse()
    for (const p of [0, 0.3, 0.5, 0.9, 1]) {
      expect(alphaAt(desc, p)).toBeCloseTo(alphaAt(asc, p), 6)
    }
  })

  it('同じ位置に2つあっても0で割らない', () => {
    const ops = [
      { opacity: 10, pos: 0.5 },
      { opacity: 90, pos: 0.5 }
    ]
    expect(Number.isFinite(alphaAt(ops, 0.5))).toBe(true)
  })
})

describe('oklab で混ぜる', () => {
  it('両端はその色のまま', () => {
    expect(oklabLerp('#ff0000', '#0000ff', 0)).toBe('#ff0000')
    expect(oklabLerp('#ff0000', '#0000ff', 1)).toBe('#0000ff')
  })

  it('同じ色どうしは動かない', () => {
    expect(oklabLerp('#3366aa', '#3366aa', 0.37)).toBe('#3366aa')
  })

  it('**途中でくすまない**（sRGB のまま混ぜるより明るい）', () => {
    // 金→銀のような明るい2色。sRGB の単純平均は目に暗く見えるため oklab を使う。
    const mid = hexToRgb(oklabLerp('#ffd700', '#c0c0c0', 0.5))
    const naive = {
      r: (0xff + 0xc0) / 2,
      g: (0xd7 + 0xc0) / 2,
      b: (0x00 + 0xc0) / 2
    }
    const lum = (c: { r: number; g: number; b: number }): number =>
      0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
    expect(lum(mid)).toBeGreaterThan(lum(naive))
  })

  it('t を増やすと片方へ寄っていく（行きつ戻りつしない）', () => {
    const d: number[] = []
    for (let t = 0; t <= 1.0001; t += 0.1) {
      const c = hexToRgb(oklabLerp('#000000', '#ffffff', t))
      d.push(c.r)
    }
    for (let i = 1; i < d.length; i++) expect(d[i]).toBeGreaterThanOrEqual(d[i - 1])
  })

  it('返すのは必ず7文字の16進（書き出しへそのまま置ける）', () => {
    for (const t of [0, 0.13, 0.5, 0.87, 1]) {
      expect(oklabLerp('#123456', '#fedcba', t)).toMatch(/^#[0-9a-f]{6}$/)
    }
  })
})
