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
  loadUserTemplates,
  saveUserTemplates,
  TELOP_CATS,
  loadFavorites,
  saveFavorites,
  loadCatOverrides,
  saveCatOverrides,
  colorCatOf,
  loadCustomCats,
  saveCustomCats,
  type TelopTemplate
} from './lib/telopTemplates'
import { LABEL_COLORS, DEFAULT_LABEL } from './lib/labels'
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
import {
  SilenceCutDialog,
  DuckingDialog,
  type SilenceCutState
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
import { cutsFromSilences, totalCutLen } from '../../shared/silenceCut'
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
import {
  voiceRegions,
  duckEnvelope,
  gainAt,
  envToFfmpegExpr,
  DEFAULT_DUCK,
  type DuckOpts
} from '../../shared/ducking'

type Tool = 'select' | 'razor' | 'trackFwd' | 'trackBack'
type Ratio = '16:9' | '9:16' | '1:1'

// ドラッグ中にカーソルへ付く既定のゴースト画像を消すための透明1px画像
// （配置位置はタイムライン上のゴーストで示すので、カーソルには何も握らせない）
const EMPTY_DRAG_IMG =
  typeof Image !== 'undefined'
    ? Object.assign(new Image(), {
        src: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
      })
    : null

// トランジションのD&D時、カーソルに付く小さな「持ってます」チップを表示する。
// 既定の大きいゴースト（ボタン全体）ではなく、アイコンだけの小さなピルにする。
function setDragChip(e: React.DragEvent, icon: string, label: string): void {
  e.dataTransfer.effectAllowed = 'copy'
  if (typeof document === 'undefined') return
  const el = document.createElement('div')
  el.className = 'drag-chip'
  el.textContent = `${icon} ${label}`
  document.body.appendChild(el)
  try {
    e.dataTransfer.setDragImage(el, 14, 14)
  } catch {
    /* noop */
  }
  // setDragImage は同期スナップショットなので、次tickで除去してよい
  setTimeout(() => el.remove(), 0)
}

const RECENT_KEY = 'giftcut.recentProjects'
const RECENT_MAX = 8

const FPS = FPS_FALLBACK // 既定フレームレート（素材fps未取得時のフォールバック）
const XF_GRACE = 0.08 // クロスディゾルブのカット通過後、mainがBへシークし終わるまでvideoBを保持する猶予(秒)
const RULER_H = 24
// タイムラインの上下に持たせる余白（テロップ3段ぶん）。
// 端に貼り付いていると、上や下に足す余地が見えず窮屈に感じる。
// ※位置の計算はすべて RULER_H + TRACK_PAD_TOP を起点にすること。
//   ここだけ足して他を直し忘れると、掴んだ場所と実際の段がずれる。
const TRACK_PAD_ROWS = 2

// 自動保存（落ちたときの下書き）の間隔。
// 落ちて失うのは最大でこの間隔ぶん。普通に閉じた場合は beforeunload で書き出すので
// 取りこぼさない。短くすれば安心だが、そのぶん書き込みが増える。
//
// **確認のときだけ短くできるようにしてある。** 2分待つ確認は書けないので、
// ここを外から縮められないと「自動保存が本当に走っているか」を誰も見ないままになる
// （復元する側だけ見て安心する、という空振りが起きる）。
const AUTOSAVE_MS = ((): number => {
  try {
    const v = Number(localStorage.getItem('giftcut.autosaveMs'))
    if (Number.isFinite(v) && v >= 500) return v
  } catch {
    /* localStorage が使えない環境では既定のまま */
  }
  // 2分。落ちて失う上限がそのままこの数字になる。
  // 中身が変わっていないときは文字列にすらしないので、待機中・再生中の負担はゼロ。
  // 効くのは「編集し続けている間」だけで、そこは書いてよい所。
  return 2 * 60 * 1000
})()


// トラック高さ（映像/音声グループごとにまとめて可変）。デフォはプレミア風に少し狭め
const TRACK_H_MIN = 26
const TRACK_H_MAX = 160

// タイムラインに載る物の形（VSeg / Source など）は lib/projectTypes、
// プレビューの画質（PreviewRes）は components/panels/PreviewBars。
interface ContextMenu {
  x: number
  y: number
  cueId: number
}
// テロップ以外のクリップ（動画切片/SE/画像/マーカー）の右クリックメニュー
interface ClipMenu {
  x: number
  y: number
  kind: 'seg' | 'se' | 'img' | 'vclip'
  id: number
  name: string
}

// 初期トラック（映像は先頭に連続、音声はその後に連続）。+ボタンで増やせる。
// 既定で用意する追加音声トラック（クイック追加ボタンの対象・旧プロジェクト補完先）

// キーボードの割り当て表は shared/shortcuts.ts（既定・一覧・見やすい表記）

// ゲイン(0..1) ↔ dB 表示
const gainToDb = (g: number): string => (g <= 0.0001 ? '-∞' : (20 * Math.log10(g)).toFixed(1))


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
  const [menu, setMenu] = useState<ContextMenu | null>(null)
  const [clipMenu, setClipMenu] = useState<ClipMenu | null>(null) // テロップ以外の右クリック
  const idCounter = useRef(1)

  // ---- 編集状態 ----
  const [tool, setTool] = useState<Tool>('select')
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
  // 動きの計測の小窓。既定は閉じたまま（開発中は閉じていても測り続ける）
  const [perfOpen, setPerfOpen] = useState(false)
  // 開発中の常時計測を、こちらから止めたか。止めたら右下のボタンが灰色になる
  const [perfStopped, setPerfStopped] = useState(false)
  // **毎レンダーここを通る。** 画面を作り直した回数がそのまま数になる
  perf.countRender()






  // マグネットの切り替えはここを通す。以前はショートカット(S)だけが保存していて、
  // ツールバーのボタンから切ると再起動で ON に戻っていた。
  function toggleSnap(): void {
    setSnap((v) => {
      try {
        localStorage.setItem('giftcut.snap', JSON.stringify(!v))
      } catch {
        /* 無視 */
      }
      return !v
    })
  }
  // マグネットの ON/OFF は編集の癖なのでPCに覚えさせる（プレビュー解像度や
  // パネル幅は保存しているのに、ここだけ毎回ONに戻っていた）。
  // loadLS はこの行より後ろで定義されるので使えない（使うと起動時に
  // 「Cannot access 'loadLS' before initialization」で真っ黒になる）。直接読む。
  const [snap, setSnap] = useState<boolean>(() => {
    try {
      return localStorage.getItem('giftcut.snap') !== 'false'
    } catch {
      return true
    }
  })

  // ---- 動画 ----
  // videoSrc=プレビュー用（生成後は編集用プロキシ）、videoPath=書き出し用の原本パス
  // 素材の実フレームレート（読み込み時に ffprobe で取得。未取得は既定30）。
  // フレームステップ/タイムコード/カットのフレーム量子化に使う。
  // 素材ごとまとめる／まとめを開く の進捗（null=実行していない）。
  // 数GBになることがあり、無反応に見えると二度押しされるので必ず出す。
  const [packPct, setPackPct] = useState<number | null>(null)
  // アプリの更新（GitHub から自動で当てる）の状況。null=何も出さない
  const [updateState, setUpdateState] = useState<UpdateState | null>(null)
  // 実行中かどうか。進捗の知らせは終わったあとにも遅れて届くので、これで無視する。
  // 見張っていないと最後の 100% が居座り、バッジが出たままになって
  // 「実行中だから」と次の操作を弾き続ける（実際にそうなった）。
  const packBusyRef = useRef(false)
  const proxyForPathRef = useRef<string | null>(null) // 今プロキシ生成中の原本パス
  // この動画について初期切片を作ったか。プロキシ完成でsrcが変わると loadedmetadata が再発火するため、
  // 「segments が空」を初期化条件にすると、全消しした直後にカットが勝手に復活してしまう。
  const initializedForPathRef = useRef<string | null>(null)
  // 字幕づくりの窓。**押してすぐ走らせない**（何分もかかるので必ず確認を挟む）
  const [subtitleOpen, setSubtitleOpen] = useState(false)
  const [subtitleState, setSubtitleState] = useState<SubtitlePhase>({ phase: 'idle' })
  // ここは描画中に走るので loadLS を使えない（定義がこれより下にある）
  const [subMaxChars, setSubMaxChars] = useState<number>(() => {
    const v = Number(localStorage.getItem('giftcut.subMaxChars'))
    return v >= 10 && v <= 30 ? v : 17
  })
  const [subReplace, setSubReplace] = useState(true)
  const [subModel, setSubModel] = useState<SubtitleModel>({
    ready: false,
    label: 'large-v3-turbo',
    sizeMB: 1600
  })
  // いま動いている本体の版（枠の題名の横に出す）。本体に聞くので、
  // 自動更新で入れ替わればそのまま新しい数字になる
  const [appVersion, setAppVersion] = useState('')
  useEffect(() => {
    void window.giftcut
      ?.getVersion?.()
      .then((v) => setAppVersion(typeof v === 'string' ? v : ''))
      .catch(() => setAppVersion(''))
  }, [])
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

  // ---- メディアライブラリ（プロジェクトに追加した動画/SE/画像）----
  interface MediaItem {
    id: number
    path: string
    name: string
    kind: 'video' | 'audio' | 'image'
    folder?: string
    thumb?: string // サムネイル(gcfile url)
  }
  // 取り込み済み素材の「尺」と「音声波形」をパスごとに先に用意しておく。
  // ドラッグ中のゴーストに波形をそのまま出せるようにするため（保存対象ではないキャッシュ）。
  const [mediaMeta, setMediaMeta] = useState<
    Record<string, { dur?: number; wave?: { min: number[]; max: number[]; dur: number } }>
  >({})
  const mediaMetaRef = useRef<typeof mediaMeta>({})
  useEffect(() => {
    mediaMetaRef.current = mediaMeta
  }, [mediaMeta])
  // 解析中のパス（同じファイルの波形解析を二重・三重に走らせないため）。
  // mediaMetaRef は effect 経由で遅れて更新されるので、同一tick内の重複はこれで防ぐ。
  const metaInFlightRef = useRef<Set<string>>(new Set())
  // サムネを作った（作りかけの）ファイル。同じものを何度も作らないため。
  const thumbDoneRef = useRef<Set<string>>(new Set())
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
  const vcLen = (c: VClip): number => Math.max(0.05, c.srcEnd - c.srcStart)
  // トラックIDの番号（V3→3）。対になる音声トラックは同じ番号（V3→A3）。
  const trackNum = (id: string): number => Number(id.slice(1)) || 0
  const pairedAudioOf = (vTrack: string): string => 'A' + trackNum(vTrack)
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
  const nVideoTracks = useMemo(() => tracks.filter((t) => t.kind === 'video').length, [tracks])
  const nAudioTracks = useMemo(() => tracks.filter((t) => t.kind === 'audio').length, [tracks])
  const v1Index = useMemo(() => tracks.findIndex((t) => t.id === 'V1'), [tracks])
  const a1Index = useMemo(() => tracks.findIndex((t) => t.id === 'A1'), [tracks])

  // ---- トラック状態 ----
  // 段とその状態（鍵など）は state/useTracks が持つ

  // ---- トラック高さ（映像/音声グループごとにまとめて可変・localStorage 永続化）----
  // プレミア同様、映像レーン全体・音声レーン全体をそれぞれ一括で高さ調整する
  //
  // 既定は**一番細く**（TRACK_H_MIN）。段が7本あると、太いままでは枠に収まらず
  // 初めて開いた人がいきなり縦に送る羽目になる。細ければ全部が一度に見えるので、
  // 太らせたい人だけが太らせればいい（太さは保存されるので次から続く）。
  //
  // 前の既定（映像34/音声52）がそのまま保存されている場合は、自分で決めた値では
  // ないので新しい既定へ移す。**触った覚えのない値だけ**を動かす
  // （1px でもずらしてあれば、その人が選んだ太さとして尊重する）。
  const OLD_DEF_H = { 'gc.videoTrackH': 34, 'gc.audioTrackH': 52 }
  const loadGroupH = (key: keyof typeof OLD_DEF_H, def: number): number => {
    const v = Number(localStorage.getItem(key))
    if (!(v >= TRACK_H_MIN && v <= TRACK_H_MAX)) return def
    return v === OLD_DEF_H[key] ? def : v
  }
  /** 段の高さ。id を渡せばその段の値、種類だけなら種類の値 */
  const trackHOf = (idOrKind: string): number => {
    const own = laneH[idOrKind]
    if (own != null) return own
    if (idOrKind === 'video' || idOrKind === 'audio')
      return idOrKind === 'video' ? videoTrackH : audioTrackH
    const t = tracks.find((x) => x.id === idOrKind)
    return t?.kind === 'audio' ? audioTrackH : videoTrackH
  }
  const cueTrack = (c: Cue): string => c.track ?? 'V2' // テロップの配置トラック（未指定=V2）
  // オーディオトラックの実効ゲイン（ミュート/ソロ/音量×マスターを合成）
  const anyAudioSolo = tracks.some((t) => t.kind === 'audio' && trackStates[t.id]?.solo)

  // 段（トラック）の足す・消す・選ぶ・鍵・音量は state/useTracksAdmin
  const {
    trackFromEvent, mainLocked, fallbackTrack, audioTrackFromEvent, insertTrackOrdered,
    reserveTrackPairForVideo, setClipLabel, addVideoTrack, addAudioTrack, trackHasContent,
    telopLocked, trackHasContentInner, canDeleteTrack, deleteTrack, selectTrack,
    audioTrackGain, setTrackVolume, startFader, startGroupResize
  } = useTracksAdmin({
    TRACK_PAD_ROWS, anyAudioSolo, cueTrack, trackNum, trackHOf, nVideoTracks, nAudioTracks,
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
  // ---- プレビュー解像度（アプリ設定。プロジェクトではなくPCごとの好みなので localStorage）----
  // 1080 / 720 / 360 のどれかで、**どれも焼き直した映像**で再生する。
  // 書き出しは常に原本のフル画質なので、ここを下げても完成品の画質は落ちない。
  // ※useState の初期化関数は即時実行されるため、loadLS の定義より後に置く必要がある。
  // 既定は 1080（見た目は原本とほぼ同じで、カットでも引っかからない）。
  const [previewRes, setPreviewRes] = useState<PreviewRes>(() => {
    const v = loadLS<unknown>('giftcut.previewRes', 1080)
    // 前の版の 'orig'（原本）/'full'（原寸・軽い）は、どちらも 1080 にあたる。
    // **黙って 360 に落とさない**（次に開いたら低画質だった、が一番困る）
    if (v === 720 || v === '720') return 720
    if (v === 360 || v === '360') return 360
    return 1080
  })
  const previewResRef = useRef<PreviewRes>(previewRes)
  /** 直前に反映した画質。**自分で変えたのか、焼き上がりが届いただけなのか**を分ける */
  const lastPreviewResRef = useRef<PreviewRes>(previewRes)
  useEffect(() => {
    previewResRef.current = previewRes
    saveLS('giftcut.previewRes', previewRes)
  }, [previewRes])
  // 作成済みプロキシ（原本パス → gcfile URL と解像度）。映像レイヤー(VClip)も同じ映像を使うため、
  // ソース単位ではなくパス単位で持つ（1本の動画に対してプロキシは1つ）。
  const [proxyMap, setProxyMap] = useState<Record<string, { url: string; res: number }>>({})
  const proxyReqRef = useRef<Set<string>>(new Set()) // 変換中のもの。同じ変換を二重に走らせない
  const proxyFailRef = useRef<Set<string>>(new Set()) // 変換に失敗したもの。無限に作り直さない
  const [proxyTick, setProxyTick] = useState(0) // 1本終わるたびに次を取りに行くための合図
  // プレビューに使う映像URL。焼き直した物ができていればそれ、まだなら原本。
  // **作っている間も原本で見えている**（真っ暗になるより、重くても映るほうがよい）。
  // 解像度切替の変換中も「前の解像度の物」を映したまま（原本へ戻すと二重リロードになる）。
  /**
   * いま <video> に入れる URL。焼き上がっていればそれ、無ければ原本。
   *
   * **流している最中は差し替えない。**
   * src を書き換えると要素が読み込み直しになり、そこで**音が切れる**。
   * 焼き直しは再生中にも終わるので、何もしないと「流していたら急にプツッと鳴る」。
   * 実測（npm run stutter --fresh）で、抜けはいつも変換の完了時に出ていた。
   *
   * 止めた瞬間に入れ替わる。見ている間は原本のままだが、画質が少し眠いだけで、
   * 音が切れるより遥かにまし。**自分で画質を変えたときは、その場で入れ替える**
   * （待たされると「効いていない」と見えるため）。
   */
  const shownSrcRef = useRef<Map<string, string>>(new Map())
  const srcResRef = useRef<PreviewRes>(previewRes)
  const previewUrl = (path: string, orig: string): string => {
    const want = proxyMap[path]?.url ?? orig
    const shown = shownSrcRef.current.get(path)
    // 画質を自分で変えた回は、流していても入れ替える
    const byHand = srcResRef.current !== previewRes
    if (playRateRef.current !== 0 && !byHand && shown && shown !== want) return shown
    shownSrcRef.current.set(path, want)
    srcResRef.current = previewRes
    return want
  }
  // 焼き直した映像を用意する唯一の入口。ソース／映像レイヤーが増えたときや
  // 解像度を変えたときに走り、足りないものだけ変換する。
  // 同時変換は2本まで（映像レイヤーが多いプロジェクトで ffmpeg が一斉に立ち上がるのを防ぐ）。
  useEffect(() => {
    const res: number = previewRes
    const paths = new Set<string>()
    for (const s of sources) if (s.path) paths.add(s.path)
    for (const c of vClips) if (c.path) paths.add(c.path)
    paths.forEach((p) => {
      if (proxyReqRef.current.size >= 2) return // 空きが出たら次の合図で続きを取る
      if (proxyMap[p]?.res === res) return
      const k = res + '|' + p
      if (proxyReqRef.current.has(k) || proxyFailRef.current.has(k)) return
      proxyReqRef.current.add(k)
      // 「プレビュー最適化中」の表示は主素材ぶんだけ（進捗イベントも主素材で絞っている）
      if (p === proxyForPathRef.current) setProxyPct(0)
      void window.giftcut.generateProxy(p, res).then((r) => {
        // 終わったら必ず外す。残したままだと解像度を素早く往復させたときに
        // 「変換中だから作らない」と判定され、選んだ解像度に戻れなくなる。
        proxyReqRef.current.delete(k)
        const rp = r?.ok ? r.path : undefined
        if (rp) setProxyMap((m) => ({ ...m, [p]: { url: toGcUrl(rp), res } }))
        else {
          proxyFailRef.current.add(k)
          if (r?.error) console.warn('プロキシ生成失敗:', r.error) // 失敗時は原本のまま再生
        }
        if (p === proxyForPathRef.current) setProxyPct(null)
        setProxyTick((t) => t + 1)
      })
    })
  }, [previewRes, sources, vClips, proxyMap, proxyTick])
  // テロップカード右クリック→フォルダ移動メニュー
  const [tplMenu, setTplMenu] = useState<{ x: number; y: number; name: string; curCat: string } | null>(
    null
  )
  useEffect(() => {
    if (!tplMenu) return
    const close = (): void => setTplMenu(null)
    const onEsc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setTplMenu(null)
    }
    window.addEventListener('click', close)
    window.addEventListener('keydown', onEsc)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', onEsc)
    }
  }, [tplMenu])
  // 各セクション見出しのDOM参照（展開時に先頭へスクロールするため）
  const tplSecRefs = useRef<Record<string, HTMLDivElement | null>>({})
  // 展開したら、そのカテゴリの1つ目が見えるよう見出しをパネル先頭へスクロール
  useEffect(() => {
    if (!openTplSec) return
    const el = tplSecRefs.current[openTplSec]
    if (el) requestAnimationFrame(() => el.scrollIntoView({ block: 'start', behavior: 'smooth' }))
  }, [openTplSec])
  useEffect(() => {
    refreshPresets()
  }, [])

  const rightBodyRef = useRef<HTMLDivElement>(null)
  const draggingIconRef = useRef<string | null>(null) // コラボアイコン(ラベル色)をテロップへD&D中
  // トランジションをタイムラインへD&D中の種類。置き場所(頭/間/尻)はドロップ位置で自動判別する。
  const draggingTransRef = useRef<{ type: TransType } | null>(null)
  // ドラッグ中の配置プレビュー = 実際に置かれる帯そのもの（left/width=トラック行内px）を
  // 該当レーンに表示してマグネット感を出す。segId=どのV1クリップ行に描くか。
  const [transDrop, setTransDrop] = useState<{
    segId: number
    left: number
    width: number
    label: string
    kind: 'in' | 'out' | 'xfade'
  } | null>(null)
  // テロップの出入りアニメを D&D 中の種類（動画トランジションと同じ流儀）。頭=in / 間=both / 尻=out に配置。
  const draggingTelopAnimRef = useRef<{ type: AnimIn } | null>(null)
  const [telopDrop, setTelopDrop] = useState<{
    cueId: number
    left: number
    width: number
    label: string
    kind: 'in' | 'out' | 'between'
  } | null>(null)
  // 新規トランジションの長さ(秒)。D&D で置く時の初期長さ。置いた後は帯の端ドラッグ/選択で変更。
  // ※プロジェクトに保存する値なので、未保存判定の依存配列より前で宣言しておくこと。
  const draggingTemplateRef = useRef<TelopStyle | null>(null) // テンプレをテロップへD&D中

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

  // ---- プレビュー内インライン編集 ---- （宣言はセッション保存/復元より前に移動済み）
  const screenRef = useRef<HTMLDivElement>(null)
  // プレビュー上テロップの手動ダブルタップ検出（ネイティブdblclickが状態依存で不発なため）
  const trackInnerRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  // 縦スクロールに追従させる相手＝左の段見出しの並び。
  // スクロールの外にいるので、送った量だけ自分で上へずらす。
  const thBodyRef = useRef<HTMLDivElement>(null)
  /**
   * タイムラインを縦に送ったときの追従。中身は lib/timelineVScroll.ts。
   *
   * React の状態にはしない。スクロールは毎秒何十回も飛んでくるので、
   * ここで作り直すと前回せっかく 250回/秒 → 60回/秒 にした所へ逆戻りする。
   */
  const syncTimelineVScroll = useCallback((): void => {
    applyTimelineVScroll(scrollRef.current?.scrollTop ?? 0, {
      headers: thBodyRef.current,
      inner: trackInnerRef.current
    })
  }, [])

  /**
   * プレビューとの境目を動かして高さが変わったときの、タイムラインの伸び縮み。
   *
   * **上と下が一緒に小さくなる**（プレミアと同じ感じ）ようにする。
   * 素のままだと枠は下端だけが動くので、縮めると音声側から順に消えていき、
   * 映像側はいつまでも全部見えたまま——片側だけが減る動きになる。
   *
   * 残すのは映像と音声の境目。段の高さは変えない（触った覚えのない所が
   * 太ったり痩せたりするほうが分かりにくい）。
   *
   * 境目の位置は状態から計算せず、**実際に置かれている最初の音声段**から測る。
   * 計算で出すと、余白や目盛りの高さを直したときにここだけ古い式が残る。
   */
  const fitTimelineAroundVA = useCallback((): void => {
    const el = scrollRef.current
    const inner = trackInnerRef.current
    if (!el || !inner) return
    const firstAudio = inner.querySelector<HTMLElement>('.track-audio')
    if (!firstAudio) return
    el.scrollTop = centeredScrollTop(
      firstAudio.offsetTop,
      el.clientHeight,
      el.scrollHeight - el.clientHeight
    )
    syncTimelineVScroll() // scrollTop を書いても届かない場合に備えて自分でも配る
  }, [syncTimelineVScroll])

  // 画面に出ている時間の範囲（見えない帯は作らない）は state/useVisibleRange
  const viewSec = useVisibleRange(scrollRef)
  /** 帯を描く必要があるか（画面に出ているか） */
  const inView = (tStart: number, tEnd: number): boolean =>
    tEnd >= viewSec.a && tStart <= viewSec.b

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
  const segLayout = useMemo(() => layoutSegs(segments), [segments])
  const videoTLen = useMemo(() => totalSegLen(segments), [segments])
  const segLayoutRef = useRef<SegLayout[]>([])

  // 動きの計測と不具合の記録は state/useDiagnostics
  useDiagnostics({
    setPerfOpen, dragTip, marquee, segLayoutRef, previewResRef, videoRef
  })
  const videoTLenRef = useRef(0)
  useEffect(() => {
    segLayoutRef.current = segLayout
  }, [segLayout])
  useEffect(() => {
    videoTLenRef.current = videoTLen
  }, [videoTLen])

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

  // プロキシ生成の進捗を購読（今読み込み中の原本パス分だけ反映）
  useEffect(() => {
    const off = window.giftcut?.onProxyProgress?.(({ path, percent }) => {
      if (path === proxyForPathRef.current) setProxyPct(percent >= 100 ? null : percent)
    })
    return () => off?.()
  }, [])

  useEffect(() => {
    const off = window.giftcut?.onExportProgress?.(({ percent }) => setExportPct(percent))
    return () => off?.()
  }, [])

  // 字幕づくりの進み具合を受け取る
  useEffect(() => {
    const off = window.giftcut?.onSubtitleProgress?.((s) => setSubtitleState(s as SubtitlePhase))
    return () => off?.()
  }, [])
  // 窓を開けたら、準備が手元にあるかを聞く（落とす大きさを先に見せるため）
  useEffect(() => {
    if (!subtitleOpen) return
    void window.giftcut?.subtitleStatus?.().then((r) => {
      if (!r?.ok) return
      setSubModel({ ready: r.exe && r.model, label: r.label, sizeMB: r.sizeMB })
    })
  }, [subtitleOpen])

  // 関連付け（ダブルクリック）で開かれたプロジェクトを開く。
  // **受け取る側が居ないと「メモ帳で開きますか？」のまま何も起きない。**
  useEffect(() => {
    const off = window.giftcut?.onOpenProjectPath?.((p) => {
      void openProjectFn(p)
    })
    return () => off?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 更新の再起動の直前。今の状態を下書きに書いてから「書けた」と返す。
  // 更新は「未保存の変更が無いとき」しか当てないが、それでも
  // 開いていたプロジェクト・再生位置・画面の形は消したくない。
  // 次の起動でこれを黙って読み直すので、印（resumeAfterUpdate）も付ける。
  useEffect(() => {
    const off = window.giftcut?.onUpdateFlush?.(() => {
      void (async () => {
        try {
          localStorage.setItem('giftcut.resumeAfterUpdate', '1')
          await window.giftcut.autosaveProject(projectJson())
        } catch (e) {
          console.warn('[update] 再起動前の保存に失敗:', e)
        } finally {
          window.giftcut.updateFlushed()
        }
      })()
    })
    return () => off?.()
  })

  useEffect(() => {
    const off = window.giftcut?.onUpdateState?.((s) => {
      // 「新しいのは無い」「見に行っています」は黙っておく。
      // 何も起きていないことをいちいち画面に出しても、邪魔なだけなので。
      setUpdateState(s.phase === 'none' || s.phase === 'checking' ? null : s)
    })
    return () => off?.()
  }, [])

  useEffect(() => {
    const off = window.giftcut?.onPackProgress?.(({ percent }) => {
      if (packBusyRef.current) setPackPct(percent)
    })
    return () => off?.()
  }, [])

  const seEnd = useMemo(
    () => (seClips.length ? Math.max(...seClips.map((s) => s.tStart + s.duration)) : 0),
    [seClips]
  )
  // 画像クリップの終端（動画より後ろに置いたエンドカード等もタイムライン尺に含める）
  const imgEnd = useMemo(
    () => (imgClips.length ? Math.max(...imgClips.map((c) => c.tStart + c.duration)) : 0),
    [imgClips]
  )
  // 映像レイヤークリップの終端もタイムライン尺に含める
  const vcEnd = useMemo(
    () =>
      vClips.length
        ? Math.max(...vClips.map((c) => c.tStart + Math.max(0.05, c.srcEnd - c.srcStart)))
        : 0,
    [vClips]
  )
  const duration = useMemo(() => {
    const cueEnd = cues.length ? Math.max(...cues.map((c) => c.end)) + 3 : 0
    return Math.max(cueEnd, videoTLen, seEnd, imgEnd, vcEnd, 60)
  }, [cues, videoTLen, seEnd, imgEnd, vcEnd])

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
  // ルーラーの目盛り（拡大率・尺だけに依存＝毎フレーム再計算しないようメモ化）。
  const rulerTicks = useMemo(() => {
    const cands = [
      1 / fps, 2 / fps, 5 / fps, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600
    ]
    const minLabelPx = 84
    let major = cands[cands.length - 1]
    for (const c of cands)
      if (c * zoom >= minLabelPx) {
        major = c
        break
      }
    const majorPx = major * zoom
    const sub = [10, 5, 4, 2, 1].find((n) => majorPx / n >= 7) ?? 1
    const minor = major / sub
    // 上限は高ズーム×長尺でも右端まで目盛りが出るよう十分大きく（メモ化＝毎フレーム再計算はしない）
    const nMinor = Math.min(20000, Math.floor(duration / minor) + 1)
    const ticks: { left: number; major: boolean; label?: string }[] = []
    for (let i = 0; i <= nMinor; i++) {
      const time = i * minor
      const isMajor = Math.abs(time / major - Math.round(time / major)) < 1e-6
      ticks.push({
        left: time * zoom,
        major: isMajor,
        label: isMajor ? formatTimecode(time, fps) : undefined
      })
    }
    return ticks
  }, [zoom, duration, fps])
  // 実コンテンツの終端（再生はここで止める。タイムライン表示幅の最低60秒とは別物）
  const contentEnd = useMemo(() => {
    const cueEnd = cues.length ? Math.max(...cues.map((c) => c.end)) : 0
    return Math.max(cueEnd, videoTLen, seEnd, imgEnd, vcEnd)
  }, [cues, videoTLen, seEnd, imgEnd, vcEnd])
  const contentEndRef = useRef(0)
  useEffect(() => {
    contentEndRef.current = contentEnd
  }, [contentEnd])
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

  // 上位トラック(V3)が上に重なるよう描画順を整える（DOM後方=前面）
  // 先頭が0付近(≤0.5s)から始まるキューは、先頭の小ギャップを埋めて t=0(最左)でも表示する
  // （SRTの先頭が0.1s等から始まるケースで、頭が字幕なしになるのを防ぐ）。他キューは通常判定。
  const firstStart = cues.reduce((m, c) => Math.min(m, c.start), Infinity)
  const headFill = firstStart <= 0.5
  const activeCues = cues
    .filter((c) => {
      const eff = headFill && c.start === firstStart ? 0 : c.start
      // 開始ちょうどから表示（旧: -1/FPSの先行表示があり、隣接テロップが切替時に1フレーム
      // 重なって「2枚ぬめっと重なる」見た目になっていた。隣接(end==次start)は判定が相補なので隙間も出ない）
      return currentTime >= eff && currentTime < c.end
    })
    .sort((a, b) => tracks.findIndex((t) => t.id === cueTrack(b)) - tracks.findIndex((t) => t.id === cueTrack(a)))
  const labelGroups = LABEL_COLORS.map((l) => ({
    ...l,
    count: cues.filter((c) => c.label === l.color).length
  })).filter((g) => g.count > 0)

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


  // どこからも参照されなくなった素材メタ（尺・波形）を解放する。
  // 波形は長尺で数MB級になるので、素材を入れ替えながら作業すると単調増加してしまう。
  // 変更が落ち着いてから1回だけ走らせる（ドラッグ中などに毎回走らせない）。
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const used = new Set<string>()
      for (const m of mediaItems) used.add(m.path)
      for (const c of vClipsRef.current) used.add(c.path)
      for (const c of seClipsRef.current) used.add(c.path)
      for (const c of imgClipsRef.current) used.add(c.path)
      for (const s of sourcesRef.current) used.add(s.path)
      // Undo/Redo で戻ってくるクリップの波形も残す（戻した途端に「波形解析中…」になるのを防ぐ）
      for (const snap of [...undoStackRef.current, ...redoStackRef.current]) {
        for (const c of snap.vClips ?? []) used.add(c.path)
        for (const c of snap.seClips) used.add(c.path)
        for (const c of snap.imgClips ?? []) used.add(c.path)
      }
      metaInFlightRef.current.forEach((p) => used.add(p)) // 解析中は落とさない
      const keys = Object.keys(mediaMetaRef.current)
      if (keys.every((k) => used.has(k))) return
      setMediaMeta((prev) => {
        const next: typeof prev = {}
        for (const k of Object.keys(prev)) if (used.has(k)) next[k] = prev[k]
        return next
      })
    }, 3000)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaItems, vClips, seClips, imgClips, sources])

  const v1Hidden = trackStates['V1']?.hidden ?? false


  // 重ねる動画の <video>（窓で区切って残す理由も中に）は state/useVClipEls
  const { windowVClips, vcElsRef, vcRefCb } = useVClipEls(vClips, currentTime, tracks)
  // プレビューに常設する <video> の一覧。sources 未確定でも videoSrc があれば仮の1件で描く。
  const previewSources: Source[] = useMemo(() => {
    if (sources.length) return sources
    if (videoSrc)
      return [
        { id: -1, path: '', name: '', origUrl: videoSrc, duration: videoDuration, fps, waveform: null }
      ]
    return []
  }, [sources, videoSrc, videoDuration, fps])
  // 実際に表示するソースID（activeSrcId が一覧に無ければ先頭＝主ソース）
  const effActiveSrcId = previewSources.some((s) => s.id === activeSrcId)
    ? activeSrcId
    : (previewSources[0]?.id ?? null)
  // 再生ヘッド位置の切片が黒ブランクなら映像を黒表示
  const curBlank = (() => {
    const src = tToSource(segLayout, currentTime)
    return src ? !!segments[src.index]?.videoBlank : false
  })()
  // 再生ヘッド位置の切片の色調整（CSS filter）。切片が変わると自動で切り替わる。
  const curAdjustCss = (() => {
    const src = tToSource(segLayout, currentTime)
    return src ? adjustCss(segments[src.index]?.adjust) : undefined
  })()
  // 再生ヘッド位置の切片のズーム（リフレーム）。編集/プレビュー対象。
  // **動きが付いていれば、その瞬間の値**（印が無ければ今までどおり固定値がそのまま返る）。
  const curSegZoom = (() => {
    const src = tToSource(segLayout, currentTime)
    const seg = src ? segments[src.index] : undefined
    if (!seg) return DEFAULT_ZOOM
    const L = segLayout[src!.index]
    return zoomAt(seg.zoom ?? DEFAULT_ZOOM, seg.motion, currentTime - (L?.tStart ?? 0))
  })()
  // 再生ヘッド位置の切片のクロップ。編集/プレビュー対象。
  const curSegCrop = (() => {
    const src = tToSource(segLayout, currentTime)
    return (src ? segments[src.index]?.crop : undefined) ?? DEFAULT_CROP
  })()
  const curCropInset = cropInset(curSegCrop)
  // リフレーム枠（プレビューの拡大/移動/回転）の操作対象。
  // 画像を1つ選択中なら画像、そうでなければ再生ヘッド位置の動画切片を対象にする。
  // ＝「画像を選んだのに動画が拡大される」を防ぐ。
  // リフレーム（拡大/パン/回転）の操作対象。動画切片・画像・映像レイヤーのどれか1つ。
  const reframeTarget: ReframeTarget | null = (() => {
    // 映像レイヤーを1つ選択中ならそれを最優先（画像より手前の操作対象）
    const vc =
      selectedVClipIds.length === 1
        ? vClips.find((c) => c.id === selectedVClipIds[0])
        : undefined
    if (vc)
      return {
        kind: 'vclip' as const,
        id: vc.id,
        zoom: vc.zoom ?? DEFAULT_ZOOM,
        rotate: vc.rotate ?? 0,
        track: vc.track,
        name: vc.name,
        motion: vc.motion,
        tStart: vc.tStart,
        len: vcLen(vc)
      }
    const img =
      selectedImgIds.length === 1 ? imgClips.find((c) => c.id === selectedImgIds[0]) : undefined
    if (img)
      return {
        kind: 'img' as const,
        id: img.id,
        zoom: img.zoom ?? DEFAULT_ZOOM,
        rotate: img.rotate ?? 0,
        track: img.track,
        name: img.name,
        motion: img.motion,
        tStart: img.tStart,
        len: img.duration
      }
    // 選択している切片を優先する（画像・映像レイヤーは選択から取っているのに、
    // 動画切片だけ再生ヘッド位置から取っていたため、3番目の切片を選んで枠を
    // ドラッグすると再生ヘッドのある1番目が拡大されていた）。
    // 選択が無いときだけ従来どおり再生ヘッド位置の切片を対象にする。
    const selL = selectedVideoIds.length
      ? segLayout.find((l) => selectedVideoIds.includes(l.seg.id))
      : undefined
    const src = tToSource(segLayout, currentTime)
    const L = selL ?? (src ? segLayout[src.index] : undefined)
    const seg = L?.seg
    if (!seg) return null
    return {
      kind: 'video' as const,
      id: seg.id,
      zoom: seg.zoom ?? DEFAULT_ZOOM,
      rotate: seg.rotate ?? 0,
      track: 'V1',
      name: srcOfSeg(seg)?.name ?? videoName ?? '動画',
      motion: seg.motion,
      tStart: L!.tStart,
      len: L!.len
    }
  })()
  const reframeTargetRef = useRef(reframeTarget)
  reframeTargetRef.current = reframeTarget
  // プレビューに出す「いまの絵」の組み立て（回転・拡大・つなぎ目の演出）は
  // state/usePreviewFrame
  const {
    curSegXform, videoZoomTransform, inOutPreview, transOverlay, videoMainStyle,
    xfPreview, xfNextBUrl, xfDipOverlay
  } = usePreviewFrame({ XF_GRACE, segLayout, srcOfSeg, curSegZoom, curCropInset, previewUrl })










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




  // 切片を切ったときの断片の作り方。頭側は「尻に付いていたもの」、尻側は
  // 「頭に付いていたもの」を落とす（切り口にトランジションやフェードが残らないように）。
  // 尻側は別クリップになるので id を振り直す。
  const segSplit: SplitSeg<VSeg> = (s, part, srcStart, srcEnd) =>
    part === 'head'
      ? { ...s, srcStart, srcEnd, transOut: undefined, xfade: undefined, afadeOut: undefined }
      : {
          ...s,
          id: segIdCounter.current++,
          srcStart,
          srcEnd,
          transIn: undefined,
          afadeIn: undefined
        }
  // 空白切片（映像なし・無音）。位置を指定した配置・移動で空いた所を埋める。
  const makeGapSeg = (len: number): VSeg => ({
    id: segIdCounter.current++,
    srcStart: 0,
    srcEnd: len,
    videoBlank: true,
    muted: true,
    gap: true
  })
  const segOps: SegOps<VSeg> = { split: segSplit, makeGap: makeGapSeg, isGap: (s) => !!s.gap }
  // 本編の切片をどこへ置くか（動かす・新しく置く・落とした所へ）は state/useSegmentPlace
  const { cutRangeFromSegs, moveSegmentTo, placeSegAt, placeVideoAtDrop } = useSegmentPlace({
    mainLocked, segOps, segSplit, shiftAfter, loadVideo, registerSource
  })

  // ---- プロジェクトのメディアライブラリ（動画/SE/画像。フォルダ追加対応）----
  const kindOf = (p: string): 'video' | 'audio' | 'image' => {
    const ext = p.toLowerCase().split('.').pop() ?? ''
    if (['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'].includes(ext)) return 'audio'
    if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return 'image'
    return 'video'
  }


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

  // ---- 自動保存 / クラッシュ復帰 ----
  const lastAutosaveRef = useRef('') // 前回自動保存した内容（変化時だけ書き込む）
  // 最後に「保存済み」となった内容。×ボタンの未保存確認はこれと現在の内容を比べる
  // （isDirty() は履歴デバウンス基準で450ms後に false へ戻るため、閉じる判定には使えない）。
  const savedJsonRef = useRef<string | null>(null)
  // 形は components/dialogs/ProjectDialogs.tsx の RestoreState 側に置いてある
  const [restorePrompt, setRestorePrompt] = useState<RestoreState | null>(null)
  // ★依存配列を空にしてタイマーを一度だけ作る（毎レンダー再生成だと再生/編集中に一度も発火しないバグ）。
  //   最新state参照は ref 経由（projectJson/hasProjectContent は毎レンダー再代入）。
  // **中身を作る側（useProjectFile）より先に器を作る。**
  // 器を後から作ると、器を欲しがる側と作る側が互いを待つ形になる
  const projectJsonRef = useRef<(p?: string | null) => string>(() => '')
  const hasContentRef = useRef(hasProjectContent)
  hasContentRef.current = hasProjectContent

  // プロジェクト全体を文字列にするのは重い（クリップ・テロップが増えるほど）。
  // 「保存済みと同じか」と「自動保存に書くか」は同じ文字列を使うので、
  // 1レンダーにつき1回だけ作って使い回す。
  //
  // 使い回してよい根拠: プロジェクトの中身はすべて React の state なので、
  // 変われば必ず描き直され、projectJson の関数そのものが作り直される。
  // ＝関数が同じなら中身も同じ。
  const jsonCacheRef = useRef<{ fn: typeof projectJson; json: string } | null>(null)
  const currentJson = (): string => {
    const fn = projectJsonRef.current
    const hit = jsonCacheRef.current
    if (hit && hit.fn === fn) return hit.json
    const json = fn()
    jsonCacheRef.current = { fn, json }
    return json
  }
  const currentJsonRef = useRef(currentJson)
  currentJsonRef.current = currentJson

  // 未保存かどうかをメインプロセスへ通知（×ボタンで閉じるときの確認ダイアログに使う）。
  // ついでに画面のタイトルに出す「＊」もここで決める。
  //
  // 以前タイトルは isDirty()（Undo履歴の基準との比較）を見ていたが、あれは
  // 編集の450ms後に false へ戻るので、未保存でも「＊」が消えていた。
  // ＝「＊が無い＝保存済み」と思って閉じると編集が飛ぶ。保存済みの内容と
  // 今の内容を直接比べたこの判定を、閉じる確認とタイトルで共通に使う。
  //
  // nowJson: 保存直後など「今の内容」が手元にあるときに渡す。渡さないと
  // まだ描き直される前の古い内容と比べてしまい、「＊」が一瞬ちらつく。
  const lastDirtySentRef = useRef<boolean | null>(null)
  const markUnsaved = (nowJson?: string): void => {
    try {
      const cur = nowJson ?? currentJsonRef.current()
      const dirty = hasContentRef.current() ? savedJsonRef.current !== cur : false
      setUnsaved(dirty)
      // 同じ値を送り続けない（以前は0.8秒ごとに毎回IPCを投げていた）
      if (dirty !== lastDirtySentRef.current) {
        lastDirtySentRef.current = dirty
        window.giftcut?.setDirty?.(dirty)
      }
    } catch {
      /* noop */
    }
  }
  const markUnsavedRef = useRef(markUnsaved)
  markUnsavedRef.current = markUnsaved

  // 「＊」の付け外しは、以前は0.8秒ごとに総当たりで見ていた。
  // それだと何も編集していない間も、再生しているだけの間も、ずっと
  // プロジェクト全体を文字列にし続けることになる（長い素材ほど効く）。
  //
  // なので中身が変わったときだけ見直す。編集が止まってから 300ms 後に1回。
  // 依存配列は projectJson が読んでいる値ぜんぶ。片方だけ足すと「＊」が
  // 出ないので、projectJson を触ったらここも触ること。
  //
  // 万一ここに書き漏らしても、閉じるときの確認は hasUnsavedChanges() が
  // その場で比べ直すので、編集が黙って消えることはない（「＊」が遅れるだけ）。
  const projectRevRef = useRef(0)
  useEffect(() => {
    projectRevRef.current += 1
    const id = window.setTimeout(() => markUnsavedRef.current(), 300)
    return () => window.clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    videoPath,
    missingMedia,
    srtPath,
    sources,
    ratio,
    tracks,
    cues,
    segments,
    seClips,
    markers,
    imgClips,
    vClips,
    trackStates,
    mediaItems,
    iconSide,
    iconOffset,
    iconScale,
    iconAuto,
    iconAnchorPos,
    iconAssign,
    laneIconAssign,
    exportOpts,
    loudnormLUFS,
    masterVolume,
    transDur,
    newTelopStyle,
    // 画面の配置も保存の中身なので、変わったら「＊」が出る
    popped,
    paneGeom,
    leftW,
    rightW,
    timelineH,
    videoTrackH,
    audioTrackH,
    tabOrder,
    rightTab,
    monitorTab,
    projectPath
  ])

  // 自動保存（クラッシュしたときの下書き）。2分ごと。
  // 中身が変わっていなければ文字列にすらしない＝待機中・再生中はゼロ。
  // 間隔を縮めたければ AUTOSAVE_MS だけ変えればよい。落ちたときに失うのは
  // 最大でこの間隔ぶん（普通に閉じた場合は下の beforeunload で取りこぼさない）。
  const autosavedRevRef = useRef(-1)
  // 実際に書くのは state/useProjectIO の writeAutosave（書けなかったときの扱いも中にある）
  const autosaveNgRef = useRef(false)
  const [autosaveNg, setAutosaveNg] = useState(false)



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
  // 形と説明は components/dialogs/AudioDialogs.tsx の SilenceCutState 側に置いてある
  const [silenceCut, setSilenceCut] = useState<SilenceCutState>({
    busy: false,
    found: null,
    noiseDb: -35,
    minSec: 0.35,
    pad: 0.15,
    minLen: 0.4
  })
  const [silenceOpen, setSilenceOpen] = useState(false)
  // ---- ダッキング（声が入っている間だけ BGM を下げる）----
  //
  // 無音を探す仕組みをそのまま使う。「静かな所」の裏返しが「声のある所」。
  // 下げ方（何dB・どれくらいの速さ）は好みが分かれるので設定にする。
  const [duckOpts, setDuckOpts] = useState<DuckOpts>(DEFAULT_DUCK)
  const [duckOpen, setDuckOpen] = useState(false)
  /**
   * 声に合わせた音量の折れ線。
   * **プレビューと書き出しで同じものを使う**（別々に作ると、聴いた音と
   * 書き出した音が違うという一番たちの悪いズレになる）。
   */
  const duckEnv = useMemo(() => {
    if (!silenceCut.found?.length) return []
    const dur = totalSegLen(segments) || 0
    if (dur <= 0) return []
    return duckEnvelope(voiceRegions(silenceCut.found, dur), duckOpts)
  }, [silenceCut.found, segments, duckOpts])

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
  /** この効果音/BGMクリップに、いまダッキングが効いているか */
  const duckGainAt = (clip: SEClip, t: number): number =>
    clip.duck && duckEnv.length ? gainAt(duckEnv, t) : 1
  /** いまの設定で「どこを切るか」。設定を動かすたびに出し直す（実行前に見せる） */
  const silenceCuts = useMemo(() => {
    if (!silenceCut.found) return []
    return cutsFromSilences(segments, silenceCut.found, {
      pad: silenceCut.pad,
      minLen: silenceCut.minLen
    })
  }, [segments, silenceCut.found, silenceCut.pad, silenceCut.minLen])

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

  // ===== テロップの出入りアニメ（動画トランジションと同じ流儀: D&D配置 / 帯表示 / 選択 / 削除）=====
  // 選択可能なモーション種（頭=in / 尻=out に付く）。emphasis は範囲を持たないので別扱い。
  const TELOP_MOTIONS: { type: AnimIn; ico: string; label: string }[] = [
    { type: 'fade', ico: '🌫', label: 'フェード' },
    { type: 'pop', ico: '✨', label: 'ポップ' },
    { type: 'slideL', ico: '⬅', label: 'スライド左' },
    { type: 'slideR', ico: '➡', label: 'スライド右' },
    { type: 'slideU', ico: '⬆', label: 'スライド上' },
    { type: 'slideD', ico: '⬇', label: 'スライド下' }
  ]
  const motionLabel = (t: AnimIn): string =>
    TELOP_MOTIONS.find((m) => m.type === t)?.label ?? String(t)
  // 動きを1項目ずつ書き換える・捨てる・他のテロップへ配るのは state/useEdit
  /** モーションの表で選んでいる行（コピーする項目）。写す・貼るは state/useCopyPaste */
  const motionSelRef = useRef<string[]>([])

  // 詰めて削除する話（カット点まで・空きを閉じる・どこで止めるか）は
  // state/useTimelineEdit。判定そのものは shared/timeline（テストで固定済み）。

  function setLabelFor(cueId: number, color: string): void {
    const targets = isSelected(cueId) ? selectedIds : [cueId]
    setCues((prev) => prev.map((c) => (targets.includes(c.id) ? { ...c, label: color } : c)))
  }
  function selectByLabel(color: string): void {
    clearSegSel()
    setSelectedIds(cues.filter((c) => c.label === color).map((c) => c.id))
  }

  // ---- プリセット ----
  // スタイルの保存は「テロップ」タブのテンプレ(userTemplates)に一本化
  function savePreset(name: string): void {
    const n = name.trim()
    const base = selected?.style ?? newTelopStyle
    if (!n) return
    const next = [...userTemplates, { name: n, style: structuredClone(base) }]
    setUserTemplates(next)
    saveUserTemplates(next)
  }

  // マグネット（吸着）は state/useSnap
  const { snapTargets, snapTime, snapClipStart } = useSnap({ snap, segLayoutRef })

  // 素材を掴んで落とす（どの段の、どこへ置くか）は state/useMediaDrop
  const {
    prepareMediaMeta, beginMediaDrag, placeImage, deleteSelectedImg, vcXform, imgXform,
    updateDropGhost, clearDropGhosts, dropMediaNearest, videoDropLane, placeVClip,
    deleteSelectedVClip, vcFadeGain, placeSE, trackForNewBgm, addBgm, seFadeGain, removeMedia
  } = useMediaDrop({
    EMPTY_DRAG_IMG, EXTRA_AUDIO_TRACK, dragSeDurRef, draggingMediaRef, dropLaneAt,
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


  // 再生中は再生ヘッドを画面内に自動スクロール
  useEffect(() => {
    if (!playing) return
    const el = scrollRef.current
    if (!el) return
    const x = currentTime * zoom
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - 40) {
      el.scrollLeft = x - 60
    }
  }, [currentTime, playing, zoom])

  // クリップ（テロップ以外）の右クリックメニューを閉じる
  useEffect(() => {
    if (!clipMenu) return
    const close = (): void => setClipMenu(null)
    const onEsc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setClipMenu(null)
    }
    window.addEventListener('click', close)
    window.addEventListener('keydown', onEsc)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', onEsc)
    }
  }, [clipMenu])
  // コンテキストメニューを閉じる
  useEffect(() => {
    if (!menu) return
    function close(): void {
      setMenu(null)
    }
    function onEsc(e: KeyboardEvent): void {
      if (e.key === 'Escape') setMenu(null)
    }
    window.addEventListener('click', close)
    window.addEventListener('keydown', onEsc)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', onEsc)
    }
  }, [menu])

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

  // 素材のドラッグはウィンドウ全体で受け取る。
  //
  // 以前はアプリのルート div にだけ付けていたが、ウィンドウの最下部に div の外側の
  // 帯が数px あり、そこだけ受け皿が無くて 🚫（駐禁）が出ていた。1pxでも取りこぼすと
  // 「置けない場所」に見えるので、window で受けきる。
  // 最新の state を見る必要があるので、実体は毎レンダー ref に入れ替える。
  const winDragRef = useRef({
    enter: (_e: DragEvent): void => {},
    over: (_e: DragEvent): void => {},
    drop: (_e: DragEvent): void => {},
    end: (): void => {}
  })
  winDragRef.current = {
    // 要素をまたぐ瞬間に飛ぶ。dragover だけ受けて dragenter を受けないと、
    // またいだ一瞬だけ 🚫 が出る（段から段へ動かすとチラチラする原因）。
    // HTML5 のドラッグは両方で受け入れを宣言して初めて「置ける」扱いになる。
    enter: (e) => {
      if (!draggingMediaRef.current) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    },
    over: (e) => {
      const m = draggingMediaRef.current
      if (!m) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
      // タイムラインの外にいても、置き先の影を出し続ける
      updateDropGhost(m, e.clientX, e.clientY, e.ctrlKey, e.target)
    },
    drop: (e) => {
      const m = draggingMediaRef.current
      if (!m) return
      // タイムライン・プレビュー・ビンなど、ちゃんとした受け皿が処理した場合は
      // そちらが preventDefault 済み。二重に置かないよう、ここでは影を消すだけ。
      if (e.defaultPrevented) {
        clearDropGhosts()
        return
      }
      e.preventDefault()
      clearDropGhosts()
      // 左右のパネル（素材ビン・テロップ一覧など）の中で離したのは「やめた」扱い。
      // ビンから掴んで同じビンへ戻しただけでタイムラインに置かれると事故になる。
      if ((e.target as HTMLElement | null)?.closest?.('.panel:not(.monitor)')) return
      dropMediaNearest(m, e.clientX, e.clientY)
    },
    end: () => clearDropGhosts()
  }
  useEffect(() => {
    const enter = (e: DragEvent): void => winDragRef.current.enter(e)
    const over = (e: DragEvent): void => winDragRef.current.over(e)
    const drop = (e: DragEvent): void => winDragRef.current.drop(e)
    const end = (): void => winDragRef.current.end()
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    window.addEventListener('dragend', end)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', drop)
      window.removeEventListener('dragend', end)
    }
  }, [])


  // ホイール: 素=横スクロール / Shift=縦スクロール / Ctrl・Alt=カーソル位置を中心にズーム
  //
  // 素を横のままにしてあるのは、これまでずっと横だったから。
  // 縦に送れるようになったからといって主を入れ替えると、今までの手が全部空振りする。
  // ※ブラウザは Shift＋ホイールを勝手に横（deltaX）へ振り替えることがあるので、
  //   縦横どちらで来ても拾う。
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      if (e.ctrlKey || e.altKey) {
        e.preventDefault()
        const rect = el.getBoundingClientRect()
        const mx = e.clientX - rect.left
        const timeAt = (el.scrollLeft + mx) / zoomRef.current
        const nz = clamp(zoomRef.current * (e.deltaY < 0 ? 1.15 : 0.87), ZOOM_MIN, ZOOM_MAX)
        setZoom(nz)
        requestAnimationFrame(() => {
          el.scrollLeft = Math.max(0, timeAt * nz - mx)
        })
      } else if (e.shiftKey && (e.deltaY !== 0 || e.deltaX !== 0)) {
        e.preventDefault()
        el.scrollTop += e.deltaY !== 0 ? e.deltaY : e.deltaX
      } else if (e.deltaY !== 0) {
        e.preventDefault()
        el.scrollLeft += e.deltaY
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])


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
    AUTOSAVE_MS, writeAutosave, currentJsonRef, projectRevRef, autosavedRevRef,
    lastAutosaveRef, hasContentRef, applyProjectData, askConfirm, setRestorePrompt,
    setTemplatePicker, isDirty, snapNow, pushUndo, baselineRef, pendingTimerRef,
    suppressHistoryRef, redoStackRef, setHistTick, setTime,
    scrollRef, rightBodyRef, rightTab, setRightTab, ratioRef, localTemplates
  })
  projectJsonRef.current = projectJson


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
            draggingMediaRef={draggingMediaRef} toGcUrl={toGcUrl} gainToDb={gainToDb}
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
            draggingTelopAnimRef={draggingTelopAnimRef} setDragChip={setDragChip}
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
