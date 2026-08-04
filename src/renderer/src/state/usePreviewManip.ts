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
import {
  zoomAt,
  zoomOffsetForAnchor,
  anchorOfZoom,
  MIN_MOTION_SCALE,
  type ClipMotion,
  type Zoom
} from '../../../shared/clipMotion'
import { DEFAULT_ZOOM } from '../lib/clipLook'
import type { ImgClip, ReframeTarget, VClip, VSeg } from '../lib/projectTypes'
import type { Layout } from '../../../shared/timeline'
import type { useEdit } from './useEdit'
// 拡大の基準点。**このファイルの土台**（掴む側も選ぶ側も、これを通る）
import { usePreviewAnchor } from './usePreviewAnchor'
import { useDoc } from './contentContext'
import { usePlaybackCtx } from './playbackContext'
import { useSel } from './selectionContext'
import { useTracksCtx } from './tracksContext'
import { useToastCtx } from './toastContext'

// **`any` で受けない。** 呼ぶ側が実物を渡す入口なので、型がズレた瞬間に
// 呼び出し側で落ちる＝手で書いても腐らない。
export interface UsePreviewManipDeps {
  /** 映像を映している枠。ここを基準に掴んだ位置を測る */
  screenRef: React.RefObject<HTMLDivElement>
  /** いま掴める相手（本編の切片・重ねた動画・画像のどれか） */
  reframeTargetRef: React.MutableRefObject<ReframeTarget | null>
  segLayout: Layout<VSeg>[]
  vcLen: (c: VClip) => number
  // ※ videoRef / cueTrack / iconForCue / videoTLen / v1Hidden / curBlank /
  //   curSegZoom は消した。**本体では1度も読まず、useScreenshot へ渡すだけ**
  //   だった（2026-08-03。呼ぶ側があちらを直接呼ぶ形にした）。
  /**
   * 印（キーフレーム）が付いている項目を書き換える。
   * **形は書き写さず `useEdit` から引く**（`useMotion` でも同じ物が要るので、
   * 写すと片方だけ古くなる）
   */
  patchClipMotion: Edit['patchClipMotion']
  setSegZoom: Edit['setSegZoom']
  setImgZoom: Edit['setImgZoom']
  setVClipZoom: Edit['setVClipZoom']
  /** これだけ useEdit の物ではない（回転は切片だけの話なので別の所で作っている） */
  setSegRotate: (segId: number, deg: number) => void
  clearAllSelections: () => void
}

/** 作っている側（state/useEdit）の形。ここで書き直さない */
type Edit = ReturnType<typeof useEdit>

export function usePreviewManip(deps: UsePreviewManipDeps) {
  const {
    screenRef, reframeTargetRef, segLayout, vcLen, patchClipMotion,
    setSegZoom, setImgZoom, setVClipZoom, setSegRotate, clearAllSelections
  } = deps
  const { setSegments, imgClips, setImgClips, vClips, setVClips } = useDoc()
  const {
    selectedVideoIds, selectedImgIds, setSelectedImgIds, selectedVClipIds,
    setSelectedVClipIds, setVideoSelected
  } = useSel()
  const { trackStates } = useTracksCtx()
  const { showToast } = useToastCtx()
  const { currentTimeRef } = usePlaybackCtx()


  /** 印を読む・打つときの時刻（クリップの先頭からの秒） */
  const clipTimeOf = (t: ReframeTarget): number =>
    clamp(currentTimeRef.current - t.tStart, 0, Math.max(0, t.len))

  /** 固定値の zoom を書き込む（種類ごとに置き場が違うだけ） */
  const setFixedZoom = (t: ReframeTarget, z: Zoom): void =>
    t.kind === 'video'
      ? setSegZoom(t.id, z)
      : t.kind === 'vclip'
        ? setVClipZoom(t.id, z)
        : setImgZoom(t.id, z)

  const lockedFor = (t: ReframeTarget): boolean =>
    !!(t.kind === 'video' ? trackStates['V1']?.locked : trackStates[t.track]?.locked)

  // 拡大の基準点まわり（出す・当てる・掴む）は state/usePreviewAnchor。
  // **どの話題もこれを土台にしていた**ので先に出してある。要るのは deps 3つと
  // すぐ上の小物3つだけで、心臓（context）は1つも見に行かない
  const {
    zoomAnchor, setZoomAnchor, toggleZoomAnchor, applyZoomAnchor, onZoomAnchorStart
  } = usePreviewAnchor({ screenRef, reframeTargetRef, patchClipMotion, clipTimeOf, setFixedZoom, lockedFor })

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
    if (lockedFor(tgt)) return
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
    const clipT = clipTimeOf(tgt)
    const start = zoomAt(tgt.zoom, m, clipT)
    const setFixed = (z: Zoom): void => setFixedZoom(tgt, z)
    const apply = (z: Zoom): void => {
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

    // 掴んだ瞬間の基準点で通す（掴んでいる途中に出し入れされても、
    // 同じドラッグの中で寄り先が変わらない）
    const anchor = zoomAnchor
    const onMove = (ev: PointerEvent): void => {
      if (corner != null) {
        const dist = Math.hypot(ev.clientX - cx, ev.clientY - cy)
        const ns = clamp(start.scale * (dist / startDist), 0.2, 8)
        // **基準点を出しているなら、そこへ向かって寄る。**
        // 拡大は中心基準なので、位置を一緒にずらして「その点が動かない」状態を作る。
        apply(anchor ? { scale: ns, ...zoomOffsetForAnchor(anchor, ns) } : { ...start, scale: ns })
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
        const nz = {
          ...start,
          x: clamp(start.x + dx, -10, 10),
          y: clamp(start.y + dy, -10, 10)
        }
        apply(nz)
        // 掴んで動かすと基準点も動く（絵をずらせば、止まっている点は別の場所になる）。
        // ここで付いていかせないと、下の見張りが「基準点と合っていない」と見て
        // **動かした先から引き戻す**＝パンできなくなる
        if (anchor) setZoomAnchor({ ...anchorOfZoom(nz), kind: tgt.kind, id: tgt.id })
        if (others.length) moveOthers(dx, dy)
      }
    }
    const onUp = (): void => {
      // 拡大に印があるなら、掴み終わってから基準点を**すべての印へ引き直す**。
      // ドラッグ中に打てるのはその時刻の1点だけなので、そのままでは
      // 寄っていく途中で基準点がずれる。
      if (corner != null && anchor && hasKeys(reframeTargetRef.current?.motion?.sc))
        applyZoomAnchor(anchor)
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
    // 基準点のマーカーは**そのまま残す**。等倍に戻った時点で絵の側に基準点は
    // 残らないが、マーカーは「次はここへ寄せたい」という指定なので、
    // 戻すたびに真ん中へ帰られると置き直す羽目になる
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
    if (lockedFor(tgt)) return
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

  // ※ スクショ（撮る）は state/useScreenshot。**ここを素通ししない。**
  //   2026-08-03 まで、こちらが受け取ってあちらへ渡すだけの中継をしていて、
  //   そのためだけに deps が7個（videoRef / cueTrack / iconForCue / videoTLen /
  //   v1Hidden / curBlank / curSegZoom）増えていた。**本体では1度も読んでいない。**
  //   呼ぶ側（useAppWiring）はその7個を元から全部持っているので、直接呼べば済む。
  return {
    onVideoReframeStart, selectPreviewOverlay, resetVideoZoom, onVideoRotateStart,
    zoomAnchor, toggleZoomAnchor, onZoomAnchorStart
  }
}
