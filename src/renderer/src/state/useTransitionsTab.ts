// 右パネル「トランジション」タブの配線。**画面（TransitionsTab）が要る形にして渡す。**
//
// なぜ画面から出したか・`useAppWiring` が太らない理由は `state/useIconTab` の冒頭に
// 1つだけ書いてある（同じ話を5回書かない）。
//
// ## 動画とテロップを、同じ形にしてから渡す
//
// 「頭・間・尻のどこにでも置ける」のは動画クリップもテロップも同じなのに、
// 持ち物の形が違う（動画は切片の `xfade` / `transIn` / `transOut`、
// テロップは `style.anim` の `in` / `out`）。**画面側で場合分けさせない**ために、
// ここで1つの形（`ico` / `place` / `type` / `dur` / …）へ揃える。
//
// ※ 揃えるのをやめると、画面側に「動画のときは…テロップのときは…」が生えて、
//   片方だけ直す事故が起きる（このリポジトリで一番多い型）。
import { useLibraryCtx } from './libraryContext'
import { EMPTY_DRAG_IMG, setDragChip } from '../lib/dragChip'
import { TRANS_TYPES, type TransType } from '../lib/transitions'
import type { AnimIn } from '../lib/telopStyle'
import { BUILTIN_MOTIONS } from '../../../shared/builtinMotions'
import { useRightPanel } from './rightPanelContext'
import { useDoc } from './contentContext'
import { useSel } from './selectionContext'
import { useProjectStateCtx } from './projectStateContext'

export function useTransitionsTab() {
  const {
    rightBodyRef, TELOP_MOTIONS, draggingTransRef, setTransDrop, draggingTelopAnimRef,
    setTelopDrop, toggleTelopEmphasis, draggingEmphasisRef, applyMotionPreset,
    setSelectedTransType, updateSelectedTransDur, deleteSelectedTrans, setTelopTransType,
    updateTelopTransDur, deleteSelectedTelopTrans
  } = useRightPanel()
  // 置き場（★・フォルダ・畳み）は**配線を通さず、直に見に行く**
  //（2026-08-04。往復していた34個を state/libraryContext へ寄せた）
  const {
    accSec, myMotions, motionPresets, deleteMyMotion
  } = useLibraryCtx()
  const { cues, segments } = useDoc()
  const { selectedTrans, setSelectedTrans, selectedTelopTrans, setSelectedTelopTrans } = useSel()
  const { transDur, setTransDur } = useProjectStateCtx()

  // ---- 選んでいる帯を、動画側とテロップ側で同じ形にする ----
  const seg = selectedTrans && segments.find((s) => s.id === selectedTrans.segId)
  const vt = !seg
    ? null
    : selectedTrans!.kind === 'xfade'
      ? seg.xfade
      : selectedTrans!.kind === 'in'
        ? seg.transIn
        : seg.transOut
  const videoBand =
    seg && vt && selectedTrans
      ? {
          ico: '🎯',
          place:
            selectedTrans.kind === 'xfade'
              ? '間（クリップ同士）'
              : selectedTrans.kind === 'in'
                ? '頭（クリップ開始）'
                : '尻（クリップ終わり）',
          type: vt.type,
          dur: vt.dur,
          kinds: TRANS_TYPES,
          onType: (t: string): void => setSelectedTransType(t as TransType),
          onDur: updateSelectedTransDur,
          onDelete: deleteSelectedTrans,
          onDeselect: (): void => setSelectedTrans(null)
        }
      : null

  const cue = selectedTelopTrans && cues.find((c) => c.id === selectedTelopTrans.cueId)
  const anim = cue ? cue.style.anim : null
  const isIn = selectedTelopTrans?.kind === 'in'
  const telopBand =
    cue && anim && selectedTelopTrans
      ? {
          ico: '💬',
          place: `テロップ ${isIn ? '頭（出現）' : '尻（消失）'}`,
          type: isIn ? anim.in : anim.out,
          dur: isIn ? anim.inDur : anim.outDur,
          kinds: TELOP_MOTIONS,
          onType: (t: string): void => setTelopTransType(t as AnimIn),
          onDur: updateTelopTransDur,
          onDelete: deleteSelectedTelopTrans,
          onDeselect: (): void => setSelectedTelopTrans(null)
        }
      : null

  return {
    bodyRef: rightBodyRef,
    accSec,
    selectedVideoBand: videoBand,
    selectedTelopBand: telopBand,
    newDur: transDur,
    onNewDur: setTransDur,
    videoKinds: TRANS_TYPES,
    telopKinds: TELOP_MOTIONS,
    onDragStartVideo: (x: { type: string; ico: string; label: string }, e: React.DragEvent): void => {
      draggingTransRef.current = { type: x.type as TransType }
      setDragChip(e, x.ico, x.label)
    },
    onDragEndVideo: (): void => {
      draggingTransRef.current = null
      setTransDrop(null)
    },
    onDragStartTelop: (m: { type: string; ico: string; label: string }, e: React.DragEvent): void => {
      draggingTelopAnimRef.current = { type: m.type as AnimIn }
      setDragChip(e, m.ico, m.label)
    },
    onDragEndTelop: (): void => {
      draggingTelopAnimRef.current = null
      setTelopDrop(null)
    },
    onToggleEmphasis: toggleTelopEmphasis,
    onDragStartEmphasis: (kind: 'shake' | 'pulse', e: React.DragEvent): void => {
      draggingEmphasisRef.current = kind
      e.dataTransfer.effectAllowed = 'copy'
      // 見本帳・アイコンと同じで、カーソルには何も握らせない
      //（置き先はタイムラインの帯とプレビューの文字で見せている）
      if (EMPTY_DRAG_IMG) e.dataTransfer.setDragImage(EMPTY_DRAG_IMG, 0, 0)
    },
    onDragEndEmphasis: (): void => {
      draggingEmphasisRef.current = null
    },
    builtinMotions: BUILTIN_MOTIONS,
    myMotions,
    motionPresets,
    onApplyMotionPreset: applyMotionPreset,
    onDeleteMyMotion: deleteMyMotion
  }
}
