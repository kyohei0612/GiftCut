// テロップの「動き」。時間のどこに居るかから、その瞬間の見た目を出す。
//
// ## 画面と書き出しで、同じ計算を通す
//
// **プレビューも書き出しも、必ずここを呼ぶ。** 別々に式を書き起こすと、
// 見た絵と焼けた絵が違うという一番たちの悪い壊れ方をする。
// テロップは HTML を PNG に焼く経路なので、**CSS でできることは全部できる**
// （動画クリップは ffmpeg の制約を受けるが、テロップは受けない）。
//
// ## 出す物は「その瞬間の状態」1つ
//
// `computeTelopAnim()` が AnimState を返し、そこから CSS を組む関数が並ぶ:
//
//   animTransform  … 位置・拡大・回転・歪み・3D回転
//   animFilter     … 明るさ・ぼかし
//   animWave       … 波形ワープ（SVG フィルタ）
//   animTurbulence … タービュレントディスプレイス（SVG フィルタ）
//   animMotionBlur … 動きに合わせたぶれ
//   animMask       … マスク
//   animClip       … 切り抜き
//
// ## Premiere のプリセットを取り込むために足した物が多い
//
// 実物（72個）のうち43個をそのまま再現できる所まで来ている。
// 足りない物を足すときは `npm run frames`（1コマずつ画素で確認）で見ること。
// 経緯は .company/engineering/docs/telop-systems-2026-07-22.md

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
  /**
   * 波形ワープ。文字を波打たせる。**SPLITSLIDE 系はこれが本体。**
   *   wavH   波紋の高さ（px・1080基準。0=波なし。負なら裏返る）
   *   wavW   波1つぶんの長さ（px・1080基準。小さいほど細かい）
   *   wavDir 波の向き（度）
   *   wavPh  いまの位相（度）。速度から時刻ぶん進めた値を入れる
   */
  wavH: number
  wavW: number
  wavDir: number
  wavPh: number
  /**
   * ブラー（方向）。動いた跡を引く。
   *   mbLen 引く長さ（px・1080基準。0=なし）
   *   mbDir 引く向き（度）
   * **向きを持たない普通のぼかしで代えないこと。** 43.ブラー方向 は
   * 0.27秒で向きが4回振れるのが演出の本体で、丸いぼかしにすると別物になる。
   */
  mbLen: number
  mbDir: number
  /**
   * タービュレントディスプレイス（雲状のノイズでぐにゃぐにゃ揺らす）。
   *   tbAmt  揺らす量（px・1080基準。0=なし）
   *   tbSize 揺れの粗さ（px。大きいほど大きくうねる）
   *   tbOct  重ねる段数（複雑度）
   *   tbSeed 模様を選ぶ番号。変えると形が丸ごと変わる
   *   tbOffX/Y 模様そのものを平行移動する量（px）
   */
  tbAmt: number
  tbSize: number
  tbOct: number
  tbSeed: number
  tbOffX: number
  tbOffY: number
}
/** 何も付いていない状態。呼ぶ側が毎回書くと、項目を足したとき直し漏れる */
export const NEUTRAL_ANIM: AnimState = {
  opacity: 1, tx: 0, ty: 0, sc: 1, rot: 0, scx: 1, scy: 1, skew: 0,
  roty: 0, rotx: 0, bright: 1, blur: 0, hue: 0, inv: 0,
  blind: 0, blindW: 45, blindDir: 0, crop: { l: 0, t: 0, r: 0, b: 0 },
  wavH: 0, wavW: 100, wavDir: 0, wavPh: 0, mbLen: 0, mbDir: 0,
  tbAmt: 0, tbSize: 100, tbOct: 1, tbSeed: 0, tbOffX: 0, tbOffY: 0
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
 * 波形ワープ。文字を正弦の波で押し出す。
 *
 * ## なぜ SVG フィルタなのか
 *
 * CSS の filter には「画素をずらす」物が無い。SVG の feDisplacementMap は
 * **別の絵の色を「どっちへ何px ずらすか」として読む**ので、これで波が作れる。
 * テロップは元々 SVG で描いて PNG に焼く経路なので、プレビューも書き出しも
 * 同じ物が通る（CSS だけの小細工にすると、書き出しで消える）。
 *
 * ## ずらし方の絵
 *
 * 赤＝横のずれ、緑＝縦のずれ。0.5 が「ずらさない」。
 * 波の向きに沿って色が正弦で往復する縞を敷けば、その向きに直交して文字が波打つ。
 * 縞は linearGradient を repeat させて作る（正弦を段で近似する）。
 *
 * ## 戻り値
 *
 * css  … filter に足す文字列（url(#…)）。波が無ければ空
 * defs … 同じ書類の中に置く <svg>。**これを置き忘れると波が消える**だけでなく、
 *        参照が壊れて**文字ごと消える**ブラウザがあるので、必ず対で使う
 */
export function animWave(
  s: AnimState,
  pxScale = 1,
  id = 'w'
): { css: string; defs: string } {
  const h = s.wavH * pxScale
  if (Math.abs(h) < 0.05) return { css: '', defs: '' }
  // 波1つぶんの長さ。0 や極端に細かい値は、縞が潰れて模様が出ないので下限を置く
  const period = Math.max(2, Math.abs(s.wavW) * pxScale)
  const dir = ((s.wavDir % 360) + 360) % 360
  const rad = (dir * Math.PI) / 180
  const ph = ((s.wavPh % 360) + 360) % 360
  // 縞の向き＝波の進む向き。ずれる向きはそれに直交する
  const gx = Math.cos(rad)
  const gy = Math.sin(rad)
  // 1周ぶんを段で近似する。32段あれば、目で見て角が出ない
  const N = 32
  const stops: string[] = []
  for (let i = 0; i <= N; i++) {
    const v = Math.sin(2 * Math.PI * (i / N) + (ph * Math.PI) / 180)
    // ずれる向き（縞に直交）へ v ぶん。0.5 が「ずらさない」
    const r = Math.round(255 * (0.5 - 0.5 * v * gy))
    const g = Math.round(255 * (0.5 + 0.5 * v * gx))
    stops.push(
      `<stop offset="${((i / N) * 100).toFixed(2)}%" stop-color="rgb(${r},${g},128)"/>`
    )
  }
  // 縞1周ぶんのベクトル。これを spreadMethod="repeat" で敷き詰める
  const x2 = (gx * period).toFixed(3)
  const y2 = (gy * period).toFixed(3)
  const gid = `${id}g`
  const fid = `${id}f`
  const defs =
    `<svg width="0" height="0" style="position:absolute" aria-hidden="true">` +
    `<defs>` +
    `<linearGradient id="${gid}" gradientUnits="userSpaceOnUse" ` +
    `x1="0" y1="0" x2="${x2}" y2="${y2}" spreadMethod="repeat">${stops.join('')}</linearGradient>` +
    // 波で押し出すと元の枠からはみ出す。広めに取らないと端が切れる
    `<filter id="${fid}" x="-50%" y="-50%" width="200%" height="200%" ` +
    `filterUnits="objectBoundingBox" primitiveUnits="userSpaceOnUse" color-interpolation-filters="sRGB">` +
    `<feImage href="data:image/svg+xml;utf8,${encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="4000" height="4000">` +
        `<defs><linearGradient id="g" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${x2}" y2="${y2}" spreadMethod="repeat">${stops.join('')}</linearGradient></defs>` +
        `<rect width="4000" height="4000" fill="url(#g)"/></svg>`
    )}" x="-2000" y="-2000" width="4000" height="4000" result="map"/>` +
    // scale は「色の幅(±0.5)ぶんで何px 動くか」なので、狙いの高さの2倍を渡す
    `<feDisplacementMap in="SourceGraphic" in2="map" scale="${(Math.abs(h) * 2).toFixed(2)}" ` +
    `xChannelSelector="R" yChannelSelector="G"/>` +
    `</filter></defs></svg>`
  return { css: `url(#${fid})`, defs }
}

/**
 * タービュレントディスプレイス。雲状のノイズで、絵をぐにゃぐにゃ揺らす。
 *
 * 波形ワープが「規則正しい波」なのに対して、こちらは**でたらめなうねり**。
 * SVG の feTurbulence が同じ考え方でできているので、ほぼそのまま写せる。
 *
 *   適用量   → ずらす量（feDisplacementMap の scale）
 *   サイズ   → うねりの粗さ。周波数はこの逆数
 *   複雑度   → 重ねる段数（numOctaves）
 *   シード   → 模様を選ぶ番号。変えると形が丸ごと変わる＝揺れて見える
 *   オフセット → 模様そのものを平行移動（feOffset）
 *
 * 戻り値は他と同じで、css と defs は**必ず対**。
 */
export function animTurbulence(
  s: AnimState,
  pxScale = 1,
  id = 't'
): { css: string; defs: string } {
  const amt = Math.abs(s.tbAmt) * pxScale
  if (amt < 0.3) return { css: '', defs: '' }
  // 粗さ→周波数。細かすぎると模様が潰れ、粗すぎるとただの平行移動になる
  const freq = 1 / Math.max(4, Math.abs(s.tbSize) * pxScale)
  const oct = Math.max(1, Math.min(6, Math.round(s.tbOct)))
  // シードは整数でないと、ブラウザによって扱いが割れる
  const seed = Math.round(s.tbSeed)
  const dx = (s.tbOffX * pxScale).toFixed(2)
  const dy = (s.tbOffY * pxScale).toFixed(2)
  const fid = `${id}f`
  const defs =
    `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>` +
    `<filter id="${fid}" x="-50%" y="-50%" width="200%" height="200%" ` +
    `filterUnits="objectBoundingBox" primitiveUnits="userSpaceOnUse" color-interpolation-filters="sRGB">` +
    `<feTurbulence type="fractalNoise" baseFrequency="${freq.toFixed(5)}" ` +
    `numOctaves="${oct}" seed="${seed}" result="n"/>` +
    `<feOffset in="n" dx="${dx}" dy="${dy}" result="n2"/>` +
    `<feDisplacementMap in="SourceGraphic" in2="n2" scale="${(amt * 2).toFixed(2)}" ` +
    `xChannelSelector="R" yChannelSelector="G"/>` +
    `</filter></defs></svg>`
  return { css: `url(#${fid})`, defs }
}

/**
 * ブラー（方向）。動いた跡を、指定の向きへ引く。
 *
 * ## なぜ普通のぼかしで代えないか
 *
 * CSS の blur も SVG の feGaussianBlur も**向きを持てない**（縦横別々には
 * 指定できるが、斜めは指定できず、45度は結局まん丸になる）。
 * 43.ブラー方向 は 0.27秒で向きが 45 → -45 → -90 → -135 と振れるのが本体で、
 * まん丸のぼかしにすると「ただ滲んで戻るだけ」の別物になる。
 *
 * ## どう作るか
 *
 * 元の絵を、その向きに沿って少しずつずらした写しを重ねる（尾を引く）。
 * 重ねただけだと段が見えるので、最後に写し1つぶんの間隔だけ軽くぼかして均す。
 *
 * 戻り値は animWave と同じで、css と defs は**必ず対**。
 */
export function animMotionBlur(
  s: AnimState,
  pxScale = 1,
  id = 'b'
): { css: string; defs: string } {
  const len = Math.abs(s.mbLen) * pxScale
  if (len < 0.6) return { css: '', defs: '' }
  const rad = (s.mbDir * Math.PI) / 180
  // 写しの数。だいたい6pxごと。増やすほど滑らかだが、そのぶん重い
  const n = Math.max(3, Math.min(12, Math.round(len / 6)))
  const ux = Math.cos(rad)
  const uy = Math.sin(rad)
  const parts: string[] = []
  const names: string[] = []
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1) - 0.5) * len
    const dx = (ux * t).toFixed(2)
    const dy = (uy * t).toFixed(2)
    parts.push(`<feOffset in="SourceGraphic" dx="${dx}" dy="${dy}" result="o${i}"/>`)
    parts.push(
      `<feComponentTransfer in="o${i}" result="m${i}">` +
        `<feFuncA type="linear" slope="${(1 / n).toFixed(4)}"/></feComponentTransfer>`
    )
    names.push(`<feMergeNode in="m${i}"/>`)
  }
  const smooth = (len / n / 2).toFixed(2)
  const fid = `${id}f`
  const defs =
    `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>` +
    // 尾は元の枠からはみ出す。広めに取らないと端で切れる
    `<filter id="${fid}" x="-50%" y="-50%" width="200%" height="200%" ` +
    `filterUnits="objectBoundingBox" primitiveUnits="userSpaceOnUse">` +
    parts.join('') +
    `<feMerge result="trail">${names.join('')}</feMerge>` +
    `<feGaussianBlur in="trail" stdDeviation="${smooth}"/>` +
    `</filter></defs></svg>`
  return { css: `url(#${fid})`, defs }
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
