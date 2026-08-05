// 添付の判定。**この検査が空振りしたら、また「終了コード0の嘘」に戻る。**
//
// 実際に起きた3つの形を、そのまま並べてある（作り話の入力を使わない）。

import { describe, it, expect } from 'vitest'
import { checkAssets, describeVerdict, expectedAssets } from './releaseAssets'

const V = '0.1.23'
const full = [
  { name: `GiftCut-Setup-${V}.exe`, size: 121511999 },
  { name: `GiftCut-Setup-${V}.exe.blockmap`, size: 127224 },
  { name: 'latest.yml', size: 346 },
  // 差し替え（JS だけの更新）。2026-08-06 に足した
  { name: `bundle-${V}.zip`, size: 367000 },
  { name: `bundle-${V}.json`, size: 180 }
]

describe('Releases の添付が揃っているか', () => {
  it('全部揃っていれば通る（0.1.23 の2回目・実データ＋差し替え）', () => {
    expect(checkAssets(V, full).ok).toBe(true)
  })

  // **差し替えが無くても更新は動く**ので、上げ忘れても誰も困らない……
  // ように見えて、静かにインストーラの道へ落ちる。気づく機会が一度も無いまま
  // 「更新が十数秒かかる」に戻るので、ここで止める
  it('**差し替えだけ無い**を捕まえる（動いてしまうので、人には気づけない）', () => {
    const r = checkAssets(V, full.filter((a) => !a.name.startsWith('bundle-')))
    expect(r.ok).toBe(false)
    expect(r.missing).toEqual([`bundle-${V}.zip`, `bundle-${V}.json`])
  })

  it('**blockmap だけ無い**を捕まえる（0.1.23 の1回目・実データ）', () => {
    const r = checkAssets(V, full.filter((a) => !a.name.endsWith('.blockmap')))
    expect(r.ok).toBe(false)
    expect(r.missing).toEqual([`GiftCut-Setup-${V}.exe.blockmap`])
  })

  it('**blockmap だけ有る**を捕まえる（0.1.11 / 0.1.21 / 0.1.22 の1回目）', () => {
    const r = checkAssets(V, [{ name: `GiftCut-Setup-${V}.exe.blockmap`, size: 127224 }])
    expect(r.ok).toBe(false)
    expect(r.missing).toContain('latest.yml')
    expect(r.missing).toContain(`GiftCut-Setup-${V}.exe`)
  })

  it('**0バイトは「ある」に数えない**（自動更新が落としに行って失敗する）', () => {
    const r = checkAssets(V, full.map((a) => (a.name === 'latest.yml' ? { ...a, size: 0 } : a)))
    expect(r.ok).toBe(false)
    expect(r.empty).toEqual(['latest.yml'])
  })

  // **数で判定してはいけない。** 前の版の残骸が居ると数は足りてしまう
  it('前の版の添付が残っていても、数が足りたことにしない', () => {
    const r = checkAssets(V, [
      { name: `GiftCut-Setup-${V}.exe`, size: 121511999 },
      { name: 'GiftCut-Setup-0.1.22.exe', size: 121512034 },
      { name: 'GiftCut-Setup-0.1.22.exe.blockmap', size: 127000 },
      { name: 'latest.yml', size: 346 },
      { name: `bundle-${V}.zip`, size: 367000 },
      { name: `bundle-${V}.json`, size: 180 }
    ])
    expect(r.ok).toBe(false)
    expect(r.missing).toEqual([`GiftCut-Setup-${V}.exe.blockmap`])
  })

  it('空の一覧は当然だめ（発行そのものが走らなかった形）', () => {
    expect(checkAssets(V, []).missing).toEqual(expectedAssets(V))
  })

  it('あるべき名前は版から決まる（版を上げ忘れると気づける）', () => {
    expect(expectedAssets('1.2.3')).toEqual([
      'GiftCut-Setup-1.2.3.exe',
      'GiftCut-Setup-1.2.3.exe.blockmap',
      'latest.yml',
      'bundle-1.2.3.zip',
      'bundle-1.2.3.json'
    ])
  })

  // **知らせ方も試験する。** 「落ちたが理由が分からない」は、
  // 落ちない検査とほとんど同じくらい役に立たない
  it('だめな時は、何が無いかを名前で言う', () => {
    const msg = describeVerdict(V, checkAssets(V, []))
    expect(msg).toContain('latest.yml')
    expect(msg).toContain('もう一度')
  })

  it('よい時は短く済ませる（毎回の出力を汚さない）', () => {
    // **数は焼き込まない。** 「3つとも」と書いてあったせいで、
    // 差し替えを足した日に本体と試験の両方を直す羽目になった
    expect(describeVerdict(V, checkAssets(V, full))).toBe(
      `v${V}: 添付${expectedAssets(V).length}つとも揃っています`
    )
  })
})
