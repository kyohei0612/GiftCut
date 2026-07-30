import { describe, it, expect } from 'vitest'
import { clashingSource } from './exportTarget'

const USED = [
  'C:\\Users\\kyohei\\Downloads\\giftcut_output.mp4', // 前に書き出した物を素材にしている
  'C:/Users/kyohei/Downloads/1(6).mp4',
  'C:\\Users\\kyohei\\GiftCut\\SE\\02_ツッコミ・リアクション\\ショック①.mp3'
]

describe('書き出し先が素材と同じかを見る', () => {
  // **これが本題。** 読みながら同じファイルへは書けないので、始める前に止める。
  // 止めないと ffmpeg の英語のエラーだけが出て、原因が分からない。
  it('同じファイルなら、その素材を返す', () => {
    expect(clashingSource('C:\\Users\\kyohei\\Downloads\\giftcut_output.mp4', USED)).toBe(USED[0])
  })

  it('区切りの向きが違っても同じ物と見なす', () => {
    expect(clashingSource('C:/Users/kyohei/Downloads/giftcut_output.mp4', USED)).toBe(USED[0])
  })

  it('大文字小文字が違っても同じ物と見なす（Windows）', () => {
    expect(clashingSource('c:\\users\\KYOHEI\\downloads\\GiftCut_Output.mp4', USED)).toBe(USED[0])
  })

  it('動画以外（音・画像）とぶつかっても見つける', () => {
    expect(clashingSource('C:/Users/kyohei/GiftCut/SE/02_ツッコミ・リアクション/ショック①.mp3', USED)).toBe(
      USED[2]
    )
  })

  it('別の名前なら通す（普通の書き出しを邪魔しない）', () => {
    expect(clashingSource('C:/Users/kyohei/Downloads/giftcut_output2.mp4', USED)).toBeNull()
  })

  it('似ているだけの名前は別物として通す', () => {
    expect(clashingSource('C:/Users/kyohei/Downloads/giftcut_output.mp4.mp4', USED)).toBeNull()
  })
})
