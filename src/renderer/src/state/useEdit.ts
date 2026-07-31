// 「いま選んでいる物を書き換える」操作。
//
// ## なぜ画面から出すか
//
// **区画はどれもこれを呼ぶ。** 左パネルは設定を変え、プレビューは枠を動かし、
// タイムラインは段をまたいで動かす。App.tsx に置いたままだと、区画を
// 切り出すたびにこの一式を渡すことになる（左パネルの試算では51個だった）。
//
// ## 共通の決まり
//
// ・**鍵の掛かった段は書き換えない。** どの操作もまず段の鍵を見る。
//   1か所でも見忘れると、そこだけ鍵が効かない（気づくのは壊してから）。
// ・**選んでいる物だけを変える。** 種類が違う物には入らない
//   （テロップを全部選んでも、動画クリップには適用されない）。

import { useDoc } from './contentContext'
import { useSel } from './selectionContext'
import { useTracksCtx } from './tracksContext'
import { useViewCtx } from './viewContext'
import { useToastCtx } from './toastContext'
import type { Cue } from '../lib/srt'
import type { ImgClip, SEClip, VClip, VSeg } from '../lib/projectTypes'
import type { ClipMotion } from '../../../shared/clipMotion'
import { clamp } from '../../../shared/timeline'
import { hasKeys, putKey, valueAt } from '../../../shared/keyframes'
import { keyDelta, neutralOf } from '../../../shared/nudgeShare'
import { hasMotion, type Motion } from '../lib/telopStyle'
import { hasClipMotion } from '../../../shared/clipMotion'
import { DEFAULT_ADJUST, DEFAULT_CROP, DEFAULT_ZOOM, isNeutralAdjust, isNeutralCrop, isNeutralZoom } from '../lib/clipLook'
import type { MotionKeyName } from '../../../shared/telopMotion'
import type { Keys } from '../../../shared/keyframes'

/** テロップの配置トラック（未指定=V2） */
const cueTrack = (c: Cue): string => c.track ?? 'V2'

export function useEdit() {
  const doc = useDoc()
  const sel = useSel()
  const trk = useTracksCtx()
  const { zoom } = useViewCtx()
  const { showToast } = useToastCtx()

  const { cues, setCues, segments, setSegments, seClips, setSeClips, imgClips, setImgClips, vClips, setVClips } = doc
  const {
    selectedIds,
    selectedVideoIds,
    selectedAudioIds,
    selectedSeIds,
    selectedImgIds,
    selectedVClipIds,
    isVideoSel,
    isAudioSel,
    isSelected
  } = sel
  const { trackStates } = trk

  // いま代表で編集している1つ（複数選んでいるときは先頭）
  const primaryId = selectedIds[0] ?? null
  const selected = cues.find((c) => c.id === primaryId) ?? null
  /** そのテロップの段に鍵が掛かっているか */
  const telopLocked = (cue: Cue): boolean => !!trackStates[cueTrack(cue)]?.locked
  /** 本編（V1 / A1）に鍵が掛かっているか */
  const mainLocked = (): boolean => trk.isLocked('V1') || trk.isLocked('A1')

  // 選択中の画像クリップを部分更新（複数選択にまとめて適用）
  function updateSelectedImg(patch: Partial<ImgClip>): void {
    if (!selectedImgIds.length) return
    // ロック中は変更しない（ドラッグ・削除は守っているので揃える）
    if (imgClips.some((c) => selectedImgIds.includes(c.id) && trackStates[c.track]?.locked)) {
      showToast('このトラックはロックされています。')
      return
    }
    setImgClips((prev) =>
      prev.map((c) => (selectedImgIds.includes(c.id) ? { ...c, ...patch } : c))
    )
  }

  // 選択中SEクリップにまとめてプロパティ適用（音量・フェード）
  function updateSelectedSE(patch: Partial<SEClip>): void {
    if (!selectedSeIds.length) return
    if (seClips.some((c) => selectedSeIds.includes(c.id) && trackStates[c.track]?.locked)) {
      showToast('このトラックはロックされています。')
      return
    }
    setSeClips((prev) => prev.map((c) => (selectedSeIds.includes(c.id) ? { ...c, ...patch } : c)))
  }

  function updateSelectedVClip(patch: Partial<VClip>): void {
    if (!selectedVClipIds.length) return
    if (vClips.some((c) => selectedVClipIds.includes(c.id) && trackStates[c.track]?.locked)) {
      showToast('このトラックはロックされています。')
      return
    }
    setVClips((prev) => prev.map((c) => (selectedVClipIds.includes(c.id) ? { ...c, ...patch } : c)))
  }

  function patchCuePos(cueId: number, patch: { x?: number; y?: number }): void {
    setCues((prev) =>
      prev.map((c) => (c.id === cueId ? { ...c, pos: { ...c.pos, ...patch } } : c))
    )
  }

  function patchCueScale(cueId: number, scale: number): void {
    setCues((prev) =>
      prev.map((c) => (c.id === cueId ? { ...c, scale: Math.max(0.05, scale) } : c))
    )
  }

  function patchMotion(
    cueId: number,
    key: MotionKeyName,
    fn: (keys: Keys | undefined) => Keys | undefined
  ): void {
    // 履歴は cues の変化を見て自動で積まれる（ここで積むと二重になる）
    setCues((prev) =>
      prev.map((c) => {
        if (c.id !== cueId) return c
        const next: Motion = { ...c.motion, [key]: fn(c.motion?.[key]) }
        return { ...c, motion: hasMotion(next) ? next : undefined }
      })
    )
  }

  function patchClipMotion(
    kind: 'video' | 'img' | 'vclip',
    id: number,
    key: keyof ClipMotion,
    fn: (keys: Keys | undefined) => Keys | undefined
  ): void {
    // 履歴は各リストの変化を見て自動で積まれる（ここで積むと二重になる）
    const upd = <T extends { id: number; motion?: ClipMotion }>(c: T): T => {
      if (c.id !== id) return c
      const next: ClipMotion = { ...c.motion, [key]: fn(c.motion?.[key]) }
      return { ...c, motion: hasClipMotion(next) ? next : undefined }
    }
    if (kind === 'video') setSegments((prev) => prev.map(upd))
    else if (kind === 'img') setImgClips((prev) => prev.map(upd))
    else setVClips((prev) => prev.map(upd))
  }

  function clearTelopMotions(): void {
    const ids = selectedIds.length ? selectedIds : []
    if (!ids.length) return
    setCues((prev) =>
      prev.map((c) => (ids.includes(c.id) && !telopLocked(c) ? { ...c, motion: undefined } : c))
    )
  }

  // 選択中の動画切片の色調整を更新（patch=部分更新 / null=リセット）
  function setSelectedAdjust(patch: Partial<{ b: number; c: number; s: number }> | null): void {
    if (!selectedVideoIds.length) return
    // 回転/反転/速度/映像なし化は V1 のロックを見ているので揃える
    if (mainLocked()) return
    setSegments((prev) =>
      prev.map((s) => {
        if (!isVideoSel(s.id)) return s
        if (patch === null) return { ...s, adjust: undefined }
        const next = { ...(s.adjust ?? DEFAULT_ADJUST), ...patch }
        return { ...s, adjust: isNeutralAdjust(next) ? undefined : next }
      })
    )
  }

  // 選択中の動画切片のクロップを部分更新（null=リセット）。各辺 0..0.9、対辺と合わせて0.95未満。
  function setSelectedCrop(
    patch: Partial<{ l: number; t: number; r: number; b: number }> | null
  ): void {
    if (!selectedVideoIds.length) return
    setSegments((prev) =>
      prev.map((s) => {
        if (!isVideoSel(s.id)) return s
        if (patch === null) return { ...s, crop: undefined }
        const next = { ...(s.crop ?? DEFAULT_CROP), ...patch }
        next.l = clamp(next.l, 0, 0.9)
        next.t = clamp(next.t, 0, 0.9)
        next.r = clamp(next.r, 0, 0.9)
        next.b = clamp(next.b, 0, 0.9)
        // 対辺の合計が枠を潰さないよう、今動かした辺を優先して制限
        if (next.l + next.r > 0.95) {
          if (patch.r != null) next.r = 0.95 - next.l
          else next.l = 0.95 - next.r
        }
        if (next.t + next.b > 0.95) {
          if (patch.b != null) next.b = 0.95 - next.t
          else next.t = 0.95 - next.b
        }
        return { ...s, crop: isNeutralCrop(next) ? undefined : next }
      })
    )
  }

  // 指定切片のズームを設定（DEFAULTなら undefined に戻す）
  function setSegZoom(segId: number, z: { scale: number; x: number; y: number }): void {
    setSegments((prev) =>
      prev.map((s) => (s.id === segId ? { ...s, zoom: isNeutralZoom(z) ? undefined : z } : s))
    )
  }

  // 画像のズームを設定（等倍なら undefined に戻す）
  function setImgZoom(id: number, z: { scale: number; x: number; y: number }): void {
    setImgClips((prev) =>
      prev.map((c) => (c.id === id ? { ...c, zoom: isNeutralZoom(z) ? undefined : z } : c))
    )
  }

  function setVClipZoom(id: number, z: { scale: number; x: number; y: number }): void {
    setVClips((prev) =>
      prev.map((c) => (c.id === id ? { ...c, zoom: isNeutralZoom(z) ? undefined : z } : c))
    )
  }

  // 選択中の動画切片を 90°回転（時計回りに加算・スナップ）。
  function rotateSelectedSeg(): void {
    if (!selectedVideoIds.length || trackStates['V1']?.locked) return
    setSegments((prev) =>
      prev.map((s) => {
        if (!isVideoSel(s.id)) return s
        const next = (Math.round((s.rotate ?? 0) / 90) * 90 + 90) % 360
        return { ...s, rotate: next === 0 ? undefined : next }
      })
    )
  }

  // 選択中の動画切片の反転をトグル（左右 or 上下）。
  function flipSelectedSeg(dir: 'h' | 'v'): void {
    if (!selectedVideoIds.length || trackStates['V1']?.locked) return
    const key = dir === 'h' ? 'flipH' : 'flipV'
    setSegments((prev) =>
      prev.map((s) => (isVideoSel(s.id) ? { ...s, [key]: s[key] ? undefined : true } : s))
    )
  }

  // 選択中の音声切片のミュートをトグル（動画は残す。音声を独立して消せる）
  function toggleMuteSelectedSegments(): void {
    if (!selectedAudioIds.length || trackStates['A1']?.locked) return
    const allMuted = segments.filter((s) => isAudioSel(s.id)).every((s) => s.muted)
    setSegments((prev) => prev.map((s) => (isAudioSel(s.id) ? { ...s, muted: !allMuted } : s)))
  }

  function resetTelopChannel(key: MotionKeyName): void {
    const ids = selectedIds.length ? selectedIds : []
    if (!ids.length) return
    setCues((prev) =>
      prev.map((c) => {
        if (!ids.includes(c.id) || telopLocked(c) || !c.motion) return c
        const next = { ...c.motion, [key]: undefined }
        return { ...c, motion: hasMotion(next) ? next : undefined }
      })
    )
  }

  function nudgeOthers(key: MotionKeyName, deltaShown: number, atT: number): void {
    if (!deltaShown) return
    for (const c of cues) {
      if (c.id === selectedIds[0] || !selectedIds.includes(c.id)) continue
      if (telopLocked(c)) continue
      // その子自身のクリップ内時刻で打つ（尺が違うと同じ秒でも意味が変わる）
      const t = clamp(atT, 0, Math.max(0, c.end - c.start))
      const keys = c.motion?.[key]
      if (hasKeys(keys)) {
        // 単位の換算は shared/nudgeShare に置いてある（表を2か所に持たない）
        const base = valueAt(keys, t, neutralOf(key))
        const d = keyDelta(key, deltaShown, c.scale ?? 1)
        patchMotion(c.id, key, (ks) => putKey(ks, t, base + d))
        continue
      }
      // 印が無い項目は、元の値そのものを動かす（位置と大きさだけ元の値がある）
      if (key === 'tx') patchCuePos(c.id, { x: c.pos.x + deltaShown / 1920 })
      else if (key === 'ty') patchCuePos(c.id, { y: c.pos.y + deltaShown / 1080 })
      else if (key === 'sc') patchCueScale(c.id, (c.scale ?? 1) + deltaShown / 100)
    }
  }

  // 選択中の音声切片（A1）の音量/フェードを更新。
  function setSelectedAudio(patch: Partial<{ vol: number; afadeIn: number; afadeOut: number }>): void {
    if (!selectedAudioIds.length || trackStates['A1']?.locked) return
    setSegments((prev) =>
      prev.map((s) => {
        if (!isAudioSel(s.id)) return s
        const next = { ...s, ...patch }
        // 既定値なら未指定に戻す（保存を軽く）
        if (next.vol === 1) next.vol = undefined
        if (next.afadeIn === 0) next.afadeIn = undefined
        if (next.afadeOut === 0) next.afadeOut = undefined
        return next
      })
    )
  }

  // 固定ボックスを解除（内容ぴったりに戻す）
  function clearBox(): void {
    if (!selectedIds.length) return
    setCues((prev) =>
      prev.map((c) => {
        if (!isSelected(c.id)) return c
        const st = { ...c.style }
        delete st.box
        return { ...c, style: st }
      })
    )
  }
  return {
    updateSelectedImg,
    updateSelectedSE,
    updateSelectedVClip,
    patchCuePos,
    patchCueScale,
    patchMotion,
    patchClipMotion,
    clearTelopMotions,
    setSelectedAdjust,
    setSelectedCrop,
    setSegZoom,
    setImgZoom,
    setVClipZoom,
    rotateSelectedSeg,
    flipSelectedSeg,
    toggleMuteSelectedSegments,
    resetTelopChannel,
    nudgeOthers,
    setSelectedAudio,
    clearBox,
    primaryId,
    selected,
    telopLocked,
    mainLocked
  }
}
