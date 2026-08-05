// 素材の fps の決め方。**入力は作り話ではなく、実際に測った値。**
//
// ## 確認用の VFR 素材の作り方（同じ物をもう一度作りたくなったとき）
//
// ```
// ffmpeg -y -f lavfi -i "testsrc2=size=320x180:rate=60" \
//        -f lavfi -i "sine=f=440:r=48000" -t 10 \
//        -vf "select='lt(mod(n,5),2)'" -fps_mode passthrough \
//        -c:v libopenh264 -pix_fmt yuv420p -c:a aac -shortest vfr.mp4
// ```
//
// 60fps の素材から「5コマ中2コマだけ残す」ので、**間隔が 1/60 と 3/60 の交互**に
// なる＝可変。`-fps_mode passthrough` を付けないと ffmpeg が等間隔へ均してしまい、
// **VFR のつもりで CFR を作ってしまう**（1回やった）。
//
// 測った結果:
//
// ```
// r_frame_rate   = 60/1        ← 直す前はこれを使っていた
// avg_frame_rate = 4800/199    ← 24.12fps
// 実コマ数 240 / 9.95秒        = 24.12fps（avg と一致）
// ```
//
// 同梱の ffmpeg は LGPL 版なので **libx264 が無い**。`libopenh264` を使うこと
// （`-c:v libx264` だと "Encoder not found" で落ちる）。

import { describe, it, expect } from 'vitest'
import { looksVariable, parseRational, pickSourceFps } from './sourceFps'

describe('ffprobe の分数を読む', () => {
  it('ふつうの形', () => {
    expect(parseRational('60/1')).toBe(60)
    expect(parseRational('30000/1001')).toBeCloseTo(29.97, 2)
  })

  // **ffprobe は「分からない」を `0/0` で返す。** ここで 0 除算して
  // Infinity や NaN を通すと、そのまま刻みに使われて画面が固まる
  it('`0/0`（分からない）は null', () => {
    expect(parseRational('0/0')).toBeNull()
    expect(parseRational('')).toBeNull()
    expect(parseRational(undefined)).toBeNull()
    expect(parseRational('N/A')).toBeNull()
  })

  it('負や 0 は採らない', () => {
    expect(parseRational('-30/1')).toBeNull()
    expect(parseRational('0/1')).toBeNull()
  })
})

describe('素材の fps を決める', () => {
  // 等間隔（CFR）では両者が一致するので、どちらを採っても同じ
  it('CFR は今までどおり', () => {
    expect(pickSourceFps('30/1', '30/1')).toBe(30)
    expect(pickSourceFps('30000/1001', '30000/1001')).toBeCloseTo(29.97, 2)
  })

  // **本題。** 実測した VFR 素材の値
  it('**VFR は avg を採る**（r だと 2.5倍ずれる）', () => {
    expect(pickSourceFps('60/1', '4800/199')).toBeCloseTo(24.12, 2)
  })

  it('avg が読めないときだけ r へ落ちる', () => {
    expect(pickSourceFps('30/1', '0/0')).toBe(30)
    expect(pickSourceFps('30/1', undefined)).toBe(30)
  })

  // **勝手に 30 を埋めない。** 分からないまま動かすと、コマ送りもタイムコードも
  // 静かに間違う。呼ぶ側に「分からない」を伝えて、そこで決めさせる
  it('どちらも読めなければ null（既定値を作らない）', () => {
    expect(pickSourceFps('0/0', '0/0')).toBeNull()
    expect(pickSourceFps(null, null)).toBeNull()
  })
})

describe('可変フレームレートかどうかの見立て（警告用）', () => {
  it('実測の VFR を可変と見なす', () => {
    expect(looksVariable('60/1', '4800/199')).toBe(true)
  })

  it('**29.97 と 30 の食い違いでは警告しない**（毎回出ると読まれなくなる）', () => {
    expect(looksVariable('30/1', '30000/1001')).toBe(false)
  })

  it('等間隔なら当然 false', () => {
    expect(looksVariable('60/1', '60/1')).toBe(false)
  })

  it('片方でも読めなければ「可変」とは言わない（憶測で警告を出さない）', () => {
    expect(looksVariable('60/1', '0/0')).toBe(false)
    expect(looksVariable(null, '24/1')).toBe(false)
  })
})
