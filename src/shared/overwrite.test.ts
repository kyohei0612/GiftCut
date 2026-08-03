import { describe, it, expect } from 'vitest'
import { subtractRanges, isUntouched, overwriteCues } from './overwrite'

const R = (start: number, end: number): { start: number; end: number } => ({ start, end })

describe('重なった分を削る（上書き）', () => {
  it('触れていなければ、そのまま残る', () => {
    const p = subtractRanges(R(1, 2), [R(3, 4)])
    expect(p).toEqual([R(1, 2)])
    expect(isUntouched(R(1, 2), p)).toBe(true)
  })

  // 端がぴったり接しているのは「重なっていない」。ここを重なりと見ると、
  // 隙間なく並べたテロップが、置き直すたびに削られていく
  it('端が接しているだけなら削らない', () => {
    expect(subtractRanges(R(1, 2), [R(2, 3)])).toEqual([R(1, 2)])
    expect(subtractRanges(R(1, 2), [R(0, 1)])).toEqual([R(1, 2)])
  })

  // 本人が言っていたのはこれ。「1個目が2個目の頭に重なった」
  it('頭に食い込まれたら、その分だけ頭が削れる', () => {
    expect(subtractRanges(R(1, 3), [R(0.5, 2)])).toEqual([R(2, 3)])
  })

  it('尻に食い込まれたら、その分だけ尻が削れる', () => {
    expect(subtractRanges(R(1, 3), [R(2, 5)])).toEqual([R(1, 2)])
  })

  it('丸ごと覆われたら消える', () => {
    expect(subtractRanges(R(1, 3), [R(0, 5)])).toEqual([])
  })

  // **ここで片方を捨てると、残せたはずの文字が黙って消える。**
  it('真ん中を抜かれたら、左右2つに割れる', () => {
    expect(subtractRanges(R(0, 10), [R(4, 6)])).toEqual([R(0, 4), R(6, 10)])
  })

  it('複数に削られても、残りが正しく出る', () => {
    expect(subtractRanges(R(0, 10), [R(2, 3), R(6, 7)])).toEqual([R(0, 2), R(3, 6), R(7, 10)])
  })

  // 1コマにも満たない切れ端は、線にしか見えず掴むことも消すこともできない
  it('短すぎる残りは捨てる', () => {
    expect(subtractRanges(R(0, 10), [R(0.05, 10)])).toEqual([])
    expect(subtractRanges(R(0, 10), [R(0.5, 10)])).toEqual([R(0, 0.5)])
  })

  it('削る側が空なら、何も起きない', () => {
    const p = subtractRanges(R(1, 2), [])
    expect(isUntouched(R(1, 2), p)).toBe(true)
  })
})


// ここからは**並び全体の組み立て**。
//
// 「削りすぎて文字が消える」のが一番怖いのに、これまで**束ねる所だけが
// 画面側に居て、アプリを起動しないと確かめられなかった**（2026-08-03 に移した）。

type C = { id: number; start: number; end: number; track: string; text?: string }
const cue = (id: number, start: number, end: number, track = 'V2', text = ''): C => ({
  id, start, end, track, text
})
const run = (all: C[], win: number[], from = 100) => {
  let n = from
  return overwriteCues(all, win, (c) => c.track, () => n++)
}

describe('上書きしたあとの並び', () => {
  it('重なっていなければ null（呼ぶ側は書き換えない）', () => {
    expect(run([cue(1, 0, 1), cue(2, 2, 3)], [2])).toBeNull()
  })

  it('**段が違えば削らない**（重なって当然）', () => {
    expect(run([cue(1, 0, 5, 'V2'), cue(2, 1, 2, 'V3')], [2])).toBeNull()
  })

  it('端に食い込まれたら、そこだけ短くなる', () => {
    const r = run([cue(1, 0, 5), cue(2, 4, 6)], [2])!
    const a = r.find((c) => c.id === 1)!
    expect(a.start).toBe(0)
    expect(a.end).toBe(4)
    expect(r.length).toBe(2)
  })

  it('**真ん中を抜かれたら2つに割れる**（片方を捨てない）', () => {
    const r = run([cue(1, 0, 10), cue(2, 4, 6)], [2])!
    const parts = r.filter((c) => c.start < 4 || c.end > 6).filter((c) => c.id !== 2)
    expect(parts.length).toBe(2)
    expect(parts[0].start).toBe(0)
    expect(parts[0].end).toBe(4)
    expect(parts[1].start).toBe(6)
    expect(parts[1].end).toBe(10)
  })

  it('割れた**左側は元の id のまま**（選択や動きの行き先が変わらない）', () => {
    const r = run([cue(1, 0, 10), cue(2, 4, 6)], [2])!
    const left = r.find((c) => c.start === 0)!
    expect(left.id).toBe(1)
    const right = r.find((c) => c.start === 6)!
    expect(right.id).not.toBe(1)
  })

  it('割れた右側は中身を引き継ぐ（文字が消えない）', () => {
    const r = run([cue(1, 0, 10, 'V2', 'こんにちは'), cue(2, 4, 6)], [2])!
    for (const c of r.filter((x) => x.id !== 2)) expect(c.text).toBe('こんにちは')
  })

  it('**丸ごと覆われたら消える**（残骸を残さない）', () => {
    const r = run([cue(1, 2, 3), cue(2, 0, 10)], [2])!
    expect(r.map((c) => c.id)).toEqual([2])
  })

  it('置いた側そのものは削られない', () => {
    const r = run([cue(1, 0, 10), cue(2, 4, 6)], [2])!
    const w = r.find((c) => c.id === 2)!
    expect(w.start).toBe(4)
    expect(w.end).toBe(6)
  })

  it('置いた側が複数でも、全部が勝つ', () => {
    const r = run([cue(1, 0, 10), cue(2, 1, 2), cue(3, 5, 6)], [2, 3])!
    expect(r.filter((c) => c.id === 2 || c.id === 3).length).toBe(2)
    // 0-1 / 2-5 / 6-10 の3つに割れる
    expect(r.filter((c) => c.id !== 2 && c.id !== 3).length).toBe(3)
  })

  it('**時刻の順に並べ直す**（割れた分が後ろに付いたままにしない）', () => {
    const r = run([cue(1, 0, 10), cue(2, 4, 6)], [2])!
    const starts = r.map((c) => c.start)
    expect([...starts].sort((a, b) => a - b)).toEqual(starts)
  })

  it('切れ端が短すぎるときは捨てる（線にしか見えない物を残さない）', () => {
    // 0-5 に 0.05-5 を置くと、左に 0.05 秒しか残らない（MIN_KEEP=0.1 未満）
    const r = run([cue(1, 0, 5), cue(2, 0.05, 5)], [2])!
    expect(r.map((c) => c.id)).toEqual([2])
  })

  it('新しい id は呼ぶ側が採る（採番の役はここに持たない）', () => {
    const seen: number[] = []
    let n = 500
    const r = overwriteCues([cue(1, 0, 10), cue(2, 4, 6)], [2], (c) => c.track, () => {
      seen.push(n)
      return n++
    })!
    expect(seen).toEqual([500])
    expect(r.some((c) => c.id === 500)).toBe(true)
  })

  it('置いた側が見つからなければ null', () => {
    expect(run([cue(1, 0, 10)], [999])).toBeNull()
  })
})
