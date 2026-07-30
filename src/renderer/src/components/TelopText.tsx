import { useId, useMemo } from 'react'
import {
  anchorFlex,
  anchorTranslate,
  animTransform,
  animFilter,
  animClip,
  animMask,
  animWave,
  NEUTRAL_ANIM,
  type Motion,
  buildTelopSVG,
  computeTelopAnim,
  applyMotion,
  hasMotion,
  computeTelopCss,
  textRectInFrame,
  ICON_BASE_PX,
  LINE_BASE,
  type TelopStyle,
  type TextRun
} from '../lib/telopStyle'

interface Props {
  text: string
  style: TelopStyle
  runs?: TextRun[] // 文字範囲ごとの部分装飾
  iconImage?: string // コラボアイコン（画像 dataURL）。テロップに付随（テキスト量に追従）
  ringColor?: string // アイコンの縁取り色（＝ラベル色）
  iconScale?: number // アイコンサイズ倍率。文字サイズとは独立
  iconAuto?: boolean // 自動調整: テロップの高さ(行数/文字サイズ)に合わせてサイズ＆隙間を決める（左側固定）
  iconSide?: 'left' | 'right' | 'top' | 'bottom' // アイコンをテキストのどの側に置くか
  iconOffsetX?: number // 微調整（1080基準px）
  iconOffsetY?: number
  pos?: { x: number; y: number }
  scale?: number // テロップ全体の拡縮倍率（Premiere式リサイズ）。既定1
  /**
   * フレームの幅（1080基準px。16:9=1920 / 9:16=607.5 / 1:1=1080）。
   * **切り抜きの換算に要る**（取り込んだ切り抜きはフレームの何％で入っているので、
   * 文字の箱がフレームのどこを占めるかが分からないと量を直せない）。
   */
  frameW?: number
  animT?: number // クリップ内ローカル時間（秒）。アニメ計算用
  motion?: Motion // 自分で打った動き（キーフレーム）
  clipDur?: number // クリップ長（秒）
  selected?: boolean
  playing?: boolean // 再生中か（再生中は選択中でもアニメを再生する）
  onPointerDown?: (e: React.PointerEvent) => void
  onDoubleClick?: (e: React.MouseEvent) => void
  onResizeStart?: (e: React.PointerEvent, corner: number) => void // 四隅ハンドル(0=TL,1=TR,2=BL,3=BR)
  onDragOver?: (e: React.DragEvent) => void // テンプレのドロップ受け
  onDrop?: (e: React.DragEvent) => void
}

const cqh = (v: number): string => `${(v / 1080) * 100}cqh`

/** モニターにスタイル付きテロップ（＋コラボアイコン）を pos の位置に描画する */
export default function TelopText({
  text,
  style,
  runs,
  iconImage,
  ringColor,
  iconScale = 1,
  iconAuto = false,
  iconSide = 'left',
  iconOffsetX = 0,
  iconOffsetY = 0,
  pos,
  scale = 1,
  frameW = 1920,
  animT,
  clipDur,
  motion,
  selected,
  playing,
  onPointerDown,
  onDoubleClick,
  onResizeStart,
  onDragOver,
  onDrop
}: Props): JSX.Element {
  const css = useMemo(() => computeTelopCss(style, text), [style, text])
  // 波形ワープのフィルタに付ける名札。テロップ1つにつき1つ（下で使う）
  const uid = useId()
  // アイコンのレイアウト用サイズは基準固定（＝枠に干渉しない）。見た目だけ scale(iconScale) で拡縮。
  const iconBaseSize = cqh(ICON_BASE_PX)
  const iconBorder = cqh(ICON_BASE_PX * 0.055)
  const iconGap = cqh(ICON_BASE_PX * 0.2)
  // 自動調整用: テロップのフォントサイズに比例した隙間/縁取り（1080基準px→cqh）
  const autoGap = cqh(style.fontSize * 0.25)
  const autoBorder = cqh(style.fontSize * 0.07)
  const p = pos ?? { x: 0.5, y: 0.85 }
  const box = style.box
  const handleCursors = ['nwse-resize', 'nesw-resize', 'nesw-resize', 'nwse-resize']
  // 自動調整ONは左側固定
  const effSide = iconAuto ? 'left' : iconSide
  const flexDir =
    effSide === 'right'
      ? 'row-reverse'
      : effSide === 'top'
        ? 'column'
        : effSide === 'bottom'
          ? 'column-reverse'
          : 'row'

  // 本文のSVG。**アニメ層より先に作る**（切り抜きの換算に文字の箱の大きさが要る）。
  // useMemoで内容が変わった時だけ再構築。無いと再生中の毎レンダーでSVG文字列が再生成され
  // （フィルタ/グラデidが毎回変わる＝innerHTML総入れ替え）、blurフィルタの再ラスタライズが毎フレーム走って
  // テロップ切替が「ぬめっと」低解像度で描かれるカクつきの原因になる。
  const tsvg = useMemo(() => buildTelopSVG(style, text, runs), [style, text, runs])

  // アニメ状態（プレビューは再生ヘッド位置から算出）。
  // 再生中は選択中でもアニメを再生。停止中に選択している時だけ、編集しやすいよう完全表示にする。
  const animBase =
    (playing || !selected) && style.anim && animT != null && clipDur != null
      ? computeTelopAnim(style.anim, animT, clipDur)
      : null
  // 自分で打った動きは、**止めて選んでいる間も出す**。
  // 出入りのアニメは編集の邪魔になるので止めているが、モーションは
  // 「いまどこにいるか」を見ながら打つものなので、隠すと打てない。
  const anim =
    animT != null && hasMotion(motion)
      ? applyMotion(
          animBase ?? NEUTRAL_ANIM,
          motion,
          animT
        )
      : animBase
  // 切り抜きは**フレームの何％**で入ってくる（向こうのエフェクトは画面全体にかかる）。
  // 文字の箱がフレームのどこを占めるかを渡して、箱の中の割合に直してもらう。
  const clipBox = textRectInFrame(p, style.anchor, tsvg.textW, tsvg.textH, frameW, 1080, scale)
  const clipCss = anim ? animClip(anim, clipBox) : ''
  const maskCss = anim ? animMask(anim) : ''
  // 波形ワープ。**定義（defs）と url(…) は必ず対で出す。**
  // 定義を置き忘れると波が出ないだけでなく、参照が壊れて文字ごと消える。
  // id はテロップごとに変える（同じ id だと、画面に複数出たとき先頭の波が全部に効く）。
  const waveId = 'wv' + uid.replace(/[^a-zA-Z0-9]/g, '')
  const wave = anim ? animWave(anim, 1, waveId) : { css: '', defs: '' }
  const filterCss = anim ? [animFilter(anim), wave.css].filter(Boolean).join(' ') : ''
  const animLayer: React.CSSProperties = anim
    ? {
        opacity: anim.opacity,
        transform: animTransform(anim, 'cqh'),
        transformOrigin: 'center',
        // 明るさ・ぼかし・切り抜きは transform では出せないので別に渡す
        ...(filterCss ? { filter: filterCss } : null),
        ...(clipCss ? { clipPath: clipCss } : null),
        // ブラインドは縞のマスク。書き出しでも焼けることは確かめてある
        ...(maskCss ? { WebkitMaskImage: maskCss, maskImage: maskCss } : null)
      }
    : {}
  const waveDefs = wave.defs ? (
    <span
      style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: wave.defs }}
    />
  ) : null

  const commonTransform = `translate(${cqh(iconOffsetX)}, ${cqh(iconOffsetY)}) scale(${iconScale})`
  // 本文はSVG描画（本家Premiereモデル: paint-order:stroke＝中央ストローク→塗りを上に）。
  // 縁/影はviewBoxのpad分はみ出すので、レイアウト箱=文字ボックス(textW×textH)にして
  // SVGを負オフセットで重ね overflow可視にする（旧dilate版と同じ占有サイズを保つ）。斜体もSVG内で処理。
  // ※ tsvg は上で作ってある（切り抜きの換算に文字の箱の大きさが要るため）。
  const textLayers = (
    // telop-textmain: 本文だけの箱（アイコンを含まない）。iconAuto切替の位置保持で実測に使う
    <div className="telop-textmain" style={{ position: 'relative', width: cqh(tsvg.textW), height: cqh(tsvg.textH) }}>
      <div
        style={{
          position: 'absolute',
          left: cqh(-tsvg.pad),
          top: cqh(-tsvg.pad),
          width: cqh(tsvg.w),
          height: cqh(tsvg.h)
        }}
        dangerouslySetInnerHTML={{ __html: tsvg.svg }}
      />
    </div>
  )
  const textWrap = <div style={{ position: 'relative', zIndex: 1 }}>{textLayers}</div>
  // 自動調整ON: 枠(固定ボックス)を参照せず、行数から高さを算出して左へ絶対配置＝つぶれない
  // 1行だと小さすぎるので、1行=約1.8行分/2行=約2.1行分…と行数に対して緩やかに拡大。縦中央合わせ。
  const lineCount = Math.max(1, text.split('\n').length)
  const lhUnit = style.fontSize * (LINE_BASE + style.leading / 100) // 1行の高さ(1080基準px)
  // アイコン高さ＝テキストブロック（1行目上端〜最終行下端）より少し大きいくらい。
  // 1行だけは存在感を出すため少し増し（行間を増やしてもアイコンが爆発しない）。
  const autoIconH = cqh(lhUnit * lineCount * (lineCount === 1 ? 1.4 : 1.15))
  let body: JSX.Element
  if (iconImage && iconAuto) {
    const autoIcon = (
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: '50%',
          height: autoIconH,
          aspectRatio: '1 / 1',
          zIndex: 0,
          transform: `translate(calc(-100% - ${autoGap} + ${cqh(iconOffsetX)}), calc(-50% + ${cqh(iconOffsetY)})) scale(${iconScale})`,
          transformOrigin: 'right center'
        }}
      >
        <img
          src={iconImage}
          alt=""
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            display: 'block',
            boxSizing: 'border-box',
            borderRadius: '50%',
            objectFit: 'cover',
            border: `${autoBorder} solid ${ringColor ?? '#fff'}`
          }}
        />
      </div>
    )
    body = (
      <div style={{ display: 'inline-block', ...animLayer }}>
        {waveDefs}
        <div style={{ ...css.container, position: 'relative', display: 'inline-block' }}>
          {autoIcon}
          {textWrap}
        </div>
      </div>
    )
  } else if (iconImage) {
    // OFF: 基準サイズ固定＋scale。テキストと同じフレックス箱に入れて枠がテロップ(アイコン込み)に一致
    const fixedIcon = (
      <img
        src={iconImage}
        alt=""
        style={{
          width: iconBaseSize,
          height: iconBaseSize,
          flex: '0 0 auto',
          borderRadius: '50%',
          objectFit: 'cover',
          border: `${iconBorder} solid ${ringColor ?? '#fff'}`,
          transform: commonTransform,
          transformOrigin: 'center',
          position: 'relative',
          zIndex: 0
        }}
      />
    )
    body = (
      <div style={{ display: 'inline-block', ...animLayer }}>
        {waveDefs}
        <div
          style={{
            ...css.container,
            display: 'flex',
            flexDirection: flexDir,
            alignItems: 'center',
            gap: iconGap
          }}
        >
          {fixedIcon}
          {textWrap}
        </div>
      </div>
    )
  } else {
    body = (
      <div style={{ display: 'inline-block', ...animLayer }}>
        {waveDefs}
        <div style={{ ...css.container, display: 'inline-block' }}>{textLayers}</div>
      </div>
    )
  }

  const handles =
    selected && onResizeStart
      ? [
          { top: '-6px', left: '-6px' },
          { top: '-6px', right: '-6px' },
          { bottom: '-6px', left: '-6px' },
          { bottom: '-6px', right: '-6px' }
        ].map((posStyle, i) => (
          <div
            key={i}
            className="telop-resize-handle"
            style={{ ...posStyle, cursor: handleCursors[i] }}
            onPointerDown={(e) => {
              e.stopPropagation()
              onResizeStart(e, i)
            }}
          />
        ))
      : null

  const cls = `telop-box ${selected ? 'telop-box-sel' : ''} ${onPointerDown ? 'telop-interactive' : ''}`
  // Premiere式リサイズの拡縮倍率（数値は固定・変形で拡縮）
  const scl = scale !== 1 ? ` scale(${scale})` : ''
  const originX = style.anchor?.h === 'l' ? '0%' : style.anchor?.h === 'r' ? '100%' : '50%'
  const originY = style.anchor?.v === 't' ? '0%' : style.anchor?.v === 'b' ? '100%' : '50%'

  // 固定ボックスあり: 箱の中心を pos に置き、中身を anchor で寄せる（テロップ自体は動かない）
  if (box) {
    const flex = anchorFlex(style.anchor)
    return (
      <div
        className={cls}
        style={{
          position: 'absolute',
          left: `${p.x * 100}%`,
          top: `${p.y * 100}%`,
          transform: `translate(-50%, -50%)${scl}`,
          transformOrigin: 'center',
          width: cqh(box.w),
          height: cqh(box.h),
          display: 'flex',
          justifyContent: flex.justifyContent,
          alignItems: flex.alignItems
        }}
        onPointerDown={onPointerDown}
        onDoubleClick={onDoubleClick}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        {body}
        {handles}
      </div>
    )
  }

  // ボックスなし（従来）: 内容ぴったり、anchor で配置点への合わせ隅を決める
  return (
    <div
      className={cls}
      style={{
        position: 'absolute',
        display: 'inline-block',
        left: `${p.x * 100}%`,
        top: `${p.y * 100}%`,
        transform: `${anchorTranslate(style.anchor)}${scl}`,
        transformOrigin: `${originX} ${originY}`
      }}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {body}
      {handles}
    </div>
  )
}
