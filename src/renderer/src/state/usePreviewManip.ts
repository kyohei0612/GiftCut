// プレビューの上で映像そのものを掴む。動かす・拡げる・回す。それと画面を撮る。
//
// ## 掴む相手は「いま選んでいる物」
//
// 本編の切片・重ねた動画・画像のどれでも、同じ枠と同じ掴み方で扱う。
// 種類ごとに操作を分けると、同じ見た目の枠なのに掴めたり掴めなかったりする。
//
// ## 印（キーフレーム）が付いていたら、印を動かす
//
// 印が無ければ固定値を書き換えるが、**印があるのに固定値を動かすと、
// 再生した瞬間に元へ戻る**（印の値が勝つため）。付いている項目だけ印側へ書く。
//
// ## 撮った絵は「いま見えているまま」
//
// プレビューは編集用に焼き直した映像なので、撮った物も書き出しの画質とは違う。
// 確認用と割り切って、見えている通りを保存する。

import { clamp } from '../../../shared/timeline'
import { hasKeys, putKey, type Keys } from '../../../shared/keyframes'
import { zoomAt, MIN_MOTION_SCALE, type ClipMotion } from '../../../shared/clipMotion'
import { DEFAULT_ZOOM } from '../lib/clipLook'
import { telopStateAt } from '../lib/telopStyle'
import { renderCueToPng } from '../lib/rasterize'
import type { Cue } from '../lib/srt'
import type { ImgClip, ReframeTarget, VClip } from '../lib/projectTypes'
import { useDoc } from './contentContext'
import { useMediaCtx } from './mediaContext'
import { usePlaybackCtx } from './playbackContext'
import { useExportCtx } from './exportContext'
import { useIconsCtx } from './iconsContext'
import { useSel } from './selectionContext'
import { useTracksCtx } from './tracksContext'
import { useToastCtx } from './toastContext'
import { useViewCtx } from './viewContext'

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface UsePreviewManipDeps {
  /** 映像を映している枠。ここを基準に掴んだ位置を測る */
  screenRef: React.RefObject<HTMLDivElement>
  videoRef: any
  /** いま掴める相手（本編の切片・重ねた動画・画像のどれか） */
  reframeTargetRef: React.MutableRefObject<ReframeTarget | null>
  segLayout: any
  cueTrack: (c: Cue) => string
  iconForCue: any
  vcLen: (c: VClip) => number
  videoTLen: any
  /** いま本編の映像が隠されているか */
  v1Hidden: any
  curBlank: any
  curSegZoom: any
  /** 印（キーフレーム）が付いている項目を書き換える */
  patchClipMotion: any
  setSegZoom: any
  setImgZoom: any
  setVClipZoom: any
  setSegRotate: any
  clearAllSelections: () => void
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function usePreviewManip(deps: UsePreviewManipDeps) {
  const {
    screenRef, videoRef, reframeTargetRef, segLayout, cueTrack, iconForCue, vcLen,
    videoTLen, v1Hidden, curBlank, curSegZoom, patchClipMotion,
    setSegZoom, setImgZoom, setVClipZoom, setSegRotate, clearAllSelections
  } = deps
  const { cues, setSegments, imgClips, setImgClips, vClips, setVClips } = useDoc()
  const {
    selectedVideoIds, selectedImgIds, setSelectedImgIds, selectedVClipIds,
    setSelectedVClipIds, setVideoSelected
  } = useSel()
  const { trackStates } = useTracksCtx()
  const { showToast } = useToastCtx()
  const { videoSrc } = useMediaCtx()
  const { currentTimeRef } = usePlaybackCtx()
  const { ratio } = useExportCtx()
  const { iconAuto, iconOffset, iconScale, iconSide } = useIconsCtx()

  // リフレーム操作: corner=null で本体ドラッグ=パン、cornerあり=四隅ドラッグで拡大縮小（中心基準）。
  // 対象は「画像を選択中なら画像、それ以外は再生ヘッド位置の動画切片」（reframeTarget）。
  //
  // override: プレビュー上の画像／映像レイヤーを直接掴んだときの対象。選択の state 更新は
  // 次の描画までは reframeTargetRef に反映されないので、掴んだ瞬間に対象を渡す必要がある
  // （渡さないと「押した画像ではなく下の動画が動く」ことになる）。
  function onVideoReframeStart(
    e: React.PointerEvent,
    corner: number | null,
    override?: ReframeTarget
  ): void {
    if (e.button !== 0) return
    const tgt = override ?? reframeTargetRef.current
    if (!tgt) return
    if (tgt.kind === 'video' ? trackStates['V1']?.locked : trackStates[tgt.track]?.locked) return
    e.stopPropagation()
    e.preventDefault()
    const rect = screenRef.current?.getBoundingClientRect()
    if (!rect) return
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    // 動きが付いている項目は、固定値ではなく**その時刻の印**を動かす。
    // 固定値の方を触ると、打った印はそのままなので「掴んだのに動かない」ことになる。
    // 掴み始めの値も、いま画面に出ている値（＝印を反映した値）から取る。
    const m = tgt.motion
    const clipT = clamp(currentTimeRef.current - tgt.tStart, 0, Math.max(0, tgt.len))
    const start = zoomAt(tgt.zoom, m, clipT)
    const setFixed = (z: { scale: number; x: number; y: number }): void =>
      tgt.kind === 'video'
        ? setSegZoom(tgt.id, z)
        : tgt.kind === 'vclip'
          ? setVClipZoom(tgt.id, z)
          : setImgZoom(tgt.id, z)
    const apply = (z: { scale: number; x: number; y: number }): void => {
      const fixed = { ...z }
      if (hasKeys(m?.sc)) {
        const v = Math.max(MIN_MOTION_SCALE, z.scale)
        patchClipMotion(tgt.kind, tgt.id, 'sc', (k: Keys | undefined) => putKey(k, clipT, v))
        fixed.scale = tgt.zoom.scale
      }
      if (hasKeys(m?.x)) {
        patchClipMotion(tgt.kind, tgt.id, 'x', (k: Keys | undefined) => putKey(k, clipT, z.x))
        fixed.x = tgt.zoom.x
      }
      if (hasKeys(m?.y)) {
        patchClipMotion(tgt.kind, tgt.id, 'y', (k: Keys | undefined) => putKey(k, clipT, z.y))
        fixed.y = tgt.zoom.y
      }
      // 印で受けた項目しか無ければ、固定値は触らない（触ると履歴が二重に積まれる）
      if (
        fixed.scale !== tgt.zoom.scale ||
        fixed.x !== tgt.zoom.x ||
        fixed.y !== tgt.zoom.y
      )
        setFixed(fixed)
    }
    const sx = e.clientX
    const sy = e.clientY
    const startDist = Math.max(1, Math.hypot(e.clientX - cx, e.clientY - cy))

    // **選んである物は一緒に動かす。**
    // 掴んだ物のほかに選択中の画像・映像レイヤー・切片があれば、同じだけずらす。
    // ずらす量だけを配るので、それぞれの元の位置関係は崩れない。
    // ※動かすときだけ。**拡大は掴んだ物だけ**にする（まとめて拡大は、
    //   基準点がそれぞれ違うので、揃えたつもりがばらばらに飛ぶ）。
    type Mover = {
      kind: 'video' | 'vclip' | 'img'
      id: number
      base: { scale: number; x: number; y: number }
      motion?: ClipMotion
      clipT: number
    }
    const others: Mover[] = []
    if (corner == null) {
      const same = (k: string, i: number): boolean => k === tgt.kind && i === tgt.id
      const localT = (start: number, len: number): number =>
        clamp(currentTimeRef.current - start, 0, Math.max(0, len))
      for (const c of imgClips) {
        if (!selectedImgIds.includes(c.id) || same('img', c.id)) continue
        if (trackStates[c.track]?.locked) continue
        const ct = localT(c.tStart, c.duration)
        others.push({
          kind: 'img',
          id: c.id,
          base: zoomAt(c.zoom ?? DEFAULT_ZOOM, c.motion, ct),
          motion: c.motion,
          clipT: ct
        })
      }
      for (const c of vClips) {
        if (!selectedVClipIds.includes(c.id) || same('vclip', c.id)) continue
        if (trackStates[c.track]?.locked) continue
        const ct = localT(c.tStart, vcLen(c))
        others.push({
          kind: 'vclip',
          id: c.id,
          base: zoomAt(c.zoom ?? DEFAULT_ZOOM, c.motion, ct),
          motion: c.motion,
          clipT: ct
        })
      }
      if (!trackStates['V1']?.locked) {
        for (const L of segLayout) {
          if (!selectedVideoIds.includes(L.seg.id) || same('video', L.seg.id)) continue
          const ct = localT(L.tStart, L.len)
          others.push({
            kind: 'video',
            id: L.seg.id,
            base: zoomAt(L.seg.zoom ?? DEFAULT_ZOOM, L.seg.motion, ct),
            motion: L.seg.motion,
            clipT: ct
          })
        }
      }
    }
    /** 一緒に動かす物へ、同じズレを配る */
    const moveOthers = (dx: number, dy: number): void => {
      for (const o of others) {
        const nx = clamp(o.base.x + dx, -10, 10)
        const ny = clamp(o.base.y + dy, -10, 10)
        // 印が付いている項目は印を、付いていなければ固定値を動かす（掴んだ物と同じ扱い）
        const fixed = { ...o.base }
        if (hasKeys(o.motion?.x)) patchClipMotion(o.kind, o.id, 'x', (k: Keys | undefined) => putKey(k, o.clipT, nx))
        else fixed.x = nx
        if (hasKeys(o.motion?.y)) patchClipMotion(o.kind, o.id, 'y', (k: Keys | undefined) => putKey(k, o.clipT, ny))
        else fixed.y = ny
        if (fixed.x !== o.base.x || fixed.y !== o.base.y) {
          if (o.kind === 'video') setSegZoom(o.id, fixed)
          else if (o.kind === 'vclip') setVClipZoom(o.id, fixed)
          else setImgZoom(o.id, fixed)
        }
      }
    }

    const onMove = (ev: PointerEvent): void => {
      if (corner != null) {
        const dist = Math.hypot(ev.clientX - cx, ev.clientY - cy)
        apply({ ...start, scale: clamp(start.scale * (dist / startDist), 0.2, 8) })
      } else {
        // **枠の外まで自由に持っていける**（プレミアと同じ）。
        // 以前はフレーム1つぶん（±1）で頭打ちにしていたため、画面の外へ
        // 送り出す動きが作れなかった。9:16 では枠が狭いぶん特に効いて、
        // 「クロップしても外に出せない」状態になっていた。
        //
        // 上限を残しているのは、掴み損ねて何万倍も飛ばしたときに戻れなくなるのを
        // 避けるためだけ（フレーム10個ぶんあれば、送り出す演出には十分足りる）。
        const dx = (ev.clientX - sx) / rect.width
        const dy = (ev.clientY - sy) / rect.height
        apply({
          ...start,
          x: clamp(start.x + dx, -10, 10),
          y: clamp(start.y + dy, -10, 10)
        })
        if (others.length) moveOthers(dx, dy)
      }
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }
  /**
   * プレビュー上の画像／映像レイヤーを直接掴む。
   *
   * 以前はこれらが pointer-events: none で、画面に出ている画像を押しても
   * クリックが下の動画へ抜け、動画のパンが始まるだけだった（画像に触れなかった）。
   * 押した本人を選択してから、その対象でリフレームのドラッグを始める。
   */
  function selectPreviewOverlay(
    e: React.PointerEvent,
    o: { kind: 'img'; clip: ImgClip } | { kind: 'vclip'; clip: VClip }
  ): void {
    if (e.button !== 0) return
    if (trackStates[o.clip.track]?.locked) {
      showToast('このトラックはロックされています。')
      return
    }
    e.stopPropagation()
    // 他の選択を解除してから自分を選ぶ（Delete の行き先が曖昧にならないように）
    clearAllSelections()
    setVideoSelected(false)
    const tgt: ReframeTarget = {
      kind: o.kind,
      id: o.clip.id,
      zoom: o.clip.zoom ?? DEFAULT_ZOOM,
      rotate: o.clip.rotate ?? 0,
      track: o.clip.track,
      name: o.clip.name,
      motion: o.clip.motion,
      tStart: o.clip.tStart,
      len: o.kind === 'img' ? o.clip.duration : vcLen(o.clip)
    }
    if (o.kind === 'img') setSelectedImgIds([o.clip.id])
    else setSelectedVClipIds([o.clip.id])
    // 選択の state はまだ反映されていないので、対象を明示的に渡す
    onVideoReframeStart(e, null, tgt)
  }
  /**
   * リフレームのリセット。
   *
   * **選んでいる物すべてに効く。** 大きさや位置を変えるときは選択中の全部に
   * 効くのに、戻すときだけ1つずつでは対で使えない。
   *
   * **打った動きも一緒に消す。** 拡大だけ等倍に戻しても、印が残っていれば
   * 再生した瞬間にまた動きだす＝「戻っていない」ように見える。
   * 戻すというからには、その場で見えている状態を作っている物を全部外す。
   */
  function resetVideoZoom(): void {
    const tgt = reframeTargetRef.current
    if (!tgt) return
    // 選んでいなければ、いま触っている1つだけが対象
    const vids = selectedVideoIds.length
      ? selectedVideoIds
      : tgt.kind === 'video'
        ? [tgt.id]
        : []
    const imgs = selectedImgIds.length ? selectedImgIds : tgt.kind === 'img' ? [tgt.id] : []
    const vcs = selectedVClipIds.length ? selectedVClipIds : tgt.kind === 'vclip' ? [tgt.id] : []
    if (vids.length && !trackStates['V1']?.locked)
      setSegments((prev) =>
        prev.map((s) => (vids.includes(s.id) ? { ...s, zoom: undefined, motion: undefined } : s))
      )
    if (imgs.length)
      setImgClips((prev) =>
        prev.map((c) =>
          imgs.includes(c.id) && !trackStates[c.track]?.locked
            ? { ...c, zoom: undefined, motion: undefined }
            : c
        )
      )
    if (vcs.length)
      setVClips((prev) =>
        prev.map((c) =>
          vcs.includes(c.id) && !trackStates[c.track]?.locked
            ? { ...c, zoom: undefined, motion: undefined }
            : c
        )
      )
  }

  // プレビューでリフレーム対象を自由回転（回転ハンドルのドラッグ）。Shiftで15°スナップ。
  function onVideoRotateStart(e: React.PointerEvent): void {
    if (e.button !== 0) return
    const tgt = reframeTargetRef.current
    if (!tgt) return
    if (tgt.kind === 'video' ? trackStates['V1']?.locked : trackStates[tgt.track]?.locked) return
    e.stopPropagation()
    e.preventDefault()
    const rect = screenRef.current?.getBoundingClientRect()
    if (!rect) return
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    const startRot = tgt.rotate
    const startAngle = (Math.atan2(e.clientY - cy, e.clientX - cx) * 180) / Math.PI
    const onMove = (ev: PointerEvent): void => {
      const a = (Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180) / Math.PI
      let deg = startRot + (a - startAngle)
      if (ev.shiftKey) deg = Math.round(deg / 15) * 15
      const d = ((Math.round(deg) % 360) + 360) % 360
      if (tgt.kind === 'video') setSegRotate(tgt.id, deg)
      else if (tgt.kind === 'vclip')
        setVClips((prev) =>
          prev.map((c) => (c.id === tgt.id ? { ...c, rotate: d === 0 ? undefined : d } : c))
        )
      else
        setImgClips((prev) =>
          prev.map((c) => (c.id === tgt.id ? { ...c, rotate: d === 0 ? undefined : d } : c))
        )
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  // 現在のプレビュー画面（動画フレーム＋テロップ＋ズーム）を PNG で保存。
  // 表示中と同じプロキシ映像を出力解像度で描き、テロップは書き出しと同じ rasterize を再利用。
  async function captureScreenshot(): Promise<void> {
    const v = videoRef.current
    if (!videoSrc || !v) {
      showToast('先に動画を読み込んでください。\n右の「プロジェクト」タブ →「＋ファイル追加」から追加できます。')
      return
    }
    const size =
      ratio === '16:9'
        ? { width: 1920, height: 1080 }
        : ratio === '9:16'
          ? { width: 1080, height: 1920 }
          : { width: 1080, height: 1080 }
    const canvas = document.createElement('canvas')
    canvas.width = size.width
    canvas.height = size.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    // 背景（動画が透明/レターボックスの部分）は黒で塗る
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, size.width, size.height)
    // 動画フレームをズーム変換込みで contain 描画（プレビューの transform と一致）
    const blank = curBlank || v1Hidden || (videoTLen > 0 && currentTimeRef.current >= videoTLen - 1e-3)
    const shotZoom = curSegZoom
    if (!blank && v.videoWidth > 0) {
      ctx.save()
      ctx.translate(shotZoom.x * size.width, shotZoom.y * size.height)
      ctx.translate(size.width / 2, size.height / 2)
      ctx.scale(shotZoom.scale, shotZoom.scale)
      ctx.translate(-size.width / 2, -size.height / 2)
      const r = Math.min(size.width / v.videoWidth, size.height / v.videoHeight)
      const dw = v.videoWidth * r
      const dh = v.videoHeight * r
      ctx.drawImage(v, (size.width - dw) / 2, (size.height - dh) / 2, dw, dh)
      ctx.restore()
    }
    // テロップ（👁表示中のみ）を書き出しと同じ描画で重ねる
    const t = currentTimeRef.current
    const shown = cues.filter(
      (c) => !trackStates[cueTrack(c)]?.hidden && t >= c.start && t < c.end
    )
    for (const c of shown) {
      const avatar = iconForCue(c)
      const asc = avatar ? iconScale : 1
      const st = telopStateAt(c.style.anim, c.motion, t - c.start, c.end - c.start)
      const png = await renderCueToPng(
        c, size.width, size.height, avatar, asc, st, iconSide, iconOffset.x, iconOffset.y, iconAuto
      )
      await new Promise<void>((res) => {
        const img = new Image()
        img.onload = () => {
          ctx.drawImage(img, 0, 0, size.width, size.height)
          res()
        }
        img.onerror = () => res()
        img.src = png
      })
    }
    const dataUrl = canvas.toDataURL('image/png')
    const r = await window.giftcut.saveImage(dataUrl)
    if (r?.ok && r.path) showToast('スクショを保存しました:\n' + r.path, 'success')
    else if (r?.error && r.error !== 'キャンセル') showToast('保存失敗: ' + r.error, 'error')
  }

  return { onVideoReframeStart, selectPreviewOverlay, resetVideoZoom, onVideoRotateStart, captureScreenshot }
}
