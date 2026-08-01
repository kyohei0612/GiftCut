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
import {
  ACTION_LIST,
  DEFAULT_SHORTCUTS,
  SC_KEY,
  formatCombo,
  loadShortcuts,
  type ShortcutId,
  type Shortcuts
} from '../../shared/shortcuts'
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
import {
  TRANS_TYPES,
  transLabel,
  transIco,
  dipColor,
  bandClass,
  loadSegTrans
} from './lib/transitions'
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
import { comboFromEvent, resolveShortcut, shouldBlur } from '../../shared/keymap'
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

// パス→gcfile URL（# や ? を含むファイル名対策でセグメント単位にエンコード）
const RECENT_KEY = 'giftcut.recentProjects'
const RECENT_MAX = 8
const toGcUrl = (p: string): string =>
  'gcfile://media/' + p.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/')

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

// 動画セグメント（切片）。常に隙間なく連続して並ぶ＝リップル前提。
// プレビュー解像度。'orig'=原本をそのまま再生、数値=その高さの編集用プロキシ。
/**
 * プレビューの画質。**どれを選んでも、必ず焼き直した映像で再生する。**
 *
 * 焼き直す物は全コマがキーフレーム（プレミアの ProRes / DNxHD と同じ考え方）で、
 * カットで飛んでも復号し直しが1コマぶんで済む。
 *
 * 以前は「原本をそのまま再生する」選択肢があったが、原本のキーフレームは
 * 数秒に1枚しかないため、**カットのたびに 100〜200ms 絵が止まっていた**。
 * 画質のために引っかかりを我慢する、という選択肢は要らない
 * （書き出しは常に原本のフル画質なので、完成品の画質には影響しない）。
 *
 * 数字は「その高さまで小さくする」。素材がそれより小さければそのまま。
 */
// 元動画（マルチソース）。1タイムラインに複数の動画を連結できる。
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
  } = useDragPreview()
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
  // 元に戻す・やり直すための控え（描くための物ではないので ref）
  const {
    undoStackRef, redoStackRef, baselineRef, suppressHistoryRef, pendingTimerRef,
    bumpHist: setHistTick
  } = useHistory()
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
    fps, setFps, fpsRef
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
  // マグネットの ON/OFF は編集の癖なのでPCに覚えさせる（プレビュー解像度や
  // パネル幅は保存しているのに、ここだけ毎回ONに戻っていた）。
  // loadLS はこの行より後ろで定義されるので使えない（使うと起動時に
  // 「Cannot access 'loadLS' before initialization」で真っ黒になる）。直接読む。
  // 動きの計測の小窓。既定は閉じたまま（開発中は閉じていても測り続ける）
  const [perfOpen, setPerfOpen] = useState(false)
  // 開発中の常時計測を、こちらから止めたか。止めたら右下のボタンが灰色になる
  const [perfStopped, setPerfStopped] = useState(false)
  // **毎レンダーここを通る。** 画面を作り直した回数がそのまま数になる
  perf.countRender()

  // 計測に「いま何をしているか」を教える。数字だけ見ても、
  // どの操作のときに詰まったのかが分からないと原因に辿り着けない。
  useEffect(() => {
    perf.noteOf = (): string =>
      [
        playRateRef.current !== 0 ? '再生中' : '停止',
        // **設定の数字だけでは足りない。** 焼き直しがまだなら原本を再生しており、
        // 原本はシークが重いのでカクつく。実際に何を再生しているかを必ず出す
        // （「画質1080 なのにカクつく」の正体がこれだった）
        `画質${previewResRef.current}${
          (videoRef.current?.currentSrc ?? '').includes('giftcut-proxies') ? '(焼直)' : '(原本)'
        }`,
        `切片${segsRef.current.length}`,
        `テロップ${cuesRef.current.length}`
      ].join(' / ')
    perf.videoOf = (): HTMLVideoElement | null => videoRef.current
  })

  /**
   * 掴んでいる間、カーソルを**掴んだ瞬間の形のまま**にする。
   *
   * ドラッグ中はマウスが色々な物の上を通る。素のままだと通った先の形に
   * 次々と変わり、**掴んでいるのに形だけ別物**という状態でちらつく。
   *
   * 掴む所は10か所以上あるので、1つずつ直すと必ず漏れる。押した瞬間に
   * 「その要素の形」を読み取って全体に固定し、離したら外す——ここ1か所で済ませる。
   * 何を掴んだかを覚える必要も無い（掴んだ物の形がそのまま答えになっている）。
   */
  useEffect(() => {
    let locked = false
    const root = document.documentElement
    const onDown = (e: PointerEvent): void => {
      if (e.button !== 0) return
      const el = e.target as HTMLElement | null
      if (!el) return
      const cur = getComputedStyle(el).cursor
      if (!cur || cur === 'auto') return
      root.style.setProperty('--drag-cursor', cur)
      root.classList.add('dragging-cursor')
      locked = true
    }
    const onUp = (): void => {
      // 磁石の点線は「掴んでいる間だけ」。離したら必ず消す
      // （消し忘れると、置いたあとも線が残って何の線か分からなくなる）
      setSnapLineX(null)
      if (!locked) return
      locked = false
      root.classList.remove('dragging-cursor')
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('pointerup', onUp, true)
    window.addEventListener('pointercancel', onUp, true)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('pointerup', onUp, true)
      window.removeEventListener('pointercancel', onUp, true)
      root.classList.remove('dragging-cursor')
    }
  }, [])

  /**
   * 別のアプリへ行って戻ってきたときの手当て。
   *
   * 裏に回ると Chromium は rAF を止める。一方こちらの再生位置は**壁時計**で
   * 出しているので、戻った瞬間に「止まっていた秒数ぶん」を一気に進めようとして、
   * 巨大なシークが走る。実測で **戻った直後の1コマに 1820ms** かかっていた
   * （36.9秒 裏へ → 38.7秒 戻る、で最悪コマがそこに立っていた）。
   *
   * 戻ったら壁時計を**いまの位置に貼り直す**。止まっていた間は進めない
   * ＝裏で勝手に再生が進んでいた事にしない、が正しい振る舞いでもある。
   */
  useEffect(() => {
    const onVis = (): void => {
      if (document.hidden) return
      if (playRateRef.current === 0) return
      clockStartPosRef.current = currentTimeRef.current
      clockStartWallRef.current = performance.now() / 1000
      lastTsRef.current = performance.now()
      // 動画側も現在位置へ合わせ直す（放っておくと次のコマで大きなシークが走る）
      const src = tToSource(segLayoutRef.current, currentTimeRef.current)
      const v = videoRef.current
      if (v && src && Math.abs(v.currentTime - src.srcTime) > 0.25) v.currentTime = src.srcTime
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  /**
   * 画面で起きた例外を**必ず表に出す**。
   *
   * React は描画の途中で例外が出ると、その枝ごと黙って消す。すると
   * 「V1 が効かない」「ショートカットが効かない」のように、**別々の不具合に見えて
   * 実は1つの例外**という形になり、探しても見つからない。
   *
   * 出たら画面に出し、動きの記録にも残す（あとから何時何分に何が出たか辿れる）。
   */
  useEffect(() => {
    const onErr = (e: ErrorEvent): void => {
      const msg = `${e.message}（${(e.filename ?? '').split('/').pop()}:${e.lineno}）`
      perf.mark(`画面の例外: ${msg}`)
      showToast(`不具合が起きました: ${msg}`, 'error')
    }
    const onRej = (e: PromiseRejectionEvent): void => {
      const msg = String(e.reason).slice(0, 200)
      perf.mark(`受け止め損ねた失敗: ${msg}`)
      showToast(`不具合が起きました: ${msg}`, 'error')
    }
    window.addEventListener('error', onErr)
    window.addEventListener('unhandledrejection', onRej)
    return () => {
      window.removeEventListener('error', onErr)
      window.removeEventListener('unhandledrejection', onRej)
    }
  }, [])

  // Ctrl+Shift+P で計測の小窓。**配布ビルドでも開ける**
  useEffect(() => {
    const h = (e: KeyboardEvent): void => {
      if (e.ctrlKey && e.shiftKey && (e.key === 'P' || e.key === 'p')) {
        e.preventDefault()
        // 小窓は「見せる／隠す」だけ。**閉じても測り続ける**（配布ビルドも同じ）。
        // 止めてしまうと、不具合に気づいて書き出した時に肝心の前後が残らない。
        setPerfOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  /**
   * 開発中は、起動した瞬間から**ずっと測り続ける**。
   *
   * カクついた瞬間に「いま測り始めます」では遅い。**気づいたときには終わっている**
   * ので、あとから「さっきの所」を見られないと原因に辿り着けない。
   * 走らせっぱなしにして、一定間隔で userData/perf へ書く。
   * 「止めて」と言われたら、そこまでに書かれた物を読めばよい。
   *
   * **配布ビルドでも走らせる。**
   * 不具合に気づくのは使っている人で、その場で測り始めてもらうのは無理がある。
   * 「おかしいな」と思った時に書き出しボタンを押せば、その前の分がそのまま残っている、
   * という形にする。書き出す間隔は5分（毎回書くとディスクを触りすぎる）。
   */
  useEffect(() => {
    perf.start()
    const id = window.setInterval(
      () => {
        void window.giftcut?.savePerfReport?.(perf.report())
      },
      import.meta.env.DEV ? 30_000 : 300_000
    )
    return () => {
      window.clearInterval(id)
      perf.stop()
    }
  }, [])
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
  // 素材の尺と波形を用意する（動画・音声のみ。取り込み時に呼ぶ）
  function prepareMediaMeta(path: string, kind: 'video' | 'audio' | 'image'): void {
    if (kind === 'image') return
    if (mediaMetaRef.current[path]?.wave) return // 既に解析済み
    if (metaInFlightRef.current.has(path)) return // 解析中（波形解析は全長デコードで重い）
    metaInFlightRef.current.add(path)
    // 波形は全長デコードで重い。同時に走る数を絞らないと、素材が多いほど
    // 開いた直後にアプリ全体が止まる（2000件で69秒かかっていた）。
    mediaQueue(() =>
      window.giftcut.getDuration(path).then((r) => {
        if (r?.ok && r.duration)
          setMediaMeta((prev) => ({ ...prev, [path]: { ...prev[path], dur: r.duration } }))
      })
    )
    mediaQueue(() =>
      window.giftcut
      .generateWaveform(path)
      .then((r) => {
        if (r?.ok && r.min && r.max)
          setMediaMeta((prev) => ({
            ...prev,
            [path]: {
              ...prev[path],
              wave: { min: r.min as number[], max: r.max as number[], dur: r.duration ?? 0 }
            }
          }))
      })
        .finally(() => metaInFlightRef.current.delete(path))
    )
  }
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
  const segMoveToRef = useRef<number | null>(null)
  const segDropModeRef = useRef<SegDropMode>('move')
  // 今このまま離すと「丸ごと」上書きされてしまうクリップ。赤く縁取って警告する。
  // タイムラインへ画像配置中のゴースト（V2/V3等の映像トラック）
  // ドラッグ中のポインタ直下のトラックidを返す（kind指定でフィルタ）。無ければnull。
  function trackFromEvent(e: { target: EventTarget | null }, kind?: 'video' | 'audio'): string | null {
    const el = (e.target as HTMLElement | null)?.closest?.('[data-tid]')
    const id = el?.getAttribute('data-tid') ?? null
    if (!id) return null
    const tr = tracks.find((t) => t.id === id)
    if (!tr) return null
    if (kind && tr.kind !== kind) return null
    return id
  }
  // 実在するトラックIDへ寄せる（削除済みトラックを指すクリップは既定レーンへ）。
  // 指したままだとタイムラインに出ず選択も削除もできないのに、プレビュー/書き出しには出てしまう。
  // 本編（V1/A1）は同じ切片を共有するリンク済みクリップなので、どちらかが
  // ロックされていれば編集不可にする。以前は V1 しか見ておらず、A1 をロック
  // しても A1 の波形をレザーで切れて Delete で消せた（逆に V1 だけロックすると
  // 音量調整は通るのに削除は止まる、という説明できない状態だった）。
  function mainLocked(): boolean {
    return !!trackStates['V1']?.locked || !!trackStates['A1']?.locked
  }
  function fallbackTrack(id: string, kind: 'video' | 'audio'): string {
    if (tracks.some((t) => t.id === id && t.kind === kind)) return id
    const cands = tracks.filter((t) => t.kind === kind && t.id !== (kind === 'video' ? 'V1' : 'A1'))
    return cands.length ? cands[cands.length - 1].id : kind === 'video' ? 'V2' : 'A2'
  }
  // ドラッグ中のポインタ直下の音声トラックidを返す（SE=A2 / BGM=A3 等に振り分け）。無ければnull。
  function audioTrackFromEvent(e: { target: EventTarget | null }): string | null {
    const el = (e.target as HTMLElement | null)?.closest?.('[data-tid]')
    const id = el?.getAttribute('data-tid') ?? null
    return id && tracks.some((t) => t.id === id && t.kind === 'audio') ? id : null
  }
  // メディアのドラッグ開始時に尺を取得しておく（ゴーストの幅＆配置時の再利用）
  function beginMediaDrag(m: MediaItem, e: React.DragEvent): void {
    // カーソルに付く既定のドラッグ画像を透明化（位置はタイムラインのゴーストで示す）
    if (EMPTY_DRAG_IMG) e.dataTransfer.setDragImage(EMPTY_DRAG_IMG, 0, 0)
    // 許可する操作を宣言しておく。これが無いと、受け取る側で「コピー」と言っても
    // ブラウザ側が弾いて 🚫（駐禁）カーソルに戻ってしまう。
    e.dataTransfer.effectAllowed = 'copy'
    draggingMediaRef.current = m
    // 取り込み時に用意した尺があれば即使う（無ければ既定値→getDurationで後追い）
    const known = mediaMetaRef.current[m.path]?.dur
    dragSeDurRef.current = m.kind === 'image' ? 5 : known && known > 0 ? known : 2
    if (m.kind === 'audio' || m.kind === 'video') {
      void window.giftcut.getDuration(m.path).then((d) => {
        if (d?.ok && d.duration && draggingMediaRef.current?.path === m.path) {
          dragSeDurRef.current = d.duration
        }
      })
    }
  }

  // ---- SE クリップ（A2 トラックに配置した効果音）----
  const seAudioRefs = useRef<Map<number, HTMLAudioElement>>(new Map())
  // ref コールバックはクリップIDごとに固定する。毎レンダー新規の無名関数だと
  // detach→attach が毎回起きて、detach時のpauseで鳴っている音が切れてしまう。
  const seRefCbsRef = useRef<Map<number, (el: HTMLAudioElement | null) => void>>(new Map())
  const seRefCb = (id: number): ((el: HTMLAudioElement | null) => void) => {
    let fn = seRefCbsRef.current.get(id)
    if (!fn) {
      fn = (el: HTMLAudioElement | null): void => {
        if (el) seAudioRefs.current.set(id, el)
        else {
          // 外される瞬間に音が残らないよう、delete の前に止める
          const prev = seAudioRefs.current.get(id)
          if (prev && !prev.paused) prev.pause()
          seAudioRefs.current.delete(id)
          seRefCbsRef.current.delete(id)
        }
      }
      seRefCbsRef.current.set(id, fn)
    }
    return fn
  }

  // ---- 画像クリップ（V2/V3等の映像トラックに置く静止画。プレミアの画像配置に相当）----
  function placeImage(m: MediaItem, t: number, track: string): void {
    if (trackStates[track]?.locked) {
      showToast('このトラックはロックされています。')
      return
    }
    const id = imgIdCounter.current++
    setImgClips((prev) => [
      ...prev,
      { id, path: m.path, name: m.name, tStart: Math.max(0, t), duration: 5, track }
    ])
    setSelectedImgIds([id])
  }
  function deleteSelectedImg(): void {
    if (!selectedImgIds.length) return
    // ロック中トラックの画像は残す
    setImgClips((prev) =>
      prev.filter((c) => !selectedImgIds.includes(c.id) || trackStates[c.track]?.locked)
    )
    setSelectedImgIds([])
  }
  // 映像レイヤーのCSS transform（回転/反転＋ズーム）。
  // localT はクリップの先頭からの秒。動きが付いていればその瞬間のズームになる
  // （印が無ければ zoomAt は固定値をそのまま返すので、今までと同じ絵）。
  function vcXform(
    c: {
      rotate?: number
      flipH?: boolean
      flipV?: boolean
      zoom?: { scale: number; x: number; y: number }
      motion?: ClipMotion
    },
    localT = 0
  ): string | undefined {
    const parts: string[] = []
    if (c.rotate) parts.push(`rotate(${c.rotate}deg)`)
    if (c.flipH) parts.push('scaleX(-1)')
    if (c.flipV) parts.push('scaleY(-1)')
    const z = zoomAt(c.zoom, c.motion, localT)
    if (!isNeutralZoom(z))
      parts.push(
        `translate(${(z.x * 100).toFixed(3)}%, ${(z.y * 100).toFixed(3)}%) scale(${z.scale.toFixed(4)})`
      )
    return parts.length ? parts.join(' ') : undefined
  }
  // 画像のCSS transform（回転/反転＋ズーム）。動画切片と同じ合成順。
  function imgXform(c: ImgClip, localT = 0): string | undefined {
    const parts: string[] = []
    if (c.rotate) parts.push(`rotate(${c.rotate}deg)`)
    if (c.flipH) parts.push('scaleX(-1)')
    if (c.flipV) parts.push('scaleY(-1)')
    const z = zoomAt(c.zoom, c.motion, localT)
    if (!isNeutralZoom(z))
      parts.push(
        `translate(${(z.x * 100).toFixed(3)}%, ${(z.y * 100).toFixed(3)}%) scale(${z.scale.toFixed(4)})`
      )
    return parts.length ? parts.join(' ') : undefined
  }

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
  // 映像レイヤーに動画を置く前に、V{n} と A{n} を「その動画専用」に空ける。
  // 既にテロップ/画像/SEが載っていたら1段追加してそちらへ退避させる（リンクを崩さないため）。
  // トラックを番号順の正しい位置へ挿入する。
  // 配列の並び＝タイムラインの縦位置＝重なり順（前にあるほど前面）なので、
  // 番号を無視して挿入すると「番号が大きいほど前面」という前提が壊れる。
  // 映像は番号の降順（V3,V2,V1）、音声は昇順（A1,A2,A3）で並べる。
  function insertTrackOrdered(list: Track[], tr: Track): Track[] {
    const n = trackNum(tr.id)
    const next = [...list]
    if (tr.kind === 'video') {
      const at = next.findIndex((t) => t.kind === 'video' && trackNum(t.id) < n)
      next.splice(at >= 0 ? at : next.findIndex((t) => t.kind === 'audio'), 0, tr)
    } else {
      let at = -1
      next.forEach((t, i) => {
        if (t.kind === 'audio' && trackNum(t.id) < n) at = i
      })
      next.splice(at >= 0 ? at + 1 : next.length, 0, tr)
    }
    return next
  }
  /**
   * 動画を置くレーンを空ける。
   *
   * そのレーンに何か（テロップ/画像/映像レイヤー）が載っていたら、そのレーン以上を
   * まとめて1つ上へずらす。V2 に置くなら V2 の中身は V3 へ、V3 に何かあれば V4 へ、
   * という形で全部そのまま繰り上がる。番号と縦位置の対応（大きいほど前面）も保たれる。
   *
   * 音声側も同じ番号だけずらす。V{n} と A{n} は対で扱う決まりなので、映像だけ
   * ずらすと対応が崩れて、映像レイヤーの音が別のトラックに残ってしまう。
   *
   * 戻り値は動画を置くレーン（＝引数のまま。空けたので番号は変わらない）。
   */
  function reserveTrackPairForVideo(vTrack: string): string {
    const n = trackNum(vTrack)
    const aTrack = 'A' + n
    const occupied =
      cuesRef.current.some((c) => cueTrack(c) === vTrack) ||
      imgClipsRef.current.some((c) => c.track === vTrack) ||
      vClipsRef.current.some((c) => c.track === vTrack)
    const seOccupied = seClipsRef.current.some((c) => c.track === aTrack)

    if (occupied || seOccupied) {
      // n 以上のレーンを1つ上へ。上から順に動かさないと番号がぶつかる。
      const bump = (id: string): string => {
        const k = trackNum(id)
        return k >= n ? id[0] + (k + 1) : id
      }
      setCues((prev) => prev.map((c) => ({ ...c, track: bump(cueTrack(c)) })))
      setImgClips((prev) => prev.map((c) => ({ ...c, track: bump(c.track) })))
      setVClips((prev) => prev.map((c) => ({ ...c, track: bump(c.track) })))
      setSeClips((prev) => prev.map((c) => ({ ...c, track: bump(c.track) })))
      // 受け皿のトラックを1本ずつ足す（映像・音声とも）
      setTracks((prev) => {
        let next = [...prev]
        const vMax = Math.max(
          0,
          ...next.filter((t) => t.kind === 'video').map((t) => trackNum(t.id))
        )
        const aMax = Math.max(
          0,
          ...next.filter((t) => t.kind === 'audio').map((t) => trackNum(t.id))
        )
        const vNew = 'V' + (vMax + 1)
        const aNew = 'A' + (aMax + 1)
        if (!next.some((t) => t.id === vNew))
          next = insertTrackOrdered(next, { id: vNew, name: vNew, kind: 'video' })
        if (!next.some((t) => t.id === aNew))
          next = insertTrackOrdered(next, { id: aNew, name: aNew, kind: 'audio' })
        return next
      })
      // トラックの状態（ロック等）も一緒にずらす
      setTrackStates((prev) => {
        const next: Record<string, TrackState> = {}
        for (const [id, st] of Object.entries(prev)) next[bump(id)] = st
        return next
      })
      // ずらしたあと、状態が抜けたトラックを埋める。作り忘れると
      // トラックヘッダーの描画で落ちて画面全体が真っ黒になる。
      // 直後は tracks の state がまだ古いので、番号から作り直して補う。
      setTrackStates((prev) => {
        const next = { ...prev }
        const vMax = Math.max(0, ...Object.keys(next).filter((k) => k[0] === 'V').map(trackNum))
        const aMax = Math.max(0, ...Object.keys(next).filter((k) => k[0] === 'A').map(trackNum))
        for (let k = 1; k <= vMax + 1; k++)
          if (!next['V' + k]) next['V' + k] = newTrackState('V' + k)
        for (let k = 1; k <= aMax + 1; k++)
          if (!next['A' + k]) next['A' + k] = newTrackState('A' + k)
        return next
      })
      showToast(vTrack + ' に置くため、上のレーンを1つずつ繰り上げました。')
    }

    // 映像側のレーンが無ければ作る。無いとクリップがどこにも描かれず、選択も削除も
    // できないのにプレビューと書き出しには出る（置いたのに消えたように見える）。
    setTracks((prev) =>
      prev.some((t) => t.id === vTrack)
        ? prev
        : insertTrackOrdered(prev, { id: vTrack, name: vTrack, kind: 'video' })
    )
    setTrackStates((prev) => (prev[vTrack] ? prev : { ...prev, [vTrack]: newTrackState(vTrack) }))
    // 対の音声トラックが無ければ作る（無いと映像レイヤーの音が鳴らない）
    setTracks((prev) =>
      prev.some((t) => t.id === aTrack)
        ? prev
        : insertTrackOrdered(prev, { id: aTrack, name: aTrack, kind: 'audio' })
    )
    setTrackStates((prev) => (prev[aTrack] ? prev : { ...prev, [aTrack]: newTrackState(aTrack) }))
    return vTrack
  }
  /**
   * 動画のドロップ先レーンを決める。
   *
   * トラックの行の外（下の余白、音声トラックの上など）に落ちたとき、以前は V1 ＝
   * 本編の上書きに倒れていた。置いたつもりが本編を壊す。行の外でも駐禁を出さずに
   * 置けるようにしたいので、**縦位置が一番近い映像トラック**に寄せる。
   * どうしても決まらないときだけ1つ上の新しいレーンを作る
   * （V{n}/A{n} は reserveTrackPairForVideo が作る）。
   */
  /**
   * タイムラインの外（トラックヘッダー列・パネルの上など）で離された素材を、
   * 一番近い位置に置く。どこも受け取らずに掴んだものが消えるのを防ぐための最終受け皿。
   */
  /**
   * ドラッグ中の「ここに置きます」の影を更新する。
   *
   * タイムラインの外へカーソルが出ても出し続ける。消してしまうと、少し外れた
   * だけで行き先が分からなくなり、置けないのか場所が悪いのか判断できない。
   * 位置はタイムラインの表示範囲へ丸めるので、外にいても一番近い場所を指す。
   */
  function updateDropGhost(
    m: MediaItem,
    clientX: number,
    clientY: number,
    insert: boolean,
    target?: EventTarget | null
  ): void {
    const inner = trackInnerRef.current
    const scroll = scrollRef.current
    if (!inner || !scroll) return
    const rect = inner.getBoundingClientRect()
    const view = scroll.getBoundingClientRect()
    const raw = Math.max(0, (clamp(clientX, view.left, view.right) - rect.left) / zoomRef.current)
    const t = snapClipStart(raw, dragSeDurRef.current)
    const yRel = clamp(clientY, view.top, view.bottom) - rect.top
    const dur = dragSeDurRef.current
    if (m.kind === 'audio') {
      setSeGhost({ t, name: m.name, dur, track: dropLaneAt(yRel, 'audio', true) ?? 'A2', path: m.path })
      setVideoGhost(null)
      setImgGhost(null)
    } else if (m.kind === 'video') {
      setVideoGhost({ t, name: m.name, dur, insert, path: m.path, track: videoDropLane({ target: target ?? null }, yRel) })
      setSeGhost(null)
      setImgGhost(null)
    } else {
      setImgGhost({ t, name: m.name, dur, track: fallbackTrack(dropLaneAt(yRel, 'video', true) ?? 'V3', 'video') })
      setSeGhost(null)
      setVideoGhost(null)
    }
  }
  /** ドラッグが終わったら影を全部消す */
  function clearDropGhosts(): void {
    setSeGhost(null)
    setVideoGhost(null)
    setImgGhost(null)
    setSnapLineX(null)
  }
  /**
   * 素材を**再生ヘッドの位置へ置く**（ダブルクリック用）。
   *
   * 置く場所をマウスで指す必要があるのはドラッグだけで、
   * 「とりあえず今いる所に足したい」ときにドラッグを強いるのは手間なだけ。
   * プレミアも素材のダブルクリック／挿入は再生ヘッド基準。
   * どのレーンに載せるかは、ドラッグで何も指さなかったときと同じ既定に合わせる。
   */

  function dropMediaNearest(m: MediaItem, clientX: number, clientY: number): void {
    const inner = trackInnerRef.current
    const scroll = scrollRef.current
    if (!inner || !scroll) return
    const rect = inner.getBoundingClientRect()
    const view = scroll.getBoundingClientRect()
    // タイムラインの表示範囲へ丸めてから秒とレーンに直す（外に出ていても端に寄る）
    const raw = Math.max(0, (clamp(clientX, view.left, view.right) - rect.left) / zoomRef.current)
    const t = snapClipStart(raw, dragSeDurRef.current)
    const yRel = clamp(clientY, view.top, view.bottom) - rect.top
    if (m.kind === 'video') {
      const vt = dropLaneAt(yRel, 'video') ?? 'V1'
      if (vt !== 'V1') void placeVClip(m, t, vt)
      else void placeVideoAtDrop(m.path, t, false)
    } else if (m.kind === 'audio') {
      void placeSE(m, t, dropLaneAt(yRel, 'audio', true) ?? 'A2')
    } else {
      placeImage(m, t, fallbackTrack(dropLaneAt(yRel, 'video', true) ?? 'V3', 'video'))
    }
  }
  function videoDropLane(e: { target: EventTarget | null }, yRel?: number): string {
    const tid = trackFromEvent(e, 'video')
    if (tid) return tid
    if (yRel !== undefined) {
      const near = dropLaneAt(yRel, 'video')
      if (near) return near
    }
    const vMax = Math.max(1, ...tracks.filter((t) => t.kind === 'video').map((t) => trackNum(t.id)))
    return 'V' + (vMax + 1)
  }
  // 映像レイヤーに動画クリップを置く
  async function placeVClip(m: MediaItem, t: number, track: string): Promise<void> {
    if (trackStates[track]?.locked) {
      showToast('このトラックはロックされています。')
      return
    }
    const known = mediaMetaRef.current[m.path]?.dur
    let dur = known && known > 0 ? known : 0
    if (!dur) {
      const d = await window.giftcut.getDuration(m.path)
      dur = d?.ok && d.duration ? d.duration : 0
    }
    if (dur <= 0) {
      showToast('動画の長さを取得できませんでした。', 'error')
      return
    }
    const vTrack = reserveTrackPairForVideo(track)
    const id = vClipIdCounter.current++
    setVClips((prev) => [
      ...prev,
      {
        id,
        path: m.path,
        name: m.name,
        track: vTrack,
        tStart: Math.max(0, t),
        srcStart: 0,
        srcEnd: dur,
        srcDur: dur
      }
    ])
    setSelectedVClipIds([id])
    prepareMediaMeta(m.path, 'video')
    showToast(vTrack + ' に配置しました（音声は ' + pairedAudioOf(vTrack) + ' に連動）。', 'success')
  }
  function deleteSelectedVClip(): void {
    if (!selectedVClipIds.length) return
    setVClips((prev) =>
      prev.filter((c) => !selectedVClipIds.includes(c.id) || trackStates[c.track]?.locked)
    )
    setSelectedVClipIds([])
  }
  // クリップ内ローカル秒 t における音声フェード係数
  // フェード計算は shared/timeline の fadeGain に集約（音声フェードの実装を1つに保つ）
  function vcFadeGain(c: VClip, t: number): number {
    return fadeGain(t, vcLen(c), c.afadeIn, c.afadeOut)
  }

  // ---- マーカー（タイムライン上の目印。頭出し/メモ用。書き出しには影響しない）----
  // 再生ヘッド位置にマーカーを追加（同じ位置に既にあれば選択のみ）
  function addMarkerAtPlayhead(): void {
    const t = currentTimeRef.current
    const near = markers.find((m) => Math.abs(m.t - t) < 1 / fpsRef.current)
    if (near) {
      setSelectedMarkerId(near.id)
      return
    }
    const id = markerIdCounter.current++
    setMarkers((prev) => [...prev, { id, t, label: '' }].sort((a, b) => a.t - b.t))
    setSelectedMarkerId(id)
  }
  function deleteMarker(id: number): void {
    setMarkers((prev) => prev.filter((m) => m.id !== id))
    if (selectedMarkerId === id) setSelectedMarkerId(null)
    if (editingMarkerId === id) setEditingMarkerId(null)
  }
  // 前/次のマーカーへ頭出し
  function jumpMarker(dir: 1 | -1): void {
    const t = currentTimeRef.current
    const sorted = [...markers].sort((a, b) => a.t - b.t)
    const target =
      dir > 0
        ? sorted.find((m) => m.t > t + 1e-3)
        : [...sorted].reverse().find((m) => m.t < t - 1e-3)
    if (target) {
      stopPlayback()
      // 飛んだ先のめじるしが枠の外なら、そこを見せる
      seekAndReveal(target.t)
      setSelectedMarkerId(target.id)
    }
  }
  // マーカーの掴み＝選択＋ドラッグで移動。動かさなければクリック＝その位置へ頭出し。
  function onMarkerPointerDown(mk: Marker, e: React.PointerEvent): void {
    e.stopPropagation()
    if (e.button !== 0) return
    // 選択は排他に（他のクリップ選択が残っていると Delete がどれに効くか分からなくなる）
    setSelectedIds([])
    clearSegSel()
    setSelectedTrackId(null)
    setSelectedMarkerId(mk.id)
    const sx = e.clientX
    const t0 = mk.t
    let moved = false
    const onMove = (ev: PointerEvent): void => {
      if (!moved && Math.abs(ev.clientX - sx) < 3) return
      moved = true
      // カット点/クリップ端に吸着（他のクリップと同じ操作感）
      const nt = Math.max(0, snapTime(t0 + (ev.clientX - sx) / zoomRef.current))
      setMarkers((prev) => prev.map((m) => (m.id === mk.id ? { ...m, t: nt } : m)))
      setDragTip({ x: ev.clientX, y: ev.clientY, text: `🚩 ${formatTime(nt)}` })
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      if (!moved) {
        stopPlayback()
        seekTo(t0)
      } else {
        setMarkers((prev) => [...prev].sort((a, b) => a.t - b.t))
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  async function placeSE(m: MediaItem, t: number, track = 'A2'): Promise<void> {
    if (trackStates[track]?.locked) {
      showToast('このトラックはロックされています。')
      return
    }
    const d = await window.giftcut.getDuration(m.path)
    const dur = d?.ok && d.duration ? d.duration : 3
    const id = seIdCounter.current++
    setSeClips((prev) => [
      ...prev,
      {
        id,
        path: m.path,
        name: m.name,
        tStart: Math.max(0, t),
        duration: dur,
        volume: 1,
        fadeIn: 0,
        fadeOut: 0,
        track,
        srcOffset: 0,
        srcDur: dur
      }
    ])
    setSelectedSeIds([id])
  }
  // 音声ファイルを追加：ファイル選択→A3トラックの再生ヘッド位置に配置（BGM等）。
  // BGM を置く音声トラックを決める。テロップと同じ考え方で、再生ヘッド位置が
  // 空いている一番上（A2 に近い側）から順に探し、無ければ1段下に作る。
  // 以前は A3 決め打ちだったため、V3 に映像レイヤーを置いて A3 がその音声で
  // 埋まっていても、♪＋ ボタンが A3 に BGM を重ねていた。
  function trackForNewBgm(t: number): string {
    // 映像レイヤーの音声で予約済みのトラックは避ける（V{n} と対になっている）
    const reservedByVideo = new Set(vClips.map((c) => 'A' + trackNum(c.track)))
    const cands = tracks
      .filter(
        (tr) =>
          tr.kind === 'audio' &&
          tr.id !== 'A1' &&
          !trackStates[tr.id]?.locked &&
          !reservedByVideo.has(tr.id)
      )
      .sort((a, b) => trackNum(a.id) - trackNum(b.id))
    const busy = (id: string): boolean =>
      seClips.some((c) => c.track === id && c.tStart < t + 1 && c.tStart + c.duration > t)
    const free = cands.find((tr) => !busy(tr.id))
    if (free) return free.id
    const maxNum = Math.max(
      1,
      ...tracks.filter((x) => x.kind === 'audio').map((x) => trackNum(x.id))
    )
    const id = 'A' + (maxNum + 1)
    setTracks((prev) =>
      prev.some((x) => x.id === id)
        ? prev
        : insertTrackOrdered(prev, { id, name: id, kind: 'audio' })
    )
    setTrackStates((prev) => (prev[id] ? prev : { ...prev, [id]: newTrackState(id) }))
    return id
  }
  async function addBgm(): Promise<void> {
    const res = await window.giftcut.addMedia()
    if (!res?.paths?.length) return
    const track = trackForNewBgm(currentTimeRef.current)
    for (const p of res.paths) {
      const name = p.split(/[\\/]/).pop() ?? '音声'
      await placeSE({ id: -1, path: p, name, kind: 'audio' }, currentTimeRef.current, track)
    }
    if (track !== EXTRA_AUDIO_TRACK) showToast(track + ' に追加しました。')
  }
  // SEクリップ内ローカル秒 t におけるフェード係数(0-1)。頭 fadeIn / 尻 fadeOut を線形。
  function seFadeGain(clip: SEClip, t: number): number {
    let g = 1
    if (clip.fadeIn > 0 && t < clip.fadeIn) g = Math.min(g, t / clip.fadeIn)
    const outStart = clip.duration - clip.fadeOut
    if (clip.fadeOut > 0 && t > outStart) g = Math.min(g, (clip.duration - t) / clip.fadeOut)
    return clamp(g, 0, 1)
  }
  function removeMedia(id: number): void {
    const m = mediaItems.find((x) => x.id === id)
    // タイムラインで使っている素材は消せない（消すとビンから見えないのに再生され続けて混乱する）。
    // 「使用中」の基準はクリップが残っているかどうか。元動画としての登録は、切片を
    // 全部消したあとも主ソースとして残るので、それを見ていると
    // 「タイムラインは空なのにビンから消せない」という手詰まりになる。
    if (m) {
      const refs = {
        sources: sourcesRef.current,
        segments: segsRef.current,
        seClips: seClipsRef.current,
        imgClips: imgClipsRef.current,
        vClips: vClipsRef.current
      }
      if (mediaInUse(m.path, refs)) {
        showToast('この素材はタイムラインで使用中です。先にクリップを削除してください。')
        return
      }
      // 誰も使っていない元動画の登録も一緒に片付ける。残すと、見えない <video> が
      // プロキシを読み続け、書き出しの入力にも無駄に載る。
      const stale = staleSourceIds(m.path, refs)
      if (stale.length) setSources((prev) => prev.filter((s) => !stale.includes(s.id)))
      // 消した素材をプレビューが映したままにしない（ビンに無い動画が出続ける）
      if (videoPath === m.path) {
        setVideoPath(null)
        setVideoSrc(null)
        setVideoName(null)
        setVideoDuration(0)
        setThumbnailSrc(null)
      }
    }
    setMediaItems((prev) => prev.filter((x) => x.id !== id))
    if (selectedMediaId === id) setSelectedMediaId(null)
  }
  // 再生中のソースの <video>（マルチソースでは切替時に付け替える。要素自体は破棄しない）
  const videoRef = useRef<HTMLVideoElement | null>(null)
  // ソースID → <video> 要素。ソースごとに要素を常設し、src差し替えによる再ロード＝黒ちらつきを防ぐ
  /**
   * 元動画ごとの <video>。**1本につき2つ持つ（A面/B面）。**
   *
   * カットは「同じファイルの別の場所へ飛ぶ」ことなので、1つの要素でやると
   * 飛ぶたびに復号し直しの待ちが出る（実測 145〜235ms、コマ飛びの正体）。
   * 片方を映している間にもう片方を次のカットの頭へ送っておき、カットで
   * 表示を入れ替える＝待ちが再生の裏に隠れる。プレミアのプリロールと同じ考え方で、
   * **プロキシでも原本でも効く**（復号の速さに頼らないため）。
   *
   * 鍵は `${ソースID}:${面}`。
   */
  const videoElsRef = useRef<Map<string, HTMLVideoElement>>(new Map())
  const elKey = (srcId: number, half: 0 | 1): string => `${srcId}:${half}`
  /** いまどちらの面を映しているか（ソースごと）。カットのたびに入れ替わる */
  const [activeHalf, setActiveHalf] = useState<Record<number, 0 | 1>>({})
  const activeHalfRef = useRef<Record<number, 0 | 1>>({})
  activeHalfRef.current = activeHalf
  const halfOf = (srcId: number): 0 | 1 => activeHalfRef.current[srcId] ?? 0
  /** いま映している方の要素 */
  const elOf = (srcId: number): HTMLVideoElement | undefined =>
    videoElsRef.current.get(elKey(srcId, halfOf(srcId)))
  /** 次のカットへ向けて温めてある面（用意できていれば入れ替えるだけで済む） */
  const preparedRef = useRef<{ segIdx: number; srcId: number; half: 0 | 1 } | null>(null)
  const videoBRef = useRef<HTMLVideoElement>(null) // クロスディゾルブ用の2本目video（同じproxy srcをオーバーレイ）
  // 再生ヘッドの時計（壁時計マスター）。再生ヘッドは実時間で常に一定速度で進み、動画がそれを追う。
  const clockStartWallRef = useRef(0) // 再生開始時の performance.now()/1000（秒）
  const clockStartPosRef = useRef(0) // 再生開始時のタイムライン位置（秒）

  // ---- 動画セグメント（切片編集）----
  // 動画と音声の選択は独立（クリックは片方、ドラッグは両方に掛かれば両方）
  // どのクリップにもラベルカラーを付けられる（以前はテロップだけの機能だった）。
  // 素材が増えると見分けが付かなくなるため、色で分類できるようにする。
  function setClipLabel(kind: string, id: number, color?: string): void {
    if (kind === 'seg')
      setSegments((prev) => prev.map((c) => (c.id === id ? { ...c, label: color } : c)))
    else if (kind === 'img')
      setImgClips((prev) => prev.map((c) => (c.id === id ? { ...c, label: color } : c)))
    else if (kind === 'se')
      setSeClips((prev) => prev.map((c) => (c.id === id ? { ...c, label: color } : c)))
    else if (kind === 'vclip')
      setVClips((prev) => prev.map((c) => (c.id === id ? { ...c, label: color } : c)))
  }

  // 選択という選択を全部解除する唯一の入口。
  // 以前は解除処理が6箇所に散っていて、それぞれ違う部分集合しか消していなかった。
  // その結果「動画クリップを消したのにマーカーだけ消える」「Ctrl+A→Delete が
  // 無反応」「プレビューのリフレーム枠から抜けられない」が同時に起きていた。
  // 解除したい場所は必ずここを通すこと（部分的に消したい場合を除く）。

  // タイムライン上で選択中のトランジション（動画クリップの頭/尻ディップ or カット間ディゾルブ）。
  // クリップ本体とは別枠で選択でき、ここが選択中なら右パネルでそのトランジションだけを編集/削除できる。
  // 選択中のテロップ出入りアニメ（動画トランジションと同じ選択/編集/削除の仕組み）。
  const currentSegRef = useRef(0) // 再生中に追従しているセグメント index

  // ---- トラック（可変。+ボタンで増やせる）----
  const nVideoTracks = useMemo(() => tracks.filter((t) => t.kind === 'video').length, [tracks])
  const nAudioTracks = useMemo(() => tracks.filter((t) => t.kind === 'audio').length, [tracks])
  const v1Index = useMemo(() => tracks.findIndex((t) => t.id === 'V1'), [tracks])
  const a1Index = useMemo(() => tracks.findIndex((t) => t.id === 'A1'), [tracks])
  // 映像トラックを1本追加（新しい番号を最上段へ）
  function addVideoTrack(): void {
    const nums = tracks.filter((t) => t.kind === 'video').map((t) => Number(t.id.slice(1)) || 0)
    const id = 'V' + (Math.max(0, ...nums) + 1)
    setTracks((prev) => [{ id, name: id, kind: 'video' }, ...prev])
    setTrackStates((s) => ({ ...s, [id]: newTrackState(id) }))
  }
  // 音声トラックを1本追加（新しい番号を最下段へ）
  function addAudioTrack(): void {
    const nums = tracks.filter((t) => t.kind === 'audio').map((t) => Number(t.id.slice(1)) || 0)
    const id = 'A' + (Math.max(0, ...nums) + 1)
    setTracks((prev) => [...prev, { id, name: id, kind: 'audio' }])
    setTrackStates((s) => ({ ...s, [id]: newTrackState(id) }))
  }
  // 選択中のトラック（ヘッダークリックで選択。Deleteショートカットで削除）
  // そのトラックに中身があるか（動画=切片, 音声=SE, テロップ=そのトラックのcue）
  function trackHasContent(id: string): boolean {
    if (id === 'V1' || id === 'A1') return segsRef.current.length > 0 // メイン動画/音声
    return trackHasContentInner(id)
  }
  // テロップの載っているトラックがロック中か（V2決め打ちではなく実トラックで判定。V3ロックも効く）
  function telopLocked(cue: Cue): boolean {
    return !!trackStates[cueTrack(cue)]?.locked
  }
  function trackHasContentInner(id: string): boolean {
    const tr = tracks.find((t) => t.id === id)
    // 音声行: SE/BGM か、映像レイヤーの音声（対の映像トラックにクリップがある）
    if (tr?.kind === 'audio')
      return (
        seClips.some((c) => c.track === id) ||
        vClips.some((c) => 'A' + trackNum(c.track) === id)
      )
    // 映像行: テロップ or 画像クリップが載っていれば中身あり
    return (
      cues.some((c) => cueTrack(c) === id) ||
      imgClips.some((c) => c.track === id) ||
      vClips.some((c) => c.track === id)
    )
  }
  // 削除可能か（メイン動画/音声は不可、各種別で最低1本は残す、中身のある行は不可）
  function canDeleteTrack(id: string): boolean {
    // V1/A1(本体)に加えて V2/A2 も残す。これらは新規テロップ・SEの既定の置き場所なので、
    // 消えると `cueTrack` の既定 'V2' / `placeSE` の既定 'A2' が存在しないトラックを指し、
    // タイムラインに出ないのに書き出しには焼かれる「孤児クリップ」が生まれる。
    if (id === 'V1' || id === 'A1' || id === 'V2' || id === 'A2') return false
    const tr = tracks.find((t) => t.id === id)
    if (!tr) return false
    if (tr.kind === 'video' && nVideoTracks <= 1) return false
    if (tr.kind === 'audio' && nAudioTracks <= 1) return false
    return !trackHasContent(id)
  }
  function deleteTrack(id: string): void {
    if (!canDeleteTrack(id)) {
      if (id === 'V1' || id === 'A1' || id === 'V2' || id === 'A2')
        showToast('このトラックは既定の置き場所なので削除できません。')
      else if (trackHasContent(id))
        showToast('中身のあるトラックは削除できません。先にクリップを消してください。')
      return
    }
    setTracks((prev) => prev.filter((t) => t.id !== id))
    setTrackStates((s) => {
      const n = { ...s }
      delete n[id]
      return n
    })
    setSelectedTrackId(null)
  }
  function selectTrack(id: string): void {
    setSelectedTrackId(id)
    setSelectedIds([]) // クリップ選択は解除（削除対象をトラックに一本化）
    clearSegSel()
  }

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
  /**
   * 段ごとの高さ（自分で変えた段だけ入る）。
   *
   * **掴んだ段だけ太らせたい。** 以前は映像なら映像の段が全部、音声なら音声の段が
   * 全部まとめて変わっていた。波形を見たいのは音声の1本だけ、ということの方が多く、
   * 巻き添えで他まで太ると画面が足りなくなる。
   * ここに入っていない段は、今までどおり種類ごとの高さを使う。
   */
  // **ここは描画中に走るので loadLS を使えない**（定義がこれより下にあり、
  // 読み込み順で「初期化前」になる。実際に起動テストがそれを捕まえた）
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
  function audioTrackGain(id: string): number {
    const st = trackStates[id]
    // **状態が無い＝「既定」であって「消音」ではない。**
    // 無い物を消音として扱っていたため、復元したプロジェクトで
    // そのトラックの状態が入っていないと SE が1つも鳴らなかった。
    // 音は「鳴らない」方に倒すと気づきにくいので、無ければ普通に鳴らす。
    if (st?.muted) return 0
    if (anyAudioSolo && !st?.solo) return 0
    return clamp((st?.volume ?? 1) * masterVolume, 0, 1)
  }
  function setTrackVolume(id: string, v: number): void {
    const vol = clamp(v, 0, 1)
    setTrackStates((s) => ({ ...s, [id]: { ...s[id], volume: vol } }))
  }
  // 縦フェーダーのドラッグ（上=1.0 / 下=0）。apply には 0..1 の値が渡る
  function startFader(e: React.PointerEvent, apply: (f: number) => void): void {
    e.preventDefault()
    e.stopPropagation()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const set = (cy: number): void => apply(clamp(1 - (cy - rect.top) / rect.height, 0, 1))
    set(e.clientY)
    const mv = (ev: PointerEvent): void => set(ev.clientY)
    const up = (): void => {
      window.removeEventListener('pointermove', mv)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
    window.addEventListener('pointermove', mv)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }
  /**
   * 段見出しの**境目を掴んで**高さを変える（プレミアと同じ操作）。
   * 映像の境目なら映像レーン全体、音声なら音声レーン全体がまとめて変わる。
   *
   * @param above 掴んだ境目より上に、同じ種類の段がいくつあるか（1から数える）
   *
   * 掴んだ線をカーソルに追従させるには、**その線より上にある段の数**で割る。
   * 線の位置は「上にある段の高さの合計」で決まるので、1px 動かしたければ
   * 1段あたり 1/n px 変える必要がある。
   * 映像側は上の余白（TRACK_PAD_ROWS 段ぶん）も段の高さで伸び縮みするため、
   * その分も数に入れる。ここを間違えると、掴んだ場所から線がじわじわ離れていく。
   */
  function startGroupResize(
    kind: 'video' | 'audio',
    above: number,
    e: React.PointerEvent,
    trackId?: string
  ): void {
    e.preventDefault()
    e.stopPropagation()
    const startY = e.clientY
    // **掴んだ段だけ動かす。**
    // まとめて変える作りだと、波形を1本だけ見たいときにも他の段まで太り、
    // 画面が足りなくなる。掴んだ線の下にある段はそのまま押し下がる。
    if (trackId) {
      const startOwn = trackHOf(trackId)
      const prevCur = document.body.style.cursor
      document.body.style.cursor = 'row-resize'
      const mv = (ev: PointerEvent): void => {
        const h = clamp(startOwn + (ev.clientY - startY), TRACK_H_MIN, TRACK_H_MAX)
        setLaneH((p) => ({ ...p, [trackId]: h }))
      }
      const up = (): void => {
        document.body.style.cursor = prevCur
        window.removeEventListener('pointermove', mv)
        window.removeEventListener('pointerup', up)
        window.removeEventListener('pointercancel', up)
      }
      window.addEventListener('pointermove', mv)
      window.addEventListener('pointerup', up)
      window.addEventListener('pointercancel', up)
      return
    }
    const startH = kind === 'video' ? videoTrackHRef.current : audioTrackHRef.current
    const rows = Math.max(1, kind === 'video' ? above + TRACK_PAD_ROWS : above)
    const setter = kind === 'video' ? setVideoTrackH : setAudioTrackH
    // 掴んでいる間は、どこへ動かしても行を変える手のままにする
    // （途中で別のカーソルに化けると「外れた」ように見える）
    const prevCursor = document.body.style.cursor
    document.body.style.cursor = 'row-resize'
    const onMove = (ev: PointerEvent): void => {
      setter(clamp(startH + (ev.clientY - startY) / rows, TRACK_H_MIN, TRACK_H_MAX))
    }
    const onUp = (): void => {
      document.body.style.cursor = prevCursor
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }
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

  // ---- テキスト入力モーダル（OS標準promptの置き換え）----
  const [promptState, setPromptState] = useState<PromptState | null>(null)
  function askText(title: string, defaultValue: string, onOk: (v: string) => void): void {
    setPromptState({ title, value: defaultValue, onOk })
  }
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
  // ---- パネルの切り離し ----
  //
  // 切り離す＝**そのパネルを別の窓にする**。それだけ。
  // 以前は「画面の中で浮かせる」と「別ウィンドウで開く」の2つがあったが、
  // 窓なら本体の上にも別モニターにも自由に置けるので、分ける意味が無かった。
  //
  // 覚えさせない（localStorage に残さない）。起動しただけで窓が開くと、
  // モニターを外して起動したときに画面の外へ出たまま行方不明になる。
  // 切り離した窓の大きさ・位置。開き直すときに使う
  function popPane(id: PaneId): void {
    setPopped((p) => ({ ...p, [id]: true }))
    showToast(`${PANE_LABEL[id]} を切り離しました。窓を閉じると元に戻ります。`)
  }

  // ---- 画面の配置（保存して、次に開いたときに同じ形で始めるためのもの）----
  //
  // 「今のこの状態」が戻らないと意味が無いので、**保存するその場で読む**。
  // 窓の大きさ・位置は React の状態ではなく実物から読む（動かしても
  // 描き直しは起きないので、状態に持つと必ず古くなる）。
  const layoutNow = (): Record<string, unknown> => ({
    panes: (Object.keys(popped) as PaneId[]).filter((id) => popped[id]),
    geom: { ...paneGeom, ...readPaneGeometry() },
    leftW,
    rightW,
    timelineH,
    videoTrackH,
    audioTrackH,
    tabOrder,
    rightTab,
    monitorTab
  })
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const applyLayout = (l: any): void => {
    if (!l || typeof l !== 'object') return
    const num = (v: unknown, set: (n: number) => void): void => {
      if (typeof v === 'number' && Number.isFinite(v)) set(v)
    }
    num(l.leftW, setLeftW)
    num(l.rightW, setRightW)
    num(l.timelineH, setTimelineH)
    num(l.videoTrackH, setVideoTrackH)
    num(l.audioTrackH, setAudioTrackH)
    if (l.tabOrder && typeof l.tabOrder === 'object') setTabOrder(l.tabOrder)
    if (typeof l.rightTab === 'string') setRightTab(l.rightTab)
    if (l.monitorTab === 'program' || l.monitorTab === 'mixer') setMonitorTab(l.monitorTab)
    if (l.geom && typeof l.geom === 'object') setPaneGeom(l.geom)
    if (Array.isArray(l.panes)) {
      const next: Partial<Record<PaneId, true>> = {}
      for (const raw of l.panes as unknown[]) {
        const id = String(raw)
        if (id === 'left' || id === 'right' || id === 'preview' || id === 'timeline') next[id] = true
      }
      setPopped(next)
    }
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */

  // ---- パネルのタブ帯（見切れ対策と並べ替え）----
  //
  // パネルを狭めるとタブが端から切れて、奥のタブへ一生たどり着けなかった。
  // 3つの逃げ道を用意する:
  //   1. 端の「送り」ボタン（押しっぱなしで送り続ける）
  //   2. 「≫」から、いま見えていないタブを一覧で選ぶ
  //   3. 掴んで横に引っぱる
  // 並び順は勝手に変わらないよう固定。変えたいときだけ右クリックから動かす。
  const TAB_ORDER_KEY = 'giftcut.tabOrder'
  /** 保存した並び順を当てる。知らないタブは後ろに残す（項目が増えても消えない） */
  function orderedTabs<T extends { id: string }>(group: string, tabs: T[]): T[] {
    const saved = tabOrder[group]
    if (!saved?.length) return tabs
    const byId = new Map(tabs.map((t) => [t.id, t]))
    const out = saved.map((id) => byId.get(id)).filter((t): t is T => !!t)
    for (const t of tabs) if (!out.includes(t)) out.push(t)
    return out
  }
  function moveTab(group: string, tabs: { id: string }[], id: string, dir: -1 | 1 | 'head' | 'tail'): void {
    const cur = orderedTabs(group, tabs).map((t) => t.id)
    const i = cur.indexOf(id)
    if (i < 0) return
    cur.splice(i, 1)
    const at =
      dir === 'head' ? 0 : dir === 'tail' ? cur.length : Math.max(0, Math.min(cur.length, i + dir))
    cur.splice(at, 0, id)
    setTabOrder((p) => ({ ...p, [group]: cur }))
  }
  const [tabMenu, setTabMenu] = useState<{
    x: number
    y: number
    group: string
    id: string
    label: string
  } | null>(null)
  const [tabOverflow, setTabOverflow] = useState<{
    x: number
    y: number
    group: string
    hidden: string[]
  } | null>(null)
  useEffect(() => {
    if (!tabMenu && !tabOverflow) return
    const close = (): void => {
      setTabMenu(null)
      setTabOverflow(null)
    }
    // Escape でも閉じる。閉じられないと、裏のタブが押せなくなる
    const onEsc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('click', close)
    window.addEventListener('keydown', onEsc)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', onEsc)
    }
  }, [tabMenu, tabOverflow])

  /** タブの一覧（≫）とその並び順メニューで使う、グループごとのタブ定義 */
  const TAB_DEFS: Record<string, { id: string; label: string }[]> = {
    right: [
      { id: 'project', label: 'プロジェクト' },
      { id: 'telop', label: 'テロップ' },
      { id: 'icon', label: 'アイコン' },
      { id: 'se', label: 'SE' },
      { id: 'transition', label: 'トランジション' }
    ],
    monitor: [
      { id: 'program', label: 'プログラム' },
      { id: 'mixer', label: 'オーディオミキサー' }
    ]
  }
  const pickTab = (group: string, id: string): void => {
    if (group === 'right') setRightTab(id as typeof rightTab)
    else if (group === 'monitor') setMonitorTab(id as typeof monitorTab)
  }

  /**
   * 右クリックメニューを画面の中に収める。
   *
   * メニューは押した場所にそのまま出していたので、画面の下や右の端で押すと
   * 項目がはみ出して選べなかった（項目を増やしたときに実際に起きた）。
   * 出したあとに位置を測って、はみ出していたら内側へ寄せる。
   */
  const clampMenu = (el: HTMLDivElement | null): void => {
    if (!el) return
    const pad = 8
    const r = el.getBoundingClientRect()
    if (r.bottom > window.innerHeight - pad)
      el.style.top = `${Math.max(pad, window.innerHeight - pad - r.height)}px`
    if (r.right > window.innerWidth - pad)
      el.style.left = `${Math.max(pad, window.innerWidth - pad - r.width)}px`
  }
  // ---- 属性のコピー／貼り付け（プレミアの「属性のペースト」相当）----
  //
  // 1つのクリップで整えた見た目を、他のクリップにまとめて写す。
  // 位置や拡大を1つずつ揃え直すのは現実的でないので、コピー元の設定を
  // まとめて持ち回れるようにする。
  //
  // 種類をまたいで写せるもの（変形・色調整・クロップ・不透明度・ラベル）と、
  // その種類にしか無いもの（テロップの見た目や位置、音量やフェード）がある。
  // 混ざった選択に貼っても壊れないよう、**貼れるものだけ貼る**。
  /** 何を写せるかの一覧（人に見せる文言） */
  /** 選んでいるクリップ1つから属性をコピーする */
  /**
   * コピーした属性を、選んでいるクリップすべてに貼り付ける。
   *
   * テロップの見た目をコピーして全部選んで貼っても、動画や画像には
   * 貼らずテロップにだけ貼る。全部に貼ろうとして何も起きないより、
   * 貼れるものにだけ貼って「何件に貼ったか」を伝えるほうが親切。
   */

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
  function rememberProject(path: string): void {
    const name = path.split(/[\\/]/).pop() ?? path
    setRecentProjects((prev) =>
      [{ path, name, at: Date.now() }, ...prev.filter((r) => r.path !== path)].slice(0, RECENT_MAX)
    )
  }
  // ---- 確認モーダル（OS標準 confirm / メッセージボックスの置き換え）----
  // OS のダイアログは見た目も文言の作法もアプリと揃わないうえ、
  // window.confirm はレンダラを丸ごと止めるので再生や書き出しの進行も巻き添えになる。
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null)
  function askConfirm(o: {
    title: string
    body: string
    okLabel?: string
    cancelLabel?: string
    danger?: boolean
  }): Promise<boolean> {
    return new Promise((resolve) =>
      setConfirmState({
        title: o.title,
        body: o.body,
        okLabel: o.okLabel ?? '続ける',
        cancelLabel: o.cancelLabel ?? 'キャンセル',
        danger: !!o.danger,
        resolve
      })
    )
  }
  // 開いたまま握りつぶされないよう、閉じる経路は必ずここを通す
  function closeConfirm(ok: boolean): void {
    setConfirmState((s) => {
      s?.resolve(ok)
      return null
    })
  }
  // ラウドネス正規化の目標LUFS（null=OFF）。既定はYouTube最適の -14

  // ---- 右パネル（プロジェクト/テロップ/エフェクト/トランジション）----
  // 左パネルのタブ（プロパティ＝見た目の設定 / モーション＝時間で変わる動き）
  const [rightTab, setRightTab] = useState<
    'project' | 'telop' | 'icon' | 'se' | 'transition'
  >('project')
  // プレビュー内インライン編集中のテロップ（セッション保存で参照するためここで宣言）
  // 内蔵SEライブラリ（GiftCut/SE をカテゴリ別に読む。ローカルフォルダ参照＝配布同梱しない）
  const [seLibrary, setSeLibrary] = useState<{ category: string; name: string; path: string }[]>([])
  /**
   * SE を置き場へ入れる。
   *
   *   何も渡さない … ファイルを選ぶ
   *   'folder'     … フォルダを選ぶ（そのフォルダごと分類になる）
   *   パスの配列   … 掴んで落とされた物
   *
   * **入れたらその場で読み直す。** 入れたのに一覧が変わらないと、
   * 入ったのかどうか本人には分からない。
   */
  async function importSeInto(arg?: 'folder' | string[]): Promise<void> {
    const r =
      arg === 'folder'
        ? await window.giftcut?.importSeFolder?.()
        : await window.giftcut?.importSe?.(Array.isArray(arg) ? arg : undefined)
    if (!r || r.canceled) return
    if (!r.ok) {
      showToast(`入れられませんでした。\n${r.error ?? ''}`)
      return
    }
    refreshSE()
    showToast(
      `SE に ${r.files}件${r.folders ? `（フォルダ ${r.folders}個）` : ''}入れました。` +
        'そのまま使えます。'
    )
  }
  const refreshSE = (): void => {
    void window.giftcut?.listSE?.()?.then((r) => {
      if (r?.ok) setSeLibrary(r.items)
    })
  }
  useEffect(() => {
    refreshSE()
  }, [])
  // ローカルのテロップテンプレ集（GiftCut/telop-presets/ = Geba等。配布に含めない）
  const [localTemplates, setLocalTemplates] = useState<TelopTemplate[]>([])
  const refreshPresets = (): void => {
    void window.giftcut?.listTelopPresets?.()?.then((r) => {
      if (r?.ok && Array.isArray(r.items)) setLocalTemplates(r.items as TelopTemplate[])
    })
  }
  // ---- 動きの見本帳（Premiere から写し取ったプリセット）----
  //
  // 置き場は motion-presets/*.json（取り込むと userData に書かれる）。
  // **読み直すときも必ず sanitizeMotion を通す**。人からもらった JSON を
  // そのまま信じると、壊れた形が動きの計算まで届いて画面が消える。
  const [motionPresets, setMotionPresets] = useState<MotionPresetFile[]>([])
  const refreshMotionPresets = (): void => {
    void window.giftcut?.listMotionPresets?.()?.then((r) => {
      if (!r?.ok || !Array.isArray(r.items)) return
      const items: MotionPresetFile[] = []
      for (const raw of r.items) {
        const o = raw as { name?: unknown; motion?: unknown; partial?: unknown; endsHidden?: unknown }
        if (typeof o?.name !== 'string') continue
        // **動きが空でも捨てない。** 名前だけでも並べて、押されたら理由を言う。
        // どれを使うか（配布に載せるか）を決めるのは人で、こちらが先に間引かない。
        items.push({
          name: o.name,
          motion: sanitizeMotion(o.motion) ?? {},
          ...(Array.isArray(o.partial) ? { partial: o.partial.map(String) } : {}),
          ...(o.endsHidden ? { endsHidden: true } : {})
        })
      }
      setMotionPresets(items)
    })
  }
  useEffect(() => {
    refreshMotionPresets()
  }, [])
  const importMotionPresets = (): void => {
    void window.giftcut?.importMotionPresets?.()?.then((r) => {
      if (!r || r.canceled) return
      if (!r.ok) {
        showToast(`取り込めませんでした: ${r.error ?? '不明なエラー'}`)
        return
      }
      refreshMotionPresets()
      // 一覧に出るのは**ちゃんと出る物だけ**なので、その数を主役にする。
      // 隠したぶんも数だけは言う（黙って減らすと「取り込めていない」に見える）。
      const full = (r.imported ?? 0) - (r.partial ?? 0) - (r.empty ?? 0)
      const hidden = (r.partial ?? 0) + (r.empty ?? 0)
      showToast(
        `${full} 個 使えるようになりました` +
          (hidden
            ? `（まだ出ない ${hidden} 個は隠してあります。一覧の「まだ出ない物も」で見られます）`
            : '')
      )
    })
  }

  /**
   * 自分で作って名前を付けて保存した動き。
   *
   * 置き場は取り込んだ物（userData の motion-presets/）とは分ける。
   * **混ぜると、取り込み直しで自分の物まで消える**うえ、配布に載せてよい物
   * （自分で作った物）と載せられない物（写し取った物）の区別が付かなくなる。
   * 中身は小さいので、設定と同じ所に置く（更新しても消えない）。
   */
  const MY_MOTIONS_KEY = 'giftcut.myMotions'
  const loadMyMotions = (): MotionPresetFile[] => {
    try {
      const raw = JSON.parse(localStorage.getItem(MY_MOTIONS_KEY) ?? '[]')
      if (!Array.isArray(raw)) return []
      const out: MotionPresetFile[] = []
      for (const o of raw) {
        // 人が触れる場所に置いてあるので、読み直すときも必ず通す
        if (typeof o?.name !== 'string') continue
        const m = sanitizeMotion(o.motion)
        if (m) out.push({ name: o.name, motion: m })
      }
      return out
    } catch {
      return []
    }
  }
  const [myMotions, setMyMotions] = useState<MotionPresetFile[]>(loadMyMotions)
  const putMyMotions = (next: MotionPresetFile[]): void => {
    setMyMotions(next)
    try {
      localStorage.setItem(MY_MOTIONS_KEY, JSON.stringify(next))
    } catch {
      showToast('自分の動きを保存できませんでした（保存領域がいっぱいの可能性）')
    }
  }
  /** いま選んでいるテロップの動きを、名前を付けて残す */
  function saveMyMotion(): void {
    const cue = cues.find((c) => selectedIds.includes(c.id))
    if (!cue) {
      showToast('テロップを選んでから保存してください。')
      return
    }
    const m = cue.motion
    if (!hasMotion(m)) {
      showToast('このテロップにはまだ動きが付いていません。')
      return
    }
    askText('この動きの名前', '', (v) => {
      const name = v.trim()
      if (!name) return
      // 同じ名前は上書き（増やし続けると一覧が使い物にならなくなる）
      const next = myMotions.filter((p) => p.name !== name)
      next.push({ name, motion: structuredClone(m!) })
      next.sort((a, b) => a.name.localeCompare(b.name, 'ja'))
      putMyMotions(next)
      showToast(`「${name}」を自分の動きに保存しました。`)
    })
  }
  const deleteMyMotion = (name: string): void => {
    putMyMotions(myMotions.filter((p) => p.name !== name))
  }

  // お気に入り（★）とカテゴリ上書き（ローカル保存）
  const isFav = (name: string): boolean => favorites.includes(name)
  const toggleFav = (name: string): void =>
    setFavorites((prev) => {
      const next = prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]
      saveFavorites(next)
      return next
    })
  const setTplCat = (name: string, cat: string): void =>
    setCatOverrides((prev) => {
      const next = { ...prev, [name]: cat }
      saveCatOverrides(next)
      return next
    })
  // テロップタブのセクション開閉（アコーディオン＝1つだけ開く。既定は全て閉じる）
  const [openTplSec, setOpenTplSec] = useState<string | null>(null)
  const toggleTplSec = (k: string): void => setOpenTplSec((p) => (p === k ? null : k))
  // 右パネル他タブ（プロジェクト/アイコン/SE/トランジション）のセクション開閉。
  // テロップタブのフォルダUIと同じ動作＝1タブにつき1つだけ開く・開いたら見出しへ自動スクロール（UI統一）。
  // 開いている折りたたみ。値は「開いているキーの配列」。
  // テロップ一覧のように点数が多いタブは1つだけ開く（全部開くと探せない）が、
  // 素材ビン（プロジェクト）は種類が3つだけなので、最初から全部開けておく。
  // 毎回3回クリックして開くのは手間なだけで、隠す意味がない。
  // 効果音も複数同時に開ける。**お気に入りは開けたままにしておきたい**のに、
  // 1つだけ開く作りだとフォルダを開くたびに畳まれる（実際に使うのはお気に入りが
  // ほとんどなので、毎回開き直すことになっていた）。
  const ALWAYS_OPEN_TABS = ['project', 'se']
  // どこを開けていたかは覚える。**開閉は編集の癖**なので、毎回開き直させない
  // （既定を「お気に入りは開く」にしても、閉じる派の人が毎回閉じることになる）。
  const ACC_KEY = 'giftcut.accOpen'
  const [openAccSec, setOpenAccSec] = useState<Record<string, string[]>>(() => {
    const def: Record<string, string[]> = {
      project: ['video', 'audio', 'image'],
      // お気に入りは、どのタブでも最初から開けておく（一番よく使う所なので）
      icon: ['fav', 'lib'],
      telop: ['fav'],
      // 効果音は「★お気に入り」を最初から開けておく。
      // 外から足したフォルダも同じ扱いで、開いたぶんはそのまま残る
      se: ['fav'],
      // トランジションは**どれも開かない**で始める。節が増えて（動画・テロップ・
      // 強調・動きの見本帳）、1つ開いた状態だと他の節が下へ押し出されて見えない。
      // どれを使うかは人によるので、勝手に1つだけ開けておく意味がない。
      transition: []
    }
    try {
      const saved = JSON.parse(localStorage.getItem(ACC_KEY) ?? 'null')
      if (!saved || typeof saved !== 'object') return def
      // 壊れた値が入っていても、そこだけ既定へ落とす（画面ごと消さない）
      const out = { ...def }
      for (const [tab, v] of Object.entries(saved)) {
        if (Array.isArray(v) && v.every((x) => typeof x === 'string')) out[tab] = v as string[]
      }
      return out
    } catch {
      return def
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(ACC_KEY, JSON.stringify(openAccSec))
    } catch {
      /* 容量超過などは無視（開閉が覚えられないだけ） */
    }
  }, [openAccSec])
  const accSecRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const toggleAccSec = (tab: string, k: string): void =>
    setOpenAccSec((p) => {
      const cur = p[tab] ?? []
      const isOpen = cur.includes(k)
      // 全部開けておくタブは複数同時に開ける。それ以外は従来どおり1つだけ。
      // 決まりは shared/accordion に置いてある（画面を作らずに試せるように）
      const next = nextOpenSecs(cur, k, ALWAYS_OPEN_TABS.includes(tab))
      if (!isOpen)
        requestAnimationFrame(() =>
          requestAnimationFrame(() =>
            accSecRefs.current[`${tab}:${k}`]?.scrollIntoView({ block: 'start', behavior: 'smooth' })
          )
        )
      return { ...p, [tab]: next }
    })
  // テロップタブと同じ見た目のセクション見出し＋開閉ボディ
  const accSec = (
    tab: string,
    key: string,
    label: string,
    count: number | null,
    body: JSX.Element,
    onDelete?: () => void
  ): JSX.Element => {
    const open = (openAccSec[tab] ?? []).includes(key)
    return (
      <div key={key} ref={(el) => (accSecRefs.current[`${tab}:${key}`] = el)}>
        <button className={`tpl-acc ${open ? 'open' : ''}`} onClick={() => toggleAccSec(tab, key)}>
          <span className="tpl-acc-ar">{open ? '▼' : '▶'}</span>
          {label}
          {count != null ? `（${count}）` : ''}
          {onDelete && (
            <span
              className="tpl-acc-del"
              title="フォルダを削除（中のアイテムは元の場所へ戻る）"
              onClick={(e) => {
                e.stopPropagation()
                onDelete()
              }}
            >
              ✕
            </span>
          )}
        </button>
        {open && body}
      </div>
    )
  }
  // ---- SE/アイコンの ★お気に入り＋ユーザーフォルダ（テロップタブと同じ整理機能）----
  const loadLS = <T,>(key: string, fallback: T): T => {
    try {
      const s = localStorage.getItem(key)
      return s ? (JSON.parse(s) as T) : fallback
    } catch {
      return fallback
    }
  }
  const saveLS = (key: string, v: unknown): void => {
    try {
      localStorage.setItem(key, JSON.stringify(v))
    } catch {
      /* 容量超過等は無視 */
    }
  }
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
  const [seFavs, setSeFavs] = useState<string[]>(() => loadLS('giftcut.seFavorites', []))
  const [seFolders, setSeFolders] = useState<{ key: string; label: string }[]>(() =>
    loadLS('giftcut.seFolders', [])
  )
  const [seOv, setSeOv] = useState<Record<string, string>>(() => loadLS('giftcut.seOverrides', {}))
  const [iconFavs, setIconFavs] = useState<string[]>(() => loadLS('giftcut.iconFavorites', []))
  const [iconFolders, setIconFolders] = useState<{ key: string; label: string }[]>(() =>
    loadLS('giftcut.iconFolders', [])
  )
  const [iconOv, setIconOv] = useState<Record<string, string>>(() =>
    loadLS('giftcut.iconOverrides', {})
  )
  const toggleSeFav = (p: string): void =>
    setSeFavs((prev) => {
      const n = prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]
      saveLS('giftcut.seFavorites', n)
      return n
    })
  const toggleIconFav = (id: string): void =>
    setIconFavs((prev) => {
      const n = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
      saveLS('giftcut.iconFavorites', n)
      return n
    })
  const setSeFolderOf = (p: string, key: string | null): void =>
    setSeOv((prev) => {
      const n = { ...prev }
      if (key) n[p] = key
      else delete n[p]
      saveLS('giftcut.seOverrides', n)
      return n
    })
  const setIconFolderOf = (id: string, key: string | null): void =>
    setIconOv((prev) => {
      const n = { ...prev }
      if (key) n[id] = key
      else delete n[id]
      saveLS('giftcut.iconOverrides', n)
      return n
    })
  const addSeFolder = (): void =>
    askText('フォルダ名', '新しいフォルダ', (name) => {
      const key = (name || '').trim()
      if (!key || key === 'fav' || seFolders.some((f) => f.key === key)) return
      const next = [...seFolders, { key, label: key }]
      setSeFolders(next)
      saveLS('giftcut.seFolders', next)
      setOpenAccSec((p) => ({ ...p, se: [key] }))
    })
  const deleteSeFolder = (key: string): void => {
    const next = seFolders.filter((f) => f.key !== key)
    setSeFolders(next)
    saveLS('giftcut.seFolders', next)
    setSeOv((prev) => {
      const n = Object.fromEntries(Object.entries(prev).filter(([, v]) => v !== key))
      saveLS('giftcut.seOverrides', n)
      return n
    })
    setOpenAccSec((p) => ({ ...p, se: (p.se ?? []).filter((x) => x !== key) }))
  }
  const addIconFolder = (): void =>
    askText('フォルダ名', '新しいフォルダ', (name) => {
      const key = (name || '').trim()
      if (!key || key === 'fav' || key === 'lib' || iconFolders.some((f) => f.key === key)) return
      const next = [...iconFolders, { key, label: key }]
      setIconFolders(next)
      saveLS('giftcut.iconFolders', next)
      setOpenAccSec((p) => ({ ...p, icon: [key] }))
    })
  const deleteIconFolder = (key: string): void => {
    const next = iconFolders.filter((f) => f.key !== key)
    setIconFolders(next)
    saveLS('giftcut.iconFolders', next)
    setIconOv((prev) => {
      const n = Object.fromEntries(Object.entries(prev).filter(([, v]) => v !== key))
      saveLS('giftcut.iconOverrides', n)
      return n
    })
    setOpenAccSec((p) => ({ ...p, icon: (p.icon ?? []).filter((x) => x !== key) }))
  }
  // SE/アイコン共用の右クリックメニュー（テロップの「フォルダへ移動」と同じ見た目・動作）
  const [orgMenu, setOrgMenu] = useState<{
    x: number
    y: number
    options: { label: string; checked?: boolean; act: () => void }[]
  } | null>(null)
  useEffect(() => {
    if (!orgMenu) return
    const close = (): void => setOrgMenu(null)
    const onEsc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOrgMenu(null)
    }
    window.addEventListener('click', close)
    window.addEventListener('keydown', onEsc)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', onEsc)
    }
  }, [orgMenu])
  // ユーザー作成フォルダ（カテゴリ）。既定の色カテゴリ + これ。
  const allCats = [...TELOP_CATS, ...customCats]
  // 実効カテゴリ＝手動移動(上書き)優先→スタイルの見た目の色で自動判定。
  // 上書き先が存在しないカテゴリ(削除フォルダ/旧・使い道カテゴリ)は無視して色判定へ＝自動移行。
  const catKeySet = new Set(allCats.map((c) => c.key))
  const catOf = (t: TelopTemplate): string => {
    const ov = catOverrides[t.name]
    if (ov && catKeySet.has(ov)) return ov
    return colorCatOf(t.style)
  }
  const addCustomCat = (): void =>
    askText('フォルダ名', '新しいフォルダ', (name) => {
      const key = (name || '').trim()
      if (!key || allCats.some((c) => c.key === key)) return
      const next = [...customCats, { key, label: key }]
      setCustomCats(next)
      saveCustomCats(next)
      setOpenTplSec(key)
    })
  const deleteCustomCat = (key: string): void => {
    const next = customCats.filter((c) => c.key !== key)
    setCustomCats(next)
    saveCustomCats(next)
    // このフォルダに入れていたテロップは上書きを外して元カテゴリへ戻す
    setCatOverrides((prev) => {
      const m = { ...prev }
      for (const n of Object.keys(m)) if (m[n] === key) delete m[n]
      saveCatOverrides(m)
      return m
    })
    if (openTplSec === key) setOpenTplSec(null)
  }
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

  // ===== セッション状態の保存/復元（再起動・リロードしても作業位置を維持）=====
  // 選択テロップ・タイムラインのスクロール/ズーム・再生ヘッド・開いてる右タブを覚える。
  // プロジェクト(cues)未読込のマウント/StrictMode二重マウント時は保存しない。
  // ＝既定値(選択なし・tab=project・zoom既定)で保存済みセッションを上書きするのを防ぐ。
  useEffect(() => {
    // テロップが無いプロジェクト（カット編集だけ）でも記憶する
    if (!cuesRef.current.length && !segsRef.current.length && !seClipsRef.current.length) return
    try {
      localStorage.setItem(
        'giftcut.session',
        JSON.stringify({
          // タイムライン
          zoom,
          t: currentTimeRef.current,
          sx: scrollRef.current?.scrollLeft ?? 0,
          // 左プロパティ（選択テロップ・編集中テロップ）
          sel: selectedIds,
          edit: editingId,
          // 右タブ＋そのスクロール位置
          tab: rightTab,
          rsx: rightBodyRef.current?.scrollTop ?? 0
        })
      )
    } catch {
      /* localStorage不可なら無視 */
    }
    // ※currentTime は依存に入れない（再生中に毎フレーム同期書き込みが走りジャンクの原因になる）。
    //   再生位置 t は下の2秒間隔タイマーで保存する。
  }, [zoom, selectedIds, rightTab, editingId])
  // 再生位置 t は2秒ごとに保存（再生中の毎フレーム localStorage 書き込みを避ける）
  useEffect(() => {
    const iv = window.setInterval(() => {
      if (!cuesRef.current.length && !segsRef.current.length) return
      try {
        const cur = JSON.parse(localStorage.getItem('giftcut.session') || '{}')
        if (Math.abs((cur.t ?? -1) - currentTimeRef.current) < 0.5) return
        cur.t = currentTimeRef.current
        localStorage.setItem('giftcut.session', JSON.stringify(cur))
      } catch {
        /* 無視 */
      }
    }, 2000)
    return () => window.clearInterval(iv)
  }, [])
  // スクロールだけの変化も sx を保存（他フィールドは維持）
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    let raf = 0
    const onScroll = (): void => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        try {
          const cur = JSON.parse(localStorage.getItem('giftcut.session') || '{}')
          cur.sx = el.scrollLeft
          localStorage.setItem('giftcut.session', JSON.stringify(cur))
        } catch {
          /* 無視 */
        }
      })
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])
  // 復元（マウント時1回）。選択テロップは自動保存復元(applyProjectData)が selectedIds を[]に
  // リセットするため、cues読込後に適用する（pendingSelRefに保留）。
  const pendingSelRef = useRef<number[] | null>(null)
  const pendingTimeRef = useRef<number | null>(null)
  const pendingEditRef = useRef<number | null>(null)
  const pendingRsxRef = useRef<number | null>(null)
  const rightBodyRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    try {
      const raw = localStorage.getItem('giftcut.session')
      if (!raw) return
      const s = JSON.parse(raw)
      // 保存してある拡大率は範囲へ収めてから使う（0 や NaN で中身が消えるのを防ぐ）
      if (s.zoom != null) setZoom(clampZoom(s.zoom))
      if (typeof s.t === 'number') pendingTimeRef.current = s.t
      if (Array.isArray(s.sel)) pendingSelRef.current = s.sel
      if (typeof s.edit === 'number') pendingEditRef.current = s.edit
      if (typeof s.rsx === 'number') pendingRsxRef.current = s.rsx
      if (typeof s.tab === 'string') setRightTab(s.tab)
      if (typeof s.sx === 'number')
        requestAnimationFrame(() => {
          if (scrollRef.current) scrollRef.current.scrollLeft = s.sx
        })
    } catch {
      /* 無視 */
    }
  }, [])
  // cues が読み込まれたら保留していた 選択/編集中/再生位置 を適用（プロジェクト復元後に効かせる）
  useEffect(() => {
    if (!cues.length) return
    if (pendingSelRef.current) {
      const ids = pendingSelRef.current.filter((id) => cues.some((c) => c.id === id))
      pendingSelRef.current = null
      if (ids.length) setSelectedIds(ids)
    }
    if (pendingEditRef.current != null) {
      const id = pendingEditRef.current
      pendingEditRef.current = null
      if (cues.some((c) => c.id === id)) setEditingId(id)
    }
    if (pendingTimeRef.current != null) {
      const t = pendingTimeRef.current
      pendingTimeRef.current = null
      setTime(t)
    }
  }, [cues])
  // 右パネル（テロップ一覧等）の縦スクロール位置を保存/復元。タブ切替やリスト読込で panel-body が
  // 変わるので rightTab/一覧件数で張り直す。内容が伸びてスクロール可能になってから復元を適用。
  useEffect(() => {
    const el = rightBodyRef.current
    if (!el) return
    // 目標スクロール位置まで届く高さになってから適用（一覧が読込中だと届かないので pending を保持）。
    const applyPending = (): void => {
      if (pendingRsxRef.current == null) return
      if (el.scrollHeight - el.clientHeight >= pendingRsxRef.current - 1) {
        el.scrollTop = pendingRsxRef.current
        pendingRsxRef.current = null
      }
    }
    applyPending()
    requestAnimationFrame(applyPending) // レイアウト確定後にもう一度
    let raf = 0
    const onScroll = (): void => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        try {
          const cur = JSON.parse(localStorage.getItem('giftcut.session') || '{}')
          cur.rsx = el.scrollTop
          localStorage.setItem('giftcut.session', JSON.stringify(cur))
        } catch {
          /* 無視 */
        }
      })
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [rightTab, localTemplates.length])
  const sePreviewRef = useRef<HTMLAudioElement | null>(null)
  // SEライブラリの試聴（クリック）。使い回しのAudioで前の音を止めてから再生。
  function previewSE(path: string): void {
    try {
      if (!sePreviewRef.current) sePreviewRef.current = new Audio()
      const a = sePreviewRef.current
      a.pause()
      a.src = toGcUrl(path)
      a.currentTime = 0
      void a.play().catch(() => {})
    } catch {
      /* noop */
    }
  }
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
  // レーン（テロップトラック）→画像。色と別軸でレーン単位でもアイコンを割当できる
  function setIconForLane(lane: string, image: string | null): void {
    setLaneIconAssign((prev) => {
      const n = { ...prev }
      if (image) n[lane] = image
      else delete n[lane]
      saveLS('giftcut.laneIconAssign', n)
      return n
    })
  }
  const [cropSrc, setCropSrc] = useState<{ src: string; onDone: (img: string) => void } | null>(
    null
  )
  // アイコンの配置：テロップに付随（テキスト量に追従）。位置=どの側 / 微調整=XY(1080px) / サイズ。
  // プロジェクトに保存。
  // アイコン軸: 自動調整ONで全テロップを揃える共有アンカー点（左端・縦中央）。
  // テロップごとに位置がバラつくとアイコンが飛び回るため、軸を1点に固定する（ユーザー要望 2026-07-23）。
  const iconScaleFor = (): number => iconScale
  // 自動調整のON/OFF切替時は、サイズ倍率とXYオフセットを既定(100%,0)に戻す。
  // ＝前モードの調整が乗ったまま「+」で効いてズレるのを防ぐ（常にクリーンな基準から調整）。
  function changeIconAuto(on: boolean): void {
    // 切替前の本文位置を記録（アイコンを含まない telop-textmain 基準）
    const el = screenRef.current
    const before = el?.querySelector('.telop-box-sel .telop-textmain')?.getBoundingClientRect()
    setIconAuto(on)
    setIconScale(1)
    setIconOffset({ x: 0, y: 0 })
    // ONにしたら「左詰め」を適用（選択テロップ）。ただし固定枠は作らず内容ぴったり＝枠が常に本体一致。
    if (on && selectedIds.length) applyIconAutoLeft()
    // 差分補正: モード切替で本文が動いたぶんを打ち消し、テロップは今の位置のまま＝アイコンだけ付け外し。
    // （旧実装は縦を常に中央基準で再計算しており、縦アンカー下のテロップがONのたびに上へズレていた）
    if (before && el && primaryId != null) {
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const after = el.querySelector('.telop-box-sel .telop-textmain')?.getBoundingClientRect()
          if (!after) return
          const S = el.getBoundingClientRect()
          const dx = (after.left - before.left) / S.width
          const dy = (after.top - before.top) / S.height
          if (Math.abs(dx) < 0.0005 && Math.abs(dy) < 0.0005) return
          // アイコン軸整列後は全テロップが同じ点を共有するので、補正も全テロップ＋軸に適用
          setCues((prev) =>
            prev.map((c) => ({
              ...c,
              pos: {
                x: clamp((c.pos?.x ?? 0.5) - dx, 0, 1),
                y: clamp((c.pos?.y ?? 0.85) - dy, 0, 1)
              }
            }))
          )
          setIconAnchorPos((p) =>
            p ? { x: clamp(p.x - dx, 0, 1), y: clamp(p.y - dy, 0, 1) } : p
          )
        })
      )
    }
  }
  // 色 → 画像 の割当（「アイコン設定」で設定。null で解除）
  function setIconForColor(color: string, image: string | null): void {
    setIconAssignState((prev) => {
      const next = { ...prev }
      if (image) next[color] = image
      else delete next[color]
      saveIconAssign(next)
      return next
    })
  }
  // テロップの実効アイコン画像。優先: 個別D&D(iconImage) → 色(ラベル)割当 → レーン(トラック)割当。
  // 何も割り当ててなければ非表示（デフォOFF）。personIcon===false のテロップだけ個別に非表示。
  // どの画像を出すかの決まりは state/useIcons（割り当ての優先順位も中にある）
  const iconForCue = (c: Cue): string | undefined =>
    icons.iconForCue(c, iconAssign, laneIconAssign, cueTrack)
  function appendIconImage(name: string, image: string): void {
    // 保存は updater の外で行う（副作用を updater に入れない＋失敗を検知して通知するため）
    const prev = iconLibrary
    const id = Math.max(0, ...prev.map((i) => i.id)) + 1
    const next = [...prev, { id, name, image }]
    setIconLibrary(next)
    if (!saveIconLibrary(next))
      showToast(
        'アイコンを保存できませんでした（保存容量の上限）。\n不要なアイコンを削除してください。',
        'error'
      )
    setOpenAccSec((p) => ({ ...p, icon: ['lib'] })) // 追加したら開いて見せる（各タブ共通の動作）
  }
  // ライブラリに画像を追加（ファイル選択 → 円形クロップ → 保存）
  /**
   * 画像を1枚ずつ切り抜いて足す。
   *
   * **複数まとめて受け取る。** 1枚だけしか受け付けないと、
   * 何枚も足したい人は同じ操作を繰り返すことになる。
   * 切り抜きは1枚ずつなので、終わったら次の1枚へ送る。
   */
  function addIconFiles(files: File[]): void {
    const rest = files.filter((f) => f.type.startsWith('image/'))
    if (!rest.length) return
    const next = async (): Promise<void> => {
      const f = rest.shift()
      if (!f) return
      try {
        const src = await fileToDataUrl(f)
        const name = f.name.replace(/\.[^.]+$/, '')
        setCropSrc({
          src,
          onDone: (img) => {
            appendIconImage(name, img)
            void next()
          }
        })
      } catch {
        void next() // 読めない1枚で止めない
      }
    }
    void next()
  }
  async function addIconImages(): Promise<void> {
    const inp = document.createElement('input')
    inp.type = 'file'
    inp.accept = 'image/*'
    inp.multiple = true
    inp.onchange = (): void => addIconFiles([...(inp.files ?? [])])
    inp.click()
  }
  function removeIconImage(id: number): void {
    setIconLibrary((prev) => {
      const next = prev.filter((it) => it.id !== id)
      saveIconLibrary(next)
      return next
    })
    // ★/フォルダ振り分けも掃除
    setIconFavs((prev) => {
      const n = prev.filter((x) => x !== String(id))
      saveLS('giftcut.iconFavorites', n)
      return n
    })
    setIconOv((prev) => {
      if (!(String(id) in prev)) return prev
      const n = { ...prev }
      delete n[String(id)]
      saveLS('giftcut.iconOverrides', n)
      return n
    })
  }
  // アイコン表示ON/OFF。チェックは「選択テロップと同じ色(ラベル)のテロップ全部」に反映。
  // ON=undefined(色割当があれば自動表示)、OFF=false(その色を隠す)。単体付与はドラッグ&ドロップで行う。
  function setPersonIconForSelected(on: boolean): void {
    if (!selectedIds.length) return
    const labels = new Set(cues.filter((c) => isSelected(c.id)).map((c) => c.label))
    setCues((prev) =>
      prev.map((c) => (labels.has(c.label) ? { ...c, personIcon: on ? undefined : false } : c))
    )
    if (
      on &&
      selected &&
      (currentTimeRef.current < selected.start || currentTimeRef.current >= selected.end)
    ) {
      stopPlayback()
      seekTo(selected.start)
    }
  }

  // ---- ショートカット / 環境設定 ----
  const [shortcuts, setShortcuts] = useState<Shortcuts>(loadShortcuts)
  const [prefsOpen, setPrefsOpen] = useState(false)
  const [fileMenuOpen, setFileMenuOpen] = useState(false)
  const [capturingId, setCapturingId] = useState<ShortcutId | null>(null)
  function updateShortcut(id: ShortcutId, combo: string): void {
    setShortcuts((prev) => {
      const next = { ...prev, [id]: combo }
      try {
        localStorage.setItem(SC_KEY, JSON.stringify(next))
      } catch {
        /* noop */
      }
      return next
    })
  }
  function resetShortcuts(): void {
    setShortcuts({ ...DEFAULT_SHORTCUTS })
    try {
      localStorage.setItem(SC_KEY, JSON.stringify(DEFAULT_SHORTCUTS))
    } catch {
      /* noop */
    }
  }

  // ---- プレビュー内インライン編集 ---- （宣言はセッション保存/復元より前に移動済み）
  const screenRef = useRef<HTMLDivElement>(null)
  // プレビュー上テロップの手動ダブルタップ検出（ネイティブdblclickが状態依存で不発なため）
  const lastTelopTapRef = useRef<{ id: number; t: number }>({ id: -1, t: 0 })
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

  // 画面に出ている時間の範囲（秒）。ここから外れた切片は帯を描かない。
  //
  // 並んでいる数だけ帯を作っていたので、マウスを動かすたびに全部が作り直され、
  // クリップ1000個で1操作68ms かかっていた。見えない帯を作らなければ、
  // 何個並んでも「画面に映るぶん」しか作らずに済む。
  // 前後1画面ぶん多めに作る（掴んで動かした先で消えないように）。
  //
  // ※幅がまだ測れない間（起動直後など）は全部描く。ここで絞ると
  //   「t=0 付近の帯しか無い」状態になり、置く・掴むが全部おかしくなる。
  const ALL_VIEW = { a: -1e9, b: 1e9 }
  const [viewSec, setViewSec] = useState(ALL_VIEW)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    let id = 0
    const update = (): void => {
      id = 0
      const z = zoomRef.current || 1
      const w = el.clientWidth
      if (!w) {
        setViewSec((p) => (p.a === ALL_VIEW.a ? p : ALL_VIEW))
        return
      }
      const pad = w / z
      setViewSec((prev) => {
        const a = el.scrollLeft / z - pad
        const b = (el.scrollLeft + w) / z + pad
        // 少しの動きで作り直さない（半画面ぶん動いたら見直す）
        if (Math.abs(a - prev.a) < pad * 0.5 && Math.abs(b - prev.b) < pad * 0.5) return prev
        return { a, b }
      })
    }
    const onScroll = (): void => {
      if (!id) id = requestAnimationFrame(update)
    }
    update()
    el.addEventListener('scroll', onScroll, { passive: true })
    const ro = new ResizeObserver(onScroll)
    ro.observe(el)
    return () => {
      if (id) cancelAnimationFrame(id)
      el.removeEventListener('scroll', onScroll)
      ro.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // 拡大率が変わると見えている範囲も変わる
  useEffect(() => {
    const el = scrollRef.current
    const w = el?.clientWidth ?? 0
    if (!el || !w) return
    const z = zoom || 1
    const pad = w / z
    setViewSec({ a: el.scrollLeft / z - pad, b: (el.scrollLeft + w) / z + pad })
  }, [zoom])
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
  const lastTsRef = useRef(0)
  /**
   * 次にシークを頼んでよい時刻（performance.now）。
   * **シークが重い相手を追いかけ続けないための間。** 直前のシークにかかった時間から決める。
   */
  const seekCooldownRef = useRef(0)
  /** カットで音を重ねている間（この時刻まで）は、音量 effect に書かせない */
  const xfadeUntilRef = useRef(0)
  /**
   * いまズレを詰めている最中か。
   *
   * **入り口と出口をずらす（履歴）。** 同じしきい値で出入りさせると、
   * 境目で速さが 1.00 と 1.02 の間を行ったり来たりする。速さを変えるたびに
   * 音は伸縮処理を通るので、**カットでもない普通の所で音が荒れる**。
   * 大きくズレた時だけ入り、ほぼ0まで詰めてから出る。
   */
  const fixingDriftRef = useRef(false)

  // ---- クリップボード & 編集履歴（Undo/Redo）----
  // 履歴は cues / segments / seClips / markers / imgClips を1スナップショットで管理する（統合Undo）
  const ratioRef = useRef<Ratio>('16:9')

  function setTime(t: number): void {
    currentTimeRef.current = t
    // 位置が飛んだら、温めてあった面は当てにできない
    preparedRef.current = null
    setCurrentTime(t)
  }
  // 再生中の再生ヘッド/テロップ再描画をスロットル。ref は常に更新して同期を保ち、
  // React state（＝再描画）だけ間引く。force で確実に反映。
  // 最軽量(360p)を選んだときだけ ~30fps に間引く。「解像度」と「再描画頻度」を別の
  // つまみにするとユーザーが2つ覚えることになるため、設定は解像度ひとつに束ねている。
  /**
   * 再生ヘッドの位置を進める。
   *
   * ## なぜ間引くのか（実測で分かったこと）
   *
   * setCurrentTime は **App 全体（13,000行）を作り直す**。素のままだと
   * rAF が回るたびに作り直すので、240Hz のモニタでは毎秒240回になる。
   *
   * 実測（動きの記録）:
   *
   *     画質360  作り直し 144〜164回/秒 → 240fps 近辺を維持
   *     画質orig 作り直し 200〜254回/秒 → 125fps まで落ちる
   *
   * 1回1回は 50ms に満たないので「長い仕事」としては現れないが、
   * **細かい仕事で主スレッドが埋まりっぱなし**になる。音がぶちぶち切れるのは
   * 1発の詰まりではなくこれ。デコードは無罪（落としたコマは0だった）。
   *
   * 前は 360 のときだけ間引いていた。画質を上げたときこそ重いのに、
   * そこで間引きが外れる作りになっていた。**全部の画質で上限を掛ける。**
   * 再生ヘッドは秒60回も動けば人の目には連続に見える。
   */
  function paintTime(t: number, force = false): void {
    currentTimeRef.current = t
    if (!force) {
      const now = performance.now()
      // 低画質は30回/秒で足りる。それ以外も60回/秒で頭打ちにする
      const minMs = previewResRef.current === 360 ? 33 : 16
      if (now - lastPaintRef.current < minMs) return
      lastPaintRef.current = now
    }
    setCurrentTime(t)
  }

  // 保存していない変更があるか（タイトルの「＊」用）。
  // 重いので毎レンダーではなく、下の一定間隔の判定でだけ更新する。
  const [unsaved, setUnsaved] = useState(false)
  const isDirty = (): boolean =>
    cuesRef.current !== baselineRef.current.cues ||
    segsRef.current !== baselineRef.current.segments ||
    seClipsRef.current !== baselineRef.current.seClips ||
    markersRef.current !== (baselineRef.current.markers ?? markersRef.current) ||
    imgClipsRef.current !== (baselineRef.current.imgClips ?? imgClipsRef.current) ||
    vClipsRef.current !== (baselineRef.current.vClips ?? vClipsRef.current) ||
    tracksRef.current !== (baselineRef.current.tracks ?? tracksRef.current) ||
    trackStatesRef.current !== (baselineRef.current.trackStates ?? trackStatesRef.current) ||
    ratioRef.current !== (baselineRef.current.ratio ?? ratioRef.current)
  const snapNow = (): Snap => ({
    cues: cuesRef.current,
    segments: segsRef.current,
    seClips: seClipsRef.current,
    markers: markersRef.current,
    imgClips: imgClipsRef.current,
    vClips: vClipsRef.current,
    tracks: tracksRef.current,
    trackStates: trackStatesRef.current,
    ratio: ratioRef.current
  })

  // cues / segments / seClips / markers / imgClips の変更を 450ms コアレスして1履歴にまとめる
  useEffect(() => {
    cuesRef.current = cues
    segsRef.current = segments
    seClipsRef.current = seClips
    markersRef.current = markers
    imgClipsRef.current = imgClips
    vClipsRef.current = vClips
    tracksRef.current = tracks
    trackStatesRef.current = trackStates
    ratioRef.current = ratio
    if (suppressHistoryRef.current) {
      suppressHistoryRef.current = false
      baselineRef.current = snapNow()
      return
    }
    if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current)
    pendingTimerRef.current = window.setTimeout(() => {
      pendingTimerRef.current = null
      if (isDirty()) {
        pushUndo(baselineRef.current)
        baselineRef.current = snapNow()
        redoStackRef.current = []
        setHistTick()
      }
    }, 450)
    return () => {
      if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current)
    }
  }, [cues, segments, seClips, markers, imgClips, vClips, tracks, trackStates, ratio])

  function pushUndo(state: Snap): void {
    undoStackRef.current.push(state)
    if (undoStackRef.current.length > 100) undoStackRef.current.shift()
  }
  // 保留中（デバウンス未確定）の変更を確定。分岐編集があれば redo を無効化する
  function commitPending(): void {
    if (pendingTimerRef.current) {
      clearTimeout(pendingTimerRef.current)
      pendingTimerRef.current = null
    }
    if (isDirty()) {
      pushUndo(baselineRef.current)
      baselineRef.current = snapNow()
      redoStackRef.current = []
    }
  }
  function undo(): void {
    commitPending()
    if (!undoStackRef.current.length) return
    redoStackRef.current.push(snapNow())
    restore(undoStackRef.current.pop() as Snap)
  }
  function redo(): void {
    commitPending() // undo と対称に。分岐編集後は redoStack がクリアされ no-op になる
    if (!redoStackRef.current.length) return
    pushUndo(snapNow())
    restore(redoStackRef.current.pop() as Snap)
  }
  // 履歴をリセット（プロジェクト読み込み時など）
  function resetHistory(base: Snap): void {
    if (pendingTimerRef.current) {
      clearTimeout(pendingTimerRef.current)
      pendingTimerRef.current = null
    }
    undoStackRef.current = []
    redoStackRef.current = []
    baselineRef.current = base
    cuesRef.current = base.cues
    segsRef.current = base.segments
    seClipsRef.current = base.seClips
    if (base.markers) markersRef.current = base.markers
    if (base.imgClips) imgClipsRef.current = base.imgClips
    if (base.vClips) vClipsRef.current = base.vClips
    if (base.tracks) tracksRef.current = base.tracks
    if (base.trackStates) trackStatesRef.current = base.trackStates
    if (base.ratio) ratioRef.current = base.ratio
    suppressHistoryRef.current = true
    setHistTick()
    // 保険: 続く setCues 等のエフェクトでフラグが消費されなかった場合、次tickで確実に解除
    // （消費済みなら false のまま＝no-op。残留すると次の本物の編集がundoに積まれない不具合の対策）
    setTimeout(() => {
      suppressHistoryRef.current = false
    }, 0)
  }


  const primaryId = selectedIds[0] ?? null
  const selected = cues.find((c) => c.id === primaryId) ?? null

  // 動画のタイムライン長（＝切片の合計。カットするほど短くなる）とレイアウト
  const segLayout = useMemo(() => layoutSegs(segments), [segments])
  const videoTLen = useMemo(() => totalSegLen(segments), [segments])
  const segLayoutRef = useRef<SegLayout[]>([])
  const videoTLenRef = useRef(0)
  useEffect(() => {
    segLayoutRef.current = segLayout
  }, [segLayout])
  useEffect(() => {
    videoTLenRef.current = videoTLen
  }, [videoTLen])

  // 字幕づくりは state/useSubtitles（聞き取り→割る→音に合わせる）
  const { runSubtitles, handleImportSrt } = useSubtitles({
    stopPlayback,
    seekTo,
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

  /**
   * 字幕を作る。
   *
   *   聞き取る（本体）→ 読める長さに割る → 喋っている所へ合わせる → 並べる
   *
   * **合わせるのは画面側**。カット点を知っているのがこちらなので、
   * 「切った所＝話の始まり」という一番強い手がかりをここで使える。
   */

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
    suppressHistoryRef,
    toGcUrl
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
  function getPlayEnd(): number {
    return contentEndRef.current > 0
      ? Math.min(contentEndRef.current, durationRef.current)
      : durationRef.current
  }

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

  // 音声ミュート/音量を動画要素に反映（A1トラック＝メイン音声。切片ミュート・音量・フェードも合成）
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    // カットで音を重ねている最中は触らない（重ねを上書きすると継ぎ目が戻る）
    if (performance.now() < xfadeUntilRef.current) return
    const src = tToSource(segLayout, currentTime)
    const L = src ? segLayout[src.index] : undefined
    const seg = L?.seg
    // **消音は muted ではなく音量0で行う。**
    // 音のある動画では、メディア時計が音声側に従っている。muted を切り替えると
    // 時計の張り替えが起きて、その間**絵まで止まる**（1080p の実測で約250ms）。
    // カットのたびに引っかかっていたのはこれ。音量なら再生は途切れない。
    const segMuted = seg ? !!seg.muted : false
    // 切片の音量倍率×フェード（頭/尻の指定秒で 0→1 / 1→0）
    let segGain = segMuted ? 0 : (seg?.vol ?? 1)
    if (L && seg) {
      const local = currentTime - L.tStart
      if (seg.afadeIn && seg.afadeIn > 0) segGain *= clamp(local / seg.afadeIn, 0, 1)
      if (seg.afadeOut && seg.afadeOut > 0)
        segGain *= clamp((L.len - local) / seg.afadeOut, 0, 1)
    }
    const g = clamp(audioTrackGain('A1') * segGain, 0, 4)
    if (Math.abs(v.volume - Math.min(g, 1)) > 1e-3) v.volume = Math.min(g, 1) // HTMLは0..1
  }, [trackStates, masterVolume, videoSrc, currentTime, segments, segLayout])

  // 選択が「もう存在しないもの」を指し続けないよう自動で掃除する。
  // 放置すると右パネルが真っ白になり、Delete がそこに吸われて無反応に見える。
  useEffect(() => {
    if (selectedTrans && !segments.some((s) => s.id === selectedTrans.segId))
      setSelectedTrans(null)
    if (selectedTelopTrans && !cues.some((c) => c.id === selectedTelopTrans.cueId))
      setSelectedTelopTrans(null)
    setSelectedVideoIds((prev) =>
      prev.length && prev.some((id) => !segments.some((s) => s.id === id))
        ? prev.filter((id) => segments.some((s) => s.id === id))
        : prev
    )
    setSelectedAudioIds((prev) =>
      prev.length && prev.some((id) => !segments.some((s) => s.id === id))
        ? prev.filter((id) => segments.some((s) => s.id === id))
        : prev
    )
    setSelectedSeIds((prev) =>
      prev.length && prev.some((id) => !seClips.some((c) => c.id === id))
        ? prev.filter((id) => seClips.some((c) => c.id === id))
        : prev
    )
    setSelectedImgIds((prev) =>
      prev.length && prev.some((id) => !imgClips.some((c) => c.id === id))
        ? prev.filter((id) => imgClips.some((c) => c.id === id))
        : prev
    )
    setSelectedIds((prev) =>
      prev.length && prev.some((id) => !cues.some((c) => c.id === id))
        ? prev.filter((id) => cues.some((c) => c.id === id))
        : prev
    )
    if (selectedMarkerId != null && !markers.some((m) => m.id === selectedMarkerId))
      setSelectedMarkerId(null)
    setSelectedVClipIds((prev) =>
      prev.length && prev.some((id) => !vClips.some((c) => c.id === id))
        ? prev.filter((id) => vClips.some((c) => c.id === id))
        : prev
    )
    if (editingId != null && !cues.some((c) => c.id === editingId)) setEditingId(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments, cues, seClips, imgClips, markers, vClips])

  // どの切片からも参照されなくなった元動画を片付ける（主ソースは残す）。
  // 残すと非表示の <video> がプロキシを読み続け、書き出しの入力にも無駄に載る。
  useEffect(() => {
    if (sources.length <= 1) return
    const used = new Set<number>()
    for (const g of segments) used.add(g.srcId ?? sources[0].id)
    // Undo/Redo で戻ってくる切片が参照しているソースも「使用中」とみなす。
    // これをしないと「動画を追加→Undo（GCがソースを削除）→Redo」で切片の srcId が
    // 迷子になり、srcOfSeg のフォールバックで別の動画に無言ですり替わる。
    for (const snap of [...undoStackRef.current, ...redoStackRef.current])
      for (const g of snap.segments) used.add(g.srcId ?? sources[0].id)
    const now = performance.now()
    // 登録直後（3秒以内）は消さない。ソース登録→切片配置は2段階なので、
    // 間で走ると置く前のソースを消してしまう。
    const keep = (s: Source, i: number): boolean =>
      i === 0 || used.has(s.id) || now - (srcAddedAtRef.current.get(s.id) ?? 0) < 3000
    if (sources.every(keep)) return
    setSources((prev) => prev.filter(keep))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments, sources])

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


  // SE の再生: 順再生(等速)中、再生ヘッドが SE 区間に入ったら該当 audio を鳴らす
  useEffect(() => {
    seClips.forEach((clip) => {
      const a = seAudioRefs.current.get(clip.id)
      if (!a) return
      const active =
        playing &&
        playRateRef.current === 1 &&
        currentTime >= clip.tStart &&
        currentTime < clip.tStart + clip.duration
      if (active) {
        const local = currentTime - clip.tStart
        // 音源内の再生位置＝クリップ内ローカル秒＋トリム済みオフセット
        const target = local + (clip.srcOffset ?? 0)
        // シーク中は頼み直さない（着く前に書くと取り消されて、永久に追いつけない）
        // **音の位置を直すと、そこで必ず途切れる**（プチッと鳴る）ので記録に残す
        if (!a.seeking && Math.abs(a.currentTime - target) > 0.3) {
          perf.mark(`音の位置を直した ${clip.name}`)
          a.currentTime = target
        }
        // 載っているトラック音量×フェード（頭/尻の指定秒で 0→1 / 1→0）※クリップ内ローカル秒で判定
        const fade = seFadeGain(clip, local)
        // 声が入っている間は下げる（ダッキング）。書き出しと同じ折れ線を使う
        const duck = duckGainAt(clip, currentTime)
        // **同じ値を毎コマ書き直さない。**
        // ここは毎レンダー（秒60〜240回）通る。音量を書くたびに音の作り直しが
        // 走るので、変わっていないのに書くと、それだけで音が荒れる。
        const want = clamp(clip.volume * fade * duck * audioTrackGain(clip.track), 0, 1)
        if (Math.abs(a.volume - want) > 0.002) a.volume = want
        if (a.paused) {
          perf.mark(`音を鳴らし始めた ${clip.name}`)
          void a.play().catch(() => {})
        }
      } else if (!a.paused) {
        a.pause()
      }
    })
  }, [currentTime, playing, seClips, trackStates, masterVolume])
  // マルチソース: 再生ヘッドのセグメントの元動画へ<video>のsrcを切り替える。
  // 単一ソース（sources.length<=1）なら何もしない＝従来動作を完全維持。
  useEffect(() => {
    if (!sources.length) return
    const src = tToSource(segLayout, currentTime)
    const seg = src ? segLayout[src.index]?.seg : undefined
    const s = srcOfSeg(seg)
    if (!s) return
    const desired = previewUrl(s.path, s.origUrl)
    // 表示対象を切替（要素はソースごとに常設済み＝src差し替えが起きないのでちらつかない）
    if (s.id !== curSourceIdRef.current) {
      curSourceIdRef.current = s.id
      setActiveSrcId(s.id)
      const el = elOf(s.id)
      // 切り替える前の音量を控えておく（下で引き継ぐ。理由は入れ替えの所と同じ）
      const prevVol = videoRef.current?.volume ?? 1
      if (el) {
        videoRef.current = el
        // 切替先を今の位置へ即シーク（再生中は再生クロックが追従させるが、初手のズレを詰める）
        if (src) {
          const want = seg ? seg.srcStart + (currentTime - segLayout[src.index].tStart) * src.speed : 0
          if (Math.abs(el.currentTime - want) > 0.15) el.currentTime = want
        }
      }
      // 直前まで表示していた要素は止める（裏で音が鳴り続けるのを防ぐ）
      // 直前まで表示していた物は止める。**映していない面も必ず黙らせる**
      //（2枚組にしたので、放っておくと裏の面から音が出る）
      videoElsRef.current.forEach((v, k) => {
        if (k === elKey(s.id, halfOf(s.id))) return
        if (!v.paused) v.pause()
        v.volume = 0 // 消すのは音量で（muted を触ると時計が張り替わる／上の effect 参照）
      })
      // **音量を引き継いでから鳴らす。**
      // 音量を書く effect はこれより前に並んでいるので、今の描画では
      // まだ「切り替える前の要素」に書かれている。ここで黙らせたまま渡すと、
      // 次の描画までの数十msだけ既定の 1.0（最大）で鳴ってしまう。
      if (el) el.volume = prevVol
      // duration 未取得(0)なら据え置き（0にすると再生開始条件が壊れる）。metadata到達時に更新される。
      if (s.duration > 0) setVideoDuration(s.duration)
      setFps(s.fps)
    }
    // 後追いのプロキシ/fps/尺が届いたら反映（届くまで原本再生・既定30のままになるのを防ぐ）
    // プレビュー解像度を変えたときもここで src を差し替える（再生ヘッド位置は触らないので維持される）
    //
    // **ただし、流している最中に黙って差し替えない。**
    // 差し替えは要素の読み込み直しになるので、そこで音が切れる。
    // 実測（npm run stutter --fresh）: 焼き直しが終わった瞬間に
    // 「音の抜け 64ms」。しかも出るのは毎回**測り終わり際＝変換の完了時**だった。
    // 変換の重さのせいだと思って優先度を最低まで下げたが、それでは消えなかった。
    //
    // 焼き上がったぶんは、止めてから入れ替える（見えている絵は原本のままでも、
    // 画質が少し眠いだけで、音が切れるより遥かにまし）。
    // **画質を自分で変えたときは、その場で差し替える**——待たされると
    // 「効いていない」と見えるため。
    const resChanged = lastPreviewResRef.current !== previewRes
    lastPreviewResRef.current = previewRes
    if (!playing || resChanged) setVideoSrc((prev) => (prev === desired ? prev : desired))
    setFps((prev) => (Math.abs(prev - s.fps) > 1e-3 ? s.fps : prev))
    if (s.duration > 0)
      setVideoDuration((prev) => (Math.abs(prev - s.duration) > 1e-3 ? s.duration : prev))
    // playing を見るのは「止めた瞬間に、待たせていた差し替えを入れる」ため
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTime, segLayout, sources, previewRes, proxyMap, playing])
  // 次に来る別ソースの映像を先回りシークして待機させる（切替の瞬間に正しいフレームが即出る）
  useEffect(() => {
    if (sources.length <= 1) return
    const cur = segLayout.find((l) => currentTime >= l.tStart && currentTime < l.tEnd)
    const nxt = cur ? segLayout[cur.index + 1] : segLayout[0]
    if (!nxt || nxt.tStart - currentTime > 6) return // 6秒前から準備
    const s = srcOfSeg(nxt.seg)
    if (!s || s.id === curSourceIdRef.current) return
    const el = elOf(s.id)
    if (!el) return
    // シーク中は頼み直さない（着く前に書くと取り消されて、永久に追いつけない）
    if (!el.seeking && Math.abs(el.currentTime - nxt.seg.srcStart) > 0.3)
      el.currentTime = nxt.seg.srcStart
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTime, segLayout, sources])
  // プレビューに置いておく映像レイヤークリップ（トラックの順＝下から重ねる）。
  // 区間内だけを描くと境界で <video> が破棄され、戻ったときに先頭フレームが一瞬出て
  // 読み込みもやり直しになるため、再生ヘッドの前後2秒ぶんは要素を残す（表示だけ切り替える）。
  // 全クリップ常設はメディア要素が増えすぎるので窓で区切る。
  const VC_WINDOW = 2
  const windowVClips = useMemo(
    () =>
      vClips
        .filter(
          (c) =>
            currentTime >= c.tStart - VC_WINDOW &&
            currentTime < c.tStart + Math.max(0.05, c.srcEnd - c.srcStart) + VC_WINDOW
        )
        .slice()
        .sort(
          (a, b) =>
            tracks.findIndex((t) => t.id === b.track) - tracks.findIndex((t) => t.id === a.track)
        ),
    [vClips, currentTime, tracks, VC_WINDOW]
  )
  // 映像レイヤーの <video> 要素（クリップIDごと）。音声もこの要素から鳴らす。
  const vcElsRef = useRef<Map<number, HTMLVideoElement>>(new Map())
  // ref コールバックはクリップIDごとに固定する。毎レンダー新規の無名関数だと React が
  // detach→attach を繰り返し、要素の作り直し（＝先頭フレームのちらつき）を招く。
  const vcRefCbsRef = useRef<Map<number, (el: HTMLVideoElement | null) => void>>(new Map())
  const vcRefCb = (id: number): ((el: HTMLVideoElement | null) => void) => {
    let fn = vcRefCbsRef.current.get(id)
    if (!fn) {
      fn = (el: HTMLVideoElement | null): void => {
        if (el) vcElsRef.current.set(id, el)
        else {
          // 窓から外れて外される瞬間に音が残らないよう、delete の前に止める
          const prev = vcElsRef.current.get(id)
          if (prev && !prev.paused) prev.pause()
          vcElsRef.current.delete(id)
          vcRefCbsRef.current.delete(id)
        }
      }
      vcRefCbsRef.current.set(id, fn)
    }
    return fn
  }
  // 映像レイヤーの追従: 位置合わせ・再生/停止・音量（クリップ音量×トラック×フェード）
  useEffect(() => {
    const rate = playRateRef.current
    vcElsRef.current.forEach((el, id) => {
      const c = vClipsRef.current.find((x) => x.id === id)
      if (!c || !el) return
      const local = currentTime - c.tStart
      const len = Math.max(0.05, c.srcEnd - c.srcStart)
      const inRange = local >= 0 && local < len
      if (!inRange) {
        // 窓に入っているだけ（区間外）の要素は必ず止める。要素は残るのでここが効く
        if (!el.paused) el.pause()
        // 出番前なら頭に置いておく（境界で正しいフレームが即出る）
        if (!el.seeking && local < 0 && Math.abs(el.currentTime - c.srcStart) > 0.3)
          el.currentTime = c.srcStart
        return
      }
      const want = c.srcStart + local
      // シーク中は頼み直さない（着く前に書くと取り消されて、永久に追いつけない）
      if (!el.seeking && Math.abs(el.currentTime - want) > 0.25) el.currentTime = want
      const gain = c.muted ? 0 : (c.vol ?? 1) * vcFadeGain(c, local)
      el.volume = clamp(gain * audioTrackGain('A' + trackNum(c.track)), 0, 1)
      el.muted = !!c.muted
      if (playing && rate === 1) {
        if (el.paused && !el.ended) void el.play().catch(() => {})
      } else if (!el.paused) el.pause()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTime, playing, vClips, trackStates, masterVolume])
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
  // 再生ヘッド位置の切片の回転/反転（CSS transform）。ズーム/トランジションと合成する。
  const curSegXform = (() => {
    const src = tToSource(segLayout, currentTime)
    const seg = src ? segments[src.index] : undefined
    if (!seg) return ''
    const parts: string[] = []
    if (seg.rotate) parts.push(`rotate(${seg.rotate}deg)`)
    if (seg.flipH) parts.push('scaleX(-1)')
    if (seg.flipV) parts.push('scaleY(-1)')
    return parts.join(' ')
  })()
  // 動画ズームのCSS変換（プレビュー用・現切片）。translateはフレーム比→%、原点は中心。
  const videoZoomTransform = isNeutralZoom(curSegZoom)
    ? undefined
    : `translate(${(curSegZoom.x * 100).toFixed(3)}%, ${(curSegZoom.y * 100).toFixed(3)}%) scale(${curSegZoom.scale.toFixed(4)})`
  // 頭/尻トランジションのプレビュー。dip系(fade/黒/白)は色オーバーレイ、slide/wipeは映像自体を動かす。
  // 現在の切片の in/out と再生ヘッド位置から「進捗 p(0..1)」を出す。xfade境界のディップは出さない。
  const inOutPreview = (() => {
    const L = segLayout.find((l) => currentTime >= l.tStart && currentTime < l.tEnd)
    if (!L) return null
    const local = currentTime - L.tStart
    const ti = L.seg.transIn
    const to = L.seg.transOut
    const xfPrev = L.index > 0 ? xfadeDurAt(segLayout, L.index - 1) : 0
    const xfNext = xfadeDurAt(segLayout, L.index)
    if (ti && ti.dur > 0 && local < ti.dur && !xfPrev)
      return { type: ti.type, dir: 'in' as const, p: clamp(local / ti.dur, 0, 1) }
    if (to && to.dur > 0 && local > L.len - to.dur && !xfNext)
      return { type: to.type, dir: 'out' as const, p: clamp((local - (L.len - to.dur)) / to.dur, 0, 1) }
    return null
  })()
  // dip系の色オーバーレイ（頭=色→映像、尻=映像→色）。slide/wipe のときは null（映像側で表現）。
  const transOverlay = (() => {
    if (!inOutPreview) return null
    const col = dipColor(inOutPreview.type)
    if (!col) return null
    // in: p=0で覆い1→p=1で0 / out: p=0で0→p=1で1
    const opacity = inOutPreview.dir === 'in' ? 1 - inOutPreview.p : inOutPreview.p
    return { color: col, opacity }
  })()
  // 頭/尻が slide/wipe のとき、メイン映像に掛けるCSS（回転/反転・ズーム変換と合成）。
  const videoMainStyle = (() => {
    // トランジション（slide/wipe）分の transform / clipPath
    const trans: React.CSSProperties = (() => {
      const base: React.CSSProperties = { transform: videoZoomTransform }
      if (!inOutPreview || dipColor(inOutPreview.type)) return base
      const { type, dir, p } = inOutPreview
      const off = (dir === 'in' ? 1 - p : p) * 100
      const zoom = videoZoomTransform ? ` ${videoZoomTransform}` : ''
      if (type === 'slideleft') return { transform: `translateX(${dir === 'in' ? off : -off}%)${zoom}` }
      if (type === 'slideright') return { transform: `translateX(${dir === 'in' ? -off : off}%)${zoom}` }
      if (type === 'slideup') return { transform: `translateY(${dir === 'in' ? off : -off}%)${zoom}` }
      if (type === 'slidedown') return { transform: `translateY(${dir === 'in' ? -off : off}%)${zoom}` }
      if (type === 'wipeleft') return { transform: videoZoomTransform, clipPath: `inset(0 0 0 ${off}%)` }
      if (type === 'wiperight') return { transform: videoZoomTransform, clipPath: `inset(0 ${off}% 0 0)` }
      return base
    })()
    // 現切片の回転/反転を先頭に合成（＝映像自体を回す/反転させてから、ズーム/スライドを掛ける）
    const tf = [curSegXform, trans.transform].filter(Boolean).join(' ')
    // クロップ（clip-path inset）。wipe中はwipe側のclipPathを優先（trans.clipPathがあればそれを使う）。
    const clip = trans.clipPath ?? curCropInset
    return { ...trans, transform: tf || undefined, clipPath: clip }
  })()

  // クロスディゾルブのプレビュー状態: 再生ヘッドが [カット-d, カット) にいる間、
  // 次クリップ(B)を2本目のvideoでオーバーレイし opacity 0→1 でフェードイン。
  // カット到達後も XF_GRACE 秒だけ B を不透明で保持し、main が B にシークし終わるまで
  // A の最終フレームが素通しでちらつくのを防ぐ（プロキシでもシークは1〜数フレーム遅れる）。
  const xfPreview = (() => {
    if (!videoSrc) return null
    for (let i = 0; i < segLayout.length - 1; i++) {
      const d = xfadeDurAt(segLayout, i)
      if (!d) continue
      const cut = segLayout[i].tEnd
      const B = segLayout[i + 1]
      const sp = segSpeed(B.seg)
      const blank = !!B.seg.videoBlank // 黒ブランクへのディゾルブは黒divのフェードで表現
      const type = segLayout[i].seg.xfade?.type ?? 'fade'
      // マルチソース: B側は自分の元動画のURL/ズームでプレビュー（A側と別ソースでも正しい映像）
      const bs = srcOfSeg(B.seg)
      const bUrl = bs ? previewUrl(bs.path, bs.origUrl) : null
      const bZoom = B.seg.zoom
      if (currentTime >= cut - d && currentTime < cut) {
        // トランジション中: B がソース頭の手前(srcStart - 残り*速度)から先読み。p=進捗0→1。
        return {
          p: clamp(1 - (cut - currentTime) / d, 0, 1),
          type,
          blank,
          srcTime: Math.max(0, B.seg.srcStart - (cut - currentTime) * sp),
          speed: sp,
          bUrl,
          bZoom
        }
      }
      if (currentTime >= cut && currentTime < cut + XF_GRACE) {
        // カット直後の猶予: main が B に追いつくまで B 本編を不透明で保持
        return {
          p: 1,
          type,
          blank,
          srcTime: B.seg.srcStart + (currentTime - cut) * sp,
          speed: sp,
          bUrl,
          bZoom
        }
      }
    }
    return null
  })()
  // 次に来る「間トランジション」のB側ソースURLを先読み（境界の少し前からvideoBへロードしておき、
  // ディゾルブ開始の瞬間にsrc切替リロードのヒッチが出ないようにする）。マルチソース時のみ。
  const xfNextBUrl = (() => {
    if (!videoSrc || sources.length <= 1) return null
    for (let i = 0; i < segLayout.length - 1; i++) {
      const d = xfadeDurAt(segLayout, i)
      if (!d) continue
      const cut = segLayout[i].tEnd
      if (cut + XF_GRACE < currentTime) continue // 既に過ぎた境界
      if (cut - currentTime > 8) break // 8秒より先はまだ読まない
      const bs = srcOfSeg(segLayout[i + 1].seg)
      return bs ? previewUrl(bs.path, bs.origUrl) : null
    }
    return null
  })()
  // 黒/白ディップを「間」に置いたとき、書き出し(fadeblack/fadewhite)に合わせて色に沈んで戻る覆い。
  // 中央(p=0.5)で覆いが最大＝一度色に沈み、B が出てくる。
  const xfDipOverlay = (() => {
    if (!xfPreview || xfPreview.blank) return null
    const col = dipColor(xfPreview.type)
    if (!col) return null
    return { color: col, opacity: 1 - Math.abs(1 - 2 * xfPreview.p) }
  })()

  // 2本目video(videoB)を xfPreview に追従させる（シーク/再生/レート）。ドリフトしたら再シーク。
  useEffect(() => {
    const vb = videoBRef.current
    if (!vb) return
    if (!xfPreview || xfPreview.blank) {
      if (!vb.paused) vb.pause()
      return
    }
    const rate = playRateRef.current
    if (rate > 0) {
      // シーク中は頼み直さない（着く前に書くと取り消されて、永久に追いつけない）
      if (!vb.seeking && Math.abs(vb.currentTime - xfPreview.srcTime) > 0.25)
        vb.currentTime = xfPreview.srcTime
      const r = Math.min(rate * xfPreview.speed, 16)
      if (Math.abs(vb.playbackRate - r) > 1e-3) vb.playbackRate = r
      if (vb.paused && !vb.ended) void vb.play().catch(() => {})
    } else {
      // 停止中/逆再生はフレームシークのみ（スクラブでもディゾルブが見える）
      if (!vb.paused) vb.pause()
      if (Math.abs(vb.currentTime - xfPreview.srcTime) > 0.05) vb.currentTime = xfPreview.srcTime
    }
    // xfPreviewはcurrentTime由来のため毎フレーム評価される。srcTime/blankも依存に入れて、
    // 停止中に間トランジション付与/トリム等で xfPreview が変化した場合も即シーク（古フレーム防止）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTime, videoSrc, xfPreview?.srcTime, xfPreview?.blank])

  // ================= 再生エンジン =================
  // すべての再生は startPlayback / stopPlayback を通す（状態の一元管理）
  function stopPlayback(): void {
    // SEライブラリの試聴音も止める（DOM外のAudioなので放置すると鳴り続ける）
    try {
      sePreviewRef.current?.pause()
    } catch {
      /* noop */
    }
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    // **2枚組なので、映していない面も必ず止める。**
    // 片方だけ止めると、裏の面が鳴り続けたり勝手に進んだりする
    videoElsRef.current.forEach((el) => {
      if (!el.paused) el.pause()
    })
    // 温めてあった面は、止めた時点で当てにできない（位置が変わるため）
    preparedRef.current = null
    const v = videoRef.current
    if (v && !v.paused) v.pause()
    const vb = videoBRef.current
    if (vb && !vb.paused) vb.pause()
    seAudioRefs.current.forEach((a) => {
      if (!a.paused) a.pause()
    })
    playRateRef.current = 0
    setPlaying(false)
    setPlayRateUI(0)
    // 画質スロットルで最終フレームを間引いた場合に備え、停止時は正確な位置へ確実に反映
    setCurrentTime(currentTimeRef.current)
  }

  function startRafClock(rate: number): void {
    lastTsRef.current = performance.now()
    const tick = (ts: number): void => {
      const dt = (ts - lastTsRef.current) / 1000
      lastTsRef.current = ts
      const nt = currentTimeRef.current + rate * dt
      if (rate > 0 && nt >= getPlayEnd()) {
        setTime(getPlayEnd())
        stopPlayback()
        return
      }
      if (rate < 0 && nt <= 0) {
        setTime(0)
        stopPlayback()
        return
      }
      paintTime(nt)
      const v = videoRef.current
      if (v && rate < 0) {
        // 逆再生は paused の動画をセグメント対応でフレームシーク
        const src = tToSource(segLayoutRef.current, nt)
        if (src) v.currentTime = src.srcTime
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }

  // 順再生（壁時計マスター）: 再生ヘッドは実時間で常に一定速度に進め、動画がそれを追いかける。
  // これで動画がカットでシークして一瞬もたついても、再生ヘッドは絶対に止まらない。
  function startVideoSegClock(): void {
    const tick = (): void => {
      const vv = videoRef.current
      if (!vv) {
        stopPlayback()
        return
      }
      const rate = playRateRef.current
      // 壁時計で再生ヘッド位置を算出（動画の状態に一切依存しない）
      const pos =
        clockStartPosRef.current + (performance.now() / 1000 - clockStartWallRef.current) * rate
      if (pos >= getPlayEnd()) {
        setTime(getPlayEnd())
        stopPlayback()
        return
      }
      paintTime(pos) // ← 再生ヘッドは絶対に止めない（画質モードで再描画のみ間引く）
      // 動画を再生ヘッド位置に追従させる（ミュート/不透明度は別の毎レンダー effect が反映）
      const src = tToSource(segLayoutRef.current, pos)
      if (src && pos < videoTLenRef.current - 1e-3) {
        // **切片が変わったか**で扱いを変える（下の追従を参照）。
        // 変わった＝カット（飛び先が違う）、変わらない＝ただのズレ。
        const segChanged = currentSegRef.current !== src.index
        currentSegRef.current = src.index
        // 大きくズレたら（＝不連続カットをまたいだ／ドリフト）シークで追いつく。プロキシなら一瞬。
        // ---- カットに来た: 温めてある面があれば「入れ替えるだけ」で済む ----
        const prep = preparedRef.current
        const curSrcId = srcOfSeg(src ? segLayoutRef.current[src.index]?.seg : undefined)?.id
        if (prep && prep.segIdx === src.index && curSrcId === prep.srcId) {
          const pre = videoElsRef.current.get(elKey(prep.srcId, prep.half))
          if (pre) {
            // **待ち時間ゼロの切り替え。** 飛び先はすでに復号済み
            perf.mark('カット: 温めてあった面へ入れ替え')
            // **音量は必ず引き継ぐ。**
            // 音量を決める effect は「いま表になっている要素」にしか書かない。
            // 温めてある面は触られていないので、既定の 1.0（最大）のまま。
            // そこへ入れ替えると、次の描画で直るまでの数十msだけ**全開で鳴る**。
            // 最初のカットで「ホワイトノイズが荒くなる」と言われたのがこれ。
            // 2回目以降が平気なのは、一度表に出た面が正しい音量を持ち越すため。
            //
            // 出ていく面の値をそのまま渡す。切片ごとの音量は次の描画で入るが、
            // **大きすぎる側へは絶対に振れない**ので、こちらの向きで間違える方が安全。
            // **muted は触らない。** 触ると時計が張り替わって250ms止まる
            //（生の推移で 7.882 のまま6コマ。詳しくは音量 effect の説明）
            // **音は一瞬で切り替えず、40msだけ重ねる。**
            // 別々の音の流れを継ぎ目でぶつ切りにすると、波形が飛んで「プツ」と鳴る。
            // 助走のおかげでカットの時点では両面とも走っているので、
            // 出ていく側を下げながら入ってくる側を上げれば、継ぎ目が消える。
            // 同じ素材の中のカットなので、短く重ねても音は濁らない。
            const XFADE_MS = 40
            const leaving = vv
            const target = vv.volume
            pre.volume = 0
            xfadeUntilRef.current = performance.now() + XFADE_MS // この間は音量 effect を黙らせる
            const t0 = performance.now()
            const ramp = (): void => {
              const k = Math.min(1, (performance.now() - t0) / XFADE_MS)
              pre.volume = clamp(target * k, 0, 1)
              leaving.volume = clamp(target * (1 - k), 0, 1)
              if (k < 1) requestAnimationFrame(ramp)
              else if (videoRef.current !== leaving && !leaving.paused) leaving.pause()
            }
            requestAnimationFrame(ramp)
            pre.playbackRate = vv.playbackRate
            videoRef.current = pre
            setActiveHalf((h) => ({ ...h, [prep.srcId]: prep.half }))
            preparedRef.current = null
            if (pre.paused && !pre.ended) void pre.play().catch(() => {})
            rafRef.current = requestAnimationFrame(tick)
            return // 入れ替えた面は次のコマから面倒を見る
          }
        }
        // ---- 追従: 「飛ぶ」のと「ズレを詰める」のは別物 ----
        //
        // **ズレを頭出しで直してはいけない。** currentTime を書くと復号がやり直しになり、
        // 絵が再び動き出すまで待たされる。1080p の実測で約230ms。閾値の0.25秒とほぼ同じ
        // なので、再開した直後にまた0.25秒ズレて、また頭出し——**永久に噛み合わない**。
        //
        // 実測（本物のプロジェクト・切片51・テロップ23、npm run stutter）:
        //   1080p  頭出し 38回/10秒  絵の止まり 6800/9750ms  速さ0.98倍
        //   生の推移 … 2.302 2.302 2.302 2.557 2.570 2.573 2.573 2.573 2.825
        //              ＝再生しているのに進まず、0.25秒ごとに階段状に飛んでいた
        // 720p は同じ作りでも頭出し1回・止まり0ms。違いは復号の重さだけで、
        // **重い素材ほど悪くなる**——直しようが「もっと軽い画質を選べ」しか無くなる。
        //
        // なので:
        //   カット（切片が変わった）… 飛び先が違うのだから頭出しするしかない
        //   ただのズレ（同じ切片）  … **速さを少しいじって詰める**。復号は途切れない
        //
        // 速さで詰めるのは動画プレイヤーが昔からやっている手で、±10%なら見ても
        // 聞いても分からない（音の高さは preservesPitch が既定で保たれる）。
        // 0.25秒のズレなら2.5秒で消える。その間ずっと絵は流れ続ける。
        const drift = src.srcTime - vv.currentTime // ＋なら動画が遅れている
        // **これが「テロップだけ先に動く」の正体になり得る。**
        // 文字は再生ヘッドの時刻で動き、動画はここで追いかけている。
        // 遅れが残っていれば、絵に対して文字が先行して見える。記録に残して数で見る。
        perf.reportLag(drift)
        const now = performance.now()
        // **シーク中は重ねて頼まない（vv.seeking）。**
        // ここは毎コマ（秒60回）通る。前のシークが着く前にもう一度 currentTime を
        // 書くと、前の依頼が取り消されて最初からやり直しになる。
        if (!vv.seeking && now >= seekCooldownRef.current && Math.abs(drift) > 0.25) {
          // 同じ切片のままの大ズレは、詰めきれないほど離れてしまった時だけ（頭出し直後など）。
          // ここを緩めると上のループが戻ってくるので、しきい値は大きく取る。
          const mustJump = segChanged || Math.abs(drift) > 1.5
          if (mustJump) {
            const t0 = now
            vv.addEventListener(
              'seeked',
              () => {
                const took = Math.round(performance.now() - t0)
                perf.mark(`カットでシーク ${took}ms`)
                // **着いた時間ではなく「また流れ出すまで」を待つ。**
                // 全コマがキーフレームだと着くのは数msだが、絵が動き出すのはその後。
                seekCooldownRef.current = performance.now() + Math.max(400, took * 3)
              },
              { once: true } // 着いたら自分で外れる（毎コマ足していた頃は積み上がっていた）
            )
            seekCooldownRef.current = now + 400
            vv.currentTime = src.srcTime
          }
        }

        // ---- 次のカットを先に温める ----
        //
        // 飛び先を**再生しながら裏で用意しておく**。カットに来たときには
        // すでに復号が済んでいるので、表示を入れ替えるだけで待ちが出ない。
        // 画質に関係なく効く（復号の速さに頼っていないため）。
        const AHEAD = 1.2 // 何秒前から用意するか。実測の待ち(最大235ms)に十分な余裕
        // 何秒前から裏で走らせておくか。立ち上げの実測(約300ms)より少し長く取る。
        // 長くすると2枚同時に復号する時間が延びるので、余裕は最小限にする。
        const PREROLL = 0.45
        // **狙うのは「次の切片」そのもの。**
        // 「1.2秒先の位置」を見るやり方だと、切片が1.2秒より短いときに
        // その次を飛び越して先の切片を温めてしまう。手前のカットは用意が無いので
        // シークになり、その直後に「1つ先ぶんの入れ替え」が起きる——
        // 実測の並び（シーク138ms → 0.2秒後に入れ替え）がまさにこれだった。
        const nextIdx = src.index + 1
        const nseg = segLayoutRef.current[nextIdx]
        if (nseg && nseg.tStart > pos && nseg.tStart - pos <= AHEAD * Math.max(1, rate)) {
          const nsrcId = srcOfSeg(nseg.seg)?.id
          // 別のソースへ移るカットは、元から専用の仕組みが用意してある（要素が別なので待ちが無い）。
          // ここで面倒を見るのは**同じファイルの中のカット**だけ。
          if (nsrcId != null && nsrcId === curSrcId) {
            const half = (halfOf(nsrcId) === 0 ? 1 : 0) as 0 | 1
            const pre = videoElsRef.current.get(elKey(nsrcId, half))
            const dt = (nseg.tStart - pos) / Math.max(0.01, rate) // カットまで何秒か
            if (pre && preparedRef.current?.segIdx !== nextIdx) {
              preparedRef.current = { segIdx: nextIdx, srcId: nsrcId, half }
              pre.volume = 0
              if (!pre.paused) pre.pause()
              // 飛び先＝次の切片の頭。ここを先に出しておく
              if (Math.abs(pre.currentTime - nseg.seg.srcStart) > 0.05)
                pre.currentTime = nseg.seg.srcStart
            } else if (pre && pre.paused && dt <= PREROLL && dt > 0.02 && !pre.seeking) {
              // ---- 助走 ----
              //
              // **止めてある面は、入れ替えた瞬間には流れ出せない。**
              // 絵（1コマ）は用意できていても、play() から実際に進み始めるまで
              // 復号の立ち上げが要る。1080p の実測で約300ms——カットのたびに
              // そこだけ止まって見えていた（生の推移で 7.929 → 8.026 と進まない）。
              //
              // 実測（本物のプロジェクト・1080p・15秒）:
              //   止まった所: 5.4秒に300ms / 8.8秒に300ms / 12.6秒に250ms ＝ちょうどカット3回
              //
              // なので**カットの少し前から、無音・裏で走らせておく**。
              // 入れ替えたときには既に流れているので、立ち上げを待たない。
              // 走らせ始める位置は「カットまでの残り時間ぶん手前」。こうすると
              // カットの瞬間にちょうど切片の頭へ着く。
              const sp = nseg.seg.speed ?? 1
              const want = Math.max(0, nseg.seg.srcStart - dt * sp)
              if (Math.abs(pre.currentTime - want) > 0.05) pre.currentTime = want
              pre.volume = 0 // 裏の音は絶対に出さない（muted は使わない＝時計を張り替えない）
              pre.playbackRate = Math.min(rate * sp, 16)
              void pre.play().catch(() => {})
            }
          }
        }
        // ended のまま play() すると先頭から再生し直してしまうため除外（シーク後は ended が解除される）
        if (vv.paused && !vv.ended) void vv.play().catch(() => {})
        // 再生ヘッドの進む速さ(rate) × 切片の速度。動画側はこの実効レートで追従。
        //
        // ここに**ズレを詰める補正**を上乗せする（上の説明の通り、頭出しの代わり）。
        // 遅れていれば少し速く、進みすぎていれば少し遅く。±10%まで。
        // 小さすぎるズレは触らない——毎コマ速さを書き換えると、かえって揺れる。
        // 入るのは大きくズレた時だけ。出るのはほぼ0に戻ってから（履歴＝上の ref 参照）。
        // 幅も小さく取る。カットで止まらなくなった今、ズレはそもそも溜まらない。
        if (fixingDriftRef.current) {
          if (Math.abs(drift) < 0.02) fixingDriftRef.current = false
        } else if (Math.abs(drift) > 0.1) {
          fixingDriftRef.current = true
        }
        const corr = fixingDriftRef.current
          ? Math.max(-0.03, Math.min(0.03, drift * 0.25))
          : 0
        const r = Math.min(rate * src.speed * (1 + corr), 16)
        if (Math.abs(vv.playbackRate - r) > 5e-3) vv.playbackRate = r
      } else if (!vv.paused) {
        // 動画尾部より先（テロップのみ区間）→ 動画は止めて再生ヘッドだけ進める
        vv.pause()
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }

  // 順再生（動画駆動）中も rAF で毎フレーム再生ヘッドを同期する
  // （video の timeupdate は約4Hzしか発火せず、テロップの出入りが最大250msズレるため）
  function startVideoClock(): void {
    let started = false // play() は非同期なので、実際に再生が始まるまでは paused を停止扱いしない
    const tick = (): void => {
      const v = videoRef.current
      if (!v) {
        stopPlayback()
        return
      }
      if (!v.paused) started = true
      else if (started && !v.ended) {
        // 再生開始後に予期せず止まった（デコードエラー等）→ 状態を破綻させない
        stopPlayback()
        return
      }
      setTime(v.currentTime)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }

  function startPlayback(rate: number): void {
    preparedRef.current = null // 前の再生で温めた面は、位置が変わっているので捨てる
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    const v = videoRef.current
    if (v && !v.paused) v.pause()
    let t = currentTimeRef.current
    if (rate > 0 && t >= getPlayEnd() - 0.01) {
      t = 0
      setTime(0)
    }
    // 壁時計の基準をセット（この時刻・位置から一定速度で再生ヘッドを進める）
    clockStartPosRef.current = t
    clockStartWallRef.current = performance.now() / 1000
    playRateRef.current = rate
    setPlaying(true)
    setPlayRateUI(rate)
    if (v && rate > 0) {
      const src = tToSource(segLayoutRef.current, t)
      if (src && videoDurationRef.current > 0 && t < videoTLenRef.current - 1e-3) {
        currentSegRef.current = src.index
        // すでにヘッド位置にいれば再シークしない（毎回の再生開始で一拍待たされるのを防ぐ）
        if (Math.abs(v.currentTime - src.srcTime) > 0.05) v.currentTime = src.srcTime
        v.playbackRate = Math.min(rate * src.speed, 16)
        v.play().catch(() => stopPlayback())
        startVideoSegClock() // 壁時計マスターで再生ヘッドを流す（動画は追従）
        return
      }
      if (segLayoutRef.current.length === 0 && videoDurationRef.current === 0) {
        // metadata 未取得 → 素直にネイティブ再生
        v.currentTime = t
        v.playbackRate = Math.min(rate, 8)
        v.play().catch(() => stopPlayback())
        startVideoClock()
        return
      }
    }
    // 逆再生 / 動画の先（テロップのみ区間）/ 動画なし → rAF クロック
    startRafClock(rate)
  }

  function togglePlay(): void {
    if (playRateRef.current !== 0) stopPlayback()
    else startPlayback(1)
  }

  // JKL シャトル（プレミア準拠: L 順方向を押すたび倍速、J 逆方向、K 停止）
  function shuttleForward(): void {
    startPlayback(playRateRef.current > 0 ? Math.min(playRateRef.current * 2, 8) : 1)
  }
  function shuttleReverse(): void {
    startPlayback(playRateRef.current < 0 ? Math.max(playRateRef.current * 2, -8) : -1)
  }

  // 動画のソース終端に達した場合の保険。
  // 壁時計マスター（切片あり）では tick が終端を管理するので何もしない
  // （ここでヘッドを動かすと再生ヘッドが末尾へテレポートするバグになる）。
  function handleVideoEnded(): void {
    if (segLayoutRef.current.length === 0) stopPlayback() // metadata未取得のネイティブ再生のみ
  }

  function seekTo(t: number): void {
    const nt = clamp(t, 0, durationRef.current)
    setTime(nt)
    const v = videoRef.current
    if (v && playRateRef.current <= 0) {
      const src = tToSource(segLayoutRef.current, nt)
      if (src) {
        v.currentTime = src.srcTime
        currentSegRef.current = src.index
      } else {
        currentSegRef.current = Math.max(0, segLayoutRef.current.length - 1)
      }
    }
  }
  // クロスディゾルブ/スライド/ワイプの videoB 見た目を type と進捗 p から作る。
  // fade=opacity、slide=translate、wipe=clip-path。ズーム変換と合成する。
  function xfBStyle(xf: {
    p: number
    type: string
    bZoom?: { scale: number; x: number; y: number }
  }): React.CSSProperties {
    const p = xf.p
    const off = ((1 - p) * 100).toFixed(2)
    // B側は「B切片自身のズーム」を使う（A側のズームを誤って適用しない）
    const bz =
      xf.bZoom && !isNeutralZoom(xf.bZoom)
        ? `translate(${(xf.bZoom.x * 100).toFixed(3)}%, ${(xf.bZoom.y * 100).toFixed(3)}%) scale(${xf.bZoom.scale.toFixed(4)})`
        : undefined
    const zoom = bz ? ` ${bz}` : ''
    switch (xf.type) {
      case 'slideleft':
        return { opacity: 1, transform: `translateX(${off}%)${zoom}` } // Bは右から入る
      case 'slideright':
        return { opacity: 1, transform: `translateX(-${off}%)${zoom}` } // 左から
      case 'slideup':
        return { opacity: 1, transform: `translateY(${off}%)${zoom}` } // 下から
      case 'slidedown':
        return { opacity: 1, transform: `translateY(-${off}%)${zoom}` } // 上から
      case 'wipeleft':
        return { opacity: 1, transform: bz, clipPath: `inset(0 0 0 ${off}%)` }
      case 'wiperight':
        return { opacity: 1, transform: bz, clipPath: `inset(0 ${off}% 0 0)` }
      default:
        return { opacity: p, transform: bz } // fade（クロスディゾルブ）
    }
  }
  // 再生ヘッド位置の切片IDを取得（リフレーム/ズームの編集対象）
  function curSegId(): number | null {
    const src = tToSource(segLayoutRef.current, currentTimeRef.current)
    return src ? (segLayoutRef.current[src.index]?.seg.id ?? null) : null
  }
  // リフレーム操作: corner=null で本体ドラッグ=パン、cornerあり=四隅ドラッグで拡大縮小（中心基準）。
  // 対象は「画像を選択中なら画像、それ以外は再生ヘッド位置の動画切片」（reframeTarget）。
  //
  // override: プレビュー上の画像／映像レイヤーを直接掴んだときの対象。選択の state 更新は
  // 次の描画までは reframeTargetRef に反映されないので、掴んだ瞬間に対象を渡す必要がある
  // （渡さないと「押した画像ではなく下の動画が動く」ことになる）。
  function onVideoReframeStart(
    e: React.PointerEvent,
    corner: number | null,
    override?: ReframeTarget
  ): void {
    if (e.button !== 0) return
    const tgt = override ?? reframeTargetRef.current
    if (!tgt) return
    if (tgt.kind === 'video' ? trackStates['V1']?.locked : trackStates[tgt.track]?.locked) return
    e.stopPropagation()
    e.preventDefault()
    const rect = screenRef.current?.getBoundingClientRect()
    if (!rect) return
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    // 動きが付いている項目は、固定値ではなく**その時刻の印**を動かす。
    // 固定値の方を触ると、打った印はそのままなので「掴んだのに動かない」ことになる。
    // 掴み始めの値も、いま画面に出ている値（＝印を反映した値）から取る。
    const m = tgt.motion
    const clipT = clamp(currentTimeRef.current - tgt.tStart, 0, Math.max(0, tgt.len))
    const start = zoomAt(tgt.zoom, m, clipT)
    const setFixed = (z: { scale: number; x: number; y: number }): void =>
      tgt.kind === 'video'
        ? setSegZoom(tgt.id, z)
        : tgt.kind === 'vclip'
          ? setVClipZoom(tgt.id, z)
          : setImgZoom(tgt.id, z)
    const apply = (z: { scale: number; x: number; y: number }): void => {
      const fixed = { ...z }
      if (hasKeys(m?.sc)) {
        const v = Math.max(MIN_MOTION_SCALE, z.scale)
        patchClipMotion(tgt.kind, tgt.id, 'sc', (k) => putKey(k, clipT, v))
        fixed.scale = tgt.zoom.scale
      }
      if (hasKeys(m?.x)) {
        patchClipMotion(tgt.kind, tgt.id, 'x', (k) => putKey(k, clipT, z.x))
        fixed.x = tgt.zoom.x
      }
      if (hasKeys(m?.y)) {
        patchClipMotion(tgt.kind, tgt.id, 'y', (k) => putKey(k, clipT, z.y))
        fixed.y = tgt.zoom.y
      }
      // 印で受けた項目しか無ければ、固定値は触らない（触ると履歴が二重に積まれる）
      if (
        fixed.scale !== tgt.zoom.scale ||
        fixed.x !== tgt.zoom.x ||
        fixed.y !== tgt.zoom.y
      )
        setFixed(fixed)
    }
    const sx = e.clientX
    const sy = e.clientY
    const startDist = Math.max(1, Math.hypot(e.clientX - cx, e.clientY - cy))

    // **選んである物は一緒に動かす。**
    // 掴んだ物のほかに選択中の画像・映像レイヤー・切片があれば、同じだけずらす。
    // ずらす量だけを配るので、それぞれの元の位置関係は崩れない。
    // ※動かすときだけ。**拡大は掴んだ物だけ**にする（まとめて拡大は、
    //   基準点がそれぞれ違うので、揃えたつもりがばらばらに飛ぶ）。
    type Mover = {
      kind: 'video' | 'vclip' | 'img'
      id: number
      base: { scale: number; x: number; y: number }
      motion?: ClipMotion
      clipT: number
    }
    const others: Mover[] = []
    if (corner == null) {
      const same = (k: string, i: number): boolean => k === tgt.kind && i === tgt.id
      const localT = (start: number, len: number): number =>
        clamp(currentTimeRef.current - start, 0, Math.max(0, len))
      for (const c of imgClips) {
        if (!selectedImgIds.includes(c.id) || same('img', c.id)) continue
        if (trackStates[c.track]?.locked) continue
        const ct = localT(c.tStart, c.duration)
        others.push({
          kind: 'img',
          id: c.id,
          base: zoomAt(c.zoom ?? DEFAULT_ZOOM, c.motion, ct),
          motion: c.motion,
          clipT: ct
        })
      }
      for (const c of vClips) {
        if (!selectedVClipIds.includes(c.id) || same('vclip', c.id)) continue
        if (trackStates[c.track]?.locked) continue
        const ct = localT(c.tStart, vcLen(c))
        others.push({
          kind: 'vclip',
          id: c.id,
          base: zoomAt(c.zoom ?? DEFAULT_ZOOM, c.motion, ct),
          motion: c.motion,
          clipT: ct
        })
      }
      if (!trackStates['V1']?.locked) {
        for (const L of segLayout) {
          if (!selectedVideoIds.includes(L.seg.id) || same('video', L.seg.id)) continue
          const ct = localT(L.tStart, L.len)
          others.push({
            kind: 'video',
            id: L.seg.id,
            base: zoomAt(L.seg.zoom ?? DEFAULT_ZOOM, L.seg.motion, ct),
            motion: L.seg.motion,
            clipT: ct
          })
        }
      }
    }
    /** 一緒に動かす物へ、同じズレを配る */
    const moveOthers = (dx: number, dy: number): void => {
      for (const o of others) {
        const nx = clamp(o.base.x + dx, -10, 10)
        const ny = clamp(o.base.y + dy, -10, 10)
        // 印が付いている項目は印を、付いていなければ固定値を動かす（掴んだ物と同じ扱い）
        const fixed = { ...o.base }
        if (hasKeys(o.motion?.x)) patchClipMotion(o.kind, o.id, 'x', (k) => putKey(k, o.clipT, nx))
        else fixed.x = nx
        if (hasKeys(o.motion?.y)) patchClipMotion(o.kind, o.id, 'y', (k) => putKey(k, o.clipT, ny))
        else fixed.y = ny
        if (fixed.x !== o.base.x || fixed.y !== o.base.y) {
          if (o.kind === 'video') setSegZoom(o.id, fixed)
          else if (o.kind === 'vclip') setVClipZoom(o.id, fixed)
          else setImgZoom(o.id, fixed)
        }
      }
    }

    const onMove = (ev: PointerEvent): void => {
      if (corner != null) {
        const dist = Math.hypot(ev.clientX - cx, ev.clientY - cy)
        apply({ ...start, scale: clamp(start.scale * (dist / startDist), 0.2, 8) })
      } else {
        // **枠の外まで自由に持っていける**（プレミアと同じ）。
        // 以前はフレーム1つぶん（±1）で頭打ちにしていたため、画面の外へ
        // 送り出す動きが作れなかった。9:16 では枠が狭いぶん特に効いて、
        // 「クロップしても外に出せない」状態になっていた。
        //
        // 上限を残しているのは、掴み損ねて何万倍も飛ばしたときに戻れなくなるのを
        // 避けるためだけ（フレーム10個ぶんあれば、送り出す演出には十分足りる）。
        const dx = (ev.clientX - sx) / rect.width
        const dy = (ev.clientY - sy) / rect.height
        apply({
          ...start,
          x: clamp(start.x + dx, -10, 10),
          y: clamp(start.y + dy, -10, 10)
        })
        if (others.length) moveOthers(dx, dy)
      }
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }
  /**
   * プレビュー上の画像／映像レイヤーを直接掴む。
   *
   * 以前はこれらが pointer-events: none で、画面に出ている画像を押しても
   * クリックが下の動画へ抜け、動画のパンが始まるだけだった（画像に触れなかった）。
   * 押した本人を選択してから、その対象でリフレームのドラッグを始める。
   */
  function selectPreviewOverlay(
    e: React.PointerEvent,
    o: { kind: 'img'; clip: ImgClip } | { kind: 'vclip'; clip: VClip }
  ): void {
    if (e.button !== 0) return
    if (trackStates[o.clip.track]?.locked) {
      showToast('このトラックはロックされています。')
      return
    }
    e.stopPropagation()
    // 他の選択を解除してから自分を選ぶ（Delete の行き先が曖昧にならないように）
    clearAllSelections()
    setVideoSelected(false)
    const tgt: ReframeTarget = {
      kind: o.kind,
      id: o.clip.id,
      zoom: o.clip.zoom ?? DEFAULT_ZOOM,
      rotate: o.clip.rotate ?? 0,
      track: o.clip.track,
      name: o.clip.name,
      motion: o.clip.motion,
      tStart: o.clip.tStart,
      len: o.kind === 'img' ? o.clip.duration : vcLen(o.clip)
    }
    if (o.kind === 'img') setSelectedImgIds([o.clip.id])
    else setSelectedVClipIds([o.clip.id])
    // 選択の state はまだ反映されていないので、対象を明示的に渡す
    onVideoReframeStart(e, null, tgt)
  }
  /**
   * リフレームのリセット。
   *
   * **選んでいる物すべてに効く。** 大きさや位置を変えるときは選択中の全部に
   * 効くのに、戻すときだけ1つずつでは対で使えない。
   *
   * **打った動きも一緒に消す。** 拡大だけ等倍に戻しても、印が残っていれば
   * 再生した瞬間にまた動きだす＝「戻っていない」ように見える。
   * 戻すというからには、その場で見えている状態を作っている物を全部外す。
   */
  function resetVideoZoom(): void {
    const tgt = reframeTargetRef.current
    if (!tgt) return
    // 選んでいなければ、いま触っている1つだけが対象
    const vids = selectedVideoIds.length
      ? selectedVideoIds
      : tgt.kind === 'video'
        ? [tgt.id]
        : []
    const imgs = selectedImgIds.length ? selectedImgIds : tgt.kind === 'img' ? [tgt.id] : []
    const vcs = selectedVClipIds.length ? selectedVClipIds : tgt.kind === 'vclip' ? [tgt.id] : []
    if (vids.length && !trackStates['V1']?.locked)
      setSegments((prev) =>
        prev.map((s) => (vids.includes(s.id) ? { ...s, zoom: undefined, motion: undefined } : s))
      )
    if (imgs.length)
      setImgClips((prev) =>
        prev.map((c) =>
          imgs.includes(c.id) && !trackStates[c.track]?.locked
            ? { ...c, zoom: undefined, motion: undefined }
            : c
        )
      )
    if (vcs.length)
      setVClips((prev) =>
        prev.map((c) =>
          vcs.includes(c.id) && !trackStates[c.track]?.locked
            ? { ...c, zoom: undefined, motion: undefined }
            : c
        )
      )
  }
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
  // プレビューでリフレーム対象を自由回転（回転ハンドルのドラッグ）。Shiftで15°スナップ。
  function onVideoRotateStart(e: React.PointerEvent): void {
    if (e.button !== 0) return
    const tgt = reframeTargetRef.current
    if (!tgt) return
    if (tgt.kind === 'video' ? trackStates['V1']?.locked : trackStates[tgt.track]?.locked) return
    e.stopPropagation()
    e.preventDefault()
    const rect = screenRef.current?.getBoundingClientRect()
    if (!rect) return
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    const startRot = tgt.rotate
    const startAngle = (Math.atan2(e.clientY - cy, e.clientX - cx) * 180) / Math.PI
    const onMove = (ev: PointerEvent): void => {
      const a = (Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180) / Math.PI
      let deg = startRot + (a - startAngle)
      if (ev.shiftKey) deg = Math.round(deg / 15) * 15
      const d = ((Math.round(deg) % 360) + 360) % 360
      if (tgt.kind === 'video') setSegRotate(tgt.id, deg)
      else if (tgt.kind === 'vclip')
        setVClips((prev) =>
          prev.map((c) => (c.id === tgt.id ? { ...c, rotate: d === 0 ? undefined : d } : c))
        )
      else
        setImgClips((prev) =>
          prev.map((c) => (c.id === tgt.id ? { ...c, rotate: d === 0 ? undefined : d } : c))
        )
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }
  // 再生ヘッドを指定秒だけ移動（±5/±10 秒送り戻し）。再生中は止めてから。
  // ※飛ばす操作は**すべてタイムライン側も追従させる**。
  // バーだけ連動して、ボタンだと付いてこない、という食い違いが一番読みにくい。
  function skipSec(sec: number): void {
    stopPlayback()
    seekAndReveal(currentTimeRef.current + sec)
  }
  // 1フレーム単位で移動（フレームグリッドに量子化）。
  function stepFrame(frames: number): void {
    stopPlayback()
    seekAndReveal(qFrame(currentTimeRef.current, fpsRef.current) + frames / fpsRef.current)
  }
  // 現在のプレビュー画面（動画フレーム＋テロップ＋ズーム）を PNG で保存。
  // 表示中と同じプロキシ映像を出力解像度で描き、テロップは書き出しと同じ rasterize を再利用。
  async function captureScreenshot(): Promise<void> {
    const v = videoRef.current
    if (!videoSrc || !v) {
      showToast('先に動画を読み込んでください。\n右の「プロジェクト」タブ →「＋ファイル追加」から追加できます。')
      return
    }
    const size =
      ratio === '16:9'
        ? { width: 1920, height: 1080 }
        : ratio === '9:16'
          ? { width: 1080, height: 1920 }
          : { width: 1080, height: 1080 }
    const canvas = document.createElement('canvas')
    canvas.width = size.width
    canvas.height = size.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    // 背景（動画が透明/レターボックスの部分）は黒で塗る
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, size.width, size.height)
    // 動画フレームをズーム変換込みで contain 描画（プレビューの transform と一致）
    const blank = curBlank || v1Hidden || (videoTLen > 0 && currentTimeRef.current >= videoTLen - 1e-3)
    const shotZoom = curSegZoom
    if (!blank && v.videoWidth > 0) {
      ctx.save()
      ctx.translate(shotZoom.x * size.width, shotZoom.y * size.height)
      ctx.translate(size.width / 2, size.height / 2)
      ctx.scale(shotZoom.scale, shotZoom.scale)
      ctx.translate(-size.width / 2, -size.height / 2)
      const r = Math.min(size.width / v.videoWidth, size.height / v.videoHeight)
      const dw = v.videoWidth * r
      const dh = v.videoHeight * r
      ctx.drawImage(v, (size.width - dw) / 2, (size.height - dh) / 2, dw, dh)
      ctx.restore()
    }
    // テロップ（👁表示中のみ）を書き出しと同じ描画で重ねる
    const t = currentTimeRef.current
    const shown = cues.filter(
      (c) => !trackStates[cueTrack(c)]?.hidden && t >= c.start && t < c.end
    )
    for (const c of shown) {
      const avatar = iconForCue(c)
      const asc = avatar ? iconScale : 1
      const st = telopStateAt(c.style.anim, c.motion, t - c.start, c.end - c.start)
      const png = await renderCueToPng(
        c, size.width, size.height, avatar, asc, st, iconSide, iconOffset.x, iconOffset.y, iconAuto
      )
      await new Promise<void>((res) => {
        const img = new Image()
        img.onload = () => {
          ctx.drawImage(img, 0, 0, size.width, size.height)
          res()
        }
        img.onerror = () => res()
        img.src = png
      })
    }
    const dataUrl = canvas.toDataURL('image/png')
    const r = await window.giftcut.saveImage(dataUrl)
    if (r?.ok && r.path) showToast('スクショを保存しました:\n' + r.path, 'success')
    else if (r?.error && r.error !== 'キャンセル') showToast('保存失敗: ' + r.error, 'error')
  }


  // 動画をプロジェクト（メディアビン）に貯める。タイムラインには即反映しない。
  // ＝2本目以降が勝手に末尾へ足されないように。配置はビンからタイムラインへドラッグする。
  async function handleOpenVideo(): Promise<void> {
    const res = await window.giftcut.openVideo()
    if (!res) return
    const had = !!videoPath
    addMediaPaths([res.path])
    if (had)
      showToast(
        'プロジェクトに追加しました。タイムラインへドラッグして配置してください。',
        'success'
      )
  }
  // 現在の動画を差し替える（タイムラインのカットは作り直しになるので確認する）
  async function handleReplaceVideo(): Promise<void> {
    const res = await window.giftcut.openVideo()
    if (!res) return
    if (segsRef.current.length > 0) {
      const okToGo = await askConfirm({
        title: '現在のカットを破棄して動画を差し替えます',
        body: 'タイムラインの動画クリップは作り直しになります。テロップ・SE・画像・マーカーはそのまま残ります。',
        okLabel: '差し替える',
        danger: true
      })
      if (!okToGo) return
    }
    void loadVideo(res.path)
  }

  // 別の動画をタイムライン末尾に丸ごと連結（ファイルメニュー用）
  async function appendVideo(path: string): Promise<void> {
    if (!sourcesRef.current.length) {
      void loadVideo(path) // まだ何も読み込んでいなければ通常ロード（主ソース化）
      return
    }
    const reg = await registerSource(path)
    if (!reg) return
    const segId = segIdCounter.current++ // 採番はupdaterの外（StrictModeの二重実行対策）
    setSegments((prev) => [...prev, { id: segId, srcId: reg.id, srcStart: 0, srcEnd: reg.dur }])
    showToast(`「${path.split(/[\\/]/).pop()}」をタイムライン末尾に追加しました。`, 'success')
  }
  async function handleAppendVideo(): Promise<void> {
    const res = await window.giftcut.openVideo()
    if (res) void appendVideo(res.path)
  }

  // タイムライン範囲 [tA, tB) を切り出して除去した切片配列を返す（プレミアの「上書き」の下ごしらえ）。
  // 端にかかる切片は速度を考慮してトリムし、insertAt = 新クリップを挿す位置（配列index）を返す。
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
  function cutRangeFromSegs(segs: VSeg[], tA: number, tB: number): { out: VSeg[]; insertAt: number } {
    return cutRange(segs, tA, tB, segSplit)
  }
  /**
   * 本編の切片をドラッグで動かしたときの確定処理（プレミア準拠）。
   *
   * - move  : 置き先を上書きし、元の位置は空白になる。他のクリップの位置は動かない。
   * - copy  : Alt。元はその場に残し、複製を置き先へ上書き配置する。
   * - insert: Ctrl。元の位置を詰めてから置き先で割り込む。後続はテロップ/SE/
   *           マーカー/画像ごと後ろへずれる。
   *
   * 位置の計算そのものは shared/timeline 側（moveSegTo）。
   */
  function moveSegmentTo(
    segId: number,
    t: number,
    mode: SegDropMode = 'move',
    alsoIds: number[] = []
  ): void {
    if (mainLocked()) return
    const segs = segsRef.current
    const idx = segs.findIndex((s) => s.id === segId)
    if (idx < 0) return
    const L = layoutSegs(segs)[idx]
    if (!L) return
    const tt = Math.max(0, t)
    // 複数の切片を選んで掴んだ場合は、相対位置を保ったまままとめて動かす。
    // 複製・割り込みは「1本を差し込む」操作なので、掴んだ1本だけを対象にする。
    const groupIdx = [...new Set([segId, ...alsoIds])]
      .map((id) => segs.findIndex((s) => s.id === id))
      .filter((i) => i >= 0)
    if (mode === 'move' && groupIdx.length > 1) {
      const out = moveSegsTo(segs, groupIdx, tt - L.tStart, segOps)
      if (out === segs) return
      setSegments(out)
      showToast(`${groupIdx.length} 個のクリップを移動しました。`, 'success')
      return
    }
    if (mode === 'copy') {
      placeSegAt({ ...L.seg, id: segIdCounter.current++ }, tt, false)
      return
    }
    if (mode === 'insert') {
      // 元の位置を詰める（後続のテロップ/SE/マーカー/画像も一緒に前へ）。
      // 詰めたぶん、元より後ろへ置く場合は目標位置も同じだけ手前に寄る。
      const target = tt > L.tStart ? Math.max(0, tt - L.len) : tt
      const rest = segs.filter((_, i) => i !== idx)
      shiftAfter(L.tEnd, -L.len)
      setSegments(rest)
      segsRef.current = rest // placeSegAt は segsRef を見るので先に反映させる
      placeSegAt(L.seg, target, true)
      return
    }
    const out = moveSegTo(segs, idx, tt, segOps)
    if (out === segs) return // 動いていない＝履歴を汚さない
    setSegments(out)
  }
  // 新しい切片をタイムライン位置 t へ配置（プレミア準拠）。
  // 既定=上書き: [t, t+len) の既存内容を置き換え、後続クリップの位置は変えない。
  // insert=true: t で分割して割り込み挿入し、後続（テロップ/SE/マーカー含む）を len ぶん後ろへシフト。
  // 末尾より先に置いた場合はギャップ（映像なし・無音の空白切片）で隙間を埋める。
  function placeSegAt(newSeg: VSeg, t: number, insert: boolean): void {
    const segsNow = segsRef.current
    const total = totalSegLen(segsNow)
    const len = segTLen(newSeg)
    if (t >= total - 1e-3) {
      const pieces: VSeg[] = []
      const gapLen = t - total
      if (gapLen > 0.05)
        pieces.push({
          id: segIdCounter.current++,
          srcId: newSeg.srcId,
          srcStart: 0,
          srcEnd: gapLen,
          videoBlank: true,
          muted: true,
          gap: true
        })
      pieces.push(newSeg)
      setSegments((prev) => [...prev, ...pieces])
      return
    }
    if (insert) {
      const { out, insertAt } = cutRangeFromSegs(segsNow, t, t) // 幅0=分割のみ
      out.splice(insertAt, 0, newSeg)
      setSegments(out)
      // 挿入位置より後ろのテロップ/SE/マーカーを新クリップぶん後ろへ（プレミアのインサート）
      setCues((prev) =>
        prev.map((c) => (c.start >= t - 1e-6 ? { ...c, start: c.start + len, end: c.end + len } : c))
      )
      setSeClips((prev) => prev.map((x) => (x.tStart >= t - 1e-6 ? { ...x, tStart: x.tStart + len } : x)))
      setMarkers((prev) => prev.map((m) => (m.t >= t - 1e-6 ? { ...m, t: m.t + len } : m)))
      setImgClips((prev) =>
        prev.map((c) => (c.tStart >= t - 1e-6 ? { ...c, tStart: c.tStart + len } : c))
      )
      setVClips((prev) =>
        prev.map((c) => (c.tStart >= t - 1e-6 ? { ...c, tStart: c.tStart + len } : c))
      )
    } else {
      const { out, insertAt } = cutRangeFromSegs(segsNow, t, Math.min(t + len, total))
      out.splice(insertAt, 0, newSeg)
      setSegments(out)
    }
  }
  // 動画をドロップ位置へ配置（タイムラインD&D）。insert=Ctrl押下で挿入、それ以外は上書き。
  async function placeVideoAtDrop(path: string, t: number, insert: boolean): Promise<void> {
    // V1 がロック中なら本編を書き換えない（画像/SE/映像レイヤーのドロップは
    // 既に拒否してトーストを出しているので、そこに揃える）
    if (trackStates['V1']?.locked) {
      showToast('このトラックはロックされています。')
      return
    }
    if (!sourcesRef.current.length) {
      // 最初の1本も「落とした位置」に置く。以前はここだけ先頭固定だったため、
      // 1本目にかぎってドロップ位置が無視され、勝手に頭から始まっていた。
      // 尺を先に取ってから読み込み、loadVideo 側の自動配置は止める。
      const d = await window.giftcut.getDuration(path)
      const dur = d?.ok && d.duration ? d.duration : 0
      if (dur <= 0) {
        showToast('動画の長さを取得できませんでした。', 'error')
        return
      }
      void loadVideo(path, { placed: true })
      // segIdCounter は loadVideo が同期的に 1 へ戻すので、採番はその後で行う
      placeSegAt({ id: segIdCounter.current++, srcStart: 0, srcEnd: dur }, Math.max(0, t), insert)
      return
    }
    const reg = await registerSource(path)
    if (!reg) return
    placeSegAt({ id: segIdCounter.current++, srcId: reg.id, srcStart: 0, srcEnd: reg.dur }, Math.max(0, t), insert)
    showToast(
      insert
        ? `${formatTime(t)} に挿入しました（後続は後ろへシフト）。`
        : `${formatTime(t)} に配置しました（上書き）。`,
      'success'
    )
  }

  // ---- プロジェクトのメディアライブラリ（動画/SE/画像。フォルダ追加対応）----
  const kindOf = (p: string): 'video' | 'audio' | 'image' => {
    const ext = p.toLowerCase().split('.').pop() ?? ''
    if (['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'].includes(ext)) return 'audio'
    if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return 'image'
    return 'video'
  }

  // 動画アイテムのサムネを非同期生成して反映
  function genThumbFor(id: number, path: string): void {
    // 同じファイルを何度も作らない／同時に走らせない（ビンが多いと詰まる）
    if (thumbDoneRef.current.has(path)) return
    thumbDoneRef.current.add(path)
    mediaQueue(() =>
      window.giftcut.generateThumbnail(path).then((th) => {
        if (th?.ok && th.path) {
          const url = toGcUrl(th.path)
          setMediaItems((prev) => prev.map((m) => (m.id === id || m.path === path ? { ...m, thumb: url } : m)))
        }
      })
    )
  }
  async function addFilesToProject(): Promise<void> {
    const res = await window.giftcut.addMedia()
    if (res?.paths) addMediaPaths(res.paths)
  }
  async function addFolderToProject(): Promise<void> {
    const res = await window.giftcut.addFolder()
    if (res?.paths?.length) addMediaPaths(res.paths, res.folder)
    else if (res) showToast('フォルダ内にメディアファイルが見つかりませんでした。')
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

  // 保存（既存パスがあれば上書き）。asNew=true で「別名で保存」。
  // 未保存の変更があるか。ウィンドウを閉じるときの判定と同じ基準にそろえる
  // （isDirty() は履歴のベースライン比較で450msで false に戻るため使えない）。
  function hasUnsavedChanges(): boolean {
    try {
      if (!hasProjectContent()) return false
      // ここはその場で比べ直す（「＊」の更新が遅れていても、閉じるときは必ず正しい）
      return savedJsonRef.current !== currentJsonRef.current()
    } catch {
      return false
    }
  }
  // 作業内容を捨てる操作の前に確認する。true=進めてよい
  async function confirmDiscard(what: string): Promise<boolean> {
    if (!hasUnsavedChanges()) return true
    return askConfirm({
      title: '保存していない変更があります',
      body: `${what}と、その変更は失われます。`,
      okLabel: 'このまま続ける',
      cancelLabel: '中止して保存する',
      danger: true
    })
  }


  // ---- 持ち出し（素材ごと1つの ZIP）----
  //
  // プロジェクトファイルだけ渡しても、相手のPCには素材が無いので全部
  // 「見つかりません」になる。使っている素材を全部入れて渡せるようにする。
  async function packProjectFn(): Promise<void> {
    if (packBusyRef.current) return // 二重起動しない
    const name = projectPath
      ? (projectPath.split(/[\\/]/).pop() ?? '').replace(/\.(gcproj|json)$/i, '')
      : (videoName ?? '').replace(/\.[^.]+$/, '') || '無題プロジェクト'
    packBusyRef.current = true
    setPackPct(0)
    try {
      const res = await window.giftcut.packProject(projectJson(), name)
      if (res.canceled) return
      if (!res.ok) {
        showToast('まとめられませんでした:\n' + (res.error ?? '不明なエラー'), 'error')
        return
      }
      const mb = Math.round((res.size ?? 0) / 1024 / 1024)
      // 入れられなかった素材は必ず伝える。黙って抜けると、渡した先で
      // 「一部だけ見つかりません」と言われて原因が分からない。
      const miss = res.missing?.length
        ? `\n入れられなかった素材 ${res.missing.length} 件（元の場所に見つかりません）:\n` +
          res.missing.slice(0, 5).join('\n') +
          (res.missing.length > 5 ? `\n…他 ${res.missing.length - 5} 件` : '')
        : ''
      showToast(
        `まとめました（素材 ${res.files ?? 0} 件 / ${mb}MB）\n${res.path}${miss}`,
        res.missing?.length ? 'error' : undefined
      )
    } finally {
      packBusyRef.current = false
      setPackPct(null)
    }
  }

  // 受け取ったまとめ（ZIP）を開く。展開してパスを繋ぎ直したものをそのまま開く。
  async function openPackFn(): Promise<void> {
    if (packBusyRef.current) return
    if (!(await confirmDiscard('まとめたプロジェクトを開く'))) return
    packBusyRef.current = true
    setPackPct(0)
    try {
      const res = await window.giftcut.openPack()
      if (res.canceled) return
      if (!res.ok || !res.data) {
        showToast('まとめを開けませんでした:\n' + (res.error ?? '不明なエラー'), 'error')
        return
      }
      await applyProjectData(res.data, !!res.videoExists, res.path ?? null)
      if (res.path) rememberProject(res.path)
      showToast(`まとめを開きました。素材はここに展開しています:\n${res.dir}`)
    } finally {
      setPackPct(null)
    }
  }

  // テンプレを適用（メディアビン＋テロップ設定＋設定。タイムラインは触らない）
  /* eslint-disable @typescript-eslint/no-explicit-any */
  /* eslint-enable @typescript-eslint/no-explicit-any */
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

  /**
   * 下書きを1回書く。**失敗を握りつぶさない。**
   *
   * 以前は結果を捨てていた。ディスクが一杯・書き込みを止められている（ウイルス対策）
   * といった理由で書けなくても誰も気づかず、しかも「書いた」と記録してしまうので
   * **次の回もやり直さない**。落ちて初めて「下書きが無い」と分かる、という
   * 一番たちの悪い壊れ方をする。守っているつもりの網が破れていても分からない。
   *
   * 失敗したら記録を戻して次の回でやり直し、画面にも出し続ける（消える通知だけにしない）。
   */
  const autosaveNgRef = useRef(false)
  const [autosaveNg, setAutosaveNg] = useState(false)
  async function writeAutosave(json: string): Promise<void> {
    const prev = lastAutosaveRef.current
    lastAutosaveRef.current = json // 同じ内容で二重に書かない
    let ok = false
    try {
      const r = await window.giftcut?.autosaveProject?.(json)
      ok = !!r?.ok
    } catch {
      ok = false
    }
    if (ok) {
      if (autosaveNgRef.current) {
        autosaveNgRef.current = false
        setAutosaveNg(false)
        showToast('自動保存が復旧しました。')
      }
      return
    }
    // 書けなかった: 「書いた」記録を戻して、次の回にやり直せるようにする
    lastAutosaveRef.current = prev
    autosavedRevRef.current = -1
    if (!autosaveNgRef.current) {
      autosaveNgRef.current = true
      setAutosaveNg(true)
      showToast('自動保存できていません。手動で保存してください（Ctrl+S）。')
    }
  }

  useEffect(() => {
    const id = window.setInterval(() => {
      if (!hasContentRef.current()) return
      if (projectRevRef.current === autosavedRevRef.current) return // 何も変わっていない
      autosavedRevRef.current = projectRevRef.current
      const json = currentJsonRef.current()
      if (json === lastAutosaveRef.current) return
      void writeAutosave(json)
    }, AUTOSAVE_MS)
    return () => window.clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // 終了/リロード直前に、その時点の内容を自動保存へ流し込む。
  // （間隔タイマーだけだと、閉じた瞬間に最大その間隔ぶんの編集が無警告で消える）
  // ※ここでは閉じるのをキャンセルしない（Electronでは無言で閉じられなくなるため）。
  //   未保存の確認はメインプロセスのネイティブダイアログで行う（project:dirty を通知）。
  useEffect(() => {
    const onBeforeUnload = (): void => {
      if (!hasContentRef.current()) return
      const json = currentJsonRef.current()
      if (json !== lastAutosaveRef.current) {
        void writeAutosave(json) // 最後のフラッシュ
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])
  // 起動時: 自動保存があれば復元プロンプトを出す
  useEffect(() => {
    void window.giftcut?.autosaveCheck?.()?.then(async (r) => {
      if (r?.exists && r.data) {
        // 更新のために自分で落としたのなら、「復元しますか？」とは聞かない。
        // 勝手に閉じておいて開き直しを頼むのは筋が通らないので、黙って続きから開く。
        if (localStorage.getItem('giftcut.resumeAfterUpdate')) {
          localStorage.removeItem('giftcut.resumeAfterUpdate')
          await applyProjectData(r.data, !!r.videoExists, null)
          showToast('新しい GiftCut になりました。続きから開いています。')
          return
        }
        const when = (ms?: number): string | undefined =>
          ms ? new Date(ms).toLocaleString('ja-JP', { dateStyle: 'short', timeStyle: 'short' }) : undefined
        setRestorePrompt({
          data: r.data,
          videoExists: !!r.videoExists,
          savedAt: when(r.mtime),
          onlyPrev: !!r.onlyPrev,
          prev: r.prev
            ? { data: r.prev.data, videoExists: !!r.prev.videoExists, savedAt: when(r.prev.mtime) }
            : undefined
        })
        return
      }
      // 自動保存の復元が無い時だけ、テンプレート選択を出す（あれば）
      const t = await window.giftcut?.listTemplates?.()
      if (t?.ok && t.items.length) setTemplatePicker({ items: t.items, startup: true })
    })
  }, [])


  // テロップテンプレを適用（選択があればそれに、無ければ次に足すテロップの既定に）。
  // レイアウト(anchor/box)とアニメは維持し、見た目だけ差し替える。
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
    }
    setSelectedIds([])
    setSelectedSeIds([])
    setSelectedImgIds([])
    setSelectedVClipIds([])
  }

  // ---- 基本編集操作（コピー/カット/貼付/複製/分割）----
  // コピー/カット/貼り付けはテロップ・SE/BGM・画像に対応（種別ごとにまとめて保持）。
  // 貼り付けは「元の相対位置を保ったまま再生ヘッド位置へ」（プレミア準拠）。
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
  function duplicateSelected(): void {
    if (!selectedIds.length) return
    if (cues.some((c) => isSelected(c.id) && telopLocked(c))) return
    const dupes = cues
      .filter((c) => isSelected(c.id))
      .map((c) => {
        const len = c.end - c.start
        return { ...structuredClone(c), id: idCounter.current++, start: c.end, end: c.end + len }
      })
    setCues((prev) => [...prev, ...dupes].sort((a, b) => a.start - b.start))
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
    if (holeStart != null) setTime(clamp(holeStart, 0, durationRef.current))
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
      const dupes = vClips
        .filter((c) => selectedVClipIds.includes(c.id))
        .map((c) => ({
          ...c,
          id: vClipIdCounter.current++,
          tStart: c.tStart + Math.max(0.05, c.srcEnd - c.srcStart)
        }))
      setVClips((prev) => [...prev, ...dupes])
      setSelectedVClipIds(dupes.map((d) => d.id))
      return
    }
    if (kind === 'se') {
      const dupes = seClips
        .filter((c) => selectedSeIds.includes(c.id))
        .map((c) => ({ ...c, id: seIdCounter.current++, tStart: c.tStart + c.duration }))
      setSeClips((prev) => [...prev, ...dupes])
      setSelectedSeIds(dupes.map((d) => d.id))
      return
    }
    const dupes = imgClips
      .filter((c) => selectedImgIds.includes(c.id))
      .map((c) => ({ ...c, id: imgIdCounter.current++, tStart: c.tStart + c.duration }))
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
    const after = sel.reduce((a, L) => a + (L.seg.srcEnd - L.seg.srcStart) / speed, 0)
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
  // タイムラインのトランジション枠を選択（動画クリップは選択しない＝トランジションだけを編集対象に）。
  function selectTransition(segId: number, kind: 'in' | 'out' | 'xfade'): void {
    setSelectedTrackId(null)
    setSelectedIds([])
    setEditingId(null)
    setSelectedVideoIds([])
    setSelectedAudioIds([])
    setSelectedSeIds([])
    setVideoSelected(false)
    setSelectedTelopTrans(null)
    setSelectedTrans({ segId, kind })
    setRightTab('transition') // 設定パネルを開く
  }
  // 選択中トランジションの or 指定 seg/kind の1プロパティ(dur/type)を更新するヘルパー。
  function patchSegTrans(
    segId: number,
    kind: 'in' | 'out' | 'xfade',
    patch: Partial<SegTrans>
  ): void {
    const key = kind === 'in' ? 'transIn' : kind === 'out' ? 'transOut' : 'xfade'
    setSegments((prev) =>
      prev.map((s) => (s.id === segId && s[key] ? { ...s, [key]: { ...s[key], ...patch } } : s))
    )
  }
  // 選択中トランジションの長さ／種類を変更。
  function updateSelectedTransDur(dur: number): void {
    if (selectedTrans) patchSegTrans(selectedTrans.segId, selectedTrans.kind, { dur })
  }
  function setSelectedTransType(type: TransType): void {
    if (selectedTrans) patchSegTrans(selectedTrans.segId, selectedTrans.kind, { type })
  }
  // 選択中トランジションを削除。
  function deleteSelectedTrans(): void {
    if (!selectedTrans) return
    const { segId, kind } = selectedTrans
    setSegments((prev) =>
      prev.map((s) =>
        s.id !== segId
          ? s
          : kind === 'xfade'
            ? { ...s, xfade: undefined }
            : kind === 'in'
              ? { ...s, transIn: undefined }
              : { ...s, transOut: undefined }
      )
    )
    setSelectedTrans(null)
  }

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
  // cue の anim を patch（in/out どちらか）。全て none になったら anim ごと外す。
  /**
   * テロップの「動き」（キーフレーム）を1項目だけ書き換える。
   * 印が全部無くなったら、その項目ごと捨てる（＝固定値に戻る）。
   */
  /**
   * テロップの動きを丸ごと入れ替える（見本帳から選んだとき・消すとき）。
   *
   * **足すのではなく置き換える。** 見本帳の動きは1つで完結した演出なので、
   * 前の動きの上に重ねると位置が二重にずれて、何が起きたか分からなくなる。
   */
  function setMotion(cueId: number, motion: Motion | undefined): void {
    setCues((prev) =>
      prev.map((c) => (c.id === cueId ? { ...c, motion: hasMotion(motion) ? motion : undefined } : c))
    )
  }
  /**
   * 選んでいるテロップ全部の動きを捨てる。
   *
   * **付ける時は選択中の全部に効くのに、消す時だけ1つずつでは対にならない。**
   * 鍵の掛かっている物は触らない（他の操作と同じ扱い）。
   */
  /**
   * モーションの「選んでいる項目」と、そのコピー。
   *
   * **貼り付けは種類を跨がない。** テロップの動き（位置・拡大・波…）と
   * 映像の動き（拡大・位置だけ）は項目そのものが違うので、混ぜると
   * 「貼ったのに何も起きない」か、意図しない項目だけが入る。
   * 全部を選んで貼っても、写した種類の物にだけ入るようにする。
   */
  const motionSelRef = useRef<string[]>([])
  const motionClipRef = useRef<{
    kind: 'telop' | 'clip'
    data: Record<string, Keys | undefined>
  } | null>(null)
  /**
   * 最後にコピーしたのはどちらか。**貼り付けは「最後に写した物」に従う。**
   *
   * 「モーションのタブを見ているか」で切り替えていたら、一度モーションを
   * 写しただけで、以降の Ctrl+V が**ずっとモーション側に取られ続けた**。
   * クリップを写したつもりで貼っても動きが入る＝黙って別の事が起きる。
   * 何を写したかで決めれば、迷いようがない。
   */
  /** 選んでいるテロップ全部から、その項目の印だけを捨てる */
  /** 選んでいる映像全部から、その項目の印を捨てる（固定値も既定へ戻す） */
  function resetClipChannel(key: keyof ClipMotion): void {
    const tgt = reframeTargetRef.current
    const vids = selectedVideoIds.length ? selectedVideoIds : tgt?.kind === 'video' ? [tgt.id] : []
    const imgs = selectedImgIds.length ? selectedImgIds : tgt?.kind === 'img' ? [tgt.id] : []
    const vcs = selectedVClipIds.length ? selectedVClipIds : tgt?.kind === 'vclip' ? [tgt.id] : []
    // 印を消すだけだと、固定値で拡大している物は見た目が変わらず「効かない」と見える
    const zoomOf = (z: { scale: number; x: number; y: number } | undefined): typeof z => {
      const base = z ?? DEFAULT_ZOOM
      const next = { ...base }
      if (key === 'sc') next.scale = 1
      else if (key === 'x') next.x = 0
      else if (key === 'y') next.y = 0
      return isNeutralZoom(next) ? undefined : next
    }
    const strip = <T extends { motion?: ClipMotion }>(c: T): T => {
      if (!c.motion) return c
      const next = { ...c.motion, [key]: undefined }
      return { ...c, motion: hasClipMotion(next) ? next : undefined }
    }
    if (vids.length && !trackStates['V1']?.locked)
      setSegments((prev) =>
        prev.map((s) => (vids.includes(s.id) ? { ...strip(s), zoom: zoomOf(s.zoom) } : s))
      )
    if (imgs.length)
      setImgClips((prev) =>
        prev.map((c) =>
          imgs.includes(c.id) && !trackStates[c.track]?.locked
            ? { ...strip(c), zoom: zoomOf(c.zoom) }
            : c
        )
      )
    if (vcs.length)
      setVClips((prev) =>
        prev.map((c) =>
          vcs.includes(c.id) && !trackStates[c.track]?.locked
            ? { ...strip(c), zoom: zoomOf(c.zoom) }
            : c
        )
      )
  }
  /** 選んでいる映像（動画切片・画像・映像レイヤー）全部の動きを捨てる */
  function clearClipMotions(): void {
    const tgt = reframeTargetRef.current
    const vids = selectedVideoIds.length
      ? selectedVideoIds
      : tgt?.kind === 'video'
        ? [tgt.id]
        : []
    const imgs = selectedImgIds.length ? selectedImgIds : tgt?.kind === 'img' ? [tgt.id] : []
    const vcs = selectedVClipIds.length ? selectedVClipIds : tgt?.kind === 'vclip' ? [tgt.id] : []
    if (vids.length && !trackStates['V1']?.locked)
      setSegments((prev) =>
        prev.map((s) => (vids.includes(s.id) ? { ...s, motion: undefined } : s))
      )
    if (imgs.length)
      setImgClips((prev) =>
        prev.map((c) =>
          imgs.includes(c.id) && !trackStates[c.track]?.locked ? { ...c, motion: undefined } : c
        )
      )
    if (vcs.length)
      setVClips((prev) =>
        prev.map((c) =>
          vcs.includes(c.id) && !trackStates[c.track]?.locked ? { ...c, motion: undefined } : c
        )
      )
  }
  /**
   * 動画切片・画像・映像レイヤーの「動き」を1項目だけ書き換える。
   * 印が全部無くなったら、その項目ごと捨てる（＝固定値に戻る）。テロップの patchMotion と同じ形。
   */
  /**
   * ⏱ の入り切り。テロップもクリップも同じ動きにする（2か所に書くとどちらかだけ直る）。
   *
   * 付けるときは、いまの時刻に印を1つ置くだけ（見た目は変わらない）。
   * **消すときは、打った数が多いと確認する**。確認なしで全部消えると、
   * 何を失ったのかも分からない。
   */
  function toggleKeys(
    label: string,
    cur: Keys | undefined,
    initial: number,
    at: number,
    patch: (fn: (keys: Keys | undefined) => Keys | undefined) => void
  ): void {
    if (!hasKeys(cur)) {
      patch(() => putKey(undefined, at, initial))
      return
    }
    if (cur!.length < 2) {
      patch(() => undefined)
      return
    }
    void askConfirm({
      title: `${label}の動きをやめますか`,
      body: `打った印 ${cur!.length} 個が消えます。（Ctrl+Z で戻せます）`,
      okLabel: 'やめる',
      danger: true
    }).then((ok) => {
      if (ok) patch(() => undefined)
    })
  }
  /** テロップの位置（フレーム内の割合）を書き換える */
  /** テロップの大きさ（倍率）を書き換える */
  /**
   * モーションの数値を変えたとき、**選んである他のテロップにも同じだけ配る。**
   *
   * 配るのは「変えた量（差分）」であって、値そのものではない。
   * 同じ値を配ると、ばらばらに置いてある物が1か所に揃ってしまう。
   * それぞれの**いまの値からのズレ**として足せば、位置関係は崩れない。
   *
   * 画面に出ている単位（px・%・度）と、印に入れる値の単位は違う。
   * 掛ける係数をここにまとめてある。**行の定義（toKey）と必ず対で直すこと。**
   */

  /**
   * 動画切片・画像・映像レイヤーの数値を変えたとき、
   * **選んである他のクリップにも同じだけ配る。**
   *
   * プレミアと同じで、再生ヘッドがどこにあっても「いま選んでいる物」が変わる。
   * 配るのは差分（値そのものではない）。値を配ると、別々に拡大していた物が
   * 全部同じ倍率に揃ってしまう。
   *
   * @param delta 中に入れる値での差分（倍率やフレーム比。表示単位ではない）
   */
  function nudgeClips(
    from: { kind: 'video' | 'img' | 'vclip'; id: number },
    key: keyof ClipMotion,
    delta: number
  ): void {
    if (!delta) return
    // 素のままの値。拡大だけ 1、位置は 0
    // （印の名前は sc / x / y。固定値側の名前 scale とは別なので取り違えないこと）
    const neutral = key === 'sc' ? 1 : 0
    const each = (
      kind: 'video' | 'img' | 'vclip',
      id: number,
      motion: ClipMotion | undefined,
      zoom: { scale: number; x: number; y: number } | undefined,
      tStart: number,
      len: number,
      setZoom: (z: { scale: number; x: number; y: number }) => void
    ): void => {
      if (kind === from.kind && id === from.id) return
      const t = clamp(currentTimeRef.current - tStart, 0, Math.max(0, len))
      const keys = motion?.[key]
      if (hasKeys(keys)) {
        patchClipMotion(kind, id, key, (ks) => putKey(ks, t, valueAt(ks, t, neutral) + delta))
        return
      }
      // 印が無ければ固定値を動かす
      const base = zoom ?? DEFAULT_ZOOM
      const next = { ...base }
      if (key === 'sc') next.scale = Math.max(0.05, base.scale + delta)
      else if (key === 'x') next.x = base.x + delta
      else if (key === 'y') next.y = base.y + delta
      else return // 回転など、固定値の置き場が別の物はここでは触らない
      setZoom(next)
    }
    for (const L of segLayout) {
      if (!selectedVideoIds.includes(L.seg.id)) continue
      if (trackStates['V1']?.locked) continue
      each('video', L.seg.id, L.seg.motion, L.seg.zoom, L.tStart, L.len, (z) =>
        setSegZoom(L.seg.id, z)
      )
    }
    for (const c of imgClips) {
      if (!selectedImgIds.includes(c.id) || trackStates[c.track]?.locked) continue
      each('img', c.id, c.motion, c.zoom, c.tStart, c.duration, (z) => setImgZoom(c.id, z))
    }
    for (const c of vClips) {
      if (!selectedVClipIds.includes(c.id) || trackStates[c.track]?.locked) continue
      each('vclip', c.id, c.motion, c.zoom, c.tStart, vcLen(c), (z) => setVClipZoom(c.id, z))
    }
  }

  // タイムライン上でトランジションの端をドラッグして長さを変える（プレミア風）。
  // sign: ドラッグ方向→長さの符号（頭/尻/中央で異なる）。apply(dur) で実際の適用。
  function startTransResize(
    e: React.PointerEvent,
    startDur: number,
    sign: number,
    apply: (d: number) => void,
    maxDur = 2
  ): void {
    e.stopPropagation()
    e.preventDefault()
    const startX = e.clientX
    const z = zoomRef.current
    // 上限は選択パネルのスライダー(max=2s)と揃える（表示矛盾を防ぐ）
    const cap = Math.min(maxDur, 2)
    const onMove = (ev: PointerEvent): void => {
      apply(clamp(startDur + (sign * (ev.clientX - startX)) / z, 0.05, cap))
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }
  // 動画トランジションの長さを直接設定（帯の端リサイズ用）。type は保持。
  function setVideoTransDur(segId: number, kind: 'in' | 'out' | 'xfade', dur: number): void {
    patchSegTrans(segId, kind, { dur })
  }

  /**
   * 見本帳の動きを、選んでいるテロップに付ける。
   *
   * **相手は必ずテロップ。** setMotion は cues しか触らないので、映像クリップに
   * 当たることは構造上ありえない（写し取った演出はテロップ用の項目でできていて、
   * 映像側は拡大と位置しか焼けないため、当たると効かないか書き出せない値になる）。
   * 強調（揺れ・脈動）と同じで、選んでいなければ何もせず、そう言う。
   */
  function applyMotionPreset(p: MotionPresetFile): void {
    // 動きが1つも取れていない物も一覧には並んでいる（人が中身を見て決めるため）。
    // **押しても何も起きないのは罠**なので、要る物の名前を言って終わる。
    if (!hasMotion(p.motion)) {
      showToast(
        `「${p.name}」はまだ付けられません` +
          (p.partial?.length ? `（${p.partial.join(' / ')} がこちらに無いため）` : '')
      )
      return
    }
    const ids = selectedIds.length ? selectedIds : selectedTelopTrans ? [selectedTelopTrans.cueId] : []
    if (!ids.length) {
      showToast('先にテロップを選択してください。')
      return
    }
    ids.forEach((id) => setMotion(id, p.motion))
    // 演出は頭から見せる（付けた直後に途中の絵が出ると、効いたか分からない）
    const head = cues.find((c) => c.id === ids[0])
    if (head) seekTo(head.start)
    showToast(
      `「${p.name}」を付けました` +
        (ids.length > 1 ? `（${ids.length}件）` : '') +
        // 終わりで消える物は、押した直後に言う（言わないと「壊れた」と思われる）
        (p.endsHidden ? '。**2枚重ねの上側用**なので、終わりで文字が消えます' : '') +
        (p.partial?.length ? `。${p.partial.join(' / ')} はこちらに無いので、一部だけです` : '')
    )
  }

  // トランジションD&D: マウス位置で配置先を判別（駐禁なし＝どこでも置ける・種類は無関係）。
  // ・カット境界（クリップの境目）の近く → 間。
  // ・それ以外はクリップ本体で 前半=頭 / 後半=尻。
  const BOUNDARY_PX = 22 // カット境界の当たり幅（画面px）。この範囲に入ったら間。
  function resolveTransDrop(
    clientX: number
  ): {
    segId: number
    kind: 'in' | 'out' | 'xfade'
    left: number
    width: number
    label: string
  } | null {
    const drag = draggingTransRef.current
    const rect = trackInnerRef.current?.getBoundingClientRect()
    const lay = segLayoutRef.current
    if (!drag || !rect || !lay.length) return null
    const z = zoomRef.current
    const t = Math.max(0, (clientX - rect.left) / z)
    // 最寄りの内部カット（クリップの境目）を探す
    let cutIdx = -1
    let cutPx = Infinity
    for (let i = 0; i < lay.length - 1; i++) {
      const dpx = Math.abs(lay[i].tEnd - t) * z
      if (dpx < cutPx) {
        cutPx = dpx
        cutIdx = i
      }
    }
    // カット境界の近く → 間（左クリップに付与）。
    // **予告帯も「実際に掛かる区間」に出す＝カットの手前 d 秒。**
    // 置いたあとの帯と位置が食い違うと、置いた場所が動いたように見える。
    if (cutIdx >= 0 && cutPx <= BOUNDARY_PX) {
      const A = lay[cutIdx]
      const d = Math.min(transDur, A.len, lay[cutIdx + 1].len)
      return {
        segId: A.seg.id,
        kind: 'xfade',
        left: (A.len - d) * z,
        width: d * z,
        label: `間 ${transIco(drag.type)}`
      }
    }
    // 境界でない → クリップ本体で 前半=頭 / 後半=尻
    const L = lay.find((l) => t >= l.tStart && t < l.tEnd) ?? lay[lay.length - 1]
    const f = (t - L.tStart) / Math.max(1e-6, L.len)
    const w = Math.min(transDur, L.len) * z
    if (f < 0.5)
      return { segId: L.seg.id, kind: 'in', left: 0, width: w, label: `頭 ${transIco(drag.type)}` }
    return {
      segId: L.seg.id,
      kind: 'out',
      left: L.len * z - w,
      width: w,
      label: `尻 ${transIco(drag.type)}`
    }
  }
  // トランジションD&Dのドロップ確定。resolveTransDrop の判別（頭/間/尻）に drag.type を付与。
  function applyTransDrop(clientX: number): void {
    if (mainLocked()) return
    const drag = draggingTransRef.current
    const r = resolveTransDrop(clientX)
    if (!drag || !r) return
    const nt: SegTrans = { type: drag.type, dur: transDur }
    if (r.kind === 'xfade') {
      const next = segments.map((s, i) =>
        s.id === r.segId && i < segments.length - 1 ? { ...s, xfade: nt } : s
      )
      setSegments(next)
      const idx = next.findIndex((s) => s.id === r.segId)
      if (idx >= 0 && xfadeDurAt(layoutSegs(next), idx) <= 0)
        showToast(
          '次のクリップの頭に素材の余白がないため間トランジションが効きません。\n（次のクリップの頭を少しトリムすると余白ができます）'
        )
    } else {
      setSegments((prev) =>
        prev.map((s) => {
          if (s.id !== r.segId) return s
          if (r.kind === 'in') return { ...s, transIn: nt }
          return { ...s, transOut: nt }
        })
      )
    }
  }
  // 切片が消えたときに、隣に取り残されるトランジションを掃除する。
  // 残すと別の2クリップ間でディゾルブが勝手に復活する。
  function cleanupOrphanTrans(list: VSeg[], removedIds: Set<number>): VSeg[] {
    const out: VSeg[] = []
    for (let i = 0; i < list.length; i++) {
      const cur = list[i]
      if (removedIds.has(cur.id)) continue
      let g = cur
      if (i + 1 < list.length && removedIds.has(list[i + 1].id) && g.xfade)
        g = { ...g, xfade: undefined }
      if (i > 0 && removedIds.has(list[i - 1].id) && g.transIn) g = { ...g, transIn: undefined }
      out.push(g)
    }
    return out
  }
  // 再生ヘッドから「1つ前のカット点」までを詰めて削除（切り抜きの不要部カット用）
  // 対象切片の頭を再生ヘッドまで前進＝[切片開始, 再生ヘッド]を除去し、後続は自動で詰まる。
  // リップルトリムが止まる「編集点」の一覧。カット点のほかに、テロップ・画像・
  // SE・映像レイヤーの端も編集点として扱う。これが無いと、カット点がテロップより
  // 前にある場合にテロップごと巻き添えで消えていた。
  // どこで止めるかの判定は shared/timeline の rippleStart / rippleEnd 側にある
  // （テストで固定してあるので、ここに同じ判定を書き足さないこと）。
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
  /** 選んでいる空きを詰める。選択に空きが1つも無ければ false。 */
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

  // ================= スナップ =================
  // マグネット吸着先＝再生ヘッド / 0 / テロップ端 / カット位置 / SE端。
  // excludeCueIds/excludeSeIds は自分自身の端に吸い付かないよう除外するID。
  function snapTargets(
    excludeCueIds: number[] = [],
    excludeSeIds: number[] = [],
    excludeImgIds: number[] = [],
    excludeVcIds: number[] = []
  ): number[] {
    const targets = [currentTimeRef.current, 0] // 再生ヘッド・原点
    for (const c of cues) if (!excludeCueIds.includes(c.id)) targets.push(c.start, c.end) // テロップ端
    for (const L of segLayoutRef.current) targets.push(L.tStart, L.tEnd) // 動画カット位置
    for (const s of seClipsRef.current)
      if (!excludeSeIds.includes(s.id)) targets.push(s.tStart, s.tStart + s.duration) // SE端
    for (const c of imgClipsRef.current)
      if (!excludeImgIds.includes(c.id)) targets.push(c.tStart, c.tStart + c.duration) // 画像端
    for (const c of vClipsRef.current)
      if (!excludeVcIds.includes(c.id))
        targets.push(c.tStart, c.tStart + Math.max(0.05, c.srcEnd - c.srcStart)) // 映像レイヤー端
    for (const m of markersRef.current) targets.push(m.t) // マーカー位置
    return targets
  }
  // 単一の時刻を吸着（テロップ移動・トリム・スクラブ用）
  function snapTime(
    t: number,
    excludeCueIds: number[] = [],
    excludeSeIds: number[] = [],
    excludeImgIds: number[] = [],
    excludeVcIds: number[] = []
  ): number {
    if (!snap) {
      setSnapLineX(null)
      return Math.max(0, t)
    }
    const targets = snapTargets(excludeCueIds, excludeSeIds, excludeImgIds, excludeVcIds)
    const thr = 8 / zoomRef.current // ドラッグ中のズーム変更にも追従するよう ref を参照
    let best = t
    let bestD = thr
    let snapped = false
    for (const tg of targets) {
      const d = Math.abs(tg - t)
      if (d < bestD) {
        bestD = d
        best = tg
        snapped = true
      }
    }
    setSnapLineX(snapped ? Math.max(0, best) * zoomRef.current : null)
    return Math.max(0, best)
  }
  // クリップ（SE等）の左右どちらの端が近くても吸着し、補正後の開始時刻を返す
  function snapClipStart(
    tStart: number,
    dur: number,
    excludeSeIds: number[] = [],
    excludeImgIds: number[] = [],
    excludeVcIds: number[] = []
  ): number {
    if (!snap) {
      setSnapLineX(null)
      return Math.max(0, tStart)
    }
    // どこへ寄せるかの判定は shared/snap（画面を起動せずに確かめられる）。
    // 画面側の仕事は「当て先を集めて、縦線を出す」ところまで。
    const targets = snapTargets([], excludeSeIds, excludeImgIds, excludeVcIds)
    const r = nearestSnap(tStart, dur, targets, 8 / zoomRef.current)
    setSnapLineX(r.line != null ? r.line * zoomRef.current : null)
    return r.start
  }

  // キーを押したときに何が起きるかは state/useKeyboard（呼ぶのは下の方）

  // 環境設定でキー割当をキャプチャ（次の打鍵で確定、Escでキャンセル）
  useEffect(() => {
    if (!capturingId) return
    function onKey(e: KeyboardEvent): void {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        setCapturingId(null)
        return
      }
      const combo = comboFromEvent(e)
      if (!combo) return // 修飾キーのみ → 打鍵待ち継続
      updateShortcut(capturingId as ShortcutId, combo)
      setCapturingId(null)
    }
    window.addEventListener('keydown', onKey, true) // capture フェーズで先取り
    return () => window.removeEventListener('keydown', onKey, true)
  }, [capturingId])

  // ファイルメニューを外側クリック・Escape で閉じる。
  //
  // **Escape が効かなかった。** 他のメニューも画面も全部 Escape で閉じるので、
  // ここだけ効かないと「閉じたつもり」のまま次の操作へ進む。しかも見出しの
  // 「ファイル」をもう一度押す動きは*開く*ではなく*閉じる*なので、
  // 閉じたつもりで押すと開かない——という分かりにくい形で表に出る
  // （通しの確認が実際にこれで1件落ちた）。
  useEffect(() => {
    if (!fileMenuOpen) return
    const close = (): void => setFileMenuOpen(false)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('click', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [fileMenuOpen])

  // アンマウント時にクロック停止
  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [])

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

  /**
   * 拡大率を変える。**再生ヘッドが画面から逃げないように**、
   * 再生ヘッドのある所を軸にして寄る／引く。
   *
   * 素で拡大率だけ変えると、左端(0秒)を軸に伸び縮みするので、
   * 拡大するほど再生ヘッドが右へ吹き飛んでいく。**いま見ている場所を見失う**ので、
   * 拡大のたびに横スクロールで探し直すことになっていた。
   *
   * 再生ヘッドが枠の外にいるときは真ん中へ連れてくる
   * （見えていない物を軸にしても、結局どこへ飛ぶか分からない）。
   */
  function zoomAroundPlayhead(nz: number): void {
    const el = scrollRef.current
    const z0 = zoomRef.current
    const t = currentTimeRef.current
    if (!el || !(z0 > 0)) {
      setZoom(nz)
      return
    }
    const w = el.clientWidth
    let px = t * z0 - el.scrollLeft // 枠の左端から再生ヘッドまで(px)
    if (px < 0 || px > w) px = w / 2
    setZoom(nz)
    // 幅が新しい拡大率で決まってから寄せる（先に動かすと切り詰められる）
    requestAnimationFrame(() => {
      el.scrollLeft = Math.max(0, t * nz - px)
    })
  }

  /**
   * 再生ヘッドをタイムラインの見えている範囲へ連れてくる。
   *
   * プレビューのバーで飛ばしても、タイムラインは動かないままだった
   * （再生ヘッド自体は動いているが、**枠の外なので見えない**）。
   * 再生し始めてようやく画面が追いつくので、「飛んだ先がどこか分からない」
   * 状態がしばらく続く。飛ばした時点で見える所へ持ってくる。
   *
   * すでに見えているなら**何もしない**（見えている物を動かすと、
   * 押すたびに画面が揺れて逆に読みにくい）。
   */
  function revealPlayhead(): void {
    const el = scrollRef.current
    if (!el) return
    const x = currentTimeRef.current * zoomRef.current
    const w = el.clientWidth
    const margin = Math.min(80, w * 0.15) // 端ぎりぎりだと次の操作でまた外れる
    if (x >= el.scrollLeft + margin && x <= el.scrollLeft + w - margin) return
    el.scrollLeft = Math.max(0, x - w / 2)
  }
  /** 飛ばして、そこを見せる（プレビュー側の操作はすべてこれを通す） */
  function seekAndReveal(t: number): void {
    seekTo(t)
    requestAnimationFrame(revealPlayhead)
  }

  // タイムラインの拡大率を「中身がちょうど収まる」ところに合わせる。
  function fitTimelineZoom(): void {
    const vw = scrollRef.current?.clientWidth ?? 800
    const end = Math.max(contentEndRef.current, 10)
    setZoom(clamp((vw - 40) / end, ZOOM_MIN, ZOOM_MAX))
    requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollLeft = 0
    })
  }
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

  // ✕ で閉じようとしたときの確認。メイン側は閉じるのを止めてここへ聞きに来るので、
  // アプリ内のモーダルで答えて、了承なら confirmClose で閉じ直してもらう。
  useEffect(() => {
    if (!window.giftcut?.onCloseRequest) return
    return window.giftcut.onCloseRequest(() => {
      void askConfirm({
        title: '保存していない変更があります',
        body: '閉じると、最後の保存以降の変更は自動保存の下書きにだけ残ります。次回の起動時に復元できます。',
        okLabel: '保存せずに閉じる',
        cancelLabel: '閉じない',
        danger: true
      }).then((ok) => {
        if (ok) window.giftcut.confirmClose()
      })
    })
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

  // アニメの「変化する区間」の分割点（ローカル秒）を返す。中間の静止区間は1枚で済ませる。
  function animBreakpoints(
    anim: TelopAnim | undefined,
    motion: Motion | undefined,
    dur: number,
    fps: number
  ): number[] {
    const step = 1 / fps
    const set = new Set<number>([0])
    const addRange = (a: number, b: number): void => {
      for (let t = a; t < b - 1e-4; t += step) set.add(Math.round(t / step) * step)
    }
    // 自分で打った動き（モーション）が付いていたら、全区間を刻む。
    // どこで値が変わるか決め打ちできないので、通しで並べるしかない。
    if (hasMotion(motion) || anim?.emphasis === 'shake' || anim?.emphasis === 'pulse') {
      addRange(0, dur)
    } else if (anim) {
      if (anim.in !== 'none') addRange(0, Math.min(anim.inDur, dur))
      if (anim.out !== 'none') addRange(Math.max(0, dur - anim.outDur), dur)
    }
    return [...set].filter((t) => t < dur - 1e-4).sort((a, b) => a - b)
  }

  // ================= 書き出し =================
  /**
   * 書き出しの設定画面を開く。
   *
   * **中身が無いときは開かない。** 以前は空でも開き、設定を選んで
   * 「書き出す」を押して初めて「動画を読み込んでください」と怒られた。
   * 押す前に分かる方が親切。
   */

  // ================= パネルリサイズ =================
  // 境目を掴んで動かす所は state/usePanelLayout の中


  // ================= タイムライン操作 =================
  // スクラブ（ルーラー・再生ヘッドのみ。プレミア準拠でスクラブ開始時に再生停止）
  function scrubFromClientX(cx: number): void {
    const el = trackInnerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    seekTo((cx - rect.left) / zoomRef.current)
  }
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
    moveSegmentTo, razorSegment, srcOfSeg, shiftAfter,
    trackInnerRef, zoomRef, videoDurationRef, videoName, videoPath,
    setDragTip, setSnapLineX, setVideoGhost, setOverwriteIds,
    segDropModeRef, segMoveToRef, snapClipStart, snapTime
  })

  // プレビュー内テロップのドラッグ移動
  // プレビューの上でテロップを掴む・拡げる・枠内に寄せるのは state/useTelopBox
  const { onTelopPointerDown, onTelopResizeStart, setBoxAnchor, applyIconAutoLeft } = useTelopBox({
    screenRef,
    lastTelopTapRef,
    telopLocked,
    stopPlayback,
    seekTo,
    iconAuto,
    setIconAnchorPos
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
    motionClipRef,
    motionSelRef,
    reframeTargetRef,
    srcOfSeg,
    leftTab
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
    confirmDiscard,
    hasProjectContent,
    askText,
    rememberProject,
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
    setHistTick,
    toGcUrl
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

  return (
    <div
      className="app"
      // 素材をドラッグしている間は、アプリのどこにいても受け付ける。
      // 受け付けない場所があると、そこだけ 🚫（駐禁）が出て「置けない場所」に見える。
    >
      {/* アプリの更新。作業の邪魔をしない細い帯で出す。
          再起動は勝手にやるが、必ず「何が起きるか」を先に出してから。 */}
      {(updateState?.phase === 'downloading' || updateState?.phase === 'ready') && (
        <div className="update-bar">
          {updateState.phase === 'downloading' ? (
            <span>⬇ 新しい GiftCut を用意しています… {updateState.percent}%</span>
          ) : (
            <>
              <span>✨ {updateState.message}</span>
              {updateState.when === 'now' && (
                <>
                  <button className="update-btn" onClick={() => window.giftcut.updateNow()}>
                    今すぐ再起動
                  </button>
                  <button
                    className="update-btn update-btn-ghost"
                    onClick={() => {
                      window.giftcut.updateLater()
                      setUpdateState(null)
                    }}
                  >
                    あとで
                  </button>
                </>
              )}
            </>
          )}
        </div>
      )}
      {/* 一番上のメニューは components/MenuBar.tsx。ここでは並べる物だけを書く。
          置くのは「パネルからは届かない操作」だけ（素材の追加・SRT読込・書き出しは
          プロジェクトパネルとモードバーでできるので出さない）。 */}
      <MenuBar
        open={fileMenuOpen}
        onToggle={() => setFileMenuOpen((o) => !o)}
        rows={[
          {
            kind: 'item',
            label: 'プロジェクトを開く…　(Ctrl+O)',
            onClick: () => {
              setFileMenuOpen(false)
              void openProjectFn()
            }
          },
          // 最近使ったプロジェクト。保存先を覚えていなくてもここから開ける
          recentProjects.length > 0 && { kind: 'label', label: '最近使ったプロジェクト' },
          ...recentProjects.map(
            (r) =>
              ({
                kind: 'recent',
                label: r.name,
                title: r.path,
                onClick: () => {
                  setFileMenuOpen(false)
                  void openProjectFn(r.path)
                }
              }) as const
          ),
          recentProjects.length > 0 && { kind: 'sep' },
          {
            kind: 'item',
            label: `${projectPath ? 'プロジェクトを保存' : 'プロジェクトを保存…'}　(${formatCombo(shortcuts.saveProject)})`,
            title: projectPath ? `上書き保存: ${projectPath}` : '保存先を選んで保存します',
            onClick: () => {
              setFileMenuOpen(false)
              void saveProjectFn()
            }
          },
          {
            kind: 'item',
            label: '別名で保存…',
            onClick: () => {
              setFileMenuOpen(false)
              void saveProjectFn(true)
            }
          },
          { kind: 'sep' },
          // 別PCへ渡す用。プロジェクトだけ渡しても素材が無ければ開けない
          {
            kind: 'item',
            label: '素材ごとまとめて書き出す…（ZIP）',
            title:
              '使っている素材を全部入れた ZIP を作ります。別のPCの GiftCut で開けば続きから編集できます',
            onClick: () => {
              setFileMenuOpen(false)
              void packProjectFn()
            }
          },
          {
            kind: 'item',
            label: 'まとめたプロジェクトを開く…（ZIP）',
            title:
              'まとめた ZIP を展開して開きます（素材はドキュメント/GiftCut/受け取ったプロジェクト に置きます）',
            onClick: () => {
              setFileMenuOpen(false)
              void openPackFn()
            }
          },
          { kind: 'sep' },
          {
            kind: 'item',
            label: 'テンプレートとして保存…',
            onClick: () => {
              setFileMenuOpen(false)
              saveAsTemplateFn()
            }
          },
          {
            kind: 'item',
            label: 'テンプレートを開く…',
            onClick: () => {
              setFileMenuOpen(false)
              void openTemplateFn()
            }
          },
          { kind: 'sep' },
          {
            kind: 'item',
            label: '動画をタイムライン末尾に置く…',
            title: '選んだ動画をタイムラインのいちばん後ろに置きます',
            onClick: () => {
              setFileMenuOpen(false)
              void handleAppendVideo()
            }
          },
          {
            kind: 'item',
            label: '動画を差し替え…',
            title: '現在のカットを破棄して別の動画に置き換えます',
            onClick: () => {
              setFileMenuOpen(false)
              void handleReplaceVideo()
            }
          },
          {
            kind: 'item',
            label: 'SRT を書き出し…',
            onClick: () => {
              setFileMenuOpen(false)
              void exportSrtFn()
            }
          },
          // 動きの取り込みは**一度きり**の作業なので、見本帳の中には置かない。
          // 常に見える所に置くと、細いパネルでは一覧の場所を食うだけになる
          // （実際に、幅を詰めると演出が1つも見えなくなっていた）。
          {
            kind: 'item',
            label: 'Premiere の動きを取り込む…',
            title: '.prfpset を読んで、中の動きを「トランジション → 動き」に並べます',
            onClick: () => {
              setFileMenuOpen(false)
              importMotionPresets()
            }
          },
          { kind: 'sep' },
          // 更新で消えない置き場。**更新はアプリ本体を丸ごと入れ替える**が、
          // ここ（%APPDATA%\GiftCut\）の下は触られない。自分で足した素材の
          // 置き場所であり、退避も引っ越しもここを開ければできる。
          // **ZIP を選ぶだけで済ませる。**
          // 「開いて・展開して・貼る」は手順が3つあり、どれか1つ間違えると
          // 素材が出てこない。しかも間違いに気づけない（何も起きないだけ）。
          { kind: 'label', label: '素材を入れる' },
          {
            kind: 'item',
            label: '素材パック（ZIP）を取り込む…（展開しなくて OK）',
            title:
              'SE・テロップ素材・動き・テンプレートが入った ZIP を選ぶだけで、' +
              '展開して置き場へ入れ、そのまま使えるようにします（更新しても消えません）',
            onClick: () => {
              setFileMenuOpen(false)
              void window.giftcut
                .importAssetZip()
                .then((r) => {
                  if (r?.canceled) return
                  if (!r?.ok) {
                    showToast(`取り込めませんでした。\n${r?.error ?? ''}`)
                    return
                  }
                  const n = Object.entries(r.added ?? {})
                    .map(([k, v]) => `${k} ${v}件`)
                    .join(' / ')
                  // **その場で全部読み直す。** 「入れました」と言われたのに
                  // 一覧が変わらないと、入ったのかどうか分からない。
                  // 種類を1つでも読み飛ばすと、そこだけ再起動するまで出てこない。
                  //（テンプレートは開くときに読むので、ここでは要らない）
                  refreshSE()
                  refreshPresets()
                  refreshMotionPresets()
                  showToast(`素材を取り込みました（${n}）。そのまま使えます。`)
                })
                .catch((e) => showToast(`取り込めませんでした。\n${String(e)}`))
            }
          },
          { kind: 'sep' },
          { kind: 'label', label: '置き場を開く（更新しても消えません）' },
          ...(
            [
              ['se', '効果音（SE）', '自分で足した効果音の置き場'],
              ['telop', 'テロップ素材', '自分で足したテロップ素材の置き場'],
              ['motion', '動きのプリセット', '取り込んだ動き（.prfpset から写した物）の置き場'],
              ['template', 'テンプレート', 'テンプレートとして保存した物の置き場'],
              ['data', '設定・保存データ', '設定・自動保存の下書き・プロキシの置き場']
            ] as const
          ).map(
            ([key, label, title]) =>
              ({
                kind: 'item',
                label: `${label}のフォルダを開く`,
                title,
                onClick: () => {
                  setFileMenuOpen(false)
                  void window.giftcut.openFolder(key).then((r) => {
                    if (!r?.ok) showToast(`フォルダを開けませんでした。\n${r?.error ?? ''}`)
                  })
                }
              }) as const
          ),
          { kind: 'sep' },
          {
            kind: 'item',
            label: '環境設定（ショートカット）…',
            onClick: () => {
              setFileMenuOpen(false)
              setPrefsOpen(true)
            }
          }
        ]}
      />

      {/* ===== モードバー ===== */}
      <div className="modebar">
        <div className="modebar-left">
          <span className="home">⌂</span>
          <button className="mode-tab mode-tab-on">編集</button>
          {/* **字幕は編集と書き出しの間。**
              喋りを起こしてから仕上げる、という順番そのものを並びで示す。
              押してすぐ走らせない（何分もかかる処理なので、必ず確認を挟む）。 */}
          <button
            className="mode-tab"
            onClick={() => setSubtitleOpen(true)}
            title="喋っている内容を聞き取って、テロップにします"
          >
            字幕
          </button>
          {/* 設定ダイアログを経由する（メニューや Ctrl+M と挙動を揃える。
              以前はここだけ前回設定で即書き出しが始まっていた） */}
          <button className="mode-tab" onClick={() => openExportDialog()}>
            書き出し
          </button>
        </div>
        <div className="modebar-sep" />
        <div className="modebar-title" title={projectPath ?? '未保存のプロジェクト'}>
          {/* タイトルはプロジェクトファイル名。SRTのファイル名を出すと保存先を誤認させる */}
          {projectPath ? projectPath.split(/[\\/]/).pop() : 'GiftCut - 無題プロジェクト'}
          {unsaved ? ' *' : ''}
          {/* **いま動いている版。**
              自動更新は黙って入れ替わるので、「直したはずの物が直っていない」と
              言われたときに、まずここを見れば新旧の取り違えかどうかが分かる。 */}
          {appVersion && (
            <span className="app-ver" title="いま動いている GiftCut の版">
              v{appVersion}
            </span>
          )}
        </div>
        <div className="modebar-right">
          <button className="btn btn-primary" onClick={handleImportSrt}>
            SRT読込
          </button>
          <button className="btn" onClick={addTelop} title={`再生ヘッド位置にテロップを追加 (${formatCombo(shortcuts.addTelop)})`}>
            ＋テロップ
          </button>
          <div className="ratio-group">
            {(['16:9', '9:16', '1:1'] as const).map((r) => (
              <button
                key={r}
                className={`chip ${ratio === r ? 'chip-on' : ''}`}
                title="フレームの縦横比を変更（テロップの箱と文字サイズも比率に合わせて補正します）"
                onClick={() => changeRatio(r)}
              >
                {r}
              </button>
            ))}
          </div>
          <select
            className="lufs-select"
            title="ラウドネス正規化（書き出し時に音量を目標LUFSへ自動調整）"
            value={loudnormLUFS === null ? 'off' : String(loudnormLUFS)}
            onChange={(e) =>
              setLoudnormLUFS(e.target.value === 'off' ? null : Number(e.target.value))
            }
          >
            <option value="-14">🔊 音量そろえ -14 LUFS（YouTube）</option>
            <option value="-16">🔊 音量そろえ -16 (podcast)</option>
            <option value="-23">🔊 音量そろえ -23 (放送)</option>
            <option value="off">音量そろえ OFF</option>
          </select>
        </div>
      </div>

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
          {/* --- 中央: プログラムモニター / オーディオミキサー --- */}
          <section
            className="panel monitor"
            style={{ flex: '1 1 0', minWidth: 0 }}
          >
            <PanelTabs
              group="monitor"
              tabs={orderedTabs('monitor', TAB_DEFS.monitor)}
              active={monitorTab}
              onPick={(id) => pickTab('monitor', id)}
              onTabMenu={(e, grp, id, label) => {
                e.preventDefault()
                e.stopPropagation()
                setTabOverflow(null)
                setTabMenu({ x: e.clientX, y: e.clientY, group: grp, id, label })
              }}
              onOverflow={(e, grp, hidden) => {
                e.stopPropagation()
                setTabMenu(null)
                setTabOverflow({ x: e.clientX, y: e.clientY, group: grp, hidden })
              }}
              onReorder={(ids) => setTabOrder((p) => ({ ...p, monitor: ids }))}
              right={transportInfo}
            />
            {/* ミキサー表示中も video は破棄せず隠すだけ（再生を止めないため） */}
            <div
              className="monitor-stage"
              style={{ display: monitorTab === 'program' ? 'flex' : 'none' }}
              onPointerDown={(e) => {
                // 画面（フレーム）の外＝モニターの余白をクリックしたら選択解除・枠を閉じる
                if (e.target === e.currentTarget) {
                  setVideoSelected(false)
                  clearSegSel()
                  setSelectedIds([])
                  setEditingId(null)
                }
              }}
            >
              <div
                ref={screenRef}
                className="screen"
                style={{ aspectRatio: monitorAspect }}
                onPointerDown={(e) => {
                  // プレビューの空きエリア（テロップ以外）をクリック＝テロップ選択解除＋動画リフレーム。
                  // テロップ本体/リサイズハンドル/編集エディタは stopPropagation 済みでここへ来ない。
                  if (e.button !== 0) return
                  setSelectedIds([])
                  setEditingId(null)
                  if (videoSrc) {
                    setVideoSelected(true)
                    onVideoReframeStart(e, null) // 本体ドラッグ＝パン（クリックだけなら動かない）
                  }
                }}
                // ホイールでの拡大縮小は付けない。枠が出ているだけで意図せず映像が
                // 拡大され、元に戻すのが手間になるため（拡大はスライダーと四隅のドラッグで行う）。
                onDragOver={(e) => {
                  if (draggingMediaRef.current?.kind === 'video') e.preventDefault()
                }}
                onDrop={(e) => {
                  const m = draggingMediaRef.current
                  // 動画以外はここでは受け取らない。preventDefault を先に呼ぶと
                  // 「処理済み」と見なされ、画像や音声を落としたときに何も起きず消える。
                  if (m?.kind !== 'video') return
                  e.preventDefault()
                  if (!videoPath) void loadVideo(m.path)
                  else showToast('タイムラインへドロップすると、その位置に配置できます。')
                }}
              >
                {/* 元動画ごとに <video> を常設し、切替は「表示の切替」だけで行う。
                    src を差し替えると要素が一度アンロードされて背景が透ける＝ちらつきの原因になるため。

                    さらに**1本につき2つ（A面/B面）**持つ。片方を映している間に
                    もう片方を次のカットの頭へ送っておき、カットで表示を入れ替える。
                    カットのたびに飛んで待たされる（実測145〜235ms）のを、
                    再生の裏に隠す＝プレミアのプリロールと同じ考え方。 */}
                {previewSources.flatMap((s) =>
                  ([0, 1] as const).map((half) => {
                  const isActive = s.id === effActiveSrcId && half === (activeHalf[s.id] ?? 0)
                  return (
                    <video
                      key={`${s.id}:${half}`}
                      ref={(el) => {
                        if (el) {
                          videoElsRef.current.set(elKey(s.id, half), el)
                          if (isActive) videoRef.current = el
                        } else videoElsRef.current.delete(elKey(s.id, half))
                      }}
                      className="screen-video"
                      style={{
                        opacity:
                          !isActive ||
                          v1Hidden ||
                          curBlank ||
                          (videoTLen > 0 && currentTime >= videoTLen - 1e-3)
                            ? 0
                            : 1,
                        // 非表示のソースはクリック等を拾わない
                        pointerEvents: isActive ? undefined : 'none',
                        // **見た目の指定は、映していない面にも同じものを当てておく。**
                        // 入れ替えた瞬間に filter や transform が付くと、その面の
                        // 描き方（合成の経路）が切り替わり、そこで待ちが出る。
                        // 先に当てておけば、入れ替えで変わるのは透明度だけになる。
                        filter: curAdjustCss,
                        ...videoMainStyle
                      }}
                      src={previewUrl(s.path, s.origUrl)}
                      preload="auto"
                      // **どの面も muted にしない。**
                      // 音のある動画はメディア時計が音声側に従うため、muted を
                      // 切り替えると時計が張り替わり、絵まで250ms止まる（カットのたびに発生）。
                      // 裏の面は音量0で黙らせている（上の音量 effect と入れ替えの所）。
                      muted={false}
                      onLoadedMetadata={(e) => {
                        const d = e.currentTarget.duration || 0
                        if (s.id >= 0) updateSource(s.id, { duration: d })
                        if (!isActive) return
                        setVideoDuration(d)
                        // 初期切片は「この動画で初回だけ」作る（プロキシ差し替えの再発火では作らない）
                        if (
                          segsRef.current.length === 0 &&
                          d > 0 &&
                          initializedForPathRef.current !== s.path
                        ) {
                          initializedForPathRef.current = s.path
                          suppressHistoryRef.current = true // 初期切片は履歴化しない
                          setSegments([{ id: segIdCounter.current++, srcStart: 0, srcEnd: d }])
                        }
                      }}
                      onLoadedData={(e) => {
                        // ロード直後、停止中なら現在位置（自ソースぶん）へシークして正しいフレームを出す
                        const v = e.currentTarget
                        if (playRateRef.current > 0) return
                        if (isActive) {
                          const src = tToSource(segLayoutRef.current, currentTimeRef.current)
                          if (src) v.currentTime = src.srcTime
                        } else {
                          // 待機中のソースは自分の最初の出番の頭に置いておく
                          const first = segLayoutRef.current.find((l) => srcOfSeg(l.seg)?.id === s.id)
                          if (first) v.currentTime = first.seg.srcStart
                        }
                      }}
                      onEnded={isActive ? handleVideoEnded : undefined}
                      onError={() => {
                        if (isActive) stopPlayback()
                      }}
                    />
                  )
                  })
                )}
                {videoSrc && (
                  // クロスディゾルブ用の2本目video。区間外は透明＆pause（駆動は専用effect）
                  // マルチソース: B側切片のソースURLを使う（別ソース間の境界でも正しい相手が映る）
                  <video
                    ref={videoBRef}
                    className="screen-video screen-video-b"
                    style={
                      xfPreview && !xfPreview.blank && !v1Hidden
                        ? xfBStyle(xfPreview)
                        : { opacity: 0 }
                    }
                    src={xfPreview?.bUrl ?? xfNextBUrl ?? videoSrc}
                    preload="auto"
                    muted
                  />
                )}
                {xfPreview?.blank && !v1Hidden && (
                  <div
                    className="trans-overlay"
                    style={{ background: '#000', opacity: xfPreview.p }}
                  />
                )}
                {xfDipOverlay && !v1Hidden && (
                  <div
                    className="trans-overlay"
                    style={{ background: xfDipOverlay.color, opacity: xfDipOverlay.opacity }}
                  />
                )}
                {/* 重なる中身（重ねた動画→画像→テロップ）は
                    components/panels/PreviewLayers.tsx。並び順が重なり順になる */}
                <VideoLayers
                  clips={windowVClips}
                  vcLen={vcLen}
                  vcRefCb={vcRefCb}
                  vcXform={vcXform}
                  previewUrl={previewUrl}
                  toGcUrl={toGcUrl}
                  onSelect={selectPreviewOverlay}
                />
                <ImageLayers imgXform={imgXform} toGcUrl={toGcUrl} onSelect={selectPreviewOverlay} />
                <TelopLayer
                  activeCues={activeCues}
                  cueTrack={cueTrack}
                  iconForCue={iconForCue}
                  iconScale={iconScale}
                  iconAuto={iconAuto}
                  iconSide={iconSide}
                  iconOffset={iconOffset}
                  ratio={ratio}
                  draggingTemplateRef={draggingTemplateRef}
                  draggingIconRef={draggingIconRef}
                  applyTemplateToCue={applyTemplateToCue}
                  applyIconToCue={applyIconToCue}
                  onResizeStart={onTelopResizeStart}
                  onPointerDown={onTelopPointerDown}
                  onEdit={(c) => {
                    stopPlayback()
                    setSelectedIds([c.id])
                    setEditingId(c.id)
                  }}
                />
                {transOverlay && (
                  <div
                    className="trans-overlay"
                    style={{ background: transOverlay.color, opacity: transOverlay.opacity }}
                  />
                )}
                {/* 映像に重ねて出る物は components/panels/PreviewOverlays.tsx */}
                {(videoSelected ||
                  selectedVideoIds.length > 0 ||
                  selectedImgIds.length === 1 ||
                  selectedVClipIds.length === 1) &&
                  reframeTarget && (
                  <ReframeBox
                    target={reframeTarget}
                    onReframeStart={onVideoReframeStart}
                    onRotateStart={onVideoRotateStart}
                    onReset={resetVideoZoom}
                    resetCount={resetCount()}
                    onDone={() => {
                      setVideoSelected(false)
                      clearSegSel()
                    }}
                  />
                )}
                {!videoSrc && !activeCues.length && <ScreenEmpty />}
                <ProgressBadges proxyPct={proxyPct} packPct={packPct} />
                {editingId != null &&
                  activeCues.some((c) => c.id === editingId) && (
                    <TelopEditor
                      cue={cues.find((c) => c.id === editingId)!}
                      textRef={editorTextRef}
                      onChangeText={updateCueText}
                      onSelChange={setEditorSel}
                      onClearRuns={clearRunsInSelection}
                      onClose={() => setEditingId(null)}
                    />
                  )}
              </div>
            </div>

            {/* オーディオトラックミキサー（components/panels/PreviewBars.tsx） */}
            {monitorTab === 'mixer' && (
              <AudioMixer
                tracks={tracks
                  .filter((t) => t.kind === 'audio')
                  .map((tr) => {
                    const st = trackStates[tr.id] ?? newTrackState(tr.id)
                    return {
                      id: tr.id,
                      name: tr.name,
                      muted: st.muted,
                      solo: st.solo,
                      volume: st.volume ?? 1
                    }
                  })}
                master={masterVolume}
                onToggleMute={(id) => toggleTrack(id, 'muted')}
                onToggleSolo={(id) => toggleTrack(id, 'solo')}
                onVolume={setTrackVolume}
                onMaster={(v) => setMasterVolume(clamp(v, 0, 1))}
                startFader={startFader}
                gainToDb={gainToDb}
              />
            )}
            <PreviewScrub
              currentTime={currentTime}
              duration={duration}
              // 飛ばしたら、タイムライン側もその場所を見せる（連動）
              onSeek={seekAndReveal}
              onScrubStart={stopPlayback}
            />
            <TransportBar
              timecode={formatTimecode(currentTime, fps)}
              playing={playing}
              onSkip={skipSec}
              onStep={stepFrame}
              onTogglePlay={togglePlay}
              onScreenshot={() => void captureScreenshot()}
              onJumpMarker={jumpMarker}
              onAddMarker={addMarkerAtPlayhead}
              keyHint={{
                back: formatCombo(shortcuts.frameBack),
                play: formatCombo(shortcuts.playPause),
                fwd: formatCombo(shortcuts.frameFwd),
                marker: formatCombo(shortcuts.addMarker)
              }}
            />
          </section>
          </PaneHost>

          <div className="resizer resizer-v" onPointerDown={(e) => startResize('right', e)} />

          <PaneHost id="right" title={PANE_LABEL.right} popped={isPopped('right')}
            geom={paneGeom.right} onClose={() => unpopPane('right')}>
          {/* --- 右: プロジェクト --- */}
          <section
            className="panel"
            style={{ width: rightW, flex: '0 0 auto' }}
          >
            <PanelTabs
              group="right"
              tabs={orderedTabs('right', TAB_DEFS.right)}
              active={rightTab}
              onPick={(id) => pickTab('right', id)}
              onTabMenu={(e, grp, id, label) => {
                e.preventDefault()
                e.stopPropagation()
                setTabOverflow(null)
                setTabMenu({ x: e.clientX, y: e.clientY, group: grp, id, label })
              }}
              onOverflow={(e, grp, hidden) => {
                e.stopPropagation()
                setTabMenu(null)
                setTabOverflow({ x: e.clientX, y: e.clientY, group: grp, hidden })
              }}
              onReorder={(ids) => setTabOrder((p) => ({ ...p, right: ids }))}
            />
            {/* --- 右: プロジェクト（素材の置き場）--- 中身は components/panels/ProjectBinTab.tsx */}
            {rightTab === 'project' && (
              <ProjectBinTab
                bodyRef={rightBodyRef}
                accSec={accSec}
                items={mediaItems}
                activePath={videoPath}
                selectedId={selectedMediaId}
                srtName={srtPath ? (srtPath.split(/[\\/]/).pop() ?? null) : null}
                cueCount={cues.length}
                labelGroups={labelGroups}
                onAddFiles={addFilesToProject}
                onAddFolder={addFolderToProject}
                onImportSrt={handleImportSrt}
                onAddAtPlayhead={addMediaAtPlayhead}
                onSelect={setSelectedMediaId}
                onOpenVideo={(m) => {
                  // 何も読み込んでいなければ読み込む。既に編集中なら
                  // タイムラインを壊さない（ダブルクリックで全消しは事故になる）。
                  if (!videoPath) void loadVideo(m.path)
                  else
                    showToast('タイムラインへドラッグして配置してください（Ctrl+ドロップで挿入）。')
                }}
                onRemove={removeMedia}
                // **音はここからSEへ送れるようにする。**
                // プロジェクトに入れても SE の一覧には出てこないので、
                // 「入れたのに使えない」で止まっていた（案内文も SE を指していた）
                onContextMenu={(m, e) => {
                  const opts: { label: string; act: () => void }[] = []
                  if (m.kind === 'audio')
                    opts.push({
                      label: '🔊 SE へ入れる（右の SE タブに並びます）',
                      act: () => void importSeInto([m.path])
                    })
                  opts.push({
                    label: '▶ 再生ヘッドの位置へ置く',
                    act: () => addMediaAtPlayhead(m)
                  })
                  opts.push({ label: '✕ プロジェクトから削除', act: () => removeMedia(m.id) })
                  setOrgMenu({ x: e.clientX, y: e.clientY, options: opts })
                }}
                onDragStart={beginMediaDrag}
                onDragEnd={() => {
                  draggingMediaRef.current = null
                  setSeGhost(null)
                  setVideoGhost(null)
                  setImgGhost(null)
                }}
                onPickLabel={selectByLabel}
                onVisible={(vis) => {
                  // 見えた物のサムネと波形をここで用意する。
                  // どちらも「同じ物は1回だけ」なので、何度呼ばれても増えない。
                  for (const m of vis) {
                    if (m.kind === 'video') genThumbFor(m.id, m.path)
                    prepareMediaMeta(m.path, m.kind)
                  }
                }}
              />
            )}

            {/* --- テロップテンプレ --- 中身は components/panels/TelopTemplatesTab.tsx */}
            {rightTab === 'telop' && (
              <TelopTemplatesTab
                bodyRef={rightBodyRef}
                hasSelection={selectedIds.length > 0}
                userTemplates={userTemplates}
                builtinTemplates={BUILTIN_TEMPLATES}
                localTemplates={localTemplates}
                categories={allCats}
                customCategories={customCats}
                openSection={openTplSec}
                sectionRefs={tplSecRefs}
                isFav={isFav}
                catOf={catOf}
                onToggleSection={toggleTplSec}
                onSaveCurrent={saveCurrentAsTemplate}
                onAddFolder={addCustomCat}
                onDeleteFolder={deleteCustomCat}
                onRefresh={refreshPresets}
                onApply={applyTemplate}
                onDeleteUserTemplate={deleteUserTemplate}
                onToggleFav={toggleFav}
                onSetCat={setTplCat}
                onCardContextMenu={(t, e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setTplMenu({ x: e.clientX, y: e.clientY, name: t.name, curCat: catOf(t) })
                }}
                onDragStartTpl={(style) => (draggingTemplateRef.current = style)}
                onDragEndTpl={() => (draggingTemplateRef.current = null)}
              />
            )}

            {/* --- アイコン（画像置き場）--- 中身は components/panels/IconLibraryTab.tsx */}
            {rightTab === 'icon' && (
              <IconLibraryTab
                library={iconLibrary}
                folders={iconFolders}
                moved={iconOv}
                favorites={iconFavs}
                bodyRef={rightBodyRef}
                accSec={accSec}
                onAddImages={addIconImages}
                onDropFiles={addIconFiles}
                onAddFolder={addIconFolder}
                onDeleteFolder={deleteIconFolder}
                onDelete={removeIconImage}
                onToggleFav={toggleIconFav}
                onApplyToSelection={(image) => {
                  if (!selectedIds.length) return
                  setCues((prev) =>
                    prev.map((c) =>
                      isSelected(c.id) ? { ...c, iconImage: image, personIcon: undefined } : c
                    )
                  )
                }}
                onDragStart={(image) => (draggingIconRef.current = image)}
                onDragEnd={() => (draggingIconRef.current = null)}
                onContextMenu={(it, cur, e) => {
                  const dests = [
                    { key: ICON_LIB, label: 'アイコン画像', custom: false },
                    ...iconFolders.map((f) => ({ key: f.key, label: f.label, custom: true }))
                  ]
                  setOrgMenu({
                    x: e.clientX,
                    y: e.clientY,
                    options: [
                      ...dests.map((d) => ({
                        label: `${cur === d.key ? '✓ ' : ''}${d.custom ? '📁 ' : ''}${d.label}`,
                        checked: cur === d.key,
                        act: () =>
                          setIconFolderOf(String(it.id), d.key === ICON_LIB ? null : d.key)
                      })),
                      {
                        label: iconFavs.includes(String(it.id))
                          ? '★ お気に入り解除'
                          : '☆ お気に入りに追加',
                        act: () => toggleIconFav(String(it.id))
                      }
                    ]
                  })
                }}
              />
            )}

            {/* --- SE（効果音の置き場）--- 中身は components/panels/SeLibraryTab.tsx */}
            {rightTab === 'se' && (
              <SeLibraryTab
                library={seLibrary}
                folders={seFolders}
                moved={seOv}
                favorites={seFavs}
                bodyRef={rightBodyRef}
                accSec={accSec}
                onAddFolder={addSeFolder}
                onDeleteFolder={deleteSeFolder}
                onRefresh={refreshSE}
                onImport={() => void importSeInto()}
                onImportFolder={() => void importSeInto('folder')}
                onDropPaths={(paths) => void importSeInto(paths)}
                onPreview={previewSE}
                onMoveTo={setSeFolderOf}
                onToggleFav={toggleSeFav}
                onDragStart={(s, e) =>
                  beginMediaDrag({ id: -1, path: s.path, name: s.name, kind: 'audio' }, e)
                }
                onAddAtPlayhead={(s) =>
                  addMediaAtPlayhead({ id: -1, path: s.path, name: s.name, kind: 'audio' })
                }
                onDragEnd={() => {
                  draggingMediaRef.current = null
                  setSeGhost(null)
                }}
                onContextMenu={(s, cur, e) => {
                  // 移動先の候補＝もとのフォルダ（SE/ の中の名前）＋自分で作ったフォルダ
                  const dests = [
                    ...Array.from(new Set(seLibrary.map((x) => x.category))).map((c) => ({
                      key: c,
                      label: c,
                      custom: false
                    })),
                    ...seFolders.map((f) => ({ key: f.key, label: f.label, custom: true }))
                  ]
                  setOrgMenu({
                    x: e.clientX,
                    y: e.clientY,
                    options: [
                      ...dests.map((d) => ({
                        label: `${cur === d.key ? '✓ ' : ''}${d.custom ? '📁 ' : ''}${d.label}`,
                        checked: cur === d.key,
                        act: () => setSeFolderOf(s.path, seMoveTarget(s, d.key))
                      })),
                      {
                        label: seFavs.includes(s.path) ? '★ お気に入り解除' : '☆ お気に入りに追加',
                        act: () => toggleSeFav(s.path)
                      }
                    ]
                  })
                }}
              />
            )}

            {/* --- トランジション --- 中身は components/panels/TransitionsTab.tsx。
                動画クリップもテロップも「頭・間・尻のどこにでも置ける」同じ扱い。 */}
            {rightTab === 'transition' &&
              (() => {
                // 選んでいる帯を、動画側とテロップ側で同じ形にしてから渡す
                const seg = selectedTrans && segments.find((s) => s.id === selectedTrans.segId)
                const vt = !seg
                  ? null
                  : selectedTrans!.kind === 'xfade'
                    ? seg.xfade
                    : selectedTrans!.kind === 'in'
                      ? seg.transIn
                      : seg.transOut
                const videoBand =
                  seg && vt && selectedTrans
                    ? {
                        ico: '🎯',
                        place:
                          selectedTrans.kind === 'xfade'
                            ? '間（クリップ同士）'
                            : selectedTrans.kind === 'in'
                              ? '頭（クリップ開始）'
                              : '尻（クリップ終わり）',
                        type: vt.type,
                        dur: vt.dur,
                        kinds: TRANS_TYPES,
                        onType: (t: string) => setSelectedTransType(t as TransType),
                        onDur: updateSelectedTransDur,
                        onDelete: deleteSelectedTrans,
                        onDeselect: () => setSelectedTrans(null)
                      }
                    : null
                const cue =
                  selectedTelopTrans && cues.find((c) => c.id === selectedTelopTrans.cueId)
                const anim = cue ? cue.style.anim : null
                const isIn = selectedTelopTrans?.kind === 'in'
                const telopBand =
                  cue && anim && selectedTelopTrans
                    ? {
                        ico: '💬',
                        place: `テロップ ${isIn ? '頭（出現）' : '尻（消失）'}`,
                        type: isIn ? anim.in : anim.out,
                        dur: isIn ? anim.inDur : anim.outDur,
                        kinds: TELOP_MOTIONS,
                        onType: (t: string) => setTelopTransType(t as AnimIn),
                        onDur: updateTelopTransDur,
                        onDelete: deleteSelectedTelopTrans,
                        onDeselect: () => setSelectedTelopTrans(null)
                      }
                    : null
                return (
                  <TransitionsTab
                    bodyRef={rightBodyRef}
                    accSec={accSec}
                    selectedVideoBand={videoBand}
                    selectedTelopBand={telopBand}
                    newDur={transDur}
                    onNewDur={setTransDur}
                    videoKinds={TRANS_TYPES}
                    telopKinds={TELOP_MOTIONS}
                    onDragStartVideo={(x, e) => {
                      draggingTransRef.current = { type: x.type as TransType }
                      setDragChip(e, x.ico, x.label)
                    }}
                    onDragEndVideo={() => {
                      draggingTransRef.current = null
                      setTransDrop(null)
                    }}
                    onDragStartTelop={(m, e) => {
                      draggingTelopAnimRef.current = { type: m.type as AnimIn }
                      setDragChip(e, m.ico, m.label)
                    }}
                    onDragEndTelop={() => {
                      draggingTelopAnimRef.current = null
                      setTelopDrop(null)
                    }}
                    onToggleEmphasis={toggleTelopEmphasis}
                    builtinMotions={BUILTIN_MOTIONS}
                    myMotions={myMotions}
                    motionPresets={motionPresets}
                    onApplyMotionPreset={applyMotionPreset}
                    onDeleteMyMotion={deleteMyMotion}
                  />
                )
              })()}
          </section>
          </PaneHost>
        </div>

        <div className="resizer resizer-h" onPointerDown={(e) => startResize('timeline', e)} />

        <PaneHost id="timeline" title={PANE_LABEL.timeline} popped={isPopped('timeline')}
            geom={paneGeom.timeline} onClose={() => unpopPane('timeline')}>
        {/* ===== タイムライン ===== */}
        <section
          className="timeline"
          style={{ height: timelineH, flex: '0 0 auto' }}
        >
          {/* 道具立ては components/timeline/TimelineToolbar.tsx */}
          <TimelineToolbar
            tool={tool}
            onTool={setTool}
            snap={snap}
            onToggleSnap={toggleSnap}
            canUndo={undoStackRef.current.length > 0 || isDirty()}
            canRedo={redoStackRef.current.length > 0}
            onUndo={undo}
            onRedo={redo}
            onSplit={cutAtPlayhead}
            onSilenceCut={() => {
              setSilenceOpen(true)
              if (!silenceCut.found && !silenceCut.busy) void findSilences()
            }}
            zoom={zoom}
            onZoom={zoomAroundPlayhead}
            onFit={fitTimelineZoom}
            hint={
              tool === 'razor'
                ? 'クリップをクリックで分割'
                : videoGhost?.moving
                  ? 'ドラッグで移動 / Alt=複製 / Ctrl=割り込み（後続が後ろへずれる）'
                  : videoGhost
                    ? 'ドロップで上書き配置 / Ctrl押しながらで挿入（後続がシフト）'
                    : `${formatCombo(shortcuts.undo)} 元に戻す / ${formatCombo(shortcuts.copy)}・${formatCombo(shortcuts.paste)} コピー貼付 / ${formatCombo(shortcuts.duplicate)} 複製 / ${formatCombo(shortcuts.split)} 分割 / ${formatCombo(shortcuts.addMarker)} マーカー / ホイール 横・Shift+ホイール 縦`
            }
            keyHint={{
              select: formatCombo(shortcuts.toolSelect),
              razor: formatCombo(shortcuts.toolRazor),
              snap: formatCombo(shortcuts.toggleSnap),
              undo: formatCombo(shortcuts.undo),
              redo: formatCombo(shortcuts.redo),
              split: formatCombo(shortcuts.split)
            }}
          />

          <div className="tl-body">
            {/* 左端のトラック高さ調整バー（丸グリップ2個：映像グループ／音声グループ）*/}
            {/* ※ここに「高さ調整の丸」の列を置いていたが廃止した。
                縦に送ると枠の外へ出て消え、掴んだ丸と実際の境目が離れることもあった。
                いまは段見出しの境目そのものを掴む（プレミアと同じ）。
                境目は見出しと一緒に動くので、見えている段の境目は必ず掴める。 */}

            {/* 段の見出し列は components/timeline/TrackHeaders.tsx */}
            <TrackHeaders
              tracks={tracks}
              stateOf={(id) => trackStates[id] ?? newTrackState(id)}
              selectedId={selectedTrackId}
              heightOf={trackHOf}
              padTop={padTop}
              padBottom={padBottom}
              bgmTrackId={EXTRA_AUDIO_TRACK}
              bodyRef={thBodyRef}
              onResizeStart={startGroupResize}
              onSelect={selectTrack}
              onRename={(id, current) =>
                askText('トラック名を変更', current, (v) => {
                  const name = v.trim()
                  if (!name) return
                  setTracks((prev) => prev.map((t) => (t.id === id ? { ...t, name } : t)))
                })
              }
              onToggle={toggleTrack}
              onAddVideoTrack={addVideoTrack}
              onAddAudioTrack={addAudioTrack}
              onAddBgm={() => void addBgm()}
            />

            {/* トラック領域 */}
            <div
              className="track-scroll"
              ref={scrollRef}
              // 縦に送ったら、見出し列・グリップ・目盛りに貼り付く物を追従させる。
              // 横に送ったときも呼ばれるが、やることは変わらないので分けない。
              onScroll={syncTimelineVScroll}
              // 範囲選択（マーキー）はレーンの中だけでなく、レーンの外——上下の余白、
              // 最後のレーンより下、素材の終わりより右——からでも始められる。
              // 掴む物の無い所で始めた投げ縄が「ここは対象外です」と無反応になるのは、
              // 使う側からは区別のつかない当たり判定を覚えろと言っているのと同じなので。
              // クリップ・マーカー・ルーラー・再生ヘッドは自分で伝播を止めるため、
              // ここまで上がってくるのは「何も無い所」だけになる。
              onPointerDown={onTrackAreaPointerDown}
              onDragEnter={(e) => {
                // ターゲット要素が切り替わる瞬間も許可し続ける（カット上で駐禁がチラつくのを防ぐ）。
                // 素材のドラッグもここで許可しないと、行と行の境目や余白に入った瞬間に
                // 駐禁マークが出て置けなくなる。
                if (
                  draggingTransRef.current ||
                  draggingTelopAnimRef.current ||
                  draggingMediaRef.current
                ) {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'copy'
                }
              }}
              onDragOver={(e) => {
                if (draggingTransRef.current) {
                  e.preventDefault() // 駐禁は出さない（どこでも受け付ける）
                  e.dataTransfer.dropEffect = 'copy'
                  const r = resolveTransDrop(e.clientX)
                  setTransDrop(
                    r
                      ? { segId: r.segId, left: r.left, width: r.width, label: r.label, kind: r.kind }
                      : null
                  )
                  return
                }
                // テロップ用トランジションもタイムライン全体で受け付ける（駐禁チラつき防止）。
                // 実際の頭/間/尻はテロップクリップ側 onDragOver がゴースト表示・確定する。
                if (draggingTelopAnimRef.current) {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'copy'
                  return
                }
                const m = draggingMediaRef.current
                if (m?.kind !== 'video' && m?.kind !== 'audio' && m?.kind !== 'image') return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'copy'
                // 置き先の判定と影づくりはアプリ全体で同じ関数を通す
                // （ここだけ別実装にすると、外へ出た瞬間に行き先が変わって見える）
                updateDropGhost(m, e.clientX, e.clientY, e.ctrlKey, e.target)
              }}
              onDragLeave={(e) => {
                // 素材の影はここでは消さない。外へ出ても「一番近い場所」を
                // 指し続けるほうが、行き先が分からなくならない。
                // 消すのは離した時か、途中でやめた時（onDragEnd）。
                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                  setTransDrop(null)
                  setTelopDrop(null)
                }
              }}
              onDrop={(e) => {
                e.preventDefault()
                if (draggingTransRef.current) {
                  applyTransDrop(e.clientX)
                  setTransDrop(null)
                  return
                }
                const m = draggingMediaRef.current
                clearDropGhosts()
                if (!m) return
                const rect = trackInnerRef.current?.getBoundingClientRect()
                const raw = rect ? Math.max(0, (e.clientX - rect.left) / zoomRef.current) : 0
                const yRel = rect ? e.clientY - rect.top : 0
                const t = snapClipStart(raw, dragSeDurRef.current)
                if (m.kind === 'video') {
                  const vt = videoDropLane(e, yRel)
                  if (vt !== 'V1') {
                    // V2以降 = 映像レイヤー（重ねる/差し込む）。音声は対の音声トラックに連動。
                    // レーンがまだ無ければ placeVClip 側で作られる。
                    void placeVClip(m, t, vt)
                  } else {
                    // V1 = 本編のカット列。ドロップ位置に配置（通常=上書き / Ctrl=挿入）
                    void placeVideoAtDrop(m.path, t, e.ctrlKey)
                  }
                } else if (m.kind === 'audio') {
                  void placeSE(m, t, dropLaneAt(yRel, 'audio', true) ?? 'A2')
                } else if (m.kind === 'image') {
                  placeImage(m, t, fallbackTrack(dropLaneAt(yRel, 'video', true) ?? 'V3', 'video'))
                }
              }}
            >
              <div
                className={`track-inner ${tool === 'trackFwd' ? 'cur-track-fwd' : tool === 'trackBack' ? 'cur-track-back' : ''}`}
                ref={trackInnerRef}
                style={{ width: duration * zoom }}
                onPointerMove={(e) => {
                  // **マウスを動かすだけで作り直していた。**
                  // 実測で、止めている間も毎秒80〜194回。ゲーミングマウスは
                  // 秒に何百回も動きを送ってくるので、素で受けると再生していなくても重い。
                  // 目盛りの印は秒60回も動けば十分なので、そこで頭打ちにする。
                  const now = performance.now()
                  if (now - lastHoverPaintRef.current < 16) return
                  lastHoverPaintRef.current = now
                  const rect = trackInnerRef.current?.getBoundingClientRect()
                  if (rect) setHoverX(e.clientX - rect.left)
                }}
                onPointerLeave={() => setHoverX(null)}
              >
                {/* 物差しまわり（目盛り・ホバー線・投げ縄・めじるし・再生ヘッド）は
                    components/timeline/Ruler.tsx。どれも「時間×拡大率＝横位置」で置くだけ。 */}
                <TimeRuler
                  ticks={rulerTicks}
                  hover={hoverX != null ? { x: hoverX, label: formatTime(hoverX / zoom) } : null}
                  onScrub={startScrub}
                />
                {/* 磁石が吸い付いた所。**点線**にしてある。
                    前は実線のピンクで出していて再生ヘッドと見分けが付かず、
                    邪魔なので消していた。ただ消すと今度は「効いているのか
                    分からない」になる。掴んでいる間だけ・点線・別の色、で出す。 */}
                {snapLineX != null && <div className="snap-line" style={{ left: snapLineX }} />}
                {marquee && (
                  <Marquee x0={marquee.x0} y0={marquee.y0} x1={marquee.x1} y1={marquee.y1} />
                )}
                <MarkerFlags
                  markers={markers.filter((mk) => inView(mk.t, mk.t))}
                  zoom={zoom}
                  selectedId={selectedMarkerId}
                  editingId={editingMarkerId}
                  timeLabel={(t) => formatTimecode(t, fps)}
                  onPointerDown={onMarkerPointerDown}
                  onStartRename={(id) => {
                    setSelectedMarkerId(id)
                    setEditingMarkerId(id)
                  }}
                  onRename={(id, label) => {
                    setMarkers((prev) => prev.map((m) => (m.id === id ? { ...m, label } : m)))
                    setEditingMarkerId(null)
                  }}
                  onCancelRename={() => setEditingMarkerId(null)}
                />

                <Playhead x={currentTime * zoom} onScrub={startScrub} />

                {/* 上の余白。端に貼り付いていると足す余地が見えず窮屈に感じる */}
                <div className="track-pad" style={{ height: padTop }} />
                {/* 各トラック */}
                {tracks.map((tr) => (
                  <div
                    key={tr.id}
                    data-tid={tr.id}
                    className={`track track-${tr.kind}`}
                    style={{
                      height: trackHOf(tr.id),
                      cursor:
                        tool === 'razor'
                          ? 'crosshair'
                          : tool === 'trackFwd'
                            ? 'e-resize'
                            : tool === 'trackBack'
                              ? 'w-resize'
                              : 'default'
                    }}
                  >
                    {/* テロップの帯は components/timeline/TelopBands.tsx。
                        本体・打った印・出入りの動きの3つが1本に乗っている */}
                    {tr.kind === 'video' && tr.id !== 'V1' && (
                      <TelopBands
                        trackId={tr.id}
                        zoom={zoom}
                        inView={inView}
                        cueTrack={cueTrack}
                        onPointerDown={onClipPointerDown}
                        onContextMenu={onClipContextMenu}
                        onTrimStart={onTrimStart}
                        draggingTelopAnimRef={draggingTelopAnimRef}
                        resolveTelopTransDrop={resolveTelopTransDrop}
                        applyTelopTransDrop={applyTelopTransDrop}
                        setTelopDrop={setTelopDrop}
                        stopPlayback={stopPlayback}
                        seekTo={seekTo}
                        motionLabel={motionLabel}
                        selectTelopTrans={selectTelopTrans}
                        startTransResize={startTransResize}
                        patchCueAnim={patchCueAnim}
                      />
                    )}
                    {/* 本編以外の段に並ぶ帯は components/timeline/OverlayClipBands.tsx。
                        重ねた動画は映像と音を別の段に描くが中身は1つ（どちらを掴んでも動く） */}
                    {tr.kind === 'video' && tr.id !== 'V1' && (
                      <VideoLayerBand
                        clips={vClips.filter((c) => c.track === tr.id)}
                        zoom={zoom}
                        vcLen={vcLen}
                        pairedAudioOf={pairedAudioOf}
                        mediaItems={mediaItems}
                        onPointerDown={onVClipPointerDown}
                        openClipMenu={openClipMenu}
                      />
                    )}
                    {tr.kind === 'audio' && (
                      <VideoLayerAudioBand
                        clips={vClips.filter((c) => 'A' + trackNum(c.track) === tr.id)}
                        zoom={zoom}
                        vcLen={vcLen}
                        mediaMeta={mediaMeta}
                        trackH={trackHOf('audio')}
                        onPointerDown={onVClipPointerDown}
                        openClipMenu={openClipMenu}
                      />
                    )}
                    {tr.kind === 'video' && tr.id !== 'V1' && (
                      <ImageBand
                        clips={imgClips.filter(
                          (c) => c.track === tr.id && inView(c.tStart, c.tStart + c.duration)
                        )}
                        zoom={zoom}
                        onPointerDown={onImgPointerDown}
                        openClipMenu={openClipMenu}
                      />
                    )}
                    {imgGhost && imgGhost.track === tr.id && (
                      <ImageGhost ghost={imgGhost} zoom={zoom} />
                    )}
                    {/* 出入りの動きを落とす先の予告（components/timeline/TelopBands.tsx）。
                        段に描く＝「間」は2テロップに跨って出せる */}
                    {tr.kind === 'video' && tr.id !== 'V1' && telopDrop && (
                      <TelopDropGhost trackId={tr.id} drop={telopDrop} cueTrack={cueTrack} />
                    )}
                    {/* 本編の映像の帯は components/timeline/MainClipBands.tsx */}
                    {tr.id === 'V1' && videoSrc && (
                      <MainVideoBands
                        segLayout={segLayout}
                        zoom={zoom}
                        inView={inView}
                        srcOfSeg={srcOfSeg}
                        overwriteIds={overwriteIds}
                        onPointerDown={onSegPointerDown}
                        onTrimStart={onSegTrimStart}
                        openClipMenu={openClipMenu}
                      />
                    )}
                    {/* 映像と音はセットなので、対の音声段にも同じ位置・長さで出す */}
                    {tr.id === videoGhost?.track && videoGhost && (
                      <VideoGhost ghost={videoGhost} zoom={zoom} />
                    )}
                    {videoGhost && tr.id === 'A' + trackNum(videoGhost.track) && (
                      <VideoAudioGhost ghost={videoGhost} zoom={zoom}
                        meta={mediaMeta[videoGhost.path]} trackH={trackHOf('audio')} />
                    )}
                    {/* トランジションの帯は components/timeline/TransitionBands.tsx。
                        帯は「実際に効いている区間」に描く（カットの手前 d 秒） */}
                    {tr.id === 'V1' && videoSrc && (
                      <TransitionBands
                        segLayout={segLayout}
                        zoom={zoom}
                        selectedTrans={selectedTrans}
                        onSelect={selectTransition}
                        onResizeStart={startTransResize}
                        onSetDur={setVideoTransDur}
                      />
                    )}
                    {tr.id === 'V1' && transDrop && (
                      <TransDropGhost drop={transDrop} segLayout={segLayout} zoom={zoom} />
                    )}
                    {/* 本編の音の帯（同上）。V1 と同じ切片を波形で描く */}
                    {tr.id === 'A1' && videoSrc && (
                      <MainAudioBands
                        segLayout={segLayout}
                        zoom={zoom}
                        inView={inView}
                        srcOfSeg={srcOfSeg}
                        trackH={trackHOf('audio')}
                        onPointerDown={onSegPointerDown}
                      />
                    )}
                    {/* 効果音・BGM の帯は components/timeline/SeBands.tsx */}
                    {tr.kind === 'audio' && (
                      <SeBands
                        trackId={tr.id}
                        zoom={zoom}
                        inView={inView}
                        onPointerDown={onSePointerDown}
                        openClipMenu={openClipMenu}
                      />
                    )}
                    {/* 掴んで運んでいる最中の置き場所プレビューは
                        components/timeline/DropGhosts.tsx */}
                    {seGhost && seGhost.track === tr.id && (
                      <SeGhost ghost={seGhost} zoom={zoom} meta={mediaMeta[seGhost.path]}
                        trackH={trackHOf('audio')} />
                    )}
                  </div>
                ))}
                {/* 下の余白。位置の計算には効かないので、上と同じ高さでなくてよい */}
                <div className="track-pad" style={{ height: padBottom }} />
              </div>
            </div>
          </div>
        </section>
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

      {/* ===== 書き出し中オーバーレイ ===== */}
      {/* 出入りのダイアログは components/dialogs/ProjectDialogs.tsx */}
      {showExportDialog && (
        <ExportSettingsDialog
          opts={exportOpts}
          onChange={(patch) => setExportOpts((o) => ({ ...o, ...patch }))}
          sourceFpsLabel={fpsLabel(srcFpsForExport())}
          onExport={() => {
            setShowExportDialog(false)
            void exportProject()
          }}
          onClose={() => setShowExportDialog(false)}
        />
      )}
      {exportStatus && (
        <ExportProgressBox
          status={exportStatus}
          percent={exportPct}
          onCancel={() => {
            setExportStatus('キャンセル中…')
            void window.giftcut.cancelExport()
          }}
        />
      )}
      {restorePrompt && (
        <RestorePrompt
          state={restorePrompt}
          onDiscard={() => {
            void window.giftcut.autosaveClear()
            setRestorePrompt(null)
          }}
          onRestore={(data, videoExists) => {
            setRestorePrompt(null)
            void applyProjectData(data, videoExists, null)
          }}
        />
      )}
      {subtitleOpen && (
        <SubtitleDialog
          model={subModel}
          state={subtitleState}
          maxChars={subMaxChars}
          onMaxChars={(n) => {
            setSubMaxChars(n)
            saveLS('giftcut.subMaxChars', n)
          }}
          replace={subReplace}
          onReplace={setSubReplace}
          hasTelops={cues.length > 0}
          onRun={() => void runSubtitles()}
          onCancel={() => void window.giftcut?.cancelSubtitles?.()}
          onClose={() => setSubtitleOpen(false)}
        />
      )}

      {templatePicker && (
        <TemplatePicker
          items={templatePicker.items}
          startup={templatePicker.startup}
          onPick={(path) => void pickTemplate(path)}
          onDelete={(t) => {
            void window.giftcut?.deleteTemplate?.(t.path).then(async (r) => {
              if (!r?.ok) {
                showToast(`消せませんでした。\n${r?.error ?? ''}`)
                return
              }
              // 消したあとの一覧を出し直す。**残ったままだと消えたのか分からない**
              const next = await window.giftcut.listTemplates()
              const items = next?.ok ? next.items : []
              if (items.length) setTemplatePicker((p) => (p ? { ...p, items } : p))
              else setTemplatePicker(null) // 空になったら閉じる（何も無い箱を見せない）
              showToast(`「${t.name}」を消しました。`)
            })
          }}
          onOpenFolder={() => {
            void window.giftcut?.openFolder?.('template').then((r) => {
              if (!r?.ok) showToast(`フォルダを開けませんでした。\n${r?.error ?? ''}`)
            })
          }}
          onClose={() => setTemplatePicker(null)}
        />
      )}

      {/* 音まわりのダイアログは components/dialogs/AudioDialogs.tsx */}
      {silenceOpen && (
        <SilenceCutDialog
          state={silenceCut}
          onChange={(patch) => setSilenceCut((st) => ({ ...st, ...patch }))}
          cuts={silenceCuts}
          totalSec={totalCutLen(silenceCuts)}
          onFind={() => void findSilences()}
          onApply={applySilenceCut}
          onClose={() => setSilenceOpen(false)}
        />
      )}
      {duckOpen && (
        <DuckingDialog
          opts={duckOpts}
          onChange={(patch) => setDuckOpts((d) => ({ ...d, ...patch }))}
          busy={silenceCut.busy}
          found={!!silenceCut.found}
          voiceCount={
            silenceCut.found ? voiceRegions(silenceCut.found, totalSegLen(segments)).length : 0
          }
          hasEnvelope={duckEnv.length > 0}
          onFind={() => void findSilences()}
          onClose={() => setDuckOpen(false)}
        />
      )}

      {/* SE 再生用の隠し audio 要素。全クリップぶん常設すると Chromium のメディア要素上限に
          触れて新しい要素が読み込めず無音になるため、再生ヘッド近傍だけをマウントする。
          後ろ側（1秒）に余裕を持たせて、区間を出た瞬間に音がぶつ切りになるのを防ぐ。 */}
      {seClips
        .filter(
          (clip) =>
            currentTime >= clip.tStart - 3 && currentTime < clip.tStart + clip.duration + 1
        )
        .map((clip) => (
          <audio key={clip.id} src={toGcUrl(clip.path)} preload="auto" ref={seRefCb(clip.id)} />
        ))}

      {/* 設定のダイアログは components/dialogs/SettingsDialogs.tsx */}
      {prefsOpen && (
        <ShortcutSettings
          actions={ACTION_LIST}
          groups={['ファイル', 'ツール', '再生', '編集']}
          shortcuts={shortcuts}
          capturingId={capturingId}
          onCapture={setCapturingId}
          onReset={resetShortcuts}
          onClose={() => {
            setPrefsOpen(false)
            setCapturingId(null)
          }}
          formatCombo={formatCombo}
        />
      )}
      {iconSettingsOpen &&
        (() => {
          // 使用中の色だけ出す（全色ズラッと並べない）。
          // 割当済みの色は使っていなくても出す＝解除できるように。
          const usedLabels = new Set(cues.map((c) => c.label))
          return (
            <IconAssignSettings
              library={iconLibrary}
              colorRows={LABEL_COLORS.filter(
                (l) => usedLabels.has(l.color) || iconAssign[l.color]
              )}
              laneRows={tracks
                .filter((t) => t.kind === 'video' && t.id !== 'V1')
                .map((t) => ({
                  id: t.id,
                  label: t.id === 'V2' ? 'V2 テロップ' : t.name || t.id
                }))}
              colorAssign={iconAssign}
              laneAssign={laneIconAssign}
              onAssignColor={setIconForColor}
              onAssignLane={setIconForLane}
              hasTelop={cues.length > 0}
              onClose={() => setIconSettingsOpen(false)}
            />
          )
        })()}

      {/* ===== アイコン画像のクロップ（ライブラリ追加時）===== */}
      {cropSrc && (
        <CropModal
          src={cropSrc.src}
          ringColor="#8fa8c0"
          onCancel={() => setCropSrc(null)}
          onConfirm={(image) => {
            cropSrc.onDone(image)
            setCropSrc(null)
          }}
        />
      )}

      {/* 動きの計測（Ctrl+Shift+P）。**配布ビルドでも出る**。
          カクついた瞬間の数字が見えないと、何が詰まったのか分からない。 */}
      {perfOpen && (
        <Suspense fallback={null}>
          <PerfHud onClose={() => { perf.stop(); setPerfOpen(false) }} />
        </Suspense>
      )}
      {/* 開発中だけ出る「測定停止」。
          ※ここには検査票（動作確認チェックリスト）を置いていたが、使われないまま
          場所を取っていたので入れ替えた。開発中は起動と同時にずっと測っているので、
          **止めたい時に押す**のがここ。直したら再起動＝また自動で測り始める。
          見た目もここに書く（styles.css に置くと配布ビルドに残るため）。 */}
      {import.meta.env.DEV && (
        <button
          onClick={() => {
            perf.stop()
            void window.giftcut?.savePerfReport?.(perf.report()).then((r) => {
              showToast(r?.ok ? `測定を止めました。記録: ${r.path}` : '記録を書けませんでした')
            })
            setPerfStopped(true)
          }}
          disabled={perfStopped}
          title="ここまでの記録を書き出して測定を止めます（再起動でまた測り始めます）"
          style={{
            position: 'fixed',
            right: 12,
            bottom: 12,
            zIndex: 8000,
            background: '#1b2027',
            color: perfStopped ? '#6b7280' : '#e0a94a',
            border: '1px solid #3a3320',
            borderRadius: 999,
            padding: '6px 14px',
            fontSize: 12,
            letterSpacing: '0.06em',
            cursor: perfStopped ? 'default' : 'pointer',
            opacity: 0.72
          }}
        >
          {perfStopped ? '測定を止めました' : '測定停止'}
        </button>
      )}

      {/* 重ねて出す小物（お知らせ・文字入力・確認）は components/Overlays.tsx。
          形だけの部品なので、状態はここ（App）が持ったまま渡す。 */}
      <Toasts items={toasts} />
      {promptState && (
        <PromptModal
          state={promptState}
          onChange={(v) => setPromptState((st) => (st ? { ...st, value: v } : st))}
          onClose={() => setPromptState(null)}
        />
      )}
      {confirmState && <ConfirmModal state={confirmState} onClose={closeConfirm} />}

      {/* 右クリックメニューは components/ContextMenu.tsx に1つだけ置き、
          ここでは「何を並べるか」だけを書く。 */}

      {/* タブの右クリック: そのパネル（と他のパネル）の切り離し */}
      {tabMenu &&
        (() => {
          const pane: PaneId = tabMenu.group === 'monitor' ? 'preview' : 'right'
          const toggle = (id: PaneId): void => {
            if (isPopped(id)) unpopPane(id)
            else popPane(id)
            setTabMenu(null)
          }
          return (
            <ContextMenu
              x={tabMenu.x}
              y={tabMenu.y}
              innerRef={clampMenu}
              entries={[
                { kind: 'title', label: PANE_LABEL[pane] },
                // 切り離す＝窓にする。それだけ。「画面の中で浮かせる」と
                // 「別ウィンドウで開く」を分けていたが、窓なら本体の上にも
                // 別モニターにも置けるので、分ける意味が無かった。
                {
                  kind: 'item',
                  label: isPopped(pane) ? '⇤ 元の場所に戻す' : '⇱ このパネルを切り離す',
                  onClick: () => toggle(pane)
                },
                { kind: 'sep' },
                // 他のパネルもここから。左パネルとタイムラインにはタブの
                // 右クリックが無いので、ここが唯一の入口になる。
                ...(['left', 'preview', 'right', 'timeline'] as PaneId[])
                  .filter((id) => id !== pane)
                  .map(
                    (id) =>
                      ({
                        kind: 'item',
                        label: isPopped(id)
                          ? `⇤ ${PANE_LABEL[id]} を戻す`
                          : `⇱ ${PANE_LABEL[id]} を切り離す`,
                        onClick: () => toggle(id)
                      }) as const
                  )
              ]}
            />
          )
        })()}

      {/* ≫: 見えていないタブと、並び替え */}
      {tabOverflow && (
        <ContextMenu
          x={tabOverflow.x}
          y={tabOverflow.y}
          innerRef={clampMenu}
          entries={[
            { kind: 'title', label: tabOverflow.hidden.length ? '見えていないタブ' : 'タブを選ぶ' },
            ...orderedTabs(tabOverflow.group, TAB_DEFS[tabOverflow.group] ?? [])
              .filter((t) => !tabOverflow.hidden.length || tabOverflow.hidden.includes(t.id))
              .map(
                (t) =>
                  ({
                    kind: 'item',
                    label: t.label,
                    onClick: () => {
                      pickTab(tabOverflow.group, t.id)
                      setTabOverflow(null)
                    }
                  }) as const
              ),
            // もう1つのコーナー: 並び替え。帯の上で掴んで動かす方法は残してあるが、
            // パネルが狭いと掴むタブ自体が見えない。ここなら幅に関係なく必ず変えられる。
            { kind: 'sep' },
            { kind: 'title', label: '並び替え' },
            { kind: 'note', label: '長押ししてから上下に動かす' },
            {
              kind: 'node',
              node: (
                <TabSortList
                  tabs={orderedTabs(tabOverflow.group, TAB_DEFS[tabOverflow.group] ?? [])}
                  active={tabOverflow.group === 'monitor' ? monitorTab : rightTab}
                  onReorder={(ids) => setTabOrder((p) => ({ ...p, [tabOverflow.group]: ids }))}
                />
              )
            }
          ]}
        />
      )}

      {/* テロップの右クリック */}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          innerRef={clampMenu}
          entries={[
            {
              kind: 'title',
              label: `ラベルカラー${
                isSelected(menu.cueId) && selectedIds.length > 1 ? `（${selectedIds.length}個）` : ''
              }`
            },
            {
              kind: 'swatches',
              colors: LABEL_COLORS,
              onPick: (color) => {
                setLabelFor(menu.cueId, color)
                setMenu(null)
              }
            },
            { kind: 'sep' },
            {
              kind: 'item',
              label: '同じ色をまとめて選択',
              onClick: () => {
                const c = cues.find((x) => x.id === menu.cueId)
                if (c) selectByLabel(c.label)
                setMenu(null)
              }
            },
            { kind: 'sep' },
            {
              kind: 'item',
              label: `設定をコピー（位置・大きさ・見た目）（${formatCombo(shortcuts.attrCopy)}）`,
              onClick: () => {
                copyAttributes()
                setMenu(null)
              }
            },
            !!copiedAttrs && {
              kind: 'item',
              label: `設定を貼り付け: ${attrSummary(copiedAttrs)}（${formatCombo(shortcuts.attrPaste)}）`,
              onClick: () => {
                pasteAttributes()
                setMenu(null)
              }
            },
            { kind: 'sep' },
            {
              kind: 'item',
              label: 'リップル削除（詰める）',
              onClick: () => {
                rippleDeleteSelected()
                setMenu(null)
              }
            },
            {
              kind: 'item',
              label: '選択を削除',
              danger: true,
              onClick: () => {
                deleteSelected()
                setMenu(null)
              }
            }
          ]}
        />
      )}

      {/* 動画切片 / SE・BGM / 画像 の右クリック（テロップ以外の共通操作） */}
      {clipMenu && (
        <ContextMenu
          x={clipMenu.x}
          y={clipMenu.y}
          innerRef={clampMenu}
          entries={[
            {
              kind: 'title',
              label: `${clipMenu.kind === 'se' ? '🔊' : clipMenu.kind === 'img' ? '🖼' : '🎬'} ${clipMenu.name}`
            },
            // ラベルカラー: どのクリップにも付けられる
            {
              kind: 'swatches',
              colors: LABEL_COLORS,
              onPick: (color) => {
                setClipLabel(clipMenu.kind, clipMenu.id, color)
                setClipMenu(null)
              },
              onNone: () => {
                setClipLabel(clipMenu.kind, clipMenu.id, undefined)
                setClipMenu(null)
              }
            },
            // BGM を敷くなら必須の機能なので、音のクリップの右クリックに直接置く
            clipMenu.kind === 'se' && {
              kind: 'item',
              label: seClips.find((c) => c.id === clipMenu.id)?.duck
                ? '🎚 声に合わせて下げるのをやめる'
                : '🎚 声に合わせて下げる（ダッキング）',
              onClick: () => {
                const on = !seClips.find((c) => c.id === clipMenu.id)?.duck
                setSeClips((prev) =>
                  prev.map((c) => (c.id === clipMenu.id ? { ...c, duck: on } : c))
                )
                setClipMenu(null)
                if (on) {
                  setDuckOpen(true)
                  // 声の位置が分からないと下げようがない。まだ調べていなければ調べる
                  if (!silenceCut.found && !silenceCut.busy) void findSilences()
                }
              }
            },
            clipMenu.kind !== 'seg' && {
              kind: 'item',
              label: `コピー（${formatCombo(shortcuts.copy)}）`,
              onClick: () => {
                copySelected()
                setClipMenu(null)
              }
            },
            {
              kind: 'item',
              label: `複製（${formatCombo(shortcuts.duplicate)}）`,
              onClick: () => {
                duplicateClipsFromMenu(clipMenu.kind)
                setClipMenu(null)
              }
            },
            clipMenu.kind === 'seg' && {
              kind: 'item',
              label: `再生ヘッドで分割（${formatCombo(shortcuts.split)}）`,
              onClick: () => {
                splitVideoAtPlayhead()
                setClipMenu(null)
              }
            },
            clipMenu.kind === 'seg' && {
              kind: 'item',
              label: '映像だけ消す / 戻す（音と長さは残す）',
              onClick: () => {
                toggleBlankSelectedVideo()
                setClipMenu(null)
              }
            },
            { kind: 'sep' },
            {
              kind: 'item',
              label: `設定をコピー（${formatCombo(shortcuts.attrCopy)}）`,
              onClick: () => {
                copyAttributes()
                setClipMenu(null)
              }
            },
            !!copiedAttrs && {
              kind: 'item',
              label: `設定を貼り付け: ${attrSummary(copiedAttrs)}（${formatCombo(shortcuts.attrPaste)}）`,
              onClick: () => {
                pasteAttributes()
                setClipMenu(null)
              }
            },
            { kind: 'sep' },
            // 本編以外は「消して同じトラックの後続を詰める」も選べる
            // （本編の削除は元から詰める動作なので出さない）
            clipMenu.kind !== 'seg' && {
              kind: 'item',
              label: 'リップル削除（このトラックの後続を詰める）',
              onClick: () => {
                rippleDeleteSelected()
                setClipMenu(null)
              }
            },
            // 本編は「消すだけ（空きが残る）」と「消して詰める」の2つを出す。
            // どちらになるか分からないまま押すと、後ろのタイミングが崩れて事故になる。
            clipMenu.kind === 'seg' && {
              kind: 'item',
              label: `削除して詰める（${formatCombo(shortcuts.rippleDel)}）`,
              onClick: () => {
                rippleDeleteVideoSegments()
                setClipMenu(null)
              }
            },
            {
              kind: 'item',
              danger: true,
              label: `${clipMenu.kind === 'seg' ? '削除（詰めない）' : '削除'}（${formatCombo(shortcuts.del)}）`,
              onClick: () => {
                if (clipMenu.kind === 'vclip') deleteSelectedVClip()
                else if (clipMenu.kind === 'seg') deleteVideoSegmentsLeavingGap()
                else if (clipMenu.kind === 'se') deleteSelectedSE()
                else deleteSelectedImg()
                setClipMenu(null)
              }
            }
          ]}
        />
      )}

      {/* テロップカード: フォルダ（カテゴリ）へ移動 */}
      {tplMenu && (
        <ContextMenu
          x={tplMenu.x}
          y={tplMenu.y}
          innerRef={clampMenu}
          entries={[
            { kind: 'title', label: 'フォルダへ移動' },
            ...allCats.map(
              (c) =>
                ({
                  kind: 'item',
                  on: tplMenu.curCat === c.key,
                  label: `${tplMenu.curCat === c.key ? '✓ ' : ''}${
                    customCats.some((cc) => cc.key === c.key) ? '📁 ' : ''
                  }${c.label}`,
                  onClick: () => {
                    setTplCat(tplMenu.name, c.key)
                    setTplMenu(null)
                  }
                }) as const
            ),
            { kind: 'sep' },
            {
              kind: 'item',
              label: isFav(tplMenu.name) ? '★ お気に入り解除' : '☆ お気に入りに追加',
              onClick: () => {
                toggleFav(tplMenu.name)
                setTplMenu(null)
              }
            }
          ]}
        />
      )}

      {/* SE/アイコン: フォルダ移動＋お気に入り（テロップと同じ見た目） */}
      {orgMenu && (
        <ContextMenu
          x={orgMenu.x}
          y={orgMenu.y}
          innerRef={clampMenu}
          entries={[
            { kind: 'title', label: 'フォルダへ移動' },
            ...orgMenu.options.map(
              (o) =>
                ({
                  kind: 'item',
                  on: o.checked,
                  label: o.label,
                  onClick: () => {
                    o.act()
                    setOrgMenu(null)
                  }
                }) as const
            )
          ]}
        />
      )}
    </div>
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
                            <AppInner />
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
