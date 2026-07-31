// 利用者がいじった物の持ち出し。
//
// **間違えると「設定が消えた」か「戻したら別の機械の設定で上書きされた」になる。**
// どちらも本人には理由が分からない壊れ方なので、規則をここで固定する。

import { describe, expect, it } from 'vitest'
import { changed, isUserKey, keysToRestore, pickUserData } from './userStore'

describe('どの鍵を残すか', () => {
  it('利用者がいじった物は残す', () => {
    for (const k of [
      'giftcut.seFavorites',
      'giftcut.myMotions',
      'giftcut.iconLibrary',
      'gc.videoTrackH'
    ]) {
      expect(isUserKey(k), k).toBe(true)
    }
  })
  it('関係ない鍵は残さない', () => {
    for (const k of ['theme', 'other.thing', '']) expect(isUserKey(k), k).toBe(false)
  })
  it('自動チェックが使う一時的な鍵は残さない', () => {
    expect(isUserKey('giftcut.e2e.probe')).toBe(false)
  })
  it('**一度きりの印は残さない**（控えから蘇ると挙動が変わる）', () => {
    // 更新で再起動した印。控えて次の起動で戻すと、更新していないのに
    // 「更新後の扱い」＝復元を聞かずに下書きを読む、になってしまう
    expect(isUserKey('giftcut.resumeAfterUpdate')).toBe(false)
  })
  it('消した機能の名残は残さない', () => {
    expect(isUserKey('giftcut.qa')).toBe(false)
    expect(isUserKey('giftcut.qa.open')).toBe(false)
  })
})

describe('抜き出し', () => {
  it('対象だけを、順番を揃えて取り出す（差分が出るのを防ぐ）', () => {
    const got = pickUserData({ 'giftcut.b': '2', zzz: 'x', 'giftcut.a': '1' })
    expect(Object.keys(got)).toEqual(['giftcut.a', 'giftcut.b'])
  })
})

describe('戻し方', () => {
  it('**いま入っている鍵は上書きしない**', () => {
    const got = keysToRestore({ 'giftcut.a': 'いま' }, { 'giftcut.a': 'ファイル' })
    expect(got).toEqual({})
  })
  it('無い鍵だけ戻す', () => {
    const got = keysToRestore({ 'giftcut.a': 'いま' }, { 'giftcut.a': 'x', 'giftcut.b': 'y' })
    expect(got).toEqual({ 'giftcut.b': 'y' })
  })
  it('壊れたファイルの変な値は入れない', () => {
    const got = keysToRestore({}, { 'giftcut.a': 123 as unknown as string, 'giftcut.b': 'ok' })
    expect(got).toEqual({ 'giftcut.b': 'ok' })
  })
  it('関係ない鍵はファイルにあっても入れない', () => {
    expect(keysToRestore({}, { evil: 'x' })).toEqual({})
  })
})

describe('書くかどうか', () => {
  it('同じなら書かない（画像を含むので毎回書くと重い）', () => {
    expect(changed({ a: '1' }, { a: '1' })).toBe(false)
  })
  it('値が違えば書く', () => {
    expect(changed({ a: '1' }, { a: '2' })).toBe(true)
  })
  it('数が違えば書く', () => {
    expect(changed({ a: '1' }, { a: '1', b: '2' })).toBe(true)
  })
})
