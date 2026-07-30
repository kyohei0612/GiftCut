// 取り込んだ動きが「保存して開き直しても同じ」かを見る。
//
// ## なぜここを見るか
//
// 取り込みの計算（prfpsetImport）は別で見ている。ここで見たいのはその先、
// **JSON に書いて読み直す所**。motion-presets/*.json を通るので、
//
//   - 接線（速度）が落ちると、**動いてはいるが直線になる**。これが一番気づきにくい
//   - 増やした項目（横回転・明るさ・切り抜き…）を sanitizeMotion に足し忘れると、
//     その項目だけ黙って消える
//
// どちらも画面では「なんか違う」としか見えないので、ここで止める。

import { describe, it, expect } from 'vitest'
import { toMotion } from '../../../shared/prfpsetImport'
import type { PrPreset } from '../../../shared/prfpset'
import type { Motion } from '../../../shared/telopMotion'
import { sanitizeMotion, applyMotion, hasMotion, animClip, textRectInFrame } from './telopStyle'
import { NEUTRAL_ANIM } from './telopStyle'

/** 保存→読み直しと同じ道を通す */
const roundTrip = (m: Motion): Motion | undefined =>
  sanitizeMotion(JSON.parse(JSON.stringify(m)))

/** 増やした項目を全部持っている、向こう側のプリセット1つぶん */
const fullPreset: PrPreset = {
  name: 'ぜんぶ入り',
  effects: [
    {
      matchName: 'AE.ADBE Geometry2',
      params: [
        { name: '位置', value: [], keys: [[{ t: 0, v: 1.5, out: { speed: 1, influence: 1 / 3 } }, { t: 0.4, v: 0.5 }], [{ t: 0, v: 0.5 }, { t: 0.4, v: 0.5 }]] },
        { name: 'スケール', value: [], keys: [[{ t: 0, v: 0 }, { t: 0.4, v: 100 }]] },
        { name: 'スケール (幅)', value: [], keys: [[{ t: 0, v: 140 }, { t: 0.4, v: 100 }]] },
        { name: 'スケール (高さ)', value: [], keys: [[{ t: 0, v: 60 }, { t: 0.4, v: 100 }]] },
        { name: '歪曲', value: [], keys: [[{ t: 0, v: 20 }, { t: 0.4, v: 0 }]] },
        { name: '回転', value: [], keys: [[{ t: 0, v: 90 }, { t: 0.4, v: 0 }]] },
        { name: '不透明度', value: [], keys: [[{ t: 0, v: 0 }, { t: 0.4, v: 100 }]] }
      ]
    },
    {
      matchName: 'AE.ADBE Basic 3D',
      params: [
        { name: 'スウィベル', value: [], keys: [[{ t: 0, v: 180 }, { t: 0.4, v: 0 }]] },
        { name: 'チルト', value: [], keys: [[{ t: 0, v: 45 }, { t: 0.4, v: 0 }]] }
      ]
    },
    {
      matchName: 'AE.ADBE ProcAmp',
      params: [{ name: '明度', value: [], keys: [[{ t: 0, v: 100 }, { t: 0.4, v: 0 }]] }]
    },
    {
      matchName: 'AE.ADBE Gaussian Blur 2',
      params: [{ name: 'ブラー', value: [], keys: [[{ t: 0, v: 40 }, { t: 0.4, v: 0 }]] }]
    },
    {
      matchName: 'AE.ADBE Color Balance (HLS)',
      params: [{ name: '色相', value: [], keys: [[{ t: 0, v: 180 }, { t: 0.4, v: 0 }]] }]
    },
    {
      matchName: 'AE.ADBE Invert',
      params: [{ name: '元の画像とブレンド', value: [], keys: [[{ t: 0, v: 0 }, { t: 0.4, v: 100 }]] }]
    },
    {
      matchName: 'AE.ADBE Venetian Blinds',
      params: [
        { name: '変換終了', value: [], keys: [[{ t: 0, v: 100 }, { t: 0.4, v: 0 }]] },
        // 幅と向きは動かない。**印が無くても拾えているか**をここで見る
        { name: '幅', value: [45], keys: [] },
        { name: '方向', value: [0], keys: [] }
      ]
    },
    {
      matchName: 'AE.ADBE AECrop',
      params: [
        { name: '左', value: [], keys: [[{ t: 0, v: 10 }, { t: 0.4, v: 0 }]] },
        { name: '上', value: [], keys: [[{ t: 0, v: 20 }, { t: 0.4, v: 0 }]] },
        { name: '右', value: [], keys: [[{ t: 0, v: 100 }, { t: 0.4, v: 0 }]] },
        { name: '下', value: [], keys: [[{ t: 0, v: 30 }, { t: 0.4, v: 0 }]] }
      ]
    }
  ]
}

describe('取り込んだ動きを保存して開き直す', () => {
  const { motion } = toMotion(fullPreset)

  it('増やした項目が1つも落ちない', () => {
    // ここが本題。項目を足したとき sanitizeMotion に書き忘れると、
    // **その項目だけ**が開き直した瞬間に消える（他は動くので気づかない）
    const back = roundTrip(motion)
    expect(Object.keys(back ?? {}).sort()).toEqual(Object.keys(motion).sort())
  })

  it('全21項目そろっている（＝この見本自体が抜けていないか）', () => {
    expect(Object.keys(motion).sort()).toEqual(
      ['blind', 'blindDir', 'blindW', 'blur', 'bright', 'cb', 'cl', 'cr', 'ct', 'hue', 'inv',
       'op', 'rot', 'rotx', 'roty', 'sc', 'scx', 'scy', 'skew', 'tx', 'ty'].sort()
    )
  })

  it('接線（速度）が残る＝曲がり方が直線に戻らない', () => {
    const back = roundTrip(motion)
    expect(back?.tx?.[0].to?.speed).toBeCloseTo(1920, 3)
    expect(back?.tx?.[0].to?.influence).toBeCloseTo(1 / 3, 6)
  })

  it('開き直したあとの見た目が、取り込んだ直後と同じ', () => {
    const back = roundTrip(motion)!
    for (const t of [0, 0.1, 0.2, 0.3, 0.4, 1]) {
      expect(applyMotion(NEUTRAL_ANIM, back, t)).toEqual(applyMotion(NEUTRAL_ANIM, motion, t))
    }
  })

  it('終わりでは、元のテロップの姿に戻っている', () => {
    // 演出は「入ってきて、いつもの姿で止まる」。止まった所がズレていると、
    // 置いた位置と違う所にテロップが座り続ける
    const st = applyMotion(NEUTRAL_ANIM, roundTrip(motion), 0.4)
    expect(st.tx).toBeCloseTo(0, 6)
    expect(st.ty).toBeCloseTo(0, 6)
    expect(st.sc).toBeCloseTo(1, 6)
    expect(st.scx).toBeCloseTo(1, 6)
    expect(st.scy).toBeCloseTo(1, 6)
    expect(st.rot).toBeCloseTo(0, 6)
    expect(st.skew).toBeCloseTo(0, 6)
    expect(st.roty).toBeCloseTo(0, 6)
    expect(st.rotx).toBeCloseTo(0, 6)
    expect(st.opacity).toBeCloseTo(1, 6)
    expect(st.bright).toBeCloseTo(1, 6) // ProcAmp の 0 は「無調整」＝ CSS の 1
    expect(st.blur).toBeCloseTo(0, 6)
    expect(st.hue).toBeCloseTo(0, 6)
    expect(st.inv).toBeCloseTo(0, 6) // 向こうの「元の画像とブレンド 100」＝反転なし
    expect(st.blind).toBeCloseTo(0, 6)
    expect(st.crop).toEqual({ l: 0, t: 0, r: 0, b: 0 })
  })

  // **向こうの切り抜きはフレームの何％**（エフェクトは画面全体にかかる）。
  // 文字は画面の中の細い帯なので、同じ％を文字の箱に当てると桁違いに削れる。
  // 61.タイプライターは右を 86%→13% と刻むが、13% はフレームの端の話で
  // 文字には届かない。箱の割合として当てていたので、最後まで右端が欠けていた。
  describe('切り抜きはフレーム基準で当てる', () => {
    // 画面の真ん中に、幅がフレームの2割の文字がある想定
    const box = textRectInFrame({ x: 0.5, y: 0.85 }, { h: 'c', v: 'm' }, 384, 108, 1920, 1080)
    const st = (crop: Partial<{ l: number; t: number; r: number; b: number }>) => ({
      ...NEUTRAL_ANIM,
      crop: { l: 0, t: 0, r: 0, b: 0, ...crop }
    })

    it('文字に届かない切り抜きは、何も削らない', () => {
      // 右から13% = x=0.87 の線。文字は 0.4〜0.6 なので届かない
      expect(animClip(st({ r: 0.13 }), box)).toBe('')
    })

    it('文字に食い込む所からは削れる', () => {
      // 右から45% = x=0.55 の線。文字(0.4〜0.6)の右から4分の1が隠れる
      const s = animClip(st({ r: 0.45 }), box)
      expect(s).toMatch(/^inset\(/)
      const right = Number(/inset\([\d.]+% ([\d.]+)%/.exec(s)![1])
      expect(right).toBeCloseTo(25, 0)
    })

    it('文字を全部覆う切り抜きなら、全部隠れる', () => {
      // 右から70% = x=0.30。文字(0.4〜0.6)より左なので全部隠れる
      const s = animClip(st({ r: 0.7 }), box)
      expect(Number(/inset\([\d.]+% ([\d.]+)%/.exec(s)![1])).toBeGreaterThan(99)
    })

    it('箱を渡さなければ、今までどおり箱の割合（自分で打った切り抜き）', () => {
      expect(animClip(st({ r: 0.13 }))).toBe('inset(0.00% 13.00% 0.00% 0.00%)')
    })
  })

  it('壊れた JSON をつかまされても、動き無しに落ちるだけ', () => {
    // 人からもらった motion-presets を読むことがある
    expect(sanitizeMotion({ tx: 'こわれている' })).toBeUndefined()
    expect(sanitizeMotion(null)).toBeUndefined()
    expect(hasMotion(sanitizeMotion({ tx: [{ t: 0, v: 'x' }] }))).toBe(false)
  })
})
