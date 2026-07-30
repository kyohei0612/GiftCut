// 映像を焼く設定の決まりごと。
//
// **この種のミスは配布先でだけ表に出る。** 開発機は GPU も x264 もあるので通ってしまい、
// 配った先で「プレビューを軽くできない」「最高画質(軽い)が作れない」になる。
// 実際、同梱の ffmpeg に x264 が入っていないことに気づかず、
// 配布物でだけプロキシが作れない状態になっていたことがある。

import { describe, expect, it } from 'vitest'
import { ENCODERS, crfToBitrateK } from './encoders'

describe('焼く設定', () => {
  it('どの符号化器にも 書き出し用・プロキシ用・最高画質(軽い)用 がそろっている', () => {
    for (const e of ENCODERS) {
      expect(typeof e.args, e.v).toBe('function')
      expect(typeof e.fast, e.v).toBe('function')
      expect(typeof e.full, e.v).toBe('function')
      expect(e.label.length, e.v).toBeGreaterThan(0)
    }
  })

  it('**最高画質(軽い)は B フレームを使ってはいけない**', () => {
    // 全コマキーフレーム（-g 1）と B フレームは両立しない。
    // NVIDIA では「Gop Length should be greater than number of B frames + 1」で
    // 符号化器がそもそも開けなかった。しかも -bf 0 を後から渡しても効かず、
    // preset 側が B フレームを強制する（p4 以降）。**preset の選び方で守るしかない。**
    for (const e of ENCODERS) {
      const a = e.full()
      const bf = a.indexOf('-bf')
      if (bf >= 0) expect(a[bf + 1], `${e.v} の -bf`).toBe('0')
      // NVIDIA は preset で決まる。p1 以外は B フレームが付く
      if (e.v === 'h264_nvenc') {
        const p = a.indexOf('-preset')
        expect(a[p + 1], 'nvenc の preset（p1 以外は -g 1 と両立しない）').toBe('p1')
      }
    }
  })

  it('最高画質(軽い)は、プロキシ用より画質側に寄っている', () => {
    // 原寸で見る物なので、縮小して見る前提の fast と同じ設定では
    // 「最高画質を選んだのに汚い」になる
    const q = (a: string[], k: string): number | null => {
      const i = a.indexOf(k)
      return i >= 0 ? Number(a[i + 1]) : null
    }
    for (const e of ENCODERS) {
      for (const key of ['-cq', '-global_quality', '-qp_i', '-crf']) {
        const f = q(e.fast(720), key)
        const u = q(e.full(), key)
        // 数字が小さいほどきれい
        if (f != null && u != null) expect(u, `${e.v} の ${key}`).toBeLessThan(f)
      }
    }
  })

  it('最後の砦（OpenH264）は必ず一覧の最後にある', () => {
    // 選ぶ側が「前から順に試して、最後は無条件で使う」作りなので、
    // 並び順そのものが仕様。ここが動くと GPU の無い PC で書き出せなくなる
    expect(ENCODERS[ENCODERS.length - 1].v).toBe('libopenh264')
  })

  it('画質の数字をビットレートに読み替える（OpenH264 は crf を理解しないため）', () => {
    const hd = { w: 1920, h: 1080, fps: 30 }
    const kirei = crfToBitrateK(18, hd)
    const futsu = crfToBitrateK(23, hd)
    const karui = crfToBitrateK(28, hd)
    expect(kirei).toBeGreaterThan(futsu)
    expect(futsu).toBeGreaterThan(karui)
    // 小さい絵ほど少ないビットレートで済む
    expect(crfToBitrateK(23, { w: 640, h: 360, fps: 30 })).toBeLessThan(futsu)
  })
})
