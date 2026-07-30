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

// ---- テロップアニメーション ----
export type AnimIn = 'none' | 'fade' | 'pop' | 'slideL' | 'slideR' | 'slideU' | 'slideD'
export type AnimOut = 'none' | 'fade' | 'pop' | 'slideL' | 'slideR' | 'slideU' | 'slideD'
export type AnimEmphasis = 'none' | 'shake' | 'pulse'
export interface TelopAnim {
  in: AnimIn
  inDur: number // 秒
  out: AnimOut
  outDur: number
  emphasis: AnimEmphasis
}
export function defaultAnim(): TelopAnim {
  return { in: 'none', inDur: 0.3, out: 'none', outDur: 0.3, emphasis: 'none' }
}
export const hasAnim = (a?: TelopAnim): boolean =>
  !!a && (a.in !== 'none' || a.out !== 'none' || a.emphasis !== 'none')

// クリップ内ローカル時間 animT（秒）・クリップ長 clipDur から、その瞬間の見た目を返す。
// tx/ty は1080基準px、sc=拡大率、rot=度、opacity=0..1。プレビューも書き出しも同じ計算を使う。
export interface AnimState {
  opacity: number
  tx: number
  ty: number
  sc: number
  rot: number
  /**
   * 横だけの拡大（1=そのまま）。縦横同じ倍率の sc とは別に持つ。
   * Premiere の「スケール(幅)」に当たる。**弾む・伸びる演出はこれが要る**
   * （滑り込みながら横に潰れて戻る、という動きが作れない）。
   */
  scx: number
  /**
   * 縦だけの拡大（1=そのまま）。scx と対。**潰れて伸びる演出はこれが本体**
   * （ビョヨン・落ちる・メビウス。横だけでは「弾む」が作れない）。
   */
  scy: number
  /** 歪曲（度）。斜体と同じ skewX で傾ける。Premiere の「歪曲」に当たる */
  skew: number
  /**
   * 3D回転（度）。横回転＝スウィベル（Y軸）、縦回転＝チルト（X軸）。
   * **テロップは HTML を PNG に焼く経路なので、CSS の 3D 変形がそのまま使える。**
   */
  roty: number
  rotx: number
  /** 明るさ（1=そのまま）。CSS filter の brightness */
  bright: number
  /** ぼかし（px。1080基準）。CSS filter の blur */
  blur: number
  /** 色相の回転（度。0=そのまま）。CSS filter の hue-rotate */
  hue: number
  /** 色の反転（0=そのまま、1=完全に反転）。CSS filter の invert */
  inv: number
  /** ブラインド（0=全部見える、1=全部隠れる）。縞1本ぶんの幅(px・1080基準)と向き(度) */
  blind: number
  blindW: number
  blindDir: number
  /** 切り抜き（各辺 0..1）。CSS の clip-path: inset。「光」系や打ち込み演出に要る */
  crop: { l: number; t: number; r: number; b: number }
}
/** 何も付いていない状態。呼ぶ側が毎回書くと、項目を足したとき直し漏れる */
export const NEUTRAL_ANIM: AnimState = {
  opacity: 1, tx: 0, ty: 0, sc: 1, rot: 0, scx: 1, scy: 1, skew: 0,
  roty: 0, rotx: 0, bright: 1, blur: 0, hue: 0, inv: 0,
  blind: 0, blindW: 45, blindDir: 0, crop: { l: 0, t: 0, r: 0, b: 0 }
}

export function computeTelopAnim(anim: TelopAnim | undefined, animT: number, clipDur: number): AnimState {
  const st: AnimState = { ...NEUTRAL_ANIM, crop: { ...NEUTRAL_ANIM.crop } }
  if (!anim) return st
  const clampp = (v: number): number => Math.min(1, Math.max(0, v))
  const easeOut = (p: number): number => 1 - Math.pow(1 - p, 3)
  const SLIDE = 90 // スライド距離（1080基準px）
  // 出現
  if (anim.in !== 'none' && anim.inDur > 0) {
    const p = clampp(animT / anim.inDur)
    const e = easeOut(p)
    if (anim.in === 'fade') st.opacity *= p
    else if (anim.in === 'pop') {
      st.opacity *= clampp(p * 1.6)
      st.sc *= 0.55 + 0.45 * e
    } else {
      const off = SLIDE * (1 - e)
      if (anim.in === 'slideL') st.tx -= off
      if (anim.in === 'slideR') st.tx += off
      if (anim.in === 'slideU') st.ty -= off
      if (anim.in === 'slideD') st.ty += off
      st.opacity *= clampp(p * 1.6)
    }
  }
  // 消失
  if (anim.out !== 'none' && anim.outDur > 0) {
    const start = clipDur - anim.outDur
    if (animT > start) {
      const p = clampp((animT - start) / anim.outDur)
      const e = easeOut(p)
      if (anim.out === 'fade') st.opacity *= 1 - p
      else if (anim.out === 'pop') {
        st.opacity *= 1 - p
        st.sc *= 1 - 0.45 * e
      } else {
        const off = SLIDE * e
        if (anim.out === 'slideL') st.tx -= off
        if (anim.out === 'slideR') st.tx += off
        if (anim.out === 'slideU') st.ty -= off
        if (anim.out === 'slideD') st.ty += off
        st.opacity *= 1 - p
      }
    }
  }
  // 強調（常時）
  if (anim.emphasis === 'shake') {
    st.tx += Math.sin(animT * 40) * 6
    st.ty += Math.cos(animT * 33) * 4
    st.rot += Math.sin(animT * 30) * 1.5
  } else if (anim.emphasis === 'pulse') {
    st.sc *= 1 + Math.sin(animT * 6.5) * 0.04
  }
  return st
}
// AnimState → CSS transform（unit で cqh/px を切替。プレビュー=cqh, 書き出し=px）
export function animTransform(s: AnimState, unit: 'cqh' | 'px', pxScale = 1): string {
  const u = (v: number): string =>
    unit === 'cqh' ? `${(v / 1080) * 100}cqh` : `${(v * pxScale).toFixed(2)}px`
  // 横だけ・縦だけの拡大と歪曲は、**付いているときだけ**足す。
  // いつも書くと、動きの無いテロップの transform まで変わって差分が読みにくくなる。
  const sx =
    (Math.abs(s.scx - 1) > 1e-4 ? ` scaleX(${s.scx.toFixed(4)})` : '') +
    (Math.abs(s.scy - 1) > 1e-4 ? ` scaleY(${s.scy.toFixed(4)})` : '')
  const sk = Math.abs(s.skew) > 1e-4 ? ` skewX(${(-s.skew).toFixed(2)}deg)` : ''
  // 3D回転。**perspective が無いと、ただ横に潰れるだけで奥行きが出ない**
  const d3 =
    Math.abs(s.roty) > 1e-4 || Math.abs(s.rotx) > 1e-4
      ? ` perspective(${unit === 'cqh' ? '100cqh' : `${(1080 * pxScale).toFixed(0)}px`})` +
        ` rotateY(${s.roty.toFixed(2)}deg) rotateX(${s.rotx.toFixed(2)}deg)`
      : ''
  return (
    `translate(${u(s.tx)}, ${u(s.ty)}) scale(${s.sc.toFixed(4)}) ` +
    `rotate(${s.rot.toFixed(2)}deg)${sx}${sk}${d3}`
  )
}

/**
 * 明るさとぼかし（CSS filter）。付いていなければ空。
 * **動画クリップと違い、テロップは ffmpeg の制約を受けない**（HTML を焼くので、
 * CSS が持っている物はそのまま出せる）。
 */
export function animFilter(s: AnimState, pxScale = 1): string {
  const parts: string[] = []
  if (Math.abs(s.bright - 1) > 1e-4) parts.push(`brightness(${s.bright.toFixed(4)})`)
  if (s.blur > 1e-4) parts.push(`blur(${(s.blur * pxScale).toFixed(2)}px)`)
  // 色相は度どうしでそのまま渡せる。反転は 0..1 に収める
  // （足し合わせで1を超えると、CSS 側で扱いが割れる）
  if (Math.abs(s.hue) > 1e-4) parts.push(`hue-rotate(${s.hue.toFixed(2)}deg)`)
  if (s.inv > 1e-4) parts.push(`invert(${Math.min(1, s.inv).toFixed(4)})`)
  return parts.join(' ')
}

/**
 * ブラインド（CSS のマスク）。付いていなければ空。
 *
 * 縞で覆って、だんだん開いていく演出。**書き出しでも焼ける**ことは確かめてある
 * （foreignObject を canvas に描く経路で、縞がそのまま出た）。
 *
 * 向こうの「変換終了」は 100 で全部隠れ、0 で全部見える。縞1本ぶん（幅px）のうち
 * その割合を透明にする＝隠れる。
 */
export function animMask(s: AnimState, pxScale = 1): string {
  if (s.blind < 1e-4) return ''
  const period = Math.max(1, s.blindW * pxScale)
  const hidden = Math.min(period, period * s.blind)
  return (
    `repeating-linear-gradient(${s.blindDir.toFixed(2)}deg, ` +
    `transparent 0 ${hidden.toFixed(2)}px, #000 ${hidden.toFixed(2)}px ${period.toFixed(2)}px)`
  )
}

/**
 * 文字の箱が、フレームの中のどこを占めているか（0..1の割合）。切り抜きの換算に使う。
 * x,y は左上。w,h は幅と高さ。
 */
export interface TextRectInFrame {
  x: number
  y: number
  w: number
  h: number
}

/**
 * 切り抜き（CSS clip-path）。付いていなければ空。タイプライターや「光」系に要る。
 *
 * ## 基準がフレームなのを、箱の中の割合に直す
 *
 * **向こうの切り抜きは「フレームの何％」**（エフェクトはクリップ＝画面全体にかかる）。
 * こちらは clip-path を文字の箱にかけるので、同じ％をそのまま渡すと桁違いに削れる。
 *
 *   61.タイプライター … 右を 86% → 13% と刻む。フレームの13%は画面の端の話なので
 *   向こうでは最後に文字が全部出る。文字の箱の13%として当てると、**最後まで
 *   右端が欠けたまま終わる**（実際そうなっていた）。
 *
 * box を渡すと、フレーム基準の切り取り線を箱の中の位置に置き直す。
 * 渡さなければ従来どおり箱基準（＝自分で打った切り抜き）。
 */
export function animClip(s: AnimState, box?: TextRectInFrame): string {
  const c = s.crop
  if (c.l < 1e-4 && c.t < 1e-4 && c.r < 1e-4 && c.b < 1e-4) return ''
  const cl01 = (v: number): number => Math.min(1, Math.max(0, v))
  let { l, t, r, b } = c
  if (box && box.w > 1e-6 && box.h > 1e-6) {
    // フレーム上の切り取り線（0..1）→ 箱の中での割合
    l = cl01((c.l - box.x) / box.w)
    t = cl01((c.t - box.y) / box.h)
    r = cl01((box.x + box.w - (1 - c.r)) / box.w)
    b = cl01((box.y + box.h - (1 - c.b)) / box.h)
  }
  if (l < 1e-4 && t < 1e-4 && r < 1e-4 && b < 1e-4) return ''
  const pc = (v: number): string => `${(Math.min(0.999, Math.max(0, v)) * 100).toFixed(2)}%`
  return `inset(${pc(t)} ${pc(r)} ${pc(b)} ${pc(l)})`
}

/**
 * 文字の箱がフレームのどこを占めるかを出す。プレビューと書き出しで同じ式を使う
 * （別々に書くと、見た絵と焼けた絵で切り抜きの量が変わる）。
 */
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
    tracking: 0,
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

// canvasのfontショートハンドが解析失敗する名前（数字始まり等）に備え、各ファミリーを引用符で包む版を作る
const quoteFamilies = (fontFamily: string): string =>
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

// --- oklab補間（SVGはoklab非対応なのでsRGBストップに焼く。金属グラデの光沢を保つ） ---
function _hex2rgb(h: string): [number, number, number] {
  const s = h.replace('#', '')
  return [parseInt(s.slice(0, 2), 16) || 0, parseInt(s.slice(2, 4), 16) || 0, parseInt(s.slice(4, 6), 16) || 0]
}
function _rgb2hex(r: number[]): string {
  return '#' + r.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')
}
function _s2l(c: number): number {
  c /= 255
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}
function _l2s(c: number): number {
  return 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055)
}
function _rgb2oklab(rgb: [number, number, number]): [number, number, number] {
  const r = _s2l(rgb[0]), g = _s2l(rgb[1]), b = _s2l(rgb[2])
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  ]
}
function _oklab2rgb(lab: [number, number, number]): [number, number, number] {
  const L = lab[0], A = lab[1], B = lab[2]
  const l_ = L + 0.3963377774 * A + 0.2158037573 * B
  const m_ = L - 0.1055613458 * A - 0.0638541728 * B
  const s_ = L - 0.0894841775 * A - 1.291485548 * B
  const l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_
  return [
    _l2s(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    _l2s(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    _l2s(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)
  ]
}
function _oklabLerp(c0: string, c1: string, t: number): string {
  const a = _rgb2oklab(_hex2rgb(c0)), b = _rgb2oklab(_hex2rgb(c1))
  return _rgb2hex(_oklab2rgb([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]))
}
function _xmlEsc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
// 不透明度ストップ列を位置pos(0-1)で線形補間しα(0-1)を返す。未指定/空は不透明(1)。
function _alphaAt(ops: { opacity: number; pos: number }[] | undefined, pos: number): number {
  if (!ops || ops.length === 0) return 1
  const s = [...ops].sort((a, b) => a.pos - b.pos)
  if (pos <= s[0].pos) return s[0].opacity / 100
  if (pos >= s[s.length - 1].pos) return s[s.length - 1].opacity / 100
  for (let i = 0; i < s.length - 1; i++) {
    const a = s[i]
    const b = s[i + 1]
    if (pos >= a.pos && pos <= b.pos) {
      const t = (pos - a.pos) / (b.pos - a.pos || 1)
      return (a.opacity + (b.opacity - a.opacity) * t) / 100
    }
  }
  return 1
}

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
      out.push([s.pos + u * (next.pos - s.pos), _oklabLerp(s.color, next.color, t)])
    }
  }
  out.push([stops[stops.length - 1].pos, stops[stops.length - 1].color])
  const stopsXml = out
    .map(
      ([p, c]) =>
        `<stop offset="${Math.max(0, Math.min(1, p)).toFixed(4)}" stop-color="${c}" stop-opacity="${_alphaAt(
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
  if (!inkCtx) inkCtx = document.createElement('canvas').getContext('2d')
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
  // 返り値 textH＝枠(選択箱)の高さ。拡大文字ぶん(enlargedTop)を上に足す。
  const textH = lines.length * lineH * FS + enlargedTop
  const W = Math.ceil(maxW + pad * 2)
  const H = Math.ceil(textH + pad * 2)
  const ax = s.align === 'left' ? pad : s.align === 'right' ? W - pad : W / 2
  const anchor = s.align === 'left' ? 'start' : s.align === 'right' ? 'end' : 'middle'
  // ベースラインを enlargedTop 分下げる（拡大文字が上に伸びても枠内に収まるように）
  const yOf = (i: number): number => pad + enlargedTop + (i + 0.5) * lineH * FS
  const lsAttr = tracking ? ` letter-spacing="${tracking.toFixed(2)}"` : ''
  const tspans = lines
    .map((l, i) => `<tspan x="${ax.toFixed(1)}" y="${yOf(i).toFixed(1)}">${_xmlEsc(l) || ' '}</tspan>`)
    .join('')
  const famAttr = ff.replace(/"/g, '&quot;').replace(/'/g, '')
  const fontAttr = `font-family='${famAttr}' font-size="${FS}" font-weight="${weight}" text-anchor="${anchor}" dominant-baseline="central"${lsAttr} style="font-synthesis:none;white-space:pre"`
  // 縁/影用は全文均一の tspans（textEl）。塗り用は runs で文字ごとに上書きした fillTspans を使う。
  const textEl = (extra: string): string => `<text ${fontAttr} ${extra}>${tspans}</text>`
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
              if (!sg.color && !sg.grad && !sg.fam && !sg.size) return _xmlEsc(sg.text)
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
              return `<tspan${attrs}>${_xmlEsc(sg.text)}</tspan>`
            })
            .join('')
        : ' '
      return `<tspan x="${ax.toFixed(1)}" y="${yOf(i).toFixed(1)}">${inner}</tspan>`
    })
    .join('')

  // 部分装飾の背景ハイライト（選択文字だけ bgColor）。最背面(影より後ろ)に矩形で敷く。
  // 文字送り(letter-spacing=tracking)込みで「文字ごとの実効フォント/サイズ」で実測し、run単位で連続する同色を1矩形に。
  let bgRects = ''
  const hasRunBg = !!runs && runs.some((r) => r.bgColor)
  if (hasRunBg && inkCtx) {
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
          ? segs.map((sg) => (sg.attr ? `<tspan${sg.attr}>${_xmlEsc(sg.text)}</tspan>` : _xmlEsc(sg.text))).join('')
          : ' '
        return `<tspan x="${ax.toFixed(1)}" y="${yOf(i).toFixed(1)}">${inner}</tspan>`
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
  // 斜体は「下端固定・上が右へ倒れる」: skewXの基準を最下端＋ディセンダー余裕(0.25em)に置く
  // （既定基準(上端)だと下側が左へせり出し、左に置くコラボアイコンへ被ってしまうため。
  //   「ぷ」等のディセンダーは行ボックス(0.9em)の下へ出るので、その分の余裕も含めて左へ一切出さない）。
  const skewShift = Math.tan((ITALIC_SKEW_DEG * Math.PI) / 180) * (H + FS * 0.25)
  const skew =
    s.italic && FAUX_ITALIC
      ? ` transform="translate(${skewShift.toFixed(1)},0) skewX(-${ITALIC_SKEW_DEG})"`
      : ''
  // width/height=100%＝外側コンテナ(cqh/px)でスケール。viewBoxが内部座標(1080基準px)を担う。
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" style="overflow:visible;display:block"><defs>${defs}</defs><g${skew}>${body}</g></svg>`
  return { svg, w: W, h: H, textW: Math.ceil(maxW), textH: Math.ceil(textH), pad }
}

// ---- モーション（キーフレームで動かす）----
//
// 出入りのアニメ（in/out/emphasis）は「決まった動き」を選ぶもの。
// モーションは**自分で位置や大きさを打つ**もので、プレミアの「モーション」に当たる。
//   例: 0秒で右端、10秒で左端 → 右から左へ流れるテロップ
//
// 両方が付いていたら**重ねる**（出入りで入ってきて、そのあと自分の動きで流れる）。
// 位置は足し算、大きさは掛け算、回転は足し算、透明度は掛け算。
import type { Keys } from '../../../shared/keyframes'
import { valueAt, hasKeys, sanitizeKeys, keyTimesOf } from '../../../shared/keyframes'

// 形は shared/telopMotion に置いてある（画面を持たない側からも作るため）。
export type { Motion } from '../../../shared/telopMotion'
import type { Motion } from '../../../shared/telopMotion'

export const hasMotion = (m?: Motion): boolean =>
  !!m &&
  (
    [m.tx, m.ty, m.sc, m.rot, m.op, m.scx, m.scy, m.skew,
     m.roty, m.rotx, m.bright, m.blur, m.hue, m.inv, m.blind,
     m.cl, m.ct, m.cr, m.cb] as (Keys | undefined)[]
  ).some(hasKeys)

/** 出入りのアニメの上に、自分で打った動きを重ねる */
export function applyMotion(st: AnimState, m: Motion | undefined, animT: number): AnimState {
  if (!hasMotion(m)) return st
  return {
    tx: st.tx + valueAt(m!.tx, animT, 0),
    ty: st.ty + valueAt(m!.ty, animT, 0),
    sc: st.sc * valueAt(m!.sc, animT, 1),
    rot: st.rot + valueAt(m!.rot, animT, 0),
    opacity: st.opacity * valueAt(m!.op, animT, 1),
    scx: st.scx * valueAt(m!.scx, animT, 1),
    scy: st.scy * valueAt(m!.scy, animT, 1),
    skew: st.skew + valueAt(m!.skew, animT, 0),
    roty: st.roty + valueAt(m!.roty, animT, 0),
    rotx: st.rotx + valueAt(m!.rotx, animT, 0),
    bright: st.bright * valueAt(m!.bright, animT, 1),
    blur: st.blur + valueAt(m!.blur, animT, 0),
    hue: st.hue + valueAt(m!.hue, animT, 0),
    inv: st.inv + valueAt(m!.inv, animT, 0),
    blind: st.blind + valueAt(m!.blind, animT, 0),
    // 幅と向きは動かない設定値。付いていなければ元のまま
    blindW: m!.blindW ?? st.blindW,
    blindDir: m!.blindDir ?? st.blindDir,
    crop: {
      l: st.crop.l + valueAt(m!.cl, animT, 0),
      t: st.crop.t + valueAt(m!.ct, animT, 0),
      r: st.crop.r + valueAt(m!.cr, animT, 0),
      b: st.crop.b + valueAt(m!.cb, animT, 0)
    }
  }
}

/** その瞬間の見た目（出入りのアニメ＋自分で打った動き）。プレビューも書き出しもこれを使う */
export function telopStateAt(
  anim: TelopAnim | undefined,
  motion: Motion | undefined,
  animT: number,
  clipDur: number
): AnimState | undefined {
  if (!hasAnim(anim) && !hasMotion(motion)) return undefined
  return applyMotion(computeTelopAnim(anim, animT, clipDur), motion, animT)
}

/** 保存ファイルから読み直すときの検査（壊れていたら「動き無し」に落とす） */
export function sanitizeMotion(v: unknown): Motion | undefined {
  if (!v || typeof v !== 'object') return undefined
  const o = v as Record<string, unknown>
  const m: Motion = {
    tx: sanitizeKeys(o.tx),
    ty: sanitizeKeys(o.ty),
    sc: sanitizeKeys(o.sc),
    rot: sanitizeKeys(o.rot),
    op: sanitizeKeys(o.op),
    scx: sanitizeKeys(o.scx),
    scy: sanitizeKeys(o.scy),
    skew: sanitizeKeys(o.skew),
    roty: sanitizeKeys(o.roty),
    rotx: sanitizeKeys(o.rotx),
    bright: sanitizeKeys(o.bright),
    blur: sanitizeKeys(o.blur),
    hue: sanitizeKeys(o.hue),
    inv: sanitizeKeys(o.inv),
    blind: sanitizeKeys(o.blind),
    // 動かない設定値。数でなければ付けない（付けないと既定に落ちるだけで、落ちはしない）
    ...(typeof o.blindW === 'number' && Number.isFinite(o.blindW) ? { blindW: o.blindW } : null),
    ...(typeof o.blindDir === 'number' && Number.isFinite(o.blindDir) ? { blindDir: o.blindDir } : null),
    cl: sanitizeKeys(o.cl),
    ct: sanitizeKeys(o.ct),
    cr: sanitizeKeys(o.cr),
    cb: sanitizeKeys(o.cb)
  }
  return hasMotion(m) ? m : undefined
}

/** そのテロップに打たれている印の時刻（クリップ先頭からの秒） */
export function motionKeyTimes(m?: Motion): number[] {
  return m
    ? keyTimesOf(
        m.tx, m.ty, m.sc, m.rot, m.op, m.scx, m.skew,
        m.roty, m.rotx, m.bright, m.blur, m.cl, m.ct, m.cr, m.cb
      )
    : []
}
