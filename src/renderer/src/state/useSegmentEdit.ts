// 本編（V1）の切片そのものを編集する。切る・消す・複製する・速度・回転。
//
// ## 「切片」は隙間なく連続する
//
// 本編は切片の列で、間を空けられない（空けたいときは**空き**という切片を挟む）。
// だから消すときは「詰める」か「空きに置き換える」かのどちらかになる。
//
// ## 詰めるときは、載っている物も一緒に
//
// 映像だけ詰めると、テロップ・効果音・画像・目印が置き去りになる。
// 時刻の付け替えは **state/useContentShift の `mapContentTimes`** に1つだけ。
// ここはそれを**借りる**（持ち出さない）。
//
// ## なぜ state/useTimelineEdit から出したか（2026-08-04）
//
// あちらは959行あり、「切り口が見つからなかった」と書いてあったが
// **測っていなかった**。土台（`useContentShift`）を先に出したあとで測ったら、
// この群は **受け取る7・返す0**——しかも受け取る7つは**全部 import**で、
// 局所の名前は1つも要らなかった（`引き継ぎ-心臓の分け直し.md`）。
//
// ## 中身
//
// - `useSegmentEdit` … 下をまとめて返す唯一の入口
// - `razorSegment` … 切片を指定位置で2つに割る（レザー）
// - `rippleDeleteVideoSegments` … 切片を消して後ろを詰める
// - `toggleBlankSelectedVideo` … 映像だけ消す／戻す（音と長さは残す）
// - `duplicateSelectedSegments` … 切片を複製する
// - `setSelectedSegSpeed` … 再生速度を変える。**後ろも同量ずらして同期を保つ**
// - `setSegRotate` … 切片の回転角を直接指定する（自由回転のつまみ用）
// - `deleteVideoSegmentsLeavingGap` … 切片を消して**空白を残す**（詰めない）
// - `splitVideoAtPlayhead` … 再生ヘッドで本編を割る
import { clamp, layoutSegs, qFrame, segTLen, tidyGaps, tToSource } from '../../../shared/timeline'
import type { SegOps } from '../../../shared/timeline'
import type { SegLayout, VSeg } from '../lib/projectTypes'
import { useDoc } from './contentContext'
import { useSel } from './selectionContext'
import { useTracksCtx } from './tracksContext'
import { usePlaybackCtx } from './playbackContext'

export interface UseSegmentEditDeps {
  /** 本編（V1）に鍵が掛かっているか */
  mainLocked: () => boolean
  makeGapSeg: (len: number) => VSeg
  segOps: SegOps<VSeg>
  segLayoutRef: React.MutableRefObject<SegLayout[]>
  /** 境目より後ろを、種類を跨いでまとめてずらす */
  shiftAfter: (boundaryT: number, delta: number) => void
  /**
  /** 5種類まとめて時刻を付け替える（同じく state/useContentShift の物を借りる） */
  mapContentTimes: (at: (t: number) => number) => void
  /** 再生ヘッドが枠の外なら見える所へ連れてくる */
  revealPlayhead: () => void
  setTime: (t: number) => void
  stopPlayback: () => void
}

export function useSegmentEdit(deps: UseSegmentEditDeps) {
  const {
    mainLocked, makeGapSeg, segOps, segLayoutRef,
    shiftAfter, mapContentTimes, revealPlayhead, setTime, stopPlayback
  } = deps
  const { segments, setSegments, segsRef, segIdCounter } = useDoc()
  const {
    selectedVideoIds, selectedAudioIds, setSelectedVideoIds, setSelectedAudioIds,
    selectedTrans, setSelectedTrans, isVideoSel, clearSegSel
  } = useSel()
  const { trackStates } = useTracksCtx()
  const { currentTimeRef, durationRef, fpsRef } = usePlaybackCtx()

  // ---- 動画セグメント編集 ----
  // ソース時間 atSrc で切片を2つに分割
  function razorSegment(seg: VSeg, atSrc: number): void {
    if (mainLocked()) return
    if (atSrc <= seg.srcStart + 0.03 || atSrc >= seg.srcEnd - 0.03) return
    const nid = segIdCounter.current++
    // 尻/間のトランジションは右半分へ移るので、その帯を選択中なら選択も付け替える
    // （放置すると右パネルが空になり Delete も無反応になる）
    if (selectedTrans?.segId === seg.id)
      setSelectedTrans(
        selectedTrans.kind === 'in' ? selectedTrans : { segId: nid, kind: selectedTrans.kind }
      )
    setSegments((prev) => {
      const out: VSeg[] = []
      for (const s of prev) {
        if (s.id === seg.id) {
          // 境界属性は分割で正しい端へ寄せる: 頭のtransIn/afadeInは左に残し、
          // 尻のtransOut/afadeOut と 次クリップへのxfade は右半分（新しい尻）へ移す。
          // その他のプロパティ（srcId/色調整/回転/ズーム/クロップ/音量等）は両半分に引き継ぐ。
          out.push({ ...s, srcEnd: atSrc, transOut: undefined, xfade: undefined, afadeOut: undefined })
          out.push({ ...s, id: nid, srcStart: atSrc, transIn: undefined, afadeIn: undefined })
        } else out.push(s)
      }
      return out
    })
  }

  function rippleDeleteVideoSegments(): void {
    if (mainLocked()) return
    const ids = new Set([...selectedVideoIds, ...selectedAudioIds])
    if (!ids.size) return
    let tAcc = 0
    const removals: { from: number; gap: number }[] = []
    for (const s of segments) {
      const len = segTLen(s)
      if (ids.has(s.id)) removals.push({ from: tAcc, gap: len })
      tAcc += len
    }
    removals.sort((a, b) => b.from - a.from) // 降順（先に後方の区間を詰める）
    // 消した中で一番手前。詰めたあとの「消した場所」＝次に見たい所
    const holeStart = removals.length ? Math.min(...removals.map((r) => r.from)) : null
    setSegments((prev) => {
      // 消す切片の左隣に付いていた「間ディゾルブ」は、そのまま残すと別の2クリップ間で
      // 勝手に復活してしまうので掃除する。右隣の頭トランジションも同様。
      const out: VSeg[] = []
      for (let i = 0; i < prev.length; i++) {
        const cur = prev[i]
        if (ids.has(cur.id)) continue
        let g = cur
        if (i + 1 < prev.length && ids.has(prev[i + 1].id) && g.xfade) g = { ...g, xfade: undefined }
        if (i > 0 && ids.has(prev[i - 1].id) && g.transIn) g = { ...g, transIn: undefined }
        out.push(g)
      }
      return out
    })
    // 区間より後ろは詰める／区間の中にあったものは区間の頭へ寄せて、極短になったら消す
    // （「消したシーンの字幕が次のシーンに乗り移る」のを防ぐ）
    const clampT = (t: number): number => {
      let v = t
      for (const r of removals) {
        if (v >= r.from + r.gap) v -= r.gap
        else if (v > r.from) v = r.from
      }
      return v
    }
    // 除去区間の中に居た物は、区間の頭へ寄せる（映像との同期を保つ）
    mapContentTimes(clampT)
    // 消した所へ再生ヘッドを寄せる（Q/W のリップルトリムと同じ扱いに揃える）
    if (holeStart != null) {
      setTime(clamp(holeStart, 0, durationRef.current))
      // 上と同じ（詰めた先が枠の外なら見せる）
      requestAnimationFrame(revealPlayhead)
    }
    clearSegSel()
  }
  // 選択中の動画切片を「黒ブランク」にトグル（長さ維持＝詰めない。Deleteの既定動作）
  function toggleBlankSelectedVideo(): void {
    if (!selectedVideoIds.length || trackStates['V1']?.locked) return
    const allBlank = segments.filter((s) => isVideoSel(s.id)).every((s) => s.videoBlank)
    setSegments((prev) =>
      prev.map((s) => (isVideoSel(s.id) ? { ...s, videoBlank: !allBlank } : s))
    )
  }

  function duplicateSelectedSegments(): void {
    if (!selectedVideoIds.length || trackStates['V1']?.locked) return
    stopPlayback()
    const idMap = new Map(selectedVideoIds.map((id) => [id, segIdCounter.current++]))
    setSegments((prev) => {
      const out: VSeg[] = []
      for (const s of prev) {
        if (isVideoSel(s.id)) {
          // 複製は「元→コピー」が直後に挿入されるので、尻の境界属性(transOut/xfade)は
          // コピー側（＝元が接していた次クリップに今接する方）へ移す。元は頭のtransInを保持。
          // その他のプロパティ（srcId/色調整/回転/ズーム/クロップ/音量等）はコピーにも引き継ぐ
          out.push({ ...s, transOut: undefined, xfade: undefined })
          out.push({ ...s, id: idMap.get(s.id) as number, transIn: undefined })
        } else out.push(s)
      }
      return out
    })
    setSelectedVideoIds([...idMap.values()])
    setSelectedAudioIds([])
    // 複製で伸びたぶん、最後のコピー位置より後ろの素材を後ろへずらす（挿入配置と同じ考え方）
    const lay = layoutSegs(segsRef.current)
    const sel = lay.filter((L) => isVideoSel(L.seg.id))
    if (sel.length) {
      const grow = sel.reduce((a, L) => a + L.len, 0)
      shiftAfter(sel[sel.length - 1].tEnd, grow)
    }
  }
  // 選択中の動画切片に再生速度を設定（タイムライン尺・書き出しに反映）
  function setSelectedSegSpeed(speed: number): void {
    if (!selectedVideoIds.length || trackStates['V1']?.locked) return
    stopPlayback()
    // 速度でクリップ長が変わるので、その後ろの素材も同量シフトして同期を保つ
    const lay = layoutSegs(segsRef.current)
    const sel = lay.filter((L) => isVideoSel(L.seg.id))
    const before = sel.reduce((a, L) => a + L.len, 0)
    // **正典（segTLen）に通す。**ここは 2026-08-03 まで同じ式を手書きしていて、
    // 正典にある `Math.max(0, ...)` と `速度が0以下なら等速` が両方抜けていた
    //（速度0で Infinity になり、後ろの素材が消し飛ぶ）。
    const after = sel.reduce((a, L) => a + segTLen({ ...L.seg, speed }), 0)
    setSegments((prev) => prev.map((s) => (isVideoSel(s.id) ? { ...s, speed } : s)))
    if (sel.length) shiftAfter(sel[sel.length - 1].tEnd, after - before)
  }
  // 指定 seg の回転角を直接設定（自由回転ハンドル用）。deg は 0..360 に正規化。
  function setSegRotate(segId: number, deg: number): void {
    const d = ((Math.round(deg) % 360) + 360) % 360
    setSegments((prev) =>
      prev.map((s) => (s.id === segId ? { ...s, rotate: d === 0 ? undefined : d } : s))
    )
  }

  /**
   * 選んでいる本編クリップを消して、そこを「空き」として残す（詰めない）。
   *
   * 後ろのクリップもテロップも位置が動かないので、全体のタイミングを崩さずに
   * 一部だけ抜ける。詰めたいときは F（削除して詰める）を使う。
   */
  function deleteVideoSegmentsLeavingGap(): void {
    if (mainLocked()) return
    const ids = new Set([...selectedVideoIds, ...selectedAudioIds])
    if (!ids.size) return
    const lay = layoutSegs(segsRef.current)
    if (!lay.some((L) => ids.has(L.seg.id))) return
    const next = tidyGaps(
      lay.map((L) => (ids.has(L.seg.id) ? makeGapSeg(L.len) : L.seg)),
      segOps
    )
    setSegments(next)
    clearSegSel()
  }

  // 再生ヘッドで動画を分割（切片版・Ctrl+K が動画選択時）
  function splitVideoAtPlayhead(): void {
    if (mainLocked()) return
    // 分割はフレーム境界で（素材fpsのカット点に揃える）
    const src = tToSource(segLayoutRef.current, qFrame(currentTimeRef.current, fpsRef.current))
    if (!src) return
    const seg = segLayoutRef.current[src.index]?.seg
    if (seg) razorSegment(seg, src.srcTime)
  }

  return {
    razorSegment, rippleDeleteVideoSegments, toggleBlankSelectedVideo,
    duplicateSelectedSegments, setSelectedSegSpeed, setSegRotate,
    deleteVideoSegmentsLeavingGap, splitVideoAtPlayhead
  }
}
