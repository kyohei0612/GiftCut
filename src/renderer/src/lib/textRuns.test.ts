// 部分装飾（文字の一部だけ色や大きさを変える指定）の計算。
//
// **打ち替えは日常操作なので、範囲がずれると色が隣の字へ移る。**
// しかも見た目は「なんとなく合っている」ので、気づくのはずっと後になる。

import { describe, expect, it } from 'vitest'
import { adjustRuns, runAtIndex, splitRunRemoving, styleWithRun } from './textRuns'
import { defaultTelopStyle } from './telopStyle'
import type { TextRun } from './telopStyle'

const run = (start: number, end: number, extra: Partial<TextRun> = {}): TextRun =>
  ({ start, end, ...extra }) as TextRun

describe('その位置に掛かっている指定を探す', () => {
  const runs = [run(0, 3, { color: '#f00' }), run(5, 8, { color: '#0f0' })]

  it('範囲の中なら見つかる', () => {
    expect(runAtIndex(runs, 1)?.color).toBe('#f00')
    expect(runAtIndex(runs, 6)?.color).toBe('#0f0')
  })

  it('**終わりの位置は含まない**（隣の字に色が移る）', () => {
    expect(runAtIndex(runs, 3)).toBeNull()
  })

  it('何も無ければ null', () => {
    expect(runAtIndex(undefined, 0)).toBeNull()
    expect(runAtIndex(runs, 4)).toBeNull()
  })

  it('重なっていたら後ろ勝ち（あとで塗った方）', () => {
    const r = [run(0, 5, { color: '#f00' }), run(2, 4, { color: '#00f' })]
    expect(runAtIndex(r, 3)?.color).toBe('#00f')
  })
})

describe('指定を土台のスタイルに重ねる', () => {
  const base = defaultTelopStyle()

  it('指定が無ければ土台のまま', () => {
    expect(styleWithRun(base, null)).toBe(base)
  })

  it('色を上書きする', () => {
    expect(styleWithRun(base, run(0, 1, { color: '#123456' })).fill.color).toBe('#123456')
  })

  it('**色を指定したらグラデーションは外す**（両方効くと結果が読めない）', () => {
    const withGrad = { ...base, fill: { ...base.fill, gradient: { from: '#000', to: '#fff' } } }
    const r = styleWithRun(withGrad as never, run(0, 1, { color: '#123456' }))
    expect(r.fill.gradient).toBeUndefined()
  })

  it('大きさは倍率で掛ける（元の数値は動かさない）', () => {
    const r = styleWithRun(base, run(0, 1, { sizeScale: 2 }))
    expect(r.fontSize).toBe(Math.round(base.fontSize * 2))
    expect(base.fontSize).not.toBe(r.fontSize)
  })
})

describe('範囲から一部を取り除く', () => {
  it('真ん中を抜くと2つに割れる', () => {
    const r = splitRunRemoving(run(0, 10), 3, 6)
    expect(r.map((x) => [x.start, x.end])).toEqual([
      [0, 3],
      [6, 10]
    ])
  })

  it('端を抜くと1つ残る', () => {
    expect(splitRunRemoving(run(0, 10), 0, 4).map((x) => [x.start, x.end])).toEqual([[4, 10]])
    expect(splitRunRemoving(run(0, 10), 6, 10).map((x) => [x.start, x.end])).toEqual([[0, 6]])
  })

  it('丸ごと抜けたら何も残らない', () => {
    expect(splitRunRemoving(run(2, 5), 0, 10)).toEqual([])
  })

  it('重なっていなければそのまま', () => {
    expect(splitRunRemoving(run(0, 3), 5, 8).map((x) => [x.start, x.end])).toEqual([[0, 3]])
  })
})

describe('文字を打ち替えたときに範囲をずらす', () => {
  it('前に字を足すと、後ろの指定も同じだけ動く', () => {
    const r = adjustRuns([run(3, 6)], 'あいうえおかき', 'XXあいうえおかき')
    expect(r?.[0].start).toBe(5)
    expect(r?.[0].end).toBe(8)
  })

  it('後ろに足しても、前の指定は動かない', () => {
    const r = adjustRuns([run(0, 3)], 'あいうえお', 'あいうえおXX')
    expect([r?.[0].start, r?.[0].end]).toEqual([0, 3])
  })

  it('**指定の中を消すと、その分だけ縮む**', () => {
    const r = adjustRuns([run(0, 5)], 'あいうえお', 'あいお')
    expect(r?.[0].end).toBeLessThan(5)
  })

  it('丸ごと消えたら指定も消える（宙に浮いた指定を残さない）', () => {
    const r = adjustRuns([run(2, 5)], 'あいうえお', 'あい')
    expect(r === undefined || r.length === 0).toBe(true)
  })

  it('中身が同じなら何も変えない', () => {
    const runs = [run(1, 4)]
    expect(adjustRuns(runs, 'あいうえお', 'あいうえお')?.[0]).toEqual(runs[0])
  })
})
