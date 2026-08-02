// **保存できる物は、ぜんぶ読み直せること。**
//
// ## なぜこの形の試験か
//
// 保存する側は状態をまるごと書く（`cues` をそのまま JSON にする）。
// 読む側は項目を1つずつ拾う。**この非対称が、事故の元**になっている。
//
//   型に項目を足す → 保存には勝手に載る → 読む側に書き忘れる
//   → 保存はできているのに、開き直すと**その項目だけ静かに消える**
//
// 実際にラベルの色・打った動き・部分装飾でやらかしている。エラーが出ないので、
// 気づくのは何日も後になる。
//
// ここでは全項目を埋めた見本を作り、読み直しても落ちないことを見る。
// 見本は `Required<...>` で受けているので、**型に項目を足すと型検査が落ちる**。
// 直すには見本に足すことになり、すると今度はこの試験が落ちる——
// 読む側に書くまで通らない、という順番になる。

import { describe, expect, it } from 'vitest'
import { loadCues, loadSegs, loadSeClips, loadImgClips, loadVClips } from './projectLoad'
import { defaultTelopStyle } from './telopStyle'
import type { VSeg, SEClip, ImgClip, VClip } from './projectTypes'
import type { Cue } from './srt'

const asIs = (id: string): string => id

/** 見本に共通で使う値 */
const zoom = { scale: 1.5, x: 0.1, y: 0.2 }
const crop = { l: 0.1, t: 0.1, r: 0.1, b: 0.1 }
const adjust = { b: 1.2, c: 1.1, s: 0.9 }
const clipMotion = { sc: [{ t: 0, v: 1 }, { t: 1, v: 1.5 }] }

/** 落ちていないか見る。undefined になっていたら「読む側に書き忘れ」 */
function 落ちた項目(見本: object, 読み直し: object): string[] {
  return Object.keys(見本).filter(
    (k) => (読み直し as Record<string, unknown>)[k] === undefined
  )
}

describe('保存できる項目は、ぜんぶ読み直せる', () => {
  it('テロップ', () => {
    const 見本: Required<Cue> = {
      id: 3,
      start: 1,
      end: 2,
      text: 'あいうえお',
      style: defaultTelopStyle(),
      runs: [{ start: 0, end: 2, color: '#fff' }],
      label: 'red',
      iconImage: 'data:image/png;base64,AA',
      personIcon: false,
      pos: { x: 0.3, y: 0.7 },
      track: 'V3',
      scale: 1.4,
      motion: { tx: [{ t: 0, v: 0 }, { t: 1, v: 50 }] },
      group: 2
    }
    expect(落ちた項目(見本, loadCues([見本])[0])).toEqual([])
  })

  it('動画の切片', () => {
    const 見本: Required<VSeg> = {
      id: 2,
      srcId: 1,
      srcStart: 0,
      srcEnd: 5,
      muted: true,
      videoBlank: true,
      speed: 2,
      transIn: { type: 'fade', dur: 0.5 },
      transOut: { type: 'dipblack', dur: 0.5 },
      xfade: { type: 'wipeleft', dur: 0.3 },
      adjust,
      rotate: 90,
      flipH: true,
      flipV: true,
      vol: 0.5,
      afadeIn: 0.2,
      afadeOut: 0.2,
      zoom,
      motion: clipMotion,
      crop,
      label: 'blue',
      gap: true
    }
    expect(落ちた項目(見本, loadSegs([見本])[0])).toEqual([])
  })

  it('効果音', () => {
    const 見本: Required<SEClip> = {
      id: 4,
      label: 'green',
      path: 'C:\\音\\ぽん.wav',
      name: 'ぽん.wav',
      tStart: 3,
      duration: 1.5,
      volume: 0.8,
      fadeIn: 0.1,
      fadeOut: 0.1,
      track: 'A3',
      srcOffset: 0.5,
      srcDur: 4,
      duck: true,
      group: 2
    }
    expect(落ちた項目(見本, loadSeClips([見本])[0])).toEqual([])
  })

  it('画像', () => {
    const 見本: Required<ImgClip> = {
      id: 5,
      label: 'yellow',
      path: 'C:\\絵\\a.png',
      name: 'a.png',
      tStart: 2,
      duration: 4,
      track: 'V3',
      zoom,
      motion: clipMotion,
      rotate: 45,
      flipH: true,
      flipV: true,
      opacity: 0.5,
      adjust,
      crop,
      group: 2
    }
    expect(落ちた項目(見本, loadImgClips([見本], asIs)[0])).toEqual([])
  })

  it('映像クリップ', () => {
    const 見本: Required<VClip> = {
      id: 6,
      label: 'purple',
      path: 'C:\\動画\\b.mp4',
      name: 'b.mp4',
      track: 'V2',
      tStart: 1,
      srcStart: 0,
      srcEnd: 3,
      srcDur: 10,
      zoom,
      motion: clipMotion,
      rotate: 180,
      flipH: true,
      flipV: true,
      opacity: 0.7,
      adjust,
      crop,
      muted: true,
      vol: 0.3,
      afadeIn: 0.2,
      afadeOut: 0.2,
      group: 2
    }
    expect(落ちた項目(見本, loadVClips([見本], asIs)[0])).toEqual([])
  })
})
