// 「いま画面に出ている物」の見た目と、リフレーム枠の操作対象。
//
// ## なぜ1か所にまとまるか
//
// どれも**再生ヘッドの位置から、いまの1つを選び出す**という同じ形の計算。
// 黒ブランクか / 色調整は / 寄りは / 切り抜きは、と別々の場所に書くと、
// 「切片の探し方」だけが少しずつ食い違って、片方にしか効かない不具合になる。
//
// ## リフレームの対象だけ選び方が違う
//
// 見た目は再生ヘッドの位置で決まるが、**枠を掴んで動かす相手は「選んでいる物」**。
// 重ねる動画 → 画像 → 動画の切片、の順に優先する。ここを揃えてしまうと
// 「画像を選んだのに動画が拡大される」になる（実際にそうなっていた）。
import { useRef } from 'react'
import { tToSource } from '../../../shared/timeline'
import { DEFAULT_CROP, DEFAULT_ZOOM, adjustCss, cropInset } from '../lib/clipLook'
import { zoomAt } from '../../../shared/clipMotion'
import type {
  ImgClip,
  ReframeTarget,
  SegLayout,
  Source,
  VClip,
  VSeg
} from '../lib/projectTypes'

export interface UseCurrentLookDeps {
  segLayout: SegLayout[]
  segments: VSeg[]
  currentTime: number
  previewSources: Source[]
  activeSrcId: number | null
  selectedVideoIds: number[]
  selectedImgIds: number[]
  selectedVClipIds: number[]
  imgClips: ImgClip[]
  vClips: VClip[]
  vcLen: (c: VClip) => number
  srcOfSeg: (seg: VSeg | undefined) => Source | undefined
  videoName: string | null
}

export function useCurrentLook(deps: UseCurrentLookDeps) {
  const {
    segLayout, segments, currentTime, previewSources, activeSrcId,
    selectedVideoIds, selectedImgIds, selectedVClipIds,
    imgClips, vClips, vcLen, srcOfSeg, videoName
  } = deps

  /** 実際に映すソース（選ばれている物が一覧に無ければ先頭＝主素材） */
  const effActiveSrcId = previewSources.some((s) => s.id === activeSrcId)
    ? activeSrcId
    : (previewSources[0]?.id ?? null)

  /** 再生ヘッドの位置が黒ブランクの切片か */
  const curBlank = (() => {
    const src = tToSource(segLayout, currentTime)
    return src ? !!segments[src.index]?.videoBlank : false
  })()

  /** 再生ヘッドの位置の色調整（CSS filter）。切片が変われば自動で切り替わる */
  const curAdjustCss = (() => {
    const src = tToSource(segLayout, currentTime)
    return src ? adjustCss(segments[src.index]?.adjust) : undefined
  })()

  /**
   * 再生ヘッドの位置の寄り。
   * **動きが付いていれば、その瞬間の値**（印が無ければ固定値がそのまま返る）。
   */
  const curSegZoom = (() => {
    const src = tToSource(segLayout, currentTime)
    const seg = src ? segments[src.index] : undefined
    if (!seg) return DEFAULT_ZOOM
    const L = segLayout[src!.index]
    return zoomAt(seg.zoom ?? DEFAULT_ZOOM, seg.motion, currentTime - (L?.tStart ?? 0))
  })()

  /** 再生ヘッドの位置の切り抜き */
  const curSegCrop = (() => {
    const src = tToSource(segLayout, currentTime)
    return (src ? segments[src.index]?.crop : undefined) ?? DEFAULT_CROP
  })()
  const curCropInset = cropInset(curSegCrop)

  /** 枠を掴んで動かす相手（重ねる動画 → 画像 → 動画の切片） */
  const reframeTarget: ReframeTarget | null = (() => {
    const vc =
      selectedVClipIds.length === 1
        ? vClips.find((c) => c.id === selectedVClipIds[0])
        : undefined
    if (vc)
      return {
        kind: 'vclip' as const,
        id: vc.id,
        zoom: vc.zoom ?? DEFAULT_ZOOM,
        rotate: vc.rotate ?? 0,
        track: vc.track,
        name: vc.name,
        motion: vc.motion,
        tStart: vc.tStart,
        len: vcLen(vc)
      }
    const img =
      selectedImgIds.length === 1 ? imgClips.find((c) => c.id === selectedImgIds[0]) : undefined
    if (img)
      return {
        kind: 'img' as const,
        id: img.id,
        zoom: img.zoom ?? DEFAULT_ZOOM,
        rotate: img.rotate ?? 0,
        track: img.track,
        name: img.name,
        motion: img.motion,
        tStart: img.tStart,
        len: img.duration
      }
    // **選んでいる切片を優先する。** 画像と重ねる動画は選択から取っているのに
    // 動画の切片だけ再生ヘッドの位置から取っていたため、3番目の切片を選んで
    // 枠を動かすと、再生ヘッドのある1番目が拡大されていた。
    // 選択が無いときだけ、従来どおり再生ヘッドの位置を対象にする。
    const selL = selectedVideoIds.length
      ? segLayout.find((l) => selectedVideoIds.includes(l.seg.id))
      : undefined
    const src = tToSource(segLayout, currentTime)
    const L = selL ?? (src ? segLayout[src.index] : undefined)
    const seg = L?.seg
    if (!seg) return null
    return {
      kind: 'video' as const,
      id: seg.id,
      zoom: seg.zoom ?? DEFAULT_ZOOM,
      rotate: seg.rotate ?? 0,
      track: 'V1',
      name: srcOfSeg(seg)?.name ?? videoName ?? '動画',
      motion: seg.motion,
      tStart: L!.tStart,
      len: L!.len
    }
  })()

  /** 掴んでいる最中に読む用（state だと掴み始めた時点の古い値が焼き付く） */
  const reframeTargetRef = useRef(reframeTarget)
  reframeTargetRef.current = reframeTarget

  return {
    effActiveSrcId,
    curBlank,
    curAdjustCss,
    curSegZoom,
    curSegCrop,
    curCropInset,
    reframeTarget,
    reframeTargetRef
  }
}
