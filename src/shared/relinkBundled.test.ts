import { describe, it, expect } from 'vitest'
import { relinkBundledPath } from './relinkBundled'

// いまの置き場
const ROOT = 'C:/Users/kyohei/GiftCut/SE'
const HERE = new Set([`${ROOT}/02_ツッコミ・リアクション/ショック①.mp3`, 'D:/自作/ぽん.wav'])
const exists = (p: string): boolean => HERE.has(p.split('\\').join('/'))
const relink = (p: string): string => relinkBundledPath(p, 'SE', [ROOT], exists)

describe('同梱素材のパスを今の置き場へ繋ぎ直す', () => {
  // **これが本題。** 家庭用の exe は起動のたびに別の一時フォルダへ展開されるので、
  // 前回そこを指して保存したプロジェクトは、次に開くとファイルが無い＝音が鳴らない。
  it('前回の一時フォルダを指していても、今の置き場を見つける', () => {
    const old = 'C:\\Users\\kyohei\\AppData\\Local\\Temp\\3HBMBwOyIyB8apVvBvy5DY9nFbX\\resources\\SE\\02_ツッコミ・リアクション\\ショック①.mp3'
    expect(relink(old)).toBe(`${ROOT}/02_ツッコミ・リアクション/ショック①.mp3`)
  })

  it('いま在る物には触らない（余計な繋ぎ替えをしない）', () => {
    const p = `${ROOT}/02_ツッコミ・リアクション/ショック①.mp3`
    expect(relink(p)).toBe(p)
  })

  // **自分で足した素材まで繋ぎ替えると、別の物を指しかねない。**
  // SE フォルダの下に無い物は、見つからなくてもそのままにする。
  it('同梱でない素材は、見つからなくてもそのまま', () => {
    const p = 'E:/どこか/消えた.mp3'
    expect(relink(p)).toBe(p)
  })

  it('置き場のどこにも無ければ、そのまま（別の物を指さない）', () => {
    const p = 'C:/Temp/xxxx/resources/SE/02_ツッコミ・リアクション/存在しない.mp3'
    expect(relink(p)).toBe(p)
  })

  it('置き場が複数あれば、在る方を選ぶ', () => {
    const p = 'C:/Temp/xxxx/resources/SE/02_ツッコミ・リアクション/ショック①.mp3'
    expect(relinkBundledPath(p, 'SE', ['C:/無い置き場', ROOT], exists)).toBe(
      `${ROOT}/02_ツッコミ・リアクション/ショック①.mp3`
    )
  })
})
