// 本編（V1/A1）以外の段に並ぶ帯。
//
//   VideoLayerBand      … V2以降に重ねた動画
//   VideoLayerAudioBand … その動画の音（対の音声段に、同じ位置・同じ長さで）
//   ImageBand           … 画像クリップ
//
// ## 映像と音は同じ物の裏表
//
// 重ねた動画は、映像を V2 に・音を A2 に分けて描くが**中身は1つ**。
// どちらを掴んでも同じクリップが動く。別々に持てるようにすると、
// 片方だけずれて「音だけ遅れる」が作れてしまう。
//
// ## 右クリックの中身は3つとも同じ
//
// 「この1つだけを選び直す → 元の品書きを閉じる → クリップ用の品書きを開く」。
// 呼ぶ側で1つにまとめた `OpenClipMenu`（timeline/ClipBand.tsx）を渡してもらう。

import { bandWidth } from '../../lib/bandGeom'
import type { JSX } from 'react'
import { ClipBand, type OpenClipMenu } from './ClipBand'
import { KeyMarks } from './KeyMarks'
import WaveformCanvas from '../WaveformCanvas'
import { clipMotionKeyTimes } from '../../../../shared/clipMotion'
import { useDoc } from '../../state/contentContext'
import { useTimelineOps } from '../../state/timelineOpsContext'
import { useSel } from '../../state/selectionContext'
import { useTracksCtx } from '../../state/tracksContext'
import { useToastCtx } from '../../state/toastContext'

/* eslint-disable @typescript-eslint/no-explicit-any */

/** 帯の幅。**最低でも12px は見せる**（短いと線になって掴めない） */
const bandW = (dur: number, zoom: number): number => bandWidth(dur, zoom, 12)

/** V2以降に重ねた動画（映像側） */
export function VideoLayerBand({
  clips,
  zoom,
  vcLen,
  pairedAudioOf,
  mediaItems,
  onPointerDown,
  openClipMenu
}: {
  clips: any[]
  zoom: number
  vcLen: (c: any) => number
  /** その映像段と対になる音声段の名前（V2 → A2） */
  pairedAudioOf: (vTrack: string) => string
  mediaItems: any[]
  onPointerDown: (clip: any, e: React.PointerEvent, edge?: 'l' | 'r') => void
  openClipMenu: OpenClipMenu
}): JSX.Element {
  const { selectedVClipIds } = useSel()
  // ◆を右クリックで消す（心臓は state/useMotion の removeKeyAtTime）
  const { removeKeyAtTime } = useTimelineOps()
  return (
    <>
      {clips.map((clip) => (
        <ClipBand
          key={`vc-${clip.id}`}
          className="video-clip vclip"
          label={clip.label}
          left={clip.tStart * zoom}
          width={bandW(vcLen(clip), zoom)}
          selected={selectedVClipIds.includes(clip.id)}
          title={`${clip.name}（音声は ${pairedAudioOf(clip.track)} に連動）`}
          onPointerDown={(e) => onPointerDown(clip, e)}
          onTrimLeft={(e) => onPointerDown(clip, e, 'l')}
          onTrimRight={(e) => onPointerDown(clip, e, 'r')}
          onContextMenu={(e) => openClipMenu(e, 'vclip', clip)}
        >
          {(() => {
            const th = mediaItems.find((m) => m.path === clip.path)?.thumb
            return th ? <img className="clip-thumb" src={th} alt="" /> : null
          })()}
          <span className="clip-text">🎬 {clip.name}</span>
          <KeyMarks
            times={clipMotionKeyTimes(clip.motion)}
            zoom={zoom}
            clipStart={clip.tStart}
            onRemove={(t) => removeKeyAtTime({ kind: 'vclip', id: clip.id }, t)}
          />
        </ClipBand>
      ))}
    </>
  )
}

/** 重ねた動画の音（対の音声段に、映像と同じ位置・同じ長さで） */
export function VideoLayerAudioBand({
  clips,
  zoom,
  vcLen,
  mediaMeta,
  trackH,
  onPointerDown,
  openClipMenu
}: {
  clips: any[]
  zoom: number
  vcLen: (c: any) => number
  mediaMeta: any
  trackH: number
  onPointerDown: (clip: any, e: React.PointerEvent, edge?: 'l' | 'r') => void
  openClipMenu: OpenClipMenu
}): JSX.Element {
  const { selectedVClipIds } = useSel()
  return (
    <>
      {clips.map((clip) => {
        const meta = mediaMeta[clip.path]
        return (
          <ClipBand
            key={`vca-${clip.id}`}
            className={`audio-clip vclip-audio ${clip.muted ? 'clip-muted' : ''}`}
            label={clip.label}
            left={clip.tStart * zoom}
            width={bandW(vcLen(clip), zoom)}
            selected={selectedVClipIds.includes(clip.id)}
            title={`${clip.name} の音声（${clip.track} の映像とリンク）`}
            onPointerDown={(e) => onPointerDown(clip, e)}
            onTrimLeft={(e) => onPointerDown(clip, e, 'l')}
            onTrimRight={(e) => onPointerDown(clip, e, 'r')}
            onContextMenu={(e) => openClipMenu(e, 'vclip', clip)}
          >
            {meta?.wave ? (
              <WaveformCanvas
                min={meta.wave.min}
                max={meta.wave.max}
                srcStart={clip.srcStart}
                srcEnd={clip.srcEnd}
                audioDuration={meta.wave.dur || clip.srcDur || meta.dur || vcLen(clip)}
                width={bandW(vcLen(clip), zoom)}
                height={trackH - 6}
              />
            ) : (
              <span className="clip-text audio-loading">波形解析中…</span>
            )}
            {clip.muted && <span className="clip-mute-badge">🔇 消音</span>}
          </ClipBand>
        )
      })}
    </>
  )
}

/** 画像クリップ（映像段の静止画） */
export function ImageBand({
  clips,
  zoom,
  onPointerDown,
  openClipMenu
}: {
  clips: any[]
  zoom: number
  onPointerDown: (clip: any, e: React.PointerEvent, edge?: 'l' | 'r') => void
  openClipMenu: OpenClipMenu
}): JSX.Element {
  const { setImgClips } = useDoc()
  const { selectedImgIds, setSelectedImgIds } = useSel()
  // ◆を右クリックで消す（心臓は state/useMotion の removeKeyAtTime）
  const { removeKeyAtTime } = useTimelineOps()
  const { trackStates } = useTracksCtx()
  const { showToast } = useToastCtx()
  return (
    <>
      {clips.map((clip) => (
        <ClipBand
          key={`img-${clip.id}`}
          className="img-clip"
          label={clip.label}
          left={clip.tStart * zoom}
          width={bandW(clip.duration, zoom)}
          selected={selectedImgIds.includes(clip.id)}
          title={`${clip.name}（ドラッグで移動・左右端で長さ変更・Deleteで削除）`}
          onPointerDown={(e) => onPointerDown(clip, e)}
          onTrimLeft={(e) => onPointerDown(clip, e, 'l')}
          onTrimRight={(e) => onPointerDown(clip, e, 'r')}
          onContextMenu={(e) => openClipMenu(e, 'img', clip)}
          deleteTitle="画像を削除"
          onDelete={(e) => {
            e.stopPropagation()
            // ロック中は消さない（Delete キー側は守っているので揃える）
            if (trackStates[clip.track]?.locked) {
              showToast('このトラックはロックされています。')
              return
            }
            setImgClips((prev) => prev.filter((c) => c.id !== clip.id))
            setSelectedImgIds([])
          }}
        >
          <span className="clip-text">🖼 {clip.name}</span>
          <KeyMarks
            times={clipMotionKeyTimes(clip.motion)}
            zoom={zoom}
            clipStart={clip.tStart}
            onRemove={(t) => removeKeyAtTime({ kind: 'img', id: clip.id }, t)}
          />
        </ClipBand>
      ))}
    </>
  )
}
/* eslint-enable @typescript-eslint/no-explicit-any */
