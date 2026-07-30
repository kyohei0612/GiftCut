import { describe, it, expect } from 'vitest'
import { toMotion, isFullyCopyable, endsHidden } from './prfpsetImport'
import { PR_TICKS_PER_SEC, type PrPreset } from './prfpset'
import { valueAt } from './keyframes'

const key = (t: number, v: number, sp?: number): { t: number; v: number; out?: { speed: number; influence: number } } =>
  sp === undefined ? { t, v } : { t, v, out: { speed: sp, influence: 1 / 3 } }

const preset = (
  matchName: string,
  paramName: string,
  keys: { t: number; v: number }[][],
  extra: PrPreset['effects'] = []
): PrPreset => ({
  name: 'テスト',
  effects: [{ matchName, params: [{ name: paramName, value: [], keys }] }, ...extra]
})

describe('単位を合わせる（ここを間違えると量だけ違う）', () => {
  it('位置: 割合（0.5が中央）→ 中央からのズレ px', () => {
    const p = preset('AE.ADBE Motion', '位置', [
      [key(0, 1.5), key(0.2, 0.5)], // x
      [key(0, 0.5), key(0.2, 0.5)] // y
    ])
    const { motion } = toMotion(p)
    // 割合はフレームの幅が1。1.5 は中央（0.5）からフレーム1つぶん右＝+1920px。
    // 0.5 は中央なので 0
    expect(motion.tx?.map((k) => k.v)).toEqual([1920, 0])
    expect(motion.ty?.map((k) => k.v)).toEqual([0, 0])
  })

  it('スケール: 100 が等倍 → 1', () => {
    const { motion } = toMotion(preset('AE.ADBE Motion', 'スケール', [[key(0, 100), key(1, 250)]]))
    expect(motion.sc?.map((k) => k.v)).toEqual([1, 2.5])
  })

  it('不透明度: 100 が不透明 → 1', () => {
    const { motion } = toMotion(preset('AE.ADBE Opacity', '不透明度', [[key(0, 0), key(1, 100)]]))
    expect(motion.op?.map((k) => k.v)).toEqual([0, 1])
  })

  // 縦だけの拡大。**これが無いと「弾む」演出が作れない**
  // （56.ビョヨン / 58.落ちる / 64.メビウス は、これが動きの本体だった）
  it('スケール(高さ): 100 が等倍 → 1', () => {
    const { motion } = toMotion(
      preset('AE.ADBE Motion', 'スケール (高さ)', [[key(0, 60), key(0.4, 100)]])
    )
    expect(motion.scy?.map((k) => k.v)).toEqual([0.6, 1])
  })

  it('色相は度どうしなのでそのまま（CSS の hue-rotate と同じ意味）', () => {
    const { motion } = toMotion(
      preset('AE.ADBE Color Balance (HLS)', '色相', [[key(0, 180), key(0.4, 0)]])
    )
    expect(motion.hue?.map((k) => k.v)).toEqual([180, 0])
  })

  // **裏返しになっているので、そのまま持ってくると逆に動く。**
  // 向こうは「元の絵をどれだけ混ぜるか」（100＝元のまま＝反転なし）
  it('反転は「元の画像とブレンド」を裏返す', () => {
    const { motion } = toMotion(
      preset('AE.ADBE Invert', '元の画像とブレンド', [[key(0, 0), key(0.4, 100)]])
    )
    expect(motion.inv?.map((k) => k.v)).toEqual([1, 0])
  })

  // 縞で覆って開いていく。**幅と向きは動かない**ので、印が無くても拾う必要がある
  it('ブラインド: 変換終了 100=全部隠れる → 1。幅と向きは固定値から拾う', () => {
    const p: PrPreset = {
      name: 'ブラインド',
      effects: [
        {
          matchName: 'AE.ADBE Venetian Blinds',
          params: [
            { name: '変換終了', value: [], keys: [[key(0, 100), key(0.5, 0)]] },
            { name: '幅', value: [20], keys: [] },
            { name: '方向', value: [90], keys: [] }
          ]
        }
      ]
    }
    const { motion, skipped } = toMotion(p)
    expect(motion.blind?.map((k) => k.v)).toEqual([1, 0])
    expect(motion.blindW).toBe(20)
    expect(motion.blindDir).toBe(90)
    expect(skipped).toEqual([])
  })

  it('回転は度どうしなのでそのまま', () => {
    const { motion } = toMotion(preset('AE.ADBE Motion', '回転', [[key(0, 0), key(1, 90)]]))
    expect(motion.rot?.map((k) => k.v)).toEqual([0, 90])
  })

  // **速度も同じ倍率で直さないと、曲がり方だけ元のままになる。**
  // 値だけ1/100にして速度を放置すると、100倍の速度で飛び出して戻る形になる。
  it('接線（速度）も値と同じ倍率で直す', () => {
    const { motion } = toMotion(
      preset('AE.ADBE Motion', 'スケール', [[key(0, 100, 50), key(1, 200)]])
    )
    expect(motion.sc?.[0].to?.speed).toBeCloseTo(0.5, 6) // 50/秒 → 0.5/秒
    expect(motion.sc?.[0].to?.influence).toBeCloseTo(1 / 3, 6)
  })

  it('位置の速度も px に直る', () => {
    const { motion } = toMotion(
      preset('AE.ADBE Motion', '位置', [[key(0, 1.5, 1), key(0.2, 0.5)]])
    )
    expect(motion.tx?.[0].to?.speed).toBeCloseTo(1920, 3)
  })
})

// **終わりで 0 に戻らないと、テロップが置いた場所と違う所に座り続ける。**
// こちらの tx/ty は「置いた場所からのズレ」なので、原点は中央(0.5)ではなく
// そのプリセット自身の最後のキー。実物の 58.落ちる は y:0.88→0.972 と
// 下寄りで作られていて、0.5 を原点にすると +466px ずれたまま止まっていた。
describe('位置は「最後に落ち着く所」を原点にする', () => {
  it('中央で作られていない演出でも、終わりは 0 になる', () => {
    const { motion } = toMotion(
      preset('AE.ADBE Motion', '位置', [
        [key(0, 0.5), key(0.17, 0.5)], // x
        [key(0, 0.88), key(0.17, 0.972)] // y ＝ 下寄りで作られている
      ])
    )
    expect(motion.ty?.[motion.ty.length - 1].v).toBeCloseTo(0, 6)
    // 0.88 → 0.972 は上へ 0.092 ぶん。1080基準で -99.36px から落ちてくる
    expect(motion.ty?.[0].v).toBeCloseTo((0.88 - 0.972) * 1080, 6)
  })

  it('中央で作られた演出は、今までどおり（0.5 なら 0 のまま）', () => {
    const { motion } = toMotion(
      preset('AE.ADBE Motion', '位置', [[key(0, 1.5), key(0.2, 0.5)]])
    )
    expect(motion.tx?.map((k) => k.v)).toEqual([1920, 0])
  })

  it('動かない軸は、ずっと 0（固定値のぶんズレない）', () => {
    const { motion } = toMotion(
      preset('AE.ADBE Motion', '位置', [
        [key(0, 0.3), key(0.2, 0.7)],
        [key(0, 0.974), key(0.2, 0.974)] // y は動かない
      ])
    )
    expect(motion.ty?.map((k) => k.v)).toEqual([0, 0])
  })
})

describe('取り込んだ動きが、実際にその値になるか', () => {
  it('端と途中を引いてみる', () => {
    const { motion } = toMotion(
      preset('AE.ADBE Motion', 'スケール', [[key(0, 100), key(1, 200)]])
    )
    expect(valueAt(motion.sc, 0, 1)).toBeCloseTo(1, 6)
    expect(valueAt(motion.sc, 0.5, 1)).toBeCloseTo(1.5, 6)
    expect(valueAt(motion.sc, 1, 1)).toBeCloseTo(2, 6)
  })
})

describe('波形ワープ（実物で一番使われている）', () => {
  const wave = (params: { name: string; value: number[]; keys: { t: number; v: number }[][] }[]): PrPreset => ({
    name: '波',
    effects: [{ matchName: 'AE.ADBE Wave Warp', params }]
  })

  it('波紋の高さと波形の幅は px どうし。そのまま持ってくる', () => {
    const { motion, skipped } = toMotion(
      wave([
        { name: '波紋の高さ', value: [0], keys: [[key(0, -1888), key(0.33, 0)]] },
        { name: '波形の幅', value: [1], keys: [[key(0, 8), key(0.33, 1)]] }
      ])
    )
    expect(motion.wavH?.map((k) => k.v)).toEqual([-1888, 0])
    expect(motion.wavW?.map((k) => k.v)).toEqual([8, 1])
    expect(skipped).toEqual([])
  })

  it('動かない波も拾う（ユラユラ系は高さも幅も固定で、波が流れるだけ）', () => {
    // ここを印だけ見ていると「波なんて付いていない」ことになり、
    // 53.後ろユラユラ が素のテロップになってしまう
    const { motion } = toMotion(
      wave([
        { name: '波紋の高さ', value: [82], keys: [] },
        { name: '波形の幅', value: [238], keys: [] },
        { name: '波形の速度', value: [0.2], keys: [] }
      ])
    )
    expect(motion.wavH?.map((k) => k.v)).toEqual([82])
    expect(motion.wavW?.map((k) => k.v)).toEqual([238])
    expect(motion.wavSpd).toBe(0.2)
  })

  it('「方向」は、どのエフェクトの物かで行き先が違う', () => {
    // ブラインドにも同じ名前の項目がある。取り違えると、波の向きが
    // 縞の向きに化ける（見た目は「なぜか効かない」になる）
    const { motion } = toMotion(wave([{ name: '方向', value: [0], keys: [[key(0, 180), key(0.17, 0)]] }]))
    expect(motion.wavDir?.map((k) => k.v)).toEqual([180, 0])
    expect(motion.blindDir).toBeUndefined()
  })

  it('種類・固定・フェーズは、動いていても黙って無視してよい', () => {
    // こちらの波は正弦の1種類だけ。実物でもここは全部動かない
    const { skipped } = toMotion(
      wave([{ name: '波形の種類', value: [0], keys: [[key(0, 0), key(1, 1)]] }])
    )
    expect(skipped).toEqual([])
  })
})

describe('持ってこられない物を黙って捨てない', () => {
  // 「取り込んだのに一部だけ効いていない」が一番たちが悪い。名前を返す。
  it('対応していないエフェクトは名前を返す', () => {
    const p = preset('AE.ADBE Motion', 'スケール', [[key(0, 100), key(1, 200)]], [
      {
        matchName: 'AE.ADBE Turbulent Displace',
        params: [{ name: '量', value: [], keys: [[key(0, 1)]] }]
      }
    ])
    const { motion, skipped } = toMotion(p)
    expect(motion.sc).toBeDefined()
    expect(skipped).toContain('AE.ADBE Turbulent Displace')
  })

  it('動きが付いていないエフェクトは、知らせなくてよい', () => {
    const p = preset('AE.ADBE Motion', 'スケール', [[key(0, 100), key(1, 200)]], [
      { matchName: 'AE.ADBE ProcAmp', params: [{ name: '明度', value: [1], keys: [] }] }
    ])
    expect(toMotion(p).skipped).toEqual([])
  })

  it('知らない項目も名前で返す（アンカーポイントなど）', () => {
    const p = preset('AE.ADBE Motion', 'アンカーポイント', [[key(0, 0.5), key(1, 0.6)]])
    expect(toMotion(p).skipped).toContain('AE.ADBE Motion/アンカーポイント')
  })
})

describe('そのまま再現できるプリセットか', () => {
  it('Motion と Opacity だけなら再現できる', () => {
    expect(
      isFullyCopyable({
        name: 'x',
        effects: [
          { matchName: 'AE.ADBE Motion', params: [] },
          { matchName: 'AE.ADBE Opacity', params: [] }
        ]
      })
    ).toBe(true)
  })
  it('ぼかし・色調整・切り抜き・基本3D も持てる（テロップは CSS で出せるため）', () => {
    for (const n of [
      'AE.ADBE Gaussian Blur 2',
      'AE.ADBE ProcAmp',
      'AE.ADBE AECrop',
      'AE.ADBE Basic 3D'
    ]) {
      expect(isFullyCopyable({ name: 'x', effects: [{ matchName: n, params: [] }] })).toBe(true)
    }
  })

  it('波形ワープは持てる（SVG のずらしフィルタで出す）', () => {
    // 実物で一番使われている（7件）。SPLITSLIDE 系はこれが本体で、
    // 無いとただの滑り込みになってしまう
    expect(
      isFullyCopyable({ name: 'x', effects: [{ matchName: 'AE.ADBE Wave Warp', params: [] }] })
    ).toBe(true)
  })

  it('ブラー（方向）も持てる（向きのある尾を SVG で引く）', () => {
    // 普通のぼかしは向きを持てない。43.ブラー方向 は向きが振れるのが本体なので、
    // まん丸のぼかしで代えると別物になる
    expect(
      isFullyCopyable({ name: 'x', effects: [{ matchName: 'AE.ADBE Motion Blur', params: [] }] })
    ).toBe(true)
  })

  it('まだ持てない物は、持てるふりをしない', () => {
    for (const n of ['AE.ADBE Turbulent Displace', 'AE.ADBE Lens Flare', 'AE.ADBE Mosaic']) {
      expect(isFullyCopyable({ name: 'x', effects: [{ matchName: n, params: [] }] })).toBe(false)
    }
  })
})

describe('時刻の刻み', () => {
  it('1秒あたりの刻みは Premiere と同じ', () => {
    expect(PR_TICKS_PER_SEC).toBe(254016000000)
  })
})

describe('トランスフォーム（動きはこちらに付いていることが多い）', () => {
  const tf = (name: string, keys: { t: number; v: number }[][]): PrPreset => ({
    name: 'テスト',
    effects: [{ matchName: 'AE.ADBE Geometry2', params: [{ name, value: [], keys }] }]
  })

  it('位置・スケールは「モーション」と同じように読める', () => {
    const { motion, skipped } = toMotion(tf('位置', [[key(0, 1.5), key(0.2, 0.5)], [key(0, 0.5), key(0.2, 0.5)]]))
    expect(motion.tx?.map((k) => k.v)).toEqual([1920, 0])
    expect(skipped).toEqual([])
  })

  // **これが 03.SLIDE_R2 のような「弾む」演出の正体。**
  it('スケール(幅): 横だけ伸び縮みする', () => {
    const { motion } = toMotion(tf('スケール (幅)', [[key(0, 200), key(0.3, 98.8)]]))
    expect(motion.scx?.map((k) => k.v)).toEqual([2, 0.988])
  })

  it('歪曲: 度どうしなのでそのまま', () => {
    const { motion } = toMotion(tf('歪曲', [[key(0, 0), key(0.3, -5.9)]]))
    expect(motion.skew?.map((k) => k.v)).toEqual([0, -5.9])
  })

  it('見た目に効かない項目は、知らせずに捨てる', () => {
    for (const n of ['歪曲軸', 'アンチフリッカー', 'シャッター角度', 'サンプリング']) {
      expect(toMotion(tf(n, [[key(0, 0), key(1, 90)]])).skipped).toEqual([])
    }
  })

  it('トランスフォームだけのプリセットも、そのまま再現できる扱い', () => {
    expect(isFullyCopyable({ name: 'x', effects: [{ matchName: 'AE.ADBE Geometry2', params: [] }] })).toBe(true)
  })
})

// 実物には「_上」「_下」の対がある。上側は**2枚重ねの上に乗せる光の筋**で、
// 単体で当てると最後に文字ごと消える。取り込みの誤りではないので、
// 「壊れている」と見えないように中身から見分ける（名前では取りこぼす）。
describe('終わりで消える物（2枚重ねの上側）を見分ける', () => {
  it('不透明度が0で終わる', () => {
    expect(endsHidden({ op: [{ t: 0, v: 1 }, { t: 0.5, v: 0 }] })).toBe(true)
  })

  // 片側だけでも真ん中を越えれば、横方向に中央のテロップは残らない。
  // 41.点灯_上 は左から89.9%まで削って終わる（両側の合計では 0.9 にしかならず、
  // 合計だけ見ていると取りこぼす）。
  it('片側の切り抜きが真ん中を越える（41.点灯_上 はこれ）', () => {
    expect(endsHidden({ cl: [{ t: 0, v: 0 }, { t: 0.5, v: 0.899 }], cr: [{ t: 0, v: 0 }, { t: 0.5, v: 0.008 }] })).toBe(true)
  })

  it('端を少し削るだけなら、消えたとは見なさない', () => {
    expect(endsHidden({ cl: [{ t: 0, v: 0 }, { t: 0.5, v: 0.2 }], cr: [{ t: 0, v: 0 }, { t: 0.5, v: 0.2 }] })).toBe(false)
  })

  it('ブラインドが閉じきる', () => {
    expect(endsHidden({ blind: [{ t: 0, v: 0 }, { t: 0.5, v: 1 }] })).toBe(true)
  })

  it('普通の演出は、そう見なさない', () => {
    expect(endsHidden({ op: [{ t: 0, v: 0 }, { t: 0.5, v: 1 }], tx: [{ t: 0, v: 500 }, { t: 0.5, v: 0 }] })).toBe(false)
    expect(endsHidden({})).toBe(false)
  })
})
