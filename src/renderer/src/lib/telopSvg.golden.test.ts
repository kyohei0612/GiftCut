// @vitest-environment jsdom
//
// **テロップの絵を、出力そのもので固定する。**
//
// ## なぜ要るか（2026-08-04 に足した）
//
// このアプリの一番怖い壊れ方は「画面では出るのに書き出すと違う」で、
// **型検査も普通の単体試験も捕まえられない**（文字列が組み上がってしまうため）。
// `telopSvg.ts` の頭は「突き合わせは `npm run frames`」と書いていたが、
// **あれは動きと prfpset しか見ていない。テロップの絵は1画素も見ていなかった。**
//
// ## 何を固定しているか
//
// `buildTelopSVG` が返す **SVG 文字列そのもの**。中身の意味は見ない——
// 「作り直しても1バイトも変わらない」だけを守る。だから
// **絵を変える直しをしたときは、ここも一緒に変わる**（それが正しい）。
// 変わったときは、**なぜ変わってよいのかをコミットに書くこと。**
//
// ## 測る所は通らない
//
// jsdom には canvas が無いので `inkContext()` は null を返し、文字幅の実測は
// 飛ぶ（＝`maxW` は既定のまま）。**組版の下ごしらえより後ろ**——余白・座標・
// 縁・影・塗り・斜体・svg の組み立て——は全部ここを通る。
//
// ## id の連番はここで揃える
//
// グラデと影ぼかしの id は**モジュールの通し番号**なので、走らせる順で変わる。
// 期待値には入れず、`gr\d+` / `shb\d+_\d+` に均してから比べる。
import { describe, expect, it } from 'vitest'
import { buildTelopSVG, type TextRun } from './telopSvg'
import { defaultTelopStyle, type TelopStyle } from './telopStyle'

/** id の通し番号を均す（走らせる順に依らない形にする） */
const norm = (svg: string): string =>
  svg.replace(/gr\d+/g, 'gr#').replace(/shb\d+_\d+/g, 'shb#')

const base = (over: Partial<TelopStyle> = {}): TelopStyle => ({
  ...defaultTelopStyle(),
  fontSize: 60,
  ...over
})

/**
 * 代表的な見た目。**1つでも欠けると、その道だけ静かに壊れる。**
 *
 * 縁・影・部分装飾は「全文均一の道」と「文字ごとの道」で**中の分岐が別**なので、
 * 両方を通すこと（`hasRunStrokes` / `hasRunShadows` で切り替わる）。
 */
const CASES: { name: string; style: TelopStyle; text: string; runs?: TextRun[] }[] = [
  { name: '素のまま', style: base(), text: 'あいう' },
  { name: '複数行', style: base(), text: 'あいう\nえお' },
  { name: '太字と字間', style: base({ bold: true, tracking: 80, leading: 20 }), text: 'あいう' },
  { name: '寄せ（左）', style: base({ align: 'left' }), text: 'あいう' },
  { name: '寄せ（右）', style: base({ align: 'right' }), text: 'あいう' },
  { name: '斜体', style: base({ italic: true }), text: 'あいう' },
  { name: '縦書き', style: base({ vertical: true }), text: 'あいう\nえお' },
  { name: '縁なし', style: base({ strokes: [] }), text: 'あいう' },
  {
    name: '縁が3枚（外・中央・内）',
    style: base({
      strokes: [
        { enabled: true, color: '#000000', width: 8, position: 'outside' },
        { enabled: true, color: '#ff0000', width: 4, position: 'center' },
        { enabled: true, color: '#00ff00', width: 2, position: 'inside' }
      ]
    }),
    text: 'あいう'
  },
  {
    name: '影1枚',
    style: base({ shadow: { enabled: true, color: '#000000', opacity: 80, angle: 135, distance: 6, blur: 6 } }),
    text: 'あいう'
  },
  {
    name: '影が2枚（ぼかし有り／無し）',
    style: base({
      shadows: [
        { enabled: true, color: '#000000', opacity: 80, angle: 135, distance: 10, blur: 8, spread: 2 },
        { enabled: true, color: '#0000ff', opacity: 50, angle: 45, distance: 4, blur: 0 }
      ]
    }),
    text: 'あいう'
  },
  {
    name: '塗りがグラデ（線形）',
    style: base({
      fill: {
        enabled: true,
        color: '#ffffff',
        gradient: { angle: 90, stops: [{ color: '#ff0000', pos: 0 }, { color: '#0000ff', pos: 1 }] }
      }
    }),
    text: 'あいう'
  },
  {
    name: '塗りがグラデ（円形・不透明度ストップ付き）',
    style: base({
      fill: {
        enabled: true,
        color: '#ffffff',
        gradient: {
          type: 'radial',
          angle: 0,
          stops: [{ color: '#ffff00', pos: 0, mid: 0.3 }, { color: '#00ffff', pos: 1 }],
          opacityStops: [{ opacity: 100, pos: 0 }, { opacity: 20, pos: 1 }]
        }
      }
    }),
    text: 'あいう'
  },
  { name: '塗りを消す（縁だけ見える）', style: base({ fill: { enabled: false, color: '#ffffff' } }), text: 'あいう' },
  // ---- ここから部分装飾（**中の分岐が別の道**）----
  {
    name: '部分装飾: 色とサイズ',
    style: base(),
    text: 'あいうえお',
    runs: [{ start: 1, end: 3, color: '#ff0000', sizeScale: 1.5 }]
  },
  {
    name: '部分装飾: 背景ハイライト',
    style: base(),
    text: 'あいうえお',
    runs: [{ start: 1, end: 3, bgColor: '#ffff00' }]
  },
  {
    name: '部分装飾: 文字ごとの縁',
    style: base(),
    text: 'あいうえお',
    runs: [{ start: 1, end: 3, strokes: [{ enabled: true, color: '#ff00ff', width: 6, position: 'outside' }] }]
  },
  {
    name: '部分装飾: 文字ごとの影',
    style: base(),
    text: 'あいうえお',
    runs: [
      { start: 1, end: 3, shadows: [{ enabled: true, color: '#000000', opacity: 70, angle: 90, distance: 5, blur: 3 }] }
    ]
  },
  {
    name: '部分装飾: 選んだ文字だけグラデ',
    style: base(),
    text: 'あいうえお',
    runs: [
      {
        start: 1,
        end: 4,
        gradient: { angle: 0, stops: [{ color: '#ff0000', pos: 0 }, { color: '#00ff00', pos: 1 }] }
      }
    ]
  }
]

describe('テロップの絵（buildTelopSVG）を出力そのもので固定する', () => {
  for (const c of CASES) {
    it(c.name, () => {
      expect(norm(buildTelopSVG(c.style, c.text, c.runs).svg)).toMatchSnapshot()
    })
  }

  it('返す枠（w/h/textW/textH/pad）も固定する', () => {
    const r = buildTelopSVG(base(), 'あいう\nえお')
    expect({ w: r.w, h: r.h, textW: r.textW, textH: r.textH, pad: r.pad }).toMatchSnapshot()
  })

  it('**縦書きは枠の縦横が入れ替わる**（横書きと同じ値になっていないこと）', () => {
    const yoko = buildTelopSVG(base(), 'あいうえお\nか')
    const tate = buildTelopSVG(base({ vertical: true }), 'あいうえお\nか')
    expect(tate.textW).not.toBe(yoko.textW)
    expect(tate.textH).not.toBe(yoko.textH)
  })
})
