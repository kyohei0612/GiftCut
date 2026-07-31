// コピーと貼り付け（クリップそのもの／設定だけ／動きだけ）。
//
// ## 3種類ある
//
//   クリップ   … 物ごと複製する（Ctrl+C → Ctrl+V）
//   設定だけ   … 見た目や音量を、別の物へ写す（プレミアの属性ペースト）
//   動きだけ   … 打った印を、別の物へ写す
//
// **同じキーで貼るので、最後にコピーした物で決める。** 覚えていないと、
// 動きをコピーしたつもりがクリップごと増える。
//
// ## 種類が違う物には貼らない
//
// テロップを全部選んで貼っても、動画クリップには入らない。持っていない設定を
// 無理に当てると壊れるので、**持っている物だけ**を写す。
import type { ClipMotion } from '../../../shared/clipMotion'
import type { Keys } from '../../../shared/keyframes'
import { sanitizeMotion, type Motion } from '../lib/telopStyle'
import { useDoc } from './contentContext'
import { useSel } from './selectionContext'
import { useTracksCtx } from './tracksContext'
import { useToastCtx } from './toastContext'
import { useClipboardCtx, type CopiedAttrs } from './clipboardContext'
import { usePlaybackCtx } from './playbackContext'

export interface UseCopyPasteDeps {
  cueTrack: (c: import('../lib/srt').Cue) => string
  fallbackTrack: (id: string, kind: 'video' | 'audio') => string
  /** 本編（V1/A1）に鍵が掛かっているか */
  mainLocked: () => boolean
  telopLocked: (c: import('../lib/srt').Cue) => boolean
  selected: import('../lib/srt').Cue | null
  idCounter: React.MutableRefObject<number>
  /* eslint-disable @typescript-eslint/no-explicit-any */
  /** モーションのどの行を選んでいるか（貼るときの当て先） */
  motionClipRef: any
  motionSelRef: any
  /** プレビューの枠で今つまんでいる相手 */
  reframeTargetRef: any
  srcOfSeg: any
  leftTab: string
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

export function useCopyPaste(deps: UseCopyPasteDeps) {
  const { cueTrack, fallbackTrack, mainLocked, telopLocked, selected, idCounter, motionClipRef, motionSelRef, reframeTargetRef, srcOfSeg, leftTab } = deps
  const { cues, setCues, segments, setSegments, seClips, setSeClips, imgClips, setImgClips, vClips, setVClips, seIdCounter, imgIdCounter, vClipIdCounter } = useDoc()
  const { selectedIds, setSelectedIds, selectedSeIds, setSelectedSeIds, selectedImgIds, setSelectedImgIds, selectedVClipIds, setSelectedVClipIds, selectedVideoIds, selectedAudioIds, isSelected } = useSel()
  const { trackStates } = useTracksCtx()
  const { showToast } = useToastCtx()
  const {
    clipboardRef, clipboardSeRef, clipboardImgRef, clipboardVcRef, lastCopyRef,
    copiedAttrs, setCopiedAttrs
  } = useClipboardCtx()
  const { currentTimeRef } = usePlaybackCtx()

  function attrSummary(a: CopiedAttrs): string {
    const parts: string[] = []
    if (a.telopPos || a.telopScale != null) parts.push('位置と大きさ')
    if (a.telopStyle) parts.push('見た目')
    if (a.zoom || a.rotate != null || a.flipH || a.flipV) parts.push('変形')
    if (a.adjust) parts.push('色調整')
    if (a.crop) parts.push('切り抜き')
    if (a.opacity != null) parts.push('不透明度')
    if (a.vol != null || a.afadeIn != null || a.afadeOut != null) parts.push('音量')
    if (a.label) parts.push('色')
    return parts.length ? parts.join('・') : '設定なし'
  }

  function copyAttributes(): void {
    const cue = cues.find((c) => selectedIds.includes(c.id))
    if (cue) {
      setCopiedAttrs({
        from: 'telop',
        fromName: cue.text.slice(0, 10) || 'テロップ',
        telopPos: { ...cue.pos },
        telopScale: cue.scale,
        telopStyle: cue.style,
        label: cue.label || undefined
      })
      showToast('テロップの「位置と大きさ・見た目・色」をコピーしました。')
      return
    }
    const seg = segments.find((s) => selectedVideoIds.includes(s.id) && !s.gap)
    if (seg) {
      setCopiedAttrs({
        from: 'seg',
        fromName: srcOfSeg(seg)?.name ?? '動画',
        zoom: seg.zoom,
        rotate: seg.rotate,
        flipH: seg.flipH,
        flipV: seg.flipV,
        adjust: seg.adjust,
        crop: seg.crop,
        vol: seg.vol,
        afadeIn: seg.afadeIn,
        afadeOut: seg.afadeOut,
        label: seg.label
      })
      showToast('動画クリップの設定をコピーしました。')
      return
    }
    const vc = vClips.find((c) => selectedVClipIds.includes(c.id))
    if (vc) {
      setCopiedAttrs({
        from: 'vclip',
        fromName: vc.name,
        zoom: vc.zoom,
        rotate: vc.rotate,
        flipH: vc.flipH,
        flipV: vc.flipV,
        opacity: vc.opacity,
        adjust: vc.adjust,
        crop: vc.crop,
        vol: vc.vol,
        afadeIn: vc.afadeIn,
        afadeOut: vc.afadeOut,
        label: vc.label
      })
      showToast('重ねた動画の設定をコピーしました。')
      return
    }
    const img = imgClips.find((c) => selectedImgIds.includes(c.id))
    if (img) {
      setCopiedAttrs({
        from: 'img',
        fromName: img.name,
        zoom: img.zoom,
        rotate: img.rotate,
        flipH: img.flipH,
        flipV: img.flipV,
        opacity: img.opacity,
        adjust: img.adjust,
        crop: img.crop,
        label: img.label
      })
      showToast('画像の設定をコピーしました。')
      return
    }
    const se = seClips.find((c) => selectedSeIds.includes(c.id))
    if (se) {
      setCopiedAttrs({
        from: 'se',
        fromName: se.name,
        vol: se.volume,
        afadeIn: se.fadeIn,
        afadeOut: se.fadeOut,
        label: se.label
      })
      showToast('効果音の設定をコピーしました。')
      return
    }
    showToast('コピーするクリップを選んでください。')
  }

  function pasteAttributes(): void {
    const a = copiedAttrs
    if (!a) {
      showToast('先にコピーしてください。')
      return
    }
    const hits: string[] = []
    const common = <
      T extends {
        zoom?: unknown
        rotate?: number
        flipH?: boolean
        flipV?: boolean
        adjust?: unknown
        crop?: unknown
        label?: string
      }
    >(
      c: T
    ): T => ({
      ...c,
      ...(a.zoom !== undefined ? { zoom: a.zoom } : {}),
      ...(a.rotate !== undefined ? { rotate: a.rotate } : {}),
      ...(a.flipH !== undefined ? { flipH: a.flipH } : {}),
      ...(a.flipV !== undefined ? { flipV: a.flipV } : {}),
      ...(a.adjust !== undefined ? { adjust: a.adjust } : {}),
      ...(a.crop !== undefined ? { crop: a.crop } : {}),
      ...(a.label !== undefined ? { label: a.label } : {})
    })
    // テロップ（見た目・位置はテロップ同士でしか写せない）
    if (selectedIds.length) {
      const isTelopSource = a.from === 'telop'
      setCues((prev) =>
        prev.map((c) => {
          if (!selectedIds.includes(c.id) || telopLocked(c)) return c
          let n = { ...c }
          if (isTelopSource) {
            if (a.telopPos) n = { ...n, pos: { ...a.telopPos } }
            if (a.telopScale !== undefined) n = { ...n, scale: a.telopScale }
            if (a.telopStyle) n = { ...n, style: a.telopStyle }
          }
          if (a.label !== undefined) n = { ...n, label: a.label }
          return n
        })
      )
      const n = cues.filter((c) => selectedIds.includes(c.id) && !telopLocked(c)).length
      if (n) hits.push(`テロップ ${n}件`)
    }
    if (selectedVideoIds.length) {
      const targets = segments.filter((s) => selectedVideoIds.includes(s.id) && !s.gap)
      if (targets.length && !mainLocked()) {
        setSegments((prev) =>
          prev.map((s) =>
            selectedVideoIds.includes(s.id) && !s.gap
              ? {
                  ...common(s),
                  ...(a.vol !== undefined ? { vol: a.vol } : {}),
                  ...(a.afadeIn !== undefined ? { afadeIn: a.afadeIn } : {}),
                  ...(a.afadeOut !== undefined ? { afadeOut: a.afadeOut } : {})
                }
              : s
          )
        )
        hits.push(`動画クリップ ${targets.length}件`)
      }
    }
    if (selectedVClipIds.length) {
      const targets = vClips.filter(
        (c) => selectedVClipIds.includes(c.id) && !trackStates[c.track]?.locked
      )
      if (targets.length) {
        setVClips((prev) =>
          prev.map((c) =>
            selectedVClipIds.includes(c.id) && !trackStates[c.track]?.locked
              ? {
                  ...common(c),
                  ...(a.opacity !== undefined ? { opacity: a.opacity } : {}),
                  ...(a.vol !== undefined ? { vol: a.vol } : {}),
                  ...(a.afadeIn !== undefined ? { afadeIn: a.afadeIn } : {}),
                  ...(a.afadeOut !== undefined ? { afadeOut: a.afadeOut } : {})
                }
              : c
          )
        )
        hits.push(`重ねた動画 ${targets.length}件`)
      }
    }
    if (selectedImgIds.length) {
      const targets = imgClips.filter(
        (c) => selectedImgIds.includes(c.id) && !trackStates[c.track]?.locked
      )
      if (targets.length) {
        setImgClips((prev) =>
          prev.map((c) =>
            selectedImgIds.includes(c.id) && !trackStates[c.track]?.locked
              ? { ...common(c), ...(a.opacity !== undefined ? { opacity: a.opacity } : {}) }
              : c
          )
        )
        hits.push(`画像 ${targets.length}件`)
      }
    }
    if (selectedSeIds.length) {
      const targets = seClips.filter(
        (c) => selectedSeIds.includes(c.id) && !trackStates[c.track]?.locked
      )
      if (targets.length) {
        setSeClips((prev) =>
          prev.map((c) =>
            selectedSeIds.includes(c.id) && !trackStates[c.track]?.locked
              ? {
                  ...c,
                  ...(a.vol !== undefined ? { volume: a.vol } : {}),
                  ...(a.afadeIn !== undefined ? { fadeIn: a.afadeIn } : {}),
                  ...(a.afadeOut !== undefined ? { fadeOut: a.afadeOut } : {}),
                  ...(a.label !== undefined ? { label: a.label } : {})
                }
              : c
          )
        )
        hits.push(`効果音 ${targets.length}件`)
      }
    }
    if (!hits.length) {
      showToast('貼り付けられるクリップが選ばれていません。')
      return
    }
    const skipped =
      a.from === 'telop' &&
      (selectedVideoIds.length || selectedImgIds.length || selectedVClipIds.length)
    showToast(
      `${hits.join(' / ')} に貼り付けました。` +
        (skipped ? 'テロップの見た目はテロップにだけ貼っています。' : ''),
      'success'
    )
  }

  function copyMotionRows(): boolean {
    if (leftTab !== 'motion') return false
    const keys = motionSelRef.current
    if (!keys.length) return false
    const pick = (src: Record<string, unknown> | undefined): Record<string, Keys | undefined> => {
      const out: Record<string, Keys | undefined> = {}
      for (const k of keys) {
        const v = src?.[k]
        if (v !== undefined) out[k] = structuredClone(v) as Keys
      }
      return out
    }
    const src = selected
      ? { kind: 'telop' as const, motion: selected.motion as Record<string, unknown> | undefined }
      : reframeTargetRef.current
        ? {
            kind: 'clip' as const,
            motion: reframeTargetRef.current.motion as Record<string, unknown> | undefined
          }
        : null
    if (!src) return false
    const data = pick(src.motion)
    const n = Object.keys(data).length
    if (!n) {
      // **写す物が無いのに「写した」ことにしない。**
      // 空のまま覚えると、次の貼り付けが素通りしてクリップの貼り付けに流れ、
      // テロップが増える＝黙って別の事が起きる。
      showToast('選んだ項目には動きが付いていません。')
      return true
    }
    motionClipRef.current = { kind: src.kind, data }
    lastCopyRef.current = 'motion'
    showToast(
      `動きを${n}項目コピーしました（${src.kind === 'telop' ? '別のテロップ' : '別のクリップ'}を選んで貼り付け）`
    )
    return true
  }

  function pasteMotionRows(): boolean {
    // 見ているタブではなく、**最後に写した物**で決める（上の lastCopyRef 参照）
    if (lastCopyRef.current !== 'motion') return false
    const clip = motionClipRef.current
    if (!clip || !Object.keys(clip.data).length) return false
    const merge = (m: ClipMotion | Motion | undefined): Record<string, unknown> =>
      structuredClone({ ...(m ?? {}), ...clip.data })
    if (clip.kind === 'telop') {
      // **テロップの動きは、テロップにしか入らない。**
      // 全部選んでいても、動画や画像は素通りする
      const ids = selectedIds
      if (!ids.length) {
        showToast('貼り付ける先のテロップが選ばれていません。')
        return true
      }
      setCues((prev) =>
        prev.map((c) =>
          ids.includes(c.id) && !telopLocked(c)
            ? { ...c, motion: sanitizeMotion(merge(c.motion)) }
            : c
        )
      )
      showToast(`${ids.length}個のテロップに貼り付けました。`)
      return true
    }
    const tgt = reframeTargetRef.current
    const vids = selectedVideoIds.length ? selectedVideoIds : tgt?.kind === 'video' ? [tgt.id] : []
    const imgs = selectedImgIds.length ? selectedImgIds : tgt?.kind === 'img' ? [tgt.id] : []
    const vcs = selectedVClipIds.length ? selectedVClipIds : tgt?.kind === 'vclip' ? [tgt.id] : []
    if (!vids.length && !imgs.length && !vcs.length) {
      showToast('貼り付ける先のクリップが選ばれていません。')
      return true
    }
    const put = <T extends { motion?: ClipMotion }>(c: T): T =>
      ({ ...c, motion: merge(c.motion) as ClipMotion }) as T
    if (vids.length && !trackStates['V1']?.locked)
      setSegments((prev) => prev.map((s) => (vids.includes(s.id) ? put(s) : s)))
    if (imgs.length)
      setImgClips((prev) =>
        prev.map((c) => (imgs.includes(c.id) && !trackStates[c.track]?.locked ? put(c) : c))
      )
    if (vcs.length)
      setVClips((prev) =>
        prev.map((c) => (vcs.includes(c.id) && !trackStates[c.track]?.locked ? put(c) : c))
      )
    showToast(`${vids.length + imgs.length + vcs.length}個のクリップに貼り付けました。`)
    return true
  }

  function copySelected(): void {
    if (copyMotionRows()) return
    lastCopyRef.current = 'clip'
    const cueSel = cues.filter((c) => isSelected(c.id)).map((c) => structuredClone(c))
    const seSel = seClips.filter((c) => selectedSeIds.includes(c.id)).map((c) => ({ ...c }))
    const imgSel = imgClips.filter((c) => selectedImgIds.includes(c.id)).map((c) => ({ ...c }))
    const vcSel = vClips.filter((c) => selectedVClipIds.includes(c.id)).map((c) => ({ ...c }))
    if (!cueSel.length && !seSel.length && !imgSel.length && !vcSel.length) return
    clipboardRef.current = cueSel
    clipboardSeRef.current = seSel
    clipboardImgRef.current = imgSel
    clipboardVcRef.current = vcSel
  }

  function pasteClipboard(): void {
    if (pasteMotionRows()) return
    const clip = clipboardRef.current
    const clipSe = clipboardSeRef.current
    const clipImg = clipboardImgRef.current
    const clipVc = clipboardVcRef.current
    if (!clip.length && !clipSe.length && !clipImg.length && !clipVc.length) return
    if (clip.some((c) => trackStates[cueTrack(c)]?.locked)) return // 貼り付け先トラックがロック中
    // 3種まとめての相対位置を保つため、全体の最小開始時刻を基準にする
    const starts = [
      ...clip.map((c) => c.start),
      ...clipSe.map((c) => c.tStart),
      ...clipImg.map((c) => c.tStart),
      ...clipVc.map((c) => c.tStart)
    ]
    const offset = currentTimeRef.current - Math.min(...starts) // 貼り付けは再生ヘッド位置基準
    if (clip.length) {
      const pasted = clip.map((c) => ({
        ...structuredClone(c),
        id: idCounter.current++,
        start: Math.max(0, c.start + offset),
        end: Math.max(0, c.end + offset)
      }))
      setCues((prev) => [...prev, ...pasted].sort((a, b) => a.start - b.start))
      setSelectedIds(pasted.map((p) => p.id))
    }
    if (clipSe.length) {
      const pasted = clipSe
        .filter((c) => !trackStates[c.track]?.locked)
        .map((c) => ({
          ...c,
          id: seIdCounter.current++,
          tStart: Math.max(0, c.tStart + offset),
          track: fallbackTrack(c.track, 'audio')
        }))
      setSeClips((prev) => [...prev, ...pasted])
      setSelectedSeIds(pasted.map((p) => p.id))
    }
    if (clipImg.length) {
      const pasted = clipImg
        .filter((c) => !trackStates[c.track]?.locked)
        .map((c) => ({
          ...c,
          id: imgIdCounter.current++,
          tStart: Math.max(0, c.tStart + offset),
          track: fallbackTrack(c.track, 'video')
        }))
      setImgClips((prev) => [...prev, ...pasted])
      setSelectedImgIds(pasted.map((p) => p.id))
    }
    if (clipVc.length) {
      const pasted = clipVc
        .filter((c) => !trackStates[c.track]?.locked)
        .map((c) => ({
          ...c,
          id: vClipIdCounter.current++,
          tStart: Math.max(0, c.tStart + offset),
          track: fallbackTrack(c.track, 'video')
        }))
      setVClips((prev) => [...prev, ...pasted])
      setSelectedVClipIds(pasted.map((p) => p.id))
    }
  }

  return { attrSummary, copyAttributes, pasteAttributes, copyMotionRows, pasteMotionRows, copySelected, pasteClipboard }
}
