// **いま選んでいる物**を消す・切り取る・複製する。
//
// 相手はテロップ・効果音・画像・映像レイヤーの4種類。
// 再生ヘッドを基準にする操作（./usePlayheadRipple）とは別物——
// **こちらは「選択」が入力**で、あちらは「いまの時刻」が入力。
//
// ## 「消す」と「詰める」は別物
//
// 消す（Delete）… その物だけ消える。後ろは動かない。空いた所は空白になる。
// 詰める（リップル）… 消したぶん後ろが前へ寄る。**種類を跨いで全部**寄る。
//
// ## 複製したら「組」を振り直す
//
// 元の組の番号のまま複製すると、**元と写しが同じ組になる**。
// 片方を動かすともう片方も付いてきて、離せなくなる（`regroupCopies`）。
//
// ## 鍵の掛かった段は触らない
//
// どの操作でも同じ。揃えておかないと「キーでは消えるのにボタンでは消えない」
// のような食い違いが出る。
//
// ## なぜ state/useTimelineEdit から出したか（2026-08-04）
//
// 記号解決で測ったら **受け取る6・返す1**。受け取る6つのうち5つは import で、
// 残る1つ（`seg`）から実際に使うのは `duplicateSelectedSegments` **1つだけ**
//（`引き継ぎ-心臓の分け直し.md`）。
//
// ## 中身
//
// - `useSelectionEdit` … 下をまとめて返す唯一の入口
// - `deleteSelected` … 選んだテロップを消す（後ろは動かない）
// - `rippleDeleteSelected` … 消して後ろを詰める（**種類を跨いで全部**）
// - `cutSelected` … 切り取り（コピーしてから消す）
// - `regroupCopies` … 複製した物の「組」を振り直す（元と混ざらないように）
// - `duplicateSelected` … テロップを複製する
// - `deleteSelectedSE` … 選んだ効果音を消す
// - `duplicateClipsFromMenu` … 右クリックからの複製（種類ごと）
import { clamp, rippleShifted } from '../../../shared/timeline'
import { nextGroupId, remapGroups } from '../../../shared/group'
// 重なりの解決。**呼び方は state/cueOverwrite に1つだけ**（掴む側・貼り付けも同じ）
import { overwriteOverlapped } from './cueOverwrite'
import type { Cue } from '../lib/srt'
import type { VClip } from '../lib/projectTypes'
import { useDoc } from './contentContext'
import { useSel } from './selectionContext'
import { useTracksCtx } from './tracksContext'
import { useToastCtx } from './toastContext'
import { usePlaybackCtx } from './playbackContext'

export interface UseSelectionEditDeps {
  copySelected: () => void
  cueTrack: (c: Cue) => string
  deleteSelectedImg: () => void
  deleteSelectedVClip: () => void
  idCounter: React.MutableRefObject<number>
  /** 再生ヘッドが枠の外なら見える所へ連れてくる */
  revealPlayhead: () => void
  setTime: (t: number) => void
  telopLocked: (c: Cue) => boolean
  /** 重ねた動画の長さ。**正典は shared/timeline の vcLen** */
  vcLen: (c: VClip) => number
  /** 本編の切片を複製する。**state/useSegmentEdit の物を借りる**（持ち出さない） */
  duplicateSelectedSegments: () => void
}

export function useSelectionEdit(deps: UseSelectionEditDeps) {
  const {
    copySelected, cueTrack, deleteSelectedImg, deleteSelectedVClip, idCounter,
    revealPlayhead, setTime, telopLocked, vcLen, duplicateSelectedSegments
  } = deps
  const {
    cues, setCues, seClips, setSeClips, seIdCounter,
    imgClips, setImgClips, imgIdCounter, vClips, setVClips, vClipIdCounter
  } = useDoc()
  const {
    selectedIds, setSelectedIds, selectedSeIds, setSelectedSeIds,
    selectedImgIds, setSelectedImgIds, selectedVClipIds, setSelectedVClipIds, isSelected
  } = useSel()
  const { trackStates } = useTracksCtx()
  const { showToast } = useToastCtx()
  const { durationRef } = usePlaybackCtx()
  // **借りている物をそのまま渡す。** ここで名前を変えると、呼んでいる所が
  // 「本編の切片を触っている」と気づけなくなる
  const seg = { duplicateSelectedSegments }

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
  function deleteSelectedSE(): void {
    if (!selectedSeIds.length) return
    // ロック中トラックのクリップは残す
    setSeClips((prev) =>
      prev.filter((c) => !selectedSeIds.includes(c.id) || trackStates[c.track]?.locked)
    )
    setSelectedSeIds([])
  }



  /**
   * 右クリックの「複製」。選んでいるクリップを、自分のすぐ後ろに複製する。
   * 種類ごとに置き場所も採番も違うので、ここで振り分ける
   * （以前は右クリックメニューの中に直接書いてあった）。
   */
  function duplicateClipsFromMenu(kind: 'seg' | 'se' | 'img' | 'vclip'): void {
    if (kind === 'seg') {
      seg.duplicateSelectedSegments()
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

  return {
    deleteSelected, rippleDeleteSelected, cutSelected, regroupCopies,
    duplicateSelected, deleteSelectedSE, duplicateClipsFromMenu
  }
}
