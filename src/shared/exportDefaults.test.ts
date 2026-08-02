// 書き出しの既定値。**出来上がったファイルを調べないと分からない**類なので、
// ここで押さえる（4K の素材から 1080p が選ばれていても、画面では何も起きない）。

import { describe, expect, it } from 'vitest'
import {
  baseNameOf,
  joinOut,
  outputBaseName,
  resPFromHeight,
  uniqueName
} from './exportDefaults'

describe('素材の高さから書き出す段を選ぶ', () => {
  it('ちょうどの高さは、その段になる', () => {
    expect(resPFromHeight(2160)).toBe(2160)
    expect(resPFromHeight(1080)).toBe(1080)
    expect(resPFromHeight(720)).toBe(720)
    expect(resPFromHeight(480)).toBe(480)
  })

  it('**上へは伸ばさない**（1200 の素材を 4K にしない）', () => {
    expect(resPFromHeight(1200)).toBe(1080)
    expect(resPFromHeight(2159)).toBe(1080)
    expect(resPFromHeight(1079)).toBe(720)
  })

  it('段より高い素材は、そこで頭打ちになる（8K でも 4K まで）', () => {
    expect(resPFromHeight(4320)).toBe(2160)
  })

  it('一番下の段より低い素材は、一番下に上げる', () => {
    expect(resPFromHeight(360)).toBe(480)
    expect(resPFromHeight(1)).toBe(480)
  })

  it('分からないときは 1080p（無難な所へ倒す）', () => {
    expect(resPFromHeight(undefined)).toBe(1080)
    expect(resPFromHeight(null)).toBe(1080)
    expect(resPFromHeight(0)).toBe(1080)
    expect(resPFromHeight(NaN)).toBe(1080)
  })
})

describe('出力の名前', () => {
  it('パスから拡張子を落とした名前を取れる（区切りはどちらでも）', () => {
    expect(baseNameOf('C:\\動画\\切り抜き.mp4')).toBe('切り抜き')
    expect(baseNameOf('/home/me/clip.MOV')).toBe('clip')
    expect(baseNameOf('名前だけ')).toBe('名前だけ')
    // 隠しファイルのような先頭のドットは拡張子ではない
    expect(baseNameOf('.gitignore')).toBe('.gitignore')
  })

  it('プロジェクト名がいちばん強い', () => {
    expect(outputBaseName('C:\\p\\第3話.gcproj', 'C:\\v\\素材.mp4')).toBe('第3話')
  })

  it('プロジェクト名が無ければ元動画の名前', () => {
    expect(outputBaseName(null, 'C:\\v\\素材.mp4')).toBe('素材')
    expect(outputBaseName('', 'C:\\v\\素材.mp4')).toBe('素材')
  })

  it('どちらも無ければ最後の砦', () => {
    expect(outputBaseName(null, null)).toBe('giftcut_output')
  })
})

describe('同じ名前を黙って上書きしない', () => {
  it('空いていればそのまま', () => {
    expect(uniqueName('out', 'mp4', () => false)).toBe('out.mp4')
  })

  it('埋まっていれば (2) から順に空きを探す', () => {
    const has = new Set(['out.mp4', 'out(2).mp4'])
    expect(uniqueName('out', 'mp4', (n) => has.has(n))).toBe('out(3).mp4')
  })

  it('拡張子が違えば別物として扱う', () => {
    const has = new Set(['out.mp4'])
    expect(uniqueName('out', 'mov', (n) => has.has(n))).toBe('out.mov')
  })
})

describe('フォルダと名前をつなぐ', () => {
  it('Windows の区切りは Windows のまま', () => {
    expect(joinOut('C:\\動画', 'a.mp4')).toBe('C:\\動画\\a.mp4')
    expect(joinOut('C:\\動画\\', 'a.mp4')).toBe('C:\\動画\\a.mp4')
  })

  it('スラッシュの区切りはそのまま', () => {
    expect(joinOut('/home/me', 'a.mp4')).toBe('/home/me/a.mp4')
    expect(joinOut('/home/me/', 'a.mp4')).toBe('/home/me/a.mp4')
  })
})
