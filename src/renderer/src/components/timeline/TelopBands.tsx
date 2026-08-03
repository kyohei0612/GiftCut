// テロップの帯（V1 以外の映像段に並ぶ物）。
//
// ## 帯1本に3つ乗っている
//
//   本体      … 文字・ラベル色・掴んで移動・左右端で長さ変更
//   KeyMarks  … 打った印（キーフレーム）
//   TelopAnimBand … 出入りの動き（頭／尻）の範囲
//
// ## 出入りの動きは「落として付ける」
//
// 右のパネルから動きを掴んで帯の上へ落とすと、落とした場所で
// 頭・尻・間（次のテロップとの間）が決まる。落とす前にどこへ付くかを
// 見せるのが `TelopDropGhost`。**落としてから「そこじゃない」に気づく**のを
// 無くすためで、考え方は timeline/DropGhosts.tsx と同じ。
// ただし置き場所の判定にテロップの並びが要るので、こちらに置いてある。
//
// ## 帯が細いときは文字を出さない
//
// 帯は最低 12px で描かれるので、引いた状態で文字を出すと
// 「ろ」「ク」のような読めない断片が並ぶだけになる。

import { bandWidth } from '../../lib/bandGeom'
import type { JSX } from 'react'
import { ClipBand } from './ClipBand'
import { KeyMarks } from './KeyMarks'
import { TelopAnimBand } from './TelopAnimBand'
import { motionKeyTimes } from '../../lib/telopStyle'
import type { AnimIn, TelopAnim } from '../../lib/telopStyle'
import type { Cue } from '../../lib/srt'
import { clamp } from '../../../../shared/timeline'
import { useDoc } from '../../state/contentContext'
import { useTimelineOps } from '../../state/timelineOpsContext'
import { useSel } from '../../state/selectionContext'
import { usePlaybackCtx } from '../../state/playbackContext'
import { usePreviewCtx } from '../../state/previewContext'

/** 落とした場所から決まった「付く先」。どのテロップかはまだ入っていない */
export interface TelopDropSpot {
  left: number
  width: number
  label: string
  kind: 'in' | 'out' | 'between'
}
/** 出入りの動きを落とす先。落とす前に半透明で見せる分の中身 */
export interface TelopDrop extends TelopDropSpot {
  cueId: number
}

export function TelopBands({
  trackId,
  zoom,
  inView,
  cueTrack,
  onPointerDown,
  onContextMenu,
  onTrimStart,
  draggingTelopAnimRef,
  resolveTelopTransDrop,
  applyTelopTransDrop,
  setTelopDrop,
  stopPlayback,
  seekTo,
  motionLabel,
  selectTelopTrans,
  startTransResize,
  patchCueAnim
}: {
  /** この段（V2 以降）に載っているテロップだけ描く */
  trackId: string
  zoom: number
  /** 画面に出ているか。出ていない帯は作らない（1000個で 68→33ms 効いた） */
  inView: (tStart: number, tEnd: number) => boolean
  cueTrack: (c: Cue) => string
  onPointerDown: (cue: Cue, e: React.PointerEvent) => void
  onContextMenu: (cue: Cue, e: React.MouseEvent) => void
  onTrimStart: (cue: Cue, edge: 'l' | 'r', e: React.PointerEvent) => void
  /** いま動きを掴んで運んでいるか（掴んでいない間は帯が落とし先にならない） */
  draggingTelopAnimRef: React.MutableRefObject<{ type: AnimIn } | null>
  resolveTelopTransDrop: (cue: Cue, clientX: number, rect: DOMRect) => TelopDropSpot
  applyTelopTransDrop: (cue: Cue, clientX: number, rect: DOMRect) => void
  setTelopDrop: (d: TelopDrop | null) => void
  stopPlayback: () => void
  seekTo: (t: number) => void
  motionLabel: (t: AnimIn) => string
  selectTelopTrans: (cueId: number, kind: 'in' | 'out') => void
  startTransResize: (
    e: React.PointerEvent,
    startDur: number,
    sign: number,
    apply: (d: number) => void,
    maxDur?: number
  ) => void
  patchCueAnim: (cueId: number, patch: Partial<TelopAnim>) => void
}): JSX.Element {
  const { cues } = useDoc()
  const { isSelected, setSelectedIds, setEditingId, selectedTelopTrans } = useSel()
  // 見本帳・アイコンを帯へ落とすための物。**受け取らず自分で見に行く**
  //（プレビューの文字側と同じ物を使う＝落とし方が2通りにならない）
  const { draggingTemplateRef, draggingIconRef, applyTemplateToCue, applyIconToCue } =
    usePreviewCtx()
  // ◆を右クリックで消す（心臓は state/useMotion の removeKeyAtTime）
  const { removeKeyAtTime } = useTimelineOps()
  const { currentTimeRef } = usePlaybackCtx()
  return (
    <>
      {cues
        .filter((cue) => cueTrack(cue) === trackId && inView(cue.start, cue.end))
        .map((cue) => (
        <ClipBand
          key={cue.id}
          className="telop-clip"
          label={cue.label}
          left={cue.start * zoom}
          width={bandWidth(cue.end - cue.start, zoom, 12)}
          selected={isSelected(cue.id)}
          group={cue.group}
          title={cue.text}
          onPointerDown={(e) => onPointerDown(cue, e)}
          onContextMenu={(e) => onContextMenu(cue, e)}
          onTrimLeft={(e) => onTrimStart(cue, 'l', e)}
          onTrimRight={(e) => onTrimStart(cue, 'r', e)}
          onDragOver={(e) => {
            // **見本帳とアイコンも受ける。** プレビューの文字の上には元から落とせたのに、
            // タイムラインの帯には落とせなかった。同じ物を同じように扱えないと、
            // 「どこへ落とせるのか」を毎回思い出す羽目になる（本人の方針＝
            // クリックは据え置きで、D&D でも持ってこられるように）
            if (draggingTemplateRef.current || draggingIconRef.current) {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'copy'
              return
            }
            if (!draggingTelopAnimRef.current) return
            e.preventDefault()
            e.dataTransfer.dropEffect = 'copy'
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
            const r = resolveTelopTransDrop(cue, e.clientX, rect)
            setTelopDrop({
              cueId: cue.id,
              left: r.left,
              width: r.width,
              label: r.label,
              kind: r.kind
            })
          }}
          onDragLeave={() => {
            // クリップ外へ出たらゴースト帯を消す（残り防止）
            if (draggingTelopAnimRef.current) setTelopDrop(null)
          }}
          onDrop={(e) => {
            const tpl = draggingTemplateRef.current
            const iconColor = draggingIconRef.current
            if (tpl || iconColor) {
              e.preventDefault()
              e.stopPropagation()
              if (tpl) applyTemplateToCue(cue.id, tpl)
              else if (iconColor) applyIconToCue(cue.id, iconColor)
              return
            }
            if (!draggingTelopAnimRef.current) return
            e.preventDefault()
            e.stopPropagation()
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
            applyTelopTransDrop(cue, e.clientX, rect)
            setTelopDrop(null)
          }}
          onDoubleClick={() => {
            stopPlayback() // 再生中はシークが上書きされ編集が消えるため必ず停止
            setSelectedIds([cue.id])
            seekTo(clamp(currentTimeRef.current, cue.start, cue.end - 0.01))
            setEditingId(cue.id)
          }}
        >
          {/* 帯が細いときは文字を出さない（上の説明のとおり）。
              何があるかは色と位置で分かる（中身は重ねた説明で見る）。 */}
          {(cue.end - cue.start) * zoom >= 40 && (
            <span className="clip-text">{cue.text}</span>
          )}
          {/* 打った印（キーフレーム）。components/timeline/KeyMarks.tsx */}
          <KeyMarks
            times={motionKeyTimes(cue.motion)}
            zoom={zoom}
            clipStart={cue.start}
            onRemove={(t) => removeKeyAtTime({ kind: 'telop', id: cue.id }, t)}
          />
          {/* 出入りの動きの帯（components/timeline/TelopAnimBand.tsx）。
              動画のトランジションと同じ流儀: 範囲表示＋クリック選択。 */}
          {cue.style.anim && cue.style.anim.in !== 'none' && (
            <TelopAnimBand
              side="in"
              label={motionLabel(cue.style.anim.in)}
              dur={cue.style.anim.inDur}
              clipWidth={(cue.end - cue.start) * zoom}
              zoom={zoom}
              selected={
                selectedTelopTrans?.cueId === cue.id &&
                selectedTelopTrans.kind === 'in'
              }
              onSelect={() => selectTelopTrans(cue.id, 'in')}
              onResizeStart={(e, dir) =>
                startTransResize(
                  e,
                  cue.style.anim!.inDur,
                  dir,
                  (nd) => patchCueAnim(cue.id, { inDur: nd }),
                  cue.end - cue.start
                )
              }
            />
          )}
          {cue.style.anim && cue.style.anim.out !== 'none' && (
            <TelopAnimBand
              side="out"
              label={motionLabel(cue.style.anim.out)}
              dur={cue.style.anim.outDur}
              clipWidth={(cue.end - cue.start) * zoom}
              zoom={zoom}
              selected={
                selectedTelopTrans?.cueId === cue.id &&
                selectedTelopTrans.kind === 'out'
              }
              onSelect={() => selectTelopTrans(cue.id, 'out')}
              onResizeStart={(e, dir) =>
                startTransResize(
                  e,
                  cue.style.anim!.outDur,
                  dir,
                  (nd) => patchCueAnim(cue.id, { outDur: nd }),
                  cue.end - cue.start
                )
              }
            />
          )}
        </ClipBand>
      ))}
    </>
  )
}

/**
 * 出入りの動きを落とす先を、落とす前に見せる帯。
 *
 * **段（トラック行）に描く。** 帯の中に描くと「間」（次のテロップとの間）が
 * 表せない。間は2つのテロップに跨るので、どちらか一方の帯の中には収まらない。
 */
export function TelopDropGhost({
  trackId,
  drop,
  cueTrack
}: {
  trackId: string
  drop: TelopDrop
  cueTrack: (c: Cue) => string
}): JSX.Element | null {
  const { cues } = useDoc()
  const dc = cues.find((c) => c.id === drop.cueId)
  if (!dc || cueTrack(dc) !== trackId) return null
  return (
    <div
      className={`ttrans ttrans-ghost ttrans-ghost-telop ${drop.kind === 'between' ? 'ttrans-ghost-between' : ''}`}
      style={{ left: drop.left, width: drop.width }}
    >
      <span className="ttrans-lb">{drop.label}</span>
    </div>
  )
}
