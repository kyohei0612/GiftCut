// テロップの割り方。
//
// youtube-pipeline で実際に使っている規則を持ってきたので、
// **同じ入力で同じ割れ方**になることを固定する。
// ここが変わると、出来上がる動画の見た目がまるごと変わる。

import { describe, expect, it } from 'vitest'
import {
  MAX_CHARS,
  splitAtPauses,
  splitByParticle,
  splitCue,
  splitIntoSentences,
  splitTelopText,
  mergeShreds
} from './splitTelop'

describe('文で区切る', () => {
  it('！？で切る', () => {
    expect(splitIntoSentences('すごい！これは？うん')).toEqual(['すごい！', 'これは？', 'うん'])
  })
  it('。と、は空白にする（読みやすさのため。字幕に句読点は置かない）', () => {
    // 末尾の「。」由来の空白は、前後を詰めるときに落ちる
    expect(splitIntoSentences('あれは、そうだ。')).toEqual(['あれは そうだ'])
  })
  it('空文字は何も返さない', () => {
    expect(splitIntoSentences('   ')).toEqual([])
  })
})

describe('助詞で割る', () => {
  it('17文字までならそのまま', () => {
    const s = 'あいうえおかきくけこさしすせそた' // 16
    expect(splitByParticle(s)).toEqual([s])
  })
  it('**単語の途中で切らない**（助詞の後ろで切る）', () => {
    const parts = splitByParticle('きょうはとてもいい天気だからみんなで公園に行きました')
    expect(parts.length).toBeGreaterThan(1)
    for (const p of parts) expect([...p].length).toBeLessThanOrEqual(MAX_CHARS + 1)
    // つなげれば元に戻る（文字を落としていない）
    expect(parts.join('')).toBe('きょうはとてもいい天気だからみんなで公園に行きました')
  })
  it('短い断片を作らない（余りは前にくっつける）', () => {
    const parts = splitByParticle('あいうえおかきくけこさしすせそたちつて')
    for (const p of parts) expect(p.length).toBeGreaterThanOrEqual(2)
  })
  it('**手前すぎる助詞では切らない**（語の途中で裂けるのを防ぐ）', () => {
    // 実際に聞き取りを流して出た形。「入ってたら」が
    // 「これが入って」「たらびっくり…」と2枚に裂けていた
    const parts = splitByParticle('これが入ってたらびっくりしちゃうなとかじゃなくて')
    expect(parts[0]).not.toBe('これが入って')
    expect([...parts[0]].length).toBeGreaterThanOrEqual(10)
    expect(parts.join('')).toBe('これが入ってたらびっくりしちゃうなとかじゃなくて')
  })
  it('助詞が1つも無くても止まらない（上限で切る）', () => {
    const parts = splitByParticle('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789')
    expect(parts.length).toBeGreaterThan(1)
    expect(parts.join('')).toBe('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789')
  })
})

describe('文章をテロップへ', () => {
  it('文で切ってから、長い物を助詞で割る', () => {
    const out = splitTelopText('すごい！きょうはとてもいい天気だからみんなで公園に行きました')
    expect(out[0]).toBe('すごい！')
    expect(out.length).toBeGreaterThan(2)
  })
})

describe('間（ま）で割る', () => {
  // youtube-pipeline の品質記録より:
  // 「ナレが読み終わってないのにテロップが先に進んで違和感」＝1枚が1つの
  // 息継ぎ単位に対応していない（R-sync 違反）。実際の間で割ればこれが起きない。
  it('**黙った所で割れる**（1枚＝1つの息継ぎ）', () => {
    const out = splitAtPauses(
      { start: 0, end: 6, text: 'まえのはなしうしろのはなし' },
      [
        { start: 0, end: 2.5 },
        { start: 3.5, end: 6 }
      ]
    )
    expect(out.length).toBe(2)
    // 2枚目は、黙ったあとの喋り出しから始まる
    expect(out[1].start).toBeCloseTo(3.5, 3)
    expect(out.map((x) => x.text).join('')).toBe('まえのはなしうしろのはなし')
  })
  it('途中で黙っていなければ、今までどおり文字数で割る', () => {
    const out = splitAtPauses({ start: 0, end: 3, text: 'みじかい' }, [{ start: 0, end: 3 }])
    expect(out).toEqual([{ start: 0, end: 3, text: 'みじかい' }])
  })
  it('間で割った1つが長ければ、その中だけ文字数で分ける', () => {
    const out = splitAtPauses(
      {
        start: 0,
        end: 6,
        // 間で2つに割ってもなお、それぞれが17文字を超える長さにする
        text: 'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをんABCDEFGHIJ'
      },
      [
        { start: 0, end: 3 },
        { start: 3.5, end: 6 }
      ],
      17
    )
    for (const c of out) expect([...c.text].length).toBeLessThanOrEqual(18)
    // 間で2つ → それぞれがさらに割れて3枚以上
    expect(out.length).toBeGreaterThan(2)
  })
  it('喋りの区間が取れなくても壊れない', () => {
    const out = splitAtPauses({ start: 0, end: 3, text: 'あいうえお' }, [])
    expect(out.map((x) => x.text).join('')).toBe('あいうえお')
  })
})

describe('時刻付きで割る', () => {
  it('**文字数に応じて時間を分ける**', () => {
    const out = splitCue({ start: 0, end: 10, text: 'すごい！きょうはとてもいい天気だからみんなで公園に行きました' })
    expect(out.length).toBeGreaterThan(1)
    // 前から順に並び、間が空かない
    for (let i = 1; i < out.length; i++) expect(out[i].start).toBeCloseTo(out[i - 1].end, 6)
    expect(out[0].start).toBeCloseTo(0, 6)
    expect(out[out.length - 1].end).toBeCloseTo(10, 6)
  })
  it('割れない短い文はそのまま1枚', () => {
    const out = splitCue({ start: 1, end: 2, text: 'みじかい' })
    expect(out).toEqual([{ start: 1, end: 2, text: 'みじかい' }])
  })
  it('空文字なら何も作らない', () => {
    expect(splitCue({ start: 1, end: 2, text: '   ' })).toEqual([])
  })
})

describe('短すぎる札をくっつける（mergeShreds）', () => {
  const c = (start: number, end: number, text: string) => ({ start, end, text })

  it('続いている1〜2文字は前にくっつく', () => {
    const r = mergeShreds([c(0, 1, 'ランラン'), c(1, 1.5, 'ラン'), c(1.5, 2, 'ラ')])
    expect(r).toHaveLength(1)
    expect(r[0].text).toBe('ランランランラ')
    expect(r[0].end).toBe(2)
  })

  it('間が空いている短い札は触らない（言い切っただけかもしれない）', () => {
    const r = mergeShreds([c(0, 1, 'そうだね'), c(3, 3.5, 'これ')])
    expect(r).toHaveLength(2)
  })

  it('くっつけて上限を超えるならそのままにする', () => {
    const r = mergeShreds([c(0, 1, 'あ'.repeat(17)), c(1, 1.2, 'ね')], 17)
    expect(r).toHaveLength(2)
  })

  it('3文字以上は短すぎとみなさない', () => {
    const r = mergeShreds([c(0, 1, 'そうだね'), c(1, 1.3, 'なるほど')])
    expect(r).toHaveLength(2)
  })
})
