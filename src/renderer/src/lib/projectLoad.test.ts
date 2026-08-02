// 保存した物を開き直したとき、**黙って消える物が無いこと**を押さえる。
//
// ここで守っているのは全部「実際にやらかした」項目。
// 保存する側には書いたが読む側に書き忘れて、色や動きだけが静かに消えていた。
// エラーが出ないので、気づくのは何日も後になる。

import { describe, expect, it } from 'vitest'
import { loadCues, loadSegs, loadSeClips, loadMarkers, loadImgClips, loadVClips } from './projectLoad'

/** トラックはぜんぶ在る、という前提の受け皿 */
const asIs = (id: string): string => id

describe('テロップを読み直す', () => {
  it('id はファイルの値を信用せず振り直す', () => {
    // NaN と重複。そのまま使うと採番が汚れて、以後の追加が別の物を上書きする
    const r = loadCues([
      { id: NaN, start: 0, end: 1, text: 'あ' },
      { id: 1, start: 1, end: 2, text: 'い' },
      { id: 1, start: 2, end: 3, text: 'う' }
    ])
    expect(r.map((c) => c.id)).toEqual([1, 2, 3])
  })

  it('ラベルの色が消えない', () => {
    expect(loadCues([{ start: 0, end: 1, text: 'あ', label: 'red' }])[0].label).toBe('red')
  })

  it('打った動きが消えない', () => {
    // 印は項目ごとに持つ（tx=横に動かす）。t=秒、v=値
    const motion = { tx: [{ t: 0, v: 0 }, { t: 1, v: 100 }] }
    expect(loadCues([{ start: 0, end: 1, text: 'あ', motion }])[0].motion?.tx).toHaveLength(2)
  })

  it('部分装飾（runs）が消えない', () => {
    const runs = [{ start: 0, end: 2, bold: true }]
    expect(loadCues([{ start: 0, end: 1, text: 'あい', runs }])[0].runs).toHaveLength(1)
  })

  it('壊れた部分装飾は捨てる（終わりが始まりより前）', () => {
    // 1つも残らないときは「無い」ことにする（空の配列は「装飾あり」に見える）
    const runs = [{ start: 2, end: 1 }]
    expect(loadCues([{ start: 0, end: 1, text: 'あい', runs }])[0].runs).toBeUndefined()
  })

  it('位置が無ければ既定（下寄せ中央）にする', () => {
    expect(loadCues([{ start: 0, end: 1, text: 'あ' }])[0].pos).toEqual({ x: 0.5, y: 0.85 })
  })

  it('配列でなければ空にする（壊れたファイルで落ちない）', () => {
    expect(loadCues(undefined)).toEqual([])
    expect(loadCues('こわれている')).toEqual([])
  })
})

describe('動画の切片を読み直す', () => {
  it('速さは受け付けられる範囲へ収める', () => {
    // atempo は 0.5〜 しか受け付けない。範囲外のまま渡すと書き出しが落ちる
    expect(loadSegs([{ srcStart: 0, srcEnd: 1, speed: 0.1 }])[0].speed).toBe(0.5)
    expect(loadSegs([{ srcStart: 0, srcEnd: 1, speed: 99 }])[0].speed).toBe(8)
  })

  it('無調整の色は持たない（付いていないのと同じ）', () => {
    expect(loadSegs([{ srcStart: 0, srcEnd: 1, adjust: { b: 1, c: 1, s: 1 } }])[0].adjust).toBeUndefined()
  })

  it('ラベルの色が消えない', () => {
    expect(loadSegs([{ srcStart: 0, srcEnd: 1, label: 'blue' }])[0].label).toBe('blue')
  })

  it('古い形の色ディップを、いまの形へ読み替える', () => {
    const r = loadSegs([{ srcStart: 0, srcEnd: 1, transIn: { color: 'white', dur: 0.5 } }])
    expect(r[0].transIn).toEqual({ type: 'dipwhite', dur: 0.5 })
  })

  it('回り角は 0〜359 に畳む', () => {
    expect(loadSegs([{ srcStart: 0, srcEnd: 1, rotate: -90 }])[0].rotate).toBe(270)
  })
})

describe('効果音を読み直す', () => {
  it('声に合わせて下げる設定が消えない', () => {
    expect(loadSeClips([{ path: 'a.wav', tStart: 0, duration: 1, duck: true }])[0].duck).toBe(true)
  })

  it('名前が無ければパスから作る', () => {
    expect(loadSeClips([{ path: 'C:\\音\\ぽん.wav', tStart: 0, duration: 1 }])[0].name).toBe('ぽん.wav')
  })
})

describe('目印を読み直す', () => {
  it('時刻の無い物は捨てて、時刻の順に並べる', () => {
    const r = loadMarkers([{ t: 5 }, { label: '時刻なし' }, { t: 1, label: 'ここ' }])
    expect(r.map((m) => m.t)).toEqual([1, 5])
    expect(r[0].label).toBe('ここ')
  })
})

describe('画像・映像クリップを読み直す', () => {
  it('もう無いトラックは、在る物へ寄せる', () => {
    // 寄せないと、タイムラインに出ないのにプレビューと書き出しには出る
    const fix = (id: string): string => (id === 'V9' ? 'V3' : id)
    expect(loadImgClips([{ path: 'a.png', tStart: 0, track: 'V9' }], fix)[0].track).toBe('V3')
  })

  it('長さが入っていなければ既定の5秒にする', () => {
    expect(loadImgClips([{ path: 'a.png', tStart: 0 }], asIs)[0].duration).toBe(5)
  })

  it('パスの無い物は捨てる', () => {
    expect(loadImgClips([{ tStart: 0 }], asIs)).toEqual([])
  })

  it('映像クリップの打った動きが消えない', () => {
    // 映像の動きは 拡大(sc)・横(x)・縦(y) の3つ
    const motion = { sc: [{ t: 0, v: 1 }, { t: 1, v: 1.5 }] }
    const r = loadVClips([{ path: 'a.mp4', tStart: 0, srcStart: 0, srcEnd: 1, motion }], asIs)
    expect(r[0].motion?.sc).toHaveLength(2)
  })
})

// 「組」の番号は id と違って**振り直さない**（振り直すと種類をまたいだ番号が
// バラバラになって組がちぎれる）。壊れた値だけ捨てる。
describe('組の番号を読み直す', () => {
  it('id は振り直すが、組の番号はそのまま残る', () => {
    const r = loadCues([{ start: 0, end: 1, text: 'あ', group: 7 }])
    expect(r[0].id).toBe(1) // id は振り直す
    expect(r[0].group).toBe(7) // 組は触らない
  })

  it('種類をまたいで同じ番号が残る（段をまたぐ組が壊れない）', () => {
    const cue = loadCues([{ start: 0, end: 1, text: 'あ', group: 3 }])[0]
    const se = loadSeClips([{ path: 'a.wav', tStart: 0, duration: 1, group: 3 }])[0]
    const img = loadImgClips([{ path: 'a.png', tStart: 0, group: 3 }], asIs)[0]
    const vc = loadVClips([{ path: 'a.mp4', tStart: 0, srcStart: 0, srcEnd: 1, group: 3 }], asIs)[0]
    expect([cue.group, se.group, img.group, vc.group]).toEqual([3, 3, 3, 3])
  })

  it('壊れた値は捨てる', () => {
    const broken = [
      { start: 0, end: 1, text: 'あ', group: '7' },
      { start: 0, end: 1, text: 'い', group: 0 },
      { start: 0, end: 1, text: 'う', group: -1 },
      { start: 0, end: 1, text: 'え', group: 1.5 },
      { start: 0, end: 1, text: 'お' }
    ]
    expect(loadCues(broken).map((c) => c.group)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined
    ])
  })
})
