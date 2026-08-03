// 入力を何本にも分ける（split / asplit）。
//
// **ここを間違えると書き出しが丸ごと落ちる。** 同じ入力ラベルを2か所から直接
// 参照するとフィルタグラフが成立せず、ffmpeg が起動直後に止まる——
// つまり**画面では何も分からず、書き出して初めて出る**型。
//
// `main/exportRun.ts` の中にあったので、確かめるには実際に書き出すしか無かった。
// 文字列の置き換えだけなので `shared` へ出し、ここで固定する（2026-08-03）。

import { describe, expect, it } from 'vitest'
import { newLabelUses, resolveInputLabels, useA, useV } from './filterLabels'

describe('1本しか使わないとき', () => {
  it('**split しない**（余計な複製を挟むと、そのぶん書き出しが重くなる）', () => {
    const u = newLabelUses()
    const f = `${useV(u, 0)}trim=0:5[a]`
    expect(resolveInputLabels(u, f)).toBe('[0:v]trim=0:5[a]')
  })

  it('音も同じ', () => {
    const u = newLabelUses()
    expect(resolveInputLabels(u, `${useA(u, 2)}atrim=0:5[a]`)).toBe('[2:a]atrim=0:5[a]')
  })
})

describe('同じ入力を2本以上使うとき', () => {
  it('**先頭に split を足して、別々のラベルへ配る**', () => {
    const u = newLabelUses()
    const f = `${useV(u, 0)}trim=0:5[a];${useV(u, 0)}trim=5:9[b]`
    const got = resolveInputLabels(u, f)
    expect(got).toBe('[0:v]split=2[xV0_0][xV0_1];[xV0_0]trim=0:5[a];[xV0_1]trim=5:9[b]')
  })

  it('音は asplit（映像の split と別物）', () => {
    const u = newLabelUses()
    const f = `${useA(u, 1)}x;${useA(u, 1)}y`
    expect(resolveInputLabels(u, f)).toBe('[1:a]asplit=2[xA1_0][xA1_1];[xA1_0]x;[xA1_1]y')
  })

  it('3本でも足りる本数だけ分ける', () => {
    const u = newLabelUses()
    const f = [useV(u, 0), useV(u, 0), useV(u, 0)].join('|')
    const got = resolveInputLabels(u, f)
    expect(got.startsWith('[0:v]split=3[xV0_0][xV0_1][xV0_2];')).toBe(true)
    expect(got.endsWith('[xV0_0]|[xV0_1]|[xV0_2]')).toBe(true)
  })
})

describe('入力が混ざっても取り違えない', () => {
  it('**別々の入力は別々に数える**（1つにまとめると本数がずれてグラフが壊れる）', () => {
    const u = newLabelUses()
    const f = [useV(u, 0), useV(u, 1), useV(u, 0)].join('|')
    const got = resolveInputLabels(u, f)
    // 0番は2本、1番は1本
    expect(got).toContain('[0:v]split=2')
    expect(got).not.toContain('[1:v]split')
    expect(got).toContain('[1:v]|')
  })

  it('映像と音は別の数え台（同じ番号でもぶつからない）', () => {
    const u = newLabelUses()
    const f = `${useV(u, 0)}|${useA(u, 0)}`
    expect(resolveInputLabels(u, f)).toBe('[0:v]|[0:a]')
  })

  it('**仮の札が1つも残らない**（残ると ffmpeg が「知らないラベル」で落ちる）', () => {
    const u = newLabelUses()
    const f = [useV(u, 0), useV(u, 0), useA(u, 3), useV(u, 2)].join('|')
    expect(resolveInputLabels(u, f)).not.toMatch(/@[VA]\d+_\d+@/)
  })
})

describe('使っていない入力', () => {
  it('触られていない番号には、何も足さない', () => {
    const u = newLabelUses()
    const f = useV(u, 5)
    const got = resolveInputLabels(u, f)
    expect(got).toBe('[5:v]')
    expect(got).not.toContain('split')
  })

  it('1つも使っていなければ、元の文字列のまま', () => {
    expect(resolveInputLabels(newLabelUses(), '[0:v]null[v]')).toBe('[0:v]null[v]')
  })
})
