// **組版の下ごしらえ。** 文字を測って、余白と座標と枠の大きさを決める所まで。
// ここから先（背景・影・縁・塗り）は ./telopSvg が段を積む。
//
// ## ここが「全部の段が乗る土台」
//
// 影も縁も塗りも、**同じ座標と同じ `<text>` の属性**を使う。1つでもズレると
// 段どうしが重ならず、輪郭が二重に見える。だから座標を作る所を1つにしてある。
//
// ## 縦書きは「置き方」だけを変える
//
// 縁・影・グラデ・部分装飾は `<text>` に掛かっているので、置き方を変えても
// そのまま効く。縦組みは `writing-mode: vertical-rl` に任せる——自分で1文字ずつ
// 座標を計算すると、約物（。、）・合字・拡大文字が全部自前計算になり、
// **横書きと縦書きで別の組版を2つ持つ**ことになる。
//
// ## 測る所はブラウザに聞く
//
// 文字の実寸は canvas（./telopMeasure）。**画面と同じ物を使い回す**ので、
// ここで自前に測らない。canvas が無い所（試験）では実測を飛ばす。
//
// ## なぜ ./telopSvg から出したか（2026-08-04）
//
// あちらは594行のうち448行が1つの関数で、**後ろが前の全部に乗っていた**。
// 記号解決で測ったら「94行を出すのに導管21本」で、行を動かすだけでは割に合わない。
//
// **導管を1本にするには、下ごしらえを1つの値にまとめるしかない。**
// それがここ（`TelopLayout`）。段を積む側は、この値だけを受け取る。
//
// 先に**出力そのものを固定する試験**を書いてから動かした
//（`telopSvg.golden.test.ts`。21ケース・SVG 文字列を1バイトも変えない）。
// あれが無いと、この作り直しは「画面では出るのに書き出すと違う」を
// 静かに作る——このアプリで一番怖い壊れ方で、型検査では捕まらない。
//
// ## 中身
//
// - `TelopLayout` … 下ごしらえの結果（段を積む側が受け取る唯一の値）
// - `xmlEsc` … XML に入れてよい形にする。**段を積む側も同じ物を使う**
// - `autoIconHeight` … 自動調整のアイコンの高さ。**画面と書き出しの両方が通る**
// - `telopLayout` … 上を作る
import {
  FAUX_ITALIC,
  ITALIC_SKEW_DEG,
  LINE_BASE,
  SHADOW_BLUR_COEF,
  SHADOW_DIST_COEF,
  SHADOW_SPREAD_COEF
} from './telopStyle'
// 文字の実寸はブラウザに聞く。**画面と同じ canvas を使い回す**
import { inkContext, quoteFamilies } from './telopMeasure'
import type { ShadowSpec, StrokeLayer, TelopStyle } from './telopStyle'
import type { TextRun } from './telopSvg'

/**
 * XML に入れてよい形にする。
 *
 * **段を積む側（./telopSvg）も同じ物を使う。** 別々に書くと、片方だけが
 * 「&」を escape しない形になって、そこだけ SVG が壊れる（絵が出ない）。
 */
export function xmlEsc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** 段を積む側が要る物。**これ1つで足りる**（前は21個の名前が散っていた） */
export interface TelopLayout {
  FS: number
  weight: number
  /** 引用符を付けたフォント名（canvas へ渡す形） */
  qf: string
  lines: string[]
  tracking: number
  /** 縦書きか。**変わるのは「文字の置き方」と「枠の縦横」だけ** */
  vert: boolean
  /** 文字の実測に使う canvas。無い所（試験）では null */
  inkCtx: CanvasRenderingContext2D | null
  /** 使う縁（enabled の物だけ） */
  strokes: StrokeLayer[]
  /** その縁が塗りの外へどれだけ出るか（px） */
  outward: (st: StrokeLayer) => number
  /** 一番外へ出る縁の量 */
  maxOut: number
  /** 角の結合。縁もシャドウ輪郭も同じ */
  lj: 'miter' | 'round'
  /** 使う影（1枚指定と複数指定を1本にまとめた物） */
  shList: ShadowSpec[]
  /** viewBox の余白（＝装飾のはみ出し分） */
  pad: number
  /** 枠の大きさ（1080基準px） */
  W: number
  H: number
  textW: number
  textH: number
  anchor: 'start' | 'middle' | 'end'
  /** 行の寄せ位置 */
  ax: number
  /** i 行目（縦書きでは i 列目）の位置 */
  yOf: (i: number) => number
  /** 1行ぶんの tspan に付ける座標。**縦書きは x と y の役目が入れ替わる** */
  posAttr: (i: number) => string
  /** 全文均一の tspan 列（縁・影が使う） */
  tspans: string
  /** `<text>` に付ける属性（**全部の段で同じ物を使う**） */
  fontAttr: string
  /** 縁・影用の `<text>` を1枚作る */
  textEl: (extra: string) => string
  /** 斜体の傾け。**下端固定で上が右へ倒れる** */
  skew: string
}

/**
 * 自動調整のアイコンの高さ（1080基準px）。**画面と書き出しの両方がここを通る。**
 *
 * ## 行数では変えない（2026-08-16・本人の指定）
 *
 * 前は「テキストの塊の高さに合わせる」で、`行の高さ × 行数 × 係数`
 *（1行 1.4 / それ以外 1.15）だった。**1行を2行にした瞬間にアイコンが 1.64倍**になる。
 * 本人の言葉:「1行のやつを2行にした時とか。**1行の時と同じ大きさでかつ
 * アイコンの大きさを変えないようにしたい**」。
 *
 * いまは**文字の大きさだけ**で決まる（1行のときの見え方が基準）。行が増えても
 * アイコンは動かないので、打ち直しで顔の大きさが変わらない。
 *
 * ※ **同じ式を2か所に書かない。** 前は `TelopText.tsx`（画面）と
 *   `lib/rasterize.ts`（書き出し）に同じ行が並んでいて、コメントで
 *   「TelopText.tsx と同式」と約束していただけだった。片方だけ直せば
 *   **画面と書き出しでアイコンの大きさが違う**という、書き出すまで気づけない形になる。
 */
export function autoIconHeight(s: TelopStyle): number {
  return s.fontSize * (LINE_BASE + s.leading / 100) * 1.4
}

/** 文字を測って、余白・座標・枠の大きさを決める */
export function telopLayout(s: TelopStyle, text?: string, runs?: TextRun[]): TelopLayout {
  const FS = s.fontSize
  const weight = s.bold ? 800 : 500
  const lineH = LINE_BASE + s.leading / 100
  const ff = s.fontFamily
  const qf = quoteFamilies(ff)
  const lines = (text || 'あ').split('\n')
  const tracking = (FS * (s.tracking || 0)) / 1000
  // 部分装飾(runs)の文字index gi を含む run（後勝ち）。幅/高さ計算にも使う。
  const runOfIdx = (gi: number): TextRun | null => {
    let hit: TextRun | null = null
    if (runs) for (const r of runs) if (gi >= r.start && gi < r.end) hit = r
    return hit
  }
  // 文字幅を実測（canvas。measureInkRangeと同じ inkCtx を再利用）。
  // 部分装飾で拡大/フォント変更した文字がある時だけ per-char 実測（その実効サイズ/フォントで測り枠を一致させる）。
  // 無い時は従来の行まるごと実測＝カーニング込みで正確・高速（既存テロップの幅を1pxも変えない）。
  const hasMetricRuns = !!runs && runs.some((r) => r.fontFamily || (r.sizeScale && r.sizeScale !== 1))
  const inkCtx = inkContext()
  let maxW = FS
  let maxEffFS = FS // 最大の実効フォントサイズ（拡大文字ぶん上に伸びる余白の算出用）
  if (inkCtx) {
    inkCtx.font = '10px monospace'
    inkCtx.font = `${weight} ${FS}px ${qf}`
    const baseFam = inkCtx.font === '10px monospace' ? 'sans-serif' : qf
    inkCtx.font = `${weight} ${FS}px ${baseFam}`
    if (!hasMetricRuns) {
      maxW = Math.max(
        1,
        ...lines.map((l) => inkCtx!.measureText(l).width + tracking * Math.max(0, [...l].length - 1))
      )
    } else {
      let gi = 0
      const widths = lines.map((l) => {
        let w = 0
        const chars = [...l]
        for (const ch of chars) {
          const r = runOfIdx(gi)
          const eff = r?.sizeScale && r.sizeScale !== 1 ? Math.round(FS * r.sizeScale) : FS
          if (eff > maxEffFS) maxEffFS = eff
          const fam = r?.fontFamily ? quoteFamilies(r.fontFamily) : baseFam
          inkCtx!.font = `${weight} ${eff}px ${fam}`
          w += inkCtx!.measureText(ch).width
          gi += ch.length // UTF-16 index を進める（サロゲート対応）
        }
        gi += 1 // 改行分
        return w + tracking * Math.max(0, chars.length - 1)
      })
      maxW = Math.max(1, ...widths)
      inkCtx.font = `${weight} ${FS}px ${baseFam}` // 後続(bgRects等)の実測のため基準フォントへ戻す
    }
  }
  // 拡大文字は下端そろえで「上」に伸びるので、その分だけ上に余白が要る（枠が本体を含むように）。
  const enlargedTop = Math.ceil(Math.max(0, maxEffFS - FS))
  const strokes = (s.strokes || []).filter((st) => st.enabled)
  // 外向き寄与(px)。塗りの後ろに膨張シルエットで重なり、塗りの外にはみ出た分が見える。
  //   outside:幅 / center:幅の半分 / inside:0（塗り最前面なので内側は隠れる＝見えない）。
  //   ※geba取り込みで inside と誤読された縁は center へ修正済み（白縁は基本 center）。
  const outward = (st: StrokeLayer): number =>
    st.position === 'outside' ? st.width : st.position === 'inside' ? 0 : st.width / 2
  // 角の結合（フォント全体共通＝縁もシャドウ輪郭も同じ）。既定 miter。
  const lj = s.join === 'round' ? 'round' : 'miter'
  const maxOut = Math.max(0, ...strokes.map(outward))
  // 影は文字の影（背景箱の上に落ちる）。背景は最背面のただの箱＝箱自体に影は付かない。
  const shList = [
    ...(s.shadow && s.shadow.enabled ? [s.shadow] : []),
    ...((s.shadows || []).filter((x) => x.enabled !== false))
  ]
  // pad(viewBox余白)計算は部分装飾(runs)の縁/影も含めて十分大きく取る
  const padStrokes = [...strokes]
  const padShadows = [...shList]
  if (runs)
    for (const r of runs) {
      if (r.strokes) padStrokes.push(...r.strokes.filter((st) => st.enabled))
      if (r.shadows) padShadows.push(...r.shadows.filter((x) => x.enabled !== false))
    }
  const padOut = Math.max(0, ...padStrokes.map(outward))
  let shReach = 0
  for (const sd of padShadows) {
    shReach = Math.max(
      shReach,
      Math.abs((sd.distance || 0) * SHADOW_DIST_COEF) +
        (sd.spread || 0) * 0.667 * SHADOW_SPREAD_COEF +
        (sd.blur || 0) * 0.075 * SHADOW_BLUR_COEF * 3 +
        padOut
    )
  }
  const pad = Math.ceil(Math.max(padOut, shReach) + FS * 0.12)

  // ===== 縦書きか横書きか。**変えるのは「文字の置き方」と「枠の縦横」だけ** =====
  //
  // 縁・影・グラデ・部分装飾は `<text>` に掛かっているので、置き方を変えても
  // そのまま効く（＝画面と書き出しで別々の式にならない）。
  //
  // 縦組みは `writing-mode: vertical-rl` に任せる。自分で1文字ずつ座標を計算すると、
  // 約物（。、）の位置・合字・部分装飾の拡大文字が全部自前計算になり、
  // **横書きと縦書きで別の組版を2つ持つ**ことになる。
  const vert = !!s.vertical
  /** 縦組みの1列ぶんの長さ（文字数×字送り）。和文は1文字＝1em で送る */
  const colLen = (l: string): number => {
    const n = [...l].length
    return n * FS + tracking * Math.max(0, n - 1)
  }
  const maxColLen = vert ? Math.max(FS, ...lines.map(colLen)) : 0
  // 枠（選択箱）の大きさ。横書きは「幅＝一番長い行／高さ＝行数」、縦書きはその逆。
  const textW = vert ? lines.length * lineH * FS : maxW
  const textH = vert ? maxColLen + enlargedTop : lines.length * lineH * FS + enlargedTop
  const W = Math.ceil(textW + pad * 2)
  const H = Math.ceil(textH + pad * 2)
  // 寄せ。**縦書きでは「行の中の寄せ」が上下方向になる**（左＝上／右＝下）。
  const anchor = s.align === 'left' ? 'start' : s.align === 'right' ? 'end' : 'middle'
  const ax = vert
    ? s.align === 'left'
      ? pad + enlargedTop
      : s.align === 'right'
        ? H - pad
        : pad + enlargedTop + (H - pad - (pad + enlargedTop)) / 2
    : s.align === 'left'
      ? pad
      : s.align === 'right'
        ? W - pad
        : W / 2
  /**
   * 行（縦書きでは列）の位置。
   *
   * 横書き: i 行目のベースライン。拡大文字ぶん(enlargedTop)を下げる。
   * 縦書き: i 列目の中心。**右から左へ**並べる（日本語の縦組み）。
   */
  const yOf = (i: number): number =>
    vert
      ? W - pad - (i + 0.5) * lineH * FS
      : pad + enlargedTop + (i + 0.5) * lineH * FS
  /** 1行（1列）ぶんの tspan に付ける座標。縦書きは x と y の役目が入れ替わる */
  const posAttr = (i: number): string =>
    vert
      ? `x="${yOf(i).toFixed(1)}" y="${ax.toFixed(1)}"`
      : `x="${ax.toFixed(1)}" y="${yOf(i).toFixed(1)}"`
  const lsAttr = tracking ? ` letter-spacing="${tracking.toFixed(2)}"` : ''
  const tspans = lines.map((l, i) => `<tspan ${posAttr(i)}>${xmlEsc(l) || ' '}</tspan>`).join('')
  const famAttr = ff.replace(/"/g, '&quot;').replace(/'/g, '')
  // 縦組みは書字方向を宣言するだけ。**1文字ずつ座標を置きに行かない**
  //（そうすると約物・合字・拡大文字が全部自前計算になり、組版が2つに割れる）
  const wmAttr = vert ? 'writing-mode:vertical-rl;text-orientation:upright;' : ''
  const fontAttr = `font-family='${famAttr}' font-size="${FS}" font-weight="${weight}" text-anchor="${anchor}" dominant-baseline="central"${lsAttr} style="${wmAttr}font-synthesis:none;white-space:pre"`
  // 縁/影用は全文均一の tspans（textEl）。塗り用は runs で文字ごとに上書きした fillTspans を使う。
  const textEl = (extra: string): string => `<text ${fontAttr} ${extra}>${tspans}</text>`
  // 斜体は「下端固定・上が右へ倒れる」: skewX の基準を最下端＋ディセンダー余裕(0.25em)に
  // 置く（既定基準(上端)だと下側が左へせり出し、左に置くコラボアイコンへ被ってしまうため。
  //「ぷ」等のディセンダーは行ボックス(0.9em)の下へ出るので、その分の余裕も含めて左へ一切出さない）。
  const skewShift = Math.tan((ITALIC_SKEW_DEG * Math.PI) / 180) * (H + FS * 0.25)
  const skew =
    s.italic && FAUX_ITALIC
      ? ` transform="translate(${skewShift.toFixed(1)},0) skewX(-${ITALIC_SKEW_DEG})"`
      : ''

  return {
    FS, weight, qf, lines, tracking, vert, inkCtx,
    strokes, outward, maxOut, lj, shList,
    pad, W, H, textW, textH, anchor, ax, yOf, posAttr, tspans, fontAttr, textEl, skew
  }
}
