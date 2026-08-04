// 効果音・画像・映像クリップを掴んで動かす。
//
// ## なぜ3つまとめて置くか
//
// **やっていることが同じだから。** 掴む→端なら伸ばす／真ん中なら動かす→
// 縦に振れば段を変える。違うのは「何を書き換えるか」だけ。
//
// バラバラのファイルに置いていた頃は、片方だけ直して片方が置き去りになっていた。
//
// ## **同じ場所に置くだけでは、ズレは止まらなかった**（2026-08-04 に読んで分かった）
//
// ここには「決め事は共通」と書いてあったが、**中で3通りに割れていた**:
//
//   レザーの分け方   効果音 `splitAt` ／ 画像 手書き ／ 映像 手書き
//   右端の伸ばし方   効果音 `trimRight` ／ **画像 手書き**（`Math.max(0.2, …)`） ／ 映像 `trimRight`
//   左端の伸ばし方   効果音 `trimLeft` ／ **画像 手書き**（`clamp`） ／ 映像 `trimLeft`
//
// 頭で「共通」と宣言しても、**中身が3回書いてあれば3通りに育つ**。
// 並べて置くことは、写しを1本にすることの代わりにならない。
//
// ## だから決め事そのものを外へ出した（3か所 → 1か所）
//
//   掴んでから離すまでの段取り  `lib/clipDragLoop` の `startClipDragLoop`
//   落としてよい段か            `shared/lanes` の `canDropOn`
//   束をずらす／段を変える      `shared/clipEdit` の `shiftGroup`
//   端の伸ばし方                `shared/clipEdit` の `trimLeft` / `trimRight`
//
// **この4つは、もうここに書き写せない。** 下の3つが同じ物を呼んでいる形になった
// ので、直せば3種類とも直る（524 → 431行）。
//
// ※ **残っている写し**: レザーの分け方が画像・映像でまだ手書き。効果音の `splitAt` は
//   「元の音のどこから鳴らすか」を持つので、画像（持たない）とは形が違う。
//   寄せるなら先に `splitAt` の受け取る形を見直すこと（`やること.md`）。
//
// ## 受け取っている物
//
// 画面に触る所（タイムラインの実体・吹き出し・吸い付きの縦線）と、
// 位置の計算（吸い付き先）は App 側にある。ここはそれを借りて動く。

import { shiftGroup, splitAt, toggleSelect, trimLeft, trimRight } from '../../../shared/clipEdit'
// 落としてよい段かの判定。**3種類とも同じ物を通す**（前は3回手書きしてあった）
import { canDropOn } from '../../../shared/lanes'
// 掴んでから離すまでの段取り。**同上**
import { startClipDragLoop } from '../lib/clipDragLoop'
import { useDoc } from './contentContext'
import { useSel } from './selectionContext'
import { useTracksCtx } from './tracksContext'
import { useNest } from './useNest'
import { useViewCtx } from './viewContext'
import { clamp } from '../../../shared/timeline'
import { formatTime } from '../lib/srt'
import type { ImgClip, SEClip, VClip } from '../lib/projectTypes'
// **useHistory の Snap と名前がぶつかる**ので別名で受ける
import type { Snap as SnapApi } from './useSnap'

/**
 * まとめて動かす束の、左端と右端。
 *
 * **吸い付ける相手は「掴んだ1つ」ではなく、この範囲。**
 * 掴んだ物の端だけを見ていると、束の左端も右端もどこにも合わない
 * （テロップが実際にそうなっていて「ケツに効かない」と言われた）。
 * 1つだけ掴んでいるときも同じ道を通る＝そのクリップの頭と尻の両方に効く。
 */
function spanOf<T extends { tStart: number }>(
  items: readonly T[],
  lenOf: (c: T) => number
): { start: number; end: number; len: number } {
  const start = Math.min(...items.map((c) => c.tStart))
  const end = Math.max(...items.map((c) => c.tStart + lenOf(c)))
  return { start, end, len: end - start }
}

export interface ClipDragDeps {
  /** タイムラインの中身（座標の基準） */
  trackInnerRef: React.MutableRefObject<HTMLElement | null>
  /** 横に送る入れ物。端まで持っていったときに、ここを送る */
  scrollRef: React.RefObject<HTMLDivElement | null>
  /** いま選んでいる道具（レザーなら分割） */
  tool: string
  /** 全体の長さ（秒） */
  duration: number
  /** その高さにある段 */
  laneAtY: (yRel: number) => string | null
  /** 段の見出しを掴んでいたら、そちらに譲る */
  maybeTrackSelect: (e: React.PointerEvent) => boolean
  /** 掴んでいる間に出す吹き出し */
  setDragTip: (v: { x: number; y: number; text: string } | null) => void
  /** 吸い付いた位置に出す縦線 */
  setSnapLineX: (v: number | null) => void
  /** 端を吸い付ける（頭・尻の両方を見る）。`more` は state/useSnap を見ること */
  /** 形は書き写さず、作っている側（state/useSnap）から引く */
  snapClipStart: SnapApi['snapClipStart']
  /** 時刻を吸い付ける */
  snapTime: SnapApi['snapTime']
  /** 映像クリップを置いた段に、対の音声段を用意する */
  reserveTrackPairForVideo: (track: string) => void
  /** 落とし先の段を覚えておく（離すまで確定しない） */
  pendingLaneRef: React.MutableRefObject<string | null>
  /** その映像クリップの長さ（秒） */
  vcLen: (c: VClip) => number
}

export function useClipDrag(deps: ClipDragDeps) {
  const {
    trackInnerRef,
    scrollRef,
    tool,
    laneAtY,
    maybeTrackSelect,
    setDragTip,
    setSnapLineX,
    snapClipStart,
    snapTime,
    reserveTrackPairForVideo,
    pendingLaneRef,
    vcLen
  } = deps
  const { seClips, setSeClips, seIdCounter, imgClips, setImgClips, imgIdCounter, vClips, setVClips, vClipIdCounter } =
    useDoc()
  const {
    selectedSeIds,
    setSelectedSeIds,
    selectedImgIds,
    setSelectedImgIds,
    selectedVClipIds,
    setSelectedVClipIds,
    setSelectedIds,
    setSelectedTrackId,
    clearSegSel,
    setVideoSelected
  } = useSel()
  const { tracks, trackStates } = useTracksCtx()
  const { zoomRef } = useViewCtx()
  // 「組」の相手（別の種類）。掴んだ時に控えて、動いた分だけ一緒にずらす。
  // **控えるのは掴んだ時だけ**——動かしている最中に読み直すと、
  // 自分がずらした後の位置を新しい起点にしてしまい、じわじわ流れていく
  const { partnersOf, shiftPartners } = useNest()

  // SE クリップ: クリック選択 / ドラッグで時間移動
  function onSePointerDown(clip: SEClip, e: React.PointerEvent, edge?: 'l' | 'r'): void {
    if (maybeTrackSelect(e)) return
    e.stopPropagation()
    if (e.button !== 0) return
    if (trackStates[clip.track]?.locked) return // ロック中トラックは編集不可
    setSelectedTrackId(null)
    setSelectedIds([])
    clearSegSel()
    // レザーツール: クリック位置で分割（動画切片/テロップと同じ操作感）
    if (tool === 'razor' && !edge) {
      const inner0 = trackInnerRef.current
      if (!inner0) return
      const t = (e.clientX - inner0.getBoundingClientRect().left) / zoomRef.current
      if (t <= clip.tStart + 0.05 || t >= clip.tStart + clip.duration - 0.05) return
      // 分け方は shared/clipEdit（元の音のどこから鳴らすかが要点）
      const cut = splitAt(clip, t)
      if (!cut) return
      const nid = seIdCounter.current++
      setSeClips((prev) =>
        prev.flatMap((c) =>
          c.id === clip.id ? [{ ...c, ...cut.left }, { ...c, ...cut.right, id: nid }] : [c]
        )
      )
      setSelectedSeIds([nid])
      return
    }
    // Ctrlクリックで複数選択（他のクリップと同じ操作感）
    if (e.ctrlKey || e.metaKey) {
      // clearSegSel() が同じバッチで [] を積むので、関数updaterではなく絶対値で上書きする
      setSelectedSeIds(toggleSelect(selectedSeIds, clip.id))
      return
    }
    // 既に選択済みのクリップを掴んだら選択全体を動かす（テロップは既にこの挙動）
    const grpIds =
      selectedSeIds.includes(clip.id) && selectedSeIds.length > 1 ? selectedSeIds : [clip.id]
    const grpBase = new Map(
      seClips.filter((c) => grpIds.includes(c.id)).map((c) => [c.id, c.tStart])
    )
    // 吸い付けるのは**束の全体**（左端〜右端）。掴んだ1つだけを見ていると
    // 束の端がどこにも合わない。テロップと同じ決まりにしてある（state/useSnap）
    const grpSpan = spanOf(seClips.filter((c) => grpIds.includes(c.id)), (c) => c.duration)
    setSelectedSeIds(grpIds)
    const partners = partnersOf('se', grpIds)
    const inner = trackInnerRef.current
    const s0 = clip.tStart
    const d0 = clip.duration
    const off0 = clip.srcOffset ?? 0
    // 掴んでいる間の段取り（動き出しの判定・景色送り・後片付け）は
    // lib/clipDragLoop に1つだけ。**3種類とも同じ物を通す**
    const onMove = (dt: number, ev: PointerEvent): void => {
      if (!inner) return
      // 掴んだ時点の姿。動かしている間の途中経過ではなく、ここから測る
      const base = { tStart: s0, duration: d0, srcOffset: off0, srcDur: clip.srcDur }
      if (edge === 'r') {
        // 右端: 長さを変える。**元の音の残りを超えない**（shared/clipEdit）
        const { duration: nd } = trimRight(base, snapTime(s0 + d0 + dt, [], [clip.id]))
        setSeClips((prev) => prev.map((c) => (c.id === clip.id ? { ...c, duration: nd } : c)))
        setDragTip({ x: ev.clientX, y: ev.clientY, text: `長さ ${formatTime(nd)}` })
      } else if (edge === 'l') {
        // 左端: 開始位置と音源内オフセットを同時に動かす（終端は固定）
        const t2 = trimLeft(base, snapTime(s0 + dt, [], [clip.id]))
        setSeClips((prev) => prev.map((c) => (c.id === clip.id ? { ...c, ...t2 } : c)))
        setDragTip({ x: ev.clientX, y: ev.clientY, text: `開始 ${formatTime(t2.tStart)}` })
      } else {
        // マグネット。**束の全体で寄せ、束の仲間は寄せ先から外す**
        //（外さないと、一緒に動いている隣に吸い付いて動けない）。
        // 元の位置も寄せ先に足すので、段だけ変えるときに横へずれない。
        const raw = Math.max(0, grpSpan.start + dt)
        const nt =
          snapClipStart(raw, grpSpan.len, grpIds, [], [], {
            extra: [grpSpan.start, grpSpan.end]
          }) -
          grpSpan.start +
          s0
        // 縦方向で別の音声トラックへ移動（テロップの上下移動と同じ操作感）
        const irect = inner.getBoundingClientRect()
        const lane = laneAtY(ev.clientY - irect.top)
        // 落としてよい段か（種類・本編でない・鍵）。**判定は shared/lanes に1つだけ**
        const laneOk = canDropOn(lane, 'audio', tracks, (id) => !!trackStates[id]?.locked)
        const shift = nt - s0
        shiftPartners(partners, shift) // 組の相手（テロップ・画像・映像レイヤー）も一緒に
        // 束をずらす／**段を変えるのは掴んだ1つだけ**。決まりは shared/clipEdit に1つ
        setSeClips((prev) => shiftGroup(prev, grpIds, grpBase, shift, clip.id, laneOk ? lane : null))
      }
    }
    startClipDragLoop({
      e,
      scrollEl: scrollRef.current,
      zoomRef,
      onMove,
      onEnd: () => {
        setSnapLineX(null)
        setDragTip(null)
      }
    })
  }

  // 画像クリップ: クリック選択 / 本体ドラッグで移動 / 右端ドラッグで長さ変更
  function onImgPointerDown(clip: ImgClip, e: React.PointerEvent, edge?: 'l' | 'r'): void {
    if (maybeTrackSelect(e)) return
    e.stopPropagation()
    if (e.button !== 0) return
    if (trackStates[clip.track]?.locked) return // ロック中トラックは編集不可
    setSelectedTrackId(null)
    setSelectedIds([])
    clearSegSel()
    setVideoSelected(false) // 動画のリフレーム枠は閉じる（枠の対象を画像に切替える）
    // レザー: クリック位置で分割（他のクリップと同じ操作感）
    if (tool === 'razor' && !edge) {
      const inner0 = trackInnerRef.current
      if (!inner0) return
      const t = (e.clientX - inner0.getBoundingClientRect().left) / zoomRef.current
      const nid = imgIdCounter.current++
      const leftLen = t - clip.tStart
      setImgClips((prev) =>
        prev.flatMap((c) =>
          c.id === clip.id
            ? [
                { ...c, duration: leftLen },
                { ...c, id: nid, tStart: t, duration: c.duration - leftLen }
              ]
            : [c]
        )
      )
      setSelectedImgIds([nid])
      return
    }
    // Ctrlクリックで複数選択（動画切片/テロップと同じ操作感）
    if (e.ctrlKey || e.metaKey) {
      setSelectedImgIds(toggleSelect(selectedImgIds, clip.id))
      return
    }
    // 既に選択済みのクリップを掴んだら選択全体を動かす（テロップは既にこの
    // 挙動。以前は選択を1つに潰してから掴んだクリップだけ動かしていたため、
    // 矩形選択で5個選んでも1個しか動かず残りの選択も消えていた）
    const grpIds =
      selectedImgIds.includes(clip.id) && selectedImgIds.length > 1 ? selectedImgIds : [clip.id]
    setSelectedImgIds(grpIds)
    const partners = partnersOf('img', grpIds)
    const grpBase = new Map(
      imgClips.filter((c) => grpIds.includes(c.id)).map((c) => [c.id, c.tStart])
    )
    // 吸い付ける相手は束の全体（上の spanOf）
    const grpSpan = spanOf(imgClips.filter((c) => grpIds.includes(c.id)), (c) => c.duration)
    const s0 = clip.tStart
    const d0 = clip.duration
    // 段取りは lib/clipDragLoop に1つだけ（上と同じ物を通す）
    const onMove = (dt: number, ev: PointerEvent): void => {
      if (edge === 'r') {
        // 右端もスナップ（カット点/他クリップ端に吸着）＋長さツールチップ
        const ne = snapTime(s0 + d0 + dt, [], [], [clip.id])
        const nd = Math.max(0.2, ne - s0)
        setImgClips((prev) => prev.map((c) => (c.id === clip.id ? { ...c, duration: nd } : c)))
        setDragTip({ x: ev.clientX, y: ev.clientY, text: `長さ ${formatTime(nd)}` })
      } else if (edge === 'l') {
        // 左端: 開始を動かしつつ終端を固定（＝長さも同時に変わる）
        const ns = clamp(snapTime(s0 + dt, [], [], [clip.id]), 0, s0 + d0 - 0.2)
        setImgClips((prev) =>
          prev.map((c) => (c.id === clip.id ? { ...c, tStart: ns, duration: s0 + d0 - ns } : c))
        )
        setDragTip({ x: ev.clientX, y: ev.clientY, text: `開始 ${formatTime(ns)}` })
      } else {
        // 束の全体で寄せ、束の仲間は寄せ先から外す（効果音と同じ決まり）
        const raw = Math.max(0, grpSpan.start + dt)
        const nt =
          snapClipStart(raw, grpSpan.len, [], grpIds, [], {
            extra: [grpSpan.start, grpSpan.end]
          }) -
          grpSpan.start +
          s0
        // 縦方向に動かしたら別の映像トラックへ移動（テロップの上下移動と同じ操作感）
        const irect = trackInnerRef.current?.getBoundingClientRect()
        const lane = irect ? laneAtY(ev.clientY - irect.top) : null
        // 落としてよい段か。**判定は shared/lanes に1つだけ**（効果音と同じ物）
        const laneOk = canDropOn(lane, 'video', tracks, (id) => !!trackStates[id]?.locked)
        // 掴んだクリップのずれ量を選択全体に同じだけ適用する
        const shift = nt - s0
        shiftPartners(partners, shift) // 組の相手（テロップ・効果音・映像レイヤー）も一緒に
        // 束をずらす／**段を変えるのは掴んだ1つだけ**。決まりは shared/clipEdit に1つ
        setImgClips((prev) => shiftGroup(prev, grpIds, grpBase, shift, clip.id, laneOk ? lane : null))
      }
    }
    startClipDragLoop({
      e,
      scrollEl: scrollRef.current,
      zoomRef,
      onMove,
      onEnd: () => {
        setSnapLineX(null)
        setDragTip(null)
      }
    })
  }

  // 映像レイヤークリップの操作: 本体ドラッグ=移動 / 左右端=トリム / レザー=分割。
  // 音声側の連動バンドをドラッグしても同じ関数を通す（＝映像と音は必ず一緒に動く）。
  function onVClipPointerDown(clip: VClip, e: React.PointerEvent, edge?: 'l' | 'r'): void {
    if (maybeTrackSelect(e)) return
    e.stopPropagation()
    if (e.button !== 0) return
    if (trackStates[clip.track]?.locked) return
    setSelectedTrackId(null)
    setSelectedIds([])
    clearSegSel()
    setVideoSelected(false)
    if (tool === 'razor' && !edge) {
      const inner0 = trackInnerRef.current
      if (!inner0) return
      const t = (e.clientX - inner0.getBoundingClientRect().left) / zoomRef.current
      if (t <= clip.tStart + 0.05 || t >= clip.tStart + vcLen(clip) - 0.05) return
      const nid = vClipIdCounter.current++
      const cut = clip.srcStart + (t - clip.tStart)
      setVClips((prev) =>
        prev.flatMap((c) =>
          c.id === clip.id
            ? [
                { ...c, srcEnd: cut, afadeOut: undefined },
                { ...c, id: nid, tStart: t, srcStart: cut, afadeIn: undefined }
              ]
            : [c]
        )
      )
      setSelectedVClipIds([nid])
      return
    }
    if (e.ctrlKey || e.metaKey) {
      setSelectedVClipIds(toggleSelect(selectedVClipIds, clip.id))
      return
    }
    // 既に選択済みのクリップを掴んだら選択全体を動かす（テロップは既にこの挙動）
    const grpIds =
      selectedVClipIds.includes(clip.id) && selectedVClipIds.length > 1
        ? selectedVClipIds
        : [clip.id]
    const grpBase = new Map(
      vClips.filter((c) => grpIds.includes(c.id)).map((c) => [c.id, c.tStart])
    )
    // 吸い付ける相手は束の全体（上の spanOf）。長さは「イン点〜アウト点」
    const grpSpan = spanOf(
      vClips.filter((c) => grpIds.includes(c.id)),
      (c) => vcLen(c)
    )
    setSelectedVClipIds(grpIds)
    const partners = partnersOf('vclip', grpIds)
    const t0 = clip.tStart
    const s0 = clip.srcStart
    const e0 = clip.srcEnd
    // 段取りは lib/clipDragLoop に1つだけ（上と同じ物を通す）
    const onMove = (dt: number, ev: PointerEvent): void => {
      // 端の計算は効果音と同じ規則（shared/clipEdit）。
      // **持ち方が違うだけ**——こちらは「元動画のイン点・アウト点」、
      // 向こうは「使い始め＋長さ」。同じ話を2通りに書いていたので、片方へ寄せる。
      const base = {
        tStart: t0,
        duration: e0 - s0,
        srcOffset: s0,
        srcDur: clip.srcDur
      }
      if (edge === 'r') {
        const { duration: nd } = trimRight(base, snapTime(t0 + (e0 - s0) + dt, [], [], [], [clip.id]))
        const ne = s0 + nd
        setVClips((prev) => prev.map((c) => (c.id === clip.id ? { ...c, srcEnd: ne } : c)))
        setDragTip({ x: ev.clientX, y: ev.clientY, text: '長さ ' + formatTime(nd) })
      } else if (edge === 'l') {
        // 左端: 終端を固定して、開始位置と元動画のイン点を同時に動かす
        const t2 = trimLeft(base, snapTime(t0 + dt, [], [], [], [clip.id]))
        setVClips((prev) =>
          prev.map((c) =>
            c.id === clip.id ? { ...c, tStart: t2.tStart, srcStart: t2.srcOffset } : c
          )
        )
        setDragTip({ x: ev.clientX, y: ev.clientY, text: '開始 ' + formatTime(t2.tStart) })
      } else {
        // 束の全体で寄せ、束の仲間は寄せ先から外す（効果音・画像と同じ決まり）
        const nt =
          snapClipStart(Math.max(0, grpSpan.start + dt), grpSpan.len, [], [], grpIds, {
            extra: [grpSpan.start, grpSpan.end]
          }) -
          grpSpan.start +
          t0
        // 縦方向で別の映像トラックへ移動（V1は切片専用なので不可）
        const irect = trackInnerRef.current?.getBoundingClientRect()
        const lane = irect ? laneAtY(ev.clientY - irect.top) : null
        const laneOk = canDropOn(lane, 'video', tracks, (id) => !!trackStates[id]?.locked)
        // ここではトラックを作らない。以前はポインタが動くたびに確保していたため、
        // ドラッグ中にトラックが次々増えて画面が上へ暴走していた。
        // 実際に移す時（指を離した時）にまとめて確保する。
        if (laneOk && lane !== clip.track) pendingLaneRef.current = lane
        const shift = nt - t0
        shiftPartners(partners, shift) // 組の相手（テロップ・効果音・画像）も一緒に
        // 束をずらす／**段を変えるのは掴んだ1つだけ**。決まりは shared/clipEdit に1つ
        setVClips((prev) => shiftGroup(prev, grpIds, grpBase, shift, clip.id, laneOk ? lane : null))
      }
    }
    startClipDragLoop({
      e,
      scrollEl: scrollRef.current,
      zoomRef,
      onMove,
      onEnd: () => {
        setDragTip(null)
        // 移し終えた時にだけ、対の音声トラックを確保する
        // （確保しないと A{n} が無く無音になり、音声の帯も消える）
        const lane = pendingLaneRef.current
        pendingLaneRef.current = null
        if (lane) reserveTrackPairForVideo(lane)
      }
    })
  }
  return { onSePointerDown, onImgPointerDown, onVClipPointerDown }
}
