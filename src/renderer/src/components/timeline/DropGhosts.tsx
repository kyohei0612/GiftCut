// 掴んで運んでいる最中に出る、半透明の置き場所プレビュー（ゴースト）。
//
// ## なぜ要るか
//
// **落としてから「そこじゃない」と気づくのを無くす。** タイムラインは
// 落とした瞬間に他のクリップを押しのけたり上書きしたりするので、
// 離す前に「ここに、この長さで入る」が見えている必要がある。
//
// ## 何をするかを文字で出す
//
// 動画は落とし方が5通りある（上書き・挿入・重ねる・移動・複製・割り込み）。
// 見た目の位置だけでは**上書きなのか挿入なのか**が区別できないので、
// ゴーストの中に言葉で書く。取り違えると、下にあった映像が消える。
//
// ## 音は波形まで出す
//
// 取り込んだときに作った波形をそのまま描く。掴んでいる間から中身が見えるので、
// 「この音を、この位置に」が離す前に確かめられる。まだ解析中なら、
// そう書いておく（何も出ないと壊れて見える）。

import { bandWidth } from '../../lib/bandGeom'
import type { JSX } from 'react'
import WaveformCanvas from '../WaveformCanvas'
import type { SegLayout } from '../../lib/projectTypes'

/* eslint-disable @typescript-eslint/no-explicit-any */

/** ゴーストの共通の置き場所。左端と幅は秒×拡大率で決まる */
function ghostStyle(t: number, dur: number, zoom: number): React.CSSProperties {
  // **最低でも12px は見せる。** 短いクリップだと線になって、
  // どこに入るのか分からなくなる
  return { left: t * zoom, width: bandWidth(dur, zoom, 12) }
}

/** 波形を出す中身（音のゴースト2種で共通） */
function WaveInside({
  meta,
  dur,
  width,
  height,
  fallback
}: {
  meta: any
  dur: number
  width: number
  height: number
  fallback: JSX.Element
}): JSX.Element {
  if (!meta?.wave) return fallback
  return (
    <WaveformCanvas
      min={meta.wave.min}
      max={meta.wave.max}
      srcStart={0}
      srcEnd={dur}
      audioDuration={meta.wave.dur || meta.dur || dur}
      width={width}
      height={height}
    />
  )
}

/** 画像を置く先 */
export function ImageGhost({ ghost, zoom }: { ghost: any; zoom: number }): JSX.Element {
  return (
    <div className="clip img-clip se-ghost" style={ghostStyle(ghost.t, ghost.dur, zoom)}>
      <span className="clip-text">🖼 {ghost.name}</span>
    </div>
  )
}

/**
 * 動画を置く先（映像の段）。
 *
 * **落とし方を言葉で出す。** 上書き＝青／割り込み＝緑と色でも分けているが、
 * 色だけだと「どちらが上書きか」を覚えていないと分からない。
 */
export function VideoGhost({ ghost, zoom }: { ghost: any; zoom: number }): JSX.Element {
  const what = ghost.moving
    ? ghost.mode === 'copy'
      ? '（複製）'
      : ghost.mode === 'insert'
        ? '（割り込み）'
        : '（移動）'
    : ghost.track !== 'V1'
      ? '（重ねる）'
      : ghost.insert
        ? '（挿入）'
        : '（上書き）'
  return (
    <div
      className={`clip video-clip se-ghost ${ghost.track === 'V1' && ghost.insert ? 'ghost-insert' : ''}`}
      style={ghostStyle(ghost.t, ghost.dur, zoom)}
    >
      <span className="clip-text">
        🎬 {ghost.name}
        {what}
      </span>
    </div>
  )
}

/**
 * 動画を置く先の、対になる音の段。
 *
 * 映像と同じ位置・同じ長さで出して**「映像と音はセット」**だと示す。
 * 片方だけ出すと、音がどこへ入るのか分からない。
 */
export function VideoAudioGhost({
  ghost,
  zoom,
  meta,
  trackH
}: {
  ghost: any
  zoom: number
  meta: any
  trackH: number
}): JSX.Element {
  const width = bandWidth(ghost.dur, zoom, 12)
  return (
    <div
      className={`clip audio-clip se-ghost ${ghost.track === 'V1' && ghost.insert ? 'ghost-insert' : ''}`}
      style={ghostStyle(ghost.t, ghost.dur, zoom)}
    >
      {/* 取り込み時に用意した波形をそのまま出す（掴んでいる間から中身が見える） */}
      <WaveInside
        meta={meta}
        dur={ghost.dur}
        width={width}
        height={trackH - 6}
        fallback={<span className="clip-text audio-loading">🔊 音声（解析中…）</span>}
      />
    </div>
  )
}

/** 効果音・BGM を置く先 */
export function SeGhost({
  ghost,
  zoom,
  meta,
  trackH
}: {
  ghost: any
  zoom: number
  meta: any
  trackH: number
}): JSX.Element {
  const width = bandWidth(ghost.dur, zoom, 12)
  return (
    <div className="clip se-clip se-ghost" style={ghostStyle(ghost.t, ghost.dur, zoom)}>
      <WaveInside
        meta={meta}
        dur={ghost.dur}
        width={width}
        height={trackH - 6}
        fallback={<span className="clip-text">🔊 {ghost.name}</span>}
      />
    </div>
  )
}

/**
 * トランジションを置く先の帯。
 *
 * 前・間・後ろのどれに吸い付いたかを、位置と言葉の両方で出す。
 */
export function TransDropGhost({
  drop,
  segLayout,
  zoom
}: {
  drop: { segId: number; kind: string; left: number; width: number; label: string }
  segLayout: SegLayout[]
  zoom: number
}): JSX.Element | null {
  const L = segLayout.find((l) => l.seg.id === drop.segId)
  if (!L) return null
  return (
    <div
      className={`ttrans ttrans-ghost ttrans-ghost-${drop.kind}`}
      style={{ left: L.tStart * zoom + drop.left, width: drop.width }}
    >
      <span className="ttrans-lb">{drop.label}</span>
    </div>
  )
}
/* eslint-enable @typescript-eslint/no-explicit-any */
