// 本編（V1／A1）の帯。カットして並べた「切片」を、映像は V1、音は A1 に描く。
//
//   MainVideoBands … V1。空き・映像なし・サムネ・イン点・速度
//   MainAudioBands … A1。同じ切片の波形
//
// ## 重ねたクリップとは別物
//
// V2以降の帯（timeline/OverlayClipBands.tsx）は1本ずつ好きな場所に置ける。
// 本編の切片は**隙間なく並ぶ**のが決まりで、動かすと後ろが詰まる／上書きされる。
// 見た目は似ているが、位置は切片の並びから決まる（`segLayout`）。
//
// ## 「空き」と「映像なし」は言葉を分ける
//
// 空き（gap）… クリップを動かしてできた隙間。**帯を描かない**。
//   動かした跡が残って見えるため。ただし当たり判定は残す。
//   消してしまうとクリックで選べず、Delete で詰める導線に到達できない。
// 映像なし（videoBlank）… 映像だけ消した区間。点線の帯とバッジで残す。
//   これも消すと「戻す」に到達できなくなるので、消音と同じ扱いにする。
//
// ## 波形は「その切片の元動画」の物を使う
//
// 素材を混ぜて並べられるので、先頭の動画の波形を使い回すと**別動画の波形**が出る。
// 自分の元動画の波形が未取得なら「解析中」と書く（何も出ないと壊れて見える）。

import type { JSX } from 'react'
import { ClipBand, type OpenClipMenu } from './ClipBand'
import { KeyMarks } from './KeyMarks'
import WaveformCanvas from '../WaveformCanvas'
import { formatTime } from '../../lib/srt'
import { segSpeed } from '../../../../shared/timeline'
import { clipMotionKeyTimes } from '../../../../shared/clipMotion'
import type { SegLayout, Source, VSeg } from '../../lib/projectTypes'
import { useSel } from '../../state/selectionContext'
import { useMediaCtx } from '../../state/mediaContext'
import { useTimelineOps } from '../../state/timelineOpsContext'

/** V1。カットして並べた映像の切片 */
export function MainVideoBands({
  segLayout,
  zoom,
  inView,
  srcOfSeg,
  overwriteIds,
  onPointerDown,
  onTrimStart,
  openClipMenu
}: {
  segLayout: SegLayout[]
  zoom: number
  /** 画面に出ているか。出ていない帯は作らない */
  inView: (tStart: number, tEnd: number) => boolean
  srcOfSeg: (seg: VSeg | undefined) => Source | undefined
  /** いま掴んでいる物に上書きされる切片。落とす前に赤く出す */
  overwriteIds: number[]
  onPointerDown: (L: SegLayout, e: React.PointerEvent, kind: 'video' | 'audio') => void
  onTrimStart: (L: SegLayout, edge: 'l' | 'r', e: React.PointerEvent) => void
  openClipMenu: OpenClipMenu
}): JSX.Element {
  const { isVideoSel } = useSel()
  const { videoName, mediaItems, thumbnailSrc } = useMediaCtx()
  // ◆を右クリックで消す（心臓は state/useMotion の removeKeyAtTime）
  const { removeKeyAtTime } = useTimelineOps()
  return (
    <>
      {segLayout.filter((L) => inView(L.tStart, L.tEnd)).map((L) =>
        // 空きは帯を描かないが、当たり判定は残す（上の説明のとおり）
        L.seg.gap ? (
          <ClipBand
            key={L.seg.id}
            className="gap-clip"
            left={L.tStart * zoom}
            width={Math.max(L.len * zoom - 1, 6)}
            selected={isVideoSel(L.seg.id)}
            title="空き（クリックして Delete で詰める）"
            onPointerDown={(e) => onPointerDown(L, e, 'video')}
            onContextMenu={(e) => openClipMenu(e, 'seg', { id: L.seg.id, name: '空き' })}
          />
        ) : (
        <ClipBand
          key={L.seg.id}
          className={`video-clip ${L.seg.videoBlank ? 'clip-blank' : ''} ${overwriteIds.includes(L.seg.id) ? 'clip-overwrite' : ''}`}
          label={L.seg.label}
          left={L.tStart * zoom}
          width={Math.max(L.len * zoom - 1, 10)}
          selected={isVideoSel(L.seg.id)}
          title={
            L.seg.gap
              ? '空白（映像なし・無音）'
              : (srcOfSeg(L.seg)?.name ?? videoName ?? '')
          }
          onPointerDown={(e) => onPointerDown(L, e, 'video')}
          onTrimLeft={(e) => onTrimStart(L, 'l', e)}
          onTrimRight={(e) => onTrimStart(L, 'r', e)}
          onContextMenu={(e) =>
            openClipMenu(e, 'seg', {
              id: L.seg.id,
              name: srcOfSeg(L.seg)?.name ?? '動画クリップ'
            })
          }
        >
          {/* サムネはその切片の元動画のものを出す（先頭固定にすると別動画の絵が出る） */}
          {(() => {
            const sp = srcOfSeg(L.seg)?.path
            const th =
              (sp && mediaItems.find((m) => m.path === sp)?.thumb) ||
              (L.index === 0 ? thumbnailSrc : undefined)
            return th && !L.seg.videoBlank ? (
              <img className="clip-thumb" src={th} alt="" />
            ) : null
          })()}
          <span className="clip-text">
            {/* 空白（移動や位置指定配置でできた隙間）と、
                「映像だけ消した」区間は別物なので言葉を分ける */}
            {L.seg.gap
              ? '⬛ 空白'
              : L.seg.videoBlank
                ? '🚫 映像なし'
                : `🎬 ${srcOfSeg(L.seg)?.name ?? videoName ?? '動画'}`}
            {/* 同じ素材を切った断片は名前が全部同じで見分けがつかない。
                元動画のどこを使っているか（イン点）を出して区別する。 */}
            {segLayout.length > 1 && !L.seg.gap && !L.seg.videoBlank && (
              <span className="clip-in">{formatTime(L.seg.srcStart)}〜</span>
            )}
            {segSpeed(L.seg) !== 1 && (
              <span className="clip-speed">{segSpeed(L.seg)}x</span>
            )}
          </span>
          <KeyMarks
            times={clipMotionKeyTimes(L.seg.motion)}
            zoom={zoom}
            clipStart={L.tStart}
            onRemove={(t) => removeKeyAtTime({ kind: 'video', id: L.seg.id }, t)}
          />
        </ClipBand>
        )
      )}
    </>
  )
}

/** A1。V1 と同じ切片を、波形で描く */
export function MainAudioBands({
  segLayout,
  zoom,
  inView,
  srcOfSeg,
  trackH,
  onPointerDown
}: {
  segLayout: SegLayout[]
  zoom: number
  inView: (tStart: number, tEnd: number) => boolean
  srcOfSeg: (seg: VSeg | undefined) => Source | undefined
  /** 音声段の高さ。波形はこの高さいっぱいに描く */
  trackH: number
  onPointerDown: (L: SegLayout, e: React.PointerEvent, kind: 'video' | 'audio') => void
}): JSX.Element {
  const { isAudioSel } = useSel()
  const { sources, waveform, videoDuration, videoName } = useMediaCtx()
  return (
    <>
      {segLayout.filter((L) => inView(L.tStart, L.tEnd)).map((L) => {
        if (L.seg.gap) return null // 空白（ギャップ）切片は音声レーンにも描かない
        // マルチソース: 各切片は自分の元動画の波形/尺で描画
        const ssrc = srcOfSeg(L.seg)
        // 自分のソースの波形を使う。未取得なら「解析中」表示。
        // ただし主ソース（=グローバルの waveform と同じ動画）は
        // そちらにフォールバックしてよい（別動画の波形は絶対に使わない）。
        const isPrimary = !!ssrc && !!sources[0] && ssrc.id === sources[0].id
        const wf = ssrc?.waveform ?? (isPrimary || !ssrc ? waveform : null)
        const sdur = ssrc?.duration || videoDuration
        return (
          <ClipBand
            key={L.seg.id}
            className={`audio-clip ${L.seg.muted ? 'clip-muted' : ''}`}
            label={L.seg.label}
            left={L.tStart * zoom}
            width={Math.max(L.len * zoom - 1, 10)}
            selected={isAudioSel(L.seg.id)}
            title={ssrc?.name ?? videoName ?? ''}
            onPointerDown={(e) => onPointerDown(L, e, 'audio')}
          >
            {wf ? (
              <WaveformCanvas
                min={wf.min}
                max={wf.max}
                srcStart={L.seg.srcStart}
                srcEnd={L.seg.srcEnd}
                audioDuration={wf.dur || sdur}
                width={Math.max(L.len * zoom - 1, 10)}
                height={trackH - 6}
              />
            ) : (
              <span className="clip-text audio-loading">波形解析中…</span>
            )}
            {L.seg.muted && <span className="clip-mute-badge">🔇 消音</span>}
          </ClipBand>
        )
      })}
    </>
  )
}
