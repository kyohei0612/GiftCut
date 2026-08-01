// テロップを（プレビューと同じ見た目で）PNG画像にラスタライズする。
// SVG foreignObject にHTMLを埋め込み → Image化 → canvasに描画 → PNG。

import {
  anchorFlex,
  anchorTranslate,
  animTransform,
  animFilter,
  animClip,
  animMask,
  animWave,
  animMotionBlur,
  animTurbulence,
  buildTelopSVG,
  textRectInFrame,
  hexToRgba,
  ICON_BASE_PX,
  LINE_BASE,
  type AnimState
} from './telopStyle'
import type { Cue } from './srt'

// 本文描画は telopStyle.buildTelopSVG（本家paint-order:strokeモデル）に一本化。
// 旧 fillCssStr/telopLayerStrs/escapeHtml(dilate方式) は廃止。

function innerHtml(
  cue: Cue,
  width: number,
  height: number,
  avatar?: string,
  avatarScale = 1,
  anim?: AnimState,
  iconSide: 'left' | 'right' | 'top' | 'bottom' = 'left',
  iconOffsetX = 0,
  iconOffsetY = 0,
  iconAuto = false
): string {
  const s = cue.style
  const scale = height / 1080
  const animClose = anim ? '</div>' : ''
  const fs = s.fontSize * scale
  const boxBg = s.background.enabled ? hexToRgba(s.background.color, s.background.opacity) : 'transparent'
  // size/corner は 1080基準px → 書き出しは scale 倍。未定義時は従来の fontSize 比例。
  const padV = s.background.enabled ? (s.background.size != null ? s.background.size * scale : fs * 0.12) : 0
  const padH = s.background.enabled ? (s.background.size != null ? s.background.size * scale : fs * 0.28) : 0
  const radius = s.background.enabled ? (s.background.corner != null ? s.background.corner * scale : fs * 0.1) : 0


  // 本文はSVG描画（本家paint-order:strokeモデル）。プレビュー/サムネと同一の buildTelopSVG。
  const tsvg = buildTelopSVG(s, cue.text, cue.runs)

  // アイコン。OFF = 基準サイズ固定＋scale をフレックス箱に内包（枠がアイコン込みで一致）
  // ON(自動調整) = 枠を参照せずテキスト箱の高さに追従して左へ絶対配置＝つぶれない・上下より少し大きめ×1.15
  const offX = iconOffsetX * scale
  const offY = iconOffsetY * scale
  const commonTf = `transform:translate(${offX.toFixed(1)}px,${offY.toFixed(1)}px) scale(${avatarScale});transform-origin:center;`
  const flexDir = iconSide === 'right' ? 'row-reverse' : iconSide === 'top' ? 'column' : iconSide === 'bottom' ? 'column-reverse' : 'row'
  const iconLayoutPx = ICON_BASE_PX * scale // 固定用の基準サイズ
  const gap = iconLayoutPx * 0.2
  const autoGap = fs * 0.25
  const autoBorder = fs * 0.07

  const p = cue.pos ?? { x: 0.5, y: 0.85 }
  // アニメ層（opacity/transform/フィルタ/切り抜き）。無ければ素通し。
  // **切り抜きはフレームの何％で入ってくる**ので、文字の箱がフレームのどこを
  // 占めるかを渡して直してもらう（プレビューと同じ textRectInFrame を通す。
  // 別々に書くと、見た絵と焼けた絵で削れる量が変わる）。
  const clipCss = anim
    ? animClip(anim, textRectInFrame(p, s.anchor, tsvg.textW, tsvg.textH, width / (height / 1080), 1080, cue.scale ?? 1))
    : ''
  const maskCss = anim ? animMask(anim, scale) : ''
  // 波形ワープ。**フィルタの定義を同じ書類に入れないと参照が壊れる**ので、
  // url(…) と <svg> は必ず対で出す（定義だけ落とすと文字ごと消える）。
  // id はテロップごとに変える。1枚に複数出るとき、同じ id だと先頭の波が全部に効く。
  const wave = anim ? animWave(anim, scale, `wv${cue.id}`) : { css: '', defs: '' }
  const mblur = anim ? animMotionBlur(anim, scale, `mb${cue.id}`) : { css: '', defs: '' }
  const turb = anim ? animTurbulence(anim, scale, `tb${cue.id}`) : { css: '', defs: '' }
  // **ここも他と同じく anim を確かめてから渡す。**
  // 「!」で握りつぶしていたため、動きの付いていないテロップが1つでもあると
  // animFilter の中で落ち、**書き出しが丸ごと失敗していた**（画面には
  // 「書き出しエラー: Cannot read properties of undefined (reading 'bright')」だけが出る）。
  const filterCss = [anim ? animFilter(anim, scale) : '', wave.css, mblur.css, turb.css]
    .filter(Boolean)
    .join(' ')
  const animOpen = anim
    ? `<div style="display:inline-block;opacity:${anim.opacity.toFixed(3)};transform:${animTransform(anim, 'px', scale)};transform-origin:center;` +
      `${filterCss ? `filter:${filterCss};` : ''}` +
      `${clipCss ? `clip-path:${clipCss};` : ''}` +
      `${maskCss ? `-webkit-mask-image:${maskCss};mask-image:${maskCss};` : ''}">${wave.defs}`
    : ''
  // レイアウト箱=文字ボックス(px)。SVGを負オフセットで重ね overflow可視（プレビューと同一手法）。斜体もSVG内。
  const tw = tsvg.textW * scale
  const th = tsvg.textH * scale
  const tpad = tsvg.pad * scale
  const textDiv =
    `<div style="position:relative;width:${tw.toFixed(1)}px;height:${th.toFixed(1)}px">` +
    `<div style="position:absolute;left:${(-tpad).toFixed(1)}px;top:${(-tpad).toFixed(1)}px;` +
    `width:${(tsvg.w * scale).toFixed(1)}px;height:${(tsvg.h * scale).toFixed(1)}px;overflow:visible">${tsvg.svg}</div></div>`
  const baseContent = [
    `text-align:${s.align}`,
    `background:${boxBg}`,
    `padding:${padV.toFixed(1)}px ${padH.toFixed(1)}px`,
    `border-radius:${radius.toFixed(1)}px`
  ]

  let contentHtml: string
  if (avatar && iconAuto) {
    // テキストブロック（1行目上端〜最終行下端）より少し大きいくらい（行間で爆発しない）。
    // 1行だけは存在感を出すため少し増し。TelopText.tsx と同式。
    const lineCount = Math.max(1, cue.text.split('\n').length)
    const lhUnit = fs * (LINE_BASE + s.leading / 100)
    const autoIconH = lhUnit * lineCount * (lineCount === 1 ? 1.4 : 1.15)
    const autoIcon =
      `<div style="position:absolute;left:0;top:50%;height:${autoIconH.toFixed(1)}px;aspect-ratio:1 / 1;z-index:0;` +
      `transform:translate(calc(-100% - ${autoGap.toFixed(1)}px + ${offX.toFixed(1)}px),calc(-50% + ${offY.toFixed(1)}px)) scale(${avatarScale});transform-origin:right center;">` +
      `<img src="${avatar}" style="position:absolute;inset:0;width:100%;height:100%;display:block;box-sizing:border-box;border-radius:50%;object-fit:cover;border:${autoBorder.toFixed(1)}px solid ${cue.label};" /></div>`
    const contentStyle = [...baseContent, `position:relative`, `display:inline-block`, `width:max-content`].join(';')
    contentHtml = `<div style="${contentStyle}">${autoIcon}<div style="position:relative;z-index:1;">${textDiv}</div></div>`
  } else if (avatar) {
    const iconHtml = `<img src="${avatar}" style="width:${iconLayoutPx.toFixed(1)}px;height:${iconLayoutPx.toFixed(1)}px;flex:0 0 auto;border-radius:50%;object-fit:cover;border:${(iconLayoutPx * 0.055).toFixed(1)}px solid ${cue.label};${commonTf}position:relative;z-index:0;" />`
    const contentStyle = [
      ...baseContent,
      `display:flex`,
      `flex-direction:${flexDir}`,
      `align-items:center`,
      `gap:${gap.toFixed(1)}px`,
      `width:max-content`
    ].join(';')
    contentHtml = `<div style="${contentStyle}">${iconHtml}<div style="position:relative;z-index:1;">${textDiv}</div></div>`
  } else {
    const contentStyle = [...baseContent, `display:inline-block`, `width:max-content`].join(';')
    contentHtml = `<div style="${contentStyle}">${textDiv}</div>`
  }

  let placed: string
  // Premiere式リサイズの拡縮倍率（数値固定・変形で拡縮）。プレビューと同一
  const cueScale = cue.scale ?? 1
  const scl = cueScale !== 1 ? ` scale(${cueScale})` : ''
  const originX = s.anchor?.h === 'l' ? '0%' : s.anchor?.h === 'r' ? '100%' : '50%'
  const originY = s.anchor?.v === 't' ? '0%' : s.anchor?.v === 'b' ? '100%' : '50%'
  if (s.box) {
    // 固定ボックス: 箱の中心を pos に置き、中身を anchor で寄せる
    const flex = anchorFlex(s.anchor)
    const boxStyle = [
      `position:absolute`,
      `left:${(p.x * width).toFixed(1)}px`,
      `top:${(p.y * height).toFixed(1)}px`,
      `transform:translate(-50%,-50%)${scl}`,
      `transform-origin:center`,
      `width:${(s.box.w * scale).toFixed(1)}px`,
      `height:${(s.box.h * scale).toFixed(1)}px`,
      `display:flex`,
      `justify-content:${flex.justifyContent}`,
      `align-items:${flex.alignItems}`
    ].join(';')
    placed = `<div style="${boxStyle}">${animOpen}${contentHtml}${animClose}</div>`
  } else {
    // ボックスなし（従来）: 内容ぴったり、anchor で合わせ隅を決める。位置とアニメ層を分離
    const boxStyle = [
      `position:absolute`,
      `display:inline-block`,
      `left:${(p.x * width).toFixed(1)}px`,
      `top:${(p.y * height).toFixed(1)}px`,
      `transform:${anchorTranslate(s.anchor)}${scl}`,
      `transform-origin:${originX} ${originY}`
    ].join(';')
    placed = `<div style="${boxStyle}">${animOpen}${contentHtml}${animClose}</div>`
  }

  return (
    `<div style="position:relative;width:${width}px;height:${height}px;box-sizing:border-box;">` +
    placed +
    `</div>`
  )
}

function cueToSvgDataUrl(
  cue: Cue,
  width: number,
  height: number,
  avatar?: string,
  avatarScale = 1,
  anim?: AnimState,
  iconSide: 'left' | 'right' | 'top' | 'bottom' = 'left',
  iconOffsetX = 0,
  iconOffsetY = 0,
  iconAuto = false
): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<foreignObject width="100%" height="100%">` +
    `<div xmlns="http://www.w3.org/1999/xhtml">${innerHtml(cue, width, height, avatar, avatarScale, anim, iconSide, iconOffsetX, iconOffsetY, iconAuto)}</div>` +
    `</foreignObject></svg>`
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
}

/** テロップ1枚を全画面透過PNG（データURL）にする。anim を渡すとその瞬間の見た目で描く */
export function renderCueToPng(
  cue: Cue,
  width: number,
  height: number,
  avatar?: string,
  avatarScale = 1,
  anim?: AnimState,
  iconSide: 'left' | 'right' | 'top' | 'bottom' = 'left',
  iconOffsetX = 0,
  iconOffsetY = 0,
  iconAuto = false
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = (): void => {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('canvas context 取得失敗'))
        return
      }
      ctx.drawImage(img, 0, 0, width, height)
      try {
        resolve(canvas.toDataURL('image/png'))
      } catch (e) {
        reject(e as Error)
      }
    }
    img.onerror = (): void => reject(new Error('テロップ画像化に失敗'))
    img.src = cueToSvgDataUrl(cue, width, height, avatar, avatarScale, anim, iconSide, iconOffsetX, iconOffsetY, iconAuto)
  })
}

/** フロートアイコン1枚を全画面透過PNGにする（中心 pos(0-1) に円形アイコンを配置） */
export function renderIconToPng(
  image: string,
  ring: string,
  x: number,
  y: number,
  scale: number,
  width: number,
  height: number
): Promise<string> {
  const px = ICON_BASE_PX * scale * (height / 1080)
  const border = px * 0.055
  const iconDiv =
    `<div style="position:absolute;left:${(x * width).toFixed(1)}px;top:${(y * height).toFixed(1)}px;` +
    `transform:translate(-50%,-50%);width:${px.toFixed(1)}px;height:${px.toFixed(1)}px;` +
    `border-radius:50%;overflow:hidden;box-sizing:border-box;border:${border.toFixed(1)}px solid ${ring};">` +
    `<img src="${image}" style="width:100%;height:100%;object-fit:cover;" /></div>`
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml">` +
    `<div style="position:relative;width:${width}px;height:${height}px;">${iconDiv}</div>` +
    `</div></foreignObject></svg>`
  const src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
  return new Promise((resolve, reject) => {
    const im = new Image()
    im.onload = (): void => {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('canvas context 取得失敗'))
        return
      }
      ctx.drawImage(im, 0, 0, width, height)
      try {
        resolve(canvas.toDataURL('image/png'))
      } catch (e) {
        reject(e as Error)
      }
    }
    im.onerror = (): void => reject(new Error('アイコン画像化に失敗'))
    im.src = src
  })
}
