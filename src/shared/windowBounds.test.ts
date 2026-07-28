import { describe, it, expect } from 'vitest'
import { defaultBounds, fitToScreens, nextBounds, MIN_SIZE } from './windowBounds'

// よくある画面（作業領域＝タスクバーを除いた広さ）
const FHD = { x: 0, y: 0, width: 1920, height: 1032 }
const NOTE = { x: 0, y: 0, width: 1366, height: 728 }
const SUB_RIGHT = { x: 1920, y: 0, width: 1920, height: 1032 }

describe('初回に開く形', () => {
  it('1920 の画面では、後ろが少し見える大きさで真ん中に開く', () => {
    expect(defaultBounds(FHD)).toEqual({ x: 160, y: 56, width: 1600, height: 920 })
  })

  it('小さいノートでも画面からはみ出さない（既定サイズの方を縮める）', () => {
    const b = defaultBounds(NOTE)
    expect(b.width).toBeLessThanOrEqual(NOTE.width)
    expect(b.height).toBeLessThanOrEqual(NOTE.height)
    expect(b.x).toBeGreaterThanOrEqual(0)
    expect(b.y).toBeGreaterThanOrEqual(0)
  })

  it('画面が下限より狭くても、画面より大きくはしない', () => {
    const tiny = { x: 0, y: 0, width: 900, height: 600 }
    const b = defaultBounds(tiny)
    expect(b.width).toBe(900)
    expect(b.height).toBe(600)
  })
})

describe('前回の形を今の画面に収める', () => {
  it('収まっている窓はそのまま', () => {
    const b = { x: 100, y: 100, width: 1400, height: 800 }
    expect(fitToScreens(b, [FHD])).toEqual(b)
  })

  it('右へはみ出した窓は、画面の中へ寄せる（大きさは変えない）', () => {
    const b = { x: 1500, y: 100, width: 1400, height: 800 }
    expect(fitToScreens(b, [FHD])).toEqual({ x: 520, y: 100, width: 1400, height: 800 })
  })

  it('画面より大きい窓は、画面の大きさまで縮める', () => {
    const b = { x: 0, y: 0, width: 2400, height: 1400 }
    expect(fitToScreens(b, [NOTE])).toEqual({ x: 0, y: 0, width: 1366, height: 728 })
  })

  it('外したモニタに置いてあった窓は、拾わない（null）', () => {
    const b = { x: 2000, y: 100, width: 1400, height: 800 }
    expect(fitToScreens(b, [FHD])).toBeNull()
  })

  it('サブモニタが繋がっていれば、その位置のまま開く', () => {
    const b = { x: 2000, y: 100, width: 1400, height: 800 }
    expect(fitToScreens(b, [FHD, SUB_RIGHT])).toEqual(b)
  })

  it('2画面にまたがる窓は、重なりの大きい方へ収める', () => {
    // 1820..3220 → FHD と 100px、右画面と 1300px 重なる
    const b = { x: 1820, y: 100, width: 1400, height: 800 }
    expect(fitToScreens(b, [FHD, SUB_RIGHT])?.x).toBe(1920)
  })
})

describe('次に開く形', () => {
  it('記憶が無ければ既定の形', () => {
    expect(nextBounds(null, [FHD], FHD).bounds).toEqual(defaultBounds(FHD))
  })

  it('前回の形は、大きくても小さくても引き継ぐ', () => {
    const saved = { bounds: { x: 300, y: 40, width: 1200, height: 700 } }
    expect(nextBounds(saved, [FHD], FHD).bounds).toEqual(saved.bounds)
  })

  it('最大化して閉じたら、次も最大化で開く', () => {
    const saved = { bounds: { x: 0, y: 0, width: 1600, height: 900 }, maximized: true }
    expect(nextBounds(saved, [FHD], FHD).maximized).toBe(true)
  })

  it('画面構成が変わって前回の形を捨てたときは、最大化も引き継がない', () => {
    const saved = { bounds: { x: 2400, y: 0, width: 1600, height: 900 }, maximized: true }
    const r = nextBounds(saved, [NOTE], NOTE)
    expect(r.maximized).toBe(false)
    expect(r.bounds).toEqual(defaultBounds(NOTE))
  })

  it('壊れた記憶（0 や 負の大きさ）でも、掴める窓になる', () => {
    const saved = { bounds: { x: -5000, y: -5000, width: 0, height: 0 } }
    const b = nextBounds(saved, [FHD], FHD).bounds
    expect(b.width).toBeGreaterThanOrEqual(Math.min(MIN_SIZE.width, FHD.width))
    expect(b.height).toBeGreaterThanOrEqual(Math.min(MIN_SIZE.height, FHD.height))
  })
})
