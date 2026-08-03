// 消す・切る・複製する・詰める。**タイムラインを縮める側の操作**をまとめてある。
//
// ## 「消す」と「詰める」は別物
//
// 消す（Delete）… その物だけ消える。後ろは動かない。空いた所は空白になる。
// 詰める（リップル）… 消したぶん後ろが前へ寄る。**種類を跨いで全部**寄る。
//
// 詰めるときにずらす相手は5種類ある（テロップ・効果音・画像・目印・映像レイヤー）。
// 1つ忘れると、そこだけ置き去りになって「切って詰めたのに文字だけ残る」になる。
//
// ## 空白（gap）は消さずに残す
//
// クリップを動かしてできた隙間は、帯こそ描かないが**当たり判定は残す**。
// 消してしまうとクリックで選べず、Delete で詰める導線に到達できない。
//
// ## 鍵の掛かった段は触らない
//
// どの操作でも同じ。ここを揃えておかないと「キーでは消えるのにボタンでは消えない」
// のような食い違いが出る。
//
// ## 判定そのものは shared 側
//
// どこで切るか（silenceCut）・どう詰めるか（ripple）・切片の分け方（timeline）は
// 画面を起動せずに確かめられるように分けてある。こちらの仕事は
// 「選んでいる物を集めて、鍵を見て、呼ぶ」まで。
//
// ## なぜ 896 行のままなのか（2026-08-03 に測った）
//
// 話題は1つ（縮める側の操作）で、**切り口を探したが見つからなかった**:
//
//   `mapContentTimes`（5種類まとめて時刻を付け替える）が**群をまたいで
//   使われている**——無音カット・映像切片の削除・カットまで詰める・
//   再生ヘッドで切る、の4か所。ここが心臓なので、どこで切っても導管になる。
//
// だから割らずに、下の**取説**を付けた（`shared/readability.test.ts` が
// 名前を照合するので、引っ越して説明だけ残すことはできない）。
// **割るなら `mapContentTimes` の置き場を先に決めること。**
//
// ## 中身
//
// - `useTimelineEdit` … 下をまとめて返す唯一の入口
// - `deleteSelected` … 選んだテロップを消す（後ろは動かない）
// - `rippleDeleteSelected` … 消して後ろを詰める（**種類を跨いで全部**）
// - `cutSelected` … 切り取り（コピーしてから消す）
// - `regroupCopies` … 複製した物の「組」を振り直す（元の組と混ざらないように）
// - `duplicateSelected` … テロップを複製する
// - `razorSegment` … 切片を指定位置で2つに割る（レザー）
// - `deleteSelectedSE` … 選んだ効果音を消す
// - `findSilences` … 無音の区間を探す（ダッキングと無音カットの下ごしらえ）
// - `applySilenceCut` … 見つけた無音を実際に落として詰める
// - `rippleDeleteVideoSegments` … 本編の切片を消して後ろを詰める
// - `toggleBlankSelectedVideo` … 映像だけ消す／戻す（音と長さは残す）
// - `duplicateClipsFromMenu` … 右クリックからの複製（種類ごと）
// - `duplicateSelectedSegments` … 本編の切片を複製する
// - `setSelectedSegSpeed` … 再生速度を変える。**後ろも同量ずらして同期を保つ**
// - `setSegRotate` … 切片の回転角を直接指定する（自由回転のつまみ用）
// - `closeGapAtPlayhead` … 再生ヘッドの所の空白を詰める
// - `deleteVideoSegmentsLeavingGap` … 切片を消して**空白を残す**（詰めない）
// - `closeSelectedGaps` … 選んだ空白をまとめて詰める
// - `closeGap` … 空白1つを詰める（上の2つの実体）
// - `allContentEdges` … 本編に載っている物の端の時刻を全部集める
// - `mapContentTimes` … **5種類まとめて**時刻を付け替える。**このファイルの心臓**
// - `collapseContent` … ある区間を捨てて後ろを詰める（`mapContentTimes` を使う）
// - `rippleToPrevCut` … 前のカットまで詰める（途中に端があればそこで止まる）
// - `rippleToNextCut` … 次のカットまで詰める
// - `splitVideoAtPlayhead` … 再生ヘッドで本編を割る
// - `cutAtPlayhead` … 再生ヘッドで、載っている物も含めて切る

import {
  clamp, layoutSegs, qFrame, rippleEnd, rippleShifted, rippleStart,
  segSpeed, segTLen, tidyGaps, tToSource
} from '../../../shared/timeline'
import { nextGroupId, remapGroups } from '../../../shared/group'
import { collapseAt } from '../../../shared/ripple'
import { shouldCut, spansCut } from '../../../shared/cutScope'
import { totalCutLen } from '../../../shared/silenceCut'
// 重なりの解決。**呼び方は state/cueOverwrite に1つだけ**（掴む側・貼り付けも同じ）
import { overwriteOverlapped } from './cueOverwrite'
import type { Cue } from '../lib/srt'
import type { ImgClip, SEClip, VClip, VSeg } from '../lib/projectTypes'
import type { SegLayout } from '../lib/projectTypes'
import type { SegOps } from '../../../shared/timeline'
import type { CutRange } from '../../../shared/silenceCut'
import type { SilenceCutState } from '../components/dialogs/AudioDialogs'
import { useDoc } from './contentContext'
import { useMediaCtx } from './mediaContext'
import { useSel } from './selectionContext'
import { useTracksCtx } from './tracksContext'
import { useToastCtx } from './toastContext'
import { usePlaybackCtx } from './playbackContext'

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface UseTimelineEditDeps {
  /** つなぎ目の演出のうち、どこにも掛からなくなった物を捨てる */
  cleanupOrphanTrans: (list: VSeg[], removedIds: Set<number>) => VSeg[]
  /** まだ確定していない変更を、履歴へ積んでしまう（消す前に必ず呼ぶ） */
  commitPending: () => void
  copySelected: () => void
  cueTrack: (c: Cue) => string
  cutRangeFromSegs: (segs: VSeg[], tA: number, tB: number) => { out: VSeg[]; insertAt: number }
  deleteSelectedImg: () => void
  deleteSelectedVClip: () => void
  idCounter: React.MutableRefObject<number>
  /** 本編（V1）に鍵が掛かっているか */
  mainLocked: () => boolean
  makeGapSeg: (len: number) => VSeg
  seekTo: (t: number) => void
  /**
   * 再生ヘッドが枠の外なら、見える所へ連れてくる（見えているときは何もしない）。
   * リップル削除で詰めたあと、ヘッドだけ画面の外へ飛ぶことがある。
   */
  revealPlayhead: () => void
  /** **形は SegLayout を指す**（前はここに書き写してあり、あちらを直しても古いままになる形だった） */
  segLayoutRef: React.MutableRefObject<SegLayout[]>
  segOps: SegOps<VSeg>
  /** 無音カットの下ごしらえの状態（探している最中か・見つかった所） */
  silenceCut: SilenceCutState
  setSilenceCut: React.Dispatch<React.SetStateAction<SilenceCutState>>
  setSilenceOpen: (v: boolean) => void
  setTime: (t: number) => void
  /** 境目より後ろを、種類を跨いでまとめてずらす */
  shiftAfter: (boundaryT: number, delta: number) => void
  silenceCuts: CutRange[]
  stopPlayback: () => void
  telopLocked: (c: Cue) => boolean
  vcLen: (c: VClip) => number
  videoRef: React.MutableRefObject<HTMLVideoElement | null>
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function useTimelineEdit(deps: UseTimelineEditDeps) {
  const {
    cleanupOrphanTrans, commitPending, copySelected, cueTrack, cutRangeFromSegs,
    deleteSelectedImg, deleteSelectedVClip, idCounter, mainLocked, makeGapSeg,
    seekTo, revealPlayhead, segLayoutRef, segOps, setSilenceCut, setSilenceOpen, setTime,
    shiftAfter, silenceCut, silenceCuts, stopPlayback, telopLocked, vcLen, videoRef
  } = deps
  const {
    cues, setCues, cuesRef, segments, setSegments, segsRef, segIdCounter,
    seClips, setSeClips, seClipsRef, seIdCounter, imgClips, setImgClips, imgClipsRef,
    imgIdCounter, vClips, setVClips, vClipsRef, vClipIdCounter, setMarkers
  } = useDoc()
  const {
    selectedIds, setSelectedIds, selectedVideoIds, setSelectedVideoIds,
    selectedAudioIds, setSelectedAudioIds, selectedSeIds, setSelectedSeIds,
    selectedImgIds, setSelectedImgIds, selectedVClipIds, setSelectedVClipIds,
    selectedTrans, setSelectedTrans, isSelected, isVideoSel, clearSegSel,
    clearAll: clearAllSelections
  } = useSel()
  const { trackStates } = useTracksCtx()
  const { showToast } = useToastCtx()
  const { currentTimeRef, durationRef, fpsRef } = usePlaybackCtx()
  const { sources, videoPath } = useMediaCtx()

  function deleteSelected(): void {
    if (!selectedIds.length) return
    // ロック中トラックのテロップは残す（実トラック単位で判定）
    setCues((prev) => prev.filter((c) => !isSelected(c.id) || telopLocked(c)))
    setSelectedIds([])
  }
  /**
   * リップル削除（詰める）。選択中のテロップ・SE/BGM・画像・映像レイヤーを消し、
   * **消したクリップと同じトラックの後続だけ**を、その長さぶん前へ詰める。
   *
   * 以前はテロップ専用で、しかもトラックを見ずに全テロップを詰めていた。
   * SE や画像を消しても後続が詰まらず、V2 のテロップを消すと V3 のテロップまで
   * ずれる、という2つの食い違いがあった。
   *
   * 本編（V1/A1）の切片は別物（rippleDeleteVideoSegments が全レーン同期で詰める）。
   */
  function rippleDeleteSelected(): void {
    const hasAny =
      selectedIds.length || selectedSeIds.length || selectedImgIds.length || selectedVClipIds.length
    if (!hasAny) return
    // ロック中トラックのものが1つでも含まれていたら中止（部分的に消えると分かりにくい）
    const locked =
      cues.some((c) => isSelected(c.id) && telopLocked(c)) ||
      seClips.some((c) => selectedSeIds.includes(c.id) && trackStates[c.track]?.locked) ||
      imgClips.some((c) => selectedImgIds.includes(c.id) && trackStates[c.track]?.locked) ||
      vClips.some((c) => selectedVClipIds.includes(c.id) && trackStates[c.track]?.locked)
    if (locked) {
      showToast('ロックされたトラックのクリップが含まれています。')
      return
    }
    // 消した区間（トラックごと）。同じトラックの後続だけを詰めるために使う。
    const holes: { track: string; start: number; end: number }[] = []
    const collect = (track: string, start: number, end: number): void => {
      if (end > start) holes.push({ track, start, end })
    }
    cues.filter((c) => isSelected(c.id)).forEach((c) => collect(cueTrack(c), c.start, c.end))
    seClips
      .filter((c) => selectedSeIds.includes(c.id))
      .forEach((c) => collect(c.track, c.tStart, c.tStart + c.duration))
    imgClips
      .filter((c) => selectedImgIds.includes(c.id))
      .forEach((c) => collect(c.track, c.tStart, c.tStart + c.duration))
    vClips
      .filter((c) => selectedVClipIds.includes(c.id))
      .forEach((c) => collect(c.track, c.tStart, c.tStart + vcLen(c)))
    if (!holes.length) return
    // 詰めた後の位置は shared/timeline の rippleShifted に集約（同じ計算を書き直さない）
    const shifted = (track: string, t: number): number => rippleShifted(holes, track, t)
    setCues((prev) =>
      prev
        .filter((c) => !isSelected(c.id))
        .map((c) => {
          const ns = shifted(cueTrack(c), c.start)
          return ns === c.start ? c : { ...c, start: ns, end: ns + (c.end - c.start) }
        })
    )
    setSeClips((prev) =>
      prev
        .filter((c) => !selectedSeIds.includes(c.id))
        .map((c) => {
          const ns = shifted(c.track, c.tStart)
          return ns === c.tStart ? c : { ...c, tStart: ns }
        })
    )
    setImgClips((prev) =>
      prev
        .filter((c) => !selectedImgIds.includes(c.id))
        .map((c) => {
          const ns = shifted(c.track, c.tStart)
          return ns === c.tStart ? c : { ...c, tStart: ns }
        })
    )
    setVClips((prev) =>
      prev
        .filter((c) => !selectedVClipIds.includes(c.id))
        .map((c) => {
          const ns = shifted(c.track, c.tStart)
          return ns === c.tStart ? c : { ...c, tStart: ns }
        })
    )
    // **削除した所へ再生ヘッドを寄せる。**
    // キー操作のリップルトリム（Q/W）は編集点へ寄せているのに、
    // クリップを選んで消したときだけ置いていかれるのが食い違っていた。
    // 詰めたあとは「消した場所」が次に見たい所なので、そこに立たせる。
    if (holes.length) {
      const to = Math.min(...holes.map((h) => h.start))
      setTime(clamp(to, 0, durationRef.current))
      // **詰めた先が枠の外なら、そこを見せる。** ヘッドは動いているのに画面が
      // 前のままだと、消したあとどこに居るのか分からない。
      // 見えているときは何もしない（押すたびに画面が揺れる方が読みにくい）。
      // 立たせるのは次の描き直しのあと（setTime の結果を待つ）
      requestAnimationFrame(revealPlayhead)
    }
    setSelectedIds([])
    setSelectedSeIds([])
    setSelectedImgIds([])
    setSelectedVClipIds([])
  }

  /**
   * モーションで項目を選んでいる間は、コピー／貼り付けをそちらに回す。
   *
   * プレミアと同じ考え方で、**手前で選んでいる物が相手**になる。
   * モーションのタブを見ていて、そこで項目を選んでいるときだけ横取りする
   * （タイムラインのクリップのコピーは、それ以外では今までどおり）。
   */
  function cutSelected(): void {
    if (
      !selectedIds.length &&
      !selectedSeIds.length &&
      !selectedImgIds.length &&
      !selectedVClipIds.length
    )
      return
    if (cues.some((c) => isSelected(c.id) && telopLocked(c))) return
    copySelected()
    deleteSelected()
    deleteSelectedSE()
    deleteSelectedImg()
    deleteSelectedVClip()
  }
  /**
   * 複製した物に、新しい「組」の番号を振る道具を作る。
   *
   * **元の番号のまま複製してはいけない。** 複製と元が同じ組になり、
   * 複製を動かしたつもりで元まで動く（見た目には理由が分からない）。
   * 元が2つの組に分かれていたら、複製の側でも2つのまま保つ（shared/group）。
   */
  function regroupCopies(src: readonly { group?: number }[]): (g?: number) => number | undefined {
    const m = remapGroups(
      src.map((c) => c.group),
      nextGroupId({ cue: cues, se: seClips, img: imgClips, vclip: vClips })
    )
    return (g) => (g == null ? undefined : m.get(g))
  }

  function duplicateSelected(): void {
    if (!selectedIds.length) return
    if (cues.some((c) => isSelected(c.id) && telopLocked(c))) return
    const picked = cues.filter((c) => isSelected(c.id))
    const rg = regroupCopies(picked)
    const dupes = picked.map((c) => {
      const len = c.end - c.start
      return {
        ...structuredClone(c),
        id: idCounter.current++,
        start: c.end,
        end: c.end + len,
        group: rg(c.group)
      }
    })
    // **複製した側が勝つ。** 複製は「自分の直後」（`start: c.end`）に置くので、
    // **同じ段に次のテロップが並んでいれば必ず食い込む**。落として重ねたとき・
    // 端を伸ばしたとき・貼り付けたときと同じ扱いにする
    //（呼び方は state/cueOverwrite に1つだけ）。
    //
    // ここも `cuesRef` を読まない——まだ setCues していないので、
    // 手元で組み立てた配列に掛ける。
    const merged = [...cues, ...dupes].sort((a, b) => a.start - b.start)
    // ※ **これを外すと本当に赤くなることを確かめてある**（2026-08-03）。
    //   e2e「複製したテロップが次の物に重なっても、複製した側が勝つ」が
    //   `複製したあとも重なったままの帯がある: 600+188 と 694` で落ちる。
    const next = overwriteOverlapped(
      merged,
      dupes.map((d) => d.id),
      cueTrack,
      idCounter
    )
    setCues(next ?? merged)
    setSelectedIds(dupes.map((d) => d.id))
  }
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
  function deleteSelectedSE(): void {
    if (!selectedSeIds.length) return
    // ロック中トラックのクリップは残す
    setSeClips((prev) =>
      prev.filter((c) => !selectedSeIds.includes(c.id) || trackStates[c.track]?.locked)
    )
    setSelectedSeIds([])
  }

  async function findSilences(): Promise<void> {
    const path = sources[0]?.path ?? videoPath
    if (!path) {
      showToast('先に動画を読み込んでください。')
      return
    }
    setSilenceCut((s) => ({ ...s, busy: true }))
    const res = await window.giftcut.detectSilences(path, silenceCut.noiseDb, silenceCut.minSec)
    setSilenceCut((s) => ({ ...s, busy: false, found: res?.ok ? (res.silences ?? []) : [] }))
    if (!res?.ok) showToast('無音を調べられませんでした: ' + (res?.error ?? ''), 'error')
  }
  /** 見つけた無音を、後ろから順に詰めて削除する */
  function applySilenceCut(): void {
    const ranges = silenceCuts
    if (!ranges.length) return
    if (mainLocked()) return
    commitPending()
    // 後ろから消す。前から消すと、消したぶんだけ後ろの位置がずれて狙いが外れる。
    const desc = [...ranges].sort((a, b) => b.start - a.start)
    let segs = segsRef.current
    for (const r of desc) segs = cutRangeFromSegs(segs, r.start, r.end).out
    setSegments(tidyGaps(segs, segOps))
    // 文字・効果音・画像・めじるしも一緒に詰める（映像だけ詰まると全部ずれる）
    const shift = (t: number): number => {
      let v = t
      for (const r of desc) {
        if (v >= r.end) v -= r.end - r.start
        else if (v > r.start) v = r.start
      }
      return v
    }
    mapContentTimes(shift)
    clearSegSel()
    const sec = totalCutLen(ranges)
    showToast(`${ranges.length}か所・合計 ${sec.toFixed(1)}秒 を詰めました。`, 'success')
    setSilenceOpen(false)
    setSilenceCut((s) => ({ ...s, found: null }))
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

  /**
   * 右クリックの「複製」。選んでいるクリップを、自分のすぐ後ろに複製する。
   * 種類ごとに置き場所も採番も違うので、ここで振り分ける
   * （以前は右クリックメニューの中に直接書いてあった）。
   */
  function duplicateClipsFromMenu(kind: 'seg' | 'se' | 'img' | 'vclip'): void {
    if (kind === 'seg') {
      duplicateSelectedSegments()
      return
    }
    if (kind === 'vclip') {
      const picked = vClips.filter((c) => selectedVClipIds.includes(c.id))
      const rg = regroupCopies(picked)
      const dupes = picked.map((c) => ({
        ...c,
        id: vClipIdCounter.current++,
        tStart: c.tStart + vcLen(c),
        group: rg(c.group)
      }))
      setVClips((prev) => [...prev, ...dupes])
      setSelectedVClipIds(dupes.map((d) => d.id))
      return
    }
    if (kind === 'se') {
      const picked = seClips.filter((c) => selectedSeIds.includes(c.id))
      const rg = regroupCopies(picked)
      const dupes = picked.map((c) => ({
        ...c,
        id: seIdCounter.current++,
        tStart: c.tStart + c.duration,
        group: rg(c.group)
      }))
      setSeClips((prev) => [...prev, ...dupes])
      setSelectedSeIds(dupes.map((d) => d.id))
      return
    }
    const pickedImg = imgClips.filter((c) => selectedImgIds.includes(c.id))
    const rgImg = regroupCopies(pickedImg)
    const dupes = pickedImg.map((c) => ({
      ...c,
      id: imgIdCounter.current++,
      tStart: c.tStart + c.duration,
      group: rgImg(c.group)
    }))
    setImgClips((prev) => [...prev, ...dupes])
    setSelectedImgIds(dupes.map((d) => d.id))
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
   * 再生ヘッドが「空き」の上にあるなら、その空きを詰める（本編＝V1 だけ）。
   *
   * クリップを動かしてできた空きは帯を描いていないので、掴んで消すことができない。
   * 再生ヘッドを置いて Delete で閉じられるようにする。
   *
   * 途中にテロップ・効果音・画像・重ねた動画が入っている場合は、**その手前で止める**。
   * 空き全部を一度に詰めると、間にあったテロップが巻き添えでずれてしまうため。
   * どこで止めるかの判定は shared/timeline の rippleEnd（テストで固定済み）。
   *
   * 戻り値: 詰めたら true。空きの上でなければ false（呼び出し側は通常の削除へ）。
   */
  function closeGapAtPlayhead(): boolean {
    const t = currentTimeRef.current
    const L = layoutSegs(segsRef.current).find(
      (x) => x.seg.gap && t >= x.tStart - 1e-6 && t < x.tEnd - 1e-6
    )
    return L ? closeGap(L.seg.id) : false
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

  /**
   * 選んでいる「空き」を詰める。**空きだけを選んでいるときに限る。**
   *
   * クリップも一緒に選ばれているのに詰めてしまうと、Delete が
   * 「空きを詰めただけで、クリップは何も消えない」動きになる。
   * 実際に Ctrl+A（全部選択）→ Delete で、空きが1つでもあると
   * 本編のクリップが消えなくなっていた。
   */
  function closeSelectedGaps(): boolean {
    const ids = new Set([...selectedVideoIds, ...selectedAudioIds])
    const picked = segsRef.current.filter((s) => ids.has(s.id))
    const gap = picked.find((s) => s.gap)
    if (!gap) return false
    // 空き以外も選ばれている＝「消す」が主目的。詰める動作は取らない
    const onlyGaps =
      picked.every((s) => s.gap) &&
      !selectedIds.length &&
      !selectedSeIds.length &&
      !selectedImgIds.length &&
      !selectedVClipIds.length
    if (!onlyGaps) return false
    clearSegSel()
    return closeGap(gap.id)
  }
  /** 空き1つを詰める。途中に別のクリップがあればその手前で止める。 */
  function closeGap(segId: number): boolean {
    if (mainLocked()) return false
    const segs = segsRef.current
    const L = layoutSegs(segs).find((x) => x.seg.id === segId && x.seg.gap)
    if (!L) return false
    // 空きの上に重なっているもの（テロップ・効果音・画像・重ねた動画）を見る。
    // 「編集点」ではなく**区間**で見るのが要点。編集点だけだと、空きの先頭に
    // ちょうど重なっているクリップを飛び越えて、その中身を突き抜けて詰めてしまう。
    const spans = [
      ...cuesRef.current.map((c) => ({ start: c.start, end: c.end })),
      ...seClipsRef.current.map((c) => ({ start: c.tStart, end: c.tStart + c.duration })),
      ...imgClipsRef.current.map((c) => ({ start: c.tStart, end: c.tStart + c.duration })),
      ...vClipsRef.current.map((c) => ({ start: c.tStart, end: c.tStart + vcLen(c) }))
    ]
    if (spans.some((s) => s.start <= L.tStart + 1e-6 && s.end > L.tStart + 1e-6)) {
      showToast('この空きの先頭には別のクリップが重なっています。')
      return true
    }
    const nextStart = spans
      .map((s) => s.start)
      .filter((t) => t > L.tStart + 1e-6 && t < L.tEnd - 1e-6)
    const to = nextStart.length ? Math.min(...nextStart) : L.tEnd
    const len = to - L.tStart
    if (len <= 1e-3) {
      showToast('この空きの先頭には別のクリップが来ています。')
      return true
    }
    // 空きを縮める（丸ごと無くなるなら切片ごと外す）
    const next = segs.flatMap((s) =>
      s.id !== L.seg.id
        ? [s]
        : segTLen(s) - len > 1e-3
          ? [{ ...s, srcEnd: s.srcEnd - len }]
          : []
    )
    setSegments(next)
    shiftAfter(to, -len) // 詰めた分だけ、後ろのテロップ/SE/画像/マーカーも前へ
    seekTo(L.tStart)
    if (to < L.tEnd - 1e-3) showToast('次のクリップの手前まで詰めました。')
    return true
  }
  function allContentEdges(): number[] {
    const out: number[] = []
    for (const c of cuesRef.current) out.push(c.start, c.end)
    for (const c of seClipsRef.current) out.push(c.tStart, c.tStart + c.duration)
    for (const c of imgClipsRef.current) out.push(c.tStart, c.tStart + c.duration)
    for (const c of vClipsRef.current) out.push(c.tStart, c.tStart + vcLen(c))
    return out
  }
  /**
   * 本編に載っている物の時刻を、**5種類まとめて**同じ規則で付け替える。
   *
   * 相手はテロップ・効果音・画像・映像クリップ・目印の5種類。
   * **1種類でも掛け忘れると、そこだけ置き去りになる**（音や文字だけ元の位置に
   * 残る）。編集中は気づきにくく、書き出してから分かるので1か所にまとめる。
   * 種類が増えたときも、ここへ足せば全員に行き渡る。
   *
   * 渡す規則は「時刻→時刻」の関数だけ。詰める・ずらす・複数区間を畳む、
   * どれもこの形で書ける。
   *
   * **端は別々に付け替える。** テロップの片端だけが対象区間にかかることが
   * あり、まとめて動かすと残すべき尻まで消える。潰れて長さが0になった物は
   * ここで落とす。
   *
   * **動かない物は同じ物のまま返す。** 作り直すと、変わっていない段まで
   * 描き直しになる。
   */
  function mapContentTimes(at: (t: number) => number): void {
    const atStart = <T extends { tStart: number }>(x: T): T => {
      const t = at(x.tStart)
      return t === x.tStart ? x : { ...x, tStart: t }
    }
    setCues((prev) =>
      prev
        .map((c) => ({ ...c, start: at(c.start), end: at(c.end) }))
        .filter((c) => c.end - c.start > 0.05)
    )
    setSeClips((prev) => prev.map(atStart))
    setImgClips((prev) => prev.map(atStart))
    // 映像レイヤーも動かす（本編とズレると位置リンクが崩れる）
    setVClips((prev) => prev.map(atStart))
    setMarkers((prev) =>
      prev.map((m) => {
        const t = at(m.t)
        return t === m.t ? m : { ...m, t }
      })
    )
  }
  /** 区間 [rmStart, rmEnd] を捨てて、後ろを詰める */
  function collapseContent(rmStart: number, rmEnd: number, removeLen: number): void {
    mapContentTimes((t) => collapseAt(t, rmStart, rmEnd, removeLen))
  }
  function rippleToPrevCut(): void {
    if (mainLocked()) return
    stopPlayback()
    const t = currentTimeRef.current
    const L = segLayoutRef.current.find((l) => t > l.tStart + 0.01 && t <= l.tEnd + 1e-6)
    if (!L) return
    // カット点まで一気に詰めず、途中に編集点（テロップ等の端）があればそこで止める。
    // 例: カット点0・テロップ[2,5]・再生ヘッド8 なら、[0,8] ではなく [5,8] を削る。
    const floorT = rippleStart(L.tStart, t, allContentEdges())
    const removeLen = Math.min(t - floorT, L.len)
    if (removeLen < 0.02) return
    const rmStart = floorT
    const rmEnd = t
    const sp = segSpeed(L.seg)
    const midCut = floorT > L.tStart + 1e-6 // 切片の途中から削る＝2つに割って間を捨てる
    setSegments((prev) => {
      const idx = prev.findIndex((x) => x.id === L.seg.id)
      if (idx < 0) return prev
      const seg = prev[idx]
      let next: VSeg[]
      if (!midCut) {
        // 切片の頭から削る（従来どおり頭を前進させる）
        next = prev.map((x) =>
          x.id === seg.id ? { ...x, srcStart: x.srcStart + removeLen * sp } : x
        )
      } else {
        // 途中を削る: [切片頭, floorT] と [t, 切片尻] を残して間を捨てる。
        // 間のトランジションは分割点をまたげないので落とす。
        const keepLeftEnd = seg.srcStart + (floorT - L.tStart) * sp
        const keepRightStart = seg.srcStart + (t - L.tStart) * sp
        next = [...prev]
        next[idx] = { ...seg, srcEnd: keepLeftEnd, transOut: undefined, xfade: undefined }
        next.splice(idx + 1, 0, {
          ...seg,
          id: segIdCounter.current++,
          srcStart: keepRightStart,
          transIn: undefined
        })
      }
      const gone = new Set(next.filter((x) => x.srcEnd - x.srcStart <= 0.02).map((x) => x.id))
      return gone.size ? cleanupOrphanTrans(next, gone) : next
    })
    collapseContent(rmStart, rmEnd, removeLen)
    if (videoRef.current)
      videoRef.current.currentTime = L.seg.srcStart + (rmStart - L.tStart) * sp
    setTime(rmStart) // 再生ヘッドは削った位置（編集点）に留める
    clearAllSelections() // 消えたクリップを選択に残さない
  }
  // 再生ヘッドから「1つ後のカット点」までを詰めて削除。
  // 対象切片の尻を再生ヘッドまで後退＝[再生ヘッド, 切片終わり]を除去し、後続を詰める。
  function rippleToNextCut(): void {
    if (mainLocked()) return
    stopPlayback()
    const t = currentTimeRef.current
    const L = segLayoutRef.current.find((l) => t >= l.tStart - 1e-6 && t < l.tEnd - 0.01)
    if (!L) return
    // カット点まで一気に詰めず、途中に編集点（テロップ等の端）があればそこで止める。
    const ceilT = rippleEnd(t, L.tEnd, allContentEdges())
    const removeLen = Math.min(ceilT - t, L.len)
    if (removeLen < 0.02) return
    const rmStart = t
    const rmEnd = ceilT
    const sp = segSpeed(L.seg)
    const midCut = ceilT < L.tEnd - 1e-6 // 切片の途中まで削る＝2つに割って間を捨てる
    setSegments((prev) => {
      const idx = prev.findIndex((x) => x.id === L.seg.id)
      if (idx < 0) return prev
      const seg = prev[idx]
      let next: VSeg[]
      if (!midCut) {
        // 切片の尻まで削る（従来どおり尻を手前へ）
        next = prev.map((x) =>
          x.id === seg.id ? { ...x, srcEnd: x.srcEnd - removeLen * sp } : x
        )
      } else {
        const keepLeftEnd = seg.srcStart + (t - L.tStart) * sp
        const keepRightStart = seg.srcStart + (ceilT - L.tStart) * sp
        next = [...prev]
        next[idx] = { ...seg, srcEnd: keepLeftEnd, transOut: undefined, xfade: undefined }
        next.splice(idx + 1, 0, {
          ...seg,
          id: segIdCounter.current++,
          srcStart: keepRightStart,
          transIn: undefined
        })
      }
      const gone = new Set(next.filter((x) => x.srcEnd - x.srcStart <= 0.02).map((x) => x.id))
      return gone.size ? cleanupOrphanTrans(next, gone) : next
    })
    collapseContent(rmStart, rmEnd, removeLen)
    if (videoRef.current) videoRef.current.currentTime = L.seg.srcStart + (t - L.tStart) * sp
    setTime(rmStart) // 再生ヘッドはカット点（元の位置）に留める
    clearSegSel() // 消えたクリップを選択に残さない
    setSelectedIds([])
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

  /**
   * 再生ヘッドで切る。**選んでいる物があるかどうかで意味が変わる。**
   *
   *   何も選んでいない → 再生ヘッドの位置で、載っている物を全部切る
   *   何かを選んでいる → その選んだ物だけを切る
   *
   * 以前は「動画は常に全部・テロップだけ選択を見る」という食い違った作りで、
   * 効果音・画像・映像レイヤーには分割そのものが無かった。
   * **どれを切るかを1か所で決める**（散らばっていると、種類ごとに挙動が割れる）。
   */
  function cutAtPlayhead(): void {
    const t = qFrame(currentTimeRef.current, fpsRef.current)
    const anySel =
      selectedIds.length > 0 ||
      selectedVideoIds.length > 0 ||
      selectedAudioIds.length > 0 ||
      selectedSeIds.length > 0 ||
      selectedImgIds.length > 0 ||
      selectedVClipIds.length > 0
    // 決め方は shared/cutScope に置いてある（種類ごとに書き直さないこと）
    const want = (selected: boolean): boolean => shouldCut(anySel, selected)
    const spans = (start: number, end: number): boolean => spansCut(start, end, t)

    // ---- 本編の動画（V1）----
    if (!mainLocked()) {
      const L = segLayoutRef.current.find((x) => spans(x.tStart, x.tEnd))
      const segSel =
        selectedVideoIds.includes(L?.seg.id ?? -1) || selectedAudioIds.includes(L?.seg.id ?? -1)
      if (L && want(segSel)) razorSegment(L.seg, L.seg.srcStart + (t - L.tStart) * segSpeed(L.seg))
    }

    // ---- テロップ ----
    const cueTargets = cues.filter(
      (c) => want(isSelected(c.id)) && !telopLocked(c) && spans(c.start, c.end)
    )
    if (cueTargets.length) {
      const idMap = new Map(cueTargets.map((c) => [c.id, idCounter.current++]))
      setCues((prev) => {
        const out: Cue[] = []
        for (const c of prev) {
          const nid = idMap.get(c.id)
          if (nid != null) {
            out.push({ ...structuredClone(c), end: t })
            out.push({ ...structuredClone(c), id: nid, start: t })
          } else out.push(c)
        }
        return out.sort((a, b) => a.start - b.start)
      })
    }

    // ---- 効果音・BGM ----
    // 音源の中の位置（srcOffset）も進める。ここを忘れると、後半が頭から鳴り直す
    const seTargets = seClips.filter(
      (c) =>
        want(selectedSeIds.includes(c.id)) &&
        !trackStates[c.track]?.locked &&
        spans(c.tStart, c.tStart + c.duration)
    )
    if (seTargets.length) {
      const idMap = new Map(seTargets.map((c) => [c.id, seIdCounter.current++]))
      setSeClips((prev) => {
        const out: SEClip[] = []
        for (const c of prev) {
          const nid = idMap.get(c.id)
          if (nid != null) {
            const left = t - c.tStart
            out.push({ ...c, duration: left })
            out.push({
              ...c,
              id: nid,
              tStart: t,
              duration: c.duration - left,
              srcOffset: (c.srcOffset ?? 0) + left
            })
          } else out.push(c)
        }
        return out
      })
    }

    // ---- 画像 ----
    // 静止画なので、切っても中身の位置は動かない（長さだけ分ける）
    const imgTargets = imgClips.filter(
      (c) =>
        want(selectedImgIds.includes(c.id)) &&
        !trackStates[c.track]?.locked &&
        spans(c.tStart, c.tStart + c.duration)
    )
    if (imgTargets.length) {
      const idMap = new Map(imgTargets.map((c) => [c.id, imgIdCounter.current++]))
      setImgClips((prev) => {
        const out: ImgClip[] = []
        for (const c of prev) {
          const nid = idMap.get(c.id)
          if (nid != null) {
            const left = t - c.tStart
            out.push({ ...structuredClone(c), duration: left })
            out.push({
              ...structuredClone(c),
              id: nid,
              tStart: t,
              duration: c.duration - left
            })
          } else out.push(c)
        }
        return out
      })
    }

    // ---- 映像レイヤー ----
    // 素材の中のどこを使うか（srcStart〜srcEnd）を分ける。動画の切片と同じ考え方
    const vcTargets = vClips.filter(
      (c) =>
        want(selectedVClipIds.includes(c.id)) &&
        !trackStates[c.track]?.locked &&
        spans(c.tStart, c.tStart + (c.srcEnd - c.srcStart))
    )
    if (vcTargets.length) {
      const idMap = new Map(vcTargets.map((c) => [c.id, vClipIdCounter.current++]))
      setVClips((prev) => {
        const out: VClip[] = []
        for (const c of prev) {
          const nid = idMap.get(c.id)
          if (nid != null) {
            const cut = c.srcStart + (t - c.tStart)
            out.push({ ...structuredClone(c), srcEnd: cut })
            out.push({ ...structuredClone(c), id: nid, tStart: t, srcStart: cut })
          } else out.push(c)
        }
        return out
      })
    }
  }

  return {
    deleteSelected, rippleDeleteSelected, cutSelected, duplicateSelected, razorSegment,
    deleteSelectedSE, findSilences, applySilenceCut, rippleDeleteVideoSegments,
    toggleBlankSelectedVideo, duplicateClipsFromMenu, duplicateSelectedSegments,
    setSelectedSegSpeed, setSegRotate, closeGapAtPlayhead, deleteVideoSegmentsLeavingGap,
    // closeGap / allContentEdges / mapContentTimes / collapseContent は返さない。
    // 受け取る所が無かった（この中でだけ使う。return の中は noUnusedLocals が見ない）
    closeSelectedGaps,
    rippleToPrevCut, rippleToNextCut, splitVideoAtPlayhead, cutAtPlayhead
  }
}
