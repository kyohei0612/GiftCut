// **画面と書き出しが、同じ答えを返すか。**
//
// この試験の値打ちは最後の章にある。`overlayEnableExpr` が実際に返した式を
// 読み直して、画面側の判定（`isCueShowing`）と1コマずつ突き合わせる。
// どちらかを変えたら必ず赤くなる＝食い違ったまま出荷できない。

import { describe, expect, it } from 'vitest'
import { isCueShowing } from './cueWindow'
import { overlayEnableExpr } from './filterGraph'

describe('出ている窓', () => {
  it('始まりちょうどから出る', () => {
    expect(isCueShowing(1, 3, 1)).toBe(true)
  })

  it('始まる前は出ない', () => {
    expect(isCueShowing(1, 3, 0.999)).toBe(false)
  })

  it('**終わりちょうどでは出ない**（含めると隣り合う2枚が1コマ重なる）', () => {
    expect(isCueShowing(1, 3, 3)).toBe(false)
    expect(isCueShowing(1, 3, 2.999)).toBe(true)
  })

  it('隣り合う窓は、どの時刻でもちょうど1つだけ', () => {
    for (let t = 0; t <= 4; t += 0.1) {
      const n = [isCueShowing(1, 2, t), isCueShowing(2, 3, t)].filter(Boolean).length
      expect(n, `t=${t.toFixed(1)} で ${n} 枚`).toBeLessThanOrEqual(1)
    }
    // 継ぎ目に隙間が無いことも見る（片方には必ず入る）
    for (let t = 1; t < 3; t += 0.1) {
      expect(isCueShowing(1, 2, t) || isCueShowing(2, 3, t), `t=${t.toFixed(1)} が抜けた`).toBe(true)
    }
  })
})

// ここが本体。**画面側だけ先頭を 0秒 まで引き延ばしていた**ので、
// プレビューには出ているのに書き出した動画には無い、という食い違いが出ていた。
describe('画面と書き出しが一致する', () => {
  /** 返ってきた式を ffmpeg と同じ意味で読む（filterGraph.test.ts と同じ読み方） */
  function truthAt(expr: string, t: number): boolean {
    const m = expr.match(/^gte\(t\\,([\d.]+)\)\*lt\(t\\,([\d.]+)\)$/)
    if (!m) throw new Error('見たことのない式: ' + expr)
    return t >= Number(m[1]) && t < Number(m[2])
  }

  it('どの時刻でも、画面の判定と書き出しの式が同じ答えになる', () => {
    // 頭に寄ったテロップ（自動字幕でよく出る形）も含めて見る
    const cues = [
      { start: 0, end: 1 },
      { start: 0.1, end: 0.9 },
      { start: 0.5, end: 2 },
      { start: 1, end: 3 },
      { start: 12.345, end: 12.678 }
    ]
    for (const c of cues) {
      const expr = overlayEnableExpr(c.start, c.end)
      for (let t = 0; t <= 14; t += 1 / 60) {
        const t3 = Number(t.toFixed(3))
        expect(
          isCueShowing(c.start, c.end, t3),
          `start=${c.start} end=${c.end} t=${t3}`
        ).toBe(truthAt(expr, t3))
      }
    }
  })

  it('**頭に寄ったテロップを、画面が先回りして出さない**（前はここが食い違っていた）', () => {
    // 0.5秒から始まるテロップ。前は画面側だけ 0秒 から出していた
    expect(isCueShowing(0.5, 2, 0)).toBe(false)
    expect(truthAt(overlayEnableExpr(0.5, 2), 0)).toBe(false)
  })
})
