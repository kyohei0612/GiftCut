// 効果音・BGM の帯（音声段に並ぶ物）。
//
// ## 短い物でも掴めるだけの幅を必ず残す
//
// 実物には0.2秒の効果音があり、拡大率しだいで数pxになる。
// 線になってしまうと掴めず、選ぶことも消すこともできない。
//
// ## 左右端を掴んでの長さ変更は付けていない
//
// 端の当たり判定は左右7pxずつある。短い効果音では**帯の全部が「長さ変更」**に
// なってしまい、本体を掴んで動かす余地が残らなかった。
// 短くしたいときは分割して消すほうが速く、そちらは既にできる。

import type { JSX } from 'react'
import { ClipBand, type OpenClipMenu } from './ClipBand'
import type { SEClip } from '../../lib/projectTypes'
import { useDoc } from '../../state/contentContext'
import { useSel } from '../../state/selectionContext'
import { useTracksCtx } from '../../state/tracksContext'
import { useToastCtx } from '../../state/toastContext'

export function SeBands({
  trackId,
  zoom,
  inView,
  onPointerDown,
  openClipMenu
}: {
  trackId: string
  zoom: number
  /** 画面に出ているか。出ていない帯は作らない */
  inView: (tStart: number, tEnd: number) => boolean
  onPointerDown: (clip: SEClip, e: React.PointerEvent) => void
  openClipMenu: OpenClipMenu
}): JSX.Element {
  const { seClips, setSeClips } = useDoc()
  const { selectedSeIds, setSelectedSeIds } = useSel()
  const { trackStates } = useTracksCtx()
  const { showToast } = useToastCtx()
  return (
    <>
      {seClips
        .filter((c) => c.track === trackId && inView(c.tStart, c.tStart + c.duration))
        .map((clip) => (
          <ClipBand
            key={clip.id}
            className="se-clip"
            label={clip.label}
            left={clip.tStart * zoom}
            // 短い効果音でも掴めるだけの幅を必ず残す（上の説明のとおり）
            width={Math.max(clip.duration * zoom - 1, 16)}
            selected={selectedSeIds.includes(clip.id)}
            title={`${clip.name}（ドラッグで移動・Deleteで削除／短くするなら分割してから）`}
            onPointerDown={(e) => onPointerDown(clip, e)}
            onContextMenu={(e) => openClipMenu(e, 'se', clip)}
            deleteTitle="削除"
            onDelete={(e) => {
              e.stopPropagation()
              // ロック中は消さない（Delete キー側は守っているので揃える）
              if (trackStates[clip.track]?.locked) {
                showToast('このトラックはロックされています。')
                return
              }
              setSeClips((prev) => prev.filter((c) => c.id !== clip.id))
              setSelectedSeIds([])
            }}
          >
            <span className="clip-text">🔊 {clip.name}</span>
          </ClipBand>
        ))}
    </>
  )
}
