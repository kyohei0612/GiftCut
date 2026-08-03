// プレビューに重なる中身。下から順に、
//
//   VideoLayers … V2以降の重ねた動画
//   ImageLayers … 画像クリップ
//   TelopLayer  … テロップ
//
// **重なる順はここの並び順で決まる。** 動画 → 画像 → テロップ。
// 入れ替えると、画像がテロップを隠すといった事故になる。
//
// ## 「見えていない物は掴まない」
//
// 段の 👁 を切った物と、いまの時刻の区間外にある物は、
// **要素は残したまま透明にしてクリックも拾わせない**。要素ごと消さないのは、
// 動画は消すと読み直しになって再生が引っかかるため。音は鳴り続ける
// （👁 は「映像だけ消す」で、消音とは別）。

import { toGcUrl } from '../../lib/gcUrl'
import type { JSX } from 'react'
import { adjustCss, cropInset } from '../../lib/clipLook'
import TelopText from '../TelopText'
import type { Cue } from '../../lib/srt'
import { useDoc } from '../../state/contentContext'
import { useSel } from '../../state/selectionContext'
import { useTracksCtx } from '../../state/tracksContext'
import { usePlaybackCtx } from '../../state/playbackContext'

/* eslint-disable @typescript-eslint/no-explicit-any */

/** V2以降の重ねた動画。変形・不透明度・色調整・切り抜きは動画切片と同じ扱い */
export function VideoLayers({
  clips,
  vcLen,
  vcRefCb,
  clipXform,
  previewUrl,
  onSelect
}: {
  /** いま窓に入っているぶんだけ（全部置くと要素が増えすぎる） */
  clips: any[]
  vcLen: (c: any) => number
  vcRefCb: (id: number) => (el: HTMLVideoElement | null) => void
  /** 回転・反転・ズームの CSS（lib/clipXform）。画像と同じ物 */
  clipXform: (c: any, localT: number) => string | undefined
  previewUrl: (path: string, orig: string) => string
  onSelect: (e: React.PointerEvent, t: { kind: 'vclip'; clip: any }) => void
}): JSX.Element {
  const { trackStates } = useTracksCtx()
  const { currentTime } = usePlaybackCtx()
  return (
    <>
      {clips.map((c) => {
        // 窓には入っているが区間外のクリップは、要素を残したまま非表示にする
        const local = currentTime - c.tStart
        const inRange = local >= 0 && local < vcLen(c)
        const hidden = !inRange || trackStates[c.track]?.hidden
        return (
          <video
            key={`vcv-${c.id}`}
            ref={vcRefCb(c.id)}
            className="screen-vclip"
            // スクショが「いま出ている映像レイヤー」を拾うための札。
            // 撮る側（usePreviewManip）は心臓を通らずここから実物を取る
            data-vcid={c.id}
            // 本編映像と同じプレビュー解像度方針に従う（原本指定なら原本）
            src={previewUrl(c.path, toGcUrl(c.path))}
            preload="auto"
            playsInline
            style={{
              transform: clipXform(c, local),
              filter: adjustCss(c.adjust),
              clipPath: cropInset(c.crop),
              // 👁非表示は「映像だけ消す」（音は鳴り続ける＝V1のvideoBlankと同じ扱い）
              opacity: hidden ? 0 : (c.opacity ?? 1),
              // 区間外・非表示のものはクリックを拾わない（見えていないものを掴まない）
              pointerEvents: hidden ? 'none' : undefined
            }}
            title={`${c.name}（ドラッグで移動・四隅で拡大）`}
            onPointerDown={(e) => onSelect(e, { kind: 'vclip', clip: c })}
          />
        )
      })}
    </>
  )
}

/**
 * 画像クリップ（テロップより下・映像より上）。
 *
 * **上の段が前面に来るよう並べ替える。** 段の並びは配列の後ろほど下段なので、
 * そのまま描くと上下が逆になる。
 */
export function ImageLayers({
  clipXform,
  onSelect
}: {
  /** 回転・反転・ズームの CSS（lib/clipXform）。映像レイヤーと同じ物 */
  clipXform: (c: any, localT: number) => string | undefined
  onSelect: (e: React.PointerEvent, t: { kind: 'img'; clip: any }) => void
}): JSX.Element {
  const { imgClips } = useDoc()
  const { tracks, trackStates } = useTracksCtx()
  const { currentTime } = usePlaybackCtx()
  return (
    <>
      {imgClips
        .filter(
          (c) =>
            currentTime >= c.tStart &&
            currentTime < c.tStart + c.duration &&
            !trackStates[c.track]?.hidden
        )
        // 上のトラック(V3)が前面に来るよう、トラック順（配列の後ろほど下段）で並べ替える
        .slice()
        .sort(
          (a, b) =>
            tracks.findIndex((t) => t.id === b.track) - tracks.findIndex((t) => t.id === a.track)
        )
        .map((c) => (
          <img
            key={`simg-${c.id}`}
            className="screen-img"
            src={toGcUrl(c.path)}
            alt=""
            title={`${c.name}（ドラッグで移動・四隅で拡大）`}
            style={{
              transform: clipXform(c, currentTime - c.tStart),
              filter: adjustCss(c.adjust),
              clipPath: cropInset(c.crop),
              opacity: c.opacity ?? 1
            }}
            // プレビュー上で画像を直接掴めるようにする。以前はここが
            // pointer-events: none だったため、画面に出ている画像を押しても
            // クリックが下の動画へ抜けて「動画のパンが始まる」だけだった。
            onPointerDown={(e) => onSelect(e, { kind: 'img', clip: c })}
          />
        ))}
    </>
  )
}

/** テロップ。一番上に重なる */
export function TelopLayer({
  activeCues,
  cueTrack,
  iconForCue,
  iconScale,
  iconAuto,
  iconSide,
  iconOffset,
  ratio,
  draggingTemplateRef,
  draggingIconRef,
  applyTemplateToCue,
  applyIconToCue,
  onResizeStart,
  onPointerDown,
  onEdit
}: {
  /** いまの時刻に出ているぶん */
  activeCues: Cue[]
  cueTrack: (c: Cue) => string
  iconForCue: (c: Cue) => string | undefined
  iconScale: number
  iconAuto: boolean
  iconSide: any
  iconOffset: { x: number; y: number }
  ratio: '16:9' | '9:16' | '1:1'
  /** 掴んで運んでいる最中の見本帳・アイコン（落とすと当たったテロップに付く） */
  draggingTemplateRef: React.MutableRefObject<any>
  draggingIconRef: React.MutableRefObject<string | null>
  applyTemplateToCue: (id: number, tpl: any) => void
  applyIconToCue: (id: number, color: string) => void
  onResizeStart: (c: Cue, e: React.PointerEvent, corner: number) => void
  onPointerDown: (c: Cue, e: React.PointerEvent) => void
  /** ダブルクリックでその場の打ち替えへ */
  onEdit: (c: Cue) => void
}): JSX.Element {
  const { trackStates } = useTracksCtx()
  const { isSelected } = useSel()
  const { currentTime, playing } = usePlaybackCtx()
  return (
    <div className="telop-overlay">
      {activeCues
        .filter((c) => !trackStates[cueTrack(c)]?.hidden) // 行の👁非表示を尊重
        .map((c) => (
          <TelopText
            key={c.id}
            text={c.text}
            style={c.style}
            runs={c.runs}
            iconImage={iconForCue(c)}
            ringColor={c.label}
            iconScale={iconScale}
            iconAuto={iconAuto}
            iconSide={iconSide}
            iconOffsetX={iconOffset.x}
            iconOffsetY={iconOffset.y}
            pos={c.pos}
            scale={c.scale}
            // 取り込んだ切り抜きは**フレームの何％**で入っているので、
            // フレームの幅（1080基準px）が要る。比率で変わる
            frameW={ratio === '16:9' ? 1920 : ratio === '9:16' ? 607.5 : 1080}
            animT={currentTime - c.start}
            clipDur={c.end - c.start}
            motion={c.motion}
            selected={isSelected(c.id)}
            playing={playing}
            onResizeStart={(e, corner) => onResizeStart(c, e, corner)}
            onDragOver={(e) => {
              if (draggingTemplateRef.current || draggingIconRef.current) e.preventDefault()
            }}
            onDrop={(e) => {
              const tpl = draggingTemplateRef.current
              const iconColor = draggingIconRef.current
              if (!tpl && !iconColor) return
              e.preventDefault()
              e.stopPropagation()
              if (tpl) applyTemplateToCue(c.id, tpl)
              else if (iconColor) applyIconToCue(c.id, iconColor)
            }}
            onPointerDown={(e) => onPointerDown(c, e)}
            onDoubleClick={() => onEdit(c)}
          />
        ))}
    </div>
  )
}
/* eslint-enable @typescript-eslint/no-explicit-any */
