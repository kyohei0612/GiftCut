// テロップを SVG に組み立てる。**書き出し（PNG に焼く）用。**
//
// ## 画面は CSS、書き出しは SVG
//
// 画面は `computeTelopCss`（./telopStyle）で CSS を当てて出している。
// 書き出しはその絵を PNG にする必要があるので、同じ見た目を SVG で組み直す。
//
// **2つの経路がある**ので、片方だけ直すと「画面では出るのに書き出すと出ない」
// （逆も）になる。見た目に関わる項目を足したら、必ず両方を直すこと。
// 突き合わせは `npm run frames`（1コマずつ画素で確認）。
//
// ## 色は OkLab で混ぜる
//
// グラデーションを RGB のまま混ぜると、中間が濁って見える（特に補色どうし）。
// `_oklab` 系はそのための変換。**プレビューの `gradientStopStr` と同じ結果**に
// なるように作ってある（別々の混ぜ方にすると、画面と書き出しで色が変わる）。
//
// ## `_` で始まる関数は、このファイルの中だけの物
//
// 外から呼ばない。呼びたくなったら、それは共通の計算なので ../../../shared へ出す。
//
// ## 割らなかった。**測ったうえでの判断**（2026-08-04）
//
// 566行のうち **448行が `buildTelopSVG` 1つ**で、中は1本のパイプライン:
//
//   実寸を測る → 余白を決める → 縦横の座標 → 塗りの tspan →
//   背景ハイライト → 部分装飾の下ごしらえ → 影 → 縁 → 塗り → svg を組む
//
// **後ろが前の全部に乗っている。** 記号解決で測った実測:
//
//   部分装飾の下ごしらえ   94行を出すのに 連れて行く文33 ／ 受け取る15 ／ **返す21**
//   塗りの組み立て         10行だけ（出す意味が無い）
//
// 94行のために導管を21本作るのは割に合わない。**「またぐ名前40以下なら割る」は
// このリポジトリ自身が撤回している**——書く側の手間しか測っておらず、読む側の
// 負担（部分読みは毎回・導管は1回）を測っていなかったため（`引き継ぎ-心臓の分け直し.md`）。
//
// ## 割るとしたら「行を動かす」ではなく作り直し
//
// 正しい形は **①組版の下ごしらえを1つの値にまとめる（Layout）②その値を受け取って
// 段を1枚ずつ返す**（背景・影・縁・塗りの4枚）。そうすれば導管は Layout 1つになる。
//
// ただしこれは行の移動ではなく設計変更なので、**画素で突き合わせる確認
//（`npm run frames`）が要る**。このファイルの一番怖い壊れ方は
// 「画面では出るのに書き出すと出ない」で、型検査も単体試験も捕まえられない。
//
// **目で見て諦めない。** 上の数字は記号解決で出した物で、やり直すなら測り直すこと。

import {
  MITER_LIMIT,
  SHADOW_BLUR_COEF,
  SHADOW_DIST_COEF,
  SHADOW_SPREAD_COEF
} from './telopStyle'
// **中間点の決め方は ./telopFill に1つだけ。** 画面（CSS）と同じ結果にするため
import { resolveGradMid } from './telopFill'
// 文字の実寸はブラウザに聞く（./telopMeasure）。**画面と同じ canvas を使い回す**ので、
// SVG 側でも自前に測らない。2026-08-03 まで ./telopStyle 経由で借りていたが、
// あちらのスタイル定数とは無関係だったので直に引く。
// 組版の下ごしらえ（測る・余白・座標・枠）。**段を積む前に必ずここを通る**
import { telopLayout, xmlEsc } from './telopLayout'
// 文字の実寸はブラウザに聞く（部分装飾の背景ハイライトを測るのに要る）
import { quoteFamilies } from './telopMeasure'
import type { FillGradient, ShadowSpec, StrokeLayer, TelopStyle } from './telopStyle'
import { alphaAt, oklabLerp } from '../../../shared/color'

// ※ oklab の変換と16進の行き来（_hex2rgb / _rgb2hex / _s2l / _l2s /
//    _rgb2oklab / _oklab2rgb / _oklabLerp）は shared/color へ出した。
//    **components/FillPicker にも同じ計算があった**（このファイルの頭が
//    「呼びたくなったら shared へ出す」と書いている、まさにその状態）。
//    書き出しと画面で色がズレないよう1本に寄せた（2026-08-03）。
//
//    寄せたことで、`#abc` のような3桁の16進も正しく読めるようになった
//    （こちら側は3桁を黒にしていた）。

let _svgGradId = 0
let _svgFilterId = 0 // 影ぼかしfilter用のグローバル一意カウンタ（同一documentでのid衝突を防ぐ）
function _gradDef(id: string, g: NonNullable<TelopStyle['fill']['gradient']>): string {
  const stops = g.stops
  const SAMPLES = 10 // 各区間のoklabサンプル数
  const out: [number, string][] = []
  for (let i = 0; i < stops.length; i++) {
    const s = stops[i]
    const next = stops[i + 1]
    if (!next) {
      out.push([s.pos, s.color])
      continue
    }
    const mid = resolveGradMid(s.color, next.color, s.mid)
    for (let k = 0; k < SAMPLES; k++) {
      const u = k / SAMPLES
      const t = u <= mid ? 0.5 * (u / mid) : 0.5 + 0.5 * ((u - mid) / (1 - mid))
      out.push([s.pos + u * (next.pos - s.pos), oklabLerp(s.color, next.color, t)])
    }
  }
  out.push([stops[stops.length - 1].pos, stops[stops.length - 1].color])
  const stopsXml = out
    .map(
      ([p, c]) =>
        `<stop offset="${Math.max(0, Math.min(1, p)).toFixed(4)}" stop-color="${c}" stop-opacity="${alphaAt(
          g.opacityStops,
          p
        ).toFixed(3)}"/>`
    )
    .join('')
  if (g.type === 'radial') return `<radialGradient id="${id}" cx="0.5" cy="0.5" r="0.6">${stopsXml}</radialGradient>`
  // 角度→SVGベクトル(objectBoundingBox)。Premiere90=縦。CSS相当角 N=angle+90(0=上,時計回り)
  const N = ((g.angle + 90) * Math.PI) / 180
  const vx = Math.sin(N), vy = -Math.cos(N) // CSS角Nの「to方向」ベクトル(y-down)
  // offset0=START=center-v*0.5, offset1=END=center+v*0.5（x/y同じ向き）。
  // 旧: y1に+vyを使いx/yで向きが不一致→縦グラデが上下反転してた（本家は上=stop0）。
  const x1 = (0.5 - vx * 0.5).toFixed(4), y1 = (0.5 - vy * 0.5).toFixed(4)
  const x2 = (0.5 + vx * 0.5).toFixed(4), y2 = (0.5 + vy * 0.5).toFixed(4)
  return `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stopsXml}</linearGradient>`
}

export interface TelopSvg {
  svg: string // <svg>...</svg> 文字列
  w: number // viewBox幅（1080基準px）
  h: number // viewBox高（1080基準px）
  textW: number // ストローク/影を除いた文字ボックス幅（レイアウト用）
  textH: number // 同 高さ
  pad: number // viewBoxの余白（＝装飾はみ出し分。負マージンでレイアウト補正に使う）
}

/**
 * テロップ本文をSVG文字列で生成（本家paint-order:strokeモデル）。プレビュー/サムネ/書き出し共通。
 * 返り値の w/h は 1080基準px。呼び出し側で cqh 等にスケールして配置する。
 */
// テロップ内の文字範囲ごとのスタイル上書き（部分装飾）。start/end は text の文字インデックス(UTF-16, end排他)。
export interface TextRun {
  start: number
  end: number
  color?: string
  gradient?: FillGradient // 選択文字だけのグラデ塗り（color より優先）
  fontFamily?: string
  sizeScale?: number // 文字サイズ倍率（1=既定）
  bgColor?: string // 選択文字だけの背景ハイライト色
  strokes?: StrokeLayer[] // 選択文字だけの縁（指定時は全体の縁を置換。[]=縁なし）
  shadows?: ShadowSpec[] // 選択文字だけの影（指定時は全体の影を置換。[]=影なし）
  join?: 'miter' | 'round' // 選択文字だけの角結合
}

export function buildTelopSVG(s: TelopStyle, text?: string, runs?: TextRun[]): TelopSvg {
  // **組版の下ごしらえは ./telopLayout に1つだけ。** 影も縁も塗りも、
  // ここで決めた同じ座標・同じ `<text>` の属性を使う（1つでもズレると輪郭が二重になる）
  const {
    FS, weight, qf, lines, tracking, vert, inkCtx,
    strokes, outward, maxOut, lj, shList,
    pad, W, H, textW, textH, anchor, ax, yOf, posAttr, fontAttr, textEl, skew
  } = telopLayout(s, text, runs)
  // 部分装飾: グローバル文字index gi の run を返す（最後にマッチしたものを優先）
  const runAt = (gi: number): TextRun | null => {
    let hit: TextRun | null = null
    if (runs) for (const r of runs) if (gi >= r.start && gi < r.end) hit = r
    return hit
  }
  // 塗り tspans。run無しの文字は素の text（親<text>のfill＝グラデ/単色を継承）。
  // run文字は <tspan fill/font-family/font-size> で上書き。改行で gOff を +1（\n分）。
  let gOff = 0
  let runGradDefs = '' // run(部分装飾)専用グラデ定義。あとで defs に連結
  const fillTspans = lines
    .map((l, i) => {
      type Seg = { text: string; color?: string; grad?: FillGradient; fam?: string; size?: number }
      const segs: Seg[] = []
      for (let k = 0; k < l.length; k++) {
        const r = runAt(gOff + k)
        const color = r?.color
        const grad = r?.gradient
        const fam = r?.fontFamily
        const size = r?.sizeScale && r.sizeScale !== 1 ? Math.round(FS * r.sizeScale) : undefined
        const last = segs[segs.length - 1]
        if (last && last.color === color && last.grad === grad && last.fam === fam && last.size === size)
          last.text += l[k]
        else segs.push({ text: l[k], color, grad, fam, size })
      }
      gOff += l.length + 1
      const inner = segs.length
        ? segs
            .map((sg) => {
              if (!sg.color && !sg.grad && !sg.fam && !sg.size) return xmlEsc(sg.text)
              let fillA = ''
              if (sg.grad && sg.grad.stops && sg.grad.stops.length >= 2) {
                const gid = `rg${_svgGradId++}`
                runGradDefs += _gradDef(gid, sg.grad)
                fillA = ` fill="url(#${gid})"`
              } else if (sg.color) fillA = ` fill="${sg.color}"`
              const attrs =
                fillA +
                (sg.fam ? ` font-family='${sg.fam.replace(/"/g, '&quot;').replace(/'/g, '')}'` : '') +
                // 拡大文字は下端そろえで上に伸ばす（係数はfontOverrideOfのSIZE_SHIFT_Kと同値0.66）
                (sg.size ? ` font-size="${sg.size}" baseline-shift="${(0.66 * (sg.size - FS)).toFixed(1)}"` : '')
              return `<tspan${attrs}>${xmlEsc(sg.text)}</tspan>`
            })
            .join('')
        : ' '
      return `<tspan ${posAttr(i)}>${inner}</tspan>`
    })
    .join('')

  // 部分装飾の背景ハイライト（選択文字だけ bgColor）。最背面(影より後ろ)に矩形で敷く。
  // 文字送り(letter-spacing=tracking)込みで「文字ごとの実効フォント/サイズ」で実測し、run単位で連続する同色を1矩形に。
  let bgRects = ''
  // **縦書きでは敷かない。** ここは「行の左端から文字幅を足していく」横書き専用の
  // 計算で、縦組みに当てると見当違いの所に色が付く。**間違った箱を描くくらいなら
  // 描かない**（付いていないことは見れば分かるが、ずれた箱は不具合に見える）。
  const hasRunBg = !!runs && runs.some((r) => r.bgColor)
  if (hasRunBg && inkCtx && !vert) {
    let bo = 0
    const padY = FS * 0.14 // 上下の余白
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]
      // 文字ごとの幅と実効サイズ（拡大文字は拡大サイズで測る＝矩形が本体に一致）
      const cw: number[] = []
      const ce: number[] = []
      for (let k = 0; k < l.length; k++) {
        const r = runAt(bo + k)
        const eff = r?.sizeScale && r.sizeScale !== 1 ? Math.round(FS * r.sizeScale) : FS
        const fam = r?.fontFamily ? quoteFamilies(r.fontFamily) : qf
        inkCtx.font = `${weight} ${eff}px ${fam}`
        cw.push(inkCtx.measureText(l[k]).width)
        ce.push(eff)
      }
      const lineW = cw.reduce((a, b) => a + b, 0) + tracking * Math.max(0, l.length - 1)
      const left = anchor === 'start' ? ax : anchor === 'end' ? ax - lineW : ax - lineW / 2
      // 矩形の下端＝基準文字の箱の下端に固定（拡大文字は下端そろえで上に伸びるため、高さだけ上へ広げる）
      const bottom = yOf(i) + FS / 2 + padY
      let cx = left
      let runStart = -1
      let runColor: string | undefined
      let runEff = FS
      const flush = (endX: number): void => {
        if (runStart >= 0 && runColor) {
          const boxH = runEff + padY * 2
          bgRects += `<rect x="${runStart.toFixed(1)}" y="${(bottom - boxH).toFixed(1)}" width="${(endX - runStart).toFixed(1)}" height="${boxH.toFixed(1)}" fill="${runColor}"/>`
        }
        runStart = -1
        runColor = undefined
        runEff = FS
      }
      for (let k = 0; k < l.length; k++) {
        const bg = runAt(bo + k)?.bgColor
        if (bg !== runColor) {
          flush(cx)
          if (bg) {
            runStart = cx
            runColor = bg
          }
        }
        if (bg && ce[k] > runEff) runEff = ce[k]
        cx += cw[k] + tracking
      }
      flush(cx)
      bo += l.length + 1
    }
    inkCtx.font = `${weight} ${FS}px ${qf}` // 基準フォントへ戻す
  }

  // ===== 部分装飾: 文字ごとの縁/影 =====
  const totalChars = (text || 'あ').length
  const hasRunStrokes = !!runs && runs.some((r) => r.strokes)
  const hasRunShadows = !!runs && runs.some((r) => r.shadows)
  // 文字ごとの実効 縁/影/結合（run指定があれば置換、無ければ全体）
  const strokesAt = (gi: number): StrokeLayer[] => {
    const r = runAt(gi)
    return (r?.strokes ?? strokes).filter((st) => st.enabled)
  }
  const joinAt = (gi: number): string => ((runAt(gi)?.join ?? s.join) === 'round' ? 'round' : 'miter')
  const shadowsAt = (gi: number): ShadowSpec[] => {
    const r = runAt(gi)
    return r?.shadows ? r.shadows.filter((x) => x.enabled !== false) : shList
  }
  const strokeMaxOutAt = (gi: number): number => Math.max(0, ...strokesAt(gi).map(outward))
  // 拡大文字は「下端をそろえて上に伸ばす」。中央基準(dominant central)のままだと上下に膨らむため、
  // baseline-shift で上へ持ち上げて下端を合わせる。係数は central→文字下端 の比（SVG実測≈0.66）。
  // 係数×拡大差(size-FS)ぶん上げると基準文字と下端が一致（k倍でも線形に成立）。
  const SIZE_SHIFT_K = 0.66
  const sizeShiftAttr = (size: number): string =>
    ` baseline-shift="${(SIZE_SHIFT_K * (size - FS)).toFixed(1)}"`
  const fontOverrideOf = (gi: number): string => {
    const r = runAt(gi)
    let a = ''
    if (r?.fontFamily) a += ` font-family='${r.fontFamily.replace(/"/g, '&quot;').replace(/'/g, '')}'`
    if (r?.sizeScale && r.sizeScale !== 1) {
      const size = Math.round(FS * r.sizeScale)
      a += ` font-size="${size}"${sizeShiftAttr(size)}`
    }
    return a
  }
  // 汎用: 各文字の属性文字列 attrOf(gi) で <tspan> 分割（空文字列＝素テキスト＝親fill継承）。塗り/縁/影で共用。
  const layerTspans = (attrOf: (gi: number) => string): string => {
    let off = 0
    return lines
      .map((l, i) => {
        const segs: { text: string; attr: string }[] = []
        for (let k = 0; k < l.length; k++) {
          const attr = attrOf(off + k)
          const last = segs[segs.length - 1]
          if (last && last.attr === attr) last.text += l[k]
          else segs.push({ text: l[k], attr })
        }
        off += l.length + 1
        const inner = segs.length
          ? segs.map((sg) => (sg.attr ? `<tspan${sg.attr}>${xmlEsc(sg.text)}</tspan>` : xmlEsc(sg.text))).join('')
          : ' '
        return `<tspan ${posAttr(i)}>${inner}</tspan>`
      })
      .join('')
  }

  let defs = runGradDefs // 部分装飾グラデ定義を先に積む
  let body = bgRects // 部分装飾の背景ハイライトは最背面
  // ---- 影 ----
  let fid = 0
  if (!hasRunStrokes && !hasRunShadows) {
    // 従来パス（全文均一）。影の重ね順は【リスト順＝Premiere/blob順】: 影1(先頭)=最前面。末尾→先頭に描く。
    for (const sd of [...shList].reverse()) {
      const rad = ((sd.angle || 0) * Math.PI) / 180
      // Premiere/Adobeの影角度は 0°=上・時計回り（dx=sin, dy=-cos）。135°→右下。
      const dx = Math.sin(rad) * (sd.distance || 0) * SHADOW_DIST_COEF
      const dy = -Math.cos(rad) * (sd.distance || 0) * SHADOW_DIST_COEF
      const spr = (sd.spread || 0) * 0.667 * SHADOW_SPREAD_COEF // シルエット膨張(外向き)
      const swid = (maxOut + spr) * 2 // 影テキストのstroke-width（塗り+縁シルエット+膨張）
      const blur = (sd.blur || 0) * 0.075 * SHADOW_BLUR_COEF
      const op = (sd.opacity != null ? sd.opacity : 100) / 100
      let filt = ''
      if (blur > 0) {
        const fi = `shb${_svgFilterId++}_${fid++}`
        defs += `<filter id="${fi}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${blur.toFixed(2)}"/></filter>`
        filt = ` filter="url(#${fi})"`
      }
      // 塗りOFFの文字は「見えている形＝縁」から影が出る（本家準拠）。影も中抜き(fill=none)にし、
      // 縁膨張の帯だけを影にする＝中空文字の内側がベタで埋まらない。塗りONなら従来どおりベタ塗り。
      const shFill = s.fill && s.fill.enabled ? sd.color : 'none'
      body +=
        `<g transform="translate(${dx.toFixed(2)},${dy.toFixed(2)})" opacity="${op.toFixed(3)}"${filt}>` +
        textEl(
          `fill="${shFill}" stroke="${sd.color}" stroke-width="${Math.max(0.01, swid).toFixed(2)}" stroke-linejoin="${lj}" stroke-miterlimit="${MITER_LIMIT}" paint-order="stroke"`
        ) +
        `</g>`
    }
  } else {
    // 文字ごとの影: ジオメトリ(dx,dy,blur)ごとにグループ化し、tspanで文字別の色/幅/不透明を出す。
    const geomKey = (dx: number, dy: number, bl: number): string =>
      `${dx.toFixed(2)}_${dy.toFixed(2)}_${bl.toFixed(2)}`
    const geoms = new Map<string, { dx: number; dy: number; blur: number; reach: number }>()
    for (let gi = 0; gi < totalChars; gi++)
      for (const sd of shadowsAt(gi)) {
        const rad = ((sd.angle || 0) * Math.PI) / 180
        const dx = Math.sin(rad) * (sd.distance || 0) * SHADOW_DIST_COEF
        const dy = -Math.cos(rad) * (sd.distance || 0) * SHADOW_DIST_COEF
        const bl = (sd.blur || 0) * 0.075 * SHADOW_BLUR_COEF
        const k = geomKey(dx, dy, bl)
        if (!geoms.has(k)) geoms.set(k, { dx, dy, blur: bl, reach: Math.abs(dx) + Math.abs(dy) + bl })
      }
    // 奥→手前（reach大＝奥）。同一ジオメトリ内は文字別tspan。
    const geomList = [...geoms.values()].sort((a, b) => b.reach - a.reach)
    for (const g of geomList) {
      let filt = ''
      if (g.blur > 0) {
        const fi = `shb${_svgFilterId++}_${fid++}`
        defs += `<filter id="${fi}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${g.blur.toFixed(2)}"/></filter>`
        filt = ` filter="url(#${fi})"`
      }
      const gk = geomKey(g.dx, g.dy, g.blur)
      const attrOf = (gi: number): string => {
        const sd = shadowsAt(gi).find((x) => {
          const rad = ((x.angle || 0) * Math.PI) / 180
          const dx = Math.sin(rad) * (x.distance || 0) * SHADOW_DIST_COEF
          const dy = -Math.cos(rad) * (x.distance || 0) * SHADOW_DIST_COEF
          const bl = (x.blur || 0) * 0.075 * SHADOW_BLUR_COEF
          return geomKey(dx, dy, bl) === gk
        })
        // この幾何の影を持たない文字も、フォント上書き(サイズ/フォント)だけは付けて幅を全レイヤーで揃える
        // （揃えないと拡大文字の分だけ行幅がズレ、text-anchor中央寄せで影/縁が本体からズレる）。
        if (!sd) return fontOverrideOf(gi)
        const spr = (sd.spread || 0) * 0.667 * SHADOW_SPREAD_COEF
        const swid = Math.max(0.01, (strokeMaxOutAt(gi) + spr) * 2)
        const op = ((sd.opacity != null ? sd.opacity : 100) / 100).toFixed(3)
        const shFill = s.fill && s.fill.enabled ? sd.color : 'none'
        return (
          ` fill="${shFill}" fill-opacity="${op}" stroke="${sd.color}" stroke-opacity="${op}" stroke-width="${swid.toFixed(2)}" stroke-linejoin="${joinAt(gi)}" stroke-miterlimit="${MITER_LIMIT}" paint-order="stroke"` +
          fontOverrideOf(gi)
        )
      }
      body += `<g transform="translate(${g.dx.toFixed(2)},${g.dy.toFixed(2)})"${filt}><text ${fontAttr} fill="none">${layerTspans(attrOf)}</text></g>`
    }
  }
  // ---- 縁（ストローク）----
  if (!hasRunStrokes) {
    // 従来パス（外→内: 太い方が背面。中央幅=outward*2）。中抜き(fill=none)。
    const sorted = [...strokes].sort((a, b) => outward(b) - outward(a))
    for (const st of sorted) {
      const ow = outward(st)
      if (ow <= 0) continue
      body += textEl(
        `fill="none" stroke="${st.color}" stroke-width="${(ow * 2).toFixed(2)}" stroke-linejoin="${lj}" stroke-miterlimit="${MITER_LIMIT}" stroke-linecap="${lj === 'round' ? 'round' : 'square'}"`
      )
    }
  } else {
    // 文字ごとの縁: 各文字の縁を太→細で多重パス（pass0=各文字の最太＝最背面）。
    let maxPasses = 0
    for (let gi = 0; gi < totalChars; gi++)
      maxPasses = Math.max(maxPasses, strokesAt(gi).filter((st) => outward(st) > 0).length)
    for (let p = 0; p < maxPasses; p++) {
      const attrOf = (gi: number): string => {
        const st = strokesAt(gi)
          .filter((x) => outward(x) > 0)
          .sort((a, b) => outward(b) - outward(a))[p]
        // この段の縁を持たない文字もフォント上書きだけ付けて幅を全レイヤーで揃える（ズレ防止）。
        if (!st) return fontOverrideOf(gi)
        const j = joinAt(gi)
        return (
          ` stroke="${st.color}" stroke-width="${(outward(st) * 2).toFixed(2)}" stroke-linejoin="${j}" stroke-miterlimit="${MITER_LIMIT}" stroke-linecap="${j === 'round' ? 'round' : 'square'}"` +
          fontOverrideOf(gi)
        )
      }
      body += `<text ${fontAttr} fill="none">${layerTspans(attrOf)}</text>`
    }
  }
  // 疑似ベベルは廃止（Premiere Proからベベル機能が無くなったため。プレビュー側と一致）。
  // 塗り（最前面）。旧fillCssと同じ「truthyなら塗る」判定＝enabled未定義/falseは塗らない
  // （パネルのチェックボックス checked={fill.enabled} と一致。undefinedを塗ってしまう不整合を修正）
  if (s.fill && s.fill.enabled) {
    const g = s.fill.gradient
    let baseFill: string
    if (g && g.stops && g.stops.length >= 2) {
      const gid = `gr${_svgGradId++}`
      defs += _gradDef(gid, g)
      baseFill = `url(#${gid})`
    } else {
      baseFill = s.fill.color || '#fff'
    }
    // 親<text>に base fill、run文字は fillTspans 内で個別上書き
    body += `<text ${fontAttr} fill="${baseFill}">${fillTspans}</text>`
  }
  // 斜体の傾けは下ごしらえ側（./telopLayout の `skew`）。ここでは掛けるだけ
  // width/height=100%＝外側コンテナ(cqh/px)でスケール。viewBoxが内部座標(1080基準px)を担う。
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" style="overflow:visible;display:block"><defs>${defs}</defs><g${skew}>${body}</g></svg>`
  // **返す枠は、上で決めた textW/textH をそのまま返す。**
  // ここだけ実測値（maxW）に戻していたので、縦書きにしても幅が横書きのままだった
  // ＝縦に組んだのに当たり判定と絵の大きさは横長、という食い違いになる。
  // 横書きでは textW === maxW なので、今までの値は1つも変わらない。
  return { svg, w: W, h: H, textW: Math.ceil(textW), textH: Math.ceil(textH), pad }
}
