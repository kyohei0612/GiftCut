// 画面の部品どうしの「配線」。**ここは糊と、呼ぶ順だけ。**
//
// ## App.tsx との分け方
//
// App.tsx は「画面は何でできているか」だけを持つ。ここは「それらをどうつなぐか」。
//
// ## フックを1本足すとき、ここには書かない
//
// **囲い（state/*Context.tsx）を作る。** ここへ書き足すと必ず元に戻る——
// 2026-08-04 に 1,229行から剥がし切ったが、元は「フックを呼んで名前を配る」が
// 積み上がっただけだった（名前 459個のうち **396個が配管**）。
//
// 足した直後に `npm run passthrough` の「いま囲いへ上げられるフック」に
// **自分が出てきたら、書く場所を間違えた合図**。
//
// ## 何がここに残っているか
//
//   糊      どの心臓の持ち物でもない4本（下の「中身」）
//   効果    **走る順に意味がある**物
//   束      8本。**組み立ては心臓側**（各 *Context.tsx の use*Value）で、ここは返すだけ
//
// 束を返すのはここのまま——そうすると `Wired<'キー'>` の引き先が変わらず、
// 受け口の型も検査（shared/ctxTypes.test.ts）も動かさずに済む。
// **移したのは組み立てだけ。**
//
// ## 呼ぶ順が全て
//
// 上から順に、下は上しか参照していない。**前方参照を逃げるための
// `(...a) => X(...a)` は 0 か所**（2026-08-02 に21か所すべて外した）。
// 増やす前にまず疑うこと——相手は本当にこちらを要るか、
// 輪の結び目が「置き場所を間違えた小さな物」ではないか。
// 4つの輪を解いて、4つともそれだった。
//
// 効果（useEffect）で**順に意味があるのは3本**:
//
//   useSessionMemory → useHistoryCoalesce → useAutosaveDraft
//
// 効果は**宣言した順**に走る。いちばん上の「作業位置を覚える」は「1つ前の描画の
// ref」を見て中身があるか判断しているので、**写し取りをする useHistoryCoalesce を
// 先に呼ぶと、起動直後に空でセッションを上書きしうる**（1度やっている）。
//
// ## ここにしか無い物（**足す前に必ずここを見る**）
//
// 下の4本は、このファイルにしか実体が無い。どれも複数の領域を同時に触るので、
// どの心臓の持ち物でもない。**知らずに新規で書くと二重になる。**
//
// ## 中身
//
// - `useAppWiring` … 糊を作り、順を保証して、束にして返す
// - `changeRatio` … 比率を変える。**テロップの箱と文字サイズも一緒に補正する**
// - `addMediaAtPlayhead` … 素材を再生ヘッドの位置へ置く（掴んで落とす道と同じ既定へ）
// - `openClipMenu` … 帯の右クリック。**選んでいない物を押したときだけ**選び直す
// - `resetCount` … リセットが何個に効くか（押す前に分かるように）
//
// 2026-08-04 にここから出した物と、その行き先は `引き継ぎ-心臓の分け直し.md`。
//
// ## 大きさは state/wiringSize.test.ts が見張っている
import { useEffect, useRef } from 'react'
import type {} from '../../../preload/index.d'
import { perf } from '../lib/perfMonitor'
import { useLayout } from './layoutContext'
import { useSel } from './selectionContext'
import { useDoc } from './contentContext'
import { useTracksCtx } from './tracksContext'
import { useCurrentLookCtx } from './currentLookContext'
import { useWindowDrop } from './useWindowDrop'
import { useAutosaveMarkCtx } from './autosaveMarkContext'
import { useMainEvents } from './useMainEvents'
import { useTimelineSpanCtx } from './timelineSpanContext'
import { useAppChromeCtx } from './appChromeContext'
import type { Ratio } from './useExportSettings'
import { useTimelineBoxCtx } from './timelineBoxContext'
import { useTimelineWheel } from './useTimelineWheel'
import { audioLaneFor } from '../../../shared/lanes'
import { useDismissOnOutside } from './useDismissOnOutside'
import { RECENT_KEY } from '../lib/appConst'
import type { MediaItem } from '../components/panels/ProjectBinTab'
import { useViewNavCtx } from './viewNavContext'
import { useTracksAdminCtx } from './tracksAdminContext'
import { useMediaDropCtx } from './mediaDropContext'
import { useVideoSync } from './useVideoSync'
import { useSessionMemory, takeRestoredView } from './useSessionMemory'
import { useHistoryCoalesce } from './useHistoryCoalesce'
import { useAutosaveDraft } from './useAutosaveDraft'
import { useSelectionCleanup } from './useSelectionCleanup'
import { useNestSelectSync } from './useNest'
import { useDiagnostics } from './useDiagnostics'

import { useSegmentPlaceCtx } from './segmentPlaceContext'
import { useExportCtx } from './exportContext'
import { useMediaCtx } from './mediaContext'
import { useProjectStateCtx } from './projectStateContext'
import { useProjectFileCtx } from './projectFileContext'
import { useDragPreviewCtx } from './dragPreviewContext'
import { useLaneHeightsCtx } from './laneHeightsContext'
import { usePlaybackCtx } from './playbackContext'
import { useKeyboard } from './useKeyboard'
import type { OpenClipMenu } from '../components/timeline/ClipBand'
import { useTimelineOpsValue } from './timelineOpsContext'
import { useTimelineViewValue } from './timelineViewContext'
import { usePreviewCtxValue } from './previewContext'
import { useLeftPanelValue } from './leftPanelContext'
import { useHeaderValue } from './headerContext'
import { useRightPanelValue } from './rightPanelContext'
import { useMenusValue } from './menusContext'
import { useDialogsValue } from './dialogsContext'

export function useAppWiring() {
  // 掴んでいる最中に出す物（影・吹き出し・吸い付きの線・囲い）と、コピーの控え
  const { dragTip } = useDragPreviewCtx()
  // プロジェクトの持ち物と設定（更新しても消えてはいけない物が多い）
  const { recentProjects } = useProjectStateCtx()
  // 素材（取り込んだ物）と元動画（いま使っている物）。videoSrc は差し替わるが
  // videoPath は原本なので差し替えない（焼き直した粗い映像で書き出さないため）
  const { videoPath, videoDuration } = useMediaCtx()
  // 書き出しの設定と進み具合（設定はプロジェクトの一部、進み具合は画面の一部）
  const { ratio, setRatio } = useExportCtx()
  // 段の高さ（種類ごと＋段ごと）。state と ref を1か所で面倒を見る
  const { videoTrackH, audioTrackH } = useLaneHeightsCtx()
  // 再生の「今」（時刻・流しているか・速さ）。**追いかけの仕組みは動かしていない**
  const {
    currentTime, currentTimeRef, durationRef,
    playing, playRateUI,
    fps
    // 追いかけの時計まわりも心臓が持っている。**App で別に宣言しないこと**
    //（同じ名前の入れ物が2つできて、「消す方」と「読む方」が食い違う）
  } = usePlaybackCtx()
  // 段（トラック）と鍵。**鍵はあらゆる編集の手前で見る**ので心臓に置く
  const { tracks } = useTracksCtx()
  // タイムラインの中身は state/useContent がまとめて持つ（配列と採番は一組）
  const { cues, setCues, seClips } = useDoc()
  // 選んでいる物は state/useSelection がまとめて持つ（解除の入口も1つ）
  const sel = useSel()
  const {
    selectedIds, selectedVideoIds, setSelectedVideoIds,
    selectedAudioIds, selectedSeIds, setSelectedSeIds,
    selectedImgIds, setSelectedImgIds, selectedVClipIds, setSelectedVClipIds,
    selectedTrans, selectedTelopTrans,
    selectedTrackId, selectedMarkerId
  } = sel
  // 画面の枠まわりの小さな状態（品書き・道具・マグネット・進み具合・版）は
  // state/useAppChrome。**保存しない物**をまとめてある
  const {
    menu, setMenu, clipMenu, setClipMenu, tool, appVersion
  } = useAppChromeCtx()
  // 比率を変更する。テロップの箱(box)と文字サイズは「フレーム高さ1080基準の絶対値」なので、
  // 比率が変わると幅に対する見た目の比率が崩れる（16:9で幅83%の箱が9:16では画面外へ）。
  // 幅の変化率で box.w とフォントサイズを補正して、見た目の収まりを保つ。
  function changeRatio(next: Ratio): void {
    const wOf = (r: Ratio): number => (r === '16:9' ? 1920 : 1080)
    if (next === ratio) return
    const k = wOf(next) / wOf(ratio)
    if (Math.abs(k - 1) > 1e-3) {
      setCues((prev) =>
        prev.map((c) => {
          const st = c.style
          const nb = st.box ? { ...st.box, w: st.box.w * k } : st.box
          return {
            ...c,
            style: { ...st, box: nb, fontSize: Math.max(8, Math.round(st.fontSize * k)) }
          }
        })
      )
    }
    setRatio(next)
  }
  // **毎レンダーここを通る。** 画面を作り直した回数がそのまま数になる
  perf.countRender()
  // 段（トラック）の足す・消す・選ぶ・鍵・音量は state/useTracksAdmin
  const { fallbackTrack } = useTracksAdminCtx()
  // 最近開いたプロジェクトの控え。**書けなくても動作には影響しない**ので握りつぶす
  useEffect(() => {
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(recentProjects))
    } catch {
      /* 保存できなくても動作には影響しない */
    }
  }, [recentProjects])
  // タイムラインの箱への参照と、追従（縦は「ついていく側3つ」、横は revealPlayhead）は
  // state/useTimelineBox
  const { syncTimelineVScroll, fitTimelineAroundVA } = useTimelineBoxCtx()
  // 画面の配置は state/usePanelLayout が持つ（大きさの限界と、掴んで動かす所も一緒）
  const {
    timelineH, startResize,
    isPopped, unpopPane, paneGeom
  } = useLayout()
  // プレビューとの境目を動かした＝タイムラインの高さが変わった。
  // 上と下が一緒に小さくなるよう、映像と音声の境目を残す。
  useEffect(() => {
    fitTimelineAroundVA()
  }, [timelineH, fitTimelineAroundVA])
  // 段の高さや本数が変わると、送れる量そのものが変わる（減れば、ブラウザが
  // scrollTop を勝手に切り詰める）。追従側は自分では気づけないので合わせ直す。
  // ここを抜くと、段を細くした瞬間に見出しだけ上へずれたまま残る。
  //
  // ※こちらは**送る位置を変えない**。段の高さを触っている最中に
  //   タイムラインが真ん中へ飛ぶと、掴んでいる境目が逃げる。
  useEffect(() => {
    syncTimelineVScroll()
  }, [videoTrackH, audioTrackH, tracks.length, syncTimelineVScroll])
  // 動きの計測と不具合の記録は state/useDiagnostics
  useDiagnostics()
  // タイムラインの長さ（出す長さ／本当の終わり）と、ものさしの目盛りは
  // state/useTimelineSpan（長さが2つある理由も中にある）
  const { duration } = useTimelineSpanCtx()
  // 「いまこの瞬間」を見る側のために、state を写しへ移す
  useEffect(() => {
    durationRef.current = duration
  }, [duration])
  // 選んだ物が「もう無い物」を指し続けないよう掃除するのは state/useSelectionCleanup
  useSelectionCleanup()
  // **「組」で選ぶ唯一の入口。** 選び方が何通りあっても、最後にここで組ごとに広げる
  useNestSelectSync()
  // 再生ヘッドの位置の見た目と、リフレーム枠の相手は state/useCurrentLook
  const { reframeTargetRef } = useCurrentLookCtx()
  /** リセットが何個に効くか（ボタンの表示に使う。押す前に分かるように） */
  const resetCount = (): number => {
    const tgt = reframeTargetRef.current
    if (!tgt) return 0
    const n =
      (selectedVideoIds.length || (tgt.kind === 'video' ? 1 : 0)) +
      (selectedImgIds.length || (tgt.kind === 'img' ? 1 : 0)) +
      (selectedVClipIds.length || (tgt.kind === 'vclip' ? 1 : 0))
    return n
  }
  // 本編の切片をどこへ置くか（動かす・新しく置く・落とした所へ）は state/useSegmentPlace
  const { placeVideoAtDrop } = useSegmentPlaceCtx()
  // 未保存の「＊」と、下書きの土台は state/useAutosaveMark
  // （何と比べて決めるか・なぜ変わったときだけ見直すかも中にある）
  const { projectJsonRef, autosaveNg } = useAutosaveMarkCtx()
  // 素材を掴んで落とす（どの段の、どこへ置くか）は state/useMediaDrop
  const { placeImage, placeSE } = useMediaDropCtx()
  /**
   * 素材を**再生ヘッドの位置へ置く**（素材をダブルクリックしたとき）。
   *
   * 置く場所をマウスで指す必要があるのはドラッグだけで、
   * 「とりあえず今いる所に足したい」ときにドラッグを強いるのは手間なだけ。
   * どの段に載せるかは、ドラッグで何も指さなかったときと同じ既定に合わせる。
   *
   * **ここに置いてあるのは、置き方が3種類とも揃うのがこの位置だから。**
   * 読み込む側（state/useMediaOps）に置いていた頃は、あちらが置く物を要り、
   * 置く物は読み込む物を要る、という輪になっていた。
   */
  function addMediaAtPlayhead(m: MediaItem): void {
    // 「いまこの瞬間」を見る（再生中は state の描き直しが遅れてずれる）
    const t = currentTimeRef.current
    if (m.kind === 'video') void placeVideoAtDrop(m.path, t, false)
    // **音の置き先を A2 に固定しない**（判定は shared/lanes の audioLaneFor）。
    // 掴んで落とすときは狙った段へ行くのに、ここだけ固定だった
    else if (m.kind === 'audio')
      void placeSE(m, t, audioLaneFor(tracks, seClips, t, sel.selectedTrackId))
    else placeImage(m, t, fallbackTrack('V3', 'video'))
  }
  // 画面の <video> / <audio> を「いま」に追従させるのは state/useVideoSync
  useVideoSync()
  // 見ている場所を動かす（寄る・引く・連れてくる）は state/useViewNav
  const { fitTimelineZoom } = useViewNavCtx()
  // ホイールの割り当てと、再生ヘッドの追いかけは state/useTimelineWheel
  useTimelineWheel()
  // 品書きは、外を押す・Escape で閉じる（閉じ方は state/useDismissOnOutside に1つ）
  useDismissOnOutside(!!clipMenu, () => setClipMenu(null))
  useDismissOnOutside(!!menu, () => setMenu(null))
  // **テロップの打ち直しも、外を押したら完了。**
  // 以前はプレビューの余白を押したときしか閉じず、タイムライン・右パネル・
  // 再生では開いたままだった（＝Enter を押すまで終われない）。
  // クリップは pointerdown を自分で止めるので、**capture で拾って
  // 「打ち直しの中かどうか」を自分で見る**（決まりは useDismissOnOutside）。
  //
  // **左右のパネルは「外」に数えない**（`data-editor-safe`）。
  // 打っている最中に色やフォントを直しに行くのは同じ一続きの作業で、そこで
  // 閉じると**打ちかけの文字と、変えたかった選択そのものが消える**
  // （左パネルの「その文字だけ変える」は、まさにその選択を見ている）。
  // タイムライン・プレビュー・再生は今までどおり「外」＝押したら完了。
  useDismissOnOutside(sel.editingId != null, () => sel.setEditingId(null), {
    inside: '.telop-editor, [data-editor-safe]'
  })
  // 再生を始めたときも完了にする（押した先が無いので上の見張りには掛からない）
  useEffect(() => {
    if (playing && sel.editingId != null) sel.setEditingId(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, sel.editingId])
  // 素材を読み込んだ直後に一度だけ全体表示にする。
  // 既定の拡大率のままだと、15秒の素材に対して目盛りが50秒まで伸びていて、
  // クリップが左端の小さな塊に見える。開いた瞬間から作業できる状態にする。
  const didFitForRef = useRef<string | null>(null)
  useEffect(() => {
    if (!videoPath || videoDuration <= 0) return
    if (didFitForRef.current === videoPath) return
    didFitForRef.current = videoPath
    if (takeRestoredView()) return // 前回の見ていた場所を戻したなら、上書きしない
    // 切片のレイアウトが確定してから測る
    const t = window.setTimeout(fitTimelineZoom, 60)
    return () => window.clearTimeout(t)
  }, [videoPath, videoDuration])
  // 素材のドラッグはウィンドウ全体で受け取る（1pxでも取りこぼすと駐禁が出る）。
  // 実体と理由は state/useWindowDrop
  useWindowDrop()
  // プロジェクトの開く・保存・復元は state/useProjectFile
  //（拾い忘れた項目はエラーも出ずに消えるので、1か所にまとめてある）
  const { projectJson } = useProjectFileCtx()
  // 覚えておく物は3つ。**この順に呼ぶこと**（2026-08-03 に1つを3つへ分けた）。
  //
  // 効果（useEffect）は**宣言した順**に走る。いちばん上の「作業位置を覚える」は
  // 「1つ前の描画の ref」を見て中身があるか判断しているので、**写し取りをする
  // useHistoryCoalesce を先に呼ぶと、起動直後に空でセッションを上書きしうる。**
  // 同じ型の事故を1度やっていて、e2e が `7613 → 0` で捕まえた
  //（16-仕上げ「前回の続きを開くと、タイムラインの横位置も戻る」）。
  useSessionMemory()
  useHistoryCoalesce()
  useAutosaveDraft()
  projectJsonRef.current = projectJson
  // メインからの知らせ（進み具合・更新・関連付けで開く）は state/useMainEvents。
  // **ここで呼ぶのは、下書きに書く projectJson が出来た後だから。**
  useMainEvents()
  useKeyboard()
  // 帯を右クリック。**選んでいない物を押したときだけ**選び直す（前の選択が残っていると、
  // 押した物ではない方へ操作が飛ぶ）。**既に選ばれている物なら選択はそのまま残す**——
  // 常に1つへ潰していたので「まとめて選ぶ → 右クリック → ネストする」が成立しなかった。
  // テロップ側（useTimelineDrag の onClipContextMenu）は元からこの形。
  const openClipMenu: OpenClipMenu = (e, kind, clip) => {
    e.preventDefault()
    e.stopPropagation()
    const cur = { vclip: selectedVClipIds, se: selectedSeIds, seg: selectedVideoIds, img: selectedImgIds }[kind]
    if (!cur?.includes(clip.id)) {
      if (kind === 'vclip') setSelectedVClipIds([clip.id])
      else if (kind === 'se') setSelectedSeIds([clip.id])
      else if (kind === 'seg') {
        // 本編の切片は「映像だけ選ぶ」。画像の選択は必ず落とす
        // （両方選んだまま品書きを出すと、削除が画像まで巻き込む）
        setSelectedVideoIds([clip.id])
        setSelectedImgIds([])
      } else setSelectedImgIds([clip.id])
    }
    setMenu(null)
    setClipMenu({ x: e.clientX, y: e.clientY, kind, id: clip.id, name: clip.name })
  }
  // タイムラインは**操作の入口**と**見え方**で心臓を分けてある——描き直しの理由を
  // 混ぜないため（1つだと、掴んで影が動くたびに操作の入口も「変わった」ことになる）。
  // **どちらも中身は心臓側で集める**
  const timelineOps = useTimelineOpsValue({ openClipMenu })
  // タイムラインの見え方。**中身は心臓側で集める**（state/timelineViewContext）
  const timelineView = useTimelineViewValue()
  // プレビュー（中央の映像）。**中身は心臓側で集める**（state/previewContext）
  const previewCtx = usePreviewCtxValue({ resetCount })
  // 左パネル。**中身は心臓側で集める**（state/leftPanelContext）
  const leftPanel = useLeftPanelValue({ resetCount })
  // 右パネル。**中身は心臓側で集める**（state/rightPanelContext）
  const rightPanel = useRightPanelValue({ addMediaAtPlayhead })
  // 画面の上端（メニュー・題名・更新の帯）。**中身は心臓側で集める**（state/headerContext）
  const header = useHeaderValue({ changeRatio })
  // 右クリックの品書き。**中身は心臓側で集める**（state/menusContext）
  const menus = useMenusValue()
  // 画面に覆いかぶさる物。**中身は心臓側で集める**（state/dialogsContext）
  const dialogs = useDialogsValue()
  return {
    appVersion, autosaveNg, cues, dialogs, dragTip, header, isPopped, leftPanel,
    menus, paneGeom, playRateUI, previewCtx, ratio, rightPanel, startResize, timelineOps,
    timelineView, tool, unpopPane, selectedIds, selectedVideoIds, selectedAudioIds, selectedSeIds,
    selectedImgIds, selectedVClipIds, selectedTrans, selectedTelopTrans, selectedMarkerId,
    selectedTrackId, currentTime, fps
  }
}
