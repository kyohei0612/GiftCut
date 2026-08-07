import { describe, it, expect } from 'vitest'
import {
  barSpan,
  barTotalSec,
  viewSpan,
  zoomFromSpan,
  panFromSpan,
  fitZoom,
  minZoom,
  scrollForZoomAtPlayhead
} from './zoomBar'

const TOTAL = 100 // 秒
const VIEW = 800 // px
const LIM = { min: 6, max: 240 }

// **描くための値と、掴むための値は別**（2026-08-06）。
// つまみは 0〜1 に収まるが、倍率はその外へも動く。両端で食い違うので、
// 掴んだときに「描いてある位置」から倍率を出し直すと**その瞬間に飛ぶ**
//（本人の言葉:「ワープする」）。掴むときは丸めない方（viewSpan）を使う。
describe('丸めない範囲（掴むときの起点）', () => {
  it('全部見えているときは 1 を超える（描く方は 1 で止まる）', () => {
    // 100秒 × 4px/秒 = 400px しかないのに、画面は 800px ある＝2画面ぶん見えている
    const 掴む = viewSpan(0, VIEW, TOTAL, 4)
    expect(掴む.b - 掴む.a).toBeCloseTo(2)
    expect(barSpan(0, VIEW, TOTAL, 4)).toEqual({ a: 0, b: 1 })
  })

  it('普通に寄っているときは、描く方と同じ', () => {
    const 掴む = viewSpan(0, VIEW, TOTAL, 32)
    const 描く = barSpan(0, VIEW, TOTAL, 32)
    expect(掴む.a).toBeCloseTo(描く.a)
    expect(掴む.b).toBeCloseTo(描く.b)
  })

  it('**掴んだ範囲から倍率を出すと、元の倍率に戻る**（掴んだ瞬間に飛ばない）', () => {
    for (const z of [4, 8, 32, 200]) {
      const s = viewSpan(0, VIEW, TOTAL, z)
      const r = zoomFromSpan(s, TOTAL, VIEW, { min: 0.1, max: 1000 })
      expect(r.zoom).toBeCloseTo(z, 5)
    }
  })
})

describe('拡大バーの範囲', () => {
  it('全部見えているときは端から端まで', () => {
    // 100秒 × 8px/秒 = 800px ＝ ちょうど画面いっぱい
    expect(barSpan(0, VIEW, TOTAL, 8)).toEqual({ a: 0, b: 1 })
  })

  it('寄っているときは、見えている割合だけになる', () => {
    // 100秒 × 32px/秒 = 3200px のうち 800px ぶん＝1/4
    const s = barSpan(0, VIEW, TOTAL, 32)
    expect(s.a).toBeCloseTo(0, 6)
    expect(s.b).toBeCloseTo(0.25, 6)
  })

  it('右へ送ると、つまみも右へ動く', () => {
    const s = barSpan(1600, VIEW, TOTAL, 32)
    expect(s.a).toBeCloseTo(0.5, 6)
    expect(s.b).toBeCloseTo(0.75, 6)
  })
})

describe('つまみから拡大率を出す', () => {
  it('つまみを狭めると寄る', () => {
    const wide = zoomFromSpan({ a: 0, b: 1 }, TOTAL, VIEW, LIM)
    const narrow = zoomFromSpan({ a: 0, b: 0.25 }, TOTAL, VIEW, LIM)
    expect(narrow.zoom).toBeGreaterThan(wide.zoom)
    expect(narrow.zoom).toBeCloseTo(32, 6) // 25秒を 800px で見る
  })

  // **右のボッチを掴んだのに左まで動くと、見ていた場所を見失う。**
  it('右の端を動かしても、左の端は動かない', () => {
    const r = zoomFromSpan({ a: 0.5, b: 0.75 }, TOTAL, VIEW, LIM, 'r')
    // 左端 50秒 のまま
    expect(r.scrollLeft / r.zoom).toBeCloseTo(50, 6)
  })

  it('左の端を動かしても、右の端は動かない', () => {
    const r = zoomFromSpan({ a: 0.5, b: 0.75 }, TOTAL, VIEW, LIM, 'l')
    // 右端 75秒 のまま（左端＝右端 − 見えている秒数）
    expect(r.scrollLeft / r.zoom + VIEW / r.zoom).toBeCloseTo(75, 6)
  })

  it('限界より寄れない・引けない', () => {
    expect(zoomFromSpan({ a: 0, b: 0.001 }, TOTAL, VIEW, LIM).zoom).toBe(LIM.max)
    expect(zoomFromSpan({ a: 0, b: 1 }, 10000, VIEW, LIM).zoom).toBe(LIM.min)
  })

  // **バーの外へ引けないと、入口ごとに行ける所が変わる**（2026-08-06）。
  // Ctrl+ホイールは下限まで引けるのに、バーは「全体が1画面」で止まっていた。
  // 同じ物を操る2つの入口で、片方だけ最大まで縮小できないのは読めない
  it('**バーの端を越えて引ける**（越えたぶんは下限で止まる）', () => {
    const edge = zoomFromSpan({ a: 0, b: 1 }, TOTAL, VIEW, LIM)
    const past = zoomFromSpan({ a: 0, b: 1.8 }, TOTAL, VIEW, LIM)
    expect(past.zoom).toBeLessThan(edge.zoom)
    expect(past.zoom).toBeGreaterThanOrEqual(LIM.min)
  })

  it('左の●も端を越えて引ける', () => {
    const edge = zoomFromSpan({ a: 0, b: 1 }, TOTAL, VIEW, LIM, 'l')
    const past = zoomFromSpan({ a: -0.8, b: 1 }, TOTAL, VIEW, LIM, 'l')
    expect(past.zoom).toBeLessThan(edge.zoom)
    expect(past.scrollLeft).toBeGreaterThanOrEqual(0)
  })

  // **細さの下限をここに置いてはいけない。** 置くと、短い素材では
  // つまみの下限に先に当たって拡大の上限まで寄れなくなる（Ctrl+ホイールとも食い違う）。
  // 潰れたつまみは描くときに最低幅を持たせる（CSS）ので、ここは上限まで寄れてよい
  it('つまみを潰しても壊れず、上限まで寄れる', () => {
    const r = zoomFromSpan({ a: 0.5, b: 0.5 }, TOTAL, VIEW, LIM)
    expect(r.zoom).toBe(LIM.max)
    expect(Number.isFinite(r.scrollLeft)).toBe(true)
  })
})

describe('つまみを丸ごと動かす（移動）', () => {
  it('拡大率は変わらず、見る所だけ動く', () => {
    const span = { a: 0, b: 0.25 }
    expect(panFromSpan(0.5, span, TOTAL, 32)).toBeCloseTo(0.5 * TOTAL * 32, 6)
  })

  it('右へ行き過ぎない（つまみが端からはみ出さない）', () => {
    const span = { a: 0, b: 0.25 }
    // 0.9 まで動かしても、右端は 1.0 で止まる＝左端は 0.75
    expect(panFromSpan(0.9, span, TOTAL, 32)).toBeCloseTo(0.75 * TOTAL * 32, 6)
  })

  it('左へも行き過ぎない', () => {
    expect(panFromSpan(-0.5, { a: 0.3, b: 0.5 }, TOTAL, 32)).toBe(0)
  })
})

// **目一杯引いたら全体が見える**（2026-08-03。プレミアに揃えた）。
//
// 前は下限が 6px/秒 の固定で、しかも「↔ 全体表示」も同じ 6 で頭打ちだったので、
// **長い素材では全体を見る手段が1つも無かった**。
describe('引ける下限と、全体が収まる率', () => {
  it('全体が収まる率は「見えている幅 ÷ 長さ」（余白ぶんだけ引く）', () => {
    // 1,000px の窓に 100秒 → 余白40を引いて 960/100 = 9.6px/秒
    expect(fitZoom(1000, 100)).toBeCloseTo(9.6, 6)
  })

  it('**短すぎる中身は 10秒として扱う**（0 除算と、寄りすぎで消えるのを防ぐ）', () => {
    expect(fitZoom(1000, 2)).toBeCloseTo(96, 6)
    expect(fitZoom(1000, 0)).toBeCloseTo(96, 6)
  })

  it('**長い素材では下限が下がる**（451秒の実データ。6px/秒では全体が入らない）', () => {
    const z = minZoom(1000, 451, 6)
    expect(z).toBeCloseTo(960 / 451, 6) // ≒ 2.13px/秒
    expect(z).toBeLessThan(6)
    // ここまで引ければ、451秒 × 2.13 ≒ 960px ＝ 窓に収まる
    expect(451 * z).toBeLessThanOrEqual(1000)
  })

  it('**短い素材では、全体が収まった先も引ける**（引ける範囲を狭めない）', () => {
    // 20秒なら全体が収まる率は 48px/秒。そこで止めると**今より引けなくなる**ので、
    // 小さい方（＝固定の下限 6）を採る
    expect(minZoom(1000, 20, 6)).toBe(6)
  })

  it('幅が測れないときは、固定の下限のまま（起動直後に 0 で潰れない）', () => {
    expect(minZoom(0, 451, 6)).toBe(6)
    expect(minZoom(NaN, 451, 6)).toBe(6)
  })
})

// **バーが描くのは「引き切って見える範囲」**（2026-08-06・本人の指定）。
// 「バーのマックス状態を、かなり引いたタイムラインの状態にしてほしい」
//
// 一度は逆（全体が収まる所を限界にする）にしたが、本人が欲しかったのは
// **引ける範囲はそのままで、バーの方を伸ばす**だった。
describe('バーが描く範囲', () => {
  it('**引き切ると、ちょうど満杯になる**（短い素材）', () => {
    // 20秒・窓1000px・下限6 → 引き切ると 1000/6 ≒ 167秒ぶん見える
    const total = barTotalSec(1000, 20, 6)
    expect(total).toBeCloseTo(1000 / 6, 6)
    // その倍率で描くと、見えている範囲＝バーの範囲＝満杯
    expect(barSpan(0, 1000, total, 6)).toEqual({ a: 0, b: 1 })
  })

  it('**全体が収まった所では、まだ満杯ではない**（そこから先も引ける）', () => {
    const total = barTotalSec(1000, 20, 6)
    const s = barSpan(0, 1000, total, fitZoom(1000, 20))
    expect(s.b - s.a).toBeLessThan(1)
  })

  it('長い素材では、素材の長さとほぼ同じ（下限＝全体が収まる率のため）', () => {
    // 451秒なら下限は 960/451 ≒ 2.13px/秒。引き切って見えるのは
    // 1000/2.13 ≒ 470秒（fitZoom の余白 40px のぶんだけ素材より少し長い）
    expect(barTotalSec(1000, 451, 6)).toBeCloseTo((451 * 1000) / 960, 6)
  })

  it('タイムラインより短くはならない', () => {
    expect(barTotalSec(1000, 451, 6)).toBeGreaterThanOrEqual(451)
    expect(barTotalSec(1000, 20, 6)).toBeGreaterThanOrEqual(20)
  })
})

// ---------------------------------------------------------------------------
// 拡大の軸は再生ヘッド（プレミアと同じ。2026-08-05・本人の指定）
//
// **画面越しには確かめにくい所。** 寄ったあとに画面が数十px ずれても
// 「そういうものか」と見えてしまい、目では気づけない。数で固定する。
describe('拡大したときの横位置（軸は再生ヘッド）', () => {
  /** 寄せたあと、ヘッドが画面のどこに来るか（px） */
  const headAfter = (t: number, nz: number, headX: number, viewW = 1000): number =>
    t * nz - scrollForZoomAtPlayhead(t, nz, headX, viewW)

  it('**ヘッドが画面に見えていれば、同じ位置に留まる**', () => {
    // 100秒地点。ヘッドが画面の 200px に居る状態から 40px/秒 へ寄せる。
    // 寄せたあとも 200px の所に居ること＝画面が動いたように見えない
    expect(headAfter(100, 40, 200)).toBe(200)
  })

  it('引いたときも同じ位置に留まる', () => {
    expect(headAfter(100, 5, 300)).toBe(300)
  })

  it('**画面の外に居たら、真ん中へ連れてくる**（見えない点を軸にしない）', () => {
    // 軸をそのまま使うと、寄るほど遠ざかる（見えていない所を中心に回る）
    expect(headAfter(100, 40, -500)).toBe(500)
    expect(headAfter(100, 40, 1800)).toBe(500)
  })

  it('端（0 と 幅ちょうど）は「見えている」に入れる', () => {
    expect(headAfter(100, 40, 0)).toBe(0)
    expect(headAfter(100, 40, 1000)).toBe(1000)
  })

  it('**先頭の近くでは、留まれずに左へ寄る**（そこは正しい）', () => {
    // 左に送る余地が無い（scrollLeft は負にできない）ので、頭のうちは
    // ヘッドが左へ滑る。**留めようとして先頭より手前を見せてはいけない**
    expect(scrollForZoomAtPlayhead(10, 5, 300, 1000)).toBe(0)
    expect(headAfter(10, 5, 300)).toBe(50) // 10秒 × 5px/秒 の所に見える
  })

  it('0秒なら必ず先頭（負の scrollLeft を作らない）', () => {
    expect(scrollForZoomAtPlayhead(0, 40, 500, 1000)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// **「追い出さないだけ」はやめた**（2026-08-06・本人の指定で軸へ戻した）
//
// 08-05 は「●が指の下から逃げるから軸にしない」で、ヘッドが画面の外へ出そうな
// ときだけ送り返す `keepPlayheadVisible` を使っていた。**それが逆に読めない
// 動きを作った**——ほとんどの間は指に付いてくるのに、**端に来た瞬間だけ**
// 別の力で引っぱられる。いつ起きるか手前で読めないので、不具合に見える。
//
// いまは拡大バーも `scrollForZoomAtPlayhead`（上のブロック）。動きが1つになる。
// 関数も試験もここで消した——**呼ばれない物を残すと、次に読む人が
// 「バーはこう動く」と信じる**（コメントにそう書いてあった）。
