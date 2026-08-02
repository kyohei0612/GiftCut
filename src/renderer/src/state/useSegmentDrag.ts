// 本編の切片（V1/A1 に並ぶカット列）を掴む・端を摘む。
//
// ## 他の「掴む」と何が違うか
//
//   useTelopBox      … 映っている絵の上。位置は画面実寸の割合
//   useTimelineDrag  … タイムラインの上。時刻と段が相手
//   ここ             … **本編のカット列**。並び順そのものが変わる
//
// 切片は「並んでいる順」に意味がある。掴んで動かすと後ろが詰まったり、
// 置いた所の物が上書きされたりする——ほかのクリップのように
// 「その場所へ置くだけ」では済まない。
//
// ## 映像と音声は、選ぶのは別・切るのは共有
//
// 同じ切片を V1 と A1 の両方から掴める。**選択は別々に持つ**（映像だけ
// 選んで動かしたいことがある）が、**カット位置は共有**する
// （別々に切れると、映像と音がずれたまま編集が進む）。
//
// ## 端を摘むと、素材の使う範囲が変わる
//
// クリップを短くするのではなく、素材のどこからどこまでを使うかを変える。
// **縮めた分は捨てていない**ので、あとから伸ばして戻せる。

import { useRef } from 'react'
import { startEdgeScroll } from '../lib/edgeScroller'
import { clamp, layoutSegs, segSpeed } from '../../../shared/timeline'
import { dragModeOf, movedEnough, type SegDropMode } from '../../../shared/dragMode'
import { toggleSelect } from '../../../shared/clipEdit'
import { formatTime } from '../lib/srt'
import { rafThrottle } from '../lib/schedule'
import { type SegLayout } from '../lib/projectTypes'
import { useDoc } from './contentContext'
import { useSel } from './selectionContext'

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface UseSegmentDragDeps {
  /** 本編が鍵で守られているか */
  /** いまの道具（選択・レザー） */
  tool: any
  mainLocked: () => boolean
  /** 段まるごとの選択ツールが先に反応したか。true なら掴みは始めない */
  maybeTrackSelect: (e: React.PointerEvent) => boolean
  stopPlayback: () => void
  undo: () => void

  /** 切片を別の時刻へ動かす（並び替えの本体） */
  moveSegmentTo: any
  /** 切片を切る */
  razorSegment: any
  /** その切片が使っている素材 */
  srcOfSeg: any
  /** 境目より後ろをまとめてずらす */
  shiftAfter: (boundaryT: number, delta: number) => void

  trackInnerRef: React.RefObject<HTMLDivElement | null>
  /** 横に送る入れ物。端まで持っていったときに、ここを送る */
  scrollRef: React.RefObject<HTMLDivElement | null>
  /** 横の拡大率（px/秒）。掴んでいる最中にも読むので ref */
  zoomRef: React.MutableRefObject<number>
  videoDurationRef: React.MutableRefObject<number>
  videoName: string | null
  videoPath: string | null

  /** 掴んでいる最中の見た目 */
  setDragTip: (v: { x: number; y: number; text: string } | null) => void
  setSnapLineX: (v: number | null) => void
  setVideoGhost: any
  /** 落とすと上書きされる相手。赤く見せるために覚えておく */
  setOverwriteIds: React.Dispatch<React.SetStateAction<number[]>>
  snapClipStart: any
  snapTime: any
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function useSegmentDrag(deps: UseSegmentDragDeps) {
  const {
    tool, mainLocked, maybeTrackSelect, stopPlayback, 
    moveSegmentTo, razorSegment, srcOfSeg, shiftAfter,
    trackInnerRef, scrollRef, zoomRef, videoDurationRef, videoName, videoPath,
    setDragTip, setSnapLineX, setVideoGhost, setOverwriteIds,
    snapClipStart, snapTime
  } = deps
  // 落とし方（動かす／複製／割り込み）と落とし先。
  // **掴んでいる間だけの覚え書き**で外からは触らないので、ここで持つ
  const segDropModeRef = useRef<SegDropMode>('move')
  const segMoveToRef = useRef<number | null>(null)
  const {
     setSegments,  segsRef,
    cues, setCues, seClips, setSeClips, imgClips, setImgClips,
    vClips, setVClips, markers, setMarkers
  } = useDoc()
  const {
    selectedVideoIds, setSelectedVideoIds, selectedAudioIds, setSelectedAudioIds,
    selectedIds,  selectedSeIds, 
    selectedImgIds,  selectedVClipIds, 
    selectedMarkerId,
      setSelectedTrackId, 
        clearAll: clearAllSelections
  } = useSel()

  // 動画/音声の切片クリック（選択 / レザー分割 / ドラッグで並べ替え）
  // track: 'video'(V1) か 'audio'(A1)。選択は独立、カットは共有
  function onSegPointerDown(L: SegLayout, e: React.PointerEvent, track: 'video' | 'audio'): void {
    if (maybeTrackSelect(e)) return
    e.stopPropagation()
    if (e.button !== 0) return
    setSelectedTrackId(null)
    if (tool === 'razor') {
      const inner = trackInnerRef.current
      if (!inner) return
      const t = (e.clientX - inner.getBoundingClientRect().left) / zoomRef.current
      // タイムライン秒→ソース秒は速度を掛ける（速度付きクリップで分割点がズレないように）
      razorSegment(L.seg, L.seg.srcStart + (t - L.tStart) * segSpeed(L.seg))
      return
    }
    // 掴んだ切片が既に選択に入っていたら「選択ごと動かす」。全選択して動かしたときに
    // テロップ・SE・画像・映像レイヤー・マーカーが取り残されないようにする。
    // その場合だけは他種の選択を消さない。
    const grabbedInSel =
      selectedVideoIds.includes(L.seg.id) || selectedAudioIds.includes(L.seg.id)
    // 一緒に動かす他の切片（複数選択して掴んだとき）。掴んだ本人は含めない。
    const segGroupIds = grabbedInSel
      ? [...new Set([...selectedVideoIds, ...selectedAudioIds])].filter((id) => id !== L.seg.id)
      : []
    const groupBase = grabbedInSel
      ? {
          cues: cues.filter((c) => selectedIds.includes(c.id)).map((c) => ({ id: c.id, t: c.start })),
          se: seClips.filter((c) => selectedSeIds.includes(c.id)).map((c) => ({ id: c.id, t: c.tStart })),
          img: imgClips.filter((c) => selectedImgIds.includes(c.id)).map((c) => ({ id: c.id, t: c.tStart })),
          vc: vClips.filter((c) => selectedVClipIds.includes(c.id)).map((c) => ({ id: c.id, t: c.tStart })),
          mk: markers.filter((m) => m.id === selectedMarkerId).map((m) => ({ id: m.id, t: m.t }))
        }
      : null
    const hasGroup =
      !!groupBase &&
      groupBase.cues.length +
        groupBase.se.length +
        groupBase.img.length +
        groupBase.vc.length +
        groupBase.mk.length >
        0
    // 他種の選択を全部解除してから自分を選ぶ（巻き添え削除と、Delete が
    // マーカー削除へ横取りされるのを防ぐ）。個別に列挙すると必ず取りこぼす。
    if (!hasGroup) clearAllSelections()
    // クリックは独立: 動画クリックは動画のみ、音声クリックは音声のみ選択（他方は解除）
    const setThis = track === 'video' ? setSelectedVideoIds : setSelectedAudioIds
    const clearOther = track === 'video' ? setSelectedAudioIds : setSelectedVideoIds
    const selThis = track === 'video' ? selectedVideoIds : selectedAudioIds
    if (!hasGroup) clearOther([])
    // ブラウザ標準の画像/テキストドラッグ（半透明の影＋🚫カーソル）が同時に始まるのを止める
    e.preventDefault()
    const ctrlDown = e.ctrlKey || e.metaKey
    if (!ctrlDown && !hasGroup) setThis([L.seg.id])
    // ドラッグ＝時間方向に移動（プレミア準拠）。修飾キーで動作が変わる:
    //   そのまま = 上書き移動 / Alt = 複製 / Ctrl = 割り込み（後続が後ろへずれる）
    //
    // 以前はここが「配列の並べ替え」で、少し掴んだだけで切片の順序が入れ替わり
    // 再生時に巨大シークを起こしていたため丸ごと無効化されていた。無効のままだと
    // 置いたクリップを一切動かせないので、時間方向の移動として作り直してある
    // （並びは時間順のまま保たれるので、あの事故は起きない）。
    //
    // Ctrl はクリックだけなら従来どおり複数選択のトグル。動かしたときだけ割り込みに
    // なるので、押した瞬間には選択を変えず pointerup まで判定を遅らせている。
    if (mainLocked()) return
    // 空きは「選ぶ／消す」だけ。穴そのものを動かしても意味がないうえ、
    // 動かせると空きが増殖して収拾がつかなくなる。
    if (L.seg.gap) return
    // 掴み始めは動かせるようにしておく（端まで持っていって景色が送られたら、
    // 指は止まったままでも切片は進むべきなので、そのぶん戻す）
    let sx = e.clientX
    let lastEv: PointerEvent | null = null
    const es = startEdgeScroll(scrollRef.current, (dv) => {
      sx -= dv
      if (lastEv) applyMove(lastEv)
    })
    const t0 = L.tStart
    const len = L.tEnd - L.tStart
    const src = srcOfSeg(L.seg)
    // 掴んでいる間は切片の並びが変わらないので、位置の計算は最初の1回だけにする
    const dragLayout = layoutSegs(segsRef.current)
    let moved = false
    // 修飾キーの決め事は shared/dragMode（Alt=複製 / Ctrl=割り込み）
    const modeOf = dragModeOf
    const applyMove = (ev: PointerEvent): void => {
      lastEv = ev
      es.track(ev.clientX)
      // 数px の震えで動かさない（クリック＝選択のままにする）
      if (!moved && !movedEnough(ev.clientX - sx)) return
      if (!moved) {
        moved = true
        stopPlayback()
        // Ctrl で掴んでいた場合もここで単独選択に切り替える（選択ごと動かす時は保つ）
        if (!hasGroup) setThis([L.seg.id])
      }
      const nt = snapClipStart(Math.max(0, t0 + (ev.clientX - sx) / zoomRef.current), len)
      const mode = modeOf(ev)
      // 選択ごと動かす: 同じ量だけテロップ/SE/画像/映像レイヤー/マーカーもずらす。
      //
      // 複製(Alt)と割り込み(Ctrl)は「掴んだ1本を差し込む」操作なので、他の選択は
      // 動かさない。ドラッグ中にキーを押し替えたときに置いてきぼりにならないよう、
      // ずらさない場合も「元の位置」を書き戻す（0 でシフトし直す）。
      if (groupBase && hasGroup) {
        const shift = mode === 'move' ? nt - t0 : 0
        const at = (base: { id: number; t: number }[], id: number): number | undefined =>
          base.find((b) => b.id === id)?.t
        if (groupBase.cues.length)
          setCues((prev) =>
            prev.map((c) => {
              const b = at(groupBase.cues, c.id)
              return b === undefined
                ? c
                : { ...c, start: Math.max(0, b + shift), end: Math.max(0, b + shift) + (c.end - c.start) }
            })
          )
        if (groupBase.se.length)
          setSeClips((prev) =>
            prev.map((c) => {
              const b = at(groupBase.se, c.id)
              return b === undefined ? c : { ...c, tStart: Math.max(0, b + shift) }
            })
          )
        if (groupBase.img.length)
          setImgClips((prev) =>
            prev.map((c) => {
              const b = at(groupBase.img, c.id)
              return b === undefined ? c : { ...c, tStart: Math.max(0, b + shift) }
            })
          )
        if (groupBase.vc.length)
          setVClips((prev) =>
            prev.map((c) => {
              const b = at(groupBase.vc, c.id)
              return b === undefined ? c : { ...c, tStart: Math.max(0, b + shift) }
            })
          )
        if (groupBase.mk.length)
          setMarkers((prev) =>
            prev.map((m) => {
              const b = at(groupBase.mk, m.id)
              return b === undefined ? m : { ...m, t: Math.max(0, b + shift) }
            })
          )
      }
      segMoveToRef.current = nt
      segDropModeRef.current = mode
      setVideoGhost({
        t: nt,
        name: src?.name ?? videoName ?? '',
        dur: len,
        insert: mode === 'insert',
        path: src?.path ?? videoPath ?? '',
        track: 'V1',
        moving: true,
        mode
      })
      setDragTip({
        x: ev.clientX,
        y: ev.clientY,
        text:
          (mode === 'copy' ? '複製 ' : mode === 'insert' ? '割り込み ' : '') + formatTime(nt)
      })
      // このまま離すと丸ごと消えるクリップに印を付ける（割り込みは押し出すので対象外）
      //
      // ★掴んでいる間、切片の並びは変わらない。毎回すべての切片の位置を
      //   計算し直すと、クリップが多いほど手が止まる（1000個で1操作75ms）。
      //   掴んだ時点で1回だけ計算して使い回す。
      const next =
        mode === 'insert'
          ? []
          : dragLayout
              .filter(
                (o) =>
                  o.seg.id !== L.seg.id &&
                  !o.seg.gap &&
                  o.tStart >= nt - 1e-6 &&
                  o.tEnd <= nt + len + 1e-6
              )
              .map((o) => o.seg.id)
      // 中身が同じなら配列を作り直さない（同じでも描き直しが起きるため）
      setOverwriteIds((prev) =>
        prev.length === next.length && prev.every((id, i) => id === next[i]) ? prev : next
      )
    }
    // マウスの動きは1フレームに1回へまとめる（クリップが多いほど効く）
    const mover = rafThrottle<PointerEvent>(applyMove)
    const onMove = (ev: PointerEvent): void => mover.run(ev)
    const onUp = (): void => {
      es.stop()
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      mover.flush() // 最後の位置を取りこぼさない
      mover.cancel()
      const nt = segMoveToRef.current
      const mode = segDropModeRef.current
      segMoveToRef.current = null
      segDropModeRef.current = 'move'
      setVideoGhost(null)
      setDragTip(null)
      setSnapLineX(null)
      setOverwriteIds([])
      if (moved && nt !== null) moveSegmentTo(L.seg.id, nt, mode, segGroupIds)
      // 動かさずに離した＝ただのクリック。Ctrl のときだけ複数選択のトグルにする
      else if (!moved && ctrlDown)
        setThis(toggleSelect(selThis, L.seg.id))
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }
  // 切片の端をドラッグしてソース範囲をトリム（左端=イン点、右端=アウト点。縮めた分は復元も可能）
  function onSegTrimStart(L: SegLayout, edge: 'l' | 'r', e: React.PointerEvent): void {
    e.stopPropagation()
    e.preventDefault()
    if (e.button !== 0) return
    if (mainLocked()) return
    stopPlayback()
    const sx = e.clientX
    const s0 = L.seg.srcStart
    const e0 = L.seg.srcEnd
    const baseSegs = segsRef.current // 変化なしで離した場合に参照を戻す（空振りundo防止）
    // トリム上限は「この切片の元動画」の実尺（マルチソースでプレビュー中ソースの尺を誤用しない）
    const ownDur = srcOfSeg(L.seg)?.duration ?? 0
    const srcMax = ownDur > 0 ? ownDur : videoDurationRef.current > 0 ? videoDurationRef.current : e0
    const sp = segSpeed(L.seg) // 速度クリップ: 画面上の移動量(タイムライン秒)→ソース秒 に変換
    const oldTEnd = L.tEnd // トリム前のこのクリップの終端（後続シフトの境界）
    const applyTrim = (ev: PointerEvent): void => {
      // マグネット: 画面上の位置で吸着させてから、ソース秒の移動量に変換する
      // （他のクリップと同じ操作感にする。従来はここだけ吸着しなかった）
      const rawT = edge === 'l' ? L.tStart + (ev.clientX - sx) / zoomRef.current : oldTEnd + (ev.clientX - sx) / zoomRef.current
      const snapped = snapTime(rawT)
      const dt = (snapped - (edge === 'l' ? L.tStart : oldTEnd)) * sp
      if (edge === 'l') {
        const ns = clamp(s0 + dt, 0, e0 - 0.05)
        setDragTip({
          x: ev.clientX,
          y: ev.clientY,
          text: `イン ${formatTime(ns)} | 長さ ${formatTime(e0 - ns)}`
        })
        setSegments((prev) => prev.map((s) => (s.id === L.seg.id ? { ...s, srcStart: ns } : s)))
      } else {
        const ne = clamp(e0 + dt, s0 + 0.05, srcMax)
        setDragTip({
          x: ev.clientX,
          y: ev.clientY,
          text: `アウト ${formatTime(ne)} | 長さ ${formatTime(ne - s0)}`
        })
        setSegments((prev) => prev.map((s) => (s.id === L.seg.id ? { ...s, srcEnd: ne } : s)))
      }
    }
    // 端をつまむ操作はクリップ一覧そのものを書き換えるので、まとめる効果が大きい
    const trimmer = rafThrottle<PointerEvent>(applyTrim)
    const onMove = (ev: PointerEvent): void => trimmer.run(ev)
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      trimmer.flush() // 最後の位置を取りこぼさない
      trimmer.cancel()
      setDragTip(null)
      setSnapLineX(null)
      // 値が結局変わっていなければ参照を base に戻して履歴の空振りを防ぐ
      const cur = segsRef.current.find((s) => s.id === L.seg.id)
      if (cur && Math.abs(cur.srcStart - s0) < 1e-6 && Math.abs(cur.srcEnd - e0) < 1e-6) {
        setSegments(baseSegs)
        return
      }
      // クリップ長が変わった＝後続が詰まる/伸びるので、テロップ/SE/画像/マーカーも同量シフト
      if (cur) {
        const oldLen = (e0 - s0) / sp
        const newLen = (cur.srcEnd - cur.srcStart) / segSpeed(cur)
        shiftAfter(oldTEnd, newLen - oldLen)
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  return { onSegPointerDown, onSegTrimStart }
}
