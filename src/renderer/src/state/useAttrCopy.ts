// 「設定だけ」のコピーと貼り付け（プレミアの属性ペースト）。
//
// ## なぜ分けてあるか
//
// 元は `state/useCopyPaste` に3種類（クリップ／設定だけ／動きだけ）が同居していた。
// **そのうち「設定だけ」は完全な葉**で、他の2つを呼ばず、他の2つからも呼ばれず、
// `lastCopyRef`（同じキーで貼るので最後にコピーした物で決める）にも触れていない。
// 残る2つは `copySelected` → `copyMotionRows` と一方向に呼び合っていて、
// **順番の決まりが割れると壊れる**ので、そちらは1つのままにしてある
// （2026-08-03。中身は変えていない）。
//
// ## 種類が違う物には貼らない
//
// テロップの見た目をコピーして全部選んで貼っても、**テロップにだけ**貼る。
// 持っていない設定を無理に当てると壊れる。全部に貼ろうとして何も起きないより、
// 貼れる物にだけ貼って「何件に貼ったか」を伝えるほうが親切。

import { useDoc } from './contentContext'
import { useSel } from './selectionContext'
import { useTracksCtx } from './tracksContext'
import { useToastCtx } from './toastContext'
import { useClipboardCtx, type CopiedAttrs } from './clipboardContext'
import type { Source, VSeg } from '../lib/projectTypes'

export interface UseAttrCopyDeps {
  /** 本編（V1/A1）に鍵が掛かっているか */
  mainLocked: () => boolean
  telopLocked: (c: import('../lib/srt').Cue) => boolean
  /** その切片の元の素材（名前を出すのに使う） */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  srcOfSeg: (seg: VSeg | undefined) => Source | undefined
}

export function useAttrCopy(deps: UseAttrCopyDeps) {
  const { mainLocked, telopLocked, srcOfSeg } = deps
  const {
    cues, setCues, segments, setSegments, seClips, setSeClips,
    imgClips, setImgClips, vClips, setVClips
  } = useDoc()
  const {
    selectedIds, selectedSeIds, selectedImgIds, selectedVClipIds, selectedVideoIds
  } = useSel()
  const { trackStates } = useTracksCtx()
  const { showToast } = useToastCtx()
  const { copiedAttrs, setCopiedAttrs } = useClipboardCtx()

  /** 何を写せるかの一覧（人に見せる文言） */
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

  /** 選んでいるクリップ1つから属性をコピーする */
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

  /**
   * コピーした属性を、選んでいるクリップすべてに貼り付ける。
   *
   * テロップの見た目をコピーして全部選んで貼っても、動画や画像には
   * 貼らずテロップにだけ貼る。全部に貼ろうとして何も起きないより、
   * 貼れるものにだけ貼って「何件に貼ったか」を伝えるほうが親切。
   */
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

  return { attrSummary, copyAttributes, pasteAttributes }
}
