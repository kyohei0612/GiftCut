// 入力を何本にも分ける（split / asplit）。
//
// **ここを間違えると書き出しが丸ごと落ちる。** 同じ入力ラベルを2か所から直接
// 参照するとフィルタグラフが成立せず、ffmpeg が起動直後に止まる——
// つまり**画面では何も分からず、書き出して初めて出る**型。
//
// `main/exportRun.ts` の中にあったので、確かめるには実際に書き出すしか無かった。
// 文字列の置き換えだけなので `shared` へ出し、ここで固定する（2026-08-03）。

import { describe, expect, it } from 'vitest'
import { newLabelUses, resolveInputLabels, useA, useV, useVAt } from './filterLabels'

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

describe('窓付き（useVAt）は segment で配る', () => {
  // split は**全コマを全枝へコピー**する。カット600だと「デコードした全コマ×600枝」で、
  // 書き出しが実時間の1.74倍かかる件の入口側の扇だった（2026-08-09。骨組みの実測 13.9 → 3.2秒）。
  // segment は各コマを**該当する枝へだけ**送る。
  // わざと pickRouted を「常に空」へ戻すと、この describe の3件が赤くなる（確認済み・2026-08-09）
  it('**時間順で重ならない窓は、split ではなく segment で配る**', () => {
    const u = newLabelUses()
    const f = `${useVAt(u, 0, 0, 5)}trim=start=0.000:end=5.000[a];${useVAt(u, 0, 5, 9)}trim=start=5.000:end=9.000[b]`
    const got = resolveInputLabels(u, f)
    expect(got).toBe(
      '[0:v]segment=timestamps=5.000[xV0_0][xV0_1];[xV0_0]trim=start=0.000:end=5.000[a];[xV0_1]trim=start=5.000:end=9.000[b]'
    )
    expect(got).not.toContain('split')
  })

  it('**並べ替えられた窓も、境目は時間順で出す**（枝の対応は札のまま）', () => {
    const u = newLabelUses()
    // 出力順は B(10..12) → A(0..5) だが、source 時間では A が先
    const f = `${useVAt(u, 0, 10, 12)}x[b];${useVAt(u, 0, 0, 5)}y[a]`
    const got = resolveInputLabels(u, f)
    // 境目は「手前の窓の終わり」＝5.000 の1本。枝の並びは時間順（A=札1 が先）
    expect(got).toContain('[0:v]segment=timestamps=5.000[xV0_1][xV0_0];')
    expect(got).toContain('[xV0_0]x[b]')
    expect(got).toContain('[xV0_1]y[a]')
  })

  // ===========================================================================
  // **隙間のある並び**＝カット編集した実物。ここで止まっていた（2026-08-16）。
  //
  // 境目を「次の窓の始まり」に置くと、捨てた区間のコマが**手前の枝**へ落ちる。
  // 手前の trim は end を過ぎて完結しているので誰も汲まず、キューが詰まって
  // `segment` が次のコマを出せなくなる → 後ろの枝が永久に飢える。
  // 本人の書き出しは**最初のカット（15.44秒）で止まり、CPU だけ回っていた**。
  //
  // 「手前の窓の終わり」に置けば、同じコマは次の枝へ落ち、次の trim が
  // start まで汲んで捨てるので流れる。**出る絵は変わらない**（通すコマを
  // 決めるのは trim であって、境目ではない）。
  //
  // 08-09 に入れたとき見つからなかったのは、速さの照合に使った見本が
  // **隙間なく**切った並びだけだったから（上の1件目がまさにその形で、
  // 隙間が無いと新旧どちらの置き方でも同じ数字になる）。
  it('**隙間のある窓は、手前の終わりで切る**（次の始まりで切ると本物で止まる）', () => {
    const u = newLabelUses()
    // 5〜10秒は編集で捨てた区間。どちらの枝の trim も、ここを通さない
    const f = `${useVAt(u, 0, 0, 5)}trim=start=0.000:end=5.000[a];${useVAt(u, 0, 10, 12)}trim=start=10.000:end=12.000[b]`
    const got = resolveInputLabels(u, f)
    expect(got).toContain('[0:v]segment=timestamps=5.000[xV0_0][xV0_1];')
    // **捨てた区間の始まり（10.000）で切ってはいけない**
    expect(got).not.toContain('timestamps=10.000')
    expect(got).not.toContain('split')
  })

  it('隙間が何個あっても、境目は全部「手前の終わり」', () => {
    const u = newLabelUses()
    const f = [
      `${useVAt(u, 0, 0, 5)}A`,
      `${useVAt(u, 0, 8, 11)}B`,
      `${useVAt(u, 0, 20, 25)}C`
    ].join(';')
    expect(resolveInputLabels(u, f)).toContain(
      '[0:v]segment=timestamps=5.000|11.000[xV0_0][xV0_1][xV0_2];'
    )
  })

  it('**重なる窓（xfade の食い込み等）は split へ逃がす**（正しさが先、速さは後）', () => {
    const u = newLabelUses()
    // 2つ目の窓が 4.5 から＝1つ目の [0,5) と重なる → 全部 split（segment では配れない）
    const f = `${useVAt(u, 0, 0, 5)}x;${useVAt(u, 0, 4.5, 9)}y`
    const got = resolveInputLabels(u, f)
    expect(got).toContain('[0:v]split=2')
    expect(got).not.toContain('segment=')
  })

  it('**窓ありと窓なしが混ざったら、丸ごと split**（分けると止まる。理由は pickRouted）', () => {
    const u = newLabelUses()
    const f = `${useVAt(u, 0, 0, 5)}x;${useVAt(u, 0, 5, 9)}y;${useV(u, 0)}z`
    const got = resolveInputLabels(u, f)
    expect(got).toContain('[0:v]split=3')
    expect(got).not.toContain('segment=')
    expect(got).not.toMatch(/@[VA]\d+_\d+@/)
  })

  it('同じ所から始まる窓（複製）も、丸ごと split', () => {
    const u = newLabelUses()
    const f = `${useVAt(u, 0, 0, 5)}x;${useVAt(u, 0, 0, 5)}y;${useVAt(u, 0, 5, 9)}z`
    const got = resolveInputLabels(u, f)
    expect(got).toContain('[0:v]split=3')
    expect(got).not.toContain('segment=')
  })

  it('窓が1本だけなら segment にしない（従来どおり）', () => {
    const u = newLabelUses()
    const f = `${useVAt(u, 0, 0, 5)}x;${useV(u, 0)}y`
    const got = resolveInputLabels(u, f)
    expect(got).toContain('[0:v]split=2[xV0_0][xV0_1];')
    expect(got).not.toContain('segment=')
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
