import { toGcUrl } from './lib/gcUrl'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  PanelTabs,
  PaneHost,
  TabSortList,
  readPaneGeometry,
  type PaneGeom
} from './components/PanelChrome'
import { parseSrt, buildSrt, formatTime, type Cue } from './lib/srt'
import {
  anchorFrac,
  buildTelopSVG,
  computeTelopAnim,
  telopStateAt,
  hasMotion,
  sanitizeMotion,
  defaultAnim,
  defaultTelopStyle,
  hasAnim,
  hexToRgba,
  type AnimIn,
  type Motion,
  type TelopAnim,
  type TelopStyle
} from './lib/telopStyle'
// 取り込んで置いてある動きの見本帳（motion-presets/*.json の1件ぶん）
import type { MotionPresetFile, MotionKeyName } from '../../shared/telopMotion'
import { BUILTIN_MOTIONS } from '../../shared/builtinMotions'
import { shouldCut, spansCut } from '../../shared/cutScope'
import { keyDelta, neutralOf } from '../../shared/nudgeShare'
import {
  BUILTIN_TEMPLATES,
  loadUserTemplates,  TELOP_CATS,
  loadFavorites,
  saveFavorites,
  loadCatOverrides,
  saveCatOverrides,
  colorCatOf,
  loadCustomCats,
  saveCustomCats,
  type TelopTemplate
} from './lib/telopTemplates'
import { DEFAULT_LABEL } from './lib/labels'
import { renderCueToPng } from './lib/rasterize'
import { fileToDataUrl } from './lib/people'
import {
  loadIconLibrary,
  saveIconLibrary,
  loadIconAssign,
  saveIconAssign,
  type IconItem
} from './lib/iconLibrary'
import type { UpdateState } from '../../preload/index.d'
import {
  Toasts,
  PromptModal,
  ConfirmModal,
  type Toast,
  type PromptState,
  type ConfirmState
} from './components/Overlays'
import {  SilenceCutDialog,
  DuckingDialog
} from './components/dialogs/AudioDialogs'
import {
  ExportSettingsDialog,
  ExportProgressBox,
  RestorePrompt,
  TemplatePicker,
  type RestoreState,
  type ExportOpts
} from './components/dialogs/ProjectDialogs'
import {
  ShortcutSettings,
  IconAssignSettings
} from './components/dialogs/SettingsDialogs'
import {
  SubtitleDialog,
  type SubtitleModel,
  type SubtitlePhase
} from './components/dialogs/SubtitleDialog'
import { ContextMenu } from './components/ContextMenu'
import { StatusBar } from './components/StatusBar'
import { MenuBar } from './components/MenuBar'
import { TelopTemplatesTab } from './components/panels/TelopTemplatesTab'
import { TransitionsTab } from './components/panels/TransitionsTab'
import { ProjectBinTab } from './components/panels/ProjectBinTab'
import { MotionTab, type MotionRow } from './components/panels/MotionTab'
import { PropertiesPanel, RESET_TRANSFORM } from './components/panels/PropertiesPanel'
import {
  AudioMixer,
  PreviewScrub,
  TransportBar,
  TransportInfo,
  type PreviewRes
} from './components/panels/PreviewBars'
import { TimelineToolbar } from './components/timeline/TimelineToolbar'
import { TrackHeaders } from './components/timeline/TrackHeaders'
import { TimeRuler, Marquee, MarkerFlags, Playhead } from './components/timeline/Ruler'
import type { Adjust, Crop } from './components/panels/PropertyRows'
import { SeLibraryTab, seMoveTarget } from './components/panels/SeLibraryTab'
import { IconLibraryTab, ICON_LIB } from './components/panels/IconLibraryTab'
import CropModal from './components/CropModal'
import StylePanel from './components/StylePanel'
import TelopText from './components/TelopText'
// ※ここに「検査票（手で確認するチェックリスト）」を読み込んでいたが、
// 確認は e2e（npm run e2e / presets）で機械が回すようになったので丸ごと外した。
// 手で潰す表と機械で回す表が2つあると、必ず片方が古くなる。
// 動きの計測（Ctrl+Shift+P）。**配布ビルドでも出せる**。
// カクつきが起きるのは配った先の実アプリなので、開発中しか測れないと意味が無い。
const PerfHud = lazy(() => import('./dev/PerfHud'))
import { perf } from './lib/perfMonitor'
import { applyTimelineVScroll, centeredScrollTop } from './lib/timelineVScroll'
// 時間計算はすべて shared/timeline に集約（ズレの一元管理）。
// ここに同じ計算を書き直さないこと。不変条件は timeline.test.ts が守っている。
import {
  clamp,
  cutRange,
  FPS_FALLBACK,
  fadeGain,
  formatTimecode,
  layoutSegs,
  moveSegTo,
  moveSegsTo,
  qFrame,
  rippleEnd,
  rippleShifted,
  rippleStart,
  segSpeed,
  segTLen,
  tidyGaps,
  tToSource,
  totalSegLen,
  xfadeDurAt,
  type Layout,
  type SegOps,
  type SplitSeg
} from '../../shared/timeline'
import { totalCutLen } from '../../shared/silenceCut'
// キーフレーム（時間で変わる値）。プレビューも書き出しも同じ計算を使う
import { valueAt, putKey, removeKey, hasKeys, type Keys } from '../../shared/keyframes'
import { nextOpenSecs } from '../../shared/accordion'
import { ensureMinShow, mergeShreds, splitAtPauses } from '../../shared/splitTelop'
import { alignCues, speechRanges } from '../../shared/alignCues'
import { LeftPanel } from './components/LeftPanel'
import { LayoutProvider, useLayout } from './state/layoutContext'
import type { PaneId } from './state/usePanelLayout'
import { SelectionProvider, useSel } from './state/selectionContext'
import { ContentProvider, useDoc } from './state/contentContext'
import { useTracks } from './state/useTracks'
import { useView } from './state/useView'
import { useToast } from './state/useToast'
import { TracksProvider, useTracksCtx } from './state/tracksContext'
import { ViewProvider, useViewCtx } from './state/viewContext'
import { useTelopLook } from './state/useTelopLook'
import { useAsk } from './state/useAsk'
import { useMarkers } from './state/useMarkers'
import { useSnap } from './state/useSnap'
import { useShortcutPrefs } from './state/useShortcutPrefs'
import { useSeAudio } from './state/useSeAudio'
import { useVideoEls } from './state/useVideoEls'
import { useVClipEls } from './state/useVClipEls'
import { useMediaMeta } from './state/useMediaMeta'
import { useProxy } from './state/useProxy'
import { useSilenceDuck } from './state/useSilenceDuck'
import { useCurrentLook } from './state/useCurrentLook'
import { useWindowDrop } from './state/useWindowDrop'
import { useAutosaveMark } from './state/useAutosaveMark'
import { TELOP_MOTIONS, motionLabel, useLabelsPresets } from './state/useLabelsPresets'
import { useTrackGeom } from './state/useTrackGeom'
import { useMainEvents } from './state/useMainEvents'
import { useTimelineSpan } from './state/useTimelineSpan'
import { useBandDrag } from './state/useBandDrag'
import { useAppChrome, type Tool } from './state/useAppChrome'
import type { Ratio } from './state/useExportSettings'
import { useSubtitlePrefs } from './state/useSubtitlePrefs'
import { useTimelineBox } from './state/useTimelineBox'
import { useTemplateShelf } from './state/useTemplateShelf'
import { useSegLayout } from './state/useSegLayout'
import { kindOf, useSegOps } from './state/useSegOps'
import { useNowShowing } from './state/useNowShowing'
import { useTimelineWheel } from './state/useTimelineWheel'
import { useDismissOnOutside } from './state/useDismissOnOutside'
import { EMPTY_DRAG_IMG, setDragChip } from './lib/dragChip'
import {
  AUTOSAVE_MS, FPS, RECENT_KEY, RECENT_MAX, RULER_H, TRACK_PAD_ROWS, XF_GRACE, gainToDb
} from './lib/appConst'
import { TRACK_H_MAX, TRACK_H_MIN } from './state/useLaneHeights'
import type { MediaItem } from './components/panels/ProjectBinTab'
import { useViewNav } from './state/useViewNav'
import { useTransitions } from './state/useTransitions'
import { useMotion } from './state/useMotion'
import { useTimelineEdit } from './state/useTimelineEdit'
import { useTracksAdmin } from './state/useTracksAdmin'
import { useMediaDrop } from './state/useMediaDrop'
import { usePreviewManip } from './state/usePreviewManip'
import { useIconLibrary } from './state/useIconLibrary'
import { useProjectIO } from './state/useProjectIO'
import { AppMenus } from './components/AppMenus'
import { usePlaybackEngine } from './state/usePlaybackEngine'
import { usePreviewFrame } from './state/usePreviewFrame'
import { useVideoSync } from './state/useVideoSync'
import { useSessionMemory } from './state/useSessionMemory'
import { useVisibleRange } from './state/useVisibleRange'
import { useSelectionCleanup } from './state/useSelectionCleanup'
import { useDiagnostics } from './state/useDiagnostics'
import { useAppLayout } from './state/useAppLayout'
import { useLibraries } from './state/useLibraries'
import { useSegmentPlace } from './state/useSegmentPlace'
import { TimelineOpsProvider, type TimelineOps } from './state/timelineOpsContext'
import { TimelineViewProvider, type TimelineView } from './state/timelineViewContext'
import { TimelineArea } from './components/timeline/TimelineArea'
import { PreviewProvider, type PreviewCtxValue } from './state/previewContext'
import { PreviewArea } from './components/panels/PreviewArea'
import { RightPanelProvider, type RightPanelValue } from './state/rightPanelContext'
import { RightPanelArea } from './components/panels/RightPanelArea'
import { AppHeader } from './components/panels/AppHeader'
import { DialogsProvider, type DialogsValue } from './state/dialogsContext'
import { AppDialogs } from './components/panels/AppDialogs'
// 寄れる限界。バー・ホイール・フィットで同じ物を使う
import { ZOOM_MAX, ZOOM_MIN, clampZoom } from './state/useView'
import { ToasterProvider, useToastCtx } from './state/toastContext'
import { useEdit } from './state/useEdit'
import { IconsProvider, useIconsCtx } from './state/iconsContext'
import { ExportProvider, useExportCtx } from './state/exportContext'
import { MediaProvider, useMediaCtx } from './state/mediaContext'
import { useHistory, type Snap } from './state/useHistory'
import { useExport } from './state/useExport'
import { useSubtitles } from './state/useSubtitles'
import { useMediaOps } from './state/useMediaOps'
import { loadJson, loadRecentProjects, useProjectState } from './state/useProjectState'
import { ProjectStateProvider, useProjectStateCtx } from './state/projectStateContext'
import { DEFAULT_TRACKS, EXTRA_AUDIO_TRACK, initTrackStates, newTrackState } from './lib/trackState'
import { useProjectFile } from './state/useProjectFile'
import { useDragPreview } from './state/useDragPreview'
import { DragPreviewProvider, useDragPreviewCtx } from './state/dragPreviewContext'
import { useCopyPaste } from './state/useCopyPaste'
import { useTelopEdit } from './state/useTelopEdit'
import { ClipboardProvider, useClipboardCtx, type CopiedAttrs } from './state/clipboardContext'
import { useClipDrag } from './state/useClipDrag'
import { useLaneHeights } from './state/useLaneHeights'
import { usePlayback } from './state/usePlayback'
import { PlaybackProvider, usePlaybackCtx } from './state/playbackContext'
import { nearestSnap } from '../../shared/snap'
import { collapseAt, shiftRange, shiftStart } from '../../shared/ripple'
import { useKeyboard } from './state/useKeyboard'
import { useTelopBox } from './state/useTelopBox'
import { useLaneGeometry } from './state/useLaneGeometry'
import { useTimelineDrag } from './state/useTimelineDrag'
import { useSegmentDrag } from './state/useSegmentDrag'
import {
  ProgressBadges,
  ReframeBox,
  ScreenEmpty,
  TelopEditor
} from './components/panels/PreviewOverlays'
import { ImageLayers, TelopLayer, VideoLayers } from './components/panels/PreviewLayers'
import { TransitionBands } from './components/timeline/TransitionBands'
import {
  ImageGhost,
  SeGhost,
  TransDropGhost,
  VideoAudioGhost,
  VideoGhost
} from './components/timeline/DropGhosts'
import {
  ImageBand,
  VideoLayerAudioBand,
  VideoLayerBand
} from './components/timeline/OverlayClipBands'
import type { OpenClipMenu } from './components/timeline/ClipBand'
import { TelopBands, TelopDropGhost } from './components/timeline/TelopBands'
import { MainAudioBands, MainVideoBands } from './components/timeline/MainClipBands'
import { SeBands } from './components/timeline/SeBands'
import { ACTION_LIST, formatCombo } from '../../shared/shortcuts'
import { dragModeOf, movedEnough, type SegDropMode } from '../../shared/dragMode'
import {
  dropLaneAt as dropLaneIn,
  laneAtY as laneAtYIn,
  laneRows,
  type LaneRow
} from '../../shared/lanes'
import { splitAt, toggleSelect, trimLeft, trimRight } from '../../shared/clipEdit'
import { mediaQueue, rafThrottle } from './lib/schedule'
import {
  loadCues,
  loadSegs,
  loadSeClips,
  loadMarkers,
  loadImgClips,
  loadVClips
} from './lib/projectLoad'
import type {
  ReframeTarget,
  Marker,
  VSeg,
  Source,
  Track,
  TrackState,
  SEClip,
  ImgClip,
  VClip,
  SegLayout
} from './lib/projectTypes'
import {
  DEFAULT_ZOOM,
  DEFAULT_CROP,
  DEFAULT_ADJUST,
  isNeutralZoom,
  isNeutralCrop,
  isNeutralAdjust,
  cropInset,
  adjustCss
} from './lib/clipLook'
import { TRANS_TYPES, dipColor } from './lib/transitions'
import type { TransType, SegTrans } from './lib/transitions'
import { DB_LADDER, enoughSilences } from '../../shared/silenceLadder'
import {
  zoomAt,
  hasClipMotion,
  sanitizeClipMotion,
  MIN_MOTION_SCALE,
  type ClipMotion
} from '../../shared/clipMotion'
// 書き出しに渡す中身の組み立て（画面に依らない・単体で確かめてある）
import { buildExportPayload } from '../../shared/exportPayload'
// 押されたキーをどの操作に割り当てるか（受ける/受けないの判断もこちら）
import { resolveShortcut, shouldBlur } from '../../shared/keymap'
// テンプレートを開いたとき、いまの設定とどう混ぜるか（置き換えない）
import {
  mergeFavorites,
  mergeAssignments,
  mergeFolders,
  mergeNamed
} from '../../shared/templateMerge'
// ビンの素材が使用中か（＝クリップが残っているか）の判定
import { mediaInUse, staleSourceIds } from '../../shared/mediaBin'
import { envToFfmpegExpr } from '../../shared/ducking'

// 初期トラック（映像は先頭に連続、音声はその後に連続）。+ボタンで増やせる。
// 既定で用意する追加音声トラック（クイック追加ボタンの対象・旧プロジェクト補完先）

// キーボードの割り当て表は shared/shortcuts.ts（既定・一覧・見やすい表記）



/**
 * 画面の中身。
 *
 * **囲い（App）と分けてあるのは、配置を context から見に行くため。**
 * 同じ部品の中で囲いを作ると、その部品自身は中を見に行けない。
 */
function AppInner(): JSX.Element {
  // 掴んでいる最中に出す物（影・吹き出し・吸い付きの線・囲い）と、コピーの控え
  const {
    seGhost, setSeGhost, videoGhost, setVideoGhost, imgGhost, setImgGhost,
    snapLineX, setSnapLineX, dragTip, setDragTip, marquee, setMarquee,
    overwriteIds, setOverwriteIds
  } = useDragPreviewCtx()
  const {
    clipboardRef, clipboardSeRef, clipboardImgRef, clipboardVcRef, lastCopyRef,
    copiedAttrs, setCopiedAttrs
  } = useClipboardCtx()
  // プロジェクトの持ち物と設定（更新しても消えてはいけない物が多い）
  const {
    projectPath, setProjectPath, srtPath, setSrtPath, missingMedia, setMissingMedia,
    recentProjects, setRecentProjects, favorites, setFavorites, catOverrides, setCatOverrides,
    customCats, setCustomCats, userTemplates, setUserTemplates, newTelopStyle, setNewTelopStyle,
    transDur, setTransDur, iconAssign, setIconAssignState, laneIconAssign, setLaneIconAssign
  } = useProjectStateCtx()
  // 素材（取り込んだ物）と元動画（いま使っている物）。videoSrc は差し替わるが
  // videoPath は原本なので差し替えない（焼き直した粗い映像で書き出さないため）
  const {
    videoSrc, setVideoSrc, videoPath, setVideoPath, videoName, setVideoName,
    videoDuration, setVideoDuration, proxyPct, setProxyPct, waveform, setWaveform,
    thumbnailSrc, setThumbnailSrc, sources, setSources, sourcesRef, sourceIdCounter,
    curSourceIdRef, activeSrcId, setActiveSrcId, mediaItems, setMediaItems, mediaIdCounter
  } = useMediaCtx()
  // 書き出しの設定と進み具合（設定はプロジェクトの一部、進み具合は画面の一部）
  const {
    ratio, setRatio, masterVolume, setMasterVolume, loudnormLUFS, setLoudnormLUFS,
    exportOpts, setExportOpts, showExportDialog, setShowExportDialog,
    exportStatus, setExportStatus, exportPct, setExportPct
  } = useExportCtx()
  // 段の高さ（種類ごと＋段ごと）。state と ref を1か所で面倒を見る
  const {
    videoTrackH, setVideoTrackH, audioTrackH, setAudioTrackH,
    videoTrackHRef, audioTrackHRef, laneH, setLaneH, laneHRef
  } = useLaneHeights()
  // 再生の「今」（時刻・流しているか・速さ）。**追いかけの仕組みは動かしていない**
  const {
    currentTime, setCurrentTime, currentTimeRef, durationRef,
    playing, setPlaying, playRateUI, setPlayRateUI, playRateRef, rafRef,
    fps, setFps, fpsRef,
    // 追いかけの時計まわりも心臓が持っている。**App で別に宣言しないこと**
    //（同じ名前の入れ物が2つできて、「消す方」と「読む方」が食い違う）
    preparedRef, clockStartWallRef, clockStartPosRef, currentSegRef,
    lastTsRef, seekCooldownRef, xfadeUntilRef, fixingDriftRef
  } = usePlaybackCtx()
  // アイコンの出し方（どちら側・ずらし・大きさ・揃えるか）
  const icons = useIconsCtx()
  const {
    iconSide, setIconSide, iconOffset, setIconOffset, iconScale, setIconScale,
    iconAuto, setIconAuto, iconAnchorPos, setIconAnchorPos,
    iconSettingsOpen, setIconSettingsOpen
  } = icons
  // 選んでいる物を書き換える操作は state/useEdit（鍵を見る決まりも中にある）
  const {
    updateSelectedImg,
    updateSelectedSE,
    updateSelectedVClip,
    patchCuePos,
    patchCueScale,
    patchMotion,
    patchClipMotion,
    clearTelopMotions,
    setSelectedAdjust,
    setSelectedCrop,
    setSegZoom,
    setImgZoom,
    setVClipZoom,
    rotateSelectedSeg,
    flipSelectedSeg,
    toggleMuteSelectedSegments,
    resetTelopChannel,
    nudgeOthers,
    setSelectedAudio,
    clearBox,
  } = useEdit()
  // 見え方（拡大率）とお知らせ
  const { zoom, setZoom, zoomRef } = useViewCtx()
  const { toasts, setToasts, showToast } = useToastCtx()
  // 段（トラック）と鍵。**鍵はあらゆる編集の手前で見る**ので心臓に置く
  const { tracks, setTracks, trackStates, setTrackStates, isLocked, toggleTrack, tracksRef, trackStatesRef } =
    useTracksCtx()
  // タイムラインの中身は state/useContent がまとめて持つ（配列と採番は一組）
  const {
    cues, setCues, segments, setSegments, segIdCounter,
    seClips, setSeClips, seIdCounter, imgClips, setImgClips, imgIdCounter,
    vClips, setVClips, vClipIdCounter, markers, setMarkers, markerIdCounter,
    cuesRef, segsRef, seClipsRef, imgClipsRef, vClipsRef, markersRef
  } = useDoc()
  // 選んでいる物は state/useSelection がまとめて持つ（解除の入口も1つ）
  const sel = useSel()
  const {
    selectedIds, setSelectedIds, selectedVideoIds, setSelectedVideoIds,
    selectedAudioIds, setSelectedAudioIds, selectedSeIds, setSelectedSeIds,
    selectedImgIds, setSelectedImgIds, selectedVClipIds, setSelectedVClipIds,
    selectedTrans, setSelectedTrans, selectedTelopTrans, setSelectedTelopTrans,
    selectedTrackId, setSelectedTrackId, selectedMarkerId, setSelectedMarkerId,
    editingMarkerId, setEditingMarkerId, editingId, setEditingId,
    selectedMediaId, setSelectedMediaId, videoSelected, setVideoSelected,
    isSelected, isVideoSel, isAudioSel, anySegSelected, clearSegSel
  } = sel
  const clearAllSelections = sel.clearAll
  // ---- データ ----
  // プロジェクト(.gcproj)の保存先。srtPath とは必ず別に持つ
  // （兼用にすると「上書き保存」が読み込んだSRTファイルを壊す）。
  // 開いたプロジェクトで「見つからなかった素材」。保存時に書き戻して情報を失わないため。
  // 画面の枠まわりの小さな状態（品書き・道具・マグネット・進み具合・版）は
  // state/useAppChrome。**保存しない物**をまとめてある
  const {
    menu, setMenu, clipMenu, setClipMenu, idCounter, tool, setTool, snap, toggleSnap,
    perfOpen, setPerfOpen, perfStopped, setPerfStopped, packPct, setPackPct, packBusyRef,
    updateState, setUpdateState, proxyForPathRef, initializedForPathRef, appVersion
  } = useAppChrome()
  // 字幕づくりの設定と進み具合は state/useSubtitlePrefs
  const {
    subtitleOpen, setSubtitleOpen, subtitleState, setSubtitleState,
    subMaxChars, setSubMaxChars, subReplace, setSubReplace, subModel
  } = useSubtitlePrefs()

  // ---- 編集状態 ----
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







  // ---- 動画 ----
  // videoSrc=プレビュー用（生成後は編集用プロキシ）、videoPath=書き出し用の原本パス
  // 素材の実フレームレート（読み込み時に ffprobe で取得。未取得は既定30）。
  // フレームステップ/タイムコード/カットのフレーム量子化に使う。
  const lastPaintRef = useRef(0) // 再生中の最後にsetTimeした時刻（再描画スロットル用）
  // 動画ズーム（リフレーム）は切片ごと（VSeg.zoom）。編集対象は再生ヘッド位置の切片。

  // ---- マルチソース（複数の元動画を1タイムラインに連結）----
  // sources[0]=主ソース。既存のvideoPath/videoSrc/videoDuration/fps は「現在プレビュー中のソース」を表す。
  // 各 VSeg.srcId が元動画を指す（未指定=主ソース）。プレビューは再生ヘッドのソースへ<video>のsrcを切替。
  // 表示中のソースID（描画に使うのでstate）。切替は要素の表示切替だけ＝再ロードしないのでちらつかない
  // ソースを登録した時刻（GCが「配置直前のソース」を消してしまう競合を防ぐ猶予に使う）
  const srcAddedAtRef = useRef<Map<number, number>>(new Map())
  useEffect(() => {
    sourcesRef.current = sources
  }, [sources])

  // 素材の下ごしらえ（尺・波形の控え、二重解析よけ）は state/useMediaMeta
  const { mediaMeta, setMediaMeta, mediaMetaRef, metaInFlightRef, thumbDoneRef } = useMediaMeta({ historySnaps: () => [...undoStackRef.current, ...redoStackRef.current] })
  const draggingMediaRef = useRef<MediaItem | null>(null)
  const dragSeDurRef = useRef(2) // ドラッグ中SEの尺（ゴースト幅用。dragStartでgetDurationして更新）
  // タイムラインへSE配置中の半透明ゴースト（プレミア風に配置位置を可視化）
  // タイムラインへ動画配置中のゴースト（V1）。insert=Ctrl押下（挿入モード）
  // 本編クリップを掴んで動かすときの動作（プレミア準拠）。
  //   move   = そのまま動かす（置き先を上書き。元の位置は空白になる）
  //   copy   = Alt: 複製（元はその場に残る）
  //   insert = Ctrl: 割り込み（置き先で分割して差し込み、後続は後ろへずれる）
  // 本編クリップをドラッグ中の移動先（タイムライン秒）。指を離した時に確定する。
  // state だと onUp のクロージャが古い値を見るので ref で持つ。

  // 効果音を鳴らす物（置いた物・試聴の物）は state/useSeAudio
  const { seAudioRefs, seRefCb, sePreviewRef, previewSE } = useSeAudio()


  // ---- 映像レイヤークリップ（V2以降に置く動画。ピクチャーインピクチャー／差し込み用）----
  // V1 の「切片(VSeg)」は隙間なく連結するリップル方式だが、こちらは絶対位置に置く独立クリップ。
  // 音声は必ず対になる音声トラック（V2→A2, V3→A3）に連動表示・再生される＝映像と音は常にセット。
  useEffect(() => {
    vClipsRef.current = vClips
  }, [vClips])
  // 確保済みだがまだ state に反映されていないトラックID。placeVClip は await getDuration を
  // 挟むので、2本続けてドロップすると後発が同じ番号を選んでしまう。それを防ぐための予約。
  const reservedTrackIdsRef = useRef<Set<string>>(new Set())
  // 縦ドラッグで移す先のレーン。指を離した時にだけトラックを確保する。
  const pendingLaneRef = useRef<string | null>(null)
  // 素材の置き先を決める話（落とした所・外れた所・再生ヘッド）は
  // state/useMediaDrop と state/useMediaOps

  // 映像を映す <video> の台帳（1本につきA面/B面を持つ理由も中に）は state/useVideoEls
  const { videoRef, videoBRef, videoElsRef, elKey, activeHalf, setActiveHalf, halfOf, elOf } =
    useVideoEls()


  // 「いま何を選んでいるか」と、その解除は state/useSelection
  // （解除は必ず clearAll を通す決まりも、中に書いてある）

  // ---- トラック（可変。+ボタンで増やせる）----
  // 段の数え方・太さ・どの段に居るかは state/useTrackGeom
  const {
    nVideoTracks, nAudioTracks, v1Index, a1Index,
    trackHOf, trackNum, pairedAudioOf, cueTrack, vcLen, anyAudioSolo
  } = useTrackGeom({ tracks, trackStates, laneH, videoTrackH, audioTrackH })

  // 段（トラック）の足す・消す・選ぶ・鍵・音量は state/useTracksAdmin
  const {
    trackFromEvent, mainLocked, fallbackTrack, audioTrackFromEvent, insertTrackOrdered,
    reserveTrackPairForVideo, setClipLabel, addVideoTrack, addAudioTrack, trackHasContent,
    telopLocked, trackHasContentInner, canDeleteTrack, deleteTrack, selectTrack,
    audioTrackGain, setTrackVolume, startFader, startGroupResize
  } = useTracksAdmin({
    anyAudioSolo, cueTrack, trackNum, trackHOf, nVideoTracks, nAudioTracks,
    videoTrackHRef, audioTrackHRef, setVideoTrackH, setAudioTrackH, setLaneH
  })
  // 上下の余白。段の高さを変えたら一緒に変わる。
  // 上はゆったり、下は1段ぶん。下も同じだけ取ると、その分だけ段が画面から
  // はみ出して「下がかつかつ」になる（実際にそうなった）。
  const padTop = TRACK_PAD_ROWS * videoTrackH
  const padBottom = videoTrackH
  // 段の縦位置と落とし先の判定は state/useLaneGeometry（決まりは shared/lanes）
  const { trackRows, laneAtY, dropLaneAt } = useLaneGeometry({
    videoTrackHRef,
    audioTrackHRef,
    topOffset: RULER_H + padTop
  })

  // ---- タイムラインのガイド・ツールチップ ----
  const [hoverX, setHoverX] = useState<number | null>(null)
  const lastHoverPaintRef = useRef(0) // マウスの印の間引き（下の onPointerMove を参照）

  // ---- 書き出し ----
  // 書き出し設定（解像度・fps・画質）
  // fps は 'source'＝素材と同じ（既定）。素材が60fpsなのに黙って30に落ちるのを防ぐため、
  // 実数への解決は書き出し直前に行い、main へは従来どおり数値だけを渡す。
  // 素材fps（未取得なら既定30）。29.97 のような小数もそのまま使う（main が分数で ffmpeg に渡す）
  const srcFpsForExport = (): number => (Number.isFinite(fps) && fps > 0 ? fps : FPS)
  // 表示用: 整数なら「60」、そうでなければ「29.97」
  const fpsLabel = (v: number): string => (Number.isInteger(v) ? String(v) : v.toFixed(2))
  // 書き出しに実際に使う fps（'source'＝素材と同じ）
  const resolveExportFps = (): number =>
    exportOpts.fps === 'source' ? srcFpsForExport() : exportOpts.fps
  // ---- トースト通知（OS標準alertの置き換え。右下にふわっと出て自動で消える）----
  // お知らせは state/useToast（積み上げない決まりも中にある）

  // 人に聞く（文字を入れてもらう・はい/いいえ）は state/useAsk
  const { promptState, setPromptState, confirmState, askText, askConfirm, closeConfirm } = useAsk()
  // ---- パネルの切り離し（ドッキング解除）----
  //
  // 切り抜きは「絵を見る作業」なので、プレビューを大きく取れることが要る。
  // 使わないパネルを切り離すと、そのぶん残りが自動で広がる（切り離したものは
  // 画面から浮くので、並びの計算から外れる）。掴んで動かし、右下で大きさを変える。
  const PANE_LABEL: Record<PaneId, string> = {
    left: 'プロパティ',
    right: 'プロジェクト',
    preview: 'プレビュー',
    timeline: 'タイムライン'
  }
  // 切り離した窓の中身は state/usePanelLayout（覚えさせない理由も中にある）
  // 属性のコピー／貼り付け（プレミアの「属性のペースト」相当）は state/useCopyPaste

  // ---- 最近使ったプロジェクト ----
  // 保存先を自分で覚えていないと開けない（＝どこに置いたか分からなくなる）ので、
  // 保存・読み込みのたびに覚えて、ファイルメニューからそのまま開けるようにする。
  interface RecentProject {
    path: string
    name: string
    at: number
  }
  useEffect(() => {
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(recentProjects))
    } catch {
      /* 保存できなくても動作には影響しない */
    }
  }, [recentProjects])
  // ラウドネス正規化の目標LUFS（null=OFF）。既定はYouTube最適の -14

  // ---- 右パネル（プロジェクト/テロップ/エフェクト/トランジション）----
  // 左パネルのタブ（プロパティ＝見た目の設定 / モーション＝時間で変わる動き）
  const [rightTab, setRightTab] = useState<
    'project' | 'telop' | 'icon' | 'se' | 'transition'
  >('project')
  // プレビュー内インライン編集中のテロップ（セッション保存で参照するためここで宣言）
  // 内蔵SEライブラリ（GiftCut/SE をカテゴリ別に読む。ローカルフォルダ参照＝配布同梱しない）
  // 置き場（効果音・テロップテンプレ・動きの見本帳）と整理は state/useLibraries
  const {
    seLibrary, setSeLibrary, refreshSE, importSeInto, localTemplates, setLocalTemplates, refreshPresets,
    motionPresets, setMotionPresets, refreshMotionPresets, importMotionPresets,
    MY_MOTIONS_KEY, myMotions, setMyMotions, putMyMotions, saveMyMotion, deleteMyMotion,
    isFav, toggleFav, setTplCat, openTplSec, setOpenTplSec, toggleTplSec,
    openAccSec, setOpenAccSec, accSecRefs, toggleAccSec, accSec, loadLS, saveLS,
    seFavs, setSeFavs, seFolders, setSeFolders, seOv, setSeOv,
    iconFavs, setIconFavs, iconFolders, setIconFolders, iconOv, setIconOv,
    toggleSeFav, toggleIconFav, setSeFolderOf, setIconFolderOf,
    addSeFolder, deleteSeFolder, addIconFolder, deleteIconFolder,
    orgMenu, setOrgMenu, allCats, catOf, addCustomCat, deleteCustomCat
  } = useLibraries({ askText })
  // プレビューの画質と、焼き直した映像（プロキシ）は state/useProxy
  const { previewRes, setPreviewRes, previewResRef, lastPreviewResRef, proxyMap, previewUrl } =
    useProxy({ loadLS, saveLS, playRateRef, sources, vClips, proxyForPathRef, setProxyPct })
  // 見本帳の棚まわり（右クリックの品書き・開いたら先頭へ送る）は state/useTemplateShelf
  const { tplMenu, setTplMenu, tplSecRefs, rightBodyRef } = useTemplateShelf({
    openTplSec,
    refreshPresets
  })
  // 帯になる物（つなぎ目の演出・テロップの出入り・見本・色）を運んでいる最中の
  // 持ち物は state/useBandDrag（ref と state に分ける理由も中にある）
  const {
    draggingIconRef, draggingTransRef, transDrop, setTransDrop,
    draggingTelopAnimRef, telopDrop, setTelopDrop, draggingTemplateRef
  } = useBandDrag()

  // ---- アイコン画像ライブラリ（単純な画像置き場。追加時にクロップ）----
  const [iconLibrary, setIconLibrary] = useState<IconItem[]>(loadIconLibrary)
  const [cropSrc, setCropSrc] = useState<{ src: string; onDone: (img: string) => void } | null>(
    null
  )
  // アイコンの配置：テロップに付随（テキスト量に追従）。位置=どの側 / 微調整=XY(1080px) / サイズ。
  // プロジェクトに保存。
  // アイコン軸: 自動調整ONで全テロップを揃える共有アンカー点（左端・縦中央）。
  // テロップごとに位置がバラつくとアイコンが飛び回るため、軸を1点に固定する（ユーザー要望 2026-07-23）。
  const iconScaleFor = (): number => iconScale
  // テロップの実効アイコン画像。優先: 個別D&D(iconImage) → 色(ラベル)割当 → レーン(トラック)割当。
  // 何も割り当ててなければ非表示（デフォOFF）。personIcon===false のテロップだけ個別に非表示。
  // どの画像を出すかの決まりは state/useIcons（割り当ての優先順位も中にある）
  const iconForCue = (c: Cue): string | undefined =>
    icons.iconForCue(c, iconAssign, laneIconAssign, cueTrack)
  // ライブラリに画像を追加（ファイル選択 → 円形クロップ → 保存）

  // キーの割り当てと、環境設定・ファイルメニューの開け閉めは state/useShortcutPrefs
  const {
    shortcuts,
    resetShortcuts,
    prefsOpen,
    setPrefsOpen,
    fileMenuOpen,
    setFileMenuOpen,
    capturingId,
    setCapturingId
  } = useShortcutPrefs()

  // タイムラインの箱への参照と、縦に送ったときの追従（ついていく側3つ）は
  // state/useTimelineBox
  const {
    screenRef, trackInnerRef, scrollRef, thBodyRef,
    syncTimelineVScroll, fitTimelineAroundVA, viewSec, inView
  } = useTimelineBox()

  // ---- パネルサイズ ----
  // パネルのレイアウトは記憶する（毎起動で同じドラッグをやり直さないように）
  // 画面の配置は state/usePanelLayout が持つ（大きさの限界と、掴んで動かす所も一緒）
  const {
    leftW, rightW, timelineH, setLeftW, setRightW, setTimelineH, startResize,
    leftTab, setLeftTab, monitorTab, setMonitorTab, tabOrder, setTabOrder,
    popped, setPopped, isPopped, unpopPane, paneGeom, setPaneGeom
  } = useLayout()

  // 画面の配置（切り離し・幅と高さ・タブ帯）と品書きの位置は state/useAppLayout
  const {
    popPane, layoutNow, applyLayout, orderedTabs, moveTab, TAB_DEFS, pickTab, clampMenu,
    tabMenu, setTabMenu, tabOverflow, setTabOverflow
  } = useAppLayout({
    PANE_LABEL, popped, setPopped, paneGeom, setPaneGeom,
    leftW, setLeftW, rightW, setRightW, timelineH, setTimelineH,
    videoTrackH, setVideoTrackH, audioTrackH, setAudioTrackH,
    tabOrder, setTabOrder, rightTab, setRightTab, monitorTab, setMonitorTab
  })
  // タイムラインの高さ。段を太らせるのではなく、領域そのものに余裕を持たせる
  // （プレミアも行は細く、下に余白がある形）。段が増えても足りなくならない。
  // タイムラインの既定の高さ。
  //
  // 420 だと画面のほぼ半分をタイムラインが占め、**プレビューが枠の4割**しか
  // 使えていなかった（実測: 枠845pxに対し映像326px）。切り抜きは
  // 「プレビューを見ながらテロップを詰める」作業なので、映像側を優先する。
  // 配置は保存されるので、好みで広げればその形が次から続く。

  // ※「V と A の境目を真ん中に残す」処理をここに入れて**壊した**ので、記録として残す。
  //
  // タイムラインを縦にスクロール（scrollTop）させたが、このアプリは
  // **左の段見出しを縦スクロールに追従させる仕組みを持っていない**。
  // その結果、行だけがずれて見出しは動かず、V1 の行に音の波形が出た。
  // さらに当たり判定は本当の行位置で計算されるので、
  // **見えている段と掴める段が食い違って移動できない**という形で表に出た。
  //
  // やるなら見出し列を同じ量だけ動かす作りが先。縦スクロール自体を
  // 前提にしていない所へ、スクロールだけ足してはいけない。
  // 大きさの保存は usePanelLayout の中

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

  // ---- refミラー（stale closure 対策）----
  const videoDurationRef = useRef(0)

  // ---- クリップボード & 編集履歴（Undo/Redo）----
  // 履歴は cues / segments / seClips / markers / imgClips を1スナップショットで管理する（統合Undo）
  const ratioRef = useRef<Ratio>('16:9')

  // 元に戻す・やり直す（控えと、時刻の入れ替え）は state/useHistory
  const {
    undoStackRef, redoStackRef, baselineRef, suppressHistoryRef, pendingTimerRef,
    bumpHist: setHistTick,
    setTime, paintTime, isDirty, snapNow, pushUndo, commitPending, undo, redo, resetHistory
  } = useHistory({
    // 控えを画面へ戻すのは state/useProjectFile の物で、あちらはこちらの
    // resetHistory を要る（相互に必要）。「呼ぶときに見に行く」形で解いてある
    restore: (...a: Parameters<typeof restore>) => restore(...a),
    preparedRef,
    previewResRef,
    lastPaintRef,
    ratioRef
  })

  // 保存していない変更があるか（タイトルの「＊」用）。
  // 重いので毎レンダーではなく、下の一定間隔の判定でだけ更新する。
  const [unsaved, setUnsaved] = useState(false)




  const primaryId = selectedIds[0] ?? null
  const selected = cues.find((c) => c.id === primaryId) ?? null

  // 動画のタイムライン長（＝切片の合計。カットするほど短くなる）とレイアウト
  // 本編の切片の並びと、その「いまこの瞬間」用の写しは state/useSegLayout
  const { segLayout, videoTLen, segLayoutRef, videoTLenRef } = useSegLayout(segments)

  // 動きの計測と不具合の記録は state/useDiagnostics
  useDiagnostics({
    setPerfOpen, dragTip, marquee, segLayoutRef, previewResRef, videoRef
  })

  // 字幕づくりは state/useSubtitles（聞き取り→割る→音に合わせる）
  const { runSubtitles, handleImportSrt } = useSubtitles({
    // 再生の心臓（state/usePlaybackEngine）は下で作るので、
    // 値ではなく「呼ぶときに見に行く」形で渡す
    stopPlayback: (...a: Parameters<typeof stopPlayback>) => stopPlayback(...a),
    seekTo: (...a: Parameters<typeof seekTo>) => seekTo(...a),
    segLayout,
    resetHistory,
    askConfirm,
    idCounter,
    subMaxChars,
    subReplace,
    newTelopStyle,
    setSrtPath,
    setSubtitleOpen,
    setSubtitleState
  })



  // タイムラインの長さ（出す長さ／本当の終わり）と、ものさしの目盛りは
  // state/useTimelineSpan（長さが2つある理由も中にある）
  const { seEnd, imgEnd, vcEnd, duration, contentEnd, contentEndRef, rulerTicks } =
    useTimelineSpan({ videoTLen, zoom, fps })

  // 素材の読み込みと焼き直しは state/useMediaOps
  //（焼き直しはプレビュー用。書き出しは必ず原本を使う）
  const {
    srcOfSeg, updateSource, hydrateSource, addMediaAtPlayhead, loadVideo,
    registerSource, addMediaPaths
  } = useMediaOps({
    stopPlayback: () => stopPlayback(),
    setTime: (t: number) => setTime(t),
    duration,
    fallbackTrack: (id: string, kind: 'video' | 'audio') => fallbackTrack(id, kind),
    kindOf: (pth: string) => kindOf(pth),
    placeImage: (...a: Parameters<typeof placeImage>) => placeImage(...a),
    placeSE: (...a: Parameters<typeof placeSE>) => placeSE(...a),
    placeVideoAtDrop: (...a: Parameters<typeof placeVideoAtDrop>) => placeVideoAtDrop(...a),
    setOpenAccSec: (...a: Parameters<typeof setOpenAccSec>) => setOpenAccSec(...a),
    videoElsRef,
    proxyForPathRef,
    srcAddedAtRef,
    initializedForPathRef,
    baselineRef,
    redoStackRef,
    pendingTimerRef,
    undoStackRef,
    suppressHistoryRef
  })
  // 再生の心臓（流す・止める・飛ぶ・コマ送り）は state/usePlaybackEngine
  const {
    getPlayEnd, stopPlayback, startRafClock, startVideoSegClock, startVideoClock,
    startPlayback, togglePlay, shuttleForward, shuttleReverse, handleVideoEnded,
    seekTo, xfBStyle, curSegId, skipSec, stepFrame
  } = usePlaybackEngine({
    videoRef, videoBRef, videoElsRef, setActiveHalf, halfOf, elKey, segLayoutRef,
    srcOfSeg, videoTLenRef, videoDurationRef, contentEndRef,
    seAudioRefs, sePreviewRef, paintTime, setTime,
    // 見せる側（state/useViewNav）は後で作られるので「呼ぶときに見に行く」形で渡す
    seekAndReveal: (t: number) => seekAndReveal(t)
  })

  // いま出ているテロップと、映す素材の一覧は state/useNowShowing
  // （先頭だけ特別扱いする理由・開始ちょうどから出す理由も中にある）
  const { activeCues, previewSources } = useNowShowing({
    cues, currentTime, tracks, cueTrack, sources, videoSrc, videoDuration, fps
  })
  // 色ラベルの並びは state/useLabelsPresets

  useEffect(() => {
    durationRef.current = duration
  }, [duration])
  useEffect(() => {
    videoDurationRef.current = videoDuration
  }, [videoDuration])
  useEffect(() => {
    fpsRef.current = fps
  }, [fps])


  // 選んだ物が「もう無い物」を指し続けないよう掃除するのは state/useSelectionCleanup
  useSelectionCleanup()


  // 使わなくなった素材の控えを捨てるのも state/useMediaMeta の中

  const v1Hidden = trackStates['V1']?.hidden ?? false


  // 重ねる動画の <video>（窓で区切って残す理由も中に）は state/useVClipEls
  const { windowVClips, vcElsRef, vcRefCb } = useVClipEls(vClips, currentTime, tracks)
  // 再生ヘッドの位置の見た目と、リフレーム枠の相手は state/useCurrentLook
  const {
    effActiveSrcId, curBlank, curAdjustCss, curSegZoom, curSegCrop, curCropInset,
    reframeTarget, reframeTargetRef
  } = useCurrentLook({
    segLayout, segments, currentTime, previewSources, activeSrcId,
    selectedVideoIds, selectedImgIds, selectedVClipIds,
    imgClips, vClips, vcLen, srcOfSeg, videoName
  })
  // プレビューに出す「いまの絵」の組み立て（回転・拡大・つなぎ目の演出）は
  // state/usePreviewFrame
  const {
    curSegXform, videoZoomTransform, inOutPreview, transOverlay, videoMainStyle,
    xfPreview, xfNextBUrl, xfDipOverlay
  } = usePreviewFrame({ segLayout, srcOfSeg, curSegZoom, curCropInset, previewUrl })










  // プレビューの上で映像を掴む（動かす・拡げる・回す）と画面を撮るのは state/usePreviewManip
  const {
    onVideoReframeStart, selectPreviewOverlay, resetVideoZoom, onVideoRotateStart,
    captureScreenshot
  } = usePreviewManip({
    screenRef, videoRef, reframeTargetRef, segLayout, cueTrack, iconForCue, vcLen,
    videoTLen, v1Hidden, curBlank, curSegZoom, patchClipMotion,
    setSegZoom, setImgZoom, setVClipZoom, clearAllSelections,
    // 回すのは state/useTimelineEdit の物。あちらの方が後に作られるので、
    // 値ではなく「呼ぶときに見に行く」形で渡す（先に読むと初期化前参照）
    setSegRotate: (...a: Parameters<typeof setSegRotate>) => setSegRotate(...a)
  })
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




  // 切片の切り方・空きの作り方（切り口に演出を残さない理由も中に）は state/useSegOps
  const { segSplit, makeGapSeg, segOps } = useSegOps({ segIdCounter })
  // 本編の切片をどこへ置くか（動かす・新しく置く・落とした所へ）は state/useSegmentPlace
  const { cutRangeFromSegs, moveSegmentTo, placeSegAt, placeVideoAtDrop } = useSegmentPlace({
    mainLocked, segOps, segSplit, shiftAfter, loadVideo, registerSource
  })



  const hasProjectContent = (): boolean =>
    !!videoPath ||
    cues.length > 0 ||
    segments.length > 0 ||
    seClips.length > 0 ||
    imgClips.length > 0 ||
    markers.length > 0 ||
    vClips.length > 0 ||
    mediaItems.length > 0





  // テンプレート選択モーダル（起動時 or 手動）。適用は原本を汚さない＝新規扱い(srcPath=null)
  const [templatePicker, setTemplatePicker] = useState<{
    items: { name: string; path: string }[]
    startup: boolean
  } | null>(null)

  // プロジェクトデータを適用（ファイルを開く / 自動保存の復元で共通）
  /* eslint-disable @typescript-eslint/no-explicit-any */
  /* eslint-enable @typescript-eslint/no-explicit-any */

  // 未保存の「＊」と、下書きの土台は state/useAutosaveMark
  // （何と比べて決めるか・なぜ変わったときだけ見直すかも中にある）
  const {
    lastAutosaveRef, hasContentRef, savedJsonRef, restorePrompt, setRestorePrompt, projectJsonRef,
    currentJson, currentJsonRef, markUnsaved, markUnsavedRef, projectRevRef,
    autosavedRevRef, autosaveNgRef, autosaveNg, setAutosaveNg
  } = useAutosaveMark({
    hasProjectContent,
    setUnsaved,
    // 画面の配置は心臓ではなくフックが持っているので、ここから渡す
    layout: [popped, paneGeom, leftW, rightW, timelineH, videoTrackH, audioTrackH, tabOrder, rightTab, monitorTab]
  })



  // プリセット/スタイルから run 用の代表色（単色→そのまま、グラデ→末尾/先頭ストップ）
  const runColorFromStyle = (st: TelopStyle): string | undefined => {
    const f = st.fill
    if (!f?.enabled) return undefined
    if (f.color) return f.color
    const stops = f.gradient?.stops
    return stops && stops.length ? stops[stops.length - 1].color : undefined
  }

  // ================= 編集操作 =================
  // テロップの見た目（全体に効かせるか、選んだ文字だけか）は state/useTelopLook
  const {
    updateSelectedText, panelStyleFor, updateSelectedStyle, applyRunRange,
    clearRunsInSelection, curSel, editorTextRef, setEditorSel
  } = useTelopLook()

  // ---- 基本編集操作（コピー/カット/貼付/複製/分割）----
  // コピー/カット/貼り付けはテロップ・SE/BGM・画像に対応（種別ごとにまとめて保持）。
  // 貼り付けは「元の相対位置を保ったまま再生ヘッド位置へ」（プレミア準拠）。


  // 選択中の切片を削除＝リップル（動画・音声どちらの選択でも切片ごと除去、後続が詰まる）
  // 動画切片のリップル削除。切片を除去し、その timeline 区間より後ろのテロップ/SEを同量だけ左へ
  // シフト＝映像と同期を保つ（切片削除だけだとテロップがズレる不具合の対策）。
  // ---- 無音カット ----
  //
  // 喋っていない所を機械に見つけさせて、まとめて切る。切り抜きの定番作業で、
  // いままで人が波形を見ながら手で切っていた。
  //
  // 判定は音の大きさだけ（文字起こしは使わない）。
  // どこまでを無音とするか・前後にどれだけ余白を残すかは人によって違うので、
  // 「バツっと切りたい人」「少し余白がほしい人」の両方を設定で受ける。
  // 静かな所を切る・声の間だけ BGM を下げる（同じ解析結果を使う）は state/useSilenceDuck
  const {
    silenceCut, setSilenceCut, silenceOpen, setSilenceOpen,
    duckOpts, setDuckOpts, duckOpen, setDuckOpen, duckEnv, duckGainAt, silenceCuts
  } = useSilenceDuck(segments)

  // 動き（キーフレーム）を付ける・消す・配るのは state/useMotion
  const {
    setMotion, resetClipChannel, clearClipMotions, toggleKeys, nudgeClips,
    applyMotionPreset, animBreakpoints
  } = useMotion({
    reframeTargetRef, askConfirm, showToast, segLayout,
    patchClipMotion, setSegZoom, setImgZoom, setVClipZoom, vcLen, seekTo
  })

  // 書き出しは state/useExport（やり直しが利かないので、道すじを1か所に）
  const { audioTrackGainForExport, exportSrtFn, openExportDialog, exportProject } = useExport({
    stopPlayback,
    srcOfSeg,
    cueTrack,
    iconForCue,
    resolveExportFps,
    animBreakpoints,
    duckEnv,
    seEnd,
    v1Hidden
  })
  // タイムライン長が変わる操作（トリム/複製/速度変更）で、境界 boundaryT より後ろにある
  // テロップ/SE/画像/マーカーを delta だけ動かして映像との同期を保つ。
  // これが無いと「動画を短くしたら字幕が全部ズレた」になる。
  /**
   * 境目より後ろにある物を、まとめてずらす（＝詰まる）。
   *
   * **ずらす相手は5種類ある。** 新しく置ける物を足したら、必ずここへも足すこと。
   * 1つ忘れると、そこだけ置き去りになって「切って詰めたのに文字だけ残る」になる。
   * ずらし方の決まり（境目の比べ方・前へはみ出させない）は shared/ripple。
   */
  function shiftAfter(boundaryT: number, delta: number): void {
    if (Math.abs(delta) < 1e-4) return
    setCues((prev) => prev.map((c) => ({ ...c, ...shiftRange(c, boundaryT, delta) })))
    setSeClips((prev) =>
      prev.map((c) => ({ ...c, tStart: shiftStart(c.tStart, boundaryT, delta) }))
    )
    setImgClips((prev) =>
      prev.map((c) => ({ ...c, tStart: shiftStart(c.tStart, boundaryT, delta) }))
    )
    setMarkers((prev) => prev.map((m) => ({ ...m, t: shiftStart(m.t, boundaryT, delta) })))
    setVClips((prev) =>
      prev.map((c) => ({ ...c, tStart: shiftStart(c.tStart, boundaryT, delta) }))
    )
  }
  // 選択中の動画切片を複製（直後にコピーを挿入。タイムラインは伸びる）
  // つなぎ目の演出（選ぶ・付ける・長さ・外す）は state/useTransitions
  const {
    selectTransition, patchSegTrans, updateSelectedTransDur, setSelectedTransType,
    deleteSelectedTrans, startTransResize, setVideoTransDur, resolveTransDrop,
    applyTransDrop, cleanupOrphanTrans
  } = useTransitions({
    segLayout, segLayoutRef, draggingTransRef, trackInnerRef, setRightTab,
    clearSegSel, mainLocked, showToast, transDur
  })

  /** 動きの表で選んでいる行（コピーする項目）。写す・貼るは state/useCopyPaste */
  const motionSelRef = useRef<string[]>([])
  // 色ラベルと見本の保存、出入りアニメの一覧は state/useLabelsPresets
  const { labelGroups, setLabelFor, selectByLabel, savePreset } = useLabelsPresets()

  // マグネット（吸着）は state/useSnap
  const { snapTargets, snapTime, snapClipStart } = useSnap({ snap, segLayoutRef })

  // 素材を掴んで落とす（どの段の、どこへ置くか）は state/useMediaDrop
  const {
    prepareMediaMeta, beginMediaDrag, placeImage, deleteSelectedImg, vcXform, imgXform,
    updateDropGhost, clearDropGhosts, dropMediaNearest, videoDropLane, placeVClip,
    deleteSelectedVClip, vcFadeGain, placeSE, trackForNewBgm, addBgm, seFadeGain, removeMedia
  } = useMediaDrop({
    EXTRA_AUDIO_TRACK, dragSeDurRef, draggingMediaRef, dropLaneAt,
    fallbackTrack, insertTrackOrdered, mediaInUse, mediaMetaRef, mediaQueue,
    metaInFlightRef, pairedAudioOf, placeVideoAtDrop, reserveTrackPairForVideo,
    scrollRef, trackInnerRef, snapClipStart, staleSourceIds, trackFromEvent, trackNum,
    vcLen, setMediaMeta, setImgGhost, setSeGhost, setVideoGhost, setSnapLineX
  })

  // 画面の <video> / <audio> を「いま」に追従させるのは state/useVideoSync
  useVideoSync({
    videoRef, videoBRef, videoElsRef, halfOf, elKey, elOf, seAudioRefs, vcElsRef,
    xfPreview, segLayout, srcOfSeg, previewUrl, proxyMap, previewRes,
    lastPreviewResRef, srcAddedAtRef, audioTrackGain, duckGainAt, seFadeGain, vcFadeGain,
    trackNum, undoStackRef, redoStackRef
  })

  // 見ている場所を動かす（寄る・引く・連れてくる）は state/useViewNav
  const { zoomAroundPlayhead, revealPlayhead, seekAndReveal, fitTimelineZoom, scrubFromClientX } =
    useViewNav({ scrollRef, trackInnerRef, contentEndRef, seekTo })

  // タイムライン上の目印（頭出し・メモ）は state/useMarkers
  const { addMarkerAtPlayhead, deleteMarker, jumpMarker, onMarkerPointerDown } = useMarkers({
    stopPlayback, seekTo, seekAndReveal, snapTime
  })

  // キーを押したときに何が起きるかは state/useKeyboard（呼ぶのは下の方）

  // キー割当の待ち受けと、ファイルメニューの開け閉めは state/useShortcutPrefs


  // ホイールの割り当てと、再生ヘッドの追いかけは state/useTimelineWheel
  useTimelineWheel({
    scrollRef, zoomRef, setZoom, ZOOM_MIN, ZOOM_MAX, playing, currentTime, zoom
  })

  // 品書きは、外を押す・Escape で閉じる（閉じ方は state/useDismissOnOutside に1つ）
  useDismissOnOutside(!!clipMenu, () => setClipMenu(null))
  useDismissOnOutside(!!menu, () => setMenu(null))

  // 素材を読み込んだ直後に一度だけ全体表示にする。
  // 既定の拡大率のままだと、15秒の素材に対して目盛りが50秒まで伸びていて、
  // クリップが左端の小さな塊に見える。開いた瞬間から作業できる状態にする。
  const didFitForRef = useRef<string | null>(null)
  useEffect(() => {
    if (!videoPath || videoDuration <= 0) return
    if (didFitForRef.current === videoPath) return
    didFitForRef.current = videoPath
    // 切片のレイアウトが確定してから測る
    const t = window.setTimeout(fitTimelineZoom, 60)
    return () => window.clearTimeout(t)
  }, [videoPath, videoDuration])

  // 素材のドラッグはウィンドウ全体で受け取る（1pxでも取りこぼすと駐禁が出る）。
  // 実体と理由は state/useWindowDrop
  useWindowDrop({ draggingMediaRef, updateDropGhost, clearDropGhosts, dropMediaNearest })




  // ================= パネルリサイズ =================
  // 境目を掴んで動かす所は state/usePanelLayout の中


  // ================= タイムライン操作 =================
  // スライダーや数値欄にフォーカスが残っていると、矢印キーが再生ヘッドではなく
  // その入力欄を動かし、Space も効かなくなる。しかも pointerdown で
  // preventDefault しているためクリックしてもフォーカスが戻らなかった。
  // タイムライン/プレビューを触ったら明示的にフォーカスを外す。
  function blurActiveInput(): void {
    const el = document.activeElement as HTMLElement | null
    if (!el) return
    const tag = el.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') el.blur()
  }
  // タイムラインの上で掴む（目盛りを擦る・段を選ぶ・空きを囲う・クリップを動かす・端を摘む）
  // は state/useTimelineDrag。プレビューの上で掴む話（useTelopBox）とは別物。
  const {
    startScrub, trackSelect, maybeTrackSelect, onTrackAreaPointerDown,
    onClipPointerDown, onClipContextMenu, onTrimStart,
    onSePointerDown, onImgPointerDown, onVClipPointerDown
  } = useTimelineDrag({
    tool, duration, laneAtY, blurActiveInput, stopPlayback,
    trackInnerRef, scrollRef, zoomRef, videoTrackHRef, audioTrackHRef,
    padTop, rulerH: RULER_H,
    segLayout, segLayoutRef, v1Index, a1Index,
    cueTrack, telopLocked, trackNum, vcLen, idCounter,
    setDragTip, setMarquee, setSnapLineX, snapClipStart, snapTime,
    scrubFromClientX, reserveTrackPairForVideo, pendingLaneRef, setMenu
  })

  // 本編の切片（カット列）を掴む・端を摘むのは state/useSegmentDrag。
  // 切片は「並んでいる順」に意味があり、動かすと後ろが詰まる／上書きされる。
  const { onSegPointerDown, onSegTrimStart } = useSegmentDrag({
    tool, mainLocked, maybeTrackSelect, stopPlayback, undo,
    moveSegmentTo,
    // 切るのは state/useTimelineEdit の物。あちらの方が後に作られるので、
    // 値ではなく「呼ぶときに見に行く」形で渡す（先に読むと初期化前参照）
    razorSegment: (...a: Parameters<typeof razorSegment>) => razorSegment(...a),
    srcOfSeg, shiftAfter,
    trackInnerRef, zoomRef, videoDurationRef, videoName, videoPath,
    setDragTip, setSnapLineX, setVideoGhost, setOverwriteIds,
    snapClipStart, snapTime
  })

  // プレビュー内テロップのドラッグ移動
  // プレビューの上でテロップを掴む・拡げる・枠内に寄せるのは state/useTelopBox
  const { onTelopPointerDown, onTelopResizeStart, setBoxAnchor, applyIconAutoLeft } = useTelopBox({
    screenRef,
    telopLocked,
    stopPlayback,
    seekTo,
    iconAuto,
    setIconAnchorPos
  })

  // アイコンの置き場と割り当て（段ごと・色ごと）は state/useIconLibrary
  const {
    setIconForLane, changeIconAuto, setIconForColor, appendIconImage,
    addIconFiles, addIconImages, removeIconImage, setPersonIconForSelected
  } = useIconLibrary({
    iconLibrary, setIconLibrary, setCropSrc, setIconAssignState, setLaneIconAssign,
    setIconOv, setIconFavs, applyIconAutoLeft, setOpenAccSec, saveLS, screenRef,
    seekTo, stopPlayback, selected
  })


  const monitorAspect = ratio === '16:9' ? '16 / 9' : ratio === '9:16' ? '9 / 16' : '1 / 1'

  // プレビューの見出し（タブ）行の右端に出す「状態」（画質・fps・全体の長さ）。
  //
  // **押す物ではないので、操作バーには置かない。** 同じ行に混ぜると
  // よく使う再生ボタンが端へ押しやられ、ここへ出すと操作バーが1段で済む
  // （プレビューの縦が約26px 広がる）。中身は components/panels/PreviewBars.tsx
  const transportInfo = (
    <TransportInfo
      previewRes={previewRes}
      onPreviewRes={setPreviewRes}
      hasVideo={!!videoSrc}
      fps={fps}
      playRate={playRateUI}
      duration={duration}
    />
  )
  // テロップの足し引きと出入りの演出は state/useTelopEdit
  const {
    applyIconToCue, trackForNewTelop, addTelop, updateCueText, patchCueAnim,
    applyTelopAnimSide, nextCueAfter, resolveTelopTransDrop, applyTelopTransDrop,
    selectTelopTrans, updateTelopTransDur, setTelopTransType, deleteSelectedTelopTrans,
    toggleTelopEmphasis, alignTelop
  } = useTelopEdit({
    cueTrack,
    telopLocked,
    idCounter,
    trackNum,
    insertTrackOrdered,
    motionLabel,
    draggingTelopAnimRef,
    setRightTab
  })

  // コピーと貼り付け（クリップ／設定だけ／動きだけ）は state/useCopyPaste
  const {
    attrSummary, copyAttributes, pasteAttributes, copyMotionRows, pasteMotionRows,
    copySelected, pasteClipboard
  } = useCopyPaste({
    cueTrack,
    fallbackTrack: (id: string, kind: 'video' | 'audio') => fallbackTrack(id, kind),
    mainLocked,
    telopLocked,
    selected,
    idCounter,
    motionSelRef,
    reframeTargetRef,
    srcOfSeg,
    leftTab
  })

  // 消す・切る・複製する・詰める（タイムラインを縮める側）は state/useTimelineEdit
  const {
    deleteSelected, rippleDeleteSelected, cutSelected, duplicateSelected, razorSegment,
    deleteSelectedSE, findSilences, applySilenceCut, rippleDeleteVideoSegments,
    toggleBlankSelectedVideo, duplicateClipsFromMenu, duplicateSelectedSegments,
    setSelectedSegSpeed, setSegRotate, closeGapAtPlayhead, deleteVideoSegmentsLeavingGap,
    closeSelectedGaps, closeGap, allContentEdges, mapContentTimes, collapseContent,
    rippleToPrevCut, rippleToNextCut, splitVideoAtPlayhead, cutAtPlayhead
  } = useTimelineEdit({
    cleanupOrphanTrans, commitPending, copySelected, cueTrack, cutRangeFromSegs,
    deleteSelectedImg, deleteSelectedVClip, idCounter, mainLocked, makeGapSeg,
    seekTo, segLayoutRef, segOps, silenceCut, setSilenceCut, setSilenceOpen, setTime,
    shiftAfter, silenceCuts, stopPlayback, telopLocked, vcLen, videoRef
  })

  // プロジェクトの開く・保存・復元は state/useProjectFile
  //（拾い忘れた項目はエラーも出ずに消えるので、1か所にまとめてある）
  const {
    saveCurrentAsTemplate, deleteUserTemplate, restore, projectJson, saveProjectFn,
    openProjectFn, templateJson, applyProjectTemplate, saveAsTemplateFn, openTemplateFn,
    pickTemplate, applyProjectData, applyTemplate, mergeTemplateKeepFrame, applyTemplateToCue
  } = useProjectFile({
    stopPlayback: (...a: Parameters<typeof stopPlayback>) => stopPlayback(...a),
    setTime: (...a: Parameters<typeof setTime>) => setTime(...a),
    duration,
    fallbackTrack: (...a: Parameters<typeof fallbackTrack>) => fallbackTrack(...a),
    kindOf: (...a: Parameters<typeof kindOf>) => kindOf(...a),
    applyLayout,
    layoutNow,
    snapNow,
    resetHistory,
    // この2つは state/useProjectIO の物で、あちらはこちらの applyProjectData を要る
    // （相互に必要）。片側を「呼ぶときに見に行く」形にして解いてある
    confirmDiscard: (...a: Parameters<typeof confirmDiscard>) => confirmDiscard(...a),
    hasProjectContent,
    askText,
    rememberProject: (...a: Parameters<typeof rememberProject>) => rememberProject(...a),
    prepareMediaMeta,
    mediaMeta,
    runColorFromStyle,
    applyRunRange,
    curSel,
    selected,
    audioTrackGain,
    commitPending,
    idCounter,
    savedJsonRef,
    projectJsonRef,
    markUnsavedRef,
    lastAutosaveRef,
    initializedForPathRef,
    proxyForPathRef,
    videoElsRef,
    videoRef,
    setTemplatePicker,
    saveLS,
    baselineRef,
    undoStackRef,
    redoStackRef,
    suppressHistoryRef,
    pendingTimerRef,
    hydrateSource,
    updateSource,
    setHistTick
  })

  // 素材とプロジェクトの出し入れ（開く・足す・持ち出す・下書き）は state/useProjectIO
  const {
    rememberProject, handleOpenVideo, handleReplaceVideo, appendVideo, handleAppendVideo,
    genThumbFor, addFilesToProject, addFolderToProject, hasUnsavedChanges, confirmDiscard,
    packProjectFn, openPackFn, writeAutosave
  } = useProjectIO({
    RECENT_MAX, setRecentProjects, projectPath, projectJson, currentJsonRef, savedJsonRef,
    applyProjectData, askConfirm, loadVideo, registerSource, addMediaPaths,
    mediaQueue, thumbDoneRef, packBusyRef, setPackPct, autosaveNgRef, autosavedRevRef,
    lastAutosaveRef, setAutosaveNg, hasProjectContent
  })

  // 作業位置と下書きを覚えておくのは state/useSessionMemory
  useSessionMemory({
    writeAutosave, currentJsonRef, projectRevRef, autosavedRevRef,
    lastAutosaveRef, hasContentRef, applyProjectData, askConfirm, setRestorePrompt,
    setTemplatePicker, isDirty, snapNow, pushUndo, baselineRef, pendingTimerRef,
    suppressHistoryRef, redoStackRef, setHistTick, setTime,
    scrollRef, rightBodyRef, rightTab, setRightTab, ratioRef, localTemplates
  })
  projectJsonRef.current = projectJson

  // メインからの知らせ（進み具合・更新・関連付けで開く）は state/useMainEvents。
  // **ここで呼ぶのは、下書きに書く projectJson が出来た後だから。**
  useMainEvents({
    proxyForPathRef, setProxyPct, setExportPct, setSubtitleState, setUpdateState,
    packBusyRef, setPackPct, openProjectFn, projectJson
  })


  // キーを押したときに何が起きるか（state/useKeyboard）。
  // **ここで呼ぶ。** 渡す物のうち addTelop・saveProjectFn などは、この上の
  // フックが返す物なので、上の方で呼ぶと初期化前参照になる。
  useKeyboard({
    // 何かを開いている間は Esc 以外を通さない（裏のタイムラインが勝手に動かないように）
    modalOpen: !!(
      restorePrompt || templatePicker || cropSrc || showExportDialog ||
      prefsOpen || promptState || confirmState || iconSettingsOpen
    ),
    capturing: !!capturingId,
    exporting: !!exportStatus,
    shortcuts,
    setTool,
    toggleSnap,
    togglePlay,
    shuttleForward,
    shuttleReverse,
    stopPlayback,
    seekTo,
    contentEndRef,
    copyAttributes,
    pasteAttributes,
    copySelected,
    cutSelected,
    pasteClipboard,
    undo,
    redo,
    removeMedia,
    deleteMarker,
    deleteSelectedTrans,
    deleteSelectedTelopTrans,
    deleteTrack,
    deleteSelected,
    deleteSelectedSE,
    deleteSelectedImg,
    deleteSelectedVClip,
    deleteVideoSegmentsLeavingGap,
    closeSelectedGaps,
    closeGapAtPlayhead,
    rippleDeleteVideoSegments,
    rippleToPrevCut,
    rippleToNextCut,
    duplicateSelected,
    duplicateSelectedSegments,
    cutAtPlayhead,
    addTelop,
    addMarkerAtPlayhead,
    saveProjectFn,
    openProjectFn,
    openExportDialog,
  })

  // 帯を右クリックしたとき。**押した1つだけを選び直してから**品書きを出す。
  // 複数選んだまま右クリックすると、押した物ではない方へ操作が飛ぶ。
  const openClipMenu: OpenClipMenu = (e, kind, clip) => {
    e.preventDefault()
    e.stopPropagation()
    if (kind === 'vclip') setSelectedVClipIds([clip.id])
    else if (kind === 'se') setSelectedSeIds([clip.id])
    else if (kind === 'seg') {
      // 本編の切片は「映像だけ選ぶ」。画像の選択は必ず落とす
      // （両方選んだまま品書きを出すと、削除が画像まで巻き込む）
      setSelectedVideoIds([clip.id])
      setSelectedImgIds([])
    } else setSelectedImgIds([clip.id])
    setMenu(null)
    setClipMenu({ x: e.clientX, y: e.clientY, kind, id: clip.id, name: clip.name })
  }

  // タイムラインの区画を部品へ出すための2つの心臓。
  // **操作の入口**と**見え方**を分けてあるのは、描き直しの理由を混ぜないため
  //（1つにまとめると、掴んで影が動くたびに操作の入口も「変わった」ことになる）。
  // 中身は state/timelineOpsContext.tsx / state/timelineViewContext.tsx
  const timelineOps: TimelineOps = {
    onClipPointerDown, onClipContextMenu, onTrimStart, onSegPointerDown, onSegTrimStart,
    onSePointerDown, onImgPointerDown, onVClipPointerDown, onMarkerPointerDown,
    onTrackAreaPointerDown, startScrub, startGroupResize, startTransResize, openClipMenu,
    updateDropGhost, clearDropGhosts, dropLaneAt, videoDropLane, placeSE, placeImage,
    placeVClip, placeVideoAtDrop, snapClipStart, draggingMediaRef, draggingTransRef,
    draggingTelopAnimRef, dragSeDurRef,
    resolveTransDrop, applyTransDrop, selectTransition, setVideoTransDur,
    resolveTelopTransDrop, applyTelopTransDrop, selectTelopTrans, patchCueAnim,
    undo, redo, undoStackRef, redoStackRef, isDirty, cutAtPlayhead, findSilences,
    setSilenceOpen, toggleSnap,
    selectTrack, toggleTrack, addVideoTrack, addAudioTrack, addBgm, setTracks, askText,
    fallbackTrack, stopPlayback, seekTo
  }
  const timelineView: TimelineView = {
    tool, setTool, snap,
    hoverX, setHoverX, lastHoverPaintRef,
    telopDrop, setTelopDrop, transDrop, setTransDrop,
    segLayout, rulerTicks, padTop, padBottom, trackHOf, inView,
    scrollRef, trackInnerRef, thBodyRef, syncTimelineVScroll,
    zoomAroundPlayhead, fitTimelineZoom
  }

  // プレビュー（中央の映像）まわり。中身は state/previewContext.tsx
  const previewCtx: PreviewCtxValue = {
    screenRef, videoRef, videoBRef, videoElsRef, elKey, activeHalf, effActiveSrcId,
    previewSources, previewUrl, monitorAspect,
    xfPreview, xfBStyle, xfNextBUrl, xfDipOverlay, transOverlay, videoMainStyle,
    curAdjustCss, curBlank, v1Hidden, videoTLen, activeCues, windowVClips,
    vcRefCb, vcXform, imgXform, vcLen, iconForCue, proxyPct, packPct,
    onVideoReframeStart, onVideoRotateStart, resetVideoZoom, resetCount,
    selectPreviewOverlay, reframeTarget, onTelopPointerDown, onTelopResizeStart,
    editorTextRef, updateCueText, setEditorSel, clearRunsInSelection,
    draggingTemplateRef, draggingIconRef, applyTemplateToCue, applyIconToCue,
    togglePlay, skipSec, stepFrame, jumpMarker, addMarkerAtPlayhead, captureScreenshot,
    seekAndReveal, handleVideoEnded, startFader, setTrackVolume, setMasterVolume,
    transportInfo
  }

  // 右パネルまわり。中身は state/rightPanelContext.tsx
  const rightPanel: RightPanelValue = {
    accSec, rightBodyRef, importSeInto, addMediaAtPlayhead, catOf, srtPath,
    labelGroups, removeMedia, beginMediaDrag, draggingMediaRef, localTemplates, isFav,
    draggingTemplateRef, iconFavs, toggleIconFav, draggingIconRef, seLibrary, seFavs,
    setSeFolderOf, toggleSeFav, TELOP_MOTIONS, addFilesToProject, addFolderToProject, handleImportSrt,
    loadVideo, selectByLabel, genThumbFor, prepareMediaMeta, allCats, openTplSec,
    tplSecRefs, toggleTplSec, saveCurrentAsTemplate, addCustomCat, deleteCustomCat, refreshPresets,
    applyTemplate, deleteUserTemplate, toggleFav, setTplCat, iconLibrary, iconFolders,
    iconOv, addIconImages, addIconFiles, addIconFolder, deleteIconFolder, removeIconImage,
    setIconFolderOf, seFolders, seOv, addSeFolder, deleteSeFolder, refreshSE,
    previewSE, setSelectedTransType, updateSelectedTransDur, deleteSelectedTrans, setTelopTransType, updateTelopTransDur,
    deleteSelectedTelopTrans
  }

  // 覆い（ダイアログ）まわり。中身は state/dialogsContext.tsx
const dialogs: DialogsValue = {
    silenceCut, perfStopped, templatePicker, setTemplatePicker, cropSrc, setShowExportDialog,
    exportStatus, restorePrompt, setRestorePrompt, silenceCuts, findSilences, shortcuts,
    capturingId, setCapturingId, setCropSrc, promptState, setPromptState, confirmState,
    showExportDialog, fpsLabel, srcFpsForExport, exportProject, exportPct, setExportStatus,
    applyProjectData, subtitleOpen, subModel, subtitleState, subMaxChars, setSubMaxChars,
    saveLS, subReplace, setSubReplace, runSubtitles, setSubtitleOpen, pickTemplate,
    silenceOpen, setSilenceCut, applySilenceCut, setSilenceOpen, duckOpen, duckOpts,
    setDuckOpts, duckEnv, setDuckOpen, seRefCb, prefsOpen, resetShortcuts,
    setPrefsOpen, setIconForColor, setIconForLane, perfOpen, setPerfOpen, setPerfStopped,
    toasts, closeConfirm    , iconAssign, laneIconAssign, iconLibrary
  }

  return (
    <TimelineOpsProvider value={timelineOps}>
    <TimelineViewProvider value={timelineView}>
    <PreviewProvider value={previewCtx}>
    <RightPanelProvider value={rightPanel}>
    <DialogsProvider value={dialogs}>
    <div
      className="app"
      // 素材をドラッグしている間は、アプリのどこにいても受け付ける。
      // 受け付けない場所があると、そこだけ 🚫（駐禁）が出て「置けない場所」に見える。
    >
      {/* 画面のいちばん上（更新の帯とメニューバー）は components/panels/AppHeader.tsx */}
      <AppHeader
        updateState={updateState} setUpdateState={setUpdateState}
        fileMenuOpen={fileMenuOpen} setFileMenuOpen={setFileMenuOpen}
        shortcuts={shortcuts} appVersion={appVersion} unsaved={unsaved}
        saveProjectFn={saveProjectFn} openProjectFn={openProjectFn}
        packProjectFn={packProjectFn} openPackFn={openPackFn}
        saveAsTemplateFn={saveAsTemplateFn} openTemplateFn={openTemplateFn}
        handleAppendVideo={handleAppendVideo} handleReplaceVideo={handleReplaceVideo}
        handleImportSrt={handleImportSrt} exportSrtFn={exportSrtFn}
        importMotionPresets={importMotionPresets} refreshSE={refreshSE}
        refreshPresets={refreshPresets} refreshMotionPresets={refreshMotionPresets}
        setPrefsOpen={setPrefsOpen} setSubtitleOpen={setSubtitleOpen}
        openExportDialog={openExportDialog} addTelop={addTelop}
        changeRatio={changeRatio} projectPath={projectPath}
      />

      {/* ===== ワークスペース ===== */}
      <div className="workspace">
        <div className="upper">
          <PaneHost id="left" title={PANE_LABEL.left} popped={isPopped('left')}
            geom={paneGeom.left} onClose={() => unpopPane('left')}>
          {/* --- 左: プロパティ --- 中身は components/panels/PropertiesPanel.tsx。
              出す物は「いま選んでいる種類」で決まる。優先順はここで決めて、
              該当する1つだけを渡す（テロップ → 効果音 → 動画 → 音声 → 映像レイヤー → 画像）。 */}
          <LeftPanel
            alignTelop={alignTelop}
            applyTemplate={applyTemplate}
            changeIconAuto={changeIconAuto}
            clearClipMotions={clearClipMotions}
            currentTime={currentTime}
            duration={duration}
            motionSelRef={motionSelRef}
            nudgeClips={nudgeClips}
            pairedAudioOf={pairedAudioOf}
            panelStyleFor={panelStyleFor}
            reframeTarget={reframeTarget}
            resetClipChannel={resetClipChannel}
            resetCount={resetCount}
            saveMyMotion={saveMyMotion}
            savePreset={savePreset}
            seekTo={seekTo}
            setBoxAnchor={setBoxAnchor}
            setPersonIconForSelected={setPersonIconForSelected}
            setSelectedSegSpeed={setSelectedSegSpeed}
            toggleKeys={toggleKeys}
            updateSelectedStyle={updateSelectedStyle}
            updateSelectedText={updateSelectedText}
            userTemplates={userTemplates}
            vcLen={vcLen}
            iconForCue={iconForCue}
          />

          </PaneHost>

          <div className="resizer resizer-v" onPointerDown={(e) => startResize('left', e)} />

          {/* 真ん中のパネルだけは、出て行くと横幅が丸ごと余る（左右は幅が固定で、
              伸び縮みするのはここだけ）。何も置かないと画面の6割が空になり、
              壊れたように見えるので、行き先の案内と戻すボタンを置く。 */}
          <PaneHost
            id="preview"
            title={PANE_LABEL.preview}
            popped={isPopped('preview')}
            geom={paneGeom.preview}
            onClose={() => unpopPane('preview')}
            placeholder={
              <section className="panel pane-away" style={{ flex: '1 1 0', minWidth: 0 }}>
                <div className="pane-away-box">
                  <div className="pane-away-title">
                    ⧉ {PANE_LABEL.preview} は別ウィンドウで開いています
                  </div>
                  <button className="float-dock" onClick={() => unpopPane('preview')}>
                    ⇤ 本体へ戻す
                  </button>
                </div>
              </section>
            }
          >
          {/* プレビューの区画は components/panels/PreviewArea.tsx。
              プレビュー固有の物は心臓（previewContext）から取る */}
          <PreviewArea
            orderedTabs={orderedTabs} TAB_DEFS={TAB_DEFS} monitorTab={monitorTab}
            pickTab={pickTab} setTabMenu={setTabMenu} setTabOverflow={setTabOverflow}
            setTabOrder={setTabOrder} shortcuts={shortcuts} cueTrack={cueTrack}
            srcOfSeg={srcOfSeg} loadVideo={loadVideo} updateSource={updateSource}
            segLayoutRef={segLayoutRef} segsRef={segsRef} segIdCounter={segIdCounter}
            suppressHistoryRef={suppressHistoryRef}
            initializedForPathRef={initializedForPathRef} stopPlayback={stopPlayback}
            clearSegSel={clearSegSel} toggleTrack={toggleTrack} duration={duration}
            draggingMediaRef={draggingMediaRef}
          />
          </PaneHost>

          <div className="resizer resizer-v" onPointerDown={(e) => startResize('right', e)} />

          {/* 右パネルの区画は components/panels/RightPanelArea.tsx。
              右パネル固有の物は心臓（rightPanelContext）から取る */}
          <RightPanelArea
            PANE_LABEL={PANE_LABEL} orderedTabs={orderedTabs} TAB_DEFS={TAB_DEFS}
            pickTab={pickTab} setTabOrder={setTabOrder} setTabMenu={setTabMenu}
            setTabOverflow={setTabOverflow} setTplMenu={setTplMenu} setOrgMenu={setOrgMenu}
            rightTab={rightTab} setTransDrop={setTransDrop} draggingTransRef={draggingTransRef}
            draggingTelopAnimRef={draggingTelopAnimRef}
            setTelopDrop={setTelopDrop} toggleTelopEmphasis={toggleTelopEmphasis}
            myMotions={myMotions} motionPresets={motionPresets}
            applyMotionPreset={applyMotionPreset} deleteMyMotion={deleteMyMotion}
          />
        </div>

        <div className="resizer resizer-h" onPointerDown={(e) => startResize('timeline', e)} />

        <PaneHost id="timeline" title={PANE_LABEL.timeline} popped={isPopped('timeline')}
            geom={paneGeom.timeline} onClose={() => unpopPane('timeline')}>
        {/* タイムラインの区画は components/timeline/TimelineArea.tsx。
            掴む操作と見え方は心臓（timelineOpsContext / timelineViewContext）から取る */}
        <TimelineArea
          cueTrack={cueTrack}
          vcLen={vcLen}
          mediaMeta={mediaMeta}
          srcOfSeg={srcOfSeg}
          pairedAudioOf={pairedAudioOf}
          trackNum={trackNum}
          motionLabel={motionLabel}
          silenceCut={silenceCut}
          shortcuts={shortcuts}
          duration={duration}
        />
        </PaneHost>
      </div>

      {/* 一番下の帯は components/StatusBar.tsx */}
      <StatusBar
        telopCount={cues.length}
        selection={{
          telop: selectedIds.length,
          video: selectedVideoIds.length,
          audio: selectedAudioIds.length,
          se: selectedSeIds.length,
          image: selectedImgIds.length,
          vclip: selectedVClipIds.length,
          trans: !!selectedTrans,
          telopTrans: !!selectedTelopTrans,
          marker: selectedMarkerId != null,
          track: selectedTrackId
        }}
        tool={tool}
        ratio={ratio}
        playhead={formatTimecode(currentTime, fps)}
        shuttleRate={playRateUI}
        poppedPanes={(['left', 'preview', 'right', 'timeline'] as PaneId[])
          .filter((id) => isPopped(id))
          .map((id) => ({ id, label: PANE_LABEL[id] }))}
        autosaveNg={autosaveNg}
        appVersion={appVersion}
        onDock={(id) => unpopPane(id as PaneId)}
      />

      {/* ===== ドラッグ中の時間ツールチップ ===== */}
      {dragTip && (
        <div className="drag-tip" style={{ left: dragTip.x + 14, top: dragTip.y - 28 }}>
          {dragTip.text}
        </div>
      )}

      {/* 画面に覆いかぶさる物は components/panels/AppDialogs.tsx */}
      <AppDialogs />

      {/* 右クリックで出る品書き（何を並べるか）は components/AppMenus.tsx。
          出す入れ物そのものは components/ContextMenu.tsx に1つだけ置いてある。 */}
      <AppMenus
        menu={menu} setMenu={setMenu} clipMenu={clipMenu} setClipMenu={setClipMenu}
        tabMenu={tabMenu} setTabMenu={setTabMenu} tabOverflow={tabOverflow}
        setTabOverflow={setTabOverflow} tplMenu={tplMenu} setTplMenu={setTplMenu}
        orgMenu={orgMenu} setOrgMenu={setOrgMenu} clampMenu={clampMenu}
        PANE_LABEL={PANE_LABEL} TAB_DEFS={TAB_DEFS} orderedTabs={orderedTabs}
        pickTab={pickTab} setTabOrder={setTabOrder} isPopped={isPopped} popPane={popPane}
        unpopPane={unpopPane} monitorTab={monitorTab} rightTab={rightTab}
        allCats={allCats} customCats={customCats} setTplCat={setTplCat}
        isFav={isFav} toggleFav={toggleFav} setLabelFor={setLabelFor}
        selectByLabel={selectByLabel} setClipLabel={setClipLabel}
        deleteSelected={deleteSelected} rippleDeleteSelected={rippleDeleteSelected}
        deleteSelectedSE={deleteSelectedSE} deleteSelectedImg={deleteSelectedImg}
        deleteSelectedVClip={deleteSelectedVClip}
        deleteVideoSegmentsLeavingGap={deleteVideoSegmentsLeavingGap}
        rippleDeleteVideoSegments={rippleDeleteVideoSegments}
        duplicateClipsFromMenu={duplicateClipsFromMenu}
        splitVideoAtPlayhead={splitVideoAtPlayhead}
        toggleBlankSelectedVideo={toggleBlankSelectedVideo} findSilences={findSilences}
        silenceCut={silenceCut} setDuckOpen={setDuckOpen} copySelected={copySelected}
        copyAttributes={copyAttributes} pasteAttributes={pasteAttributes}
        copiedAttrs={copiedAttrs} attrSummary={attrSummary} shortcuts={shortcuts}
      />
    </div>
    </DialogsProvider>
    </RightPanelProvider>
    </PreviewProvider>
    </TimelineViewProvider>
    </TimelineOpsProvider>
  )
}

/**
 * 入口。**中身を囲うだけ**で、ここには処理を書かない。
 *
 * 区画（左パネル・プレビュー・タイムライン…）を切り出していくと、
 * それぞれが `useLayout()` などで必要な物を自分で見に行く形になる。
 * その囲いをここに並べる。
 */
export default function App(): React.JSX.Element {
  // **中身はここで作る。** 囲いの中で作ると、描き直すたびに作り直されて
  // 持っていた値が消える（段の鍵や拡大率が勝手に戻る形で出る）
  const tracks = useTracks(DEFAULT_TRACKS, initTrackStates)
  const view = useView()
  const toast = useToast()
  const playback = usePlayback(FPS)
  const dragPreview = useDragPreview()
  const projectState = useProjectState({
    favorites: loadFavorites(),
    catOverrides: loadCatOverrides(),
    customCats: loadCustomCats(),
    userTemplates: loadUserTemplates(),
    iconAssign: loadIconAssign(),
    laneIconAssign: loadJson<Record<string, string>>('giftcut.laneIconAssign', {}),
    recentProjects: loadRecentProjects(RECENT_KEY, RECENT_MAX),
    newTelopStyle: defaultTelopStyle()
  })
  return (
    <LayoutProvider>
      <SelectionProvider>
        <ContentProvider>
          <TracksProvider value={tracks}>
            <ViewProvider value={view}>
              <ToasterProvider value={toast}>
                <IconsProvider>
                  <PlaybackProvider value={playback}>
                    <ExportProvider>
                      <MediaProvider>
                        <ProjectStateProvider value={projectState}>
                          <ClipboardProvider>
                            <DragPreviewProvider value={dragPreview}>
                              <AppInner />
                            </DragPreviewProvider>
                          </ClipboardProvider>
                        </ProjectStateProvider>
                      </MediaProvider>
                    </ExportProvider>
                  </PlaybackProvider>
                </IconsProvider>
              </ToasterProvider>
            </ViewProvider>
          </TracksProvider>
        </ContentProvider>
      </SelectionProvider>
    </LayoutProvider>
  )
}
