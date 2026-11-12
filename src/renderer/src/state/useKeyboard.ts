// キーを押したときに何が起きるか。
//
// ## 2段構えになっている理由
//
//   受けるかどうか … shared/keymap（文字を打っている最中は通さない、等）
//   何をするか     … ここ（割り当て名 → 実際の操作）
//
// 割り当て表そのもの（既定・一覧・表記）は shared/shortcuts にある。
//
// ## ref 越しに呼んでいるのはなぜか
//
// **窓に付ける聞き耳は一度きりにしたい。** 操作の中身は毎回の描き直しで
// 作り直されるので、聞き耳を張り替える作りにすると、押した瞬間に
// 古い中身が動くことがある。ref に最新を入れておき、聞き耳からは
// ref を読むだけにすれば、張り替えずに常に最新が動く。
//
// ## 「削除」が2つある
//
//   del       … 消すだけ。空いた所はそのまま残る
//   rippleDel … 消して詰める
//
// **どちらも、選んでいる物の種類で行き先が変わる。** 素材ビンで選んで
// いるならビンの素材、目印なら目印……と上から順に見る。以前ここが
// 素通りして、見ていない場所のクリップが消える事故があった。

import { useEffect, useRef } from 'react'
import { blursOnEnter, resolveShortcut, shouldBlur } from '../../../shared/keymap'
import type { ShortcutId, Shortcuts } from '../../../shared/shortcuts'
import { useDoc } from './contentContext'
import { useSel } from './selectionContext'
import { usePlaybackStableCtx } from './playbackContext'
// 下は `useKeyboardDeps` が集める先。**配線を通さず自分で見に行く**（2026-08-04）
import { useAppChromeCtx } from './appChromeContext'
import { useAskCtx } from './askContext'
import { useAttrCopyCtx } from './attrCopyContext'
import { useAutosaveMarkCtx } from './autosaveMarkContext'
import { useCopyPasteCtx } from './copyPasteContext'
import { useExportCtx } from './exportContext'
import { useExportRunCtx } from './exportRunContext'
import { useIconLibraryCtx } from './iconLibraryContext'
import { useIconsCtx } from './iconsContext'
import { useHistoryCtx } from './historyContext'
import { useMarkersCtx } from './markersContext'
import { useMotionCtx } from './motionContext'
import { useMediaDropCtx } from './mediaDropContext'
import { usePlaybackEngineCtx } from './playbackEngineContext'
import { useProjectFileCtx } from './projectFileContext'
import { useProjectTemplatesCtx } from './projectTemplatesContext'
import { useShortcutPrefsCtx } from './shortcutPrefsContext'
import { useViewNavCtx } from './viewNavContext'
import { useTelopAnimCtx } from './telopAnimContext'
import { useTelopEditCtx } from './telopEditContext'
import { useTimelineEditCtx } from './timelineEditContext'
import { useTimelineSpanCtx } from './timelineSpanContext'
import { useTracksAdminCtx } from './tracksAdminContext'
import { useTransitionsCtx } from './transitionsContext'

export interface UseKeyboardDeps {
  /** いま押せる状態か。何かを開いている間は Esc 以外を通さない */
  modalOpen: boolean
  /** 割り当てを取り込んでいる最中（環境設定でキーを待っている） */
  capturing: boolean
  /** 書き出し中。ここが真だと書き出しキーを受けない */
  exporting: boolean
  shortcuts: Shortcuts

  setTool: (t: 'select' | 'razor') => void
  toggleSnap: () => void

  togglePlay: () => void
  shuttleForward: () => void
  shuttleReverse: () => void
  stopPlayback: () => void
  seekTo: (t: number) => void
  /** 中身の終わり。末尾へ飛ぶときは尺ではなくこちらを使う */
  contentEndRef: React.MutableRefObject<number>

  copyAttributes: () => void
  pasteAttributes: () => void
  copySelected: () => void
  cutSelected: () => void
  pasteClipboard: () => void
  undo: () => void
  redo: () => void

  removeMedia: (id: number) => void
  deleteMarker: (id: number) => void
  deleteSelectedTrans: () => void
  deleteSelectedTelopTrans: () => void
  deleteTrack: (id: string) => void
  /**
   * 選んでいる物を消す／消して詰める／複製する。**右クリックの品書きと同じ物**
   *（state/useSelectionEdit。種類ごとの振り分けはあちらに1つ）
   */
  deleteSelection: () => void
  rippleDeleteSelection: () => void
  /** 帯の上の◆を消す（選んでいる◆があるとき。state/useMotion） */
  removeKeyAtTime: (target: { kind: 'telop' | 'video' | 'img' | 'vclip'; id: number }, t: number) => void
  duplicateSelection: () => void
  rippleToPrevCut: () => void
  rippleToNextCut: () => void

  cutAtPlayhead: () => void
  addTelop: () => void
  addMarkerAtPlayhead: () => void

  saveProjectFn: () => void | Promise<void>
  openProjectFn: () => void | Promise<void>
  openExportDialog: () => void
  /** タイムラインを寄せる／引く（**軸は再生ヘッド**。式は state/useViewNav） */
  zoomAtPlayhead: (dir: 1 | -1) => void
}

/**
 * 要る47個を**心臓から自分で集める**（2026-08-04）。
 *
 * 前は配線（`useAppWiring`）が47個を取り出して渡していた。**1つ残らず
 * 素通し**で、配線はキーの話を何も決めていなかった（`npm run passthrough` の①）。
 *
 * **開いている間は Esc 以外を通さない**の判定だけはここで組む。
 * 「何かが開いている」は8か所に散っているので、**足したらここへも足すこと**
 * ——忘れると、その窓を開けている間だけ裏のタイムラインが勝手に動く。
 */
function useKeyboardDeps(): UseKeyboardDeps {
  // 拡大（= / -）。**軸は再生ヘッド**（式は state/useViewNav に1つだけ）
  const { zoomAtPlayhead } = useViewNavCtx()
  const { shortcuts, prefsOpen, capturingId } = useShortcutPrefsCtx()
  const { setTool, toggleSnap } = useAppChromeCtx()
  const { togglePlay, shuttleForward, shuttleReverse, stopPlayback, seekTo } =
    usePlaybackEngineCtx()
  const { contentEndRef } = useTimelineSpanCtx()
  const { copySelected, pasteClipboard } = useCopyPasteCtx()
  const { copyAttributes, pasteAttributes } = useAttrCopyCtx()
  const {
    cutSelected, deleteSelection, rippleDeleteSelection, duplicateSelection,
    rippleToPrevCut, rippleToNextCut, cutAtPlayhead
  } = useTimelineEditCtx()
  const { undo, redo } = useHistoryCtx()
  const { removeMedia } = useMediaDropCtx()
  const { deleteMarker, addMarkerAtPlayhead } = useMarkersCtx()
  const { removeKeyAtTime } = useMotionCtx()
  const { deleteSelectedTrans } = useTransitionsCtx()
  const { deleteSelectedTelopTrans } = useTelopAnimCtx()
  const { deleteTrack } = useTracksAdminCtx()
  const { addTelop } = useTelopEditCtx()
  const { saveProjectFn, openProjectFn } = useProjectFileCtx()
  const { openExportDialog } = useExportRunCtx()
  const { restorePrompt } = useAutosaveMarkCtx()
  const { templatePicker } = useProjectTemplatesCtx()
  const { cropSrc } = useIconLibraryCtx()
  const { showExportDialog, exportStatus } = useExportCtx()
  const { promptState, confirmState } = useAskCtx()
  const { iconSettingsOpen } = useIconsCtx()
  return {
    modalOpen: !!(
      restorePrompt || templatePicker || cropSrc || showExportDialog ||
      prefsOpen || promptState || confirmState || iconSettingsOpen
    ),
    capturing: !!capturingId,
    exporting: !!exportStatus,
    shortcuts,
    setTool, toggleSnap,
    togglePlay, shuttleForward, shuttleReverse, stopPlayback, seekTo, contentEndRef,
    copyAttributes, pasteAttributes, copySelected, cutSelected, pasteClipboard, undo, redo,
    removeMedia, deleteMarker, deleteSelectedTrans, deleteSelectedTelopTrans, deleteTrack,
    deleteSelection, rippleDeleteSelection, duplicateSelection, removeKeyAtTime,
    rippleToPrevCut, rippleToNextCut,
    cutAtPlayhead, addTelop, addMarkerAtPlayhead,
    saveProjectFn, openProjectFn, openExportDialog, zoomAtPlayhead
  }
}

export function useKeyboard(): void {
  const deps = useKeyboardDeps()
  const { cues, segments, seClips, imgClips, vClips } = useDoc()
  const {
    setSelectedIds, setSelectedVideoIds, setSelectedAudioIds,
    setSelectedSeIds, setSelectedImgIds, setSelectedVClipIds,
    selectedTrans, selectedTelopTrans, selectedTrackId, selectedMarkerId, selectedMediaId,
    selectedKey, setSelectedKey, setEditingId, clearAll: clearAllSelections
  } = useSel()
  const { currentTimeRef, durationRef, fpsRef } = usePlaybackStableCtx()

  // **中身は毎回作り直されるが、聞き耳は張り替えない。** ref に最新を入れる
  const keyHandlerRef = useRef<(e: KeyboardEvent) => void>(() => {})
  keyHandlerRef.current = (e: KeyboardEvent): void => {
    const el = e.target as HTMLElement | null
    const target = { tag: el?.tagName, type: (el as HTMLInputElement | null)?.type }
    // 数値欄は Enter で確定したら手放す（その後の Ctrl+Z をアプリへ届かせる。shared/keymap）。
    // キーそのものは止めない——欄や囲いが Enter を見ていることがある
    if (blursOnEnter(target, e.key)) el?.blur()
    const id = resolveShortcut(e, target, {
      shortcuts: deps.shortcuts,
      capturing: deps.capturing,
      exporting: deps.exporting,
      modalOpen: deps.modalOpen
    }) as ShortcutId | null
    if (!id) return
    e.preventDefault()
    if (shouldBlur(target)) el?.blur()

    const dispatch: Record<ShortcutId, () => void> = {
      toolSelect: () => deps.setTool('select'),
      toolRazor: () => deps.setTool('razor'),
      toggleSnap: () => deps.toggleSnap(),
      playPause: () => deps.togglePlay(),
      shuttleFwd: () => deps.shuttleForward(),
      shuttleStop: () => deps.stopPlayback(),
      shuttleRev: () => deps.shuttleReverse(),
      gotoStart: () => {
        deps.stopPlayback()
        deps.seekTo(0)
      },
      gotoEnd: () => {
        deps.stopPlayback()
        deps.seekTo(deps.contentEndRef.current || durationRef.current)
      },
      frameBack: () => {
        deps.stopPlayback()
        deps.seekTo(currentTimeRef.current - 1 / fpsRef.current)
      },
      frameFwd: () => {
        deps.stopPlayback()
        deps.seekTo(currentTimeRef.current + 1 / fpsRef.current)
      },
      frameBack5: () => {
        deps.stopPlayback()
        deps.seekTo(currentTimeRef.current - 5 / fpsRef.current)
      },
      frameFwd5: () => {
        deps.stopPlayback()
        deps.seekTo(currentTimeRef.current + 5 / fpsRef.current)
      },
      attrCopy: () => deps.copyAttributes(),
      attrPaste: () => deps.pasteAttributes(),
      del: () => {
        // D は「削除」。以前は動画=映像なし化・音声=消音 だったが、
        // ユーザーの期待どおり“残さず消す”に統一した（Undo で戻せる）。
        // 素材ビンで選んでいるときはビンの素材を消す。以前はここが素通りして
        // 見ていない場所（タイムライン）のクリップが消えていた。
        if (selectedMediaId != null) {
          deps.removeMedia(selectedMediaId)
          return
        }
        // 帯の上の◆を選んでいるなら、**その◆だけ**を消す（テロップは消さない）。
        // 前は◆を押すと下のテロップが選ばれ、Delete でテロップごと消えた（2026-11-12）
        if (selectedKey) {
          const { t, ...target } = selectedKey
          deps.removeKeyAtTime(target as never, t)
          setSelectedKey(null)
          return
        }
        if (selectedMarkerId != null) {
          deps.deleteMarker(selectedMarkerId)
          return
        }
        if (selectedTrans) {
          deps.deleteSelectedTrans()
          return
        }
        if (selectedTelopTrans) {
          deps.deleteSelectedTelopTrans()
          return
        }
        if (selectedTrackId) {
          deps.deleteTrack(selectedTrackId)
          return
        }
        // 選んでいる物を全種類消す（空きを選んでいれば詰める。本編は空きが残る）。
        // **右クリックの「削除」と同じ物**（state/useSelectionEdit の deleteSelection）
        deps.deleteSelection()
      },
      rippleDel: () => {
        // ◆を選んでいるなら、F でも◆だけ（Delete と同じ。詰める物ではないので）
        if (selectedKey) {
          const { t, ...target } = selectedKey
          deps.removeKeyAtTime(target as never, t)
          setSelectedKey(null)
          return
        }
        if (selectedMarkerId != null) {
          deps.deleteMarker(selectedMarkerId)
          return
        }
        if (selectedTrans) {
          deps.deleteSelectedTrans()
          return
        }
        if (selectedTelopTrans) {
          deps.deleteSelectedTelopTrans()
          return
        }
        if (selectedTrackId) {
          deps.deleteTrack(selectedTrackId)
          return
        }
        // 空き・選んでいる物・再生ヘッドの空き、の順に詰める。**右クリックの
        // 「削除して詰める」と同じ物**（state/useSelectionEdit の rippleDeleteSelection）
        deps.rippleDeleteSelection()
      },
      rippleToPrevCut: () => deps.rippleToPrevCut(),
      rippleToNextCut: () => deps.rippleToNextCut(),
      selectAll: () => {
        // 全種別を選択（テロップだけでなく動画切片/SE/画像も。Ctrl+A→Deleteで全消しできる）
        // clearSegSel だけではトラック選択が残り、Delete がトラック削除に化けて
        // 「中身のあるトラックは削除できません」だけ出て何も消えなくなる。
        clearAllSelections()
        setSelectedIds(cues.map((c) => c.id))
        setSelectedVideoIds(segments.map((s) => s.id))
        setSelectedAudioIds(segments.map((s) => s.id))
        setSelectedSeIds(seClips.map((c) => c.id))
        setSelectedImgIds(imgClips.map((c) => c.id))
        setSelectedVClipIds(vClips.map((c) => c.id))
      },
      deselect: () => {
        // リフレーム枠も閉じる（以前は「✓ 完了」ボタンだけが閉じる手段で、
        // Escape では抜けられずプレビュー上のホイールが拡大縮小になり続けた）
        clearAllSelections()
        setEditingId(null) // 編集オーバーレイも閉じる
      },
      undo: () => deps.undo(),
      redo: () => deps.redo(),
      copy: () => deps.copySelected(),
      cut: () => deps.cutSelected(),
      paste: () => deps.pasteClipboard(),
      // **右クリックの「複製」と同じ物**（state/useSelectionEdit の duplicateSelection）。
      // 前はここに同じ処理の写しがあり、「組」の番号を振り直していなかった
      duplicate: () => deps.duplicateSelection(),
      // 何も選んでいなければ再生ヘッドの位置を全部、選んでいればその物だけ。
      // 判断は cutAtPlayhead が1か所で持つ（ここで種類ごとに分けない）
      split: () => deps.cutAtPlayhead(),
      addTelop: () => deps.addTelop(),
      addMarker: () => deps.addMarkerAtPlayhead(),
      saveProject: () => void deps.saveProjectFn(),
      openProject: () => void deps.openProjectFn(),
      exportVideo: () => {
        if (deps.exporting) return // 書き出し中は受け付けない
        deps.openExportDialog()
      },
      // **軸は再生ヘッド**（`state/useViewNav` の zoomAtPlayhead）。
      // ホイールはカーソル基準のまま——手がマウスに無い入口では狙えないので分けてある
      zoomIn: () => deps.zoomAtPlayhead(1),
      zoomOut: () => deps.zoomAtPlayhead(-1)
    }
    dispatch[id]()
  }

  useEffect(() => {
    const h = (e: KeyboardEvent): void => keyHandlerRef.current(e)
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])
}
