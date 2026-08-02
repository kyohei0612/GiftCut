// テロップのスタイル定義（プレミアのエッセンシャルグラフィックス相当）

// コラボアイコンの基準サイズ（動画1080px高さ基準）。文字サイズとは独立させ、
// アイコンサイズ倍率(iconScale)だけで大小を決める。従来の既定(fontSize90×1.6=144)に合わせた値。
export const ICON_BASE_PX = 144

export type StrokePosition = 'outside' | 'center' | 'inside'

export interface StrokeLayer {
  enabled: boolean
  color: string
  width: number // 動画1080px基準の太さ
  position: StrokePosition
}

// ドロップシャドウ1枚分（TelopStyle.shadows の要素と同型。部分装飾でも使う）
export interface ShadowSpec {
  enabled?: boolean
  color: string
  opacity: number
  angle: number
  distance: number
  blur: number
  spread?: number
}

export type AnchorH = 'l' | 'c' | 'r'
export type AnchorV = 't' | 'm' | 'b'

// 塗りグラデーション。type未指定=linear。radial=円形。pos:0-1、mid=色中間点(0-1,既定0.5)。
export interface FillGradient {
  type?: 'linear' | 'radial'
  angle: number
  stops: { color: string; pos: number; mid?: number }[]
  // 不透明度ストップ（Premiere上段の□）。pos 0-1, opacity 0-100。未指定＝全て不透明。
  opacityStops?: { opacity: number; pos: number }[]
}

export interface TelopStyle {
  // テキスト
  fontFamily: string
  fontSize: number // 動画1080px高さ基準
  bold: boolean
  italic: boolean
  align: 'left' | 'center' | 'right'
  // anchor: box未指定時は箱の基準点（どの隅を配置点に合わせるか）。box指定時は箱の中でのテキスト寄せ。
  anchor?: { h: AnchorH; v: AnchorV }
  box?: { w: number; h: number } // 固定サイズのテキストボックス（1080基準px）。未指定=内容ぴったり
  tracking: number // 字間（1/1000em, プレミア準拠）
  leading: number // 行間（%加算, 0で標準）
  // アピアランス
  // 塗り: 単色(color)、または gradient があれば線形グラデ（角度＋ストップ）を優先
  fill: {
    enabled: boolean
    color: string
    // 塗り: 単色 or グラデ。type未指定=linear。radial=円形グラデ。
    gradient?: FillGradient // pos: 0-1
    // グラデOFF時に元グラデを退避（再ONで復元用）。描画は無視する。
    gradStash?: FillGradient
  }
  strokes: StrokeLayer[]
  // 角の結合（フォント全体に適用＝縁もシャドウ輪郭も共通）。既定 miter（Premiere準拠）
  join?: 'miter' | 'round'
  // 背景ボックス。size=外周への広がり(1080基準px, Premiere「サイズ」)、corner=角丸半径(1080基準px, 0=直角)。
  // size/corner 未定義時は従来の fontSize 比例の既定パディング/角丸。
  background: { enabled: boolean; color: string; opacity: number; size?: number; corner?: number } // opacity 0-100
  shadow: {
    enabled: boolean
    color: string
    opacity: number // 0-100
    angle: number // 度
    distance: number
    blur: number
    spread?: number // 影の拡張(Premiereの「サイズ」)。リング描画で押し出し立体を作る
  }
  // 追加のドロップシャドウ（金属グラデ等の多重影用。primaryのshadowより背面に重なる）
  shadows?: {
    enabled?: boolean // 省略時は有効。個別にON/OFFできる
    color: string
    opacity: number
    angle: number
    distance: number
    blur: number
    spread?: number
  }[]
  // 疑似ベベル（エンボス）: 各ストロークの上辺に明るいハイライト/下辺に暗い影を挟んで金属的な立体感を出す。
  // .prtextstyleには含まれないPremiereのレイヤースタイル相当を近似。highlight/shadowはrgba()文字列可。
  bevel?: {
    enabled: boolean
    size: number // 1080基準px（オフセット量）
    highlight: string
    shadow: string
  }
  anim?: TelopAnim // 出入りアニメ・強調
}

export function textRectInFrame(
  pos: { x: number; y: number },
  anchor: { h: AnchorH; v: AnchorV } | undefined,
  textW: number,
  textH: number,
  frameW: number,
  frameH: number,
  scale = 1
): TextRectInFrame {
  const w = (textW * scale) / frameW
  const h = (textH * scale) / frameH
  const f = anchorFrac(anchor)
  return { x: pos.x - f.fx * w, y: pos.y - f.fy * h, w, h }
}

// テロップ用フォント一覧。
// family = 実際に指定する CSS font-family（環境で名前が割れるものは別名をカンマ併記して取りこぼしを防ぐ）
// label  = 選択メニューの表示名（用途を一言添える）
export const FONT_OPTIONS: { family: string; label: string }[] = [
  // --- 切り抜き向け表現系（インストール済み） ---
  { family: 'Dela Gothic One', label: 'Dela Gothic One（極太インパクト）' },
  { family: 'Reggae One, レゲエ One', label: 'Reggae One（ツッコミ・強調）' },
  { family: 'M PLUS Rounded 1c, Rounded Mplus 1c Black', label: 'M PLUS Rounded 1c（丸ゴ定番）' },
  { family: 'Zen Maru Gothic, Zen Maru Gothic Black', label: 'Zen Maru Gothic（読みやすい丸ゴ）' },
  { family: 'Mochiy Pop One, モッチーポップ One', label: 'Mochiy Pop One（ポップ）' },
  { family: 'Hachi Maru Pop, はちまるポップ', label: 'Hachi Maru Pop（可愛い系）' },
  { family: 'Yusei Magic', label: 'Yusei Magic（手書きマジック）' },
  { family: 'けいふぉんと', label: 'けいふぉんと（手書き・ゆるい）' },
  { family: 'Noto Sans JP, Noto Sans JP Black', label: 'Noto Sans JP（王道ゴシック）' },
  // --- クリエイター配布系（切り抜き定番・インストール済み） ---
  // 07始まり等の数字始まり名はCSS識別子として不正になるため二重引用符で囲む
  { family: '"ラノベPOP v2"', label: 'ラノベPOP v2（ポップ・切り抜き定番）' },
  { family: 'たぬき油性マジック', label: 'たぬき油性マジック（手書きマジック定番）' },
  { family: '"07にくまるフォント"', label: 'にくまるフォント（ゆる可愛い）' },
  { family: '"07ロゴたいぷゴシック7"', label: 'ロゴたいぷゴシック（ロゴ・見出し）' },
  { family: '"コーポレート・ロゴ ver3 Bold"', label: 'コーポレート・ロゴ Bold（太ゴ・見出し）' },
  { family: '"コーポレート・ロゴ ver3 Medium"', label: 'コーポレート・ロゴ Medium（見出し）' },
  // --- 標準（OS付属） ---
  { family: '小塚ゴシック Pr6N', label: '小塚ゴシック Pr6N（ゴシック）' },
  { family: '小塚明朝 Pr6N', label: '小塚明朝 Pr6N（明朝）' },
  { family: 'Yu Gothic UI', label: 'Yu Gothic UI（標準ゴシック）' },
  { family: '游ゴシック', label: '游ゴシック（標準）' },
  { family: '游明朝', label: '游明朝（明朝）' },
  { family: 'メイリオ', label: 'メイリオ（標準）' },
  { family: 'MS ゴシック', label: 'MS ゴシック（レトロ）' },
  { family: 'MS 明朝', label: 'MS 明朝（明朝）' },
  { family: 'sans-serif', label: 'sans-serif（既定ゴシック）' },
  { family: 'serif', label: 'serif（既定明朝）' }
]

export function defaultTelopStyle(): TelopStyle {
  return {
    fontFamily: 'Yu Gothic UI',
    fontSize: 90,
    bold: true,
    italic: false,
    align: 'center',
    anchor: { h: 'c', v: 'm' },
    // **既定を詰める。** 和文フォントは1文字ぶんの枠が広く、そのまま並べると
    // 切り抜きのテロップとしては間延びして見える（「字間が全体的に広すぎる」）。
    // 単位は 1/1000em（プレミア準拠）なので、-40 は字の大きさの 4%ぶん詰める。
    // 0 に戻したいときは字間の欄で打てる。**保存済みのテロップは変わらない**
    // （それぞれ自分の字間を持っている）ので、変わるのはこれから作る分だけ。
    tracking: -40,
    leading: 0,
    fill: { enabled: true, color: '#ffffff' },
    strokes: [{ enabled: true, color: '#000000', width: 5, position: 'outside' }],
    background: { enabled: false, color: '#000000', opacity: 60 },
    shadow: { enabled: false, color: '#000000', opacity: 80, angle: 135, distance: 6, blur: 6 }
  }
}

// アンカー(箱の基準点) → CSS translate。配置点(pos)にこの隅が合う。
// h: l=左端,c=中央,r=右端 / v: t=上端,m=中央,b=下端
export function anchorTranslate(a?: { h: AnchorH; v: AnchorV }): string {
  const h = a?.h ?? 'c'
  const v = a?.v ?? 'm'
  const tx = h === 'l' ? '0%' : h === 'r' ? '-100%' : '-50%'
  const ty = v === 't' ? '0%' : v === 'b' ? '-100%' : '-50%'
  return `translate(${tx}, ${ty})`
}
// アンカー → flex の寄せ（固定ボックス内でのテキスト配置用）
export function anchorFlex(a?: { h: AnchorH; v: AnchorV }): {
  justifyContent: string
  alignItems: string
} {
  const h = a?.h ?? 'c'
  const v = a?.v ?? 'm'
  return {
    justifyContent: h === 'l' ? 'flex-start' : h === 'r' ? 'flex-end' : 'center',
    alignItems: v === 't' ? 'flex-start' : v === 'b' ? 'flex-end' : 'center'
  }
}
// アンカーの箱内比率（0=左/上, 0.5=中央, 1=右/下）。配置スナップ計算用。
export function anchorFrac(a?: { h: AnchorH; v: AnchorV }): { fx: number; fy: number } {
  const h = a?.h ?? 'c'
  const v = a?.v ?? 'm'
  return {
    fx: h === 'l' ? 0 : h === 'r' ? 1 : 0.5,
    fy: v === 't' ? 0 : v === 'b' ? 1 : 0.5
  }
}

/** #rrggbb + 不透明度(0-100) → rgba() */
export function hexToRgba(hex: string, opacityPercent: number): string {
  const h = hex.replace('#', '')
  const r = parseInt(h.substring(0, 2), 16) || 0
  const g = parseInt(h.substring(2, 4), 16) || 0
  const b = parseInt(h.substring(4, 6), 16) || 0
  return `rgba(${r}, ${g}, ${b}, ${(opacityPercent / 100).toFixed(3)})`
}

// 塗りのCSS（単色 or 線形グラデ）。グラデは background-clip:text で文字に乗せる（縁取りは別途 text-shadow）。
/**
 * グラデのストップ列を CSS 文字列化。Premiereの「色中間点」を CSSカラーヒント（区間中の裸の%）で再現。
 * mid = そのストップと次のストップの間で色が50%になる位置(0-1)。既定0.5＝等間隔。
 * map: ストップ位置(0-1)→塗り箱上の位置(0-1) への変換（インク範囲マッピング）。省略時は恒等。
 */
// #rrggbb → 相対輝度(0-255相当・順序比較用の簡易式)
function _lum(hex: string): number {
  const h = hex.replace('#', '')
  const r = parseInt(h.substring(0, 2), 16) || 0
  const g = parseInt(h.substring(2, 4), 16) || 0
  const b = parseInt(h.substring(4, 6), 16) || 0
  return 0.299 * r + 0.587 * g + 0.114 * b
}

/**
 * グラデ既定の色中間点バイアス。Premiereは暗い色を長めに保ってから明色へ移る（暗部が広い）。
 * CSSの既定は対称(0.5)で淡色へ早く移り「薄く」見えるため、明示midが無い区間は
 * 暗い方の色を長く保つよう中間点をずらす。0=無効, 0.2=暗部を約40%広げる（本家寄せの実測値）。
 */
export const GRAD_MID_BIAS = 0.2

/**
 * 2色間の実効中間点(0-1)を返す。明示mid優先。無指定なら「暗い色を長く保つ」バイアスを適用。
 * プレビュー(gradientStopStr)と書き出し(_gradDef)で同一ロジックを共有する。
 */
export function resolveGradMid(color0: string, color1: string, explicit?: number): number {
  if (explicit != null && explicit > 0 && explicit < 1) return explicit
  if (GRAD_MID_BIAS > 0) {
    const d = _lum(color1) - _lum(color0) // +: color1が明るい → color0(暗)を長く保つ=midを大きく
    if (Math.abs(d) > 4) return 0.5 + GRAD_MID_BIAS * Math.sign(d)
  }
  return 0.5
}

export function gradientStopStr(
  stops: { color: string; pos: number; mid?: number }[],
  map?: (p: number) => number
): string {
  const f = map ?? ((p: number) => p)
  const parts: string[] = []
  for (let i = 0; i < stops.length; i++) {
    const s = stops[i]
    parts.push(`${s.color} ${(f(s.pos) * 100).toFixed(2)}%`)
    const next = stops[i + 1]
    if (!next) continue
    const mid = resolveGradMid(s.color, next.color, s.mid)
    if (mid > 0 && mid < 1 && Math.abs(mid - 0.5) > 0.01) {
      const hint = s.pos + mid * (next.pos - s.pos) // 中間点の絶対位置
      parts.push(`${(f(hint) * 100).toFixed(2)}%`)
    }
  }
  return parts.join(', ')
}

/** 縦方向（Premiere角度90°±45）の線形グラデか（インク範囲マッピングの適用対象） */
export const isVerticalGrad = (g: { type?: string; angle: number }): boolean => {
  if (g.type === 'radial') return false
  const a = ((g.angle % 360) + 360) % 360
  return Math.abs(a - 90) <= 45 || Math.abs(a - 270) <= 45
}

// 斜体(faux italic)の傾き角(度)。源ノ角ゴシック等は斜体字形が無く font-synthesis:none で
// fontStyle:italic が効かないため、レイヤー全体を skewX で傾けて再現する。
export const ITALIC_SKEW_DEG = 11

// 行の高さ基準（em倍率）。leading=0 でこの値。旧0.9はつぶれ過ぎ（ユーザー要望 2026-07-24:
// 「デフォ0は15くらいほしい」＝0.9+15/100）。プレビュー/書き出し/アイコン自動サイズ共通。
export const LINE_BASE = 1.05
// 疑似イタリックのON/OFF。Premiereは italic 時この種のフォントも faux で傾ける（17で確認）。
// よってフラグを尊重して skewX で傾ける（ON）。斜体にすべきでないテロップは data の italic:false 側で管理
// （取り込みで italic を誤読していた系統3等は個別に false へ修正する）。
export const FAUX_ITALIC = true
// マイター結合の尖り上限（miter長/線幅の比）。これを超える鋭角は自動でベベル＝棘の暴発を防ぐ。
// 直角(90°)は比1.41なので保たれ、より鋭角な所だけ切り落とす。2＝約60°まで尖り維持。棘が残るなら下げる。
export const MITER_LIMIT = 2

// 塗りレイヤーの上下パディング(em)。line-height<1 だと文字インクが行ボックスをはみ出し、
// background-clip:text はボックス外を塗れない（＝フォントによって上下が白欠けする）ため、
// パディングで塗り箱を広げ、同量の負マージンでレイアウトは不変に保つ。
export const GRAD_PAD_EM = 0.35

// ---- 影の調整係数（元データ geba.json は触らず、描画時に一括で掛ける）----
// データはPremiere由来の生値。実効値 = データ値 × 係数。ここ一本で全テロップの影を調整。
// 既存の px 校正（spread×0.667 / blur×0.075）はそのまま base として残し、その上に掛ける。
export const SHADOW_BLUR_COEF = 0.5 // ぼかし: Premiere(データ)の半分がちょうど良い
export const SHADOW_SPREAD_COEF = 15 / 18 // サイズ: 18→15相当に縮小
export const SHADOW_DIST_COEF = 1.0 // 距離: 一旦そのまま（15-20へ寄せたい時ここを調整）

/**
 * 文字インクの縦範囲を実測し、パディング込みの塗り箱に対する割合で返す。
 *   - ベースライン位置: DOMマーカーで「レイアウトエンジン自身」に答えさせる（フォントメトリクスの癖に非依存）
 *   - インクの上下端: canvas TextMetrics（actualBoundingBox、ベースライン基準）で文字ごとに実測
 * 固定係数・フォント別の推定は一切使わない＝今後どんなフォントを入れても正確。
 * Premiereはグラデを文字の実描画範囲に張るので、この範囲へストップをマップすると一致する。
 */
let inkCtx: CanvasRenderingContext2D | null = null
let measHost: HTMLDivElement | null = null
const baselineCache = new Map<string, number>()
const inkCache = new Map<string, { top: number; bottom: number }>()

/**
 * 文字を測るための canvas。**1枚を使い回す。**
 *
 * 測るたびに作ると、テロップの数だけ canvas が増えて重くなる。
 * 画面の無い所（試験など）では作れないので null が返る——呼ぶ側で必ず見ること。
 */
export function inkContext(): CanvasRenderingContext2D | null {
  if (!inkCtx) inkCtx = document.createElement('canvas').getContext('2d')
  return inkCtx
}

// canvasのfontショートハンドが解析失敗する名前（数字始まり等）に備え、各ファミリーを引用符で包む版を作る
export const quoteFamilies = (fontFamily: string): string =>
  fontFamily
    .split(',')
    .map((t) => {
      const s = t.trim()
      if (!s || s.startsWith('"') || s.startsWith("'")) return s
      if (/^(sans-serif|serif|monospace|cursive|fantasy|system-ui)$/i.test(s)) return s
      return `"${s}"`
    })
    .join(', ')

// 行ボックス先頭からベースラインまでの距離(px, fontSize=100px時)をDOMで実測
function measureBaseline(fontFamily: string, fontWeight: number, lineHeight: number): number {
  const key = `${fontFamily}|${fontWeight}|${lineHeight.toFixed(3)}`
  const hit = baselineCache.get(key)
  if (hit != null) return hit
  const em = 100
  if (!measHost) {
    measHost = document.createElement('div')
    measHost.style.cssText =
      'position:absolute;left:-99999px;top:0;visibility:hidden;pointer-events:none;white-space:pre'
    document.body.appendChild(measHost)
  }
  measHost.style.fontFamily = fontFamily
  measHost.style.fontWeight = String(fontWeight)
  measHost.style.fontSize = `${em}px`
  measHost.style.lineHeight = String(lineHeight)
  measHost.textContent = ''
  const span = document.createElement('span')
  span.textContent = 'あ永A'
  const marker = document.createElement('span')
  marker.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline'
  measHost.append(span, marker)
  const baseline = marker.getBoundingClientRect().top - measHost.getBoundingClientRect().top
  baselineCache.set(key, baseline)
  return baseline
}

export function measureInkRange(
  text: string,
  fontFamily: string,
  fontWeight: number,
  lineHeight: number
): { top: number; bottom: number } {
  const clampv = (v: number): number => Math.max(0, Math.min(1, v))
  const lines = text.split('\n')
  const first = lines[0] || 'あ'
  const last = lines[lines.length - 1] || 'あ'
  const key = `${fontFamily}|${fontWeight}|${lineHeight.toFixed(3)}|${lines.length}|${first.slice(0, 40)}|${last.slice(0, 40)}`
  const hit = inkCache.get(key)
  if (hit) return hit
  try {
    if (!inkCtx) inkCtx = document.createElement('canvas').getContext('2d')
    if (!inkCtx) return { top: 0, bottom: 1 }
    const em = 100
    const pad = GRAD_PAD_EM * em
    // fontショートハンドの解析失敗を検知（失敗すると前の値が残る）→ 引用符版で再設定
    const qf = quoteFamilies(fontFamily)
    inkCtx.font = '10px monospace'
    inkCtx.font = `${fontWeight} ${em}px ${qf}`
    if (inkCtx.font === '10px monospace') inkCtx.font = `${fontWeight} ${em}px sans-serif`
    const m1 = inkCtx.measureText(first)
    const mN = first === last ? m1 : inkCtx.measureText(last)
    const inkA = m1.actualBoundingBoxAscent ?? em * 0.88
    const inkD = mN.actualBoundingBoxDescent ?? 0
    // ベースライン位置はDOM実測（レイアウトと同じ答え）
    const baseline = measureBaseline(fontFamily, fontWeight, lineHeight)
    const lh = lineHeight * em
    const n = lines.length
    const boxH = n * lh + pad * 2
    const top = clampv((pad + baseline - inkA) / boxH)
    const bottom = Math.max(top, clampv((pad + (n - 1) * lh + baseline + inkD) / boxH))
    const r = { top, bottom }
    // フォント未ロード中の誤計測をキャッシュしない（ロード後の再描画で正しい値に更新される）
    let loaded = true
    try {
      loaded = document.fonts.check(`${fontWeight} ${em}px ${qf}`)
      if (!loaded) void document.fonts.load(`${fontWeight} ${em}px ${qf}`)
    } catch {
      /* check不可なら毎回実測 */
    }
    if (loaded) inkCache.set(key, r)
    return r
  } catch {
    return { top: 0, bottom: 1 }
  }
}

export function fillCss(
  fill: TelopStyle['fill'],
  ink?: { top: number; bottom: number }
): React.CSSProperties {
  if (!fill.enabled) return { color: 'transparent' }
  const g = fill.gradient
  if (g && g.stops.length >= 2) {
    // 縦グラデはインク実測範囲へマップ（フォントを問わず上下端がPremiereと一致）
    const map =
      ink && isVerticalGrad(g) ? (p: number): number => ink.top + p * (ink.bottom - ink.top) : undefined
    const stops = gradientStopStr(g.stops, map)
    // 角度: Premiere準拠（90°=縦）。CSSの linear-gradient は 90deg=横なので +90 して合わせる。
    // ★補間空間 oklab: sRGB既定だと金の中間色が濁って暗くなる（Premiereの描画エンジンと乖離）。
    //   oklabで補間すると金属光沢が出てPremiereに寄る（実測確認済み）。
    const img =
      g.type === 'radial'
        ? `radial-gradient(in oklab circle, ${stops})`
        : `linear-gradient(in oklab ${g.angle + 90}deg, ${stops})`
    return {
      color: 'transparent',
      backgroundImage: img,
      WebkitBackgroundClip: 'text',
      backgroundClip: 'text'
    }
  }
  return { color: fill.color }
}

// 1080基準の値をコンテナ高さ比(cqh)へ。比率が変わってもWYSIWYGを保つ
const cq = (v: number): string => `${((v / 1080) * 100).toFixed(3)}cqh`

export interface ComputedTelop {
  container: React.CSSProperties
  /**
   * Premiereと同じレイヤー構造（背面→前面）。同じテキストを重ね描きする。
   *   [シャドウ(逆順=前面の影ほど上)] → [外側ストローク(太い方が下)] → [塗り] → [中央/内側ストローク]
   * シャドウ=グリフをtext-strokeでベクター膨張した色シルエット＋blur＋opacity。
   * ストローク=本物のtext-stroke。text-shadowリングによる近似は廃止（ギザギザ・色化けの原因だった）。
   */
  layers: React.CSSProperties[]
  text: React.CSSProperties // 最前面レイヤー（互換用）
}

/** スタイル全体を倍率kで相似スケール（縁・影・ベベル込み＝見た目の比率を保つ）。サムネや一括縮小用 */
export function scaleTelopStyle(s: TelopStyle, k: number): TelopStyle {
  const r1 = (n: number): number => Math.round(n * 10) / 10
  const scSh = <T extends { distance: number; blur: number; spread?: number }>(sd: T): T => ({
    ...sd,
    distance: r1(sd.distance * k),
    blur: r1(sd.blur * k),
    ...(sd.spread != null ? { spread: r1(sd.spread * k) } : {})
  })
  return {
    ...s,
    fontSize: Math.max(1, Math.round(s.fontSize * k)),
    strokes: s.strokes.map((st) => ({ ...st, width: r1(st.width * k) })),
    shadow: scSh(s.shadow),
    ...(s.shadows ? { shadows: s.shadows.map(scSh) } : {}),
    ...(s.bevel ? { bevel: { ...s.bevel, size: r1(s.bevel.size * k) } } : {}),
    ...(s.box ? { box: { w: Math.round(s.box.w * k), h: Math.round(s.box.h * k) } } : {})
  }
}

// テンプレ一覧の小さなプレビュー用（固定fontPxで「あア」等を描く簡易版。フチは text-stroke で近似）
export function telopThumbCss(
  s: TelopStyle,
  fontPx: number
): { box: React.CSSProperties; text: React.CSSProperties } {
  const strokes = s.strokes.filter((st) => st.enabled).sort((a, b) => b.width - a.width)
  const outer = strokes[0]
  const strokeW = outer ? (fontPx * outer.width) / s.fontSize : 0
  let shadow = 'none'
  if (s.shadow.enabled) {
    const k = fontPx / s.fontSize
    const rad = (s.shadow.angle * Math.PI) / 180
    // Premiere/Adobeの影角度は 0°=上・時計回り（dx=sin, dy=-cos）。135°→右下。
    const dx = Math.sin(rad) * s.shadow.distance * k
    const dy = -Math.cos(rad) * s.shadow.distance * k
    const bl = s.shadow.blur * k
    shadow = `${dx.toFixed(1)}px ${dy.toFixed(1)}px ${bl.toFixed(1)}px ${hexToRgba(s.shadow.color, s.shadow.opacity)}`
  }
  return {
    box: {
      background: s.background.enabled
        ? hexToRgba(s.background.color, s.background.opacity)
        : 'transparent',
      padding: s.background.enabled
        ? s.background.size != null
          ? (fontPx * s.background.size) / s.fontSize
          : `${fontPx * 0.1}px ${fontPx * 0.25}px`
        : 0,
      borderRadius: s.background.enabled
        ? s.background.corner != null
          ? (fontPx * s.background.corner) / s.fontSize
          : fontPx * 0.12
        : 0
    },
    text: {
      fontFamily: s.fontFamily,
      fontWeight: s.bold ? 800 : 500,
      fontSynthesis: 'none', // 偽ボールド禁止（単一ウェイトのフォントが潰れるのを防ぐ）
      fontStyle: s.italic ? 'italic' : 'normal',
      fontSize: fontPx,
      lineHeight: 1,
      ...fillCss(s.fill),
      WebkitTextStroke: outer ? `${strokeW.toFixed(1)}px ${outer.color}` : undefined,
      paintOrder: 'stroke',
      textShadow: shadow,
      whiteSpace: 'nowrap'
    }
  }
}

/** TelopStyle から実際の CSS を計算（Premiere同構造のレイヤー方式）。text はグラデのインク範囲実測用 */
export function computeTelopCss(s: TelopStyle, text?: string): ComputedTelop {
  const container: React.CSSProperties = {
    textAlign: s.align,
    background: s.background.enabled ? hexToRgba(s.background.color, s.background.opacity) : 'transparent',
    padding: s.background.enabled
      ? s.background.size != null
        ? cq(s.background.size)
        : `${cq(s.fontSize * 0.12)} ${cq(s.fontSize * 0.28)}`
      : 0,
    borderRadius: s.background.enabled
      ? s.background.corner != null
        ? cq(s.background.corner)
        : cq(s.fontSize * 0.1)
      : 0,
    // 位置に依らず内容ぴったり幅にして自動折り返しを無くす（プレミア準拠：画面外にそのまま出る）
    width: 'max-content',
    maxWidth: 'none'
  }

  const lineH = LINE_BASE + s.leading / 100
  const base: React.CSSProperties = {
    fontFamily: s.fontFamily,
    fontSize: cq(s.fontSize),
    fontWeight: s.bold ? 800 : 500,
    // 偽ボールド(faux bold)を禁止。単一ウェイトの表現系フォントに800を要求すると
    // ブラウザが線を無理に太らせて字が潰れる（漢字の隙間が塗りつぶされる）ため。
    fontSynthesis: 'none',
    // 斜体は skewX（wrapper側）で一括再現するので、ここでは常に normal（二重斜体防止）
    fontStyle: 'normal',
    letterSpacing: cq((s.fontSize * s.tracking) / 1000),
    lineHeight: lineH,
    whiteSpace: 'pre-wrap',
    // 行ボックスをはみ出すインクも background-clip:text で塗れるようにパディングで塗り箱を拡張。
    // 負マージンで相殺しレイアウトは不変（フォント差による上下の白欠け防止）。
    padding: `${cq(s.fontSize * GRAD_PAD_EM)} 0`,
    margin: `${cq(-s.fontSize * GRAD_PAD_EM)} 0`
  }

  // ---- レイヤー構築（背面→前面） ----
  const layers: React.CSSProperties[] = []

  // グリフを半径spでベクター膨張したシルエットの text-shadow 群。
  // text-stroke膨張はマイター結合で角がトゲ状に暴発するため、同色コピーの円周配置
  //（構造的に丸結合＝Premiereと同じ膨らみ方）で作る。分割は弧長≒1.5pxになるよう自動増加。
  const dilate = (sp: number, color: string): string[] => {
    const steps = Math.min(72, Math.max(16, Math.ceil((2 * Math.PI * sp) / 1.5)))
    const smooth = ((2 * Math.PI * sp) / steps) * 0.75 // 隣接コピーの隙間を埋める微ぼかし
    const out: string[] = []
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2
      out.push(`${cq(Math.cos(a) * sp)} ${cq(Math.sin(a) * sp)} ${cq(smooth)} ${color}`)
    }
    return out
  }

  // シャドウ: 膨張シルエット＋オフセット＋ぼかし＋不透明度（すべて層単位＝色が濁らない）。
  // ★Premiere仕様（Larry Jordan記事 + 011/124透過PNG実測）:
  //   - サイズ＝柔らかい膨張。膨張半径=サイズ(全径)、さらにサイズ比例のソフトぼかしで縁を feather。
  //     （単一影は柔らかいハロー、多重影は重なって定義感が出る＝両方Premiereに一致）
  //   - 明示ぼかし(blur)はその上に加算。距離で方向オフセット。
  //   - 重ね順は【リスト順＝Premiere/blob順】: 影1(先頭)が最前面。データは blob順(master埋込→ベクタ)で
  //     格納＝Premiere一覧の上→下と一致。描画は末尾→先頭（先頭を最後に描いて最前面）。
  const shadowList = [
    ...(s.shadow.enabled ? [s.shadow] : []),
    ...(s.shadows ?? []).filter((sd) => sd.enabled !== false)
  ]
  for (const sd of [...shadowList].reverse()) {
    const rad = (sd.angle * Math.PI) / 180
    // ★Premiere実測校正(011透過PNG): サイズ膨張半径 = size×0.667（size18→半径12）。
    //   距離のオフセットがこの半径を超えると別色の影がはみ出す（011:黒半径12を赤dist15が3px超えて右下に見える）。
    const sp = (sd.spread ?? 0) * 0.667 * SHADOW_SPREAD_COEF
    // ぼかしは blur 値のみ由来（feather廃止）。Premiereのぼかし単位はCSS pxより小さく、blur40でも
    // 「ギリぼかしと分かる程度」なので係数0.075で寄せる（011のPremiere実描画と照合＝blur40→3px）。
    // さらに SHADOW_BLUR_COEF（Premiereの半分）を掛けて最終調整。
    const softBlur = sd.blur * 0.075 * SHADOW_BLUR_COEF
    const dist = sd.distance * SHADOW_DIST_COEF
    layers.push({
      ...base,
      color: sd.color,
      textShadow: sp > 0 ? dilate(sp, sd.color).join(', ') : undefined,
      transform: `translate(${cq(Math.sin(rad) * dist)}, ${cq(-Math.cos(rad) * dist)})`, // 0°=上・時計回り
      filter: softBlur > 0 ? `blur(${cq(softBlur)})` : undefined,
      opacity: sd.opacity / 100
    })
  }

  // ストローク: Premiere同様「配列順=内→外」に外側へ累積する帯。塗りの後ろに膨張シルエットで重ねる。
  //   外向き寄与 = 外側:幅 / 中央:幅の半分(外半分だけ塗りの外に見える) / 内側:0(塗りに隠れる)
  // 累積半径の大きい帯(外側)ほど背面 → 逆順に描き、最後に塗りを最前面。
  const strokes = s.strokes.filter((st) => st.enabled)
  let cum = 0
  const strokeLayers: React.CSSProperties[] = []
  for (const st of strokes) {
    const outward = st.position === 'outside' ? st.width : st.position === 'inside' ? 0 : st.width / 2
    cum += outward
    if (cum > 0) strokeLayers.push({ ...base, color: st.color, textShadow: dilate(cum, st.color).join(', ') })
  }
  layers.push(...strokeLayers.reverse())

  // 疑似ベベル(金属エンボス)は廃止。Premiere Pro からベベル機能自体が無くなったため、
  // 立体感は付けず塗りをフチのキワまで塗る。ハイライトの白がAA縁から透けて薄見えする問題も解消。
  // （bevel フィールドは互換のため型/データに残すが描画では無視）

  // 塗り（ソリッド or グラデ）を最前面に。縦グラデは文字インク実測範囲へマップ
  const ink =
    text && s.fill.gradient && isVerticalGrad(s.fill.gradient)
      ? measureInkRange(text, String(s.fontFamily), s.bold ? 800 : 500, lineH)
      : undefined
  layers.push({ ...base, ...fillCss(s.fill, ink) })

  return { container, layers, text: layers[layers.length - 1] }
}

// ============================================================================
// SVG描画エンジン（本家Premiereモデル）
//   単一/複数の <text> を paint-order:stroke で重ねる＝「中央ストローク→塗りを上に」。
//   dilate(円形コピー)方式のギザつき・潰れ・塗り外し時の不整合を解消し、ベクター滑らか。
//   影=色シルエット(fill+stroke)＋offset＋blurフィルタ＋opacity。グラデ=SVG linearGradient
//   (objectBoundingBox＝文字インク範囲へ自動マップ)。oklabはSVG非対応なのでストップに焼き込む。
// ============================================================================

// ---- モーション（キーフレームで動かす）----
//
// 出入りのアニメ（in/out/emphasis）は「決まった動き」を選ぶもの。
// モーションは**自分で位置や大きさを打つ**もので、プレミアの「モーション」に当たる。
//   例: 0秒で右端、10秒で左端 → 右から左へ流れるテロップ
//
// 両方が付いていたら**重ねる**（出入りで入ってきて、そのあと自分の動きで流れる）。
// 位置は足し算、大きさは掛け算、回転は足し算、透明度は掛け算。
// 打った印（キーフレーム）を触る側は ./telopMotion。動きの計算そのものは ./telopAnim
export { hasMotion, applyMotion, telopStateAt, sanitizeMotion, motionKeyTimes } from './telopMotion'
// テロップの動き（時間で変わる見た目）は ./telopAnim。**画面と書き出しで同じ計算を通す**
export { defaultAnim, hasAnim, NEUTRAL_ANIM, computeTelopAnim, animTransform, animFilter, animWave, animTurbulence, animMotionBlur, animMask, animClip } from './telopAnim'
export type { AnimIn, AnimOut, AnimEmphasis, TelopAnim, AnimState, TextRectInFrame } from './telopAnim'
import type { TelopAnim, TextRectInFrame } from './telopAnim'
// 書き出し用に SVG へ組み立てる側は ./telopSvg（画面は下の computeTelopCss）
export { buildTelopSVG } from './telopSvg'
export type { TelopSvg, TextRun } from './telopSvg'

// 形は shared/telopMotion に置いてある（画面を持たない側からも作るため）。
export type { Motion } from '../../../shared/telopMotion'
