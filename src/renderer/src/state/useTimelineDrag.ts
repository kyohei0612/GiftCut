// タイムラインの上で掴む。目盛りを擦る・段をまとめて選ぶ・空きを囲う・
// クリップを動かす・端を摘む。
//
// プレビューの上で掴む話（state/useTelopBox）とは別物。こちらは**時刻と段**が
// 相手で、位置は秒とレーン名で決まる。
//
// ## 掴む前に、入力から手を離させる
//
// 数値欄に打ち込んでいる最中にタイムラインを掴むと、打った値が確定しないまま
// 別の操作が始まる。掴む入口で blur してから始める。
//
// ## クリックと掴みを分ける
//
// 少し動いた時点で初めて「掴んだ」とみなす。押した指の微ジタで選択が
// 外れると、狙った物を選び直すことになる。
//
// ## 段の当たり判定は外から受け取る
//
// 「いま縦のどこか」は state/useLaneGeometry が持つ。ここは受け取るだけ
// （画面のあちこちから同じ問いが飛ぶので、掴む操作の持ち物にはしない）。

import { toggleSelect } from '../../../shared/clipEdit'
import { startEdgeScroll } from '../lib/edgeScroller'
// 重なりの解決。**呼び方は state/cueOverwrite に1つだけ**（貼り付けも同じ所を通る）
import { overwriteOverlapped } from './cueOverwrite'
import { clamp } from '../../../shared/timeline'
import { formatTime, type Cue } from '../lib/srt'
import { type SegLayout } from '../lib/projectTypes'
import { useClipDrag } from './useClipDrag'
import { useDoc } from './contentContext'
import { useNest } from './useNest'
import { useSel } from './selectionContext'
import { useTracksCtx } from './tracksContext'

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface UseTimelineDragDeps {
  /** いまの道具（選択・レザー・トラック選択） */
  tool: any
  duration: number
  /** 段の当たり判定（state/useLaneGeometry） */
  laneAtY: (yRel: number) => string | null
  /** 掴む前に入力欄から手を離させる */
  blurActiveInput: () => void
  stopPlayback: () => void

  /** タイムラインの中身。当たり判定はこの矩形が基準 */
  trackInnerRef: React.RefObject<HTMLDivElement | null>
  scrollRef: React.RefObject<HTMLDivElement | null>
  /** 横の拡大率（px/秒）。掴んでいる最中にも読むので ref */
  zoomRef: React.MutableRefObject<number>
  videoTrackHRef: React.MutableRefObject<number>
  audioTrackHRef: React.MutableRefObject<number>
  padTop: number
  /** 目盛りの高さ。段の上端はここから始まる */
  rulerH: number

  /** 本編の並び（切片の時刻とレーン） */
  segLayout: SegLayout[]
  segLayoutRef: React.MutableRefObject<SegLayout[]>
  v1Index: number
  a1Index: number

  cueTrack: (c: Cue) => string
  telopLocked: (c: Cue) => boolean
  trackNum: (id: string) => number
  vcLen: (c: any) => number
  idCounter: React.MutableRefObject<number>

  /** 掴んでいる最中の見た目 */
  setDragTip: (v: { x: number; y: number; text: string } | null) => void
  setMarquee: any
  setSnapLineX: (v: number | null) => void
  /** 吸い付き先の計算 */
  snapClipStart: any
  snapTime: any
  /** クリックした所の時刻 */
  scrubFromClientX: (clientX: number) => void
  /** 段を用意する／落とし先を覚えておく */
  reserveTrackPairForVideo: (vTrack: string) => string
  /** 一番上より更に上へテロップを運んだときに、映像の段を1本足す */
  addVideoTrack: () => void
  pendingLaneRef: React.MutableRefObject<string | null>
  /** 右クリックの品書きを出す */
  setMenu: any
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function useTimelineDrag(deps: UseTimelineDragDeps) {
  const {
    tool, duration, laneAtY, blurActiveInput, stopPlayback,
    trackInnerRef, scrollRef, zoomRef, videoTrackHRef, audioTrackHRef, padTop, rulerH,
    segLayout, segLayoutRef, v1Index, a1Index,
    cueTrack, telopLocked, trackNum, vcLen, idCounter,
    setDragTip, setMarquee, setSnapLineX, snapClipStart, snapTime,
    scrubFromClientX, reserveTrackPairForVideo, addVideoTrack, pendingLaneRef, setMenu
  } = deps
  const { cues, cuesRef, setCues,  seClips, imgClips, vClips } = useDoc()
  // 「組」の相手（効果音・画像・映像レイヤー）。掴んだ時に控えて、動いた分だけ一緒にずらす
  const { partnersOf, shiftPartners } = useNest()
  const {
    selectedIds, setSelectedIds, setSelectedVideoIds, setSelectedAudioIds,
    setSelectedSeIds, setSelectedImgIds, setSelectedVClipIds,
      setSelectedTrackId, 
    setVideoSelected,  
    // **名前を変えて受けない。** ここは「全部外す」（テロップの選択も消える）。
    // 以前は clearSegSel という名前で受けていたので、読んだ人が
    // 「切片の選択だけ外れる」と誤解し、Ctrl+クリックのまとめ選択が
    // 一度も成立しないまま気づかれなかった。
    isSelected, clearAll
  } = useSel()
  const { tracks, tracksRef } = useTracksCtx()

  function startScrub(e: React.PointerEvent): void {
    blurActiveInput()
    e.preventDefault()
    e.stopPropagation()
    stopPlayback()
    scrubFromClientX(e.clientX)
    // プレミア風: ヘッドを端まで持っていく（画面外含む）とタイムラインが追従スクロール
    // 端まで持っていったら送る。**速さの決め方は shared/edgeScroll に1つ**
    // （掴んだクリップ側も同じ物を使う。別々に書くと手つきが場所で変わる）
    let lastCx = e.clientX
    const es = startEdgeScroll(scrollRef.current, () => scrubFromClientX(lastCx))
    es.track(e.clientX)
    const onMove = (ev: PointerEvent): void => {
      lastCx = ev.clientX
      es.track(ev.clientX)
      scrubFromClientX(ev.clientX)
    }
    const onUp = (): void => {
      es.stop()
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  // ---- トラック選択ツール（プレミア準拠: クリック位置から左/右を全選択）----
  /** 各トラック行の縦位置（trackInner の上端からの相対 px） */
  // 段の縦位置と落とし先の判定は shared/lanes（画面を起動せずに確かめられる）。
  // **外したときに本編へ落とさない**決まりもそこに書いてある

  function trackSelect(e: React.PointerEvent, dir: number): void {
    const inner = trackInnerRef.current
    if (!inner) return
    const rect = inner.getBoundingClientRect()
    const T = (e.clientX - rect.left) / zoomRef.current
    const single = e.shiftKey // Shift = マウスのいるレーンだけ
    const laneId = laneAtY(e.clientY - rect.top)
    const fwd = dir > 0
    const want = (id: string): boolean => !single || laneId === id
    // 右方向=クリップが T より右に伸びている / 左方向=T より左から始まっている
    // **テロップの段を V2・V3 と決め打ちにしない。**
    // 段を足した先（V4以降）に載せたテロップが、この道具で一度も選ばれなかった
    //（本人から「新しく作ったレーンで効かないものが多い」と出ていた物の1つ）。
    // テロップが載れるのは「V1 以外の映像の段」——移動の TELOP_ORDER と同じ決まり。
    const telopLane = (id: string | null): boolean =>
      !!id && id !== 'V1' && tracks.some((t) => t.id === id && t.kind === 'video')
    setSelectedIds(
      !single || telopLane(laneId)
        ? cues
            .filter(
              (c) => (fwd ? c.end > T : c.start < T) && (!single || cueTrack(c) === laneId)
            )
            .map((c) => c.id)
        : []
    )
    const segHit = (L: SegLayout): boolean => (fwd ? L.tEnd > T : L.tStart < T)
    setSelectedVideoIds(want('V1') ? segLayout.filter(segHit).map((L) => L.seg.id) : [])
    setSelectedAudioIds(want('A1') ? segLayout.filter(segHit).map((L) => L.seg.id) : [])
    // SE/BGM・画像は「そのクリップが載っているトラック」で判定（A2決め打ちにしない）
    const clipHit = (c: { tStart: number; duration: number }): boolean =>
      fwd ? c.tStart + c.duration > T : c.tStart < T
    setSelectedSeIds(
      seClips.filter((c) => want(c.track) && clipHit(c)).map((c) => c.id)
    )
    setSelectedImgIds(
      imgClips.filter((c) => want(c.track) && clipHit(c)).map((c) => c.id)
    )
    // 映像レイヤー（映像側の行 or 対の音声側の行を指していれば対象）
    setSelectedVClipIds(
      vClips
        .filter((c) => {
          const len = Math.max(0.05, c.srcEnd - c.srcStart)
          const hit = fwd ? c.tStart + len > T : c.tStart < T
          return hit && (want(c.track) || want('A' + trackNum(c.track)))
        })
        .map((c) => c.id)
    )
  }
  // トラック選択ツール中なら選択して true。各ポインタハンドラの先頭で使う。
  function maybeTrackSelect(e: React.PointerEvent): boolean {
    if (tool !== 'trackFwd' && tool !== 'trackBack') return false
    if (e.button !== 0) return false
    e.stopPropagation()
    e.preventDefault()
    setSelectedTrackId(null)
    setSelectedIds([])
    clearAll()
    trackSelect(e, tool === 'trackFwd' ? 1 : -1)
    return true
  }
  // 効果音・画像・映像クリップの掴み方は state/useClipDrag（決め事は共通なので1か所）
  const { onSePointerDown, onImgPointerDown, onVClipPointerDown } = useClipDrag({
    trackInnerRef,
    scrollRef,
    tool,
    duration,
    laneAtY,
    maybeTrackSelect,
    setDragTip,
    setSnapLineX,
    snapClipStart,
    snapTime,
    reserveTrackPairForVideo,
    pendingLaneRef,
    vcLen
  })


  // 空きトラックのドラッグ = 範囲選択（マーキー）。クリック = 選択解除（プレミア準拠）
  function onTrackAreaPointerDown(e: React.PointerEvent): void {
    blurActiveInput() // キー操作の対象をタイムラインへ戻す
    if (maybeTrackSelect(e)) return
    if (tool !== 'select') return
    if (e.button !== 0) return // 右/中クリックで選択解除・マーキーが始まらないように
    const inner = trackInnerRef.current
    if (!inner) return
    e.preventDefault()
    const rect = inner.getBoundingClientRect()
    const x0 = e.clientX - rect.left
    const y0 = e.clientY - rect.top
    setSelectedTrackId(null)
    setSelectedIds([])
    clearAll()
    setVideoSelected(false) // タイムライン空白クリックで動画リフレーム枠も閉じる
    let dragged = false
    const cuesNow = cues
    const onMove = (ev: PointerEvent): void => {
      const x1 = ev.clientX - rect.left
      const y1 = ev.clientY - rect.top
      if (!dragged && Math.abs(x1 - x0) + Math.abs(y1 - y0) < 4) return
      dragged = true
      setMarquee({ x0, y0, x1, y1 })
      const mx0 = Math.min(x0, x1)
      const mx1 = Math.max(x0, x1)
      const my0 = Math.min(y0, y1)
      const my1 = Math.max(y0, y1)
      const z = zoomRef.current
      // 矩形が縦に重なった行の種類を全部選択（どの方向からでも、テロップも巻き込める）
      // トラック高さが可変なので各行の top/高さを積み上げて判定
      const heights = tracks.map((t) =>
        t.kind === 'video' ? videoTrackHRef.current : audioTrackHRef.current
      )
      const overRow = (idx: number): boolean => {
        let top = rulerH + padTop
        for (let i = 0; i < idx; i++) top += heights[i]
        return my1 >= top && my0 <= top + heights[idx]
      }
      const segIds = segLayoutRef.current
        .filter((L) => L.tEnd * z >= mx0 && L.tStart * z <= mx1)
        .map((L) => L.seg.id)
      // テロップは配置トラック(V2/V3)の行が矩形に掛かっているものを選択
      setSelectedIds(
        cuesNow
          .filter(
            (c) =>
              c.end * z >= mx0 &&
              c.start * z <= mx1 &&
              overRow(tracks.findIndex((t) => t.id === cueTrack(c)))
          )
          .map((c) => c.id)
      )
      setSelectedVideoIds(overRow(v1Index) ? segIds : [])
      setSelectedAudioIds(overRow(a1Index) ? segIds : [])
      // SE/BGM クリップも矩形が掛かった音声行のぶんだけ選択（まとめてDeleteできる）
      setSelectedSeIds(
        seClips
          .filter(
            (c) =>
              (c.tStart + c.duration) * z >= mx0 &&
              c.tStart * z <= mx1 &&
              overRow(tracks.findIndex((t) => t.id === c.track))
          )
          .map((c) => c.id)
      )
      // 画像クリップも同様に
      setSelectedImgIds(
        imgClips
          .filter(
            (c) =>
              (c.tStart + c.duration) * z >= mx0 &&
              c.tStart * z <= mx1 &&
              overRow(tracks.findIndex((t) => t.id === c.track))
          )
          .map((c) => c.id)
      )
      // 映像レイヤーも矩形選択の対象（映像側の行 or 対の音声側の行に掛かっていれば）
      setSelectedVClipIds(
        vClips
          .filter((c) => {
            const len = Math.max(0.05, c.srcEnd - c.srcStart)
            if (!((c.tStart + len) * z >= mx0 && c.tStart * z <= mx1)) return false
            return (
              overRow(tracks.findIndex((t) => t.id === c.track)) ||
              overRow(tracks.findIndex((t) => t.id === 'A' + trackNum(c.track)))
            )
          })
          .map((c) => c.id)
      )
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      setMarquee(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  // クリップの pointerdown（選択・複数まとめてドラッグ・レザー分割）
  function onClipPointerDown(cue: Cue, e: React.PointerEvent): void {
    if (maybeTrackSelect(e)) return
    e.stopPropagation()
    if (e.button !== 0) return // 右/中クリックは contextmenu に任せる
    setSelectedTrackId(null)
    clearAll() // 段・切片・素材ビンの選択を外す（テロップの選択はこの下で作り直す）
    if (telopLocked(cue)) return // このテロップの載っているトラックがロック中は編集不可
    if (tool === 'razor') {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      const t = cue.start + (e.clientX - rect.left) / zoomRef.current
      if (t <= cue.start + 0.05 || t >= cue.end - 0.05) return
      const nid = idCounter.current++ // id は updater の外で確定（StrictMode 二重実行対策）
      setCues((prev) => {
        const rest = prev.filter((c) => c.id !== cue.id)
        const a: Cue = { ...structuredClone(cue), end: t }
        const b: Cue = { ...structuredClone(cue), id: nid, start: t }
        return [...rest, a, b].sort((x, y) => x.start - y.start)
      })
      return
    }
    // Ctrl/Cmd+クリック: 選択トグル（ドラッグしない）
    //
    // **絶対値で上書きする。関数updater を使ってはいけない。**
    // すぐ上の clearAll() が同じバッチで `setSelectedIds([])` を積むので、
    // 関数updater だと空になった後の [] に足すことになり、**何個 Ctrl+クリック
    // しても常に1個だけ**になる（＝まとめ選択が一度も成立しない）。
    // 効果音・画像・映像レイヤーも同じ理由で toggleSelect を使っている。
    if (e.ctrlKey || e.metaKey) {
      setSelectedIds(toggleSelect(selectedIds, cue.id))
      return
    }
    // プレミア準拠: 選択済みクリップを掴んだら選択全体をまとめて移動。
    // 未選択クリップを掴んだらそれだけを選択して移動。選択しても再生ヘッドは動かさない。
    const alreadySel = selectedIds.includes(cue.id)
    const dragIds = alreadySel ? [...selectedIds] : [cue.id]
    if (!alreadySel) setSelectedIds([cue.id])
    const partners = partnersOf('cue', dragIds)
    // テロップ配置可能トラック（下→上）。上下ドラッグでこの間を移動できる。
    // テロップは V1 以外の全映像トラックに置ける（V4以降へ退避したテロップも扱えるように）。
    //
    // **掴んでいる最中に読み直す。** 一番上より更に上へ持っていくと段を1本足すので、
    // 掴んだ時の並びのままでは、足した段が使えない（＝足しても行けない）。
    // 足しても**既にある段の番号は動かない**（足した段は reverse で末尾に付く）ので、
    // 掴んだ物の位置 grabbedIdx はそのまま使える。動くのは行番号（下へ1つずれる）だけ。
    const telopOrder = (): string[] =>
      tracksRef.current
        .filter((t) => t.kind === 'video' && t.id !== 'V1')
        .map((t) => t.id)
        .reverse()
    /** 各テロップ行の実際の行番号（V4等の追加レーンで行がずれても正しく対応させる） */
    const telopRows = (order: string[]): number[] =>
      order.map((id) => tracksRef.current.findIndex((t) => t.id === id))
    const startMap = new Map(
      cues
        .filter((c) => dragIds.includes(c.id))
        .map((c) => [c.id, { s: c.start, e: c.end, tr: cueTrack(c) }])
    )
    const grabbed = startMap.get(cue.id)
    if (!grabbed) return
    const grabbedIdx = Math.max(0, telopOrder().indexOf(grabbed.tr))
    const minStart = Math.min(...[...startMap.values()].map((v) => v.s))
    // **動かしている束の全体**（左端〜右端）で吸い付ける。掴んだ1つの頭だけを
    // 見ていると、束の左端も右端もどこにも合わない。1つだけ選んでいるときも
    // 同じ道を通る＝そのテロップのケツにも効く（前は頭しか見ていなかった）。
    const maxEnd = Math.max(...[...startMap.values()].map((v) => v.e))
    const spanLen = maxEnd - minStart
    const innerRect = trackInnerRef.current?.getBoundingClientRect()
    // **掴み始めの位置は動かせるようにしておく（let）。**
    // 端まで持っていって景色の方が送られたとき、指は動いていないのに
    // 物は進むべきなので、掴み始めをそのぶん戻す（lib/edgeScroller の言うとおり）
    let sx = e.clientX
    const sy = e.clientY
    let moved = false
    let addedLane = false
    let lastEv: PointerEvent | null = null
    const es = startEdgeScroll(scrollRef.current, (dv) => {
      sx -= dv
      if (lastEv) onMove(lastEv)
    })
    const onMove = (ev: PointerEvent): void => {
      lastEv = ev
      es.track(ev.clientX)
      const dxPx = ev.clientX - sx
      const dyPx = ev.clientY - sy
      // 横=時間, 縦=トラック移動。どちらかがしきい値を超えたらドラッグ開始
      if (!moved && Math.abs(dxPx) + Math.abs(dyPx) < 3) return
      moved = true
      // 束の左端を基準に寄せる。**元の位置（左端・右端）も寄せ先に足す**——
      // 上下の段へ移すだけのつもりでも、横に少し動くと近くの端に吸い付いて
      // 横位置がずれる。元の位置があれば、そこへ戻ってくる。
      const raw = minStart + dxPx / zoomRef.current
      let delta = snapClipStart(raw, spanLen, [], [], [], {
        cues: dragIds,
        extra: [minStart, maxEnd]
      }) - minStart
      if (minStart + delta < 0) delta = -minStart
      // 掴んだクリップがどのテロップ行に来たか → 相対トラックシフト量
      // （追加レーンでテロップ行の位置がずれても、実際の行番号に最も近いテロップ行へ吸着）
      const order = telopOrder()
      const rows = telopRows(order)
      let trackShift = 0
      if (innerRect) {
        const yRel = ev.clientY - innerRect.top - rulerH - padTop
        const row = Math.floor(yRel / videoTrackHRef.current)
        // **一番上より更に上へ持っていったら、段を1本足す。**
        // 無い段へは動かせないので、それまでは一番上で頭打ちになり、
        // 「上へ運びたいのに行けない」状態だった。
        //
        // 足すのは**1回の掴みにつき1本まで**。足した瞬間に行が1つ下へずれて
        // 「もう一番上ではない」状態になるので普通は止まるが、掴み損ねて画面の外まで
        // 走らせたときに段が増え続けるのだけは避ける（増えた段は手で消すしかない）。
        if (!addedLane && row < Math.min(...rows)) {
          addedLane = true
          addVideoTrack()
          return // 次の pointermove で、増えた段を入れて並べ直す
        }
        let ti = grabbedIdx
        let best = Infinity
        rows.forEach((r, i) => {
          const d = Math.abs(r - row)
          if (d < best) {
            best = d
            ti = i
          }
        })
        trackShift = ti - grabbedIdx
      }
      shiftPartners(partners, delta) // 組の相手（効果音・画像・映像レイヤー）も一緒に
      setCues((prev) =>
        prev.map((c) => {
          const st = startMap.get(c.id)
          if (!st) return c
          const idx = Math.max(0, order.indexOf(st.tr))
          const ntr = order[clamp(idx + trackShift, 0, order.length - 1)]
          return { ...c, start: st.s + delta, end: st.e + delta, track: ntr }
        })
      )
      setDragTip({ x: ev.clientX, y: ev.clientY, text: formatTime(Math.max(0, grabbed.s + delta)) })
    }
    const onUp = (): void => {
      es.stop()
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      setSnapLineX(null)
      setDragTip(null)
      // ドラッグせずクリックのみ → そのクリップ単体を選択（プレミア準拠）
      if (!moved && alreadySel) setSelectedIds([cue.id])
      // 落としたら、同じ段で重なった分は**置いた側が勝つ**（プレミアの上書き）。
      // 動画クリップは元からそうなっているのに、テロップだけ重なったまま残っていた。
      if (moved) overwriteOverlappedCues(dragIds)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  /**
   * 落とした先で重なったテロップを、**置いた側を勝たせて**削る（プレミアの上書き）。
   *
   * 動画クリップは元から上書きされるのに、テロップだけ重なったまま残っていた
   * （画面では前後に重なって見えるだけで、どちらが出ているのか分からない）。
   *
   * ## 新しい id は updater の外で決める
   *
   * 真ん中を抜かれたテロップは2つに割れるので、片方に新しい id が要る。
   * setState の updater の中で `idCounter.current++` を回すと、
   * StrictMode の2回走りで番号が飛ぶ・ずれる。**ここで作りきって、
   * 出来上がった配列を絶対値で入れる。**
   *
   * ## 中身は shared/overwrite の overwriteCues
   *
   * 削りすぎれば文字が消え、削り足りなければ重なったまま残る。
   * **判定（subtractRanges）だけを分けていたが、それを束ねる所がここに残っていて、
   * 一番怖い「最終的にどう並ぶか」だけがアプリを起動しないと見られなかった。**
   * 組み立てごと向こうへ移し、ここは採番を預けて呼ぶだけにした（2026-08-03）。
   */
  function overwriteOverlappedCues(winnerIds: number[]): void {
    // 呼び方（採番を updater の外でやる・structuredClone で写す）は
    // state/cueOverwrite に1つだけ。**貼り付けも同じ所を通る**
    const next = overwriteOverlapped(cuesRef.current, winnerIds, cueTrack, idCounter)
    if (next) setCues(next)
  }

  function onClipContextMenu(cue: Cue, e: React.MouseEvent): void {
    e.preventDefault()
    e.stopPropagation()
    if (!isSelected(cue.id)) setSelectedIds([cue.id])
    setMenu({ x: e.clientX, y: e.clientY, cueId: cue.id })
  }

  // クリップ端のトリム（イン/アウト調整＋時間ツールチップ）
  // 注意: snapTime/setDragTip は setState の updater 内で呼ばない（updater は純粋関数であること）
  function onTrimStart(cue: Cue, edge: 'l' | 'r', e: React.PointerEvent): void {
    e.stopPropagation()
    e.preventDefault()
    if (e.button !== 0) return
    if (telopLocked(cue)) return
    const inner = trackInnerRef.current
    if (!inner) return
    const rect = inner.getBoundingClientRect()
    const fixedStart = cue.start // 反対側の端はドラッグ開始時の値で固定
    const fixedEnd = cue.end
    // 最後に置いた端。**離したときに「本当に長さが変わったか」を見るのに使う**
    //（掴んだだけで離したときに上書きを走らせない）
    let now = { start: cue.start, end: cue.end }
    const onMove = (ev: PointerEvent): void => {
      const t = (ev.clientX - rect.left) / zoomRef.current
      if (edge === 'l') {
        const ns = Math.max(0, Math.min(snapTime(t, [cue.id]), fixedEnd - 0.1))
        setDragTip({
          x: ev.clientX,
          y: ev.clientY,
          text: `イン ${formatTime(ns)} | 長さ ${formatTime(fixedEnd - ns)}`
        })
        now = { start: ns, end: fixedEnd }
        setCues((prev) => prev.map((c) => (c.id === cue.id ? { ...c, start: ns } : c)))
      } else {
        const ne = Math.max(snapTime(t, [cue.id]), fixedStart + 0.1)
        setDragTip({
          x: ev.clientX,
          y: ev.clientY,
          text: `アウト ${formatTime(ne)} | 長さ ${formatTime(ne - fixedStart)}`
        })
        now = { start: fixedStart, end: ne }
        setCues((prev) => prev.map((c) => (c.id === cue.id ? { ...c, end: ne } : c)))
      }
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      setSnapLineX(null)
      setDragTip(null)
      // **端を伸ばして重なった分も、伸ばした側が勝つ。**
      //
      // 落として重ねたとき（上の onUp）は 2026-08-02 からそうなっていたが、
      // **端をつまんで伸ばす道はここを通っていなかった**ので、伸ばすと
      // 隣のテロップに重なったまま残っていた（同じ決まりが片方だけ、の型）。
      // 判定も組み立ても shared/overwrite の overwriteCues をそのまま通すので、
      // 「どう並ぶか」の式はここに1つも増えていない。
      //
      // 掴んだだけで離したときは走らせない（長さが変わっていなければ何もしない）。
      // ※ **この呼び出しを外すと本当に赤くなることを確かめてある**（2026-08-03）。
      //   e2e「テロップの端を伸ばして重ねても、伸ばした側が勝つ」が
      //   `伸ばしても2つ目が短くなっていない（188 → 188px）` で落ちる。
      if (now.start !== cue.start || now.end !== cue.end) overwriteOverlappedCues([cue.id])
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }
  return {
    startScrub,
    maybeTrackSelect,
    onTrackAreaPointerDown,
    onClipPointerDown,
    onClipContextMenu,
    onTrimStart,
    onSePointerDown,
    onImgPointerDown,
    onVClipPointerDown
  }
}
