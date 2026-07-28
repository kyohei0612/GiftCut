import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { parseSrt, buildSrt, formatTime, type Cue } from './lib/srt'
import {
  anchorFrac,
  buildTelopSVG,
  computeTelopAnim,
  defaultAnim,
  defaultTelopStyle,
  hasAnim,
  hexToRgba,
  type AnimIn,
  type TelopAnim,
  type TelopStyle,
  type TextRun
} from './lib/telopStyle'
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
import CropModal from './components/CropModal'
import StylePanel from './components/StylePanel'
import TelopText from './components/TelopText'
import WaveformCanvas from './components/WaveformCanvas'
// 検査票（動作確認チェックリスト）。開発中だけ読み込む。
// import.meta.env.DEV は本番ビルドで false になるので、この分岐ごと
// 消えて dev/ 配下は配布物に入らない。
const QaPanel = import.meta.env.DEV ? lazy(() => import('./dev/QaPanel')) : null
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
const AUTOSAVE_MS = 5 * 60 * 1000

/**
 * 重い下準備（サムネ・波形・尺）を、同時に走る数を絞って順に流す。
 *
 * 素材ビンに並んだぶんだけ一斉に ffmpeg を起こしていたため、
 * 2000件のプロジェクトを開くのに69秒かかっていた（実測）。
 * 数を絞れば、先頭から順に出そろい、その間も操作できる。
 */
function makeJobQueue(limit: number): (job: () => Promise<unknown>) => void {
  const waiting: (() => Promise<unknown>)[] = []
  let running = 0
  const pump = (): void => {
    while (running < limit && waiting.length) {
      const job = waiting.shift() as () => Promise<unknown>
      running++
      void job().finally(() => {
        running--
        pump()
      })
    }
  }
  return (job) => {
    waiting.push(job)
    pump()
  }
}
// 同時に4本まで。増やすと出そろうのは速いが、その間アプリ全体が重くなる。
const mediaQueue = makeJobQueue(4)

/**
 * マウスの動きを「1フレームに1回」へまとめる。
 *
 * マウスは1秒に100回以上動くが、画面は60回しか描き替わらない。
 * まとめないと、描いても見えない絵のために毎回タイムライン全体を作り直すことになる。
 * クリップが増えるほどこれが効いてくる（1000個で1操作75ms かかっていた）。
 *
 * 使うときの約束:
 *   - 離した時に flush() を呼ぶ（最後の位置を取りこぼさない）
 *   - その後に cancel() を呼ぶ（フレーム待ちのまま残さない）
 */
function rafThrottle<T>(fn: (arg: T) => void): {
  run: (arg: T) => void
  flush: () => void
  cancel: () => void
} {
  let id = 0
  let last: T | null = null
  const fire = (): void => {
    const a = last
    last = null
    if (a !== null) fn(a)
  }
  return {
    run: (arg: T) => {
      last = arg
      if (id) return
      id = requestAnimationFrame(() => {
        id = 0
        fire()
      })
    },
    flush: () => {
      if (last !== null) fire()
    },
    cancel: () => {
      if (id) cancelAnimationFrame(id)
      id = 0
      last = null
    }
  }
}

// トラック高さ（映像/音声グループごとにまとめて可変）。デフォはプレミア風に少し狭め
const TRACK_H_MIN = 26
const TRACK_H_MAX = 160

// 動画セグメント（切片）。常に隙間なく連続して並ぶ＝リップル前提。
interface VSeg {
  id: number
  srcId?: number // どの元動画か（マルチソース）。未指定=主ソース(sources[0])。
  srcStart: number // ソース動画内のイン点（秒）
  srcEnd: number // アウト点（秒）
  muted?: boolean // この区間の音声を消す（動画は残す）
  videoBlank?: boolean // この区間の映像を黒にする（長さは維持＝詰めない。音声は残る）
  speed?: number // 再生速度（1=等速, 2=2倍速, 0.5=スロー）。未指定は1
  // 頭(transIn)/尻(transOut)/次クリップとの間(xfade)。全て同じ TransType＝どの種類もどこにでも置ける。
  transIn?: SegTrans
  transOut?: SegTrans
  xfade?: SegTrans
  // 色調整（明るさ/コントラスト/彩度）。倍率で 1=無調整。プレビュー=CSS filter、書き出し=ffmpeg eq。
  adjust?: { b: number; c: number; s: number }
  rotate?: number // 回転角（度・時計回り、自由角度）。未指定=0
  flipH?: boolean // 左右反転
  flipV?: boolean // 上下反転
  vol?: number // この切片の音量倍率（0=無音, 1=等倍）。未指定=1
  afadeIn?: number // 音声フェードイン（秒）
  afadeOut?: number // 音声フェードアウト（秒）
  zoom?: { scale: number; x: number; y: number } // リフレーム（拡大率＋中心オフセット, フレーム比）
  crop?: { l: number; t: number; r: number; b: number } // クロップ（各辺の切り抜き率 0..1。切った領域は黒）
  label?: string // ラベルカラー（テロップと同じ。素材の見分け用）
  gap?: boolean // タイムラインの空白（映像なし・無音）。「位置を指定して配置」した際の隙間埋め。
}
const DEFAULT_ZOOM = { scale: 1, x: 0, y: 0 }
const isNeutralZoom = (z?: { scale: number; x: number; y: number }): boolean =>
  !z || (Math.abs(z.scale - 1) < 1e-3 && z.x === 0 && z.y === 0)
const DEFAULT_CROP = { l: 0, t: 0, r: 0, b: 0 }
const isNeutralCrop = (c?: { l: number; t: number; r: number; b: number }): boolean =>
  !c || (c.l < 1e-4 && c.t < 1e-4 && c.r < 1e-4 && c.b < 1e-4)
// クロップのCSS（プレビュー用・clip-path inset）。切った辺は下地(チェッカー)が見える。
const cropInset = (c?: { l: number; t: number; r: number; b: number }): string | undefined =>
  isNeutralCrop(c)
    ? undefined
    : `inset(${(c!.t * 100).toFixed(2)}% ${(c!.r * 100).toFixed(2)}% ${(c!.b * 100).toFixed(2)}% ${(c!.l * 100).toFixed(2)}%)`
const DEFAULT_ADJUST = { b: 1, c: 1, s: 1 }
// 色調整が実質「無調整」か
const isNeutralAdjust = (a?: { b: number; c: number; s: number }): boolean =>
  !a || (Math.abs(a.b - 1) < 1e-3 && Math.abs(a.c - 1) < 1e-3 && Math.abs(a.s - 1) < 1e-3)
// CSS filter 文字列（プレビュー用）
const adjustCss = (a?: { b: number; c: number; s: number }): string | undefined =>
  isNeutralAdjust(a) ? undefined : `brightness(${a!.b}) contrast(${a!.c}) saturate(${a!.s})`
// トランジションの種類。頭/間/尻すべてで共通に使う（ffmpeg xfade の transition 名がベース）。
// dipblack/dipwhite は「間」では fadeblack/fadewhite（黒/白に沈んで戻る）、頭/尻では黒/白フェード。
type TransType =
  | 'fade'
  | 'dipblack'
  | 'dipwhite'
  | 'slideleft'
  | 'slideright'
  | 'slideup'
  | 'slidedown'
  | 'wipeleft'
  | 'wiperight'
const TRANS_TYPES: { type: TransType; ico: string; label: string }[] = [
  { type: 'fade', ico: '◧', label: 'ディゾルブ' },
  { type: 'dipblack', ico: '🌑', label: '黒フェード' },
  { type: 'dipwhite', ico: '⚡', label: '白フェード' },
  { type: 'slideright', ico: '➡', label: 'スライド右' },
  { type: 'slideleft', ico: '⬅', label: 'スライド左' },
  { type: 'slideup', ico: '⬆', label: 'スライド上' },
  { type: 'slidedown', ico: '⬇', label: 'スライド下' },
  { type: 'wiperight', ico: '▶', label: 'ワイプ右' },
  { type: 'wipeleft', ico: '◀', label: 'ワイプ左' }
]
const transLabel = (t?: TransType): string =>
  TRANS_TYPES.find((x) => x.type === (t ?? 'fade'))?.label ?? 'ディゾルブ'
const transIco = (t?: TransType): string =>
  TRANS_TYPES.find((x) => x.type === (t ?? 'fade'))?.ico ?? '◧'
// dip系のフェード色（頭/尻フェードの色）。fade も黒扱い。slide/wipe は null。
const dipColor = (t: TransType): 'black' | 'white' | null =>
  t === 'dipwhite' ? 'white' : t === 'dipblack' || t === 'fade' ? 'black' : null
// タイムライン帯のクラス（見た目: 黒/白ディップ or モーション）。
const bandClass = (t: TransType): string =>
  t === 'dipwhite'
    ? 'ttrans-dip ttrans-white'
    : t === 'dipblack'
      ? 'ttrans-dip ttrans-black'
      : t === 'fade'
        ? 'ttrans-xfade'
        : 'ttrans-motion'
// クリップ単体（頭/尻）または間の1トランジション。
interface SegTrans {
  type: TransType
  dur: number // 秒
}
// 保存データ→SegTrans 復元。旧形式 {color:'black'|'white'} は dip系へ移行。不正は undefined。
/* eslint-disable @typescript-eslint/no-explicit-any */
function loadSegTrans(raw: any): SegTrans | undefined {
  if (!raw || !(Number(raw.dur) > 0)) return undefined
  const dur = Number(raw.dur)
  if (TRANS_TYPES.some((x) => x.type === raw.type)) return { type: raw.type as TransType, dur }
  // 旧: 色ディップ
  if (raw.color === 'white') return { type: 'dipwhite', dur }
  if (raw.color === 'black') return { type: 'dipblack', dur }
  // 旧 xfade: type 無し＝fade
  return { type: 'fade', dur }
}
/* eslint-enable @typescript-eslint/no-explicit-any */
// プレビュー解像度。'orig'=原本をそのまま再生、数値=その高さの編集用プロキシ。
type PreviewRes = 'orig' | 720 | 360
// 元動画（マルチソース）。1タイムラインに複数の動画を連結できる。
interface Source {
  id: number
  path: string // 原本パス（書き出しに使用＝無劣化）
  name: string
  origUrl: string // 原本の gcfile URL（プレビュー用プロキシは path をキーに proxyMap で持つ）
  duration: number
  fps: number
  // 波形は自分が解析した音声の長さ(dur)も持つ。動画の尺で位置を計算すると
  // 音声ストリームとの尺差ぶん、後ろに行くほど再生ヘッドとズレる。
  waveform?: { min: number[]; max: number[]; dur: number } | null
}
type SegLayout = Layout<VSeg>
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

interface Track {
  id: string
  name: string
  kind: 'video' | 'audio'
}
// 初期トラック（映像は先頭に連続、音声はその後に連続）。+ボタンで増やせる。
const DEFAULT_TRACKS: Track[] = [
  { id: 'V3', name: 'V3', kind: 'video' }, // テロップ上段（V2から上下移動できる先）
  { id: 'V2', name: 'V2 テロップ', kind: 'video' },
  { id: 'V1', name: 'V1 動画', kind: 'video' },
  { id: 'A1', name: 'A1 音声', kind: 'audio' },
  { id: 'A2', name: 'A2 SE', kind: 'audio' },
  { id: 'A3', name: 'A3', kind: 'audio' } // 追加音声トラック（BGM等）
]
// 既定で用意する追加音声トラック（クイック追加ボタンの対象・旧プロジェクト補完先）
const EXTRA_AUDIO_TRACK = 'A3'

// ---- キーボードショートカット定義 ----
const DEFAULT_SHORTCUTS = {
  toolSelect: 'v',
  toolRazor: 'c',
  toggleSnap: 's',
  playPause: 'space',
  shuttleFwd: 'l',
  shuttleStop: 'k',
  shuttleRev: 'j',
  gotoStart: 'home',
  gotoEnd: 'end',
  frameBack: 'arrowleft',
  frameFwd: 'arrowright',
  frameBack5: 'shift+arrowleft',
  frameFwd5: 'shift+arrowright',
  del: 'd',
  rippleDel: 'f',
  attrCopy: 'ctrl+alt+c',
  attrPaste: 'ctrl+alt+v',
  // Premiere 準拠: Q=リップルトリム前方 / W=リップルトリム後方。
  // 以前は A / F だったが、Premiere の A は非破壊のトラック選択ツールなので
  // 「押したら映像が削られる」事故になっていた。
  rippleToPrevCut: 'q',
  rippleToNextCut: 'w',
  selectAll: 'ctrl+a',
  deselect: 'escape',
  undo: 'ctrl+z',
  redo: 'ctrl+y',
  copy: 'ctrl+c',
  cut: 'ctrl+x',
  paste: 'ctrl+v',
  duplicate: 'ctrl+d',
  split: 'ctrl+k', // Premiere の「編集点を追加」と同じ
  addTelop: 't',
  addMarker: 'm',
  saveProject: 'ctrl+s',
  openProject: 'ctrl+o',
  exportVideo: 'ctrl+m' // Premiere と同じ「書き出し」
}
type ShortcutId = keyof typeof DEFAULT_SHORTCUTS
type Shortcuts = Record<ShortcutId, string>

const ACTION_LIST: { id: ShortcutId; label: string; group: string }[] = [
  { id: 'openProject', label: 'プロジェクトを開く', group: 'ファイル' },
  { id: 'saveProject', label: 'プロジェクトを保存', group: 'ファイル' },
  { id: 'exportVideo', label: '動画を書き出し', group: 'ファイル' },
  { id: 'toolSelect', label: '選択ツール', group: 'ツール' },
  { id: 'toolRazor', label: 'レザーツール', group: 'ツール' },
  { id: 'toggleSnap', label: 'スナップ切替', group: 'ツール' },
  { id: 'playPause', label: '再生 / 一時停止', group: '再生' },
  { id: 'shuttleFwd', label: '早送りシャトル', group: '再生' },
  { id: 'shuttleStop', label: '停止シャトル', group: '再生' },
  { id: 'shuttleRev', label: '逆再生シャトル', group: '再生' },
  { id: 'gotoStart', label: '先頭へ', group: '再生' },
  { id: 'gotoEnd', label: '末尾へ', group: '再生' },
  { id: 'frameBack', label: '1フレーム戻る', group: '再生' },
  { id: 'frameFwd', label: '1フレーム進む', group: '再生' },
  { id: 'frameBack5', label: '5フレーム戻る', group: '再生' },
  { id: 'frameFwd5', label: '5フレーム進む', group: '再生' },
  { id: 'split', label: '再生ヘッドで分割', group: '編集' },
  { id: 'attrCopy', label: '設定をコピー（位置・変形・色など）', group: '編集' },
  { id: 'attrPaste', label: '設定を貼り付け（選んだクリップ全部へ）', group: '編集' },
  { id: 'del', label: '削除（詰めない。Delete / Backspace も同じ）', group: '編集' },
  { id: 'rippleDel', label: '削除して詰める（Shift+Delete も同じ）', group: '編集' },
  { id: 'rippleToPrevCut', label: '前の編集点まで詰めて削除（リップルトリム前方）', group: '編集' },
  { id: 'rippleToNextCut', label: '次の編集点まで詰めて削除（リップルトリム後方）', group: '編集' },
  { id: 'selectAll', label: '全選択', group: '編集' },
  { id: 'deselect', label: '選択解除', group: '編集' },
  { id: 'undo', label: '元に戻す', group: '編集' },
  { id: 'redo', label: 'やり直し', group: '編集' },
  { id: 'copy', label: 'コピー', group: '編集' },
  { id: 'cut', label: '切り取り', group: '編集' },
  { id: 'paste', label: '貼り付け', group: '編集' },
  { id: 'duplicate', label: '複製', group: '編集' },
  { id: 'addTelop', label: 'テロップを追加', group: '編集' },
  { id: 'addMarker', label: 'マーカーを追加', group: '編集' }
]

// KeyboardEvent → 正規化コンボ文字列（例: "ctrl+z", "shift+delete", "space", "arrowleft"）
function comboFromEvent(e: KeyboardEvent): string {
  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('ctrl')
  if (e.altKey) parts.push('alt')
  if (e.shiftKey) parts.push('shift')
  let key = e.key === ' ' ? 'space' : e.key.toLowerCase()
  if (key === 'control' || key === 'shift' || key === 'alt' || key === 'meta') return ''
  parts.push(key)
  return parts.join('+')
}
// コンボを見やすい表記に（"ctrl+z" → "Ctrl+Z", "arrowleft" → "←"）
function formatCombo(combo: string): string {
  const map: Record<string, string> = {
    ctrl: 'Ctrl',
    alt: 'Alt',
    shift: 'Shift',
    space: 'Space',
    arrowleft: '←',
    arrowright: '→',
    arrowup: '↑',
    arrowdown: '↓',
    delete: 'Delete',
    backspace: 'Backspace',
    escape: 'Esc',
    home: 'Home',
    end: 'End'
  }
  return combo
    .split('+')
    .map((p) => map[p] ?? p.toUpperCase())
    .join('+')
}
const SC_KEY = 'giftcut.shortcuts'
function loadShortcuts(): Shortcuts {
  try {
    return { ...DEFAULT_SHORTCUTS, ...JSON.parse(localStorage.getItem(SC_KEY) || '{}') }
  } catch {
    return { ...DEFAULT_SHORTCUTS }
  }
}

interface TrackState {
  target: boolean
  hidden: boolean
  muted: boolean
  solo: boolean
  locked: boolean
  volume: number // 音量ゲイン 0..1（オーディオミキサー用。1=0dB）
}
function newTrackState(id: string): TrackState {
  return {
    target: id === 'V1' || id === 'A1',
    hidden: false,
    muted: false,
    solo: false,
    locked: false,
    volume: 1
  }
}
function initTrackStates(tracks: Track[]): Record<string, TrackState> {
  const s: Record<string, TrackState> = {}
  for (const t of tracks) s[t.id] = newTrackState(t.id)
  return s
}
// ゲイン(0..1) ↔ dB 表示
const gainToDb = (g: number): string => (g <= 0.0001 ? '-∞' : (20 * Math.log10(g)).toFixed(1))


// テロップテンプレの小カード（「あア」を本番と同じレイヤーエンジンで描画＝プレビューと見た目一致）
const THUMB_TEXT = 'あア'
const THUMB_FONT_1080 = 780 // 1080基準のフォントサイズ。62px高サムネで約45px表示（本家風にカードいっぱい）
function TemplateCard({
  tpl,
  onApply,
  onDelete,
  onDragStartTpl,
  onDragEndTpl,
  fav,
  onToggleFav,
  curCat,
  onSetCat,
  catOptions,
  onContextMenu
}: {
  tpl: TelopTemplate
  onApply: () => void
  onDelete?: () => void
  onDragStartTpl?: () => void
  onDragEndTpl?: () => void
  fav?: boolean
  onToggleFav?: () => void
  curCat?: string
  onSetCat?: (cat: string) => void
  catOptions?: { key: string; label: string }[]
  onContextMenu?: (e: React.MouseEvent) => void
}): JSX.Element {
  // 本番SVGエンジンで描画。viewBox(文字+装飾)を preserveAspectRatio=meet でカードにフィット
  // ＝自動で最大サイズ表示（本家風にカードいっぱい）。scaleTelopStyle不要。
  const tsvg = buildTelopSVG(tpl.style, THUMB_TEXT)
  const bg = tpl.style.background
  return (
    <div
      className="tpl-card"
      onClick={onApply}
      onContextMenu={onContextMenu}
      title="クリックで適用 / 右クリックでフォルダ移動 / ドラッグで適用"
      draggable
      onDragStart={onDragStartTpl}
      onDragEnd={onDragEndTpl}
    >
      {onDelete && (
        <button
          className="tpl-del"
          title="削除"
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
        >
          ✕
        </button>
      )}
      {onToggleFav && (
        <button
          className={`tpl-fav ${fav ? 'on' : ''}`}
          title={fav ? 'お気に入り解除' : 'お気に入りに追加'}
          onClick={(e) => {
            e.stopPropagation()
            onToggleFav()
          }}
        >
          {fav ? '★' : '☆'}
        </button>
      )}
      {onSetCat && (
        <select
          className="tpl-cat"
          title="カテゴリを変更"
          value={curCat}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => {
            e.stopPropagation()
            onSetCat(e.target.value)
          }}
        >
          {(catOptions ?? TELOP_CATS).map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </select>
      )}
      <div className="tpl-thumb">
        <div
          style={{
            width: '94%',
            height: '86%',
            ...(bg.enabled
              ? { background: hexToRgba(bg.color, bg.opacity), borderRadius: 4 }
              : null)
          }}
          dangerouslySetInnerHTML={{ __html: tsvg.svg }}
        />
      </div>
      <div className="tpl-name">{tpl.name}</div>
    </div>
  )
}

/**
 * 見切れないタブ帯。
 *
 * パネルを狭めるとタブが端から切れて、奥のタブへ一生たどり着けなかった。
 * 3つの逃げ道を用意する:
 *   1. 端の「送り」ボタン（押しっぱなしで送り続ける）
 *   2. 「≫」から、いま見えていないタブを一覧で選ぶ
 *   3. 掴んで横に引っぱる
 *
 * ※ App の中で定義してはいけない。毎レンダーで別物として作り直され、
 *   ref も横スクロール位置も失われて、引っぱっても戻ってしまう（実際に起きた）。
 */
function PanelTabs({
  group,
  tabs,
  active,
  onPick,
  onTabMenu,
  onOverflow,
  onReorder
}: {
  group: string
  tabs: { id: string; label: string }[]
  active: string
  onPick: (id: string) => void
  onTabMenu: (e: React.MouseEvent, group: string, id: string, label: string) => void
  onOverflow: (e: React.MouseEvent, group: string, hidden: string[]) => void
  onReorder: (ids: string[]) => void
}): JSX.Element {
  const stripRef = useRef<HTMLDivElement | null>(null)
  const [over, setOver] = useState(false) // 端が切れているか
  const [dragId, setDragId] = useState<string | null>(null)
  const didDragRef = useRef(false) // 並べ替えた直後にタブが切り替わらないように
  /** いま帯からはみ出して見えていないタブ。「≫」はこれを出す。 */
  const hiddenIds = (): string[] => {
    const strip = stripRef.current
    if (!strip) return []
    const box = strip.getBoundingClientRect()
    return [...strip.querySelectorAll<HTMLElement>('.tab')]
      .map((el, i) => ({ el, id: tabs[i]?.id }))
      .filter(({ el }) => {
        const r = el.getBoundingClientRect()
        return r.left < box.left - 1 || r.right > box.right + 1
      })
      .map(({ id }) => id)
      .filter((id): id is string => !!id)
  }
  const measure = (): void => {
    const el = stripRef.current
    if (el) setOver(el.scrollWidth > el.clientWidth + 2)
  }
  useEffect(() => {
    measure()
    const ro = new ResizeObserver(measure)
    if (stripRef.current) ro.observe(stripRef.current)
    return () => ro.disconnect()
  }, [tabs.length])
  const hold = (dir: -1 | 1) => (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const step = (): void => {
      stripRef.current?.scrollBy({ left: dir * 18 })
    }
    step()
    const iv = window.setInterval(step, 40)
    const stop = (): void => {
      window.clearInterval(iv)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
    }
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
  }
  return (
    <div className="panel-tabs">
      {over && (
        <button className="tab-nav" title="左へ送る（押しっぱなしで続けて送る）" onPointerDown={hold(-1)}>
          ‹
        </button>
      )}
      <div
        className="panel-tabs-strip"
        ref={stripRef}
        onScroll={measure}
        onPointerDown={(e) => {
          if (e.button !== 0) return
          const el = stripRef.current
          if (!el) return
          const sx = e.clientX
          const s0 = el.scrollLeft
          let moved = false
          const mv = (ev: PointerEvent): void => {
            if (!moved && Math.abs(ev.clientX - sx) < 4) return
            moved = true
            el.scrollLeft = s0 - (ev.clientX - sx)
          }
          const up = (): void => {
            window.removeEventListener('pointermove', mv)
            window.removeEventListener('pointerup', up)
          }
          window.addEventListener('pointermove', mv)
          window.addEventListener('pointerup', up)
        }}
      >
        {tabs.map((t) => (
          <span
            key={t.id}
            className={`tab ${active === t.id ? 'tab-on' : ''} ${dragId === t.id ? 'tab-dragging' : ''}`}
            onClick={() => {
              // 並べ替えた直後は、タブが切り替わらないようにする
              if (didDragRef.current) {
                didDragRef.current = false
                return
              }
              onPick(t.id)
            }}
            onContextMenu={(e) => onTabMenu(e, group, t.id, t.label)}
            title={`${t.label}（掴んで左右に動かすと並び順を変えられます）`}
            // 掴んで動かす＝並べ替え。押しただけならタブの切り替え。
            onPointerDown={(e) => {
              if (e.button !== 0) return
              e.stopPropagation() // 帯の横スクロールと取り合わない
              const sx = e.clientX
              let dragging = false
              const move = (ev: PointerEvent): void => {
                if (!dragging && Math.abs(ev.clientX - sx) < 5) return
                dragging = true
                didDragRef.current = true
                setDragId(t.id)
                const strip = stripRef.current
                if (!strip) return
                const rects = [...strip.querySelectorAll('.tab')].map((el) =>
                  el.getBoundingClientRect()
                )
                const ids = tabs.map((x) => x.id)
                const from = ids.indexOf(t.id)
                let to = rects.findIndex((r) => ev.clientX < r.left + r.width / 2)
                if (to < 0) to = ids.length - 1
                if (to !== from) {
                  const next = [...ids]
                  next.splice(from, 1)
                  next.splice(to, 0, t.id)
                  onReorder(next)
                }
              }
              const up = (): void => {
                window.removeEventListener('pointermove', move)
                window.removeEventListener('pointerup', up)
                setDragId(null)
              }
              window.addEventListener('pointermove', move)
              window.addEventListener('pointerup', up)
            }}
          >
            {t.label}
          </span>
        ))}
      </div>
      {over && (
        <button className="tab-nav" title="右へ送る（押しっぱなしで続けて送る）" onPointerDown={hold(1)}>
          ›
        </button>
      )}
      {over && (
        <button
          className="tab-nav tab-more"
          title="いま見えていないタブを一覧から選ぶ"
          onClick={(e) => onOverflow(e, group, hiddenIds())}
        >
          ≫
        </button>
      )}
    </div>
  )
}

export default function App(): JSX.Element {
  // ---- データ ----
  const [cues, setCues] = useState<Cue[]>([])
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [srtPath, setSrtPath] = useState<string | null>(null) // 読み込んだSRTのパス（表示用）
  // プロジェクト(.gcproj)の保存先。srtPath とは必ず別に持つ
  // （兼用にすると「上書き保存」が読み込んだSRTファイルを壊す）。
  const [projectPath, setProjectPath] = useState<string | null>(null)
  // 開いたプロジェクトで「見つからなかった素材」。保存時に書き戻して情報を失わないため。
  const [missingMedia, setMissingMedia] = useState<{
    videoPath: string | null
    sources: { id?: number; path?: string; name?: string }[]
  } | null>(null)
  const [menu, setMenu] = useState<ContextMenu | null>(null)
  const [clipMenu, setClipMenu] = useState<ClipMenu | null>(null) // テロップ以外の右クリック
  const idCounter = useRef(1)

  // ---- 編集状態 ----
  const [tool, setTool] = useState<Tool>('select')
  const [ratio, setRatio] = useState<Ratio>('16:9')
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
  const [zoom, setZoom] = useState(24) // px / 秒
  // マグネットの ON/OFF は編集の癖なのでPCに覚えさせる（プレビュー解像度や
  // パネル幅は保存しているのに、ここだけ毎回ONに戻っていた）。
  // loadLS はこの行より後ろで定義されるので使えない（使うと起動時に
  // 「Cannot access 'loadLS' before initialization」で真っ黒になる）。直接読む。
  // 検査票の開閉（開発中のみ）。再読み込みしても開いたままにする。
  const [qaOpen, setQaOpen] = useState(
    () => import.meta.env.DEV && localStorage.getItem('giftcut.qa.open') === '1'
  )
  useEffect(() => {
    if (import.meta.env.DEV) localStorage.setItem('giftcut.qa.open', qaOpen ? '1' : '0')
  }, [qaOpen])
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
  const [currentTime, setCurrentTime] = useState(0)
  const [monitorTab, setMonitorTab] = useState<'program' | 'mixer'>('program') // プレビュー↔ミキサー
  const [masterVolume, setMasterVolume] = useState(1) // マスター音量（全体）

  // ---- 動画 ----
  // videoSrc=プレビュー用（生成後は編集用プロキシ）、videoPath=書き出し用の原本パス
  const [videoSrc, setVideoSrc] = useState<string | null>(null)
  const [videoPath, setVideoPath] = useState<string | null>(null)
  const [videoName, setVideoName] = useState<string | null>(null)
  const [videoDuration, setVideoDuration] = useState(0)
  // 素材の実フレームレート（読み込み時に ffprobe で取得。未取得は既定30）。
  // フレームステップ/タイムコード/カットのフレーム量子化に使う。
  const [fps, setFps] = useState(FPS)
  const fpsRef = useRef(FPS)
  const [proxyPct, setProxyPct] = useState<number | null>(null) // プロキシ生成の進捗（null=非生成/完了）
  const proxyForPathRef = useRef<string | null>(null) // 今プロキシ生成中の原本パス
  // この動画について初期切片を作ったか。プロキシ完成でsrcが変わると loadedmetadata が再発火するため、
  // 「segments が空」を初期化条件にすると、全消しした直後にカットが勝手に復活してしまう。
  const initializedForPathRef = useRef<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [playRateUI, setPlayRateUI] = useState(0)
  const lastPaintRef = useRef(0) // 再生中の最後にsetTimeした時刻（再描画スロットル用）
  // 動画ズーム（リフレーム）は切片ごと（VSeg.zoom）。編集対象は再生ヘッド位置の切片。
  const [videoSelected, setVideoSelected] = useState(false) // プレビューで動画を選択中（リフレーム枠を表示）
  const [waveform, setWaveform] = useState<{
    min: number[]
    max: number[]
    dur: number
  } | null>(null)
  const [thumbnailSrc, setThumbnailSrc] = useState<string | null>(null)

  // ---- マルチソース（複数の元動画を1タイムラインに連結）----
  // sources[0]=主ソース。既存のvideoPath/videoSrc/videoDuration/fps は「現在プレビュー中のソース」を表す。
  // 各 VSeg.srcId が元動画を指す（未指定=主ソース）。プレビューは再生ヘッドのソースへ<video>のsrcを切替。
  const [sources, setSources] = useState<Source[]>([])
  const sourcesRef = useRef<Source[]>([])
  const sourceIdCounter = useRef(1)
  const curSourceIdRef = useRef<number | null>(null) // 今<video>に読み込まれているソースID
  // 表示中のソースID（描画に使うのでstate）。切替は要素の表示切替だけ＝再ロードしないのでちらつかない
  const [activeSrcId, setActiveSrcId] = useState<number | null>(null)
  // ソースを登録した時刻（GCが「配置直前のソース」を消してしまう競合を防ぐ猶予に使う）
  const srcAddedAtRef = useRef<Map<number, number>>(new Map())
  useEffect(() => {
    sourcesRef.current = sources
  }, [sources])
  // seg の元動画を返す（srcId 未指定 or 見つからなければ主ソース）
  function srcOfSeg(seg: VSeg | undefined): Source | undefined {
    const list = sourcesRef.current
    if (!list.length) return undefined
    if (seg?.srcId == null) return list[0]
    return list.find((s) => s.id === seg.srcId) ?? list[0]
  }
  function updateSource(id: number, patch: Partial<Source>): void {
    setSources((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  }
  // ソースの付随データ（長さ/fps/プロキシ/波形）を非同期取得して反映（プロジェクト読込の追加ソース用）
  function hydrateSource(id: number, path: string): void {
    void window.giftcut.getDuration(path).then((r) => {
      if (r?.ok && r.duration && r.duration > 0) updateSource(id, { duration: r.duration })
    })
    void window.giftcut.getFps(path).then((r) => {
      if (r?.ok && r.fps && r.fps > 0) updateSource(id, { fps: Math.round(r.fps * 1000) / 1000 })
    })
    // プロキシは「プレビュー解像度」の effect が sources を見て一括で用意する（ここでは作らない）
    void window.giftcut.generateWaveform(path).then((r) => {
      if (r?.ok && r.min && r.max)
        updateSource(id, { waveform: { min: r.min, max: r.max, dur: r.duration ?? 0 } })
    })
  }

  // ---- メディアライブラリ（プロジェクトに追加した動画/SE/画像）----
  interface MediaItem {
    id: number
    path: string
    name: string
    kind: 'video' | 'audio' | 'image'
    folder?: string
    thumb?: string // サムネイル(gcfile url)
  }
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([])
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
  const [selectedMediaId, setSelectedMediaId] = useState<number | null>(null)
  const mediaIdCounter = useRef(1)
  const draggingMediaRef = useRef<MediaItem | null>(null)
  const dragSeDurRef = useRef(2) // ドラッグ中SEの尺（ゴースト幅用。dragStartでgetDurationして更新）
  // タイムラインへSE配置中の半透明ゴースト（プレミア風に配置位置を可視化）
  const [seGhost, setSeGhost] = useState<{
    t: number
    name: string
    dur: number
    track: string
    path: string
  } | null>(null)
  // タイムラインへ動画配置中のゴースト（V1）。insert=Ctrl押下（挿入モード）
  // 本編クリップを掴んで動かすときの動作（プレミア準拠）。
  //   move   = そのまま動かす（置き先を上書き。元の位置は空白になる）
  //   copy   = Alt: 複製（元はその場に残る）
  //   insert = Ctrl: 割り込み（置き先で分割して差し込み、後続は後ろへずれる）
  type SegDropMode = 'move' | 'copy' | 'insert'
  const [videoGhost, setVideoGhost] = useState<{
    t: number
    name: string
    dur: number
    insert: boolean
    path: string
    track: string // 置き先の映像トラック（'V1'=本編のカット列 / それ以外=映像レイヤー）
    moving?: boolean // 既にある本編クリップを掴んで動かしている（新規配置ではない）
    mode?: SegDropMode // 掴んで動かしているときの動作（そのまま/Alt=複製/Ctrl=割り込み）
  } | null>(null)
  // 本編クリップをドラッグ中の移動先（タイムライン秒）。指を離した時に確定する。
  // state だと onUp のクロージャが古い値を見るので ref で持つ。
  const segMoveToRef = useRef<number | null>(null)
  const segDropModeRef = useRef<SegDropMode>('move')
  // 今このまま離すと「丸ごと」上書きされてしまうクリップ。赤く縁取って警告する。
  const [overwriteIds, setOverwriteIds] = useState<number[]>([])
  // タイムラインへ画像配置中のゴースト（V2/V3等の映像トラック）
  const [imgGhost, setImgGhost] = useState<{
    t: number
    name: string
    dur: number
    track: string
  } | null>(null)
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
  interface SEClip {
    id: number
    label?: string
    path: string
    name: string
    tStart: number
    duration: number
    volume: number
    fadeIn: number // フェードイン秒
    fadeOut: number // フェードアウト秒
    track: string // 載っているトラック（'A2'=SE / 'A3'=BGM）。既定はA2。
    srcOffset?: number // 音源内の開始オフセット秒（左端トリム/分割で進む）。未指定=0
    srcDur?: number // 音源の全長（右端トリムの上限）。未取得なら undefined
  }
  const [seClips, setSeClips] = useState<SEClip[]>([])
  const [selectedSeIds, setSelectedSeIds] = useState<number[]>([])
  const seIdCounter = useRef(1)
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
  interface ImgClip {
    id: number
    label?: string
    path: string
    name: string
    tStart: number
    duration: number
    track: string // 載っている映像トラック（V1以外）
    // 動画切片と同じ変形/調整（プレビューのリフレーム枠・プロパティで編集）
    zoom?: { scale: number; x: number; y: number }
    rotate?: number
    flipH?: boolean
    flipV?: boolean
    opacity?: number // 0..1（未指定=1）
    adjust?: { b: number; c: number; s: number }
    crop?: { l: number; t: number; r: number; b: number }
  }
  const [imgClips, setImgClips] = useState<ImgClip[]>([])
  const [selectedImgIds, setSelectedImgIds] = useState<number[]>([])
  const imgIdCounter = useRef(1)
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
  // 選択中の画像クリップを部分更新（複数選択にまとめて適用）
  function updateSelectedImg(patch: Partial<ImgClip>): void {
    if (!selectedImgIds.length) return
    // ロック中は変更しない（ドラッグ・削除は守っているので揃える）
    if (imgClips.some((c) => selectedImgIds.includes(c.id) && trackStates[c.track]?.locked)) {
      showToast('このトラックはロックされています。')
      return
    }
    setImgClips((prev) =>
      prev.map((c) => (selectedImgIds.includes(c.id) ? { ...c, ...patch } : c))
    )
  }
  // 画像のズームを設定（等倍なら undefined に戻す）
  function setImgZoom(id: number, z: { scale: number; x: number; y: number }): void {
    setImgClips((prev) =>
      prev.map((c) => (c.id === id ? { ...c, zoom: isNeutralZoom(z) ? undefined : z } : c))
    )
  }
  // 映像レイヤーのCSS transform（回転/反転＋ズーム）
  function vcXform(c: {
    rotate?: number
    flipH?: boolean
    flipV?: boolean
    zoom?: { scale: number; x: number; y: number }
  }): string | undefined {
    const parts: string[] = []
    if (c.rotate) parts.push(`rotate(${c.rotate}deg)`)
    if (c.flipH) parts.push('scaleX(-1)')
    if (c.flipV) parts.push('scaleY(-1)')
    const z = c.zoom
    if (z && !isNeutralZoom(z))
      parts.push(
        `translate(${(z.x * 100).toFixed(3)}%, ${(z.y * 100).toFixed(3)}%) scale(${z.scale.toFixed(4)})`
      )
    return parts.length ? parts.join(' ') : undefined
  }
  // 画像のCSS transform（回転/反転＋ズーム）。動画切片と同じ合成順。
  function imgXform(c: ImgClip): string | undefined {
    const parts: string[] = []
    if (c.rotate) parts.push(`rotate(${c.rotate}deg)`)
    if (c.flipH) parts.push('scaleX(-1)')
    if (c.flipV) parts.push('scaleY(-1)')
    const z = c.zoom
    if (z && !isNeutralZoom(z))
      parts.push(
        `translate(${(z.x * 100).toFixed(3)}%, ${(z.y * 100).toFixed(3)}%) scale(${z.scale.toFixed(4)})`
      )
    return parts.length ? parts.join(' ') : undefined
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
      if (t <= clip.tStart + 0.05 || t >= clip.tStart + clip.duration - 0.05) return
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
      setSelectedImgIds(
        selectedImgIds.includes(clip.id)
          ? selectedImgIds.filter((id) => id !== clip.id)
          : [...selectedImgIds, clip.id]
      )
      return
    }
    // 既に選択済みのクリップを掴んだら選択全体を動かす（テロップは既にこの
    // 挙動。以前は選択を1つに潰してから掴んだクリップだけ動かしていたため、
    // 矩形選択で5個選んでも1個しか動かず残りの選択も消えていた）
    const grpIds =
      selectedImgIds.includes(clip.id) && selectedImgIds.length > 1 ? selectedImgIds : [clip.id]
    setSelectedImgIds(grpIds)
    const grpBase = new Map(
      imgClips.filter((c) => grpIds.includes(c.id)).map((c) => [c.id, c.tStart])
    )
    const sx = e.clientX
    const s0 = clip.tStart
    const d0 = clip.duration
    let moved = false
    const onMove = (ev: PointerEvent): void => {
      if (!moved && Math.abs(ev.clientX - sx) < 3) return
      moved = true
      const dt = (ev.clientX - sx) / zoomRef.current
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
        const raw = Math.max(0, s0 + dt)
        const nt = snapClipStart(raw, clip.duration, [], [clip.id])
        // 縦方向に動かしたら別の映像トラックへ移動（テロップの上下移動と同じ操作感）
        const irect = trackInnerRef.current?.getBoundingClientRect()
        const lane = irect ? laneAtY(ev.clientY - irect.top) : null
        // 移動先がロック中なら受け付けない（映像レイヤー側は既にそうしている）
        const laneOk =
          lane &&
          lane !== 'V1' &&
          tracks.some((t) => t.id === lane && t.kind === 'video') &&
          !trackStates[lane]?.locked
        // 掴んだクリップのずれ量を選択全体に同じだけ適用する
        const shift = nt - s0
        setImgClips((prev) =>
          prev.map((c) => {
            if (!grpIds.includes(c.id)) return c
            const base = grpBase.get(c.id) ?? c.tStart
            return {
              ...c,
              tStart: Math.max(0, base + shift),
              // トラック移動は掴んだ1つだけ（全部同じ行へ寄せると重なって壊れる）
              track: laneOk && c.id === clip.id ? lane : c.track
            }
          })
        )
      }
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      setSnapLineX(null)
      setDragTip(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  // ---- 映像レイヤークリップ（V2以降に置く動画。ピクチャーインピクチャー／差し込み用）----
  // V1 の「切片(VSeg)」は隙間なく連結するリップル方式だが、こちらは絶対位置に置く独立クリップ。
  // 音声は必ず対になる音声トラック（V2→A2, V3→A3）に連動表示・再生される＝映像と音は常にセット。
  interface VClip {
    id: number
    label?: string
    path: string
    name: string
    track: string
    tStart: number
    srcStart: number
    srcEnd: number
    srcDur?: number
    zoom?: { scale: number; x: number; y: number }
    rotate?: number
    flipH?: boolean
    flipV?: boolean
    opacity?: number
    adjust?: { b: number; c: number; s: number }
    crop?: { l: number; t: number; r: number; b: number }
    muted?: boolean
    vol?: number
    afadeIn?: number
    afadeOut?: number
  }
  const [vClips, setVClips] = useState<VClip[]>([])
  const [selectedVClipIds, setSelectedVClipIds] = useState<number[]>([])
  const vClipIdCounter = useRef(1)
  const vClipsRef = useRef<VClip[]>([])
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
  function updateSelectedVClip(patch: Partial<VClip>): void {
    if (!selectedVClipIds.length) return
    if (vClips.some((c) => selectedVClipIds.includes(c.id) && trackStates[c.track]?.locked)) {
      showToast('このトラックはロックされています。')
      return
    }
    setVClips((prev) => prev.map((c) => (selectedVClipIds.includes(c.id) ? { ...c, ...patch } : c)))
  }
  function setVClipZoom(id: number, z: { scale: number; x: number; y: number }): void {
    setVClips((prev) =>
      prev.map((c) => (c.id === id ? { ...c, zoom: isNeutralZoom(z) ? undefined : z } : c))
    )
  }
  // クリップ内ローカル秒 t における音声フェード係数
  // フェード計算は shared/timeline の fadeGain に集約（音声フェードの実装を1つに保つ）
  function vcFadeGain(c: VClip, t: number): number {
    return fadeGain(t, vcLen(c), c.afadeIn, c.afadeOut)
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
      setSelectedVClipIds(
        selectedVClipIds.includes(clip.id)
          ? selectedVClipIds.filter((x) => x !== clip.id)
          : [...selectedVClipIds, clip.id]
      )
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
    setSelectedVClipIds(grpIds)
    const sx = e.clientX
    const t0 = clip.tStart
    const s0 = clip.srcStart
    const e0 = clip.srcEnd
    let moved = false
    const onMove = (ev: PointerEvent): void => {
      if (!moved && Math.abs(ev.clientX - sx) < 3) return
      moved = true
      const dt = (ev.clientX - sx) / zoomRef.current
      if (edge === 'r') {
        const wantEnd = snapTime(t0 + (e0 - s0) + dt, [], [], [], [clip.id])
        const ne = clamp(s0 + (wantEnd - t0), s0 + 0.1, clip.srcDur ?? Number.MAX_SAFE_INTEGER)
        setVClips((prev) => prev.map((c) => (c.id === clip.id ? { ...c, srcEnd: ne } : c)))
        setDragTip({ x: ev.clientX, y: ev.clientY, text: '長さ ' + formatTime(ne - s0) })
      } else if (edge === 'l') {
        // 左端: 終端を固定して、開始位置と元動画のイン点を同時に動かす
        const nt = clamp(
          snapTime(t0 + dt, [], [], [], [clip.id]),
          Math.max(0, t0 - s0),
          t0 + (e0 - s0) - 0.1
        )
        setVClips((prev) =>
          prev.map((c) => (c.id === clip.id ? { ...c, tStart: nt, srcStart: s0 + (nt - t0) } : c))
        )
        setDragTip({ x: ev.clientX, y: ev.clientY, text: '開始 ' + formatTime(nt) })
      } else {
        const nt = snapClipStart(Math.max(0, t0 + dt), e0 - s0, [], [], [clip.id])
        // 縦方向で別の映像トラックへ移動（V1は切片専用なので不可）
        const irect = trackInnerRef.current?.getBoundingClientRect()
        const lane = irect ? laneAtY(ev.clientY - irect.top) : null
        const laneOk =
          lane &&
          lane !== 'V1' &&
          tracks.some((t) => t.id === lane && t.kind === 'video') &&
          !trackStates[lane]?.locked
        // ここではトラックを作らない。以前はポインタが動くたびに確保していたため、
        // ドラッグ中にトラックが次々増えて画面が上へ暴走していた。
        // 実際に移す時（指を離した時）にまとめて確保する。
        if (laneOk && lane !== clip.track) pendingLaneRef.current = lane
        const shift = nt - t0
        setVClips((prev) =>
          prev.map((c) => {
            if (!grpIds.includes(c.id)) return c
            const base = grpBase.get(c.id) ?? c.tStart
            return {
              ...c,
              tStart: Math.max(0, base + shift),
              // トラック移動は掴んだ1つだけ（対の音声トラック確保も1つ分で済む）
              track: laneOk && c.id === clip.id ? lane : c.track
            }
          })
        )
      }
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      setDragTip(null)
      // 移し終えた時にだけ、対の音声トラックを確保する
      // （確保しないと A{n} が無く無音になり、音声の帯も消える）
      const lane = pendingLaneRef.current
      pendingLaneRef.current = null
      if (lane) reserveTrackPairForVideo(lane)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  // ---- マーカー（タイムライン上の目印。頭出し/メモ用。書き出しには影響しない）----
  interface Marker {
    id: number
    t: number // タイムライン秒
    label: string // メモ（空可）
  }
  const [markers, setMarkers] = useState<Marker[]>([])
  const [selectedMarkerId, setSelectedMarkerId] = useState<number | null>(null)
  const [editingMarkerId, setEditingMarkerId] = useState<number | null>(null)
  const markerIdCounter = useRef(1)
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
      seekTo(target.t)
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
  // 選択中SEクリップにまとめてプロパティ適用（音量・フェード）
  function updateSelectedSE(patch: Partial<SEClip>): void {
    if (!selectedSeIds.length) return
    if (seClips.some((c) => selectedSeIds.includes(c.id) && trackStates[c.track]?.locked)) {
      showToast('このトラックはロックされています。')
      return
    }
    setSeClips((prev) => prev.map((c) => (selectedSeIds.includes(c.id) ? { ...c, ...patch } : c)))
  }
  function removeMedia(id: number): void {
    const m = mediaItems.find((x) => x.id === id)
    // タイムラインで使っている素材は消せない（消すとビンから見えないのに再生され続けて混乱する）
    if (m) {
      const used =
        sourcesRef.current.some((s) => s.path === m.path) ||
        seClipsRef.current.some((c) => c.path === m.path) ||
        imgClipsRef.current.some((c) => c.path === m.path) ||
        vClipsRef.current.some((c) => c.path === m.path)
      if (used) {
        showToast('この素材はタイムラインで使用中です。先にクリップを削除してください。')
        return
      }
    }
    setMediaItems((prev) => prev.filter((x) => x.id !== id))
    if (selectedMediaId === id) setSelectedMediaId(null)
  }
  // 再生中のソースの <video>（マルチソースでは切替時に付け替える。要素自体は破棄しない）
  const videoRef = useRef<HTMLVideoElement | null>(null)
  // ソースID → <video> 要素。ソースごとに要素を常設し、src差し替えによる再ロード＝黒ちらつきを防ぐ
  const videoElsRef = useRef<Map<number, HTMLVideoElement>>(new Map())
  const videoBRef = useRef<HTMLVideoElement>(null) // クロスディゾルブ用の2本目video（同じproxy srcをオーバーレイ）
  // 再生ヘッドの時計（壁時計マスター）。再生ヘッドは実時間で常に一定速度で進み、動画がそれを追う。
  const clockStartWallRef = useRef(0) // 再生開始時の performance.now()/1000（秒）
  const clockStartPosRef = useRef(0) // 再生開始時のタイムライン位置（秒）

  // ---- 動画セグメント（切片編集）----
  const [segments, setSegments] = useState<VSeg[]>([])
  // 動画と音声の選択は独立（クリックは片方、ドラッグは両方に掛かれば両方）
  const [selectedVideoIds, setSelectedVideoIds] = useState<number[]>([])
  const [selectedAudioIds, setSelectedAudioIds] = useState<number[]>([])
  const isVideoSel = (id: number): boolean => selectedVideoIds.includes(id)
  const isAudioSel = (id: number): boolean => selectedAudioIds.includes(id)
  const anySegSelected = (): boolean => selectedVideoIds.length > 0 || selectedAudioIds.length > 0
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
  function clearSegSel(): void {
    setSelectedVideoIds([])
    setSelectedAudioIds([])
    setSelectedSeIds([])
    setSelectedImgIds([])
    setSelectedVClipIds([])
    setSelectedTrans(null)
    setSelectedTelopTrans(null)
    // マーカー選択も解除（残っているとDelete/Dがマーカー削除に横取りされるため）
    setSelectedMarkerId(null)
  }
  // 選択という選択を全部解除する唯一の入口。
  // 以前は解除処理が6箇所に散っていて、それぞれ違う部分集合しか消していなかった。
  // その結果「動画クリップを消したのにマーカーだけ消える」「Ctrl+A→Delete が
  // 無反応」「プレビューのリフレーム枠から抜けられない」が同時に起きていた。
  // 解除したい場所は必ずここを通すこと（部分的に消したい場合を除く）。
  function clearAllSelections(): void {
    clearSegSel() // テロップ以外のクリップ＋トランジション＋マーカー
    setSelectedIds([]) // テロップ
    setSelectedTrackId(null) // トラック選択（残ると Delete がトラック削除に化ける）
    setVideoSelected(false) // プレビューのリフレーム枠（残るとホイールが拡大縮小になる）
    setSelectedMediaId(null) // 素材ビンの選択（残ると Delete の対象が分からなくなる）
  }
  // タイムライン上で選択中のトランジション（動画クリップの頭/尻ディップ or カット間ディゾルブ）。
  // クリップ本体とは別枠で選択でき、ここが選択中なら右パネルでそのトランジションだけを編集/削除できる。
  const [selectedTrans, setSelectedTrans] = useState<{
    segId: number
    kind: 'in' | 'out' | 'xfade'
  } | null>(null)
  // 選択中のテロップ出入りアニメ（動画トランジションと同じ選択/編集/削除の仕組み）。
  const [selectedTelopTrans, setSelectedTelopTrans] = useState<{
    cueId: number
    kind: 'in' | 'out'
  } | null>(null)
  const segIdCounter = useRef(1)
  const currentSegRef = useRef(0) // 再生中に追従しているセグメント index

  // ---- トラック（可変。+ボタンで増やせる）----
  const [tracks, setTracks] = useState<Track[]>(DEFAULT_TRACKS)
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
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null)
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
  const [trackStates, setTrackStates] = useState<Record<string, TrackState>>(() =>
    initTrackStates(DEFAULT_TRACKS)
  )
  function toggleTrack(id: string, key: keyof TrackState): void {
    setTrackStates((s) => ({ ...s, [id]: { ...s[id], [key]: !s[id][key] } }))
  }

  // ---- トラック高さ（映像/音声グループごとにまとめて可変・localStorage 永続化）----
  // プレミア同様、映像レーン全体・音声レーン全体をそれぞれ一括で高さ調整する
  const loadGroupH = (key: string, def: number): number => {
    const v = Number(localStorage.getItem(key))
    return v >= TRACK_H_MIN && v <= TRACK_H_MAX ? v : def
  }
  const [videoTrackH, setVideoTrackH] = useState<number>(() => loadGroupH('gc.videoTrackH', 34))
  const [audioTrackH, setAudioTrackH] = useState<number>(() => loadGroupH('gc.audioTrackH', 52))
  const videoTrackHRef = useRef(videoTrackH)
  const audioTrackHRef = useRef(audioTrackH)
  useEffect(() => {
    videoTrackHRef.current = videoTrackH
    saveLS('gc.videoTrackH', videoTrackH)
  }, [videoTrackH])
  useEffect(() => {
    audioTrackHRef.current = audioTrackH
    saveLS('gc.audioTrackH', audioTrackH)
  }, [audioTrackH])
  const trackHOf = (kind: string): number => (kind === 'video' ? videoTrackH : audioTrackH)
  const cueTrack = (c: Cue): string => c.track ?? 'V2' // テロップの配置トラック（未指定=V2）
  // オーディオトラックの実効ゲイン（ミュート/ソロ/音量×マスターを合成）
  const anyAudioSolo = tracks.some((t) => t.kind === 'audio' && trackStates[t.id]?.solo)
  function audioTrackGain(id: string): number {
    const st = trackStates[id]
    if (!st || st.muted) return 0
    if (anyAudioSolo && !st.solo) return 0
    return clamp((st.volume ?? 1) * masterVolume, 0, 1)
  }
  // 書き出し用のゲイン。ソロはモニタリング専用（Premiere でも各DAWでも同じ約束）
  // なので書き出しには効かせない。BGMだけ確認しようとソロにしたまま書き出して
  // 本編音声もSEも全部無音の動画ができる事故を防ぐ。反映するのはミュートと音量のみ。
  function audioTrackGainForExport(id: string): number {
    const st = trackStates[id]
    if (!st || st.muted) return 0
    return clamp((st.volume ?? 1) * masterVolume, 0, 1)
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
  // 左端グリップをドラッグしてグループ高さを調整（境目/下端を掴んで、そのグループ全体を拡縮）
  function startGroupResize(kind: 'video' | 'audio', e: React.PointerEvent): void {
    e.preventDefault()
    e.stopPropagation()
    const startY = e.clientY
    const startH = kind === 'video' ? videoTrackHRef.current : audioTrackHRef.current
    const count = kind === 'video' ? nVideoTracks : nAudioTracks // 掴んだ境界がカーソルに追従
    const setter = kind === 'video' ? setVideoTrackH : setAudioTrackH
    const onMove = (ev: PointerEvent): void => {
      setter(clamp(startH + (ev.clientY - startY) / count, TRACK_H_MIN, TRACK_H_MAX))
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
  // 上下の余白。段の高さを変えたら一緒に変わる。
  // 上はゆったり、下は1段ぶん。下も同じだけ取ると、その分だけ段が画面から
  // はみ出して「下がかつかつ」になる（実際にそうなった）。
  const padTop = TRACK_PAD_ROWS * videoTrackH
  const padBottom = videoTrackH
  // 左端グリップの配置Y。映像=映像/音声の境目、音声=音声グループの下端
  const groupGrips = useMemo(() => {
    const divider = RULER_H + padTop + nVideoTracks * videoTrackH
    const bottom = divider + nAudioTracks * audioTrackH
    return [
      { kind: 'video' as const, y: divider },
      { kind: 'audio' as const, y: bottom }
    ]
  }, [videoTrackH, audioTrackH, nVideoTracks, nAudioTracks])

  // ---- タイムラインのガイド・ツールチップ ----
  const [hoverX, setHoverX] = useState<number | null>(null)
  const [snapLineX, setSnapLineX] = useState<number | null>(null)
  const [dragTip, setDragTip] = useState<{ x: number; y: number; text: string } | null>(null)
  const [marquee, setMarquee] = useState<{
    x0: number
    y0: number
    x1: number
    y1: number
  } | null>(null)

  // ---- 書き出し ----
  const [exportStatus, setExportStatus] = useState<string | null>(null)
  const [exportPct, setExportPct] = useState<number | null>(null) // FFmpegエンコード進捗%（null=不明/画像化中）
  // 書き出し設定（解像度・fps・画質）
  const [showExportDialog, setShowExportDialog] = useState(false)
  // fps は 'source'＝素材と同じ（既定）。素材が60fpsなのに黙って30に落ちるのを防ぐため、
  // 実数への解決は書き出し直前に行い、main へは従来どおり数値だけを渡す。
  const [exportOpts, setExportOpts] = useState<{
    resP: 2160 | 1080 | 720 | 480
    fps: 24 | 30 | 60 | 'source'
    quality: 'high' | 'med' | 'low'
  }>({ resP: 1080, fps: 'source', quality: 'high' })
  // 素材fps（未取得なら既定30）。29.97 のような小数もそのまま使う（main が分数で ffmpeg に渡す）
  const srcFpsForExport = (): number => (Number.isFinite(fps) && fps > 0 ? fps : FPS)
  // 表示用: 整数なら「60」、そうでなければ「29.97」
  const fpsLabel = (v: number): string => (Number.isInteger(v) ? String(v) : v.toFixed(2))
  // 書き出しに実際に使う fps（'source'＝素材と同じ）
  const resolveExportFps = (): number =>
    exportOpts.fps === 'source' ? srcFpsForExport() : exportOpts.fps
  // ---- トースト通知（OS標準alertの置き換え。右下にふわっと出て自動で消える）----
  const [toasts, setToasts] = useState<{ id: number; msg: string; type: 'success' | 'error' | 'info' }[]>([])
  const toastIdRef = useRef(1)
  // お知らせは「積み上げない・すぐ消える」を守る。
  // 以前は4秒×無制限だったので、続けて操作すると3つ4つと積み上がって
  // タイムラインの右側が隠れ、肝心の失敗メッセージも埋もれていた。
  const TOAST_MAX = 2
  function showToast(msg: string, type: 'success' | 'error' | 'info' = 'info'): void {
    const id = toastIdRef.current++
    setToasts((t) => [...t, { id, msg, type }].slice(-TOAST_MAX))
    // 失敗は読む時間が要るので少し長く出す
    window.setTimeout(
      () => setToasts((t) => t.filter((x) => x.id !== id)),
      type === 'error' ? 5000 : 3000
    )
  }
  // ---- テキスト入力モーダル（OS標準promptの置き換え）----
  const [promptState, setPromptState] = useState<{
    title: string
    value: string
    onOk: (v: string) => void
  } | null>(null)
  function askText(title: string, defaultValue: string, onOk: (v: string) => void): void {
    setPromptState({ title, value: defaultValue, onOk })
  }
  // ---- パネルの切り離し（ドッキング解除）----
  //
  // 切り抜きは「絵を見る作業」なので、プレビューを大きく取れることが要る。
  // 使わないパネルを切り離すと、そのぶん残りが自動で広がる（切り離したものは
  // 画面から浮くので、並びの計算から外れる）。掴んで動かし、右下で大きさを変える。
  type PaneId = 'left' | 'right' | 'preview' | 'timeline'
  const PANE_LABEL: Record<PaneId, string> = {
    left: 'プロパティ',
    right: 'プロジェクト',
    preview: 'プレビュー',
    timeline: 'タイムライン'
  }
  const FLOAT_KEY = 'giftcut.floatPanes'
  const [floating, setFloating] = useState<
    Partial<Record<PaneId, { x: number; y: number; w: number; h: number }>>
  >(() => {
    try {
      const v = JSON.parse(localStorage.getItem(FLOAT_KEY) || '{}')
      return v && typeof v === 'object' ? v : {}
    } catch {
      return {}
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(FLOAT_KEY, JSON.stringify(floating))
    } catch {
      /* 保存できなくても動作には影響しない */
    }
  }, [floating])
  const isFloating = (id: PaneId): boolean => !!floating[id]
  function undockPane(id: PaneId): void {
    const w = Math.min(560, Math.max(320, window.innerWidth * 0.32))
    const h = Math.min(560, Math.max(240, window.innerHeight * 0.45))
    // 元あった側の近くに出す（真ん中に出すと、どれが出たのか分からなくなる）
    const at: Record<PaneId, { x: number; y: number }> = {
      left: { x: 24, y: 100 },
      right: { x: Math.max(24, window.innerWidth - w - 24), y: 100 },
      preview: { x: Math.max(24, (window.innerWidth - w) / 2), y: 90 },
      timeline: { x: 24, y: Math.max(90, window.innerHeight - h - 24) }
    }
    setFloating((p) => ({ ...p, [id]: { ...at[id], w, h } }))
    showToast(`${PANE_LABEL[id]} を切り離しました。「⇤ 戻す」で元に戻せます。`)
  }
  function dockPane(id: PaneId): void {
    setFloating((p) => {
      const n = { ...p }
      delete n[id]
      return n
    })
  }
  function floatDrag(id: PaneId, mode: 'move' | 'resize') {
    return (e: React.PointerEvent): void => {
      if (e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      const r0 = floating[id]
      if (!r0) return
      const sx = e.clientX
      const sy = e.clientY
      const onMove = (ev: PointerEvent): void => {
        const dx = ev.clientX - sx
        const dy = ev.clientY - sy
        setFloating((p) => {
          const cur = p[id]
          if (!cur) return p
          return {
            ...p,
            [id]:
              mode === 'move'
                ? {
                    ...cur,
                    x: clamp(r0.x + dx, -cur.w + 140, window.innerWidth - 140),
                    y: clamp(r0.y + dy, 0, window.innerHeight - 40)
                  }
                : {
                    ...cur,
                    w: clamp(r0.w + dx, 280, window.innerWidth),
                    h: clamp(r0.h + dy, 160, window.innerHeight)
                  }
          }
        })
      }
      const onUp = (): void => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    }
  }
  /** 切り離したパネルの見た目（画面から浮かせて、並びの計算から外す） */
  const floatStyle = (id: PaneId): React.CSSProperties => {
    const r = floating[id]!
    return { position: 'fixed', left: r.x, top: r.y, width: r.w, height: r.h, zIndex: 900 }
  }
  /** 切り離したパネルの上に付く、掴む所と「戻す」 */
  const floatHead = (id: PaneId): JSX.Element => (
    <>
      <div className="float-head" onPointerDown={floatDrag(id, 'move')}>
        <span className="float-title">{PANE_LABEL[id]}</span>
        <button className="float-dock" title="元の場所に戻す" onClick={() => dockPane(id)}>
          ⇤ 戻す
        </button>
      </div>
      <div className="float-resize" onPointerDown={floatDrag(id, 'resize')} title="大きさを変える" />
    </>
  )

  // ---- パネルのタブ帯（見切れ対策と並べ替え）----
  //
  // パネルを狭めるとタブが端から切れて、奥のタブへ一生たどり着けなかった。
  // 3つの逃げ道を用意する:
  //   1. 端の「送り」ボタン（押しっぱなしで送り続ける）
  //   2. 「≫」から、いま見えていないタブを一覧で選ぶ
  //   3. 掴んで横に引っぱる
  // 並び順は勝手に変わらないよう固定。変えたいときだけ右クリックから動かす。
  const TAB_ORDER_KEY = 'giftcut.tabOrder'
  const [tabOrder, setTabOrder] = useState<Record<string, string[]>>(() => {
    try {
      const v = JSON.parse(localStorage.getItem(TAB_ORDER_KEY) || '{}')
      return v && typeof v === 'object' ? v : {}
    } catch {
      return {}
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(TAB_ORDER_KEY, JSON.stringify(tabOrder))
    } catch {
      /* 保存できなくても動作には影響しない */
    }
  }, [tabOrder])
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
  interface CopiedAttrs {
    from: 'telop' | 'seg' | 'img' | 'vclip' | 'se'
    fromName: string
    // 種類をまたいで写せるもの
    zoom?: { scale: number; x: number; y: number }
    rotate?: number
    flipH?: boolean
    flipV?: boolean
    opacity?: number
    adjust?: { b: number; c: number; s: number }
    crop?: { l: number; t: number; r: number; b: number }
    label?: string
    // 音まわり（音を持つものだけ）
    vol?: number
    afadeIn?: number
    afadeOut?: number
    // テロップだけ
    telopPos?: { x: number; y: number }
    telopScale?: number
    telopStyle?: Cue['style']
  }
  const [copiedAttrs, setCopiedAttrs] = useState<CopiedAttrs | null>(null)
  /** 何を写せるかの一覧（人に見せる文言） */
  function attrSummary(a: CopiedAttrs): string {
    const parts: string[] = []
    if (a.telopPos || a.telopScale != null) parts.push('位置と大きさ')
    if (a.telopStyle) parts.push('見た目')
    if (a.zoom || a.rotate != null || a.flipH || a.flipV) parts.push('変形')
    if (a.adjust) parts.push('色調整')
    if (a.crop) parts.push('切り抜き')
    if (a.opacity != null) parts.push('不透明度')
    if (a.vol != null || a.afadeIn != null || a.afadeOut != null) parts.push('音量')
    if (a.label) parts.push('色')
    return parts.length ? parts.join('・') : '設定なし'
  }
  /** 選んでいるクリップ1つから属性をコピーする */
  function copyAttributes(): void {
    const cue = cues.find((c) => selectedIds.includes(c.id))
    if (cue) {
      setCopiedAttrs({
        from: 'telop',
        fromName: cue.text.slice(0, 10) || 'テロップ',
        telopPos: { ...cue.pos },
        telopScale: cue.scale,
        telopStyle: cue.style,
        label: cue.label || undefined
      })
      showToast('テロップの「位置と大きさ・見た目・色」をコピーしました。')
      return
    }
    const seg = segments.find((s) => selectedVideoIds.includes(s.id) && !s.gap)
    if (seg) {
      setCopiedAttrs({
        from: 'seg',
        fromName: srcOfSeg(seg)?.name ?? '動画',
        zoom: seg.zoom,
        rotate: seg.rotate,
        flipH: seg.flipH,
        flipV: seg.flipV,
        adjust: seg.adjust,
        crop: seg.crop,
        vol: seg.vol,
        afadeIn: seg.afadeIn,
        afadeOut: seg.afadeOut,
        label: seg.label
      })
      showToast('動画クリップの設定をコピーしました。')
      return
    }
    const vc = vClips.find((c) => selectedVClipIds.includes(c.id))
    if (vc) {
      setCopiedAttrs({
        from: 'vclip',
        fromName: vc.name,
        zoom: vc.zoom,
        rotate: vc.rotate,
        flipH: vc.flipH,
        flipV: vc.flipV,
        opacity: vc.opacity,
        adjust: vc.adjust,
        crop: vc.crop,
        vol: vc.vol,
        afadeIn: vc.afadeIn,
        afadeOut: vc.afadeOut,
        label: vc.label
      })
      showToast('重ねた動画の設定をコピーしました。')
      return
    }
    const img = imgClips.find((c) => selectedImgIds.includes(c.id))
    if (img) {
      setCopiedAttrs({
        from: 'img',
        fromName: img.name,
        zoom: img.zoom,
        rotate: img.rotate,
        flipH: img.flipH,
        flipV: img.flipV,
        opacity: img.opacity,
        adjust: img.adjust,
        crop: img.crop,
        label: img.label
      })
      showToast('画像の設定をコピーしました。')
      return
    }
    const se = seClips.find((c) => selectedSeIds.includes(c.id))
    if (se) {
      setCopiedAttrs({
        from: 'se',
        fromName: se.name,
        vol: se.volume,
        afadeIn: se.fadeIn,
        afadeOut: se.fadeOut,
        label: se.label
      })
      showToast('効果音の設定をコピーしました。')
      return
    }
    showToast('コピーするクリップを選んでください。')
  }
  /**
   * コピーした属性を、選んでいるクリップすべてに貼り付ける。
   *
   * テロップの見た目をコピーして全部選んで貼っても、動画や画像には
   * 貼らずテロップにだけ貼る。全部に貼ろうとして何も起きないより、
   * 貼れるものにだけ貼って「何件に貼ったか」を伝えるほうが親切。
   */
  function pasteAttributes(): void {
    const a = copiedAttrs
    if (!a) {
      showToast('先にコピーしてください。')
      return
    }
    const hits: string[] = []
    const common = <
      T extends {
        zoom?: unknown
        rotate?: number
        flipH?: boolean
        flipV?: boolean
        adjust?: unknown
        crop?: unknown
        label?: string
      }
    >(
      c: T
    ): T => ({
      ...c,
      ...(a.zoom !== undefined ? { zoom: a.zoom } : {}),
      ...(a.rotate !== undefined ? { rotate: a.rotate } : {}),
      ...(a.flipH !== undefined ? { flipH: a.flipH } : {}),
      ...(a.flipV !== undefined ? { flipV: a.flipV } : {}),
      ...(a.adjust !== undefined ? { adjust: a.adjust } : {}),
      ...(a.crop !== undefined ? { crop: a.crop } : {}),
      ...(a.label !== undefined ? { label: a.label } : {})
    })
    // テロップ（見た目・位置はテロップ同士でしか写せない）
    if (selectedIds.length) {
      const isTelopSource = a.from === 'telop'
      setCues((prev) =>
        prev.map((c) => {
          if (!selectedIds.includes(c.id) || telopLocked(c)) return c
          let n = { ...c }
          if (isTelopSource) {
            if (a.telopPos) n = { ...n, pos: { ...a.telopPos } }
            if (a.telopScale !== undefined) n = { ...n, scale: a.telopScale }
            if (a.telopStyle) n = { ...n, style: a.telopStyle }
          }
          if (a.label !== undefined) n = { ...n, label: a.label }
          return n
        })
      )
      const n = cues.filter((c) => selectedIds.includes(c.id) && !telopLocked(c)).length
      if (n) hits.push(`テロップ ${n}件`)
    }
    if (selectedVideoIds.length) {
      const targets = segments.filter((s) => selectedVideoIds.includes(s.id) && !s.gap)
      if (targets.length && !mainLocked()) {
        setSegments((prev) =>
          prev.map((s) =>
            selectedVideoIds.includes(s.id) && !s.gap
              ? {
                  ...common(s),
                  ...(a.vol !== undefined ? { vol: a.vol } : {}),
                  ...(a.afadeIn !== undefined ? { afadeIn: a.afadeIn } : {}),
                  ...(a.afadeOut !== undefined ? { afadeOut: a.afadeOut } : {})
                }
              : s
          )
        )
        hits.push(`動画クリップ ${targets.length}件`)
      }
    }
    if (selectedVClipIds.length) {
      const targets = vClips.filter(
        (c) => selectedVClipIds.includes(c.id) && !trackStates[c.track]?.locked
      )
      if (targets.length) {
        setVClips((prev) =>
          prev.map((c) =>
            selectedVClipIds.includes(c.id) && !trackStates[c.track]?.locked
              ? {
                  ...common(c),
                  ...(a.opacity !== undefined ? { opacity: a.opacity } : {}),
                  ...(a.vol !== undefined ? { vol: a.vol } : {}),
                  ...(a.afadeIn !== undefined ? { afadeIn: a.afadeIn } : {}),
                  ...(a.afadeOut !== undefined ? { afadeOut: a.afadeOut } : {})
                }
              : c
          )
        )
        hits.push(`重ねた動画 ${targets.length}件`)
      }
    }
    if (selectedImgIds.length) {
      const targets = imgClips.filter(
        (c) => selectedImgIds.includes(c.id) && !trackStates[c.track]?.locked
      )
      if (targets.length) {
        setImgClips((prev) =>
          prev.map((c) =>
            selectedImgIds.includes(c.id) && !trackStates[c.track]?.locked
              ? { ...common(c), ...(a.opacity !== undefined ? { opacity: a.opacity } : {}) }
              : c
          )
        )
        hits.push(`画像 ${targets.length}件`)
      }
    }
    if (selectedSeIds.length) {
      const targets = seClips.filter(
        (c) => selectedSeIds.includes(c.id) && !trackStates[c.track]?.locked
      )
      if (targets.length) {
        setSeClips((prev) =>
          prev.map((c) =>
            selectedSeIds.includes(c.id) && !trackStates[c.track]?.locked
              ? {
                  ...c,
                  ...(a.vol !== undefined ? { volume: a.vol } : {}),
                  ...(a.afadeIn !== undefined ? { fadeIn: a.afadeIn } : {}),
                  ...(a.afadeOut !== undefined ? { fadeOut: a.afadeOut } : {}),
                  ...(a.label !== undefined ? { label: a.label } : {})
                }
              : c
          )
        )
        hits.push(`効果音 ${targets.length}件`)
      }
    }
    if (!hits.length) {
      showToast('貼り付けられるクリップが選ばれていません。')
      return
    }
    const skipped =
      a.from === 'telop' &&
      (selectedVideoIds.length || selectedImgIds.length || selectedVClipIds.length)
    showToast(
      `${hits.join(' / ')} に貼り付けました。` +
        (skipped ? 'テロップの見た目はテロップにだけ貼っています。' : ''),
      'success'
    )
  }

  // ---- 最近使ったプロジェクト ----
  // 保存先を自分で覚えていないと開けない（＝どこに置いたか分からなくなる）ので、
  // 保存・読み込みのたびに覚えて、ファイルメニューからそのまま開けるようにする。
  interface RecentProject {
    path: string
    name: string
    at: number
  }
  const RECENT_KEY = 'giftcut.recentProjects'
  const RECENT_MAX = 8
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>(() => {
    try {
      const raw = localStorage.getItem(RECENT_KEY)
      const arr = raw ? JSON.parse(raw) : []
      return Array.isArray(arr)
        ? arr
            .filter(
              (r): r is RecentProject => !!r && typeof r.path === 'string' && !!r.path
            )
            .slice(0, RECENT_MAX)
        : []
    } catch {
      return []
    }
  })
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
  const [confirmState, setConfirmState] = useState<{
    title: string
    body: string
    okLabel: string
    cancelLabel: string
    danger: boolean
    resolve: (ok: boolean) => void
  } | null>(null)
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
  const [loudnormLUFS, setLoudnormLUFS] = useState<number | null>(-14)

  // ---- 右パネル（プロジェクト/テロップ/エフェクト/トランジション）----
  const [rightTab, setRightTab] = useState<
    'project' | 'telop' | 'icon' | 'se' | 'transition'
  >('project')
  // プレビュー内インライン編集中のテロップ（セッション保存で参照するためここで宣言）
  const [editingId, setEditingId] = useState<number | null>(null)
  // 内蔵SEライブラリ（GiftCut/SE をカテゴリ別に読む。ローカルフォルダ参照＝配布同梱しない）
  const [seLibrary, setSeLibrary] = useState<{ category: string; name: string; path: string }[]>([])
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
  // お気に入り（★）とカテゴリ上書き（ローカル保存）
  const [favorites, setFavorites] = useState<string[]>(loadFavorites)
  const [catOverrides, setCatOverrides] = useState<Record<string, string>>(loadCatOverrides)
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
  const ALWAYS_OPEN_TABS = ['project']
  const [openAccSec, setOpenAccSec] = useState<Record<string, string[]>>({
    project: ['video', 'audio', 'image'],
    icon: ['lib'],
    transition: ['video']
  })
  const accSecRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const toggleAccSec = (tab: string, k: string): void =>
    setOpenAccSec((p) => {
      const cur = p[tab] ?? []
      const isOpen = cur.includes(k)
      // 全部開けておくタブは複数同時に開ける。それ以外は従来どおり1つだけ。
      const next = isOpen
        ? cur.filter((x) => x !== k)
        : ALWAYS_OPEN_TABS.includes(tab)
          ? [...cur, k]
          : [k]
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
  // 'orig'=原本をそのまま再生（最高画質・シークは重い）/ 720・360=編集用プロキシ。
  // 書き出しは常に原本のフル画質なので、ここを下げても完成品の画質は落ちない。
  // ※useState の初期化関数は即時実行されるため、loadLS の定義より後に置く必要がある。
  // 既定は 'orig'（原本）。プロキシは軽くする手段として選ぶもので、
  // 何もしていないのに低画質で見えているのが一番困るため既定を最高画質にしている。
  const [previewRes, setPreviewRes] = useState<PreviewRes>(() => {
    const v = loadLS<PreviewRes>('giftcut.previewRes', 'orig')
    return v === 'orig' || v === 720 || v === 360 ? v : 'orig'
  })
  const previewResRef = useRef<PreviewRes>(previewRes)
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
  // プレビューに使う映像URL。原本指定ならそのまま原本、プロキシ指定なら出来ているものを使う。
  // 解像度切替の変換中は「前の解像度のプロキシ」を映したまま（一旦原本に戻すと二重リロードになる）。
  const previewUrl = (path: string, orig: string): string =>
    previewRes === 'orig' ? orig : (proxyMap[path]?.url ?? orig)
  // 選んだ解像度のプロキシを用意する唯一の入口。ソース／映像レイヤーが増えたときや
  // 解像度を変えたときに走り、足りないものだけ変換する。原本指定のときは何も作らない。
  // 同時変換は2本まで（映像レイヤーが多いプロジェクトで ffmpeg が一斉に立ち上がるのを防ぐ）。
  useEffect(() => {
    if (previewRes === 'orig') return
    const res = previewRes
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
  const [customCats, setCustomCats] = useState<{ key: string; label: string }[]>(loadCustomCats)
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
      if (typeof s.zoom === 'number') setZoom(s.zoom)
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
  const [newTelopStyle, setNewTelopStyle] = useState<TelopStyle>(defaultTelopStyle) // 新規テロップの既定
  // 新規トランジションの長さ(秒)。D&D で置く時の初期長さ。置いた後は帯の端ドラッグ/選択で変更。
  // ※プロジェクトに保存する値なので、未保存判定の依存配列より前で宣言しておくこと。
  const [transDur, setTransDur] = useState(0.4)
  const draggingTemplateRef = useRef<TelopStyle | null>(null) // テンプレをテロップへD&D中
  const [userTemplates, setUserTemplates] = useState<TelopTemplate[]>(loadUserTemplates)
  function saveCurrentAsTemplate(): void {
    const base = selected?.style ?? newTelopStyle
    askText('テンプレート名', 'マイテロップ' + (userTemplates.length + 1), (name) => {
      if (!name) return
      const next = [...userTemplates, { name, style: structuredClone(base) }]
      setUserTemplates(next)
      saveUserTemplates(next)
    })
  }
  function deleteUserTemplate(i: number): void {
    const next = userTemplates.filter((_, k) => k !== i)
    setUserTemplates(next)
    saveUserTemplates(next)
  }

  // ---- アイコン画像ライブラリ（単純な画像置き場。追加時にクロップ）----
  const [iconLibrary, setIconLibrary] = useState<IconItem[]>(loadIconLibrary)
  const [iconAssign, setIconAssignState] = useState<Record<string, string>>(loadIconAssign) // 色→画像
  // レーン（テロップトラック）→画像。色と別軸でレーン単位でもアイコンを割当できる
  const [laneIconAssign, setLaneIconAssign] = useState<Record<string, string>>(() =>
    loadLS('giftcut.laneIconAssign', {})
  )
  function setIconForLane(lane: string, image: string | null): void {
    setLaneIconAssign((prev) => {
      const n = { ...prev }
      if (image) n[lane] = image
      else delete n[lane]
      saveLS('giftcut.laneIconAssign', n)
      return n
    })
  }
  const [iconSettingsOpen, setIconSettingsOpen] = useState(false)
  const [cropSrc, setCropSrc] = useState<{ src: string; onDone: (img: string) => void } | null>(
    null
  )
  // アイコンの配置：テロップに付随（テキスト量に追従）。位置=どの側 / 微調整=XY(1080px) / サイズ。
  // プロジェクトに保存。
  const [iconSide, setIconSide] = useState<'left' | 'right' | 'top' | 'bottom'>('left')
  const [iconOffset, setIconOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [iconScale, setIconScale] = useState<number>(1)
  const [iconAuto, setIconAuto] = useState<boolean>(false)
  // アイコン軸: 自動調整ONで全テロップを揃える共有アンカー点（左端・縦中央）。
  // テロップごとに位置がバラつくとアイコンが飛び回るため、軸を1点に固定する（ユーザー要望 2026-07-23）。
  const [iconAnchorPos, setIconAnchorPos] = useState<{ x: number; y: number } | null>(null)
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
  const iconForCue = (c: Cue): string | undefined =>
    c.personIcon === false
      ? undefined
      : (c.iconImage ?? iconAssign[c.label] ?? laneIconAssign[cueTrack(c)])
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
  async function addIconImages(): Promise<void> {
    const inp = document.createElement('input')
    inp.type = 'file'
    inp.accept = 'image/*'
    inp.onchange = async (): Promise<void> => {
      const f = inp.files?.[0]
      if (!f) return
      try {
        const src = await fileToDataUrl(f)
        const name = f.name.replace(/\.[^.]+$/, '')
        setCropSrc({ src, onDone: (img) => appendIconImage(name, img) })
      } catch {
        /* スキップ */
      }
    }
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
  // アイコン画像をテロップにドロップして適用（個別上書き＋表示。選択の一部なら選択全部に）
  function applyIconToCue(cueId: number, image: string): void {
    const targets = selectedIds.includes(cueId) && selectedIds.length ? selectedIds : [cueId]
    setCues((prev) =>
      prev.map((c) =>
        targets.includes(c.id) ? { ...c, iconImage: image, personIcon: undefined } : c
      )
    )
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

  // ---- パネルサイズ ----
  // パネルのレイアウトは記憶する（毎起動で同じドラッグをやり直さないように）
  const [leftW, setLeftW] = useState(() => loadLS('gc.leftW', 250))
  const [rightW, setRightW] = useState(() => loadLS('gc.rightW', 300))
  // タイムラインの高さ。段を太らせるのではなく、領域そのものに余裕を持たせる
  // （プレミアも行は細く、下に余白がある形）。段が増えても足りなくならない。
  const [timelineH, setTimelineH] = useState(() => loadLS('gc.timelineH', 420))
  useEffect(() => {
    saveLS('gc.leftW', leftW)
    saveLS('gc.rightW', rightW)
    saveLS('gc.timelineH', timelineH)
  }, [leftW, rightW, timelineH])

  // ---- refミラー（stale closure 対策）----
  const currentTimeRef = useRef(0)
  const durationRef = useRef(60)
  const videoDurationRef = useRef(0)
  const zoomRef = useRef(24)
  const playRateRef = useRef(0) // 0 = 停止, 正 = 順再生, 負 = 逆再生
  const rafRef = useRef<number | null>(null)
  const lastTsRef = useRef(0)

  // ---- クリップボード & 編集履歴（Undo/Redo）----
  // 履歴は cues / segments / seClips / markers / imgClips を1スナップショットで管理する（統合Undo）
  interface Snap {
    cues: Cue[]
    segments: VSeg[]
    seClips: SEClip[]
    markers?: Marker[]
    imgClips?: ImgClip[]
    vClips?: VClip[]
    // トラック構成/状態・比率・元動画一覧も履歴に含める。
    // 含めないと「トラックを追加→Ctrl+Z」で1つ前の別操作が取り消されて驚く。
    tracks?: Track[]
    trackStates?: Record<string, TrackState>
    ratio?: Ratio
    // ※sources は履歴に含めない。波形/プロキシ/尺は非同期で後追いで入るキャッシュなので、
    //   履歴に混ぜると Undo で解析結果まで巻き戻って波形が消える。
    //   参照されなくなったソースは専用の GC effect で片付ける。
  }
  const clipboardRef = useRef<Cue[]>([])
  const clipboardSeRef = useRef<SEClip[]>([]) // SE/BGM のクリップボード
  const clipboardImgRef = useRef<ImgClip[]>([]) // 画像のクリップボード
  const clipboardVcRef = useRef<VClip[]>([]) // 映像レイヤーのクリップボード
  const cuesRef = useRef<Cue[]>([])
  const segsRef = useRef<VSeg[]>([])
  const seClipsRef = useRef<SEClip[]>([])
  const markersRef = useRef<Marker[]>([])
  const imgClipsRef = useRef<ImgClip[]>([])
  const tracksRef = useRef<Track[]>([])
  const trackStatesRef = useRef<Record<string, TrackState>>({})
  const ratioRef = useRef<Ratio>('16:9')
  const undoStackRef = useRef<Snap[]>([])
  const redoStackRef = useRef<Snap[]>([])
  const baselineRef = useRef<Snap>({ cues: [], segments: [], seClips: [] }) // 最後に確定した状態
  const pendingTimerRef = useRef<number | null>(null)
  const suppressHistoryRef = useRef(false) // undo/redo 自身の set を履歴化しない
  const [, setHistTick] = useState(0)

  function setTime(t: number): void {
    currentTimeRef.current = t
    setCurrentTime(t)
  }
  // 再生中の再生ヘッド/テロップ再描画をスロットル。ref は常に更新して同期を保ち、
  // React state（＝再描画）だけ間引く。force で確実に反映。
  // 最軽量(360p)を選んだときだけ ~30fps に間引く。「解像度」と「再描画頻度」を別の
  // つまみにするとユーザーが2つ覚えることになるため、設定は解像度ひとつに束ねている。
  function paintTime(t: number, force = false): void {
    currentTimeRef.current = t
    if (!force && previewResRef.current === 360) {
      const now = performance.now()
      if (now - lastPaintRef.current < 33) return // ~30fps
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
        setHistTick((t) => t + 1)
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
  function restore(s: Snap): void {
    baselineRef.current = s
    suppressHistoryRef.current = true
    setCues(s.cues)
    setSegments(s.segments)
    setSeClips(s.seClips)
    // 旧スナップショット（markers/imgClips 等の導入前）は現状維持
    if (s.markers) setMarkers(s.markers)
    if (s.imgClips) setImgClips(s.imgClips)
    if (s.vClips) setVClips(s.vClips)
    if (s.tracks) setTracks(s.tracks)
    if (s.trackStates) setTrackStates(s.trackStates)
    if (s.ratio) setRatio(s.ratio)
    setSelectedIds([])
    setEditingId(null) // Undo/Redoで消えたテロップの編集画面が残らないように
    clearSegSel()
    setHistTick((t) => t + 1)
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
    setHistTick((t) => t + 1)
    // 保険: 続く setCues 等のエフェクトでフラグが消費されなかった場合、次tickで確実に解除
    // （消費済みなら false のまま＝no-op。残留すると次の本物の編集がundoに積まれない不具合の対策）
    setTimeout(() => {
      suppressHistoryRef.current = false
    }, 0)
  }

  const primaryId = selectedIds[0] ?? null
  const selected = cues.find((c) => c.id === primaryId) ?? null
  const isSelected = (id: number): boolean => selectedIds.includes(id)

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
  useEffect(() => {
    zoomRef.current = zoom
  }, [zoom])

  // 音声ミュート/音量を動画要素に反映（A1トラック＝メイン音声。切片ミュート・音量・フェードも合成）
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const src = tToSource(segLayout, currentTime)
    const L = src ? segLayout[src.index] : undefined
    const seg = L?.seg
    const segMuted = seg ? !!seg.muted : false
    if (v.muted !== segMuted) v.muted = segMuted // トラックのミュート/ソロは音量ゲイン側で反映
    // 切片の音量倍率×フェード（頭/尻の指定秒で 0→1 / 1→0）
    let segGain = seg?.vol ?? 1
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
        if (Math.abs(a.currentTime - target) > 0.3) a.currentTime = target
        // 載っているトラック音量×フェード（頭/尻の指定秒で 0→1 / 1→0）※クリップ内ローカル秒で判定
        const fade = seFadeGain(clip, local)
        a.volume = clamp(clip.volume * fade * audioTrackGain(clip.track), 0, 1)
        if (a.paused) void a.play().catch(() => {})
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
      const el = videoElsRef.current.get(s.id)
      if (el) {
        videoRef.current = el
        // 切替先を今の位置へ即シーク（再生中は再生クロックが追従させるが、初手のズレを詰める）
        if (src) {
          const want = seg ? seg.srcStart + (currentTime - segLayout[src.index].tStart) * src.speed : 0
          if (Math.abs(el.currentTime - want) > 0.15) el.currentTime = want
        }
      }
      // 直前まで表示していた要素は止める（裏で音が鳴り続けるのを防ぐ）
      videoElsRef.current.forEach((v, id) => {
        if (id !== s.id) {
          if (!v.paused) v.pause()
          v.muted = true
        }
      })
      if (el) el.muted = false
      // duration 未取得(0)なら据え置き（0にすると再生開始条件が壊れる）。metadata到達時に更新される。
      if (s.duration > 0) setVideoDuration(s.duration)
      setFps(s.fps)
    }
    // 後追いのプロキシ/fps/尺が届いたら反映（届くまで原本再生・既定30のままになるのを防ぐ）
    // プレビュー解像度を変えたときもここで src を差し替える（再生ヘッド位置は触らないので維持される）
    setVideoSrc((prev) => (prev === desired ? prev : desired))
    setFps((prev) => (Math.abs(prev - s.fps) > 1e-3 ? s.fps : prev))
    if (s.duration > 0)
      setVideoDuration((prev) => (Math.abs(prev - s.duration) > 1e-3 ? s.duration : prev))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTime, segLayout, sources, previewRes, proxyMap])
  // 次に来る別ソースの映像を先回りシークして待機させる（切替の瞬間に正しいフレームが即出る）
  useEffect(() => {
    if (sources.length <= 1) return
    const cur = segLayout.find((l) => currentTime >= l.tStart && currentTime < l.tEnd)
    const nxt = cur ? segLayout[cur.index + 1] : segLayout[0]
    if (!nxt || nxt.tStart - currentTime > 6) return // 6秒前から準備
    const s = srcOfSeg(nxt.seg)
    if (!s || s.id === curSourceIdRef.current) return
    const el = videoElsRef.current.get(s.id)
    if (!el) return
    if (Math.abs(el.currentTime - nxt.seg.srcStart) > 0.3) el.currentTime = nxt.seg.srcStart
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
        if (local < 0 && Math.abs(el.currentTime - c.srcStart) > 0.3) el.currentTime = c.srcStart
        return
      }
      const want = c.srcStart + local
      if (Math.abs(el.currentTime - want) > 0.25) el.currentTime = want
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
  const curSegZoom = (() => {
    const src = tToSource(segLayout, currentTime)
    return (src ? segments[src.index]?.zoom : undefined) ?? DEFAULT_ZOOM
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
  interface ReframeTarget {
    kind: 'video' | 'img' | 'vclip'
    id: number
    zoom: { scale: number; x: number; y: number }
    rotate: number
    track: string
    name: string
  }
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
        name: vc.name
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
        name: img.name
      }
    // 選択している切片を優先する（画像・映像レイヤーは選択から取っているのに、
    // 動画切片だけ再生ヘッド位置から取っていたため、3番目の切片を選んで枠を
    // ドラッグすると再生ヘッドのある1番目が拡大されていた）。
    // 選択が無いときだけ従来どおり再生ヘッド位置の切片を対象にする。
    const selSeg = selectedVideoIds.length
      ? segLayout.find((l) => selectedVideoIds.includes(l.seg.id))?.seg
      : undefined
    const src = tToSource(segLayout, currentTime)
    const seg = selSeg ?? (src ? segLayout[src.index]?.seg : undefined)
    if (!seg) return null
    return {
      kind: 'video' as const,
      id: seg.id,
      zoom: seg.zoom ?? DEFAULT_ZOOM,
      rotate: seg.rotate ?? 0,
      track: 'V1',
      name: srcOfSeg(seg)?.name ?? videoName ?? '動画'
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
      if (Math.abs(vb.currentTime - xfPreview.srcTime) > 0.25) vb.currentTime = xfPreview.srcTime
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
        currentSegRef.current = src.index
        // 大きくズレたら（＝不連続カットをまたいだ／ドリフト）シークで追いつく。プロキシなら一瞬。
        if (Math.abs(vv.currentTime - src.srcTime) > 0.25) vv.currentTime = src.srcTime
        // ended のまま play() すると先頭から再生し直してしまうため除外（シーク後は ended が解除される）
        if (vv.paused && !vv.ended) void vv.play().catch(() => {})
        // 再生ヘッドの進む速さ(rate) × 切片の速度。動画側はこの実効レートで追従。
        const r = Math.min(rate * src.speed, 16)
        if (Math.abs(vv.playbackRate - r) > 1e-3) vv.playbackRate = r
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
  // 指定切片のズームを設定（DEFAULTなら undefined に戻す）
  function setSegZoom(segId: number, z: { scale: number; x: number; y: number }): void {
    setSegments((prev) =>
      prev.map((s) => (s.id === segId ? { ...s, zoom: isNeutralZoom(z) ? undefined : z } : s))
    )
  }
  // 選択中の動画切片のクロップを部分更新（null=リセット）。各辺 0..0.9、対辺と合わせて0.95未満。
  function setSelectedCrop(
    patch: Partial<{ l: number; t: number; r: number; b: number }> | null
  ): void {
    if (!selectedVideoIds.length) return
    setSegments((prev) =>
      prev.map((s) => {
        if (!isVideoSel(s.id)) return s
        if (patch === null) return { ...s, crop: undefined }
        const next = { ...(s.crop ?? DEFAULT_CROP), ...patch }
        next.l = clamp(next.l, 0, 0.9)
        next.t = clamp(next.t, 0, 0.9)
        next.r = clamp(next.r, 0, 0.9)
        next.b = clamp(next.b, 0, 0.9)
        // 対辺の合計が枠を潰さないよう、今動かした辺を優先して制限
        if (next.l + next.r > 0.95) {
          if (patch.r != null) next.r = 0.95 - next.l
          else next.l = 0.95 - next.r
        }
        if (next.t + next.b > 0.95) {
          if (patch.b != null) next.b = 0.95 - next.t
          else next.t = 0.95 - next.b
        }
        return { ...s, crop: isNeutralCrop(next) ? undefined : next }
      })
    )
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
    const start = { ...tgt.zoom }
    const apply = (z: { scale: number; x: number; y: number }): void =>
      tgt.kind === 'video'
        ? setSegZoom(tgt.id, z)
        : tgt.kind === 'vclip'
          ? setVClipZoom(tgt.id, z)
          : setImgZoom(tgt.id, z)
    const sx = e.clientX
    const sy = e.clientY
    const startDist = Math.max(1, Math.hypot(e.clientX - cx, e.clientY - cy))
    const onMove = (ev: PointerEvent): void => {
      if (corner != null) {
        const dist = Math.hypot(ev.clientX - cx, ev.clientY - cy)
        apply({ ...start, scale: clamp(start.scale * (dist / startDist), 0.2, 8) })
      } else {
        apply({
          ...start,
          x: clamp(start.x + (ev.clientX - sx) / rect.width, -1, 1),
          y: clamp(start.y + (ev.clientY - sy) / rect.height, -1, 1)
        })
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
      name: o.clip.name
    }
    if (o.kind === 'img') setSelectedImgIds([o.clip.id])
    else setSelectedVClipIds([o.clip.id])
    // 選択の state はまだ反映されていないので、対象を明示的に渡す
    onVideoReframeStart(e, null, tgt)
  }
  function resetVideoZoom(): void {
    const tgt = reframeTargetRef.current
    if (!tgt) return
    if (tgt.kind === 'video') setSegZoom(tgt.id, DEFAULT_ZOOM)
    else if (tgt.kind === 'vclip') setVClipZoom(tgt.id, DEFAULT_ZOOM)
    else setImgZoom(tgt.id, DEFAULT_ZOOM)
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
  function skipSec(sec: number): void {
    stopPlayback()
    seekTo(currentTimeRef.current + sec)
  }
  // 1フレーム単位で移動（フレームグリッドに量子化）。
  function stepFrame(frames: number): void {
    stopPlayback()
    seekTo(qFrame(currentTimeRef.current, fpsRef.current) + frames / fpsRef.current)
  }
  // 現在のプレビュー画面（動画フレーム＋テロップ＋ズーム）を PNG で保存。
  // 表示中と同じプロキシ映像を出力解像度で描き、テロップは書き出しと同じ rasterize を再利用。
  async function captureScreenshot(): Promise<void> {
    const v = videoRef.current
    if (!videoSrc || !v) {
      showToast('先に動画を読み込んでください。\n「ファイル」→「動画をプロジェクトに追加…」から追加できます。')
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
      const st = hasAnim(c.style.anim) ? computeTelopAnim(c.style.anim!, t - c.start, c.end - c.start) : undefined
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

  // ================= 読み込み =================
  async function handleImportSrt(): Promise<void> {
    const res = await window.giftcut.importSrt()
    if (!res) return
    stopPlayback() // 再生中に読み込むとヘッドと動画がズレるため必ず停止
    let parsed = parseSrt(res.content)
    // アイコン軸が有効なら読み込んだテロップも軸に整列（アイコンが飛ばないように）
    if (iconAuto && iconAnchorPos) {
      parsed = parsed.map((c) => ({
        ...c,
        pos: { ...iconAnchorPos },
        style: (() => {
          const st = { ...c.style, anchor: { h: 'l' as const, v: 'm' as const }, align: 'left' as const }
          delete st.box
          return st
        })()
      }))
    }
    // 既存テロップを全置換するので、消える前に確認する（動画差し替えには確認が
    // あるのに、こちらは無確認でスタイル済みテロップが全部消え、Undoも効かなかった）
    if (cuesRef.current.length) {
      const okToReplace = await askConfirm({
        title: `現在のテロップ ${cuesRef.current.length} 件をすべて置き換えます`,
        body: 'スタイルや位置の調整も失われます。この操作は元に戻せません。',
        okLabel: '置き換える',
        cancelLabel: '中止',
        danger: true
      })
      if (!okToReplace) return
    }
    idCounter.current = parsed.length + 1
    resetHistory({ cues: parsed, segments: segsRef.current, seClips: seClipsRef.current }) // 履歴リセット（動画切片・SEは維持）
    setCues(parsed)
    setSrtPath(res.path)
    setSelectedIds(parsed[0] ? [parsed[0].id] : [])
    seekTo(parsed[0]?.start ?? 0)
  }

  // 指定パスの動画をアクティブ動画として読み込む（差し替え）
  // placed=true: 切片は呼び出し側が置くので、読み込み時の自動配置（先頭に全長1本）はしない。
  async function loadVideo(path: string, opts?: { placed?: boolean }): Promise<void> {
    stopPlayback()
    // 動画差し替え: 履歴を破棄し、segsRef も同期リセット（onLoadedMetadata の初期化レース対策）
    if (pendingTimerRef.current) {
      clearTimeout(pendingTimerRef.current)
      pendingTimerRef.current = null
    }
    undoStackRef.current = []
    redoStackRef.current = []
    baselineRef.current = { cues: cuesRef.current, segments: [], seClips: seClipsRef.current }
    segsRef.current = []
    suppressHistoryRef.current = true
    setSegments([])
    clearSegSel()
    segIdCounter.current = 1
    setVideoSrc(toGcUrl(path))
    setVideoPath(path)
    setVideoName(path.split(/[\\/]/).pop() ?? null)
    setTime(0)
    setWaveform(null)
    setThumbnailSrc(null)
    // マルチソース: 主ソース(sources[0])として登録し直す（差し替え=単一ソースに戻す）
    const srcId = sourceIdCounter.current++
    curSourceIdRef.current = srcId
    setActiveSrcId(srcId)
    videoElsRef.current.clear() // 旧ソースの要素は破棄される
    // 新しい動画なので初期切片を1度だけ作る。ただし呼び出し側が位置を決めて置く場合は、
    // 「もう初期化済み」にしておいて自動配置（先頭に全長1本）を止める。
    initializedForPathRef.current = opts?.placed ? path : null
    setSources([
      {
        id: srcId,
        path,
        name: path.split(/[\\/]/).pop() ?? path,
        origUrl: toGcUrl(path),
        duration: 0,
        fps: FPS,
        waveform: null
      }
    ])
    // 素材の実fpsを取得（フレームステップ/タイムコード/カット量子化に反映）。失敗時は既定30。
    setFps(FPS)
    void window.giftcut.getFps(path).then((r) => {
      if (proxyForPathRef.current === path && r?.ok && r.fps && r.fps > 0) {
        const f = Math.round(r.fps * 1000) / 1000
        setFps(f)
        updateSource(srcId, { fps: f })
      }
    })
    // ライブラリに無ければ追加（File メニューからの読み込み等）
    setMediaItems((prev) =>
      prev.some((m) => m.path === path)
        ? prev
        : [
            ...prev,
            { id: mediaIdCounter.current++, path, name: path.split(/[\\/]/).pop() ?? path, kind: 'video' as const }
          ]
    )
    // 編集用プロキシ（キーフレーム密＝シーク高速）は「プレビュー解像度」の effect が sources を
    // 見て生成し、出来たら上のソース切替 effect が src を差し替える。原本指定なら生成しない。
    // 書き出しは videoPath(原本) を使うので画質は劣化しない。
    proxyForPathRef.current = path
    const [wf, th] = await Promise.all([
      window.giftcut.generateWaveform(path),
      window.giftcut.generateThumbnail(path)
    ])
    if (proxyForPathRef.current !== path) return // 解析中に別動画へ切替えた（前の波形/サムネを出さない）
    if (wf?.ok && wf.min && wf.max) {
      const wv = { min: wf.min, max: wf.max, dur: wf.duration ?? 0 }
      setWaveform(wv)
      updateSource(srcId, { waveform: wv })
    }
    if (th?.ok && th.path) {
      const url = toGcUrl(th.path)
      setThumbnailSrc(url) // タイムラインの動画クリップ用
      setMediaItems((prev) => prev.map((m) => (m.path === path ? { ...m, thumb: url } : m)))
    }
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

  // マルチソース: 動画を「新しい元動画」としてソース登録（既存の切片・編集はそのまま）。
  // プロキシ/波形/fps/サムネは非同期で後追い反映。切片の配置は呼び出し側が行う。
  async function registerSource(path: string): Promise<{ id: number; dur: number } | null> {
    const dRes = await window.giftcut.getDuration(path)
    const dur = dRes?.ok && dRes.duration ? dRes.duration : 0
    if (dur <= 0) {
      showToast('動画の長さを取得できませんでした。', 'error')
      return null
    }
    // 同じパスが登録済みならそれを再利用（1動画=1ソース。切片だけ増やす）
    const existing = sourcesRef.current.find((s) => s.path === path)
    if (existing) return { id: existing.id, dur: existing.duration || dur }
    const id = sourceIdCounter.current++
    const name = path.split(/[\\/]/).pop() ?? path
    srcAddedAtRef.current.set(id, performance.now()) // GCの猶予用
    setSources((prev) => [
      ...prev,
      { id, path, name, origUrl: toGcUrl(path), duration: dur, fps: FPS, waveform: null }
    ])
    // ライブラリにも追加
    setMediaItems((prev) =>
      prev.some((m) => m.path === path)
        ? prev
        : [...prev, { id: mediaIdCounter.current++, path, name, kind: 'video' as const }]
    )
    // 後追い: fps / 波形 / サムネ（プロキシは「プレビュー解像度」の effect が用意する）
    void window.giftcut.getFps(path).then((r) => {
      if (r?.ok && r.fps && r.fps > 0) updateSource(id, { fps: Math.round(r.fps * 1000) / 1000 })
    })
    void window.giftcut.generateWaveform(path).then((r) => {
      if (r?.ok && r.min && r.max)
        updateSource(id, { waveform: { min: r.min, max: r.max, dur: r.duration ?? 0 } })
    })
    void window.giftcut.generateThumbnail(path).then((r) => {
      if (r?.ok && r.path) {
        const url = toGcUrl(r.path)
        setMediaItems((prev) => prev.map((m) => (m.path === path ? { ...m, thumb: url } : m)))
      }
    })
    return { id, dur }
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
  function addMediaPaths(paths: string[], folder?: string): void {
    if (!paths.length) return
    const existing = new Set(mediaItems.map((m) => m.path))
    const add: MediaItem[] = paths
      .filter((p) => !existing.has(p))
      .map((p) => {
        const kind = kindOf(p)
        return {
          id: mediaIdCounter.current++,
          path: p,
          name: p.split(/[\\/]/).pop() ?? p,
          kind,
          folder,
          thumb: kind === 'image' ? toGcUrl(p) : undefined
        }
      })
    if (!add.length) return
    setMediaItems((prev) => [...prev, ...add])
    // 追加した種類のフォルダを自動で開く（テロップタブと同じ「開いて見せる」動作＝追加が迷子にならない）
    // 追加した種類は必ず開いた状態にする（追加が迷子にならない）。
    // プロジェクトタブは複数同時に開けるので、他を閉じずに足すだけでよい。
    setOpenAccSec((p) => ({
      ...p,
      project: [...new Set([...(p.project ?? []), add[0].kind])]
    }))
    // 動画のサムネを生成
    add.filter((m) => m.kind === 'video').forEach((m) => genThumbFor(m.id, m.path))
    // 取り込み時に尺と音声波形も用意する（配置前から波形が見える＝映像と音がリンクした状態）
    add.forEach((m) => prepareMediaMeta(m.path, m.kind))
    // 追加しただけではタイムラインに載せない。置く位置は自分で決めるもので、
    // 勝手に先頭へ置かれると2本目以降が後ろに回って並べ直しになる。
    // タイムラインへドラッグするか、ビンでダブルクリックすると読み込まれる。
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

  // ================= プロジェクト保存 / 読み込み =================
  // プロジェクトのシリアライズ（保存・自動保存で共通）
  // pathOverride: 保存直後に「保存済みの基準」を作るとき、まだ state に
  // 反映されていない新しい保存先を渡す。これを渡さないと基準が古いパスで
  // 作られ、以降ずっと「未保存の変更あり」と判定され続ける（初回保存や
  // 別名保存の直後に必ず起きていた）。
  function projectJson(pathOverride?: string | null): string {
    return JSON.stringify(
      {
        version: 1,
        // 素材が見つからなかった場合は元のパスを書き戻す（消さない）
        videoPath: videoPath ?? missingMedia?.videoPath ?? null,
        srtPath,
        // マルチソース: 元動画一覧（id/path/name）。プロキシ/波形/fpsは読込時に再生成。
        sources: sources.length
          ? sources.map((s) => ({ id: s.id, path: s.path, name: s.name }))
          : (missingMedia?.sources ?? []),
        ratio,
        tracks,
        cues,
        segments,
        seClips,
        markers,
        imgClips,
        vClips,
        // トラックの状態（ロック/非表示/ミュート/ソロ/音量）とメディアビンも保存する
        // ＝開き直したときに非表示設定や追加素材が消えないように
        trackStates,
        mediaItems: mediaItems.map((m) => ({
          path: m.path,
          name: m.name,
          kind: m.kind,
          folder: m.folder
        })),
        iconSide,
        iconOffset,
        iconScale,
        iconAuto,
        iconAnchorPos,
        // ラベル色/レーンごとのアイコン割当。プロジェクトに入れないと、別PCで開いたとき
        // 「個別にD&Dしたアイコンだけ残り、色で割り当てたアイコンが無警告で全部消える」。
        iconAssign,
        laneIconAssign,
        // 書き出し設定・音量系もプロジェクトの一部（毎回やり直し＆設定違いでの再エンコード事故を防ぐ）
        exportOpts,
        loudnormLUFS,
        masterVolume,
        transDur, // トランジションの既定長
        newTelopStyle, // このプロジェクトで次に追加するテロップの既定スタイル
        // 現在のプロジェクトファイルパス（自動保存からの復帰でタイトル/上書き先を失わないため）
        projectPath: pathOverride !== undefined ? pathOverride : projectPath
      },
      null,
      1
    )
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
  async function saveProjectFn(asNew = false): Promise<void> {
    if (!hasProjectContent()) {
      showToast('保存する内容がありません。')
      return
    }
    // 保留中(450msデバウンス)の履歴を先に確定させる。これが無いと
    // 「動かして即 Ctrl+S」の直後の Ctrl+Z が、その移動ではなく1つ前を取り消す。
    commitPending()
    // .gcproj 以外（例: 読み込んだSRT）を上書き先にしない安全弁
    const cur = projectPath && /\.(gcproj|json)$/i.test(projectPath) ? projectPath : null
    const res = await window.giftcut.saveProject(projectJson(), cur, asNew)
    if (res?.ok && res.path) {
      setProjectPath(res.path) // 以降の Ctrl+S はここへ上書き
      // 手動保存できたら自動保存の下書きは不要（毎起動で復帰プロンプトが出続けるのを防ぐ）
      void window.giftcut.autosaveClear()
      const saved = projectJson(res.path)
      lastAutosaveRef.current = saved
      savedJsonRef.current = saved // ここを「保存済み」の基準にする
      baselineRef.current = snapNow() // 保存時点を「未編集」の基準にする
      rememberProject(res.path) // ファイルメニューの「最近使ったプロジェクト」に出す
      markUnsavedRef.current(saved) // タイトルの「＊」を待たずに消す
      showToast('プロジェクトを保存しました:\n' + res.path, 'success')
    } else if (res?.error && res.error !== 'キャンセル')
      showToast('保存失敗: ' + res.error, 'error')
  }

  // path 省略=ダイアログで選ぶ / path 指定=最近使ったプロジェクトを直接開く
  async function openProjectFn(path?: string): Promise<void> {
    // 閉じるときは確認するのに開くときはしない、という非対称を解消する
    // （確認なしだと30分の作業が警告なしに消え、しかも自動保存の下書きも
    //   30秒後に新しいプロジェクトで上書きされて復元不能になる）
    if (!(await confirmDiscard('別のプロジェクトを開く'))) return
    const res = await window.giftcut.openProject(path)
    if (!res) return
    if (!res.ok || !res.data) {
      showToast('プロジェクトを開けませんでした:\n' + (res.error ?? '不明なエラー'), 'error')
      // 見つからなくなったファイルは一覧から外す（毎回同じエラーを踏まないように）
      if (path) setRecentProjects((prev) => prev.filter((r) => r.path !== path))
      return
    }
    await applyProjectData(res.data, !!res.videoExists, res.path ?? null)
    if (res.path) rememberProject(res.path)
  }

  // テンプレJSON＝プロジェクトタブ(メディアビン)＋テロップ設定(フォルダ/お気に入り/カテゴリ)＋比率/アイコン。
  // タイムライン(カット/配置=cues/segments/seClips/videoPath)は含めない。
  function templateJson(): string {
    return JSON.stringify(
      {
        version: 1,
        kind: 'template',
        ratio,
        mediaItems: mediaItems.map((m) => ({
          path: m.path,
          name: m.name,
          kind: m.kind,
          folder: m.folder
        })),
        iconSide,
        iconOffset,
        iconScale,
        iconAuto,
        iconAnchorPos,
        // テンプレは「開始状態を揃える」ものなので、テロップの自作テンプレと
        // アイコン割当・既定スタイルも含める（含めないと★が存在しないテンプレを指す）
        telop: { favorites, catOverrides, customCats, userTemplates },
        iconAssign,
        laneIconAssign,
        newTelopStyle
      },
      null,
      1
    )
  }
  // テンプレを適用（メディアビン＋テロップ設定＋設定。タイムラインは触らない）
  /* eslint-disable @typescript-eslint/no-explicit-any */
  function applyProjectTemplate(data: any): void {
    const d = data as any
    // テンプレは「新規プロジェクトの開始状態」なので、保存先は引き継がない。
    // 残すと直後の Ctrl+S が元のプロジェクトを無警告で上書きしてしまう。
    setProjectPath(null)
    if (d.ratio) setRatio(d.ratio)
    if (Array.isArray(d.mediaItems)) {
      const items: MediaItem[] = d.mediaItems
        .filter((m: any) => m && typeof m.path === 'string')
        .map((m: any) => {
          const kind = kindOf(String(m.path))
          return {
            id: mediaIdCounter.current++,
            path: String(m.path),
            name: String(m.name ?? String(m.path).split(/[\\/]/).pop() ?? ''),
            kind,
            folder: typeof m.folder === 'string' ? m.folder : undefined,
            thumb: kind === 'image' ? toGcUrl(String(m.path)) : undefined
          }
        })
      // 画像はパスをそのままサムネに（テンプレ適用と同じ扱いに揃える）
      const withThumb = items.map((m) =>
        m.kind === 'image' ? { ...m, thumb: toGcUrl(m.path) } : m
      )
      setMediaItems(withThumb)
      withThumb.filter((m) => m.kind === 'video').forEach((m) => genThumbFor(m.id, m.path))
      // 尺と波形も用意し直す（ドラッグ時のゴーストに波形が出るように）
      withThumb.forEach((m) => prepareMediaMeta(m.path, m.kind))
    }
    if (d.iconSide) setIconSide(d.iconSide)
    if (d.iconOffset && typeof d.iconOffset.x === 'number') setIconOffset(d.iconOffset)
    if (typeof d.iconScale === 'number') setIconScale(d.iconScale)
    if (typeof d.iconAuto === 'boolean') setIconAuto(d.iconAuto)
    if (d.iconAnchorPos && typeof d.iconAnchorPos.x === 'number' && typeof d.iconAnchorPos.y === 'number')
      setIconAnchorPos({ x: d.iconAnchorPos.x, y: d.iconAnchorPos.y })
    // 動画ズーム（リフレーム）は切片ごと（loadedSegs で復元済み）。旧グローバル videoZoom は無視。
    // テロップの整理（★/カテゴリ/自作フォルダ）は「置換」ではなく「マージ」。
    // 置換すると、育てたお気に入りとフォルダ分けがテンプレを1回開くだけで消える（Undo不可）。
    if (d.telop) {
      if (Array.isArray(d.telop.favorites)) {
        const merged = Array.from(new Set([...favorites, ...d.telop.favorites]))
        setFavorites(merged)
        saveFavorites(merged)
      }
      if (d.telop.catOverrides && typeof d.telop.catOverrides === 'object') {
        // 既存の割り当てを優先（テンプレは「まだ決まっていないものだけ」埋める）
        const merged = { ...d.telop.catOverrides, ...catOverrides }
        setCatOverrides(merged)
        saveCatOverrides(merged)
      }
      if (Array.isArray(d.telop.customCats)) {
        const seen = new Set(customCats.map((c: { key: string }) => c.key))
        const merged = [
          ...customCats,
          ...d.telop.customCats.filter((c: { key: string }) => c && !seen.has(c.key))
        ]
        setCustomCats(merged)
        saveCustomCats(merged)
      }
    }
    // 自作テロップテンプレ・アイコン割当・既定スタイルもテンプレから復元（名前重複はスキップ）
    if (Array.isArray(d.telop?.userTemplates)) {
      const have = new Set(userTemplates.map((t) => t.name))
      const add = d.telop.userTemplates.filter(
        (t: { name?: string }) => t && typeof t.name === 'string' && !have.has(t.name)
      )
      if (add.length) {
        const merged = [...userTemplates, ...add]
        setUserTemplates(merged)
        saveUserTemplates(merged)
      }
    }
    if (d.iconAssign && typeof d.iconAssign === 'object') {
      const merged = { ...d.iconAssign, ...iconAssign }
      setIconAssignState(merged)
      saveIconAssign(merged)
    }
    if (d.laneIconAssign && typeof d.laneIconAssign === 'object') {
      const merged = { ...d.laneIconAssign, ...laneIconAssign }
      setLaneIconAssign(merged)
      saveLS('giftcut.laneIconAssign', merged)
    }
    if (d.newTelopStyle && typeof d.newTelopStyle === 'object') setNewTelopStyle(d.newTelopStyle)
    showToast('テンプレートを読み込みました。', 'success')
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */
  // 現在の設定をテンプレートとして保存（GiftCut/テンプレート/ 配下）
  function saveAsTemplateFn(): void {
    askText('テンプレート名', 'マイテンプレート', (name) => {
      if (!name) return
      void window.giftcut.saveTemplate(name, templateJson()).then((res) => {
        if (res?.ok) showToast('テンプレートを保存しました:\n' + res.path, 'success')
        else showToast('保存失敗: ' + (res?.error ?? ''), 'error')
      })
    })
  }
  // テンプレートを開く＝テンプレートフォルダ内の一覧から選ぶ（アプリ内ピッカー）
  async function openTemplateFn(): Promise<void> {
    const t = await window.giftcut.listTemplates()
    if (!t?.ok || !t.items.length) {
      showToast('テンプレートがありません。\n「テンプレートとして保存」で作成してください。')
      return
    }
    setTemplatePicker({ items: t.items, startup: false })
  }
  // テンプレート選択モーダル（起動時 or 手動）。適用は原本を汚さない＝新規扱い(srcPath=null)
  const [templatePicker, setTemplatePicker] = useState<{
    items: { name: string; path: string }[]
    startup: boolean
  } | null>(null)
  async function pickTemplate(path: string): Promise<void> {
    setTemplatePicker(null)
    const res = await window.giftcut.loadTemplate(path)
    if (!res?.ok || !res.data) {
      showToast('テンプレートを開けませんでした:\n' + (res?.error ?? ''), 'error')
      return
    }
    applyProjectTemplate(res.data)
  }

  // プロジェクトデータを適用（ファイルを開く / 自動保存の復元で共通）
  /* eslint-disable @typescript-eslint/no-explicit-any */
  async function applyProjectData(
    data: any,
    videoExists: boolean,
    srcPath: string | null
  ): Promise<void> {
    stopPlayback()
    const d = data as any
    // id はファイルの値を信用せず振り直す（NaN/重複による採番汚染を防ぐ）
    const loadedCues: Cue[] = Array.isArray(d.cues)
      ? d.cues.map((c: any, i: number) => ({
          id: i + 1,
          start: Number(c.start) || 0,
          end: Number(c.end) || 0,
          text: String(c.text ?? ''),
          style: { ...defaultTelopStyle(), ...(c.style ?? {}) },
          // 部分装飾（保存はcues丸ごとだが読込側で落ちていた＝保存→開くとリッチテキスト消失バグの修正）
          runs:
            Array.isArray(c.runs) && c.runs.length
              ? c.runs
                  .filter(
                    (r: any) =>
                      typeof r?.start === 'number' && typeof r?.end === 'number' && r.end > r.start
                  )
                  .map((r: any) => ({ ...r }))
              : undefined,
          scale: typeof c.scale === 'number' && c.scale > 0 ? c.scale : undefined, // テロップ拡縮も同様に復元
          label: typeof c.label === 'string' ? c.label : DEFAULT_LABEL,
          iconImage: typeof c.iconImage === 'string' ? c.iconImage : undefined,
          personIcon: c.personIcon === false ? false : undefined,
          pos:
            c.pos && typeof c.pos.x === 'number' && typeof c.pos.y === 'number'
              ? { x: c.pos.x, y: c.pos.y }
              : { x: 0.5, y: 0.85 },
          // V1以外の映像トラックIDはそのまま維持（V4等へ退避したテロップが戻らなくなるのを防ぐ）
          track:
            typeof c.track === 'string' && /^V\d+$/.test(c.track) && c.track !== 'V1'
              ? c.track
              : undefined
        }))
      : []
    const loadedSegs: VSeg[] = Array.isArray(d.segments)
      ? d.segments.map((s: any, i: number) => ({
          id: i + 1,
          srcId: typeof s.srcId === 'number' ? s.srcId : undefined,
          srcStart: Number(s.srcStart) || 0,
          srcEnd: Number(s.srcEnd) || 0,
          muted: s.muted === true ? true : undefined,
          videoBlank: s.videoBlank === true ? true : undefined,
          // atempo は 0.5〜100 しか受け付けないので、読み込み時にその範囲へクランプ
          speed:
            typeof s.speed === 'number' && s.speed > 0 ? clamp(s.speed, 0.5, 8) : undefined,
          transIn: loadSegTrans(s.transIn),
          transOut: loadSegTrans(s.transOut),
          xfade: loadSegTrans(s.xfade),
          adjust:
            s.adjust &&
            typeof s.adjust.b === 'number' &&
            typeof s.adjust.c === 'number' &&
            typeof s.adjust.s === 'number' &&
            !isNeutralAdjust(s.adjust)
              ? { b: s.adjust.b, c: s.adjust.c, s: s.adjust.s }
              : undefined,
          rotate: typeof s.rotate === 'number' && s.rotate ? (((s.rotate % 360) + 360) % 360) || undefined : undefined,
          flipH: s.flipH === true ? true : undefined,
          flipV: s.flipV === true ? true : undefined,
          vol: typeof s.vol === 'number' && s.vol >= 0 && s.vol !== 1 ? s.vol : undefined,
          afadeIn: typeof s.afadeIn === 'number' && s.afadeIn > 0 ? s.afadeIn : undefined,
          afadeOut: typeof s.afadeOut === 'number' && s.afadeOut > 0 ? s.afadeOut : undefined,
          zoom:
            s.zoom &&
            typeof s.zoom.scale === 'number' &&
            typeof s.zoom.x === 'number' &&
            typeof s.zoom.y === 'number' &&
            !isNeutralZoom(s.zoom)
              ? { scale: s.zoom.scale, x: s.zoom.x, y: s.zoom.y }
              : undefined,
          crop:
            s.crop &&
            typeof s.crop.l === 'number' &&
            typeof s.crop.t === 'number' &&
            typeof s.crop.r === 'number' &&
            typeof s.crop.b === 'number' &&
            !isNeutralCrop(s.crop)
              ? { l: s.crop.l, t: s.crop.t, r: s.crop.r, b: s.crop.b }
              : undefined,
          // ラベルカラー。ここに書き忘れていたため、色を付けて保存しても
          // 開き直すと消えていた（他の種類は保存されるので余計に分かりにくい）。
          label: typeof s.label === 'string' && s.label ? s.label : undefined,
          gap: s.gap === true ? true : undefined
        }))
      : []
    /* eslint-enable @typescript-eslint/no-explicit-any */
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const loadedSe: SEClip[] = Array.isArray(d.seClips)
      ? d.seClips.map((s: any, i: number) => ({
          id: i + 1,
          path: String(s.path ?? ''),
          name: String(s.name ?? (s.path ? String(s.path).split(/[\\/]/).pop() : 'SE')),
          tStart: Number(s.tStart) || 0,
          duration: Number(s.duration) || 1,
          volume: typeof s.volume === 'number' ? s.volume : 1,
          fadeIn: typeof s.fadeIn === 'number' ? s.fadeIn : 0,
          fadeOut: typeof s.fadeOut === 'number' ? s.fadeOut : 0,
          track: typeof s.track === 'string' ? s.track : 'A2',
          srcOffset: typeof s.srcOffset === 'number' && s.srcOffset > 0 ? s.srcOffset : undefined,
          srcDur: typeof s.srcDur === 'number' && s.srcDur > 0 ? s.srcDur : undefined
        }))
      : []
    // トラック構成（追加レーン）を復元。形式が不正ならデフォルトに戻す
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const loadedTracks: Track[] = Array.isArray(d.tracks)
      ? d.tracks
          .filter(
            (t: any) =>
              t &&
              typeof t.id === 'string' &&
              /^[VA]\d+$/.test(t.id) &&
              (t.kind === 'video' || t.kind === 'audio')
          )
          .map((t: any) => ({ id: t.id, name: String(t.name ?? t.id), kind: t.kind }))
      : []
    /* eslint-enable @typescript-eslint/no-explicit-any */
    let nextTracks =
      loadedTracks.some((t) => t.id === 'V1') && loadedTracks.some((t) => t.id === 'A1')
        ? loadedTracks
        : DEFAULT_TRACKS
    // 旧プロジェクトにはBGMトラックが無いので、無ければ音声トラックの末尾に補完
    if (!nextTracks.some((t) => t.id === EXTRA_AUDIO_TRACK)) {
      const lastAudio = nextTracks.map((t) => t.kind).lastIndexOf('audio')
      const bgm: Track = { id: EXTRA_AUDIO_TRACK, name: 'A3', kind: 'audio' }
      nextTracks =
        lastAudio >= 0
          ? [...nextTracks.slice(0, lastAudio + 1), bgm, ...nextTracks.slice(lastAudio + 1)]
          : [...nextTracks, bgm]
    }
    setTracks(nextTracks)
    // トラック状態（ロック/非表示/ミュート/ソロ/音量）を復元。保存が無い/欠けている行は初期値。
    {
      const base = initTrackStates(nextTracks)
      const saved = d.trackStates
      if (saved && typeof saved === 'object') {
        for (const t of nextTracks) {
          const s = saved[t.id]
          if (!s || typeof s !== 'object') continue
          base[t.id] = {
            ...base[t.id],
            locked: s.locked === true,
            hidden: s.hidden === true,
            muted: s.muted === true,
            solo: s.solo === true,
            target: s.target === true,
            volume: typeof s.volume === 'number' ? clamp(s.volume, 0, 1) : base[t.id].volume
          }
        }
      }
      setTrackStates(base)
    }
    // メディアビン（プロジェクトに追加した素材）を復元
    if (Array.isArray(d.mediaItems)) {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const items: MediaItem[] = d.mediaItems
        .filter((m: any) => m && typeof m.path === 'string')
        .map((m: any) => ({
          id: mediaIdCounter.current++,
          path: m.path,
          name: String(m.name ?? m.path.split(/[\\/]/).pop() ?? m.path),
          kind: m.kind === 'audio' || m.kind === 'image' ? m.kind : ('video' as const),
          folder: typeof m.folder === 'string' ? m.folder : undefined
        }))
      /* eslint-enable @typescript-eslint/no-explicit-any */
      setMediaItems(items)
      items.filter((m) => m.kind === 'video').forEach((m) => genThumbFor(m.id, m.path))
    }
    setSelectedTrackId(null)
    // マーカー復元（t 昇順、idは振り直し）
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const loadedMarkers: Marker[] = Array.isArray(d.markers)
      ? d.markers
          .filter((m: any) => m && typeof m.t === 'number' && m.t >= 0)
          .map((m: any, i: number) => ({ id: i + 1, t: m.t, label: String(m.label ?? '') }))
          .sort((a: Marker, b: Marker) => a.t - b.t)
      : []
    // 画像クリップ復元
    const loadedImgs: ImgClip[] = Array.isArray(d.imgClips)
      ? d.imgClips
          .filter((c: any) => c && typeof c.path === 'string' && typeof c.tStart === 'number')
          .map((c: any, i: number) => ({
            id: i + 1,
            path: c.path,
            name: String(c.name ?? c.path.split(/[\\/]/).pop() ?? '画像'),
            tStart: Math.max(0, Number(c.tStart) || 0),
            duration: Number(c.duration) > 0 ? Number(c.duration) : 5,
            // 存在しないトラックを指したままだと、タイムラインに出ないのに
            // プレビューと書き出しには出る「見えないクリップ」になる
            track: fallbackTrack(typeof c.track === 'string' ? c.track : 'V3', 'video'),
            zoom:
              c.zoom &&
              typeof c.zoom.scale === 'number' &&
              typeof c.zoom.x === 'number' &&
              typeof c.zoom.y === 'number' &&
              !isNeutralZoom(c.zoom)
                ? { scale: c.zoom.scale, x: c.zoom.x, y: c.zoom.y }
                : undefined,
            rotate:
              typeof c.rotate === 'number' && c.rotate
                ? ((c.rotate % 360) + 360) % 360 || undefined
                : undefined,
            flipH: c.flipH === true ? true : undefined,
            flipV: c.flipV === true ? true : undefined,
            opacity:
              typeof c.opacity === 'number' && c.opacity >= 0 && c.opacity < 1
                ? c.opacity
                : undefined,
            adjust:
              c.adjust &&
              typeof c.adjust.b === 'number' &&
              typeof c.adjust.c === 'number' &&
              typeof c.adjust.s === 'number' &&
              !isNeutralAdjust(c.adjust)
                ? { b: c.adjust.b, c: c.adjust.c, s: c.adjust.s }
                : undefined,
            crop:
              c.crop &&
              typeof c.crop.l === 'number' &&
              typeof c.crop.t === 'number' &&
              typeof c.crop.r === 'number' &&
              typeof c.crop.b === 'number' &&
              !isNeutralCrop(c.crop)
                ? { l: c.crop.l, t: c.crop.t, r: c.crop.r, b: c.crop.b }
                : undefined
          }))
      : []
    // 映像レイヤークリップ復元
    const loadedVc: VClip[] = Array.isArray(d.vClips)
      ? d.vClips
          .filter(
            (c: any) =>
              c &&
              typeof c.path === 'string' &&
              typeof c.tStart === 'number' &&
              typeof c.srcEnd === 'number'
          )
          .map((c: any, i: number) => ({
            id: i + 1,
            path: c.path,
            name: String(c.name ?? c.path.split(/[\\/]/).pop() ?? '動画'),
            track: typeof c.track === 'string' ? c.track : 'V2',
            tStart: Math.max(0, Number(c.tStart) || 0),
            srcStart: Math.max(0, Number(c.srcStart) || 0),
            srcEnd: Number(c.srcEnd) || 0,
            srcDur: typeof c.srcDur === 'number' && c.srcDur > 0 ? c.srcDur : undefined,
            zoom:
              c.zoom && typeof c.zoom.scale === 'number' && !isNeutralZoom(c.zoom)
                ? { scale: c.zoom.scale, x: c.zoom.x, y: c.zoom.y }
                : undefined,
            rotate:
              typeof c.rotate === 'number' && c.rotate
                ? ((c.rotate % 360) + 360) % 360 || undefined
                : undefined,
            flipH: c.flipH === true ? true : undefined,
            flipV: c.flipV === true ? true : undefined,
            opacity:
              typeof c.opacity === 'number' && c.opacity >= 0 && c.opacity < 1
                ? c.opacity
                : undefined,
            adjust:
              c.adjust && typeof c.adjust.b === 'number' && !isNeutralAdjust(c.adjust)
                ? { b: c.adjust.b, c: c.adjust.c, s: c.adjust.s }
                : undefined,
            crop:
              c.crop && typeof c.crop.l === 'number' && !isNeutralCrop(c.crop)
                ? { l: c.crop.l, t: c.crop.t, r: c.crop.r, b: c.crop.b }
                : undefined,
            muted: c.muted === true ? true : undefined,
            vol: typeof c.vol === 'number' && c.vol !== 1 ? c.vol : undefined,
            afadeIn: typeof c.afadeIn === 'number' && c.afadeIn > 0 ? c.afadeIn : undefined,
            afadeOut: typeof c.afadeOut === 'number' && c.afadeOut > 0 ? c.afadeOut : undefined
          }))
      : []
    /* eslint-enable @typescript-eslint/no-explicit-any */
    idCounter.current = loadedCues.length + 1
    segIdCounter.current = loadedSegs.length + 1
    seIdCounter.current = loadedSe.length + 1
    markerIdCounter.current = loadedMarkers.length + 1
    imgIdCounter.current = loadedImgs.length + 1
    // 映像レイヤーが使う「対の音声トラック」と映像トラックを補完する。
    // 無いと audioTrackGain が 0 を返して無音になり、音声帯も出ないので原因が分からない。
    if (loadedVc.length) {
      setTracks((prev) => {
        let out = [...prev]
        for (const c of loadedVc) {
          const a = 'A' + (Number(c.track.slice(1)) || 0)
          if (!out.some((t) => t.id === c.track)) {
            const firstV = out.findIndex((t) => t.kind === 'video')
            out = [
              ...out.slice(0, Math.max(0, firstV)),
              { id: c.track, name: c.track, kind: 'video' as const },
              ...out.slice(Math.max(0, firstV))
            ]
          }
          if (!out.some((t) => t.id === a)) {
            const lastA = out.map((t) => t.kind).lastIndexOf('audio')
            out = [
              ...out.slice(0, lastA + 1),
              { id: a, name: a, kind: 'audio' as const },
              ...out.slice(lastA + 1)
            ]
          }
        }
        return out
      })
      setTrackStates((prev) => {
        const out = { ...prev }
        for (const c of loadedVc) {
          const a = 'A' + (Number(c.track.slice(1)) || 0)
          if (!out[c.track]) out[c.track] = newTrackState(c.track)
          if (!out[a]) out[a] = newTrackState(a)
        }
        return out
      })
    }
    vClipIdCounter.current = loadedVc.length + 1
    resetHistory({
      cues: loadedCues,
      segments: loadedSegs,
      seClips: loadedSe,
      markers: loadedMarkers,
      imgClips: loadedImgs,
      vClips: loadedVc
    })
    setCues(loadedCues)
    setSegments(loadedSegs)
    setSeClips(loadedSe)
    setMarkers(loadedMarkers)
    setImgClips(loadedImgs)
    setVClips(loadedVc)
    setSelectedVClipIds([])
    // 映像レイヤーの波形を用意し直す（波形は mediaMeta 側にあるので、これが無いと
    // 開き直した途端に音声帯が「波形解析中…」のまま止まる）
    loadedVc.forEach((c) => prepareMediaMeta(c.path, 'video'))
    setSelectedMarkerId(null)
    setSelectedSeIds([])
    setSelectedIds([])
    setEditingId(null) // 編集オーバーレイを閉じる（idを振り直すので別テロップに付き直すのを防ぐ）
    setSelectedTrackId(null)
    clearSegSel()
    if (d.ratio === '16:9' || d.ratio === '9:16' || d.ratio === '1:1') setRatio(d.ratio)
    // アイコンの配置（側・オフセット・サイズ）プロジェクト固定
    setIconSide(
      ['left', 'right', 'top', 'bottom'].includes(d.iconSide) ? d.iconSide : 'left'
    )
    if (d.iconOffset && typeof d.iconOffset.x === 'number' && typeof d.iconOffset.y === 'number')
      setIconOffset({ x: d.iconOffset.x, y: d.iconOffset.y })
    else setIconOffset({ x: 0, y: 0 })
    setIconScale(typeof d.iconScale === 'number' && d.iconScale > 0 ? d.iconScale : 1)
    setIconAuto(d.iconAuto === true)
    setIconAnchorPos(
      d.iconAnchorPos &&
        typeof d.iconAnchorPos.x === 'number' &&
        typeof d.iconAnchorPos.y === 'number'
        ? { x: d.iconAnchorPos.x, y: d.iconAnchorPos.y }
        : null
    )
    // ラベル色/レーンごとのアイコン割当（プロジェクト固定。無ければ現在の設定を維持）
    if (d.iconAssign && typeof d.iconAssign === 'object') {
      setIconAssignState(d.iconAssign)
      saveIconAssign(d.iconAssign)
    }
    if (d.laneIconAssign && typeof d.laneIconAssign === 'object') {
      setLaneIconAssign(d.laneIconAssign)
      saveLS('giftcut.laneIconAssign', d.laneIconAssign)
    }
    // 書き出し設定・音量・トランジション既定長・既定テロップスタイル
    if (d.exportOpts && typeof d.exportOpts === 'object') {
      const eo = d.exportOpts
      setExportOpts({
        resP: [2160, 1080, 720, 480].includes(eo.resP) ? eo.resP : 1080,
        // 旧形式は数値のみ。その値は尊重し、未知の値だけ 'source'（素材と同じ）に落とす
        fps: eo.fps === 'source' || [24, 30, 60].includes(eo.fps) ? eo.fps : 'source',
        quality: ['high', 'med', 'low'].includes(eo.quality) ? eo.quality : 'high'
      })
    }
    if (d.loudnormLUFS === null || typeof d.loudnormLUFS === 'number')
      setLoudnormLUFS(d.loudnormLUFS)
    if (typeof d.masterVolume === 'number') setMasterVolume(clamp(d.masterVolume, 0, 1))
    if (typeof d.transDur === 'number' && d.transDur > 0) setTransDur(d.transDur)
    if (d.newTelopStyle && typeof d.newTelopStyle === 'object') setNewTelopStyle(d.newTelopStyle)
    // 保存元のパス（自動保存からの復帰では srcPath が無いので、JSON内の projectPath を使う）
    setProjectPath(srcPath ?? (typeof d.projectPath === 'string' ? d.projectPath : null))
    // 開いた直後は「未保存の変更なし」。次のレンダー後の内容を基準にする
    window.setTimeout(() => {
      const json = projectJsonRef.current()
      savedJsonRef.current = json
      markUnsavedRef.current(json) // タイトルの「＊」もその場で消す
    }, 0)
    if (typeof d.srtPath === 'string') setSrtPath(d.srtPath)
    // 将来の新形式を旧バイナリが黙って読み書きして壊さないための検証
    if (typeof d.version === 'number' && d.version > 1)
      showToast('このプロジェクトは新しい形式です。一部の設定が読み込めない可能性があります。')
    setEditingMarkerId(null)
    setSelectedMediaId(null)
    setTime(0)
    setWaveform(null)
    setThumbnailSrc(null)
    if (typeof d.videoPath === 'string' && d.videoPath && videoExists) {
      const vp = d.videoPath
      // マルチソース: 保存された sources を復元（無ければ videoPath 単独）。idは保存値を維持（切片のsrcId整合）。
      const savedSources = Array.isArray(d.sources)
        ? d.sources.filter((s: any) => s && typeof s.path === 'string' && typeof s.id === 'number')
        : []
      const loadedSources: Source[] = (
        savedSources.length ? savedSources : [{ id: 1, path: vp, name: vp.split(/[\\/]/).pop() }]
      ).map((s: any) => ({
        id: s.id,
        path: s.path,
        name: String(s.name ?? s.path.split(/[\\/]/).pop() ?? s.path),
        origUrl: toGcUrl(s.path),
        duration: 0,
        fps: FPS,
        waveform: null
      }))
      setSources(loadedSources)
      sourceIdCounter.current = Math.max(0, ...loadedSources.map((s) => s.id)) + 1
      // 主ソース（先頭）＝プレビュー対象。既存の videoPath はこの先頭に一致させて保存している。
      const primary = loadedSources.find((s) => s.path === vp) ?? loadedSources[0]
      curSourceIdRef.current = primary.id
      setActiveSrcId(primary.id)
      videoElsRef.current.clear()
      // 読込したプロジェクトには既に切片があるので、初期切片の自動生成はしない
      initializedForPathRef.current = primary.path
      setVideoPath(primary.path)
      setVideoName(primary.name)
      setVideoSrc(primary.origUrl)
      // プレビュー用プロキシは「プレビュー解像度」の effect が sources を見て用意する
      // （キャッシュ済みなら即完了。原本指定のときは作らない）
      proxyForPathRef.current = primary.path
      setMissingMedia(null) // 正常に読み込めたので欠損情報は不要
      setFps(FPS)
      void window.giftcut.getFps(primary.path).then((r) => {
        if (proxyForPathRef.current === primary.path && r?.ok && r.fps && r.fps > 0) {
          const f = Math.round(r.fps * 1000) / 1000
          setFps(f)
          updateSource(primary.id, { fps: f })
        }
      })
      // 追加ソースは背景でプロキシ/波形/長さ/fpsを生成
      loadedSources.filter((s) => s.id !== primary.id).forEach((s) => hydrateSource(s.id, s.path))
      const [wf, th] = await Promise.all([
        window.giftcut.generateWaveform(primary.path),
        window.giftcut.generateThumbnail(primary.path)
      ])
      if (proxyForPathRef.current !== primary.path) return // 解析中に別プロジェクト/動画へ切替えた
      if (wf?.ok && wf.min && wf.max) {
        const wv = { min: wf.min, max: wf.max, dur: wf.duration ?? 0 }
        setWaveform(wv)
        updateSource(primary.id, { waveform: wv })
      }
      if (th?.ok && th.path) setThumbnailSrc(toGcUrl(th.path))
    } else {
      setVideoPath(null)
      setVideoSrc(null)
      setVideoName(null)
      setVideoDuration(0)
      setFps(FPS)
      // 見つからなかったパスは捨てずに保持する。捨てると Ctrl+S で
      // 元動画パスと追加ソース一覧が永久に失われ、素材を戻しても紐付け直せない。
      setMissingMedia({
        videoPath: typeof d.videoPath === 'string' ? d.videoPath : null,
        sources: Array.isArray(d.sources) ? d.sources : []
      })
      setSources([])
      curSourceIdRef.current = null
      // 前の動画のプロキシ生成が走っていた場合、完成後に勝手にプレビューへ入るのを防ぐ
      proxyForPathRef.current = null
      setProxyPct(null)
      // 常設していた <video> の後始末（detachされた古い要素を掴み続けないように）
      videoElsRef.current.clear()
      setActiveSrcId(null)
      videoRef.current = null
      if (typeof d.videoPath === 'string' && d.videoPath) {
        showToast(
          '動画ファイルが見つかりません:\n' + d.videoPath + '\nテロップとカット情報のみ読み込みました。'
        )
      }
    }
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */

  // ---- 自動保存 / クラッシュ復帰 ----
  const lastAutosaveRef = useRef('') // 前回自動保存した内容（変化時だけ書き込む）
  // 最後に「保存済み」となった内容。×ボタンの未保存確認はこれと現在の内容を比べる
  // （isDirty() は履歴デバウンス基準で450ms後に false へ戻るため、閉じる判定には使えない）。
  const savedJsonRef = useRef<string | null>(null)
  const [restorePrompt, setRestorePrompt] = useState<{
    data: unknown
    videoExists: boolean
    savedAt?: string
    /** 1つ前の下書き。落ちる原因になった操作ごと戻ってこないための逃げ道。 */
    prev?: { data: unknown; videoExists: boolean; savedAt?: string }
    /** 最後の自動保存が読めず、1つ前だけが残っていた場合 */
    onlyPrev?: boolean
  } | null>(null)
  // ★依存配列を空にしてタイマーを一度だけ作る（毎レンダー再生成だと再生/編集中に一度も発火しないバグ）。
  //   最新state参照は ref 経由（projectJson/hasProjectContent は毎レンダー再代入）。
  const projectJsonRef = useRef(projectJson)
  projectJsonRef.current = projectJson
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
    projectPath
  ])

  // 自動保存（クラッシュしたときの下書き）。5分ごと。
  // 中身が変わっていなければ文字列にすらしない＝待機中・再生中はゼロ。
  // 間隔を縮めたければ AUTOSAVE_MS だけ変えればよい。落ちたときに失うのは
  // 最大でこの間隔ぶん（普通に閉じた場合は下の beforeunload で取りこぼさない）。
  const autosavedRevRef = useRef(-1)
  useEffect(() => {
    const id = window.setInterval(() => {
      if (!hasContentRef.current()) return
      if (projectRevRef.current === autosavedRevRef.current) return // 何も変わっていない
      autosavedRevRef.current = projectRevRef.current
      const json = currentJsonRef.current()
      if (json === lastAutosaveRef.current) return
      lastAutosaveRef.current = json
      void window.giftcut?.autosaveProject?.(json)
    }, AUTOSAVE_MS)
    return () => window.clearInterval(id)
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
        lastAutosaveRef.current = json
        void window.giftcut?.autosaveProject?.(json) // 最後のフラッシュ
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])
  // 起動時: 自動保存があれば復元プロンプトを出す
  useEffect(() => {
    void window.giftcut?.autosaveCheck?.()?.then(async (r) => {
      if (r?.exists && r.data) {
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

  // SRT 書き出し（編集後のテロップを SRT に戻す）
  async function exportSrtFn(): Promise<void> {
    if (!cues.length) {
      showToast('テロップがありません。')
      return
    }
    const res = await window.giftcut.exportSrt(buildSrt(cues))
    if (res?.ok && res.path) showToast('SRT を書き出しました:\n' + res.path, 'success')
    else if (res?.error && res.error !== 'キャンセル') showToast('書き出し失敗: ' + res.error, 'error')
  }

  // テロップを新規追加（再生ヘッド位置に2秒）
  // 新しいテロップを置くトラックを決める。
  // 再生ヘッドの位置に既にテロップがあれば1段上へ、無ければ既定の下段(V2)へ。
  // 以前は V2 決め打ちだったため、動画の退避で「テロップを V4 へ移しました」と
  // 出した直後に T を押すと、また V2 にテロップが作られていた。
  function trackForNewTelop(t: number): string {
    // 映像レイヤーが載っているトラックは V{n}/A{n} が対で予約されているので避ける
    const reservedByVideo = new Set(vClips.map((c) => c.track))
    const cands = tracks
      .filter(
        (tr) =>
          tr.kind === 'video' &&
          tr.id !== 'V1' &&
          !trackStates[tr.id]?.locked &&
          !reservedByVideo.has(tr.id)
      )
      .sort((a, b) => trackNum(a.id) - trackNum(b.id)) // 下段から順に見る
    // これから作るテロップの尺(2秒)と重なるものがあれば「埋まっている」とみなす
    const busy = (id: string): boolean =>
      cues.some((c) => cueTrack(c) === id && c.start < t + 2 && c.end > t)
    const free = cands.find((tr) => !busy(tr.id))
    if (free) return free.id
    // 全部埋まっている＝一番上の1段上に新しいトラックを作る
    const maxNum = Math.max(
      1,
      ...tracks.filter((x) => x.kind === 'video').map((x) => trackNum(x.id))
    )
    const id = 'V' + (maxNum + 1)
    setTracks((prev) =>
      prev.some((x) => x.id === id)
        ? prev
        : insertTrackOrdered(prev, { id, name: id, kind: 'video' })
    )
    setTrackStates((prev) => (prev[id] ? prev : { ...prev, [id]: newTrackState(id) }))
    return id
  }
  function addTelop(): void {
    const t = currentTimeRef.current
    const track = trackForNewTelop(t)
    const id = idCounter.current++
    const style = structuredClone(newTelopStyle) // テンプレで選んだ既定スタイルを使う
    // アイコン軸が有効なら新規テロップも軸に整列（アイコンが飛ばないように）
    if (iconAuto && iconAnchorPos) {
      style.anchor = { h: 'l', v: 'm' }
      style.align = 'left'
      delete style.box
    }
    const cue: Cue = {
      id,
      start: t,
      end: t + 2,
      text: 'テロップ',
      style,
      label: DEFAULT_LABEL,
      pos: iconAuto && iconAnchorPos ? { ...iconAnchorPos } : { x: 0.5, y: 0.85 },
      track
    }
    setCues((prev) => [...prev, cue].sort((a, b) => a.start - b.start))
    clearAllSelections()
    setSelectedIds([id])
    // 既定の下段以外に置いたときだけ知らせる（どこに出たか分からなくなるため）
    if (track !== 'V2') showToast(track + ' にテロップを追加しました。')
  }
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
  function applyTemplate(tpl: TelopStyle): void {
    setNewTelopStyle(tpl)
    // 編集中＋文字選択ありなら、プリセットの色/フォント/サイズを「選択文字だけ」に(runs)適用
    const editing = editingId != null ? cues.find((c) => c.id === editingId) : null
    if (editing && isSelected(editing.id)) {
      const { start, end } = curSel()
      if (end > start) {
        // プリセットを選択文字だけに適用＝塗り(グラデ優先)・背景・フォント・サイズを丸ごと反映。
        const patch: Partial<TextRun> = {}
        if (tpl.fill?.gradient && tpl.fill.gradient.stops?.length >= 2) {
          patch.gradient = tpl.fill.gradient
          patch.color = undefined
        } else {
          const col = runColorFromStyle(tpl)
          if (col) patch.color = col
          patch.gradient = undefined
        }
        patch.bgColor = tpl.background?.enabled ? tpl.background.color : undefined
        // 縁・影・結合も選択文字に反映。文字サイズは現状維持（プリセットのfontSizeは持ち込まない）。
        // 縁幅・影寸法はテロップのサイズ比 k で相似スケール（プリセットごとにfontSizeが違うため）。
        const k =
          editing.style.fontSize > 0 && tpl.fontSize > 0 ? editing.style.fontSize / tpl.fontSize : 1
        const r1 = (n: number): number => Math.round(n * 10) / 10
        patch.strokes = (tpl.strokes ?? []).map((st) => ({ ...st, width: r1(st.width * k) }))
        patch.shadows = [
          ...(tpl.shadow && tpl.shadow.enabled ? [tpl.shadow] : []),
          ...(tpl.shadows || [])
        ].map((sd) => ({
          ...sd,
          distance: r1(sd.distance * k),
          blur: r1(sd.blur * k),
          ...(sd.spread != null ? { spread: r1(sd.spread * k) } : {})
        }))
        patch.join = tpl.join
        if (tpl.fontFamily) patch.fontFamily = tpl.fontFamily
        applyRunRange(editing.id, start, end, patch)
        return
      }
    }
    if (selectedIds.length) {
      // 文字未選択で全体にプリセット適用＝部分装飾(runs)を全リセットし「見た目だけ」を載せる
      // （テキスト枠＝サイズ等は現状維持: mergeTemplateKeepFrame）。
      setCues((prev) =>
        prev.map((c) =>
          isSelected(c.id)
            ? { ...c, style: mergeTemplateKeepFrame(c.style, tpl), runs: undefined }
            : c
        )
      )
      // 編集オーバーレイを閉じる（開いたままだとテロップに被さって次のダブルクリックを奪う）。
      setEditingId(null)
    }
  }
  // プリセットを「見た目だけ」適用するマージ。テキスト枠の設定（サイズ・字間・行間・揃え・
  // アンカー・箱・アニメ）は適用前の現在値を維持する（Adobe由来プリセットは1個ずつfontSizeが
  // 違うため、丸ごと適用するとテロップのサイズが毎回変わってしまう）。
  // 縁・影・背景の寸法はサイズ比 k で相似スケールし、プリセットの見た目の均整を保つ。
  function mergeTemplateKeepFrame(cur: TelopStyle, tpl: TelopStyle): TelopStyle {
    const k = cur.fontSize > 0 && tpl.fontSize > 0 ? cur.fontSize / tpl.fontSize : 1
    const r1 = (n: number): number => Math.round(n * 10) / 10
    const scSh = <T extends { distance: number; blur: number; spread?: number }>(sd: T): T => ({
      ...sd,
      distance: r1(sd.distance * k),
      blur: r1(sd.blur * k),
      ...(sd.spread != null ? { spread: r1(sd.spread * k) } : {})
    })
    return {
      ...tpl,
      fontSize: cur.fontSize,
      tracking: cur.tracking,
      leading: cur.leading,
      align: cur.align,
      anchor: cur.anchor,
      box: cur.box,
      anim: cur.anim,
      strokes: (tpl.strokes || []).map((st) => ({ ...st, width: r1(st.width * k) })),
      shadow: tpl.shadow ? scSh(tpl.shadow) : tpl.shadow,
      shadows: tpl.shadows ? tpl.shadows.map(scSh) : tpl.shadows,
      background: tpl.background
        ? {
            ...tpl.background,
            ...(tpl.background.size != null ? { size: r1(tpl.background.size * k) } : {}),
            ...(tpl.background.corner != null ? { corner: r1(tpl.background.corner * k) } : {})
          }
        : tpl.background
    }
  }
  // テンプレをテロップにドロップして適用。落とした先が選択中の一部なら選択全部に反映。
  function applyTemplateToCue(cueId: number, tpl: TelopStyle): void {
    setNewTelopStyle(tpl)
    const targets = selectedIds.includes(cueId) && selectedIds.length ? selectedIds : [cueId]
    setCues((prev) =>
      prev.map((c) =>
        targets.includes(c.id)
          ? { ...c, style: mergeTemplateKeepFrame(c.style, tpl), runs: undefined }
          : c
      )
    )
    setEditingId(null)
  }

  // ================= 編集操作 =================
  function updateSelectedText(text: string): void {
    if (primaryId == null) return
    setCues((prev) =>
      prev.map((c) => (c.id === primaryId ? { ...c, text, runs: adjustRuns(c.runs, c.text, text) } : c))
    )
  }
  // 部分装飾: 文字index gi を含む run（後勝ち）
  function runAtIndex(runs: TextRun[] | undefined, gi: number): TextRun | null {
    let hit: TextRun | null = null
    if (runs) for (const r of runs) if (gi >= r.start && gi < r.end) hit = r
    return hit
  }
  // run上書きを style にマージ＝「その選択文字の実効スタイル」。パネル表示＆変更検出の基準に使う。
  function styleWithRun(base: TelopStyle, r: TextRun | null): TelopStyle {
    if (!r) return base
    const st: TelopStyle = { ...base, fill: { ...base.fill } }
    if (r.gradient) st.fill.gradient = r.gradient
    else if (r.color) {
      st.fill.color = r.color
      st.fill.gradient = undefined
    }
    if (r.fontFamily) st.fontFamily = r.fontFamily
    if (r.sizeScale && r.sizeScale !== 1) st.fontSize = Math.round(base.fontSize * r.sizeScale)
    if (r.strokes) st.strokes = r.strokes
    if (r.shadows) {
      st.shadow = r.shadows[0]
        ? { ...r.shadows[0], enabled: true }
        : { ...base.shadow, enabled: false }
      st.shadows = r.shadows.slice(1)
    }
    if (r.join) st.join = r.join
    if (r.bgColor) st.background = { ...base.background, enabled: true, color: r.bgColor }
    return st
  }
  // 現在の選択文字に対応する実効スタイル（編集中＋選択ありのみ。それ以外はテロップ全体）。
  // 選択はライブ(textarea)優先→なければ editorSel。curSel と同じ基準で routing と表示を一致させる。
  function panelStyleFor(cue: Cue | null | undefined): TelopStyle {
    if (!cue) return newTelopStyle
    if (editingId === cue.id) {
      const ta = editorTextRef.current
      const sel =
        ta && ta.selectionEnd > ta.selectionStart
          ? { start: ta.selectionStart, end: ta.selectionEnd }
          : editorSel
      if (sel.end > sel.start) return styleWithRun(cue.style, runAtIndex(cue.runs, sel.start))
    }
    return cue.style
  }
  function updateSelectedStyle(style: TelopStyle): void {
    if (!selectedIds.length) return
    // 編集中＋エディタで文字選択がある時は、塗り(単色/グラデ)・背景・縁・影・結合・フォント・サイズの
    // 変更を「選択文字だけ」に(runs)適用。位置揃え等の構造系は従来どおり全体に適用。
    // 全体の影リスト（primary + shadows[]）を1配列に。
    const shListOf = (st: TelopStyle): TextRun['shadows'] => [
      ...(st.shadow && st.shadow.enabled ? [st.shadow] : []),
      ...(st.shadows || [])
    ]
    const editing = editingId != null ? cues.find((c) => c.id === editingId) : null
    if (editing && isSelected(editing.id)) {
      const { start, end } = curSel()
      if (end > start) {
        // 比較基準＝「選択文字の実効スタイル」（全体ではなく選択の現在値から差分を取る）。
        // パネルは1操作で複数プロパティを同時変更する（例: サイズ変更→縁/影も相似スケール）ため、
        // 「最初の差分1つ」ではなく“変わった全項目”を1パッチにまとめて run に適用する。
        const cur = styleWithRun(editing.style, runAtIndex(editing.runs, start))
        const patch: Partial<TextRun> = {}
        let changed = false
        // 塗り（グラデ優先。単色↔グラデは相互にクリア）
        if (JSON.stringify(style.fill?.gradient) !== JSON.stringify(cur.fill?.gradient)) {
          patch.gradient = style.fill?.gradient
          patch.color = undefined
          changed = true
        } else if (style.fill?.color && style.fill.color !== cur.fill?.color) {
          patch.color = style.fill.color
          patch.gradient = undefined
          changed = true
        }
        // 背景ハイライト
        const curBg = cur.background?.enabled ? cur.background.color : undefined
        const nextBg = style.background?.enabled ? style.background.color : undefined
        if (curBg !== nextBg) {
          patch.bgColor = nextBg
          changed = true
        }
        // 縁（選択文字だけ置換）
        if (JSON.stringify(style.strokes) !== JSON.stringify(cur.strokes)) {
          patch.strokes = style.strokes
          changed = true
        }
        // 影（primary+配列を1リストに）
        if (JSON.stringify(shListOf(style)) !== JSON.stringify(shListOf(cur))) {
          patch.shadows = shListOf(style)
          changed = true
        }
        // 角の結合
        if ((style.join ?? 'miter') !== (cur.join ?? 'miter')) {
          patch.join = style.join
          changed = true
        }
        if (style.fontFamily && style.fontFamily !== cur.fontFamily) {
          patch.fontFamily = style.fontFamily
          changed = true
        }
        // サイズ倍率は base(テロップ全体) 基準で算出（cur は既に倍率適用済みのため分母に使わない）
        if (style.fontSize && editing.style.fontSize && style.fontSize !== cur.fontSize) {
          patch.sizeScale = style.fontSize / editing.style.fontSize
          changed = true
        }
        if (changed) {
          applyRunRange(editing.id, start, end, patch)
          return
        }
        // フォールスルー（構造系: 行間/字間/揃え/太字/背景サイズ等の変更）。
        // パネルの style は「選択文字の実効値」ベースなので、そのまま全体に書くと選択文字の
        // 塗り/縁/影/フォント/サイズがテロップ全体に化ける。→ run管理プロパティは各テロップ自身の値へ戻す。
        setCues((prev) =>
          prev.map((c) =>
            isSelected(c.id)
              ? {
                  ...c,
                  style: {
                    ...style,
                    fontSize: c.style.fontSize,
                    fontFamily: c.style.fontFamily,
                    join: c.style.join,
                    strokes: c.style.strokes,
                    shadow: c.style.shadow,
                    shadows: c.style.shadows,
                    fill: {
                      ...style.fill,
                      color: c.style.fill.color,
                      gradient: c.style.fill.gradient,
                      gradStash: c.style.fill.gradStash
                    },
                    background: {
                      ...style.background,
                      enabled: c.style.background.enabled,
                      color: c.style.background.color
                    }
                  }
                }
              : c
          )
        )
        return
      }
    }
    setCues((prev) => prev.map((c) => (isSelected(c.id) ? { ...c, style } : c)))
  }
  function updateCueText(id: number, text: string): void {
    setCues((prev) =>
      prev.map((c) => (c.id === id ? { ...c, text, runs: adjustRuns(c.runs, c.text, text) } : c))
    )
  }
  // ---- 部分装飾（runs）: 編集エディタの選択範囲にスタイルを適用 ----
  // 適用時に textarea の live 選択を直接読む（状態のタイミング問題を回避）。
  const editorTextRef = useRef<HTMLTextAreaElement | null>(null)
  const [editorSel, setEditorSel] = useState<{ start: number; end: number }>({ start: 0, end: 0 })
  // 編集対象が変わったら選択記録をリセット（前のテロップの選択範囲が残り、
  // 別テロップで文字未選択のままパネルを触った時に誤って部分適用されるのを防ぐ）
  useEffect(() => {
    setEditorSel({ start: 0, end: 0 })
  }, [editingId])
  // 現在の選択。textareaのlive選択が有効(非collapse)ならそれ、畳まれていたら直近記録(editorSel)へ。
  // 左パネルのFillPicker等をクリックしてtextareaがblur/collapseしても選択文字を失わないため。
  const curSel = (): { start: number; end: number } => {
    const ta = editorTextRef.current
    if (ta && ta.selectionEnd > ta.selectionStart) return { start: ta.selectionStart, end: ta.selectionEnd }
    return editorSel
  }
  // run r から [s,e) を取り除く（分割）。重なりなしはそのまま。
  const splitRunRemoving = (r: TextRun, s: number, e: number): TextRun[] => {
    if (r.end <= s || r.start >= e) return [r]
    const out: TextRun[] = []
    if (r.start < s) out.push({ ...r, end: s })
    if (r.end > e) out.push({ ...r, start: e })
    return out
  }
  // テキスト編集(old→new)に合わせて runs の文字index をシフト/クランプ。
  // 共通prefix/suffixから編集区間 [editStart,editEnd) と長さ変化 delta を求め、各runの端を移動。
  function adjustRuns(runs: TextRun[] | undefined, oldText: string, newText: string): TextRun[] | undefined {
    if (!runs || !runs.length || oldText === newText) return runs
    const minLen = Math.min(oldText.length, newText.length)
    let p = 0
    while (p < minLen && oldText[p] === newText[p]) p++
    let s = 0
    while (s < minLen - p && oldText[oldText.length - 1 - s] === newText[newText.length - 1 - s]) s++
    const editStart = p
    const editEnd = oldText.length - s
    const delta = newText.length - oldText.length
    const adj = (idx: number): number =>
      idx <= editStart ? idx : idx >= editEnd ? idx + delta : editStart
    const out: TextRun[] = []
    for (const r of runs) {
      const ns = adj(r.start)
      const ne = adj(r.end)
      if (ne > ns) out.push({ ...r, start: ns, end: ne })
    }
    return out.length ? out : undefined
  }
  // 文字範囲 [start,end) に部分装飾 patch を「マージ」適用。
  // 文字ごとの実効スタイルへ平坦化→範囲にpatchを重ね→連続同一を1runに再結合。
  // これで色→グラデ→背景…と別プロパティを重ねても前の装飾が消えない（patchのundefined値はその項目をクリア）。
  function applyRunRange(cueId: number, start: number, end: number, patch: Partial<TextRun>): void {
    if (end <= start) return
    setCues((prev) =>
      prev.map((c) => {
        if (c.id !== cueId) return c
        const n = c.text.length
        const s = Math.max(0, start)
        const e = Math.min(n, end)
        if (e <= s) return c
        // 各文字の実効スタイル（後勝ち＝runAt相当）
        const styleAt: (Partial<TextRun> | null)[] = new Array(n).fill(null)
        for (const r of c.runs ?? []) {
          const { start: _rs, end: _re, ...rest } = r
          void _rs
          void _re
          for (let i = Math.max(0, r.start); i < Math.min(n, r.end); i++)
            styleAt[i] = { ...(styleAt[i] || {}), ...rest }
        }
        for (let i = s; i < e; i++) styleAt[i] = { ...(styleAt[i] || {}), ...patch }
        // 連続同一を1runに再結合（全項目nullは装飾なしとして落とす）
        const runs: TextRun[] = []
        let lastKey = ''
        for (let i = 0; i < n; i++) {
          const st = styleAt[i]
          const active = st && Object.values(st).some((v) => v != null)
          if (!active) {
            lastKey = ''
            continue
          }
          const key = JSON.stringify(st)
          if (key === lastKey) runs[runs.length - 1].end = i + 1
          else {
            runs.push({ start: i, end: i + 1, ...(st as Partial<TextRun>) })
            lastKey = key
          }
        }
        return { ...c, runs: runs.length ? runs : undefined }
      })
    )
  }
  function clearRunsInSelection(cueId: number): void {
    const { start, end } = curSel()
    if (end <= start) return
    setCues((prev) =>
      prev.map((c) => {
        if (c.id !== cueId) return c
        const runs = (c.runs ?? []).flatMap((r) => splitRunRemoving(r, start, end))
        return { ...c, runs: runs.length ? runs : undefined }
      })
    )
  }
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
    setSelectedIds([])
    setSelectedSeIds([])
    setSelectedImgIds([])
    setSelectedVClipIds([])
  }

  // ---- 基本編集操作（コピー/カット/貼付/複製/分割）----
  // コピー/カット/貼り付けはテロップ・SE/BGM・画像に対応（種別ごとにまとめて保持）。
  // 貼り付けは「元の相対位置を保ったまま再生ヘッド位置へ」（プレミア準拠）。
  function copySelected(): void {
    const cueSel = cues.filter((c) => isSelected(c.id)).map((c) => structuredClone(c))
    const seSel = seClips.filter((c) => selectedSeIds.includes(c.id)).map((c) => ({ ...c }))
    const imgSel = imgClips.filter((c) => selectedImgIds.includes(c.id)).map((c) => ({ ...c }))
    const vcSel = vClips.filter((c) => selectedVClipIds.includes(c.id)).map((c) => ({ ...c }))
    if (!cueSel.length && !seSel.length && !imgSel.length && !vcSel.length) return
    clipboardRef.current = cueSel
    clipboardSeRef.current = seSel
    clipboardImgRef.current = imgSel
    clipboardVcRef.current = vcSel
  }
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
  function pasteClipboard(): void {
    const clip = clipboardRef.current
    const clipSe = clipboardSeRef.current
    const clipImg = clipboardImgRef.current
    const clipVc = clipboardVcRef.current
    if (!clip.length && !clipSe.length && !clipImg.length && !clipVc.length) return
    if (clip.some((c) => trackStates[cueTrack(c)]?.locked)) return // 貼り付け先トラックがロック中
    // 3種まとめての相対位置を保つため、全体の最小開始時刻を基準にする
    const starts = [
      ...clip.map((c) => c.start),
      ...clipSe.map((c) => c.tStart),
      ...clipImg.map((c) => c.tStart),
      ...clipVc.map((c) => c.tStart)
    ]
    const offset = currentTimeRef.current - Math.min(...starts) // 貼り付けは再生ヘッド位置基準
    if (clip.length) {
      const pasted = clip.map((c) => ({
        ...structuredClone(c),
        id: idCounter.current++,
        start: Math.max(0, c.start + offset),
        end: Math.max(0, c.end + offset)
      }))
      setCues((prev) => [...prev, ...pasted].sort((a, b) => a.start - b.start))
      setSelectedIds(pasted.map((p) => p.id))
    }
    if (clipSe.length) {
      const pasted = clipSe
        .filter((c) => !trackStates[c.track]?.locked)
        .map((c) => ({
          ...c,
          id: seIdCounter.current++,
          tStart: Math.max(0, c.tStart + offset),
          track: fallbackTrack(c.track, 'audio')
        }))
      setSeClips((prev) => [...prev, ...pasted])
      setSelectedSeIds(pasted.map((p) => p.id))
    }
    if (clipImg.length) {
      const pasted = clipImg
        .filter((c) => !trackStates[c.track]?.locked)
        .map((c) => ({
          ...c,
          id: imgIdCounter.current++,
          tStart: Math.max(0, c.tStart + offset),
          track: fallbackTrack(c.track, 'video')
        }))
      setImgClips((prev) => [...prev, ...pasted])
      setSelectedImgIds(pasted.map((p) => p.id))
    }
    if (clipVc.length) {
      const pasted = clipVc
        .filter((c) => !trackStates[c.track]?.locked)
        .map((c) => ({
          ...c,
          id: vClipIdCounter.current++,
          tStart: Math.max(0, c.tStart + offset),
          track: fallbackTrack(c.track, 'video')
        }))
      setVClips((prev) => [...prev, ...pasted])
      setSelectedVClipIds(pasted.map((p) => p.id))
    }
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
      const nid = seIdCounter.current++
      const leftLen = t - clip.tStart
      setSeClips((prev) =>
        prev.flatMap((c) =>
          c.id === clip.id
            ? [
                { ...c, duration: leftLen, fadeOut: 0 },
                {
                  ...c,
                  id: nid,
                  tStart: t,
                  duration: c.duration - leftLen,
                  fadeIn: 0,
                  srcOffset: (c.srcOffset ?? 0) + leftLen
                }
              ]
            : [c]
        )
      )
      setSelectedSeIds([nid])
      return
    }
    // Ctrlクリックで複数選択（他のクリップと同じ操作感）
    if (e.ctrlKey || e.metaKey) {
      // clearSegSel() が同じバッチで [] を積むので、関数updaterではなく絶対値で上書きする
      setSelectedSeIds(
        selectedSeIds.includes(clip.id)
          ? selectedSeIds.filter((id) => id !== clip.id)
          : [...selectedSeIds, clip.id]
      )
      return
    }
    // 既に選択済みのクリップを掴んだら選択全体を動かす（テロップは既にこの挙動）
    const grpIds =
      selectedSeIds.includes(clip.id) && selectedSeIds.length > 1 ? selectedSeIds : [clip.id]
    const grpBase = new Map(
      seClips.filter((c) => grpIds.includes(c.id)).map((c) => [c.id, c.tStart])
    )
    setSelectedSeIds(grpIds)
    const inner = trackInnerRef.current
    const sx = e.clientX
    const s0 = clip.tStart
    const d0 = clip.duration
    const off0 = clip.srcOffset ?? 0
    let moved = false
    const onMove = (ev: PointerEvent): void => {
      if (!moved && Math.abs(ev.clientX - sx) < 3) return
      moved = true
      if (!inner) return
      const dt = (ev.clientX - sx) / zoomRef.current
      if (edge === 'r') {
        // 右端: 長さを変える（音源の残り尺を超えない）
        const ne = snapTime(s0 + d0 + dt, [], [clip.id])
        const maxLen = Math.max(0.1, (clip.srcDur ?? Infinity) - off0)
        const nd = clamp(ne - s0, 0.1, maxLen)
        setSeClips((prev) => prev.map((c) => (c.id === clip.id ? { ...c, duration: nd } : c)))
        setDragTip({ x: ev.clientX, y: ev.clientY, text: `長さ ${formatTime(nd)}` })
      } else if (edge === 'l') {
        // 左端: 開始位置と音源内オフセットを同時に動かす（終端は固定）
        const ns = clamp(snapTime(s0 + dt, [], [clip.id]), Math.max(0, s0 - off0), s0 + d0 - 0.1)
        setSeClips((prev) =>
          prev.map((c) =>
            c.id === clip.id
              ? { ...c, tStart: ns, duration: s0 + d0 - ns, srcOffset: off0 + (ns - s0) }
              : c
          )
        )
        setDragTip({ x: ev.clientX, y: ev.clientY, text: `開始 ${formatTime(ns)}` })
      } else {
        const raw = Math.max(0, s0 + dt)
        const nt = snapClipStart(raw, clip.duration, [clip.id]) // マグネット（左右端）
        // 縦方向で別の音声トラックへ移動（テロップの上下移動と同じ操作感）
        const irect = inner.getBoundingClientRect()
        const lane = laneAtY(ev.clientY - irect.top)
        // 移動先がロック中なら受け付けない
        const laneOk =
          lane &&
          lane !== 'A1' &&
          tracks.some((t) => t.id === lane && t.kind === 'audio') &&
          !trackStates[lane]?.locked
        const shift = nt - s0
        setSeClips((prev) =>
          prev.map((c) => {
            if (!grpIds.includes(c.id)) return c
            const base = grpBase.get(c.id) ?? c.tStart
            return {
              ...c,
              tStart: Math.max(0, base + shift),
              // トラック移動は掴んだ1つだけ（全部同じ行へ寄せると重なって壊れる）
              track: laneOk && c.id === clip.id ? lane : c.track
            }
          })
        )
      }
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      setSnapLineX(null)
      setDragTip(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }
  function deleteSelectedSE(): void {
    if (!selectedSeIds.length) return
    // ロック中トラックのクリップは残す
    setSeClips((prev) =>
      prev.filter((c) => !selectedSeIds.includes(c.id) || trackStates[c.track]?.locked)
    )
    setSelectedSeIds([])
  }

  // 動画/音声の切片クリック（選択 / レザー分割 / ドラッグで並べ替え）
  // track: 'video'(V1) か 'audio'(A1)。選択は独立、カットは共有
  function onSegPointerDown(L: SegLayout, e: React.PointerEvent, track: 'video' | 'audio'): void {
    if (maybeTrackSelect(e)) return
    e.stopPropagation()
    if (e.button !== 0) return
    setSelectedTrackId(null)
    if (tool === 'razor') {
      const inner = trackInnerRef.current
      if (!inner) return
      const t = (e.clientX - inner.getBoundingClientRect().left) / zoomRef.current
      // タイムライン秒→ソース秒は速度を掛ける（速度付きクリップで分割点がズレないように）
      razorSegment(L.seg, L.seg.srcStart + (t - L.tStart) * segSpeed(L.seg))
      return
    }
    // 掴んだ切片が既に選択に入っていたら「選択ごと動かす」。全選択して動かしたときに
    // テロップ・SE・画像・映像レイヤー・マーカーが取り残されないようにする。
    // その場合だけは他種の選択を消さない。
    const grabbedInSel =
      selectedVideoIds.includes(L.seg.id) || selectedAudioIds.includes(L.seg.id)
    // 一緒に動かす他の切片（複数選択して掴んだとき）。掴んだ本人は含めない。
    const segGroupIds = grabbedInSel
      ? [...new Set([...selectedVideoIds, ...selectedAudioIds])].filter((id) => id !== L.seg.id)
      : []
    const groupBase = grabbedInSel
      ? {
          cues: cues.filter((c) => selectedIds.includes(c.id)).map((c) => ({ id: c.id, t: c.start })),
          se: seClips.filter((c) => selectedSeIds.includes(c.id)).map((c) => ({ id: c.id, t: c.tStart })),
          img: imgClips.filter((c) => selectedImgIds.includes(c.id)).map((c) => ({ id: c.id, t: c.tStart })),
          vc: vClips.filter((c) => selectedVClipIds.includes(c.id)).map((c) => ({ id: c.id, t: c.tStart })),
          mk: markers.filter((m) => m.id === selectedMarkerId).map((m) => ({ id: m.id, t: m.t }))
        }
      : null
    const hasGroup =
      !!groupBase &&
      groupBase.cues.length +
        groupBase.se.length +
        groupBase.img.length +
        groupBase.vc.length +
        groupBase.mk.length >
        0
    // 他種の選択を全部解除してから自分を選ぶ（巻き添え削除と、Delete が
    // マーカー削除へ横取りされるのを防ぐ）。個別に列挙すると必ず取りこぼす。
    if (!hasGroup) clearAllSelections()
    // クリックは独立: 動画クリックは動画のみ、音声クリックは音声のみ選択（他方は解除）
    const setThis = track === 'video' ? setSelectedVideoIds : setSelectedAudioIds
    const clearOther = track === 'video' ? setSelectedAudioIds : setSelectedVideoIds
    const selThis = track === 'video' ? selectedVideoIds : selectedAudioIds
    if (!hasGroup) clearOther([])
    // ブラウザ標準の画像/テキストドラッグ（半透明の影＋🚫カーソル）が同時に始まるのを止める
    e.preventDefault()
    const ctrlDown = e.ctrlKey || e.metaKey
    if (!ctrlDown && !hasGroup) setThis([L.seg.id])
    // ドラッグ＝時間方向に移動（プレミア準拠）。修飾キーで動作が変わる:
    //   そのまま = 上書き移動 / Alt = 複製 / Ctrl = 割り込み（後続が後ろへずれる）
    //
    // 以前はここが「配列の並べ替え」で、少し掴んだだけで切片の順序が入れ替わり
    // 再生時に巨大シークを起こしていたため丸ごと無効化されていた。無効のままだと
    // 置いたクリップを一切動かせないので、時間方向の移動として作り直してある
    // （並びは時間順のまま保たれるので、あの事故は起きない）。
    //
    // Ctrl はクリックだけなら従来どおり複数選択のトグル。動かしたときだけ割り込みに
    // なるので、押した瞬間には選択を変えず pointerup まで判定を遅らせている。
    if (mainLocked()) return
    // 空きは「選ぶ／消す」だけ。穴そのものを動かしても意味がないうえ、
    // 動かせると空きが増殖して収拾がつかなくなる。
    if (L.seg.gap) return
    const sx = e.clientX
    const t0 = L.tStart
    const len = L.tEnd - L.tStart
    const src = srcOfSeg(L.seg)
    let moved = false
    const modeOf = (ev: { altKey: boolean; ctrlKey: boolean; metaKey: boolean }): SegDropMode =>
      ev.altKey ? 'copy' : ev.ctrlKey || ev.metaKey ? 'insert' : 'move'
    const applyMove = (ev: PointerEvent): void => {
      // 数px の震えで動かさない（クリック＝選択のままにする）
      if (!moved && Math.abs(ev.clientX - sx) < 4) return
      if (!moved) {
        moved = true
        stopPlayback()
        // Ctrl で掴んでいた場合もここで単独選択に切り替える（選択ごと動かす時は保つ）
        if (!hasGroup) setThis([L.seg.id])
      }
      const nt = snapClipStart(Math.max(0, t0 + (ev.clientX - sx) / zoomRef.current), len)
      const mode = modeOf(ev)
      // 選択ごと動かす: 同じ量だけテロップ/SE/画像/映像レイヤー/マーカーもずらす。
      //
      // 複製(Alt)と割り込み(Ctrl)は「掴んだ1本を差し込む」操作なので、他の選択は
      // 動かさない。ドラッグ中にキーを押し替えたときに置いてきぼりにならないよう、
      // ずらさない場合も「元の位置」を書き戻す（0 でシフトし直す）。
      if (groupBase && hasGroup) {
        const shift = mode === 'move' ? nt - t0 : 0
        const at = (base: { id: number; t: number }[], id: number): number | undefined =>
          base.find((b) => b.id === id)?.t
        if (groupBase.cues.length)
          setCues((prev) =>
            prev.map((c) => {
              const b = at(groupBase.cues, c.id)
              return b === undefined
                ? c
                : { ...c, start: Math.max(0, b + shift), end: Math.max(0, b + shift) + (c.end - c.start) }
            })
          )
        if (groupBase.se.length)
          setSeClips((prev) =>
            prev.map((c) => {
              const b = at(groupBase.se, c.id)
              return b === undefined ? c : { ...c, tStart: Math.max(0, b + shift) }
            })
          )
        if (groupBase.img.length)
          setImgClips((prev) =>
            prev.map((c) => {
              const b = at(groupBase.img, c.id)
              return b === undefined ? c : { ...c, tStart: Math.max(0, b + shift) }
            })
          )
        if (groupBase.vc.length)
          setVClips((prev) =>
            prev.map((c) => {
              const b = at(groupBase.vc, c.id)
              return b === undefined ? c : { ...c, tStart: Math.max(0, b + shift) }
            })
          )
        if (groupBase.mk.length)
          setMarkers((prev) =>
            prev.map((m) => {
              const b = at(groupBase.mk, m.id)
              return b === undefined ? m : { ...m, t: Math.max(0, b + shift) }
            })
          )
      }
      segMoveToRef.current = nt
      segDropModeRef.current = mode
      setVideoGhost({
        t: nt,
        name: src?.name ?? videoName ?? '',
        dur: len,
        insert: mode === 'insert',
        path: src?.path ?? videoPath ?? '',
        track: 'V1',
        moving: true,
        mode
      })
      setDragTip({
        x: ev.clientX,
        y: ev.clientY,
        text:
          (mode === 'copy' ? '複製 ' : mode === 'insert' ? '割り込み ' : '') + formatTime(nt)
      })
      // このまま離すと丸ごと消えるクリップに印を付ける（割り込みは押し出すので対象外）
      setOverwriteIds(
        mode === 'insert'
          ? []
          : layoutSegs(segsRef.current)
              .filter(
                (o) =>
                  o.seg.id !== L.seg.id &&
                  !o.seg.gap &&
                  o.tStart >= nt - 1e-6 &&
                  o.tEnd <= nt + len + 1e-6
              )
              .map((o) => o.seg.id)
      )
    }
    // マウスの動きは1フレームに1回へまとめる（クリップが多いほど効く）
    const mover = rafThrottle<PointerEvent>(applyMove)
    const onMove = (ev: PointerEvent): void => mover.run(ev)
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      mover.flush() // 最後の位置を取りこぼさない
      mover.cancel()
      const nt = segMoveToRef.current
      const mode = segDropModeRef.current
      segMoveToRef.current = null
      segDropModeRef.current = 'move'
      setVideoGhost(null)
      setDragTip(null)
      setSnapLineX(null)
      setOverwriteIds([])
      if (moved && nt !== null) moveSegmentTo(L.seg.id, nt, mode, segGroupIds)
      // 動かさずに離した＝ただのクリック。Ctrl のときだけ複数選択のトグルにする
      else if (!moved && ctrlDown)
        setThis(
          selThis.includes(L.seg.id)
            ? selThis.filter((id) => id !== L.seg.id)
            : [...selThis, L.seg.id]
        )
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }
  // 切片の端をドラッグしてソース範囲をトリム（左端=イン点、右端=アウト点。縮めた分は復元も可能）
  function onSegTrimStart(L: SegLayout, edge: 'l' | 'r', e: React.PointerEvent): void {
    e.stopPropagation()
    e.preventDefault()
    if (e.button !== 0) return
    if (mainLocked()) return
    stopPlayback()
    const sx = e.clientX
    const s0 = L.seg.srcStart
    const e0 = L.seg.srcEnd
    const baseSegs = segsRef.current // 変化なしで離した場合に参照を戻す（空振りundo防止）
    // トリム上限は「この切片の元動画」の実尺（マルチソースでプレビュー中ソースの尺を誤用しない）
    const ownDur = srcOfSeg(L.seg)?.duration ?? 0
    const srcMax = ownDur > 0 ? ownDur : videoDurationRef.current > 0 ? videoDurationRef.current : e0
    const sp = segSpeed(L.seg) // 速度クリップ: 画面上の移動量(タイムライン秒)→ソース秒 に変換
    const oldTEnd = L.tEnd // トリム前のこのクリップの終端（後続シフトの境界）
    const applyTrim = (ev: PointerEvent): void => {
      // マグネット: 画面上の位置で吸着させてから、ソース秒の移動量に変換する
      // （他のクリップと同じ操作感にする。従来はここだけ吸着しなかった）
      const rawT = edge === 'l' ? L.tStart + (ev.clientX - sx) / zoomRef.current : oldTEnd + (ev.clientX - sx) / zoomRef.current
      const snapped = snapTime(rawT)
      const dt = (snapped - (edge === 'l' ? L.tStart : oldTEnd)) * sp
      if (edge === 'l') {
        const ns = clamp(s0 + dt, 0, e0 - 0.05)
        setDragTip({
          x: ev.clientX,
          y: ev.clientY,
          text: `イン ${formatTime(ns)} | 長さ ${formatTime(e0 - ns)}`
        })
        setSegments((prev) => prev.map((s) => (s.id === L.seg.id ? { ...s, srcStart: ns } : s)))
      } else {
        const ne = clamp(e0 + dt, s0 + 0.05, srcMax)
        setDragTip({
          x: ev.clientX,
          y: ev.clientY,
          text: `アウト ${formatTime(ne)} | 長さ ${formatTime(ne - s0)}`
        })
        setSegments((prev) => prev.map((s) => (s.id === L.seg.id ? { ...s, srcEnd: ne } : s)))
      }
    }
    // 端をつまむ操作はクリップ一覧そのものを書き換えるので、まとめる効果が大きい
    const trimmer = rafThrottle<PointerEvent>(applyTrim)
    const onMove = (ev: PointerEvent): void => trimmer.run(ev)
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      trimmer.flush() // 最後の位置を取りこぼさない
      trimmer.cancel()
      setDragTip(null)
      setSnapLineX(null)
      // 値が結局変わっていなければ参照を base に戻して履歴の空振りを防ぐ
      const cur = segsRef.current.find((s) => s.id === L.seg.id)
      if (cur && Math.abs(cur.srcStart - s0) < 1e-6 && Math.abs(cur.srcEnd - e0) < 1e-6) {
        setSegments(baseSegs)
        return
      }
      // クリップ長が変わった＝後続が詰まる/伸びるので、テロップ/SE/画像/マーカーも同量シフト
      if (cur) {
        const oldLen = (e0 - s0) / sp
        const newLen = (cur.srcEnd - cur.srcStart) / segSpeed(cur)
        shiftAfter(oldTEnd, newLen - oldLen)
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  // 選択中の切片を削除＝リップル（動画・音声どちらの選択でも切片ごと除去、後続が詰まる）
  // 動画切片のリップル削除。切片を除去し、その timeline 区間より後ろのテロップ/SEを同量だけ左へ
  // シフト＝映像と同期を保つ（切片削除だけだとテロップがズレる不具合の対策）。
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
    setCues((prev) =>
      prev
        .map((c) => ({ ...c, start: clampT(c.start), end: clampT(c.end) }))
        .filter((c) => c.end - c.start > 0.05)
    )
    setSeClips((prev) => prev.map((x) => ({ ...x, tStart: clampT(x.tStart) })))
    // マーカーと画像も同量シフト（映像との同期を保つ）。除去区間内のものは区間頭へ寄せる。
    setMarkers((prev) => prev.map((m) => ({ ...m, t: clampT(m.t) })))
    setVClips((prev) => prev.map((c) => ({ ...c, tStart: clampT(c.tStart) })))
    setImgClips((prev) => prev.map((c) => ({ ...c, tStart: clampT(c.tStart) })))
    clearSegSel()
  }
  // 選択中の音声切片のミュートをトグル（動画は残す。音声を独立して消せる）
  function toggleMuteSelectedSegments(): void {
    if (!selectedAudioIds.length || trackStates['A1']?.locked) return
    const allMuted = segments.filter((s) => isAudioSel(s.id)).every((s) => s.muted)
    setSegments((prev) => prev.map((s) => (isAudioSel(s.id) ? { ...s, muted: !allMuted } : s)))
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
  function shiftAfter(boundaryT: number, delta: number): void {
    if (Math.abs(delta) < 1e-4) return
    const eps = 1e-6
    setCues((prev) =>
      prev.map((c) =>
        c.start >= boundaryT - eps ? { ...c, start: c.start + delta, end: c.end + delta } : c
      )
    )
    setSeClips((prev) =>
      prev.map((c) =>
        c.tStart >= boundaryT - eps ? { ...c, tStart: Math.max(0, c.tStart + delta) } : c
      )
    )
    setImgClips((prev) =>
      prev.map((c) =>
        c.tStart >= boundaryT - eps ? { ...c, tStart: Math.max(0, c.tStart + delta) } : c
      )
    )
    setMarkers((prev) =>
      prev.map((m) => (m.t >= boundaryT - eps ? { ...m, t: Math.max(0, m.t + delta) } : m))
    )
    setVClips((prev) =>
      prev.map((c) =>
        c.tStart >= boundaryT - eps ? { ...c, tStart: Math.max(0, c.tStart + delta) } : c
      )
    )
  }
  // 選択中の動画切片を複製（直後にコピーを挿入。タイムラインは伸びる）
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
  // 選択中の動画切片の色調整を更新（patch=部分更新 / null=リセット）
  function setSelectedAdjust(patch: Partial<{ b: number; c: number; s: number }> | null): void {
    if (!selectedVideoIds.length) return
    // 回転/反転/速度/映像なし化は V1 のロックを見ているので揃える
    if (mainLocked()) return
    setSegments((prev) =>
      prev.map((s) => {
        if (!isVideoSel(s.id)) return s
        if (patch === null) return { ...s, adjust: undefined }
        const next = { ...(s.adjust ?? DEFAULT_ADJUST), ...patch }
        return { ...s, adjust: isNeutralAdjust(next) ? undefined : next }
      })
    )
  }
  // 選択中の動画切片を 90°回転（時計回りに加算・スナップ）。
  function rotateSelectedSeg(): void {
    if (!selectedVideoIds.length || trackStates['V1']?.locked) return
    setSegments((prev) =>
      prev.map((s) => {
        if (!isVideoSel(s.id)) return s
        const next = (Math.round((s.rotate ?? 0) / 90) * 90 + 90) % 360
        return { ...s, rotate: next === 0 ? undefined : next }
      })
    )
  }
  // 指定 seg の回転角を直接設定（自由回転ハンドル用）。deg は 0..360 に正規化。
  function setSegRotate(segId: number, deg: number): void {
    const d = ((Math.round(deg) % 360) + 360) % 360
    setSegments((prev) =>
      prev.map((s) => (s.id === segId ? { ...s, rotate: d === 0 ? undefined : d } : s))
    )
  }
  // 選択中の音声切片（A1）の音量/フェードを更新。
  function setSelectedAudio(patch: Partial<{ vol: number; afadeIn: number; afadeOut: number }>): void {
    if (!selectedAudioIds.length || trackStates['A1']?.locked) return
    setSegments((prev) =>
      prev.map((s) => {
        if (!isAudioSel(s.id)) return s
        const next = { ...s, ...patch }
        // 既定値なら未指定に戻す（保存を軽く）
        if (next.vol === 1) next.vol = undefined
        if (next.afadeIn === 0) next.afadeIn = undefined
        if (next.afadeOut === 0) next.afadeOut = undefined
        return next
      })
    )
  }
  // 選択中の動画切片の反転をトグル（左右 or 上下）。
  function flipSelectedSeg(dir: 'h' | 'v'): void {
    if (!selectedVideoIds.length || trackStates['V1']?.locked) return
    const key = dir === 'h' ? 'flipH' : 'flipV'
    setSegments((prev) =>
      prev.map((s) => (isVideoSel(s.id) ? { ...s, [key]: s[key] ? undefined : true } : s))
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
  function patchCueAnim(cueId: number, patch: Partial<TelopAnim>): void {
    setCues((prev) =>
      prev.map((c) => {
        if (c.id !== cueId) return c
        const cur = c.style.anim ?? defaultAnim()
        const next = { ...cur, ...patch }
        return { ...c, style: { ...c.style, anim: hasAnim(next) ? next : undefined } }
      })
    )
  }
  // 頭/尻にモーションを付与（長さは既存 or 既定0.3s）。
  function applyTelopAnimSide(cueId: number, kind: 'in' | 'out', type: AnimIn): void {
    const cur = cues.find((c) => c.id === cueId)?.style.anim ?? defaultAnim()
    if (kind === 'in') patchCueAnim(cueId, { in: type, inDur: cur.inDur > 0 ? cur.inDur : 0.3 })
    else patchCueAnim(cueId, { out: type, outDur: cur.outDur > 0 ? cur.outDur : 0.3 })
  }
  // 同じテロップトラック上で、指定テロップの直後に来る次のテロップ（間トランジション用）。
  function nextCueAfter(cue: Cue): Cue | null {
    const following = cues.filter(
      (c) => c.id !== cue.id && cueTrack(c) === cueTrack(cue) && c.start >= cue.end - 0.001
    )
    if (!following.length) return null
    return following.reduce((a, b) => (b.start < a.start ? b : a))
  }
  // テロップアニメD&D: テロップクリップ上のローカルXで 前半=in / 後半=out を判別。
  function resolveTelopTransDrop(
    cue: Cue,
    clientX: number,
    rect: DOMRect
  ): {
    kind: 'in' | 'out' | 'between'
    left: number
    width: number
    label: string
    outId?: number
    inId?: number
  } {
    // マウス位置で3分割: 前1/3=頭 / 中1/3=間(次テロップと) / 後1/3=尻。駐禁なし。
    const z = zoomRef.current
    const type = draggingTelopAnimRef.current?.type ?? 'fade'
    const len = cue.end - cue.start
    const wSec = Math.min(0.3, len)
    const w = wSec * z
    const bw = 0.3 // またぎ帯の総幅（各テロップに半分ずつ）
    const f = (clientX - rect.left) / Math.max(1, rect.width)
    if (f < 1 / 3)
      return { kind: 'in', left: cue.start * z, width: w, label: `頭 ${motionLabel(type)}` }
    if (f < 2 / 3) {
      // 間＝このテロップと次テロップの間。次が無ければ尻にフォールバック。
      const nb = nextCueAfter(cue)
      if (nb) {
        const boundary = (cue.end + nb.start) / 2
        return {
          kind: 'between',
          outId: cue.id,
          inId: nb.id,
          left: (boundary - bw / 2) * z,
          width: bw * z,
          label: `間 ${motionLabel(type)}（次のテロップと）`
        }
      }
    }
    return { kind: 'out', left: (cue.end - wSec) * z, width: w, label: `尻 ${motionLabel(type)}` }
  }
  function applyTelopTransDrop(cue: Cue, clientX: number, rect: DOMRect): void {
    if (telopLocked(cue)) return
    const drag = draggingTelopAnimRef.current
    if (!drag) return
    const r = resolveTelopTransDrop(cue, clientX, rect)
    if (r.kind === 'between' && r.outId != null && r.inId != null) {
      // 左テロップの尻＋右テロップの頭に同じモーション＝テロップ同士の間の切り替え
      applyTelopAnimSide(r.outId, 'out', drag.type)
      applyTelopAnimSide(r.inId, 'in', drag.type)
    } else {
      applyTelopAnimSide(cue.id, r.kind === 'between' ? 'in' : r.kind, drag.type)
    }
  }
  // 帯クリックでテロップアニメを選択（クリップ本体は選択しない）。
  function selectTelopTrans(cueId: number, kind: 'in' | 'out'): void {
    setSelectedTrackId(null)
    setSelectedIds([])
    setEditingId(null)
    setSelectedVideoIds([])
    setSelectedAudioIds([])
    setSelectedSeIds([])
    setSelectedTrans(null)
    setVideoSelected(false)
    setSelectedTelopTrans({ cueId, kind })
    setRightTab('transition')
  }
  function updateTelopTransDur(dur: number): void {
    if (!selectedTelopTrans) return
    const { cueId, kind } = selectedTelopTrans
    patchCueAnim(cueId, kind === 'in' ? { inDur: dur } : { outDur: dur })
  }
  function setTelopTransType(type: AnimIn): void {
    if (!selectedTelopTrans) return
    const { cueId, kind } = selectedTelopTrans
    patchCueAnim(cueId, kind === 'in' ? { in: type } : { out: type })
  }
  function deleteSelectedTelopTrans(): void {
    if (!selectedTelopTrans) return
    const { cueId, kind } = selectedTelopTrans
    patchCueAnim(cueId, kind === 'in' ? { in: 'none' } : { out: 'none' })
    setSelectedTelopTrans(null)
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
  // 強調（揺れ/脈動）は範囲を持たないので選択テロップにトグルで付与/解除。
  function toggleTelopEmphasis(em: 'shake' | 'pulse'): void {
    const ids = selectedIds.length ? selectedIds : selectedTelopTrans ? [selectedTelopTrans.cueId] : []
    if (!ids.length) {
      showToast('先にテロップを選択してください（またはタイムラインのテロップに帯をドラッグ）。')
      return
    }
    ids.forEach((id) => {
      const cur = cues.find((c) => c.id === id)?.style.anim
      patchCueAnim(id, { emphasis: cur?.emphasis === em ? 'none' : em })
    })
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
    // カット境界の近く → 間（左クリップに付与。帯はカット中心にまたいで表示）
    if (cutIdx >= 0 && cutPx <= BOUNDARY_PX) {
      const A = lay[cutIdx]
      const d = Math.min(transDur, A.len, lay[cutIdx + 1].len)
      return {
        segId: A.seg.id,
        kind: 'xfade',
        left: (A.len - d / 2) * z,
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
  function closeSelectedGaps(): boolean {
    const ids = new Set([...selectedVideoIds, ...selectedAudioIds])
    const gap = segsRef.current.find((s) => s.gap && ids.has(s.id))
    if (!gap) return false
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
    // テロップ・SEも同区間を除去して詰める（同期維持）
    setCues((prev) =>
      prev
        .map((c) => {
          const ns = c.start >= rmEnd ? c.start - removeLen : c.start > rmStart ? rmStart : c.start
          const ne = c.end >= rmEnd ? c.end - removeLen : c.end > rmStart ? rmStart : c.end
          return { ...c, start: ns, end: ne }
        })
        .filter((c) => c.end - c.start > 0.05)
    )
    setSeClips((prev) =>
      prev.map((x) =>
        x.tStart >= rmEnd
          ? { ...x, tStart: x.tStart - removeLen }
          : x.tStart > rmStart
            ? { ...x, tStart: rmStart }
            : x
      )
    )
    // マーカー・画像も同区間を詰める（同期維持）
    setMarkers((prev) =>
      prev.map((m) =>
        m.t >= rmEnd ? { ...m, t: m.t - removeLen } : m.t > rmStart ? { ...m, t: rmStart } : m
      )
    )
    setImgClips((prev) =>
      prev.map((c) =>
        c.tStart >= rmEnd
          ? { ...c, tStart: c.tStart - removeLen }
          : c.tStart > rmStart
            ? { ...c, tStart: rmStart }
            : c
      )
    )
    // 映像レイヤーも同区間を詰める（本編とズレると位置リンクが崩れる）
    setVClips((prev) =>
      prev.map((c) =>
        c.tStart >= rmEnd
          ? { ...c, tStart: c.tStart - removeLen }
          : c.tStart > rmStart
            ? { ...c, tStart: rmStart }
            : c
      )
    )
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
    // テロップ・SEも同区間を除去して詰める（同期維持）
    setCues((prev) =>
      prev
        .map((c) => {
          const ns = c.start >= rmEnd ? c.start - removeLen : c.start > rmStart ? rmStart : c.start
          const ne = c.end >= rmEnd ? c.end - removeLen : c.end > rmStart ? rmStart : c.end
          return { ...c, start: ns, end: ne }
        })
        .filter((c) => c.end - c.start > 0.05)
    )
    setSeClips((prev) =>
      prev.map((x) =>
        x.tStart >= rmEnd
          ? { ...x, tStart: x.tStart - removeLen }
          : x.tStart > rmStart
            ? { ...x, tStart: rmStart }
            : x
      )
    )
    // マーカー・画像も同区間を詰める（同期維持）
    setMarkers((prev) =>
      prev.map((m) =>
        m.t >= rmEnd ? { ...m, t: m.t - removeLen } : m.t > rmStart ? { ...m, t: rmStart } : m
      )
    )
    setImgClips((prev) =>
      prev.map((c) =>
        c.tStart >= rmEnd
          ? { ...c, tStart: c.tStart - removeLen }
          : c.tStart > rmStart
            ? { ...c, tStart: rmStart }
            : c
      )
    )
    // 映像レイヤーも同区間を詰める（本編とズレると位置リンクが崩れる）
    setVClips((prev) =>
      prev.map((c) =>
        c.tStart >= rmEnd
          ? { ...c, tStart: c.tStart - removeLen }
          : c.tStart > rmStart
            ? { ...c, tStart: rmStart }
            : c
      )
    )
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

  // 再生ヘッドでテロップを分割（選択があればそれだけ、なければ全て）
  //
  // scope='all'（何も選んでいないときの分割）では、分割してできたテロップを
  // 選択状態にしない。選択したままにすると、次に Ctrl+K を押したときに
  // 「選択中のテロップだけ分割」へ勝手に切り替わり、動画が切れなくなる。
  // （切って動かして切る、を繰り返すと2回目から動画が切れない不具合になっていた）
  function splitAtPlayhead(scope: 'selected' | 'all' = 'selected'): void {
    const t = qFrame(currentTimeRef.current, fpsRef.current)
    // ロック中トラックのテロップは分割対象外（実トラック単位で判定）
    const inScope = (c: Cue): boolean =>
      (selectedIds.length ? isSelected(c.id) : true) &&
      !telopLocked(c) &&
      c.start < t - 0.02 &&
      c.end > t + 0.02
    const targets = cues.filter(inScope)
    if (!targets.length) return
    // id は updater の外で採番（StrictMode 二重実行で id が飛ばないように）。
    // newIds も updater の外で確定（updater内push だと二重実行で重複が積まれる）。
    const idMap = new Map(targets.map((c) => [c.id, idCounter.current++]))
    const newIds: number[] = targets.map((c) => idMap.get(c.id) as number)
    setCues((prev) => {
      const result: Cue[] = []
      for (const c of prev) {
        if (inScope(c)) {
          const nid = idMap.get(c.id) as number
          result.push({ ...structuredClone(c), end: t })
          result.push({ ...structuredClone(c), id: nid, start: t })
        } else result.push(c)
      }
      return result.sort((a, b) => a.start - b.start)
    })
    if (scope === 'selected') setSelectedIds(newIds)
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
    const targets = snapTargets([], excludeSeIds, excludeImgIds, excludeVcIds)
    const thr = 8 / zoomRef.current
    let bestStart = tStart
    let bestD = thr
    let snapLine: number | null = null
    for (const tg of targets) {
      const dL = Math.abs(tg - tStart)
      if (dL < bestD) {
        bestD = dL
        bestStart = tg
        snapLine = tg
      }
      const dR = Math.abs(tg - (tStart + dur))
      if (dR < bestD) {
        bestD = dR
        bestStart = tg - dur
        snapLine = tg
      }
    }
    setSnapLineX(snapLine != null ? Math.max(0, snapLine) * zoomRef.current : null)
    return Math.max(0, bestStart)
  }

  // ================= キーボード（refで常に最新のハンドラを呼ぶ）=================
  const keyHandlerRef = useRef<(e: KeyboardEvent) => void>(() => {})
  keyHandlerRef.current = (e: KeyboardEvent): void => {
    const el = e.target as HTMLElement | null
    const tag = el?.tagName
    // 文字を打つ欄にフォーカスがあるときは、ショートカットを通さない。
    //
    // ただし **つまみ（input[type=range]）は文字を打つ欄ではない**。ここで一律に
    // 止めていたため、音量つまみを触った直後に矢印キーを押すと、再生ヘッドではなく
    // つまみの値が動いていた（スペースキーも再生に効かなかった）。
    // つまみのときはショートカットを優先し、下で明示的にフォーカスを外す。
    const isSlider = tag === 'INPUT' && (el as HTMLInputElement).type === 'range'
    if ((tag === 'INPUT' && !isSlider) || tag === 'TEXTAREA' || tag === 'SELECT') return
    if (capturingId) return // 環境設定でキー割当中は通常処理しない
    if (exportStatus) return // 書き出し中は編集操作を受け付けない（進行中の処理と混線するため）
    // モーダル表示中は Esc 以外を通さない（裏のタイムラインが勝手に動くのを防ぐ）
    if (
      (restorePrompt ||
        templatePicker ||
        cropSrc ||
        showExportDialog ||
        prefsOpen ||
        promptState ||
        confirmState ||
        iconSettingsOpen) &&
      e.key !== 'Escape'
    )
      return
    const combo = comboFromEvent(e)
    if (!combo) return
    // Backspace は delete/rippleDel の別名として扱う
    const norm = combo.replace(/\bbackspace\b/, 'delete')
    let id = (Object.keys(shortcuts) as ShortcutId[]).find(
      (k) => shortcuts[k] === combo || shortcuts[k] === norm
    )
    // 削除は2種類（プレミアと同じ考え方）:
    //   D / Delete / Backspace = 消すだけ。そこは空きになり、後ろは動かない。
    //   F / Shift+Delete       = 消して詰める。後ろが前へ寄る。
    if (!id && norm === 'delete') id = 'del'
    if (!id && (combo === 'shift+delete' || combo === 'shift+backspace')) id = 'rippleDel'
    // Ctrl+Shift+Z も「やり直し」の別名として受ける（Premiere/一般的な慣習）
    if (!id && combo === 'ctrl+shift+z') id = 'redo'
    if (!id) return
    e.preventDefault()
    // ショートカットとして処理すると決めた時点でフォーカスを手放す。
    // 残したままだと、次のキーもボタンやつまみに吸われ続ける。
    if (tag === 'BUTTON' || isSlider) el?.blur()

    const dispatch: Record<ShortcutId, () => void> = {
      toolSelect: () => setTool('select'),
      toolRazor: () => setTool('razor'),
      toggleSnap: () => toggleSnap(),
      playPause: () => togglePlay(),
      shuttleFwd: () => shuttleForward(),
      shuttleStop: () => stopPlayback(),
      shuttleRev: () => shuttleReverse(),
      gotoStart: () => {
        stopPlayback()
        seekTo(0)
      },
      gotoEnd: () => {
        stopPlayback()
        seekTo(contentEndRef.current || durationRef.current)
      },
      frameBack: () => {
        stopPlayback()
        seekTo(currentTimeRef.current - 1 / fpsRef.current)
      },
      frameFwd: () => {
        stopPlayback()
        seekTo(currentTimeRef.current + 1 / fpsRef.current)
      },
      frameBack5: () => {
        stopPlayback()
        seekTo(currentTimeRef.current - 5 / fpsRef.current)
      },
      frameFwd5: () => {
        stopPlayback()
        seekTo(currentTimeRef.current + 5 / fpsRef.current)
      },
      attrCopy: () => copyAttributes(),
      attrPaste: () => pasteAttributes(),
      del: () => {
        // D は「削除」。以前は動画=映像なし化・音声=消音 だったが、
        // ユーザーの期待どおり“残さず消す”に統一した（Undo で戻せる）。
        // 素材ビンで選んでいるときはビンの素材を消す。以前はここが素通りして
        // 見ていない場所（タイムライン）のクリップが消えていた。
        if (selectedMediaId != null) {
          removeMedia(selectedMediaId)
          return
        }
        if (selectedMarkerId != null) {
          deleteMarker(selectedMarkerId)
          return
        }
        if (selectedTrans) {
          deleteSelectedTrans()
          return
        }
        if (selectedTelopTrans) {
          deleteSelectedTelopTrans()
          return
        }
        if (selectedTrackId) {
          deleteTrack(selectedTrackId)
          return
        }
        // 空きを選んでいるなら、D でも詰まる。
        // 「消す」＝その空きが無くなるということなので、詰まるのが自然な結果になる
        // （クリップを消したときに空きが残るのとは、意味が逆になる）。
        if (closeSelectedGaps()) return
        if (selectedIds.length) deleteSelected()
        // 本編は消すだけ＝そこは空きになり、後ろのクリップもテロップも動かない
        if (anySegSelected()) deleteVideoSegmentsLeavingGap()
        if (selectedSeIds.length) deleteSelectedSE()
        if (selectedImgIds.length) deleteSelectedImg()
        if (selectedVClipIds.length) deleteSelectedVClip()
      },
      rippleDel: () => {
        if (selectedMarkerId != null) {
          deleteMarker(selectedMarkerId)
          return
        }
        if (selectedTrans) {
          deleteSelectedTrans()
          return
        }
        if (selectedTelopTrans) {
          deleteSelectedTelopTrans()
          return
        }
        if (selectedTrackId) {
          deleteTrack(selectedTrackId)
          return
        }
        // 空きを選んでいるなら、まずそれを詰める（途中に別のクリップがあれば手前で止まる）
        if (closeSelectedGaps()) return
        if (closeGapAtPlayhead()) return
        // Delete/Shift+Delete: テロップ削除＋動画切片はリップル削除(後続を詰める・テロップ/SEも同期シフト)＋SE/画像削除。
        // 詰めは動画切片のみが駆動（テロップを独立リップルすると映像とズレるため）。
        if (selectedIds.length) deleteSelected()
        if (anySegSelected()) rippleDeleteVideoSegments()
        if (selectedSeIds.length) deleteSelectedSE()
        if (selectedImgIds.length) deleteSelectedImg()
        if (selectedVClipIds.length) deleteSelectedVClip()
      },
      rippleToPrevCut: () => rippleToPrevCut(),
      rippleToNextCut: () => rippleToNextCut(),
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
      undo,
      redo,
      copy: copySelected,
      cut: cutSelected,
      paste: pasteClipboard,
      duplicate: () => {
        // ロック中トラックのクリップは複製しない（削除は守っているので揃える）
        const lockedSel =
          vClips.some((c) => selectedVClipIds.includes(c.id) && trackStates[c.track]?.locked) ||
          imgClips.some((c) => selectedImgIds.includes(c.id) && trackStates[c.track]?.locked) ||
          seClips.some((c) => selectedSeIds.includes(c.id) && trackStates[c.track]?.locked)
        if (lockedSel) {
          showToast('このトラックはロックされています。')
          return
        }
        if (selectedVClipIds.length) {
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
        if (selectedImgIds.length) {
          // 画像は「直後に同じ長さで複製」（動画切片の複製と同じ考え方）
          const dupes = imgClips
            .filter((c) => selectedImgIds.includes(c.id))
            .map((c) => ({ ...c, id: imgIdCounter.current++, tStart: c.tStart + c.duration }))
          setImgClips((prev) => [...prev, ...dupes])
          setSelectedImgIds(dupes.map((d) => d.id))
          return
        }
        if (selectedSeIds.length) {
          const dupes = seClips
            .filter((c) => selectedSeIds.includes(c.id))
            .map((c) => ({ ...c, id: seIdCounter.current++, tStart: c.tStart + c.duration }))
          setSeClips((prev) => [...prev, ...dupes])
          setSelectedSeIds(dupes.map((d) => d.id))
          return
        }
        if (selectedVideoIds.length) duplicateSelectedSegments()
        else if (!anySegSelected()) duplicateSelected()
      },
      split: () => {
        // テロップ選択中はそのテロップだけ分割（下地動画に不要なカット点を増やさない）。
        // 何も選択が無ければ従来どおり 動画＋再生ヘッド上のテロップ を分割。
        if (selectedIds.length) {
          splitAtPlayhead('selected')
        } else {
          splitVideoAtPlayhead()
          splitAtPlayhead('all')
        }
      },
      addTelop: () => addTelop(),
      addMarker: () => addMarkerAtPlayhead(),
      saveProject: () => void saveProjectFn(),
      openProject: () => void openProjectFn(),
      exportVideo: () => {
        if (exportStatus) return // 書き出し中は受け付けない
        setShowExportDialog(true)
      }
    }
    dispatch[id]()
  }
  useEffect(() => {
    const h = (e: KeyboardEvent): void => keyHandlerRef.current(e)
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

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

  // ファイルメニューを外側クリックで閉じる
  useEffect(() => {
    if (!fileMenuOpen) return
    const close = (): void => setFileMenuOpen(false)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
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

  // タイムラインの拡大率を「中身がちょうど収まる」ところに合わせる。
  function fitTimelineZoom(): void {
    const vw = scrollRef.current?.clientWidth ?? 800
    const end = Math.max(contentEndRef.current, 10)
    setZoom(clamp((vw - 40) / end, 6, 120))
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

  // ホイール: 素=横スクロール / Ctrl・Alt=カーソル位置を中心にズーム（プレミア準拠）
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      if (e.ctrlKey || e.altKey) {
        e.preventDefault()
        const rect = el.getBoundingClientRect()
        const mx = e.clientX - rect.left
        const timeAt = (el.scrollLeft + mx) / zoomRef.current
        const nz = clamp(zoomRef.current * (e.deltaY < 0 ? 1.15 : 0.87), 6, 120)
        setZoom(nz)
        requestAnimationFrame(() => {
          el.scrollLeft = Math.max(0, timeAt * nz - mx)
        })
      } else if (e.deltaY !== 0) {
        e.preventDefault()
        el.scrollLeft += e.deltaY
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // アニメの「変化する区間」の分割点（ローカル秒）を返す。中間の静止区間は1枚で済ませる。
  function animBreakpoints(anim: TelopAnim, dur: number, fps: number): number[] {
    const step = 1 / fps
    const set = new Set<number>([0])
    const addRange = (a: number, b: number): void => {
      for (let t = a; t < b - 1e-4; t += step) set.add(Math.round(t / step) * step)
    }
    if (anim.emphasis !== 'none') addRange(0, dur)
    else {
      if (anim.in !== 'none') addRange(0, Math.min(anim.inDur, dur))
      if (anim.out !== 'none') addRange(Math.max(0, dur - anim.outDur), dur)
    }
    return [...set].filter((t) => t < dur - 1e-4).sort((a, b) => a - b)
  }

  // ================= 書き出し =================
  async function exportProject(): Promise<void> {
    if (!videoPath) {
      showToast('先に動画を読み込んでください。\n「ファイル」→「動画をプロジェクトに追加…」から追加できます。')
      return
    }
    // テロップが無くても書き出せる（カット＋BGM＋画像だけの動画も作れる）
    if (!segments.length) {
      showToast('動画の準備が完了していません。少し待ってから再度お試しください。')
      return
    }
    stopPlayback()
    // 書き出し設定: 1080基準の解像度を resP 倍率でスケール（偶数化）。fps/画質(crf)も反映。
    const base =
      ratio === '16:9'
        ? { width: 1920, height: 1080 }
        : ratio === '9:16'
          ? { width: 1080, height: 1920 }
          : { width: 1080, height: 1080 }
    const k = exportOpts.resP / 1080
    const even = (n: number): number => Math.round((n * k) / 2) * 2
    const size = { width: even(base.width), height: even(base.height) }
    const crf = exportOpts.quality === 'high' ? 18 : exportOpts.quality === 'low' ? 28 : 23
    try {
      // 非表示（👁OFF）トラックのテロップは書き出しに含めない（プレビューと一致させる）
      const exportCues = cues.filter((c) => !trackStates[cueTrack(c)]?.hidden)
      setExportStatus(`テロップを画像化中… (0/${exportCues.length})`)
      const frames: { png: string; start: number; end: number }[] = []
      for (let i = 0; i < exportCues.length; i++) {
        const c = exportCues[i]
        const avatar = iconForCue(c)
        const asc = avatar ? iconScale : 1
        const dur = c.end - c.start
        if (!hasAnim(c.style.anim)) {
          const png = await renderCueToPng(
            c,
            size.width,
            size.height,
            avatar,
            asc,
            undefined,
            iconSide,
            iconOffset.x,
            iconOffset.y,
            iconAuto
          )
          frames.push({ png, start: c.start, end: c.end })
        } else {
          // アニメあり: 変化する区間を時間分割し、各瞬間のPNGを短い区間で並べる
          const bps = animBreakpoints(c.style.anim!, dur, 15)
          for (let k = 0; k < bps.length; k++) {
            const t0 = bps[k]
            const t1 = k + 1 < bps.length ? bps[k + 1] : dur
            const st = computeTelopAnim(c.style.anim!, t0, dur)
            const png = await renderCueToPng(
              c,
              size.width,
              size.height,
              avatar,
              asc,
              st,
              iconSide,
              iconOffset.x,
              iconOffset.y,
              iconAuto
            )
            frames.push({ png, start: c.start + t0, end: c.start + t1 })
          }
        }
        setExportStatus(`テロップを画像化中… (${i + 1}/${exportCues.length})`)
      }
      setExportPct(0)
      setExportStatus('FFmpegで書き出し中…（動画の長さによっては時間がかかります）')
      // 実際に焼き込む素材（非表示トラックは除外）だけで「動画尻より後ろ」を判定する。
      // 全件で判定すると、非表示にした素材のために末尾へ静止画＋無音が付いてしまう。
      const expImgs = imgClips.filter((c) => !trackStates[c.track]?.hidden)
      const cueEnd = exportCues.length ? Math.max(...exportCues.map((c) => c.end)) : 0
      const expImgEnd = expImgs.length
        ? Math.max(...expImgs.map((c) => c.tStart + c.duration))
        : 0
      // 尺はすべて「ソース実尺でクランプ済みの切片」から算出する（書き出しと計算がズレないように）
      const clampedSegs = segments.map((s) =>
        s.gap ? s : { ...s, srcEnd: Math.min(s.srcEnd, srcOfSeg(s)?.duration || s.srcEnd) }
      )
      const clampedTLen = totalSegLen(clampedSegs)
      const expVc = vClips
      const expVcEnd = expVc.length
        ? Math.max(...expVc.map((c) => c.tStart + Math.max(0.05, c.srcEnd - c.srcStart)))
        : 0
      const extendSec = Math.max(0, Math.max(cueEnd, seEnd, expImgEnd, expVcEnd) - clampedTLen)
      // 進捗%算出用の出力尺 = 残った切片の合計（速度反映）+ 引き伸ばし分
      const outDurSec = clampedTLen + extendSec
      const exportLayout = layoutSegs(clampedSegs)
      // マルチソース: 入力に使う元動画一覧と、各切片→入力index の対応
      const srcList = sourcesRef.current.length
        ? sourcesRef.current
        : videoPath
          ? [{ id: 0, path: videoPath }]
          : []
      const srcIdxOf = (seg: VSeg): number => {
        if (seg.srcId == null) return 0
        const i = srcList.findIndex((s) => s.id === seg.srcId)
        return i < 0 ? 0 : i
      }

      const res = await window.giftcut.exportVideo({
        videoPath,
        sources: srcList.map((s) => ({ path: s.path })),
        width: size.width,
        height: size.height,
        frames,
        extendSec,
        // カットを反映: 残っている切片のソース範囲を連結（muted=消音, videoBlank=黒映像）
        // xfade はここで実効長にクランプして渡す（main側は信じて使うだけ）
        segments: clampedSegs.map((s, i) => {
          const d = xfadeDurAt(exportLayout, i)
          return {
            srcIdx: srcIdxOf(s),
            srcStart: s.srcStart,
            srcEnd: s.srcEnd, // clampedSegs で既にソース実尺へクランプ済み（ギャップは対象外）
            muted: !!s.muted,
            // V1 の 👁 非表示はプレビューで真っ黒になるので、書き出しも同じにする
            videoBlank: !!s.videoBlank || v1Hidden,
            speed: segSpeed(s),
            transIn: s.transIn,
            transOut: s.transOut,
            xfade: d > 0 ? { type: s.xfade?.type ?? 'fade', dur: d } : undefined,
            adjust: isNeutralAdjust(s.adjust) ? undefined : s.adjust,
            rotate: s.rotate,
            flipH: s.flipH,
            flipV: s.flipV,
            vol: s.vol,
            afadeIn: s.afadeIn,
            afadeOut: s.afadeOut,
            zoom: isNeutralZoom(s.zoom) ? undefined : s.zoom,
            crop: isNeutralCrop(s.crop) ? undefined : s.crop
          }
        }),
        // SE/BGM を位置・音量で焼き込み（各トラック音量×マスターを合成）
        seClips: seClips.map((c) => ({
          path: c.path,
          tStart: c.tStart,
          duration: c.duration,
          srcOffset: c.srcOffset,
          volume: clamp(c.volume * audioTrackGainForExport(c.track), 0, 4),
          fadeIn: c.fadeIn,
          fadeOut: c.fadeOut
        })),
        // 映像レイヤー（V2以降の動画）。下のトラックから順に重ねる＝上のトラックが前面。
        // 音声はクリップ音量×トラックゲイン×フェードを焼き込む。
        // 👁非表示は映像だけ消す（不透明度0）。音声は残す＝プレビューと同じ挙動。
        vClips: vClips
          .map((c) => (trackStates[c.track]?.hidden ? { ...c, opacity: 0 } : c))
          .slice()
          .sort(
            (a, b) =>
              tracks.findIndex((t) => t.id === b.track) - tracks.findIndex((t) => t.id === a.track)
          )
          .map((c) => ({
            path: c.path,
            tStart: c.tStart,
            srcStart: c.srcStart,
            srcEnd: c.srcEnd,
            zoom: isNeutralZoom(c.zoom) ? undefined : c.zoom,
            rotate: c.rotate,
            flipH: c.flipH,
            flipV: c.flipV,
            opacity: c.opacity != null && c.opacity < 1 ? c.opacity : undefined,
            adjust: isNeutralAdjust(c.adjust) ? undefined : c.adjust,
            crop: isNeutralCrop(c.crop) ? undefined : c.crop,
            volume: c.muted
              ? 0
              : clamp((c.vol ?? 1) * audioTrackGainForExport('A' + trackNum(c.track)), 0, 4),
            fadeIn: c.afadeIn,
            fadeOut: c.afadeOut
          })),
        // 画像クリップ（表示中トラックのみ焼き込み。テロップの下に重ねる）。
        // 下のトラックから順に overlay＝上のトラック(V3)が前面（プレビューと同じ重なり順）。
        images: imgClips
          .filter((c) => !trackStates[c.track]?.hidden)
          .slice()
          .sort(
            (a, b) =>
              tracks.findIndex((t) => t.id === b.track) - tracks.findIndex((t) => t.id === a.track)
          )
          .map((c) => ({
            path: c.path,
            tStart: c.tStart,
            duration: c.duration,
            zoom: isNeutralZoom(c.zoom) ? undefined : c.zoom,
            rotate: c.rotate,
            flipH: c.flipH,
            flipV: c.flipV,
            opacity: c.opacity != null && c.opacity < 1 ? c.opacity : undefined,
            adjust: isNeutralAdjust(c.adjust) ? undefined : c.adjust,
            crop: isNeutralCrop(c.crop) ? undefined : c.crop
          })),
        // メイン音声(A1)トラックのゲイン×マスター
        baseAudioVolume: audioTrackGainForExport('A1'),
        // ラウドネス正規化（null=OFF）
        loudnormLUFS,
        totalDurationSec: outDurSec,
        // 書き出し設定（'素材と同じ' はここで実数に解決してから渡す）
        fps: resolveExportFps(),
        crf
      })
      setExportStatus(null)
      setExportPct(null)
      if (res?.ok) showToast('書き出しが完了しました\n' + res.outPath, 'success')
      else if (
        res?.canceled ||
        res?.error === 'キャンセルされました' ||
        res?.error === 'キャンセル'
      ) {
        /* ユーザーがキャンセル: 通知不要（赤いエラーを出さない） */
      } else showToast('書き出しできませんでした\n' + (res?.error ?? '不明なエラー'), 'error')
    } catch (e) {
      setExportStatus(null)
      setExportPct(null)
      showToast('書き出しエラー: ' + String(e), 'error')
    }
  }

  // ================= パネルリサイズ =================
  function startResize(kind: 'left' | 'right' | 'timeline', e: React.PointerEvent): void {
    e.preventDefault()
    const sx = e.clientX
    const sy = e.clientY
    const sLeft = leftW
    const sRight = rightW
    const sTL = timelineH
    function onMove(ev: PointerEvent): void {
      if (kind === 'left') setLeftW(clamp(sLeft + (ev.clientX - sx), 170, 520))
      else if (kind === 'right') setRightW(clamp(sRight - (ev.clientX - sx), 200, 560))
      else setTimelineH(clamp(sTL - (ev.clientY - sy), 150, 620))
    }
    function onUp(): void {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      document.body.style.cursor = ''
    }
    document.body.style.cursor = kind === 'timeline' ? 'row-resize' : 'col-resize'
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

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
  function startScrub(e: React.PointerEvent): void {
    blurActiveInput()
    e.preventDefault()
    e.stopPropagation()
    stopPlayback()
    scrubFromClientX(e.clientX)
    // プレミア風: ヘッドを端まで持っていく（画面外含む）とタイムラインが追従スクロール
    const scroll = scrollRef.current
    let lastCx = e.clientX
    let raf: number | null = null
    const EDGE = 56 // 端からこの範囲でオートスクロール開始（バッファ）
    const MAXV = 28 // 1フレームの最大スクロール量(px)
    const autoScroll = (): void => {
      raf = requestAnimationFrame(autoScroll)
      if (!scroll) return
      const r = scroll.getBoundingClientRect()
      let dv = 0
      if (lastCx > r.right - EDGE) dv = Math.min(MAXV, ((lastCx - (r.right - EDGE)) / EDGE) * MAXV)
      else if (lastCx < r.left + EDGE)
        dv = -Math.min(MAXV, ((r.left + EDGE - lastCx) / EDGE) * MAXV)
      if (dv !== 0) {
        const before = scroll.scrollLeft
        scroll.scrollLeft = before + dv
        if (scroll.scrollLeft !== before) scrubFromClientX(lastCx) // スクロール分ヘッドを進める
      }
    }
    raf = requestAnimationFrame(autoScroll)
    const onMove = (ev: PointerEvent): void => {
      lastCx = ev.clientX
      scrubFromClientX(ev.clientX)
    }
    const onUp = (): void => {
      if (raf) cancelAnimationFrame(raf)
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
  function trackRows(): { id: string; kind: 'video' | 'audio'; top: number; h: number }[] {
    let top = RULER_H + padTop
    return tracks.map((t) => {
      const h = t.kind === 'video' ? videoTrackHRef.current : audioTrackHRef.current
      const row = { id: t.id, kind: t.kind, top, h }
      top += h
      return row
    })
  }
  function laneAtY(yRel: number): string | null {
    const row = trackRows().find((r) => yRel >= r.top && yRel < r.top + r.h)
    return row?.id ?? null
  }
  /**
   * ドロップ先のレーンを「一番近い行」に寄せて必ず返す。
   *
   * 行の外（ルーラーの上、一番下の余白、別の種類のトラックの上）に来たときに
   * null を返すと、そこだけ駐禁マークが出て置けなくなる。距離で一番近い行に
   * 寄せてしまえば、狙いが外れても最短距離の行へ置ける。
   * forVideoLayer=true のときは V1（本編）を候補から外す（画像・映像レイヤー用）。
   */
  function dropLaneAt(yRel: number, kind: 'video' | 'audio', forVideoLayer = false): string | null {
    const main = kind === 'video' ? 'V1' : 'A1'
    const rows = trackRows().filter((r) => r.kind === kind)
    const cands = rows.filter((r) => !(forVideoLayer && r.id === main))
    if (!cands.length) return null
    // 行の上に乗っているならそこ。本編の行を狙っているなら本編でよい。
    const hit = cands.find((r) => yRel >= r.top && yRel < r.top + r.h)
    if (hit) return hit.id
    // 行の外（上下の余白）に落ちた＝狙いが外れている。ここで本編を選ぶと、
    // 置いたつもりが本編を上書きして消してしまう。本編以外の中から一番近い行に寄せる。
    const safe = cands.filter((r) => r.id !== main)
    const pool = safe.length ? safe : cands
    const dist = (r: { top: number; h: number }): number => Math.abs(yRel - (r.top + r.h / 2))
    return pool.reduce((a, b) => (dist(b) < dist(a) ? b : a)).id
  }
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
    setSelectedIds(
      want('V2') || want('V3')
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
    clearSegSel()
    trackSelect(e, tool === 'trackFwd' ? 1 : -1)
    return true
  }

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
    clearSegSel()
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
        let top = RULER_H + padTop
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
    clearSegSel() // テロップ選択時は動画切片の選択を解除
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
    if (e.ctrlKey || e.metaKey) {
      setSelectedIds((prev) =>
        prev.includes(cue.id) ? prev.filter((id) => id !== cue.id) : [...prev, cue.id]
      )
      return
    }
    // プレミア準拠: 選択済みクリップを掴んだら選択全体をまとめて移動。
    // 未選択クリップを掴んだらそれだけを選択して移動。選択しても再生ヘッドは動かさない。
    const alreadySel = selectedIds.includes(cue.id)
    const dragIds = alreadySel ? [...selectedIds] : [cue.id]
    if (!alreadySel) setSelectedIds([cue.id])
    // テロップ配置可能トラック（上→下）。上下ドラッグでこの間を移動できる
    // テロップは V1 以外の全映像トラックに置ける（V4以降へ退避したテロップも扱えるように）
    const TELOP_ORDER = tracks
      .filter((t) => t.kind === 'video' && t.id !== 'V1')
      .map((t) => t.id)
      .reverse()
    // 各テロップ行の実際の行番号（V4等の追加レーンで行がずれても正しく対応させる）
    const TELOP_ROWS = TELOP_ORDER.map((id) => tracks.findIndex((t) => t.id === id))
    const startMap = new Map(
      cues
        .filter((c) => dragIds.includes(c.id))
        .map((c) => [c.id, { s: c.start, e: c.end, tr: cueTrack(c) }])
    )
    const grabbed = startMap.get(cue.id)
    if (!grabbed) return
    const grabbedIdx = Math.max(0, TELOP_ORDER.indexOf(grabbed.tr))
    const minStart = Math.min(...[...startMap.values()].map((v) => v.s))
    const innerRect = trackInnerRef.current?.getBoundingClientRect()
    const sx = e.clientX
    const sy = e.clientY
    let moved = false
    const onMove = (ev: PointerEvent): void => {
      const dxPx = ev.clientX - sx
      const dyPx = ev.clientY - sy
      // 横=時間, 縦=トラック移動。どちらかがしきい値を超えたらドラッグ開始
      if (!moved && Math.abs(dxPx) + Math.abs(dyPx) < 3) return
      moved = true
      let delta = dxPx / zoomRef.current
      delta = snapTime(grabbed.s + delta, dragIds) - grabbed.s
      if (minStart + delta < 0) delta = -minStart
      // 掴んだクリップがどのテロップ行に来たか → 相対トラックシフト量
      // （追加レーンでテロップ行の位置がずれても、実際の行番号に最も近いテロップ行へ吸着）
      let trackShift = 0
      if (innerRect) {
        const yRel = ev.clientY - innerRect.top - RULER_H - padTop
        const row = Math.floor(yRel / videoTrackHRef.current)
        let ti = grabbedIdx
        let best = Infinity
        TELOP_ROWS.forEach((r, i) => {
          const d = Math.abs(r - row)
          if (d < best) {
            best = d
            ti = i
          }
        })
        trackShift = ti - grabbedIdx
      }
      setCues((prev) =>
        prev.map((c) => {
          const st = startMap.get(c.id)
          if (!st) return c
          const idx = Math.max(0, TELOP_ORDER.indexOf(st.tr))
          const ntr = TELOP_ORDER[clamp(idx + trackShift, 0, TELOP_ORDER.length - 1)]
          return { ...c, start: st.s + delta, end: st.e + delta, track: ntr }
        })
      )
      setDragTip({ x: ev.clientX, y: ev.clientY, text: formatTime(Math.max(0, grabbed.s + delta)) })
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      setSnapLineX(null)
      setDragTip(null)
      // ドラッグせずクリックのみ → そのクリップ単体を選択（プレミア準拠）
      if (!moved && alreadySel) setSelectedIds([cue.id])
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
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
    const onMove = (ev: PointerEvent): void => {
      const t = (ev.clientX - rect.left) / zoomRef.current
      if (edge === 'l') {
        const ns = Math.max(0, Math.min(snapTime(t, [cue.id]), fixedEnd - 0.1))
        setDragTip({
          x: ev.clientX,
          y: ev.clientY,
          text: `イン ${formatTime(ns)} | 長さ ${formatTime(fixedEnd - ns)}`
        })
        setCues((prev) => prev.map((c) => (c.id === cue.id ? { ...c, start: ns } : c)))
      } else {
        const ne = Math.max(snapTime(t, [cue.id]), fixedStart + 0.1)
        setDragTip({
          x: ev.clientX,
          y: ev.clientY,
          text: `アウト ${formatTime(ne)} | 長さ ${formatTime(ne - fixedStart)}`
        })
        setCues((prev) => prev.map((c) => (c.id === cue.id ? { ...c, end: ne } : c)))
      }
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      setSnapLineX(null)
      setDragTip(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  // プレビュー内テロップのドラッグ移動
  function onTelopPointerDown(cue: Cue, e: React.PointerEvent): void {
    e.stopPropagation()
    if (e.button !== 0) return
    setVideoSelected(false) // テロップ操作時は動画リフレーム枠を隠す
    setSelectedTrans(null) // トランジション帯の選択を解除（Delete誤爆防止）
    setSelectedTelopTrans(null)
    if (telopLocked(cue)) return // ロック中はプレビューからの移動も不可
    const el = screenRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const sx = e.clientX
    const sy = e.clientY
    // 掴んだ点とテロップ中心のズレを保持（中心が掴んだ点へ飛ばず、そのまま動くように）
    const startPos = cue.pos ?? { x: 0.5, y: 0.85 }
    const grabDX = e.clientX - (rect.left + startPos.x * rect.width)
    const grabDY = e.clientY - (rect.top + startPos.y * rect.height)
    let moved = false
    const onMove = (ev: PointerEvent): void => {
      // 3px のしきい値でクリックとドラッグを区別（微ジッタで選択が不発にならないように）
      if (!moved && Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < 3) return
      if (!moved) {
        moved = true
        setSelectedIds([cue.id]) // ドラッグ開始時点で選択も確定
      }
      const x = clamp((ev.clientX - grabDX - rect.left) / rect.width, 0, 1)
      const y = clamp((ev.clientY - grabDY - rect.top) / rect.height, 0, 1)
      setCues((prev) => prev.map((c) => (c.id === cue.id ? { ...c, pos: { x, y } } : c)))
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      if (moved) {
        lastTelopTapRef.current = { id: -1, t: 0 } // ドラッグはダブルタップ判定をリセット
        return
      }
      setSelectedIds([cue.id])
      // ネイティブdblclick非依存の手動ダブルタップ＝編集へ（350ms以内・同一テロップ）
      const now = performance.now()
      const last = lastTelopTapRef.current
      if (last.id === cue.id && now - last.t < 350) {
        lastTelopTapRef.current = { id: -1, t: 0 }
        stopPlayback()
        setEditingId(cue.id)
      } else {
        lastTelopTapRef.current = { id: cue.id, t: now }
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  // プレビューの四隅ハンドル: 固定ボックスがあれば「箱リサイズ」、無ければ「文字サイズ拡縮」
  function onTelopResizeStart(cue: Cue, e: React.PointerEvent, corner: number): void {
    if (e.button !== 0) return
    if (telopLocked(cue)) return
    const el = screenRef.current
    if (!el) return
    setSelectedIds([cue.id])
    const rect = el.getBoundingClientRect()
    // iconAuto ON は箱があってもフォント拡縮側へ（箱だけ大きくなるのを防ぎ、文字/アイコン/枠を一緒に拡縮）
    if (cue.style.box && !iconAuto) {
      // 箱リサイズ（中心固定。corner 0=TL,1=TR,2=BL,3=BR）
      const sx = corner === 1 || corner === 3 ? 1 : -1
      const sy = corner === 2 || corner === 3 ? 1 : -1
      const startX = e.clientX
      const startY = e.clientY
      const startW = cue.style.box.w
      const startH = cue.style.box.h
      const px = rect.height / 1080 // 画面px / 1080基準px
      const onMove = (ev: PointerEvent): void => {
        const dw = ((ev.clientX - startX) / px) * sx * 2 // 中心固定なので両側→×2
        const dh = ((ev.clientY - startY) / px) * sy * 2
        const w = clamp(Math.round(startW + dw), 60, 3200)
        const h = clamp(Math.round(startH + dh), 40, 2000)
        setCues((prev) =>
          prev.map((c) => (c.id === cue.id ? { ...c, style: { ...c.style, box: { w, h } } } : c))
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
      return
    }
    // ★Premiere式拡縮: リサイズはテロップ全体の scale（変形倍率）だけを変える。
    // fontSize・縁・影・ベベルの「数値」は固定＝パネルの数字が大きさで変わらない（Premiere準拠）。
    const p = cue.pos ?? { x: 0.5, y: 0.85 }
    const cx = rect.left + p.x * rect.width
    const cy = rect.top + p.y * rect.height
    const startDist = Math.hypot(e.clientX - cx, e.clientY - cy)
    const startScale = cue.scale ?? 1
    const onMove = (ev: PointerEvent): void => {
      const d = Math.hypot(ev.clientX - cx, ev.clientY - cy)
      const factor = startDist > 4 ? d / startDist : 1
      const ns = Math.round(clamp(startScale * factor, 0.1, 8) * 1000) / 1000
      setCues((prev) => prev.map((c) => (c.id === cue.id ? { ...c, scale: ns } : c)))
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

  // 枠内配置（3×3）: 固定ボックスが無ければ現在の見た目を測って作成し、中身をその方向へ寄せる
  function setBoxAnchor(hx: 'l' | 'c' | 'r', vy: 't' | 'm' | 'b', retried = false): void {
    if (!selectedIds.length) return
    if (!retried && !ensureSelectedTelopVisible(() => setBoxAnchor(hx, vy, true))) return
    const el = screenRef.current
    const boxEl = el?.querySelector('.telop-box-sel') as HTMLElement | null
    // 箱が無いテロップは、今の見た目そのまま（サイズ・位置を変えず）に箱化する
    let created: { w: number; h: number } | null = null
    let keepPos: { x: number; y: number } | null = null
    if (el && boxEl && !selected?.style.box) {
      const S = el.getBoundingClientRect()
      const B = boxEl.getBoundingClientRect()
      const px = S.height / 1080
      created = {
        w: clamp(Math.round(B.width / px), 40, 3200), // 膨らませない＝内容ぴったり
        h: clamp(Math.round(B.height / px), 30, 2000)
      }
      // 箱は中心配置なので、今の見た目の中心を pos にして位置ズレを防ぐ
      keepPos = {
        x: clamp((B.left + B.width / 2 - S.left) / S.width, 0, 1),
        y: clamp((B.top + B.height / 2 - S.top) / S.height, 0, 1)
      }
    }
    const align = hx === 'l' ? 'left' : hx === 'r' ? 'right' : 'center'
    setCues((prev) =>
      prev.map((c) =>
        isSelected(c.id)
          ? {
              ...c,
              // 位置ズレ防止は測った本人(primary)だけ適用
              pos: !c.style.box && keepPos && c.id === primaryId ? keepPos : c.pos,
              style: {
                ...c.style,
                anchor: { h: hx, v: vy },
                align,
                box: c.style.box ?? created ?? { w: 800, h: 240 }
              }
            }
          : c
      )
    )
  }
  // iconAuto用「アイコン軸」: 主選択テロップの現在位置を軸(左端・縦中央)として測り、
  // 全テロップをその1点に整列させる（anchor l/m・左詰め・固定枠なし）。
  // テロップごとに位置や行数が違ってもアイコンは軸に固定され、再生中に飛び回らない。
  function applyIconAutoLeft(retried = false): void {
    if (!selectedIds.length) return
    if (!retried && !ensureSelectedTelopVisible(() => applyIconAutoLeft(true))) return
    const el = screenRef.current
    const boxEl = el?.querySelector('.telop-box-sel') as HTMLElement | null
    let axis: { x: number; y: number } | null = null
    if (el && boxEl) {
      const S = el.getBoundingClientRect()
      // 外箱(boxEl)基準＝アンカーが効くのは外箱なので等冪（繰り返しても動かない）。
      // アイコン有無による本文のズレは changeIconAuto 側の差分補正が打ち消す。
      const B = boxEl.getBoundingClientRect()
      axis = {
        x: clamp((B.left - S.left) / S.width, 0, 1),
        y: clamp((B.top + B.height / 2 - S.top) / S.height, 0, 1)
      }
      setIconAnchorPos(axis)
    }
    setCues((prev) =>
      prev.map((c) => {
        const st = { ...c.style, anchor: { h: 'l' as const, v: 'm' as const }, align: 'left' as const }
        delete st.box // 内容ぴったり＝枠は常に本体一致
        return { ...c, style: st, pos: axis ?? c.pos }
      })
    )
  }
  // 固定ボックスを解除（内容ぴったりに戻す）
  function clearBox(): void {
    if (!selectedIds.length) return
    setCues((prev) =>
      prev.map((c) => {
        if (!isSelected(c.id)) return c
        const st = { ...c.style }
        delete st.box
        return { ...c, style: st }
      })
    )
  }

  // 選択テロップがプレビューに表示されていなければ、その時間へシークして次フレームで retry を実行。
  // 「位置」「枠内」ボタンは画面上の実サイズを測る必要があるため（非表示だと測れず無反応になる）。
  function ensureSelectedTelopVisible(retry: () => void): boolean {
    if (screenRef.current?.querySelector('.telop-box-sel')) return true
    if (!selected) return false
    stopPlayback()
    seekTo(clamp(currentTimeRef.current, selected.start, selected.end - 0.01))
    requestAnimationFrame(() => requestAnimationFrame(retry)) // 描画を待ってから再実行
    return false
  }

  // 選択テロップをフレーム内の指定位置へ揃える（Excelの配置ボタン風。端に詰める）
  // 選択テロップをフレーム内の固定位置へ（現在位置に依らず、画面のその場所へ置く）
  function alignTelop(hx: 'l' | 'c' | 'r', vy: 't' | 'm' | 'b'): void {
    if (!selectedIds.length) return
    const mx = 0.05 // フレーム端の余白（幅比）
    const my = 0.07 // 〃（高さ比）
    const aspect = ratio === '16:9' ? 16 / 9 : ratio === '9:16' ? 9 / 16 : 1
    setCues((prev) =>
      prev.map((c) => {
        if (!isSelected(c.id)) return c
        if (c.style.box) {
          // 固定ボックスは中心配置なので、箱がフレーム内に収まる中心座標を計算
          const bwf = c.style.box.w / (1080 * aspect) // フレーム幅に対する箱幅比
          const bhf = c.style.box.h / 1080
          const x = hx === 'l' ? mx + bwf / 2 : hx === 'r' ? 1 - mx - bwf / 2 : 0.5
          const y = vy === 't' ? my + bhf / 2 : vy === 'b' ? 1 - my - bhf / 2 : 0.5
          return { ...c, pos: { x: clamp(x, 0, 1), y: clamp(y, 0, 1) } }
        }
        // 非ボックス: pos=フレーム内の固定点、anchor=その隅（箱のその隅が pos に来る＝はみ出さない）
        const x = hx === 'l' ? mx : hx === 'r' ? 1 - mx : 0.5
        const y = vy === 't' ? my : vy === 'b' ? 1 - my : 0.5
        return { ...c, pos: { x, y }, style: { ...c.style, anchor: { h: hx, v: vy } } }
      })
    )
  }

  const monitorAspect = ratio === '16:9' ? '16 / 9' : ratio === '9:16' ? '9 / 16' : '1 / 1'

  // プレビュー下の1段目に出す「状態」（画質・fps・全体の長さ）。
  // 操作ボタンと同じ行に混ぜると、よく使う再生ボタンが端に押しやられる。
  const transportInfo = (
    <>
    {/* プレビュー解像度: 実際に再生する映像の解像度を切り替える（ラベル＝実挙動）。
        書き出し設定にも同じ見た目の選択肢があり、実際に取り違えが起きたので、
        「見るときの画質」だと分かる印を付けて別物にする。 */}
    <span className="pq-tag" title="再生して見るときの画質（書き出しには影響しません）">
      👁 プレビュー
    </span>
    <select
      className="pq-select pq-preview"
      value={String(previewRes)}
      onChange={(e) => {
        const v = e.target.value
        setPreviewRes(v === 'orig' ? 'orig' : v === '720' ? 720 : 360)
      }}
      title={
        'プレビューの解像度\n' +
        '・原本＝元動画をそのまま再生。最高画質だがシークは重い\n' +
        '・720p / 360p＝編集用に軽くした映像（プロキシ）で再生。360pは再描画も間引いて最軽量\n' +
        '書き出しは常に原本のフル画質です（この設定は完成品の画質に影響しません）'
      }
    >
      <option value="orig">プレビュー 原本（最高画質）</option>
      <option value="720">プレビュー 720p（標準）</option>
      <option value="360">プレビュー 360p（最軽量）</option>
    </select>
    {videoSrc && (
      <span className="tc tc-fps" title="素材の実フレームレート（フレーム送り・タイムコードに反映）">
        {Number.isInteger(fps) ? fps : fps.toFixed(2)}fps
      </span>
    )}
    <span className="tc">
      {playRateUI !== 0 && Math.abs(playRateUI) !== 1
        ? `${playRateUI > 0 ? '' : '-'}${Math.abs(playRateUI)}x / `
        : ''}
      {formatTime(duration)}
    </span>
    </>
  )
  return (
    <div
      className="app"
      // 検査票を開いている間はアプリ本体を縮める（パネルに隠れないように）
      style={QaPanel && qaOpen ? { marginRight: 'var(--qa-w, 380px)' } : undefined}
      // 素材をドラッグしている間は、アプリのどこにいても受け付ける。
      // 受け付けない場所があると、そこだけ 🚫（駐禁）が出て「置けない場所」に見える。
    >
      {/* ===== メニューバー ===== */}
      <div className="menubar">
        <div className="menu-wrap">
          <span
            className={`menu-item ${fileMenuOpen ? 'menu-item-on' : ''}`}
            onClick={(e) => {
              e.stopPropagation()
              setFileMenuOpen((o) => !o)
            }}
          >
            ファイル
          </span>
          {fileMenuOpen && (
            <div className="menu-dropdown" onClick={(e) => e.stopPropagation()}>
              <button
                className="menu-drop-item"
                onClick={() => {
                  setFileMenuOpen(false)
                  void openProjectFn()
                }}
              >
                プロジェクトを開く…　(Ctrl+O)
              </button>
              {/* 最近使ったプロジェクト。保存先を覚えていなくてもここから開ける。 */}
              {recentProjects.length > 0 && (
                <>
                  <div className="menu-drop-label">最近使ったプロジェクト</div>
                  {recentProjects.map((r) => (
                    <button
                      key={r.path}
                      className="menu-drop-item menu-drop-recent"
                      title={r.path}
                      onClick={() => {
                        setFileMenuOpen(false)
                        void openProjectFn(r.path)
                      }}
                    >
                      {r.name}
                    </button>
                  ))}
                  <div className="menu-drop-sep" />
                </>
              )}
              <button
                className="menu-drop-item"
                onClick={() => {
                  setFileMenuOpen(false)
                  void saveProjectFn()
                }}
                title={
                  projectPath ? `上書き保存: ${projectPath}` : '保存先を選んで保存します'
                }
              >
                {projectPath ? 'プロジェクトを保存' : 'プロジェクトを保存…'}　(
                {formatCombo(shortcuts.saveProject)})
              </button>
              <button
                className="menu-drop-item"
                onClick={() => {
                  setFileMenuOpen(false)
                  void saveProjectFn(true)
                }}
              >
                別名で保存…
              </button>
              <div className="menu-drop-sep" />
              <button
                className="menu-drop-item"
                onClick={() => {
                  setFileMenuOpen(false)
                  saveAsTemplateFn()
                }}
              >
                テンプレートとして保存…
              </button>
              <button
                className="menu-drop-item"
                onClick={() => {
                  setFileMenuOpen(false)
                  void openTemplateFn()
                }}
              >
                テンプレートを開く…
              </button>
              <div className="menu-drop-sep" />
              <button
                className="menu-drop-item"
                onClick={() => {
                  setFileMenuOpen(false)
                  handleOpenVideo()
                }}
              >
                動画をプロジェクトに追加…
              </button>
              <button
                className="menu-drop-item"
                onClick={() => {
                  setFileMenuOpen(false)
                  void handleAppendVideo()
                }}
                title="選んだ動画をタイムラインのいちばん後ろに置きます"
              >
                動画をタイムライン末尾に置く…
              </button>
              <button
                className="menu-drop-item"
                onClick={() => {
                  setFileMenuOpen(false)
                  void handleReplaceVideo()
                }}
                title="現在のカットを破棄して別の動画に置き換えます"
              >
                動画を差し替え…
              </button>
              <button
                className="menu-drop-item"
                onClick={() => {
                  setFileMenuOpen(false)
                  handleImportSrt()
                }}
              >
                SRT（テロップ）を読み込む…
              </button>
              <button
                className="menu-drop-item"
                onClick={() => {
                  setFileMenuOpen(false)
                  void exportSrtFn()
                }}
              >
                SRT を書き出し…
              </button>
              <button
                className="menu-drop-item"
                onClick={() => {
                  setFileMenuOpen(false)
                  setShowExportDialog(true)
                }}
              >
                動画を書き出し…
              </button>
              <div className="menu-drop-sep" />
              <button
                className="menu-drop-item"
                onClick={() => {
                  setFileMenuOpen(false)
                  setPrefsOpen(true)
                }}
              >
                環境設定（ショートカット）…
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ===== モードバー ===== */}
      <div className="modebar">
        <div className="modebar-left">
          <span className="home">⌂</span>
          <button className="mode-tab mode-tab-on">編集</button>
          {/* 設定ダイアログを経由する（メニューや Ctrl+M と挙動を揃える。
              以前はここだけ前回設定で即書き出しが始まっていた） */}
          <button className="mode-tab" onClick={() => setShowExportDialog(true)}>
            書き出し
          </button>
        </div>
        <div className="modebar-sep" />
        <div className="modebar-title" title={projectPath ?? '未保存のプロジェクト'}>
          {/* タイトルはプロジェクトファイル名。SRTのファイル名を出すと保存先を誤認させる */}
          {projectPath ? projectPath.split(/[\\/]/).pop() : 'GiftCut - 無題プロジェクト'}
          {unsaved ? ' *' : ''}
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
          {/* --- 左: プロパティ --- */}
          <section
            className={`panel ${isFloating('left') ? 'pane-float' : ''}`}
            style={isFloating('left') ? floatStyle('left') : { width: leftW, flex: '0 0 auto' }}
          >
            {isFloating('left') && floatHead('left')}
            <div className="panel-tabs">
              <span className="tab tab-on">プロパティ</span>
            </div>
            <div className="panel-body">
              {selected ? (
                <>
                  {selectedIds.length > 1 && (
                    <div className="multi-banner">
                      {selectedIds.length}個をまとめて編集中（スタイル・アイコンは全てに適用）
                    </div>
                  )}
                  <label className="field-label">テロップ テキスト</label>
                  <textarea
                    className="text-input"
                    value={selected.text}
                    onChange={(e) => updateSelectedText(e.target.value)}
                    rows={Math.max(1, selected.text.split('\n').length)}
                  />
                  <StylePanel
                    style={panelStyleFor(selected)}
                    onChange={updateSelectedStyle}
                    presets={userTemplates}
                    onSavePreset={savePreset}
                    onApplyPreset={applyTemplate}
                    label={selected.label}
                    iconOn={iconForCue(selected) !== undefined}
                    onToggleIcon={setPersonIconForSelected}
                    currentIconImage={iconForCue(selected)}
                    onOpenIconSettings={() => setIconSettingsOpen(true)}
                    iconScale={iconScale}
                    onIconScaleChange={setIconScale}
                    iconAuto={iconAuto}
                    onIconAutoChange={changeIconAuto}
                    iconSide={iconSide}
                    onIconSideChange={setIconSide}
                    iconOffset={iconOffset}
                    onIconOffsetChange={setIconOffset}
                    onAlign={alignTelop}
                    onBoxAnchor={setBoxAnchor}
                    onClearBox={clearBox}
                  />
                </>
              ) : selectedSeIds.length ? (
                (() => {
                  const se = seClips.find((c) => c.id === selectedSeIds[0])
                  if (!se) return null
                  return (
                    <>
                      <label className="field-label">
                        {se.track === 'A2' ? 'SE（効果音）' : 'オーディオクリップ'}
                      </label>
                      <div className="time-val" style={{ marginBottom: 8 }}>
                        🔊 {se.name}
                        {selectedSeIds.length > 1 && `（他${selectedSeIds.length - 1}個も一緒に）`}
                      </div>
                      <div className="sp-row">
                        <span className="sp-label">音量</span>
                        <input
                          type="range"
                          min={0}
                          max={200}
                          step={2}
                          value={Math.round(se.volume * 100)}
                          onChange={(e) => updateSelectedSE({ volume: Number(e.target.value) / 100 })}
                        />
                        <span className="sp-val">{Math.round(se.volume * 100)}%</span>
                      </div>
                      <div className="sp-row">
                        <span className="sp-label">フェードイン</span>
                        <input
                          type="range"
                          min={0}
                          max={Math.max(0.5, se.duration).toFixed(2)}
                          step={0.05}
                          value={se.fadeIn}
                          onChange={(e) => updateSelectedSE({ fadeIn: Number(e.target.value) })}
                        />
                        <span className="sp-val">{se.fadeIn.toFixed(2)}s</span>
                      </div>
                      <div className="sp-row">
                        <span className="sp-label">フェードアウト</span>
                        <input
                          type="range"
                          min={0}
                          max={Math.max(0.5, se.duration).toFixed(2)}
                          step={0.05}
                          value={se.fadeOut}
                          onChange={(e) => updateSelectedSE({ fadeOut: Number(e.target.value) })}
                        />
                        <span className="sp-val">{se.fadeOut.toFixed(2)}s</span>
                      </div>
                    </>
                  )
                })()
              ) : selectedVideoIds.length ? (
                (() => {
                  const seg = segments.find((s) => s.id === selectedVideoIds[0])
                  const cur = seg ? segSpeed(seg) : 1
                  return (
                    <>
                      <label className="field-label">
                        動画クリップ
                        {selectedVideoIds.length > 1 && `（${selectedVideoIds.length}個）`}
                      </label>
                      <div className="sp-row">
                        <span className="sp-label">再生速度</span>
                      </div>
                      <div className="seg seg-wide">
                        {[0.5, 0.75, 1, 1.25, 1.5, 2].map((sp) => (
                          <button
                            key={sp}
                            className={`seg-btn ${Math.abs(cur - sp) < 1e-3 ? 'seg-on' : ''}`}
                            onClick={() => setSelectedSegSpeed(sp)}
                          >
                            {sp}x
                          </button>
                        ))}
                      </div>
                      <div className="tpl-hint" style={{ marginTop: 8 }}>
                        速くするとクリップが短くなり、後ろのテロップ・SE・画像・マーカー・映像レイヤーも一緒にずれます。
                      </div>
                      {/* 色調整（明るさ/コントラスト/彩度）。選択クリップに反映 */}
                      {(() => {
                        const a = seg?.adjust ?? DEFAULT_ADJUST
                        const rows: { key: 'b' | 'c' | 's'; label: string }[] = [
                          { key: 'b', label: '明るさ' },
                          { key: 'c', label: 'コントラスト' },
                          { key: 's', label: '彩度' }
                        ]
                        return (
                          <>
                            <label className="field-label" style={{ marginTop: 12 }}>
                              色調整
                            </label>
                            {rows.map((r) => (
                              <div className="sp-row" key={r.key}>
                                <span className="sp-label">{r.label}</span>
                                <input
                                  type="range"
                                  min={0}
                                  max={2}
                                  step={0.02}
                                  value={a[r.key]}
                                  onChange={(e) =>
                                    setSelectedAdjust({ [r.key]: Number(e.target.value) })
                                  }
                                />
                                <span className="sp-val">{a[r.key].toFixed(2)}</span>
                              </div>
                            ))}
                            <button
                              className="btn small"
                              onClick={() => setSelectedAdjust(null)}
                              style={{ marginTop: 4 }}
                            >
                              色調整をリセット
                            </button>
                          </>
                        )
                      })()}
                      {/* 変形（回転・反転） */}
                      <label className="field-label" style={{ marginTop: 12 }}>
                        変形
                      </label>
                      <div className="seg seg-wide">
                        <button className="seg-btn" onClick={rotateSelectedSeg} title="90°回転">
                          ↻ 回転{seg?.rotate ? `（${seg.rotate}°）` : ''}
                        </button>
                        <button
                          className={`seg-btn ${seg?.flipH ? 'seg-on' : ''}`}
                          onClick={() => flipSelectedSeg('h')}
                          title="左右反転"
                        >
                          ⇄ 左右
                        </button>
                        <button
                          className={`seg-btn ${seg?.flipV ? 'seg-on' : ''}`}
                          onClick={() => flipSelectedSeg('v')}
                          title="上下反転"
                        >
                          ⇅ 上下
                        </button>
                      </div>
                      {/* クロップ（切り抜き）。各辺を内側へ切り込む。切った領域は黒。 */}
                      <label className="field-label" style={{ marginTop: 12 }}>
                        クロップ（切り抜き）
                      </label>
                      {(
                        [
                          { key: 'l', label: '左' },
                          { key: 'r', label: '右' },
                          { key: 't', label: '上' },
                          { key: 'b', label: '下' }
                        ] as const
                      ).map((r) => {
                        const cr = seg?.crop ?? DEFAULT_CROP
                        const v = cr[r.key]
                        return (
                          <div className="sp-row" key={r.key}>
                            <span className="sp-label">{r.label}</span>
                            <input
                              type="range"
                              min={0}
                              max={90}
                              step={1}
                              value={Math.round(v * 100)}
                              onChange={(e) =>
                                setSelectedCrop({ [r.key]: Number(e.target.value) / 100 })
                              }
                            />
                            <span className="sp-val">{Math.round(v * 100)}%</span>
                          </div>
                        )
                      })}
                      <button
                        className="btn small"
                        onClick={() => setSelectedCrop(null)}
                        style={{ marginTop: 4 }}
                      >
                        クロップをリセット
                      </button>
                    </>
                  )
                })()
              ) : selectedAudioIds.length ? (
                (() => {
                  const seg = segments.find((s) => s.id === selectedAudioIds[0])
                  const len = seg ? segTLen(seg) : 1
                  const vol = seg?.vol ?? 1
                  return (
                    <>
                      <label className="field-label">
                        音声クリップ
                        {selectedAudioIds.length > 1 && `（${selectedAudioIds.length}個）`}
                      </label>
                      <div className="sp-row">
                        <span className="sp-label">音量</span>
                        <input
                          type="range"
                          min={0}
                          max={2}
                          step={0.02}
                          value={vol}
                          onChange={(e) => setSelectedAudio({ vol: Number(e.target.value) })}
                        />
                        <span className="sp-val">{Math.round(vol * 100)}%</span>
                      </div>
                      <div className="sp-row">
                        <span className="sp-label">フェードイン</span>
                        <input
                          type="range"
                          min={0}
                          max={Math.max(0.5, len).toFixed(2)}
                          step={0.05}
                          value={seg?.afadeIn ?? 0}
                          onChange={(e) => setSelectedAudio({ afadeIn: Number(e.target.value) })}
                        />
                        <span className="sp-val">{(seg?.afadeIn ?? 0).toFixed(2)}s</span>
                      </div>
                      <div className="sp-row">
                        <span className="sp-label">フェードアウト</span>
                        <input
                          type="range"
                          min={0}
                          max={Math.max(0.5, len).toFixed(2)}
                          step={0.05}
                          value={seg?.afadeOut ?? 0}
                          onChange={(e) => setSelectedAudio({ afadeOut: Number(e.target.value) })}
                        />
                        <span className="sp-val">{(seg?.afadeOut ?? 0).toFixed(2)}s</span>
                      </div>
                      <div className="seg seg-wide" style={{ marginTop: 8 }}>
                        <button
                          className={`seg-btn ${seg?.muted ? 'seg-on' : ''}`}
                          onClick={toggleMuteSelectedSegments}
                          title="このクリップの音だけを消す（映像と長さは残す）"
                        >
                          🔇 消音
                        </button>
                      </div>
                      <div className="tpl-hint" style={{ marginTop: 8 }}>
                        D / Delete はクリップを削除して後ろを詰めます。音だけ消したいときは上の「消音」。
                      </div>
                    </>
                  )
                })()
              ) : selectedVClipIds.length ? (
                (() => {
                  const vc = vClips.find((c) => c.id === selectedVClipIds[0])
                  if (!vc) return null
                  const vz = vc.zoom ?? DEFAULT_ZOOM
                  const va = vc.adjust ?? DEFAULT_ADJUST
                  const vcr = vc.crop ?? DEFAULT_CROP
                  const len = Math.max(0.05, vc.srcEnd - vc.srcStart)
                  return (
                    <>
                      <label className="field-label">映像レイヤー（{vc.track}）</label>
                      <div className="time-val" style={{ marginBottom: 8 }}>
                        🎬 {vc.name}
                        {selectedVClipIds.length > 1 &&
                          `（他${selectedVClipIds.length - 1}個も一緒に）`}
                      </div>
                      <div className="tpl-hint" style={{ marginBottom: 8 }}>
                        音声は {pairedAudioOf(vc.track)} に連動（長さ {formatTime(len)}）
                      </div>
                      <div className="sp-row">
                        <span className="sp-label">拡大</span>
                        <input
                          type="range"
                          min={20}
                          max={800}
                          step={1}
                          value={Math.round(vz.scale * 100)}
                          onChange={(e) =>
                            setVClipZoom(vc.id, { ...vz, scale: Number(e.target.value) / 100 })
                          }
                        />
                        <span className="sp-val">{Math.round(vz.scale * 100)}%</span>
                      </div>
                      <div className="sp-row">
                        <span className="sp-label">不透明度</span>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          step={1}
                          value={Math.round((vc.opacity ?? 1) * 100)}
                          onChange={(e) =>
                            updateSelectedVClip({ opacity: Number(e.target.value) / 100 })
                          }
                        />
                        <span className="sp-val">{Math.round((vc.opacity ?? 1) * 100)}%</span>
                      </div>
                      <div className="sp-row">
                        <span className="sp-label">音量</span>
                        <input
                          type="range"
                          min={0}
                          max={2}
                          step={0.02}
                          value={vc.vol ?? 1}
                          onChange={(e) => updateSelectedVClip({ vol: Number(e.target.value) })}
                        />
                        <span className="sp-val">{Math.round((vc.vol ?? 1) * 100)}%</span>
                      </div>
                      <div className="sp-row">
                        <span className="sp-label">フェードイン</span>
                        <input
                          type="range"
                          min={0}
                          max={Math.max(0.5, len).toFixed(2)}
                          step={0.05}
                          value={vc.afadeIn ?? 0}
                          onChange={(e) => updateSelectedVClip({ afadeIn: Number(e.target.value) })}
                        />
                        <span className="sp-val">{(vc.afadeIn ?? 0).toFixed(2)}s</span>
                      </div>
                      <div className="sp-row">
                        <span className="sp-label">フェードアウト</span>
                        <input
                          type="range"
                          min={0}
                          max={Math.max(0.5, len).toFixed(2)}
                          step={0.05}
                          value={vc.afadeOut ?? 0}
                          onChange={(e) =>
                            updateSelectedVClip({ afadeOut: Number(e.target.value) })
                          }
                        />
                        <span className="sp-val">{(vc.afadeOut ?? 0).toFixed(2)}s</span>
                      </div>
                      <label className="field-label" style={{ marginTop: 12 }}>
                        変形
                      </label>
                      <div className="seg seg-wide">
                        <button
                          className="seg-btn"
                          title="90°回転"
                          onClick={() => {
                            const next = (Math.round((vc.rotate ?? 0) / 90) * 90 + 90) % 360
                            updateSelectedVClip({ rotate: next === 0 ? undefined : next })
                          }}
                        >
                          ↻ 回転{vc.rotate ? `（${Math.round(vc.rotate)}°）` : ''}
                        </button>
                        <button
                          className={`seg-btn ${vc.flipH ? 'seg-on' : ''}`}
                          onClick={() => updateSelectedVClip({ flipH: !vc.flipH })}
                          title="左右反転"
                        >
                          ⇄ 左右
                        </button>
                        <button
                          className={`seg-btn ${vc.flipV ? 'seg-on' : ''}`}
                          onClick={() => updateSelectedVClip({ flipV: !vc.flipV })}
                          title="上下反転"
                        >
                          ⇅ 上下
                        </button>
                      </div>
                      {/* 消音は音声の設定なので変形から出す（動画切片も音声側に置いている） */}
                      <div className="seg seg-wide" style={{ marginTop: 6 }}>
                        <button
                          className={`seg-btn ${vc.muted ? 'seg-on' : ''}`}
                          onClick={() => updateSelectedVClip({ muted: !vc.muted })}
                          title="この映像の音だけを消す"
                        >
                          🔇 消音
                        </button>
                      </div>
                      {/* 色調整（画像クリップ・動画切片と同じモデル） */}
                      <label className="field-label" style={{ marginTop: 12 }}>
                        色調整
                      </label>
                      {(
                        [
                          { key: 'b', label: '明るさ' },
                          { key: 'c', label: 'コントラスト' },
                          { key: 's', label: '彩度' }
                        ] as const
                      ).map((r) => (
                        <div className="sp-row" key={r.key}>
                          <span className="sp-label">{r.label}</span>
                          <input
                            type="range"
                            min={0}
                            max={2}
                            step={0.02}
                            value={va[r.key]}
                            onChange={(e) => {
                              const next = { ...va, [r.key]: Number(e.target.value) }
                              updateSelectedVClip({
                                adjust: isNeutralAdjust(next) ? undefined : next
                              })
                            }}
                          />
                          <span className="sp-val">{va[r.key].toFixed(2)}</span>
                        </div>
                      ))}
                      {/* クロップ */}
                      <label className="field-label" style={{ marginTop: 12 }}>
                        クロップ（切り抜き）
                      </label>
                      {(
                        [
                          { key: 'l', label: '左' },
                          { key: 'r', label: '右' },
                          { key: 't', label: '上' },
                          { key: 'b', label: '下' }
                        ] as const
                      ).map((r) => (
                        <div className="sp-row" key={r.key}>
                          <span className="sp-label">{r.label}</span>
                          <input
                            type="range"
                            min={0}
                            max={90}
                            step={1}
                            value={Math.round(vcr[r.key] * 100)}
                            onChange={(e) => {
                              const next = { ...vcr, [r.key]: Number(e.target.value) / 100 }
                              // 対辺の合計が95%を超えないよう相手側を押し戻す（画像と同じ規則）
                              if (next.l + next.r > 0.95)
                                next[r.key === 'r' ? 'r' : 'l'] =
                                  0.95 - next[r.key === 'r' ? 'l' : 'r']
                              if (next.t + next.b > 0.95)
                                next[r.key === 'b' ? 'b' : 't'] =
                                  0.95 - next[r.key === 'b' ? 't' : 'b']
                              updateSelectedVClip({ crop: isNeutralCrop(next) ? undefined : next })
                            }}
                          />
                          <span className="sp-val">{Math.round(vcr[r.key] * 100)}%</span>
                        </div>
                      ))}
                      <button
                        className="btn small"
                        style={{ marginTop: 6 }}
                        onClick={() =>
                          updateSelectedVClip({
                            zoom: undefined,
                            rotate: undefined,
                            flipH: undefined,
                            flipV: undefined,
                            opacity: undefined,
                            adjust: undefined,
                            crop: undefined
                          })
                        }
                      >
                        変形・調整をリセット
                      </button>
                      <div className="tpl-hint" style={{ marginTop: 8 }}>
                        プレビューの枠をドラッグで拡大/移動、四隅の↻で回転。Delete で削除。
                      </div>
                    </>
                  )
                })()
              ) : selectedImgIds.length ? (
                (() => {
                  const im = imgClips.find((c) => c.id === selectedImgIds[0])
                  if (!im) return null
                  const iz = im.zoom ?? DEFAULT_ZOOM
                  const ia = im.adjust ?? DEFAULT_ADJUST
                  const ic = im.crop ?? DEFAULT_CROP
                  return (
                    <>
                      <label className="field-label">画像クリップ</label>
                      <div className="time-val" style={{ marginBottom: 8 }}>
                        🖼 {im.name}
                        {selectedImgIds.length > 1 && `（他${selectedImgIds.length - 1}個も一緒に）`}
                      </div>
                      <div className="sp-row">
                        <span className="sp-label">長さ</span>
                        <input
                          type="range"
                          min={0.2}
                          max={30}
                          step={0.1}
                          value={im.duration}
                          onChange={(e) => updateSelectedImg({ duration: Number(e.target.value) })}
                        />
                        <span className="sp-val">{im.duration.toFixed(2)}s</span>
                      </div>
                      <div className="sp-row">
                        <span className="sp-label">拡大</span>
                        <input
                          type="range"
                          min={20}
                          max={800}
                          step={1}
                          value={Math.round(iz.scale * 100)}
                          onChange={(e) =>
                            setImgZoom(im.id, { ...iz, scale: Number(e.target.value) / 100 })
                          }
                        />
                        <span className="sp-val">{Math.round(iz.scale * 100)}%</span>
                      </div>
                      <div className="sp-row">
                        <span className="sp-label">不透明度</span>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          step={1}
                          value={Math.round((im.opacity ?? 1) * 100)}
                          onChange={(e) =>
                            updateSelectedImg({ opacity: Number(e.target.value) / 100 })
                          }
                        />
                        <span className="sp-val">{Math.round((im.opacity ?? 1) * 100)}%</span>
                      </div>
                      {/* 変形（回転・反転）: 動画切片と同じ操作 */}
                      <label className="field-label" style={{ marginTop: 12 }}>
                        変形
                      </label>
                      <div className="seg seg-wide">
                        <button
                          className="seg-btn"
                          title="90°回転"
                          onClick={() => {
                            const next = (Math.round((im.rotate ?? 0) / 90) * 90 + 90) % 360
                            updateSelectedImg({ rotate: next === 0 ? undefined : next })
                          }}
                        >
                          ↻ 回転{im.rotate ? `（${Math.round(im.rotate)}°）` : ''}
                        </button>
                        <button
                          className={`seg-btn ${im.flipH ? 'seg-on' : ''}`}
                          onClick={() => updateSelectedImg({ flipH: !im.flipH })}
                          title="左右反転"
                        >
                          ⇄ 左右
                        </button>
                        <button
                          className={`seg-btn ${im.flipV ? 'seg-on' : ''}`}
                          onClick={() => updateSelectedImg({ flipV: !im.flipV })}
                          title="上下反転"
                        >
                          ⇅ 上下
                        </button>
                      </div>
                      {/* 色調整 */}
                      <label className="field-label" style={{ marginTop: 12 }}>
                        色調整
                      </label>
                      {(
                        [
                          { key: 'b', label: '明るさ' },
                          { key: 'c', label: 'コントラスト' },
                          { key: 's', label: '彩度' }
                        ] as const
                      ).map((r) => (
                        <div className="sp-row" key={r.key}>
                          <span className="sp-label">{r.label}</span>
                          <input
                            type="range"
                            min={0}
                            max={2}
                            step={0.02}
                            value={ia[r.key]}
                            onChange={(e) => {
                              const next = { ...ia, [r.key]: Number(e.target.value) }
                              updateSelectedImg({
                                adjust: isNeutralAdjust(next) ? undefined : next
                              })
                            }}
                          />
                          <span className="sp-val">{ia[r.key].toFixed(2)}</span>
                        </div>
                      ))}
                      {/* クロップ */}
                      <label className="field-label" style={{ marginTop: 12 }}>
                        クロップ（切り抜き）
                      </label>
                      {(
                        [
                          { key: 'l', label: '左' },
                          { key: 'r', label: '右' },
                          { key: 't', label: '上' },
                          { key: 'b', label: '下' }
                        ] as const
                      ).map((r) => (
                        <div className="sp-row" key={r.key}>
                          <span className="sp-label">{r.label}</span>
                          <input
                            type="range"
                            min={0}
                            max={90}
                            step={1}
                            value={Math.round(ic[r.key] * 100)}
                            onChange={(e) => {
                              const next = { ...ic, [r.key]: Number(e.target.value) / 100 }
                              if (next.l + next.r > 0.95)
                                next[r.key === 'r' ? 'r' : 'l'] = 0.95 - next[r.key === 'r' ? 'l' : 'r']
                              if (next.t + next.b > 0.95)
                                next[r.key === 'b' ? 'b' : 't'] = 0.95 - next[r.key === 'b' ? 't' : 'b']
                              updateSelectedImg({ crop: isNeutralCrop(next) ? undefined : next })
                            }}
                          />
                          <span className="sp-val">{Math.round(ic[r.key] * 100)}%</span>
                        </div>
                      ))}
                      <button
                        className="btn small"
                        style={{ marginTop: 6 }}
                        onClick={() =>
                          updateSelectedImg({
                            zoom: undefined,
                            rotate: undefined,
                            flipH: undefined,
                            flipV: undefined,
                            opacity: undefined,
                            adjust: undefined,
                            crop: undefined
                          })
                        }
                      >
                        変形・調整をリセット
                      </button>
                      <div className="tpl-hint" style={{ marginTop: 8 }}>
                        プレビューの枠をドラッグで拡大/移動、四隅の↻で回転。Delete で削除。
                      </div>
                    </>
                  )
                })()
              ) : (
                <div className="empty">タイムラインでクリップを選択してください</div>
              )}
            </div>
          </section>

          <div className="resizer resizer-v" onPointerDown={(e) => startResize('left', e)} />

          {/* --- 中央: プログラムモニター / オーディオミキサー --- */}
          <section
            className={`panel monitor ${isFloating('preview') ? 'pane-float' : ''}`}
            style={isFloating('preview') ? floatStyle('preview') : { flex: '1 1 0', minWidth: 0 }}
          >
            {isFloating('preview') && floatHead('preview')}
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
                    src を差し替えると要素が一度アンロードされて背景が透ける＝ちらつきの原因になるため。 */}
                {previewSources.map((s) => {
                  const isActive = s.id === effActiveSrcId
                  return (
                    <video
                      key={s.id}
                      ref={(el) => {
                        if (el) {
                          videoElsRef.current.set(s.id, el)
                          if (s.id === effActiveSrcId) videoRef.current = el
                        } else videoElsRef.current.delete(s.id)
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
                        filter: isActive ? curAdjustCss : undefined,
                        ...(isActive ? videoMainStyle : {})
                      }}
                      src={previewUrl(s.path, s.origUrl)}
                      preload="auto"
                      muted={!isActive}
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
                })}
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
                {/* 映像レイヤー（V2以降の動画）。本編映像の上・テロップの下に重ねる。
                    変形/不透明度/色調整/クロップは動画切片と同じモデル。音声もこの要素から鳴る。 */}
                {windowVClips.map((c) => {
                  // 窓には入っているが区間外のクリップは、要素を残したまま非表示にする
                  const local = currentTime - c.tStart
                  const inRange = local >= 0 && local < vcLen(c)
                  return (
                    <video
                      key={`vcv-${c.id}`}
                      ref={vcRefCb(c.id)}
                      className="screen-vclip"
                      // 本編映像と同じプレビュー解像度方針に従う（原本指定なら原本）
                      src={previewUrl(c.path, toGcUrl(c.path))}
                      preload="auto"
                      playsInline
                      style={{
                        transform: vcXform(c),
                        filter: adjustCss(c.adjust),
                        clipPath: cropInset(c.crop),
                        // 👁非表示は「映像だけ消す」（音は鳴り続ける＝V1のvideoBlankと同じ扱い）
                        opacity: !inRange || trackStates[c.track]?.hidden ? 0 : (c.opacity ?? 1),
                        // 区間外・非表示のものはクリックを拾わない（見えていないものを掴まない）
                        pointerEvents:
                          inRange && !trackStates[c.track]?.hidden ? undefined : 'none'
                      }}
                      title={`${c.name}（ドラッグで移動・四隅で拡大）`}
                      onPointerDown={(e) => selectPreviewOverlay(e, { kind: 'vclip', clip: c })}
                    />
                  )
                })}
                {/* 画像クリップ（テロップより下・映像より上）。トラックの👁非表示を尊重。
                    変形（ズーム/回転/反転）・色調整・クロップ・不透明度は動画切片と同じモデル。 */}
                {imgClips
                  .filter(
                    (c) =>
                      currentTime >= c.tStart &&
                      currentTime < c.tStart + c.duration &&
                      !trackStates[c.track]?.hidden
                  )
                  // 上のトラック(V3)が前面に来るよう、トラック順（配列の後ろほど下段）で並べ替える
                  .slice()
                  .sort(
                    (a, b) =>
                      tracks.findIndex((t) => t.id === b.track) -
                      tracks.findIndex((t) => t.id === a.track)
                  )
                  .map((c) => (
                    <img
                      key={`simg-${c.id}`}
                      className="screen-img"
                      src={toGcUrl(c.path)}
                      alt=""
                      title={`${c.name}（ドラッグで移動・四隅で拡大）`}
                      style={{
                        transform: imgXform(c),
                        filter: adjustCss(c.adjust),
                        clipPath: cropInset(c.crop),
                        opacity: c.opacity ?? 1
                      }}
                      // プレビュー上で画像を直接掴めるようにする。以前はここが
                      // pointer-events: none だったため、画面に出ている画像を押しても
                      // クリックが下の動画へ抜けて「動画のパンが始まる」だけだった。
                      onPointerDown={(e) => selectPreviewOverlay(e, { kind: 'img', clip: c })}
                    />
                  ))}
                <div className="telop-overlay">
                  {activeCues
                    .filter((c) => !trackStates[cueTrack(c)]?.hidden) // 行の👁非表示を尊重
                    .map((c) => (
                      <TelopText
                        key={c.id}
                        text={c.text}
                        style={c.style}
                        runs={c.runs}
                        iconImage={iconForCue(c)}
                        ringColor={c.label}
                        iconScale={iconScale}
                        iconAuto={iconAuto}
                        iconSide={iconSide}
                        iconOffsetX={iconOffset.x}
                        iconOffsetY={iconOffset.y}
                        pos={c.pos}
                        scale={c.scale}
                        animT={currentTime - c.start}
                        clipDur={c.end - c.start}
                        selected={isSelected(c.id)}
                        playing={playing}
                        onResizeStart={(e, corner) => onTelopResizeStart(c, e, corner)}
                        onDragOver={(e) => {
                          if (draggingTemplateRef.current || draggingIconRef.current) e.preventDefault()
                        }}
                        onDrop={(e) => {
                          const tpl = draggingTemplateRef.current
                          const iconColor = draggingIconRef.current
                          if (!tpl && !iconColor) return
                          e.preventDefault()
                          e.stopPropagation()
                          if (tpl) applyTemplateToCue(c.id, tpl)
                          else if (iconColor) applyIconToCue(c.id, iconColor)
                        }}
                        onPointerDown={(e) => onTelopPointerDown(c, e)}
                        onDoubleClick={() => {
                          stopPlayback()
                          setSelectedIds([c.id])
                          setEditingId(c.id)
                        }}
                      />
                    ))}
                </div>
                {transOverlay && (
                  <div
                    className="trans-overlay"
                    style={{ background: transOverlay.color, opacity: transOverlay.opacity }}
                  />
                )}
                {/* リフレーム枠（四隅ドラッグ=拡大縮小、本体ドラッグ=移動、ホイール=拡大縮小）。
                    対象は動画切片 or 選択中の画像（reframeTarget） */}
                {(videoSelected ||
                  selectedVideoIds.length > 0 ||
                  selectedImgIds.length === 1 ||
                  selectedVClipIds.length === 1) &&
                  reframeTarget && (
                  <div className="reframe-box">
                    {[0, 1, 2, 3].map((i) => (
                      <div
                        key={i}
                        className={`reframe-handle rh-${i}`}
                        onPointerDown={(e) => onVideoReframeStart(e, i)}
                      />
                    ))}
                    {/* 回転ハンドル: 四隅の少し外側。掴んで回すと現在クリップを回転（Shiftで15°スナップ） */}
                    {[0, 1, 2, 3].map((i) => (
                      <div
                        key={`rot-${i}`}
                        className={`reframe-rot rr-${i}`}
                        title="ドラッグで回転（Shiftで15°）"
                        onPointerDown={onVideoRotateStart}
                      >
                        ↻
                      </div>
                    ))}
                    <div className="reframe-bar" onPointerDown={(e) => e.stopPropagation()}>
                      {/* 何を操作中かを明示（動画 or 画像）＝誤って別の要素を拡大しないように */}
                      <span className="reframe-target" title={reframeTarget.name}>
                        {reframeTarget.kind === 'img' ? '🖼' : '🎬'} {reframeTarget.name}
                        {reframeTarget.kind === 'vclip' ? `（${reframeTarget.track}）` : ''}
                      </span>
                      <span className="reframe-scale">
                        {Math.round(reframeTarget.zoom.scale * 100)}%
                      </span>
                      <button className="reframe-btn" onClick={resetVideoZoom} title="等倍に戻す">
                        リセット
                      </button>
                      <button
                        className="reframe-btn"
                        onClick={() => {
                          setVideoSelected(false)
                          clearSegSel()
                        }}
                        title="リフレームを終了"
                      >
                        ✓ 完了
                      </button>
                    </div>
                  </div>
                )}
                {!videoSrc && !activeCues.length && (
                  <div className="screen-empty">プレビュー</div>
                )}
                {proxyPct != null && (
                  <div className="proxy-badge" title="編集用プレビューを最適化中（書き出しは原本フル画質）">
                    ⚙ プレビュー最適化中… {proxyPct}%
                  </div>
                )}
                {editingId != null &&
                  activeCues.some((c) => c.id === editingId) &&
                  (() => {
                    const ec = cues.find((c) => c.id === editingId)!
                    const trackSel = (el: HTMLTextAreaElement): void =>
                      setEditorSel({ start: el.selectionStart, end: el.selectionEnd })
                    return (
                      <div className="telop-editor" onPointerDown={(e) => e.stopPropagation()}>
                        <textarea
                          className="telop-editor-text"
                          ref={editorTextRef}
                          autoFocus
                          value={ec.text}
                          rows={Math.max(1, ec.text.split('\n').length)}
                          onChange={(e) => {
                            updateCueText(ec.id, e.target.value)
                            trackSel(e.currentTarget)
                          }}
                          onSelect={(e) => trackSel(e.currentTarget)}
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') setEditingId(null)
                          }}
                        />
                        <div className="telop-editor-tools">
                          <span className="te-label">
                            文字を選択 → 左パネルの色/フォント/サイズで“その文字だけ”変更
                          </span>
                          <button
                            className="te-btn"
                            title="選択文字の部分装飾をクリア"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => clearRunsInSelection(ec.id)}
                          >
                            選択の装飾クリア
                          </button>
                          <button className="te-btn te-done" onClick={() => setEditingId(null)}>
                            完了
                          </button>
                        </div>
                      </div>
                    )
                  })()}
              </div>
            </div>

            {/* オーディオトラックミキサー */}
            {monitorTab === 'mixer' && (
              <div className="mixer-stage">
                <div className="mixer">
                  {tracks.filter((t) => t.kind === 'audio').map((tr) => {
                    const st = trackStates[tr.id] ?? newTrackState(tr.id)
                    const g = st?.volume ?? 1
                    return (
                      <div className="mix-ch" key={tr.id}>
                        <div className="mix-ms">
                          <button
                            className={`mix-msbtn ${st?.muted ? 'mix-mute' : ''}`}
                            title="ミュート"
                            onClick={() => toggleTrack(tr.id, 'muted')}
                          >
                            M
                          </button>
                          <button
                            className={`mix-msbtn ${st?.solo ? 'mix-solo' : ''}`}
                            title="ソロ"
                            onClick={() => toggleTrack(tr.id, 'solo')}
                          >
                            S
                          </button>
                        </div>
                        <div
                          className="mix-fader"
                          onPointerDown={(e) => startFader(e, (f) => setTrackVolume(tr.id, f))}
                        >
                          <div className="mix-fill" style={{ height: `${g * 100}%` }} />
                          <div className="mix-knob" style={{ bottom: `${g * 100}%` }} />
                        </div>
                        <div className="mix-db">{gainToDb(g)} dB</div>
                        <div className="mix-name">{tr.name}</div>
                      </div>
                    )
                  })}
                  {/* マスター */}
                  <div className="mix-ch mix-master">
                    <div className="mix-ms" />
                    <div
                      className="mix-fader"
                      onPointerDown={(e) => startFader(e, (f) => setMasterVolume(clamp(f, 0, 1)))}
                    >
                      <div className="mix-fill" style={{ height: `${masterVolume * 100}%` }} />
                      <div className="mix-knob" style={{ bottom: `${masterVolume * 100}%` }} />
                    </div>
                    <div className="mix-db">{gainToDb(masterVolume)} dB</div>
                    <div className="mix-name">マスター</div>
                  </div>
                </div>
              </div>
            )}
            {/* 全体のどこを見ているかを示すバー（プレミアと同じ役割）。
                タイムラインを見に行かなくても位置が分かり、押した所へ飛べる。 */}
            <div
              className="preview-scrub"
              onPointerDown={(e) => {
                if (e.button !== 0) return
                e.preventDefault()
                // 位置は「バー本体」で測る。外枠には左右の余白があるので、
                // 外枠で測るとつまみが余白ぶん右へずれる（押した所と合わなくなる）。
                const track = e.currentTarget.querySelector('.preview-scrub-track')
                const rect = (track ?? e.currentTarget).getBoundingClientRect()
                const total = Math.max(0.001, duration)
                const seekAt = (cx: number): void => {
                  seekTo(clamp(((cx - rect.left) / rect.width) * total, 0, total))
                }
                stopPlayback()
                seekAt(e.clientX)
                const mv = (ev: PointerEvent): void => seekAt(ev.clientX)
                const up = (): void => {
                  window.removeEventListener('pointermove', mv)
                  window.removeEventListener('pointerup', up)
                }
                window.addEventListener('pointermove', mv)
                window.addEventListener('pointerup', up)
              }}
              title="押した所へ飛びます（掴んだまま動かすと早送り・巻き戻し）"
            >
              <div className="preview-scrub-track">
                {/* 頭と尻は長めの印にする。どこが始まりでどこが終わりか一目で分かる */}
                <span className="preview-scrub-edge preview-scrub-edge-l" />
                <span className="preview-scrub-edge preview-scrub-edge-r" />
                {/* だいたいの位置をつかむための目盛り */}
                {Array.from({ length: 9 }, (_, i) => (
                  <span key={i} className="preview-scrub-tick" style={{ left: `${(i + 1) * 10}%` }} />
                ))}
                {/* 再生位置。塗りつぶしはせず、つまみだけ出す */}
                <div
                  className="preview-scrub-head"
                  style={{
                    left: `${clamp((currentTime / Math.max(0.001, duration)) * 100, 0, 100)}%`
                  }}
                />
              </div>
            </div>
            {/* プレビューの下は2段に分ける（プレミアと同じ考え方）。
                1段目＝いま何秒か・どの画質か といった「状態」。
                2段目＝再生などの「操作」で、再生ボタンを中央に置く。
                1段に詰め込むと、一番よく使う再生ボタンが端に寄って毎回探すことになる。 */}
            <div className="transport">
              <div className="transport-info">
                <span className="tc tc-cur">{formatTimecode(currentTime, fps)}</span>
                <div className="transport-info-right">{transportInfo}</div>
              </div>
              <div className="transport-btns">
                <button className="tbtn" onClick={() => skipSec(-10)} title="10秒戻る">
                  «10
                </button>
                <button className="tbtn" onClick={() => skipSec(-5)} title="5秒戻る">
                  «5
                </button>
                <button className="tbtn" onClick={() => stepFrame(-1)} title={`1フレーム戻る (${formatCombo(shortcuts.frameBack)})`}>
                  ◁ǀ
                </button>
                <button className="tbtn tbtn-play" onClick={togglePlay} title={`再生 / 一時停止 (${formatCombo(shortcuts.playPause)})`}>
                  {playing ? '⏸' : '▶'}
                </button>
                <button className="tbtn" onClick={() => stepFrame(1)} title={`1フレーム進む (${formatCombo(shortcuts.frameFwd)})`}>
                  ǀ▷
                </button>
                <button className="tbtn" onClick={() => skipSec(5)} title="5秒進む">
                  5»
                </button>
                <button className="tbtn" onClick={() => skipSec(10)} title="10秒進む">
                  10»
                </button>
                <button
                  className="tbtn tbtn-shot"
                  onClick={() => void captureScreenshot()}
                  title="今のプレビュー画面を画像で保存"
                >
                  📷
                </button>
                <button className="tbtn" onClick={() => jumpMarker(-1)} title="前のマーカーへ">
                  ⟨🚩
                </button>
                <button
                  className="tbtn tbtn-marker"
                  onClick={addMarkerAtPlayhead}
                  title={`再生ヘッド位置にマーカーを追加 (${formatCombo(shortcuts.addMarker)})`}
                >
                  🚩＋
                </button>
                <button className="tbtn" onClick={() => jumpMarker(1)} title="次のマーカーへ">
                  🚩⟩
                </button>
              </div>
            </div>
          </section>

          <div className="resizer resizer-v" onPointerDown={(e) => startResize('right', e)} />

          {/* --- 右: プロジェクト --- */}
          <section
            className={`panel ${isFloating('right') ? 'pane-float' : ''}`}
            style={isFloating('right') ? floatStyle('right') : { width: rightW, flex: '0 0 auto' }}
          >
            {isFloating('right') && floatHead('right')}
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
            {rightTab === 'project' && (
            <div className="panel-body" ref={rightBodyRef} onDoubleClick={addFilesToProject}>
              <div className="bin-toolbar">
                <button className="btn small" onClick={addFilesToProject} title="ファイルを追加">
                  ＋ ファイル追加
                </button>
                <button className="btn small" onClick={addFolderToProject} title="フォルダごと追加（SE等）">
                  📂 フォルダから一括追加
                </button>
                <button className="btn small" onClick={handleImportSrt} title="SRT（テロップ）を読み込む">
                  🗒 SRT
                </button>
              </div>

              {/* メディアライブラリ（アイコン/サムネ表示） */}
              {mediaItems.length === 0 ? (
                <div className="empty">
                  ダブルクリックでファイル追加
                  <br />
                  📁ボタンでフォルダ丸ごと追加（SE等）
                </div>
              ) : (
                <div className="media-lib">
                  {(['video', 'audio', 'image'] as const).map((kind) => {
                    const items = mediaItems.filter((m) => m.kind === kind)
                    if (!items.length) return null
                    const label = kind === 'video' ? '動画' : kind === 'audio' ? 'SE / 音声' : '画像'
                    const ico = kind === 'video' ? '🎬' : kind === 'audio' ? '🔊' : '🖼'
                    return accSec(
                      'project',
                      kind,
                      `${ico} ${label}`,
                      items.length,
                      <div className="media-grid">
                          {items.map((m) => (
                            <div
                              key={m.id}
                              className={`media-card ${m.path === videoPath ? 'media-active' : ''} ${selectedMediaId === m.id ? 'media-sel' : ''}`}
                              title={
                                m.kind === 'video'
                                  ? 'タイムラインへドラッグ=置いた位置に配置（Ctrl=挿入）/ ダブルクリック=読み込み'
                                  : m.kind === 'audio'
                                    ? 'タイムラインにドラッグでSE/BGM配置'
                                    : 'タイムラインの映像トラック(V2/V3)へドラッグで画像を配置'
                              }
                              draggable={true}
                              onDragStart={(e) => beginMediaDrag(m, e)}
                              onDragEnd={() => {
                                draggingMediaRef.current = null
                                setSeGhost(null)
                                setVideoGhost(null)
                                setImgGhost(null)
                              }}
                              onClick={(e) => {
                                e.stopPropagation()
                                setSelectedMediaId(m.id)
                              }}
                              onDoubleClick={(e) => {
                                e.stopPropagation()
                                if (m.kind !== 'video') return
                                // 何も読み込んでいなければ読み込む。既に編集中なら
                                // タイムラインを壊さない（ダブルクリックで全消しは事故になる）。
                                if (!videoPath) void loadVideo(m.path)
                                else
                                  showToast(
                                    'タイムラインへドラッグして配置してください（Ctrl+ドロップで挿入）。'
                                  )
                              }}
                            >
                              <button
                                className="media-del"
                                title="プロジェクトから削除"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  removeMedia(m.id)
                                }}
                              >
                                ✕
                              </button>
                              <div className="media-thumb">
                                {m.thumb ? (
                                  <img src={m.thumb} alt="" />
                                ) : (
                                  <span className="media-thumb-ico">{ico}</span>
                                )}
                              </div>
                              <div className="media-card-name">{m.name}</div>
                              {m.folder && <div className="media-card-sub">📁 {m.folder}</div>}
                            </div>
                          ))}
                        </div>
                    )
                  })}
                </div>
              )}

              {srtPath && (
                <div className="bin" style={{ marginTop: 8 }}>
                  <div className="bin-row">
                    <span className="bin-ico">🗒</span>
                    <span className="bin-name">{srtPath.split(/[\\/]/).pop()}</span>
                    <span className="bin-meta">{cues.length}項目</span>
                  </div>
                </div>
              )}

              {/* カラーラベル */}
              {labelGroups.length > 0 && (
                <div className="label-groups">
                  <div className="lg-head">カラーラベル（クリックでまとめて選択）</div>
                  {labelGroups.map((g) => (
                    <div
                      key={g.color}
                      className="lg-row"
                      onClick={() => selectByLabel(g.color)}
                      title={`${g.name} を全て選択`}
                    >
                      <span className="lg-swatch" style={{ background: g.color }} />
                      <span className="lg-name">{g.name}</span>
                      <span className="lg-count">{g.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            )}

            {/* --- テロップテンプレ --- */}
            {rightTab === 'telop' && (
              <div className="panel-body" ref={rightBodyRef}>
                <div className="tpl-hint">
                  {selectedIds.length
                    ? 'クリックで選択中のテロップに適用'
                    : 'クリックで「次に足すテロップ」の既定スタイルに設定'}
                </div>
                <div className="bin-toolbar">
                  <button className="btn small" onClick={saveCurrentAsTemplate}>
                    ＋ 現在のスタイルを保存
                  </button>
                  <button className="btn small" title="新しいフォルダ（カテゴリ）を作成" onClick={addCustomCat}>
                    📁＋ フォルダ作成
                  </button>
                  <button
                    className="btn small"
                    title="geba.json を再読み込み（再起動不要）"
                    style={{ marginLeft: 'auto' }}
                    onClick={refreshPresets}
                  >
                    ↻ 更新
                  </button>
                </div>
                {/* アコーディオン（1つだけ展開・既定は全閉）。★お気に入り→マイ→プリセット→色カテゴリ */}
                {(() => {
                  const favs = [...userTemplates, ...BUILTIN_TEMPLATES, ...localTemplates].filter((t) =>
                    isFav(t.name)
                  )
                  const cardsOf = (
                    list: TelopTemplate[],
                    keyPfx: string,
                    withDel = false,
                    withCat = false
                  ): JSX.Element[] =>
                    list.map((t, i) => (
                      <TemplateCard
                        key={keyPfx + i}
                        tpl={t}
                        onApply={() => applyTemplate(t.style)}
                        onDelete={withDel ? () => deleteUserTemplate(i) : undefined}
                        fav={isFav(t.name)}
                        onToggleFav={() => toggleFav(t.name)}
                        curCat={withCat ? catOf(t) : undefined}
                        onSetCat={withCat ? (cat) => setTplCat(t.name, cat) : undefined}
                        catOptions={allCats}
                        onContextMenu={
                          withCat
                            ? (e) => {
                                e.preventDefault()
                                e.stopPropagation()
                                setTplMenu({
                                  x: e.clientX,
                                  y: e.clientY,
                                  name: t.name,
                                  curCat: catOf(t)
                                })
                              }
                            : undefined
                        }
                        onDragStartTpl={() => (draggingTemplateRef.current = t.style)}
                        onDragEndTpl={() => (draggingTemplateRef.current = null)}
                      />
                    ))
                  const secs: {
                    key: string
                    label: string
                    cards: JSX.Element[]
                    custom?: boolean
                  }[] = []
                  if (favs.length) secs.push({ key: 'fav', label: '★ お気に入り', cards: cardsOf(favs, 'f') })
                  if (userTemplates.length)
                    secs.push({ key: 'user', label: 'マイテンプレート', cards: cardsOf(userTemplates, 'u', true) })
                  secs.push({ key: 'builtin', label: 'プリセット', cards: cardsOf(BUILTIN_TEMPLATES, 'b') })
                  // 色4カテゴリ（中身がある時のみ）＋ ユーザー作成フォルダ（空でも表示）
                  for (const c of allCats) {
                    const items = localTemplates.filter((t) => catOf(t) === c.key)
                    const isCustom = customCats.some((cc) => cc.key === c.key)
                    if (items.length || isCustom)
                      secs.push({
                        key: c.key,
                        label: c.label,
                        cards: cardsOf(items, c.key, false, true),
                        custom: isCustom
                      })
                  }
                  return secs.map((s) => (
                    <div key={s.key} ref={(el) => (tplSecRefs.current[s.key] = el)}>
                      <button
                        className={`tpl-acc ${openTplSec === s.key ? 'open' : ''}`}
                        onClick={() => toggleTplSec(s.key)}
                      >
                        <span className="tpl-acc-ar">{openTplSec === s.key ? '▼' : '▶'}</span>
                        {s.custom ? '📁 ' : ''}
                        {s.label}（{s.cards.length}）
                        {s.custom && (
                          <span
                            className="tpl-acc-del"
                            title="フォルダを削除（中のテロップは元カテゴリへ戻る）"
                            onClick={(e) => {
                              e.stopPropagation()
                              deleteCustomCat(s.key)
                            }}
                          >
                            ✕
                          </span>
                        )}
                      </button>
                      {openTplSec === s.key &&
                        (s.cards.length ? (
                          <div className="tpl-grid">{s.cards}</div>
                        ) : (
                          <div className="tpl-hint" style={{ padding: '6px 2px' }}>
                            空のフォルダです。テロップを右クリック→このフォルダを選ぶと入ります。
                          </div>
                        ))}
                    </div>
                  ))
                })()}
              </div>
            )}

            {/* --- アイコン（画像置き場）--- */}
            {rightTab === 'icon' && (
              <div className="panel-body" ref={rightBodyRef}>
                <div className="bin-toolbar">
                  <button className="btn small" onClick={addIconImages} title="画像を追加">
                    ＋ 画像追加
                  </button>
                  <button className="btn small" title="新しいフォルダを作成" onClick={addIconFolder}>
                    📁＋ フォルダ作成
                  </button>
                </div>
                <div className="tpl-hint">
                  テロップにドラッグ＆ドロップで前にアイコン表示。右クリックでフォルダ移動。
                </div>
                {iconLibrary.length === 0 ? (
                  <div className="empty">
                    ＋画像追加で
                    <br />
                    アイコン画像を登録
                  </div>
                ) : (
                  (() => {
                    // 実効フォルダ（移動先が消えていたら既定の置き場へ）
                    const effIcon = (id: number): string => {
                      const ov = iconOv[String(id)]
                      return ov && iconFolders.some((f) => f.key === ov) ? ov : 'lib'
                    }
                    const iconCard = (it: { id: number; name: string; image: string }): JSX.Element => (
                      <div
                        key={it.id}
                        className="icon-item"
                        title={it.name + ' — テロップにドラッグ / クリックで選択テロップに適用 / 右クリックでフォルダ移動'}
                        draggable
                        onDragStart={() => (draggingIconRef.current = it.image)}
                        onDragEnd={() => (draggingIconRef.current = null)}
                        onClick={() => {
                          if (selectedIds.length)
                            setCues((prev) =>
                              prev.map((c) =>
                                isSelected(c.id)
                                  ? { ...c, iconImage: it.image, personIcon: undefined }
                                  : c
                              )
                            )
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          const cur = effIcon(it.id)
                          const dests = [
                            { key: 'lib', label: 'アイコン画像', custom: false },
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
                                  setIconFolderOf(String(it.id), d.key === 'lib' ? null : d.key)
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
                      >
                        <button
                          className={`icon-fav ${iconFavs.includes(String(it.id)) ? 'on' : ''}`}
                          title="お気に入り"
                          onClick={(e) => {
                            e.stopPropagation()
                            toggleIconFav(String(it.id))
                          }}
                        >
                          {iconFavs.includes(String(it.id)) ? '★' : '☆'}
                        </button>
                        <button
                          className="icon-del"
                          title="ライブラリから削除"
                          onClick={(e) => {
                            e.stopPropagation()
                            removeIconImage(it.id)
                          }}
                        >
                          ✕
                        </button>
                        <img src={it.image} alt="" />
                      </div>
                    )
                    const favList = iconLibrary.filter((it) => iconFavs.includes(String(it.id)))
                    const libList = iconLibrary.filter((it) => effIcon(it.id) === 'lib')
                    return (
                      <>
                        {favList.length > 0 &&
                          accSec(
                            'icon',
                            'fav',
                            '★ お気に入り',
                            favList.length,
                            <div className="icon-grid">{favList.map(iconCard)}</div>
                          )}
                        {iconFolders.map((f) => {
                          const list = iconLibrary.filter((it) => effIcon(it.id) === f.key)
                          return accSec(
                            'icon',
                            f.key,
                            `📁 ${f.label}`,
                            list.length,
                            list.length ? (
                              <div className="icon-grid">{list.map(iconCard)}</div>
                            ) : (
                              <div className="tpl-hint" style={{ padding: '6px 2px' }}>
                                空のフォルダです。アイコンを右クリック→このフォルダを選ぶと入ります。
                              </div>
                            ),
                            () => deleteIconFolder(f.key)
                          )
                        })}
                        {libList.length > 0 &&
                          accSec(
                            'icon',
                            'lib',
                            '🖼 アイコン画像',
                            libList.length,
                            <div className="icon-grid">{libList.map(iconCard)}</div>
                          )}
                      </>
                    )
                  })()
                )}
              </div>
            )}

            {/* --- エフェクト（テロップアニメのプリセット）--- */}
            {rightTab === 'se' && (
              <div className="panel-body" ref={rightBodyRef}>
                <div className="bin-toolbar">
                  <button className="btn small" title="新しいフォルダを作成" onClick={addSeFolder}>
                    📁＋ フォルダ作成
                  </button>
                  <button
                    className="btn small"
                    title="GiftCut/SE フォルダを再読み込み"
                    style={{ marginLeft: 'auto' }}
                    onClick={refreshSE}
                  >
                    ↻ 更新
                  </button>
                </div>
                {seLibrary.length === 0 ? (
                  <div className="empty">
                    SEが見つかりません。
                    <br />
                    GiftCut/SE フォルダに mp3 を入れてください。
                  </div>
                ) : (
                  (() => {
                    const seCats = Array.from(new Set(seLibrary.map((s) => s.category)))
                    // 実効フォルダ（移動先が消えていたら元カテゴリへ）
                    const effSe = (s: { category: string; path: string }): string => {
                      const ov = seOv[s.path]
                      return ov && (seFolders.some((f) => f.key === ov) || seCats.includes(ov))
                        ? ov
                        : s.category
                    }
                    const seRow = (s: { category: string; name: string; path: string }): JSX.Element => (
                      <div
                        key={s.path}
                        className="se-item"
                        draggable
                        onDragStart={(e) =>
                          beginMediaDrag({ id: -1, path: s.path, name: s.name, kind: 'audio' }, e)
                        }
                        onDragEnd={() => {
                          draggingMediaRef.current = null
                          setSeGhost(null)
                        }}
                        onClick={() => previewSE(s.path)}
                        onContextMenu={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          const cur = effSe(s)
                          const dests = [
                            ...seCats.map((c) => ({ key: c, label: c, custom: false })),
                            ...seFolders.map((f) => ({ key: f.key, label: f.label, custom: true }))
                          ]
                          setOrgMenu({
                            x: e.clientX,
                            y: e.clientY,
                            options: [
                              ...dests.map((d) => ({
                                label: `${cur === d.key ? '✓ ' : ''}${d.custom ? '📁 ' : ''}${d.label}`,
                                checked: cur === d.key,
                                act: () => setSeFolderOf(s.path, d.key === s.category ? null : d.key)
                              })),
                              {
                                label: seFavs.includes(s.path)
                                  ? '★ お気に入り解除'
                                  : '☆ お気に入りに追加',
                                act: () => toggleSeFav(s.path)
                              }
                            ]
                          })
                        }}
                        title="ドラッグでタイムラインに配置 / クリックで試聴 / 右クリックでフォルダ移動"
                      >
                        <span className="se-play">🔊</span>
                        <span className="se-name">{s.name}</span>
                        <button
                          className={`item-fav ${seFavs.includes(s.path) ? 'on' : ''}`}
                          title="お気に入り"
                          onClick={(e) => {
                            e.stopPropagation()
                            toggleSeFav(s.path)
                          }}
                        >
                          {seFavs.includes(s.path) ? '★' : '☆'}
                        </button>
                      </div>
                    )
                    const favList = seLibrary.filter((s) => seFavs.includes(s.path))
                    return (
                      <>
                        <div className="tpl-hint">
                          タイムラインへドラッグで配置 / クリックで試聴 / 右クリックでフォルダ移動
                        </div>
                        {favList.length > 0 &&
                          accSec(
                            'se',
                            'fav',
                            '★ お気に入り',
                            favList.length,
                            <div className="se-list">{favList.map(seRow)}</div>
                          )}
                        {seFolders.map((f) => {
                          const list = seLibrary.filter((s) => effSe(s) === f.key)
                          return accSec(
                            'se',
                            f.key,
                            `📁 ${f.label}`,
                            list.length,
                            list.length ? (
                              <div className="se-list">{list.map(seRow)}</div>
                            ) : (
                              <div className="tpl-hint" style={{ padding: '6px 2px' }}>
                                空のフォルダです。SEを右クリック→このフォルダを選ぶと入ります。
                              </div>
                            ),
                            () => deleteSeFolder(f.key)
                          )
                        })}
                        {seCats.map((cat) => {
                          const list = seLibrary.filter((s) => effSe(s) === cat)
                          if (!list.length) return null
                          return accSec(
                            'se',
                            cat,
                            `📁 ${cat}`,
                            list.length,
                            <div className="se-list">{list.map(seRow)}</div>
                          )
                        })}
                      </>
                    )
                  })()
                )}
              </div>
            )}

            {/* --- トランジション（動画クリップ＝頭/尻フェード ＋ テロップ＝出入りの動き）--- */}
            {rightTab === 'transition' && (
              <div className="panel-body" ref={rightBodyRef}>
                {/* タイムラインでトランジション枠を選択中 → そのトランジションだけを編集/削除 */}
                {selectedTrans &&
                  (() => {
                    const seg = segments.find((s) => s.id === selectedTrans.segId)
                    const t =
                      selectedTrans.kind === 'xfade'
                        ? seg?.xfade
                        : selectedTrans.kind === 'in'
                          ? seg?.transIn
                          : seg?.transOut
                    if (!seg || !t) return null
                    const place =
                      selectedTrans.kind === 'xfade'
                        ? '間（クリップ同士）'
                        : selectedTrans.kind === 'in'
                          ? '頭（クリップ開始）'
                          : '尻（クリップ終わり）'
                    return (
                      <div className="sel-trans">
                        <div className="sel-trans-head">
                          <span className="sel-trans-title">🎯 {place}</span>
                          <button
                            className="btn small danger"
                            onClick={deleteSelectedTrans}
                            title="このトランジションを削除（Delete）"
                          >
                            削除
                          </button>
                        </div>
                        <div className="sp-row">
                          <span className="sp-label">種類</span>
                          <div className="seg seg-wrap">
                            {TRANS_TYPES.map((x) => (
                              <button
                                key={x.type}
                                className={`seg-btn ${t.type === x.type ? 'seg-on' : ''}`}
                                onClick={() => setSelectedTransType(x.type)}
                                title={x.label}
                              >
                                {x.ico}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="sp-row">
                          <span className="sp-label">長さ</span>
                          <input
                            type="range"
                            min={0.05}
                            max={2}
                            step={0.05}
                            value={t.dur}
                            onChange={(e) => updateSelectedTransDur(Number(e.target.value))}
                          />
                          <span className="sp-val">{t.dur.toFixed(2)}s</span>
                        </div>
                        <button className="btn small" onClick={() => setSelectedTrans(null)}>
                          選択を解除
                        </button>
                        <div className="tpl-divider" />
                      </div>
                    )
                  })()}
                {/* タイムラインでテロップの出入り帯を選択中 → そのアニメだけ編集/削除（動画と同じ仕組み） */}
                {selectedTelopTrans &&
                  (() => {
                    const cue = cues.find((c) => c.id === selectedTelopTrans.cueId)
                    const anim = cue?.style.anim
                    if (!cue || !anim) return null
                    const isIn = selectedTelopTrans.kind === 'in'
                    const type = isIn ? anim.in : anim.out
                    const dur = isIn ? anim.inDur : anim.outDur
                    return (
                      <div className="sel-trans">
                        <div className="sel-trans-head">
                          <span className="sel-trans-title">
                            💬 テロップ {isIn ? '頭（出現）' : '尻（消失）'}
                          </span>
                          <button
                            className="btn small danger"
                            onClick={deleteSelectedTelopTrans}
                            title="このアニメを削除（Delete）"
                          >
                            削除
                          </button>
                        </div>
                        <div className="sp-row">
                          <span className="sp-label">種類</span>
                          <div className="seg seg-wrap">
                            {TELOP_MOTIONS.map((m) => (
                              <button
                                key={m.type}
                                className={`seg-btn ${type === m.type ? 'seg-on' : ''}`}
                                onClick={() => setTelopTransType(m.type)}
                                title={m.label}
                              >
                                {m.ico}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="sp-row">
                          <span className="sp-label">長さ</span>
                          <input
                            type="range"
                            min={0.05}
                            max={2}
                            step={0.05}
                            value={dur}
                            onChange={(e) => updateTelopTransDur(Number(e.target.value))}
                          />
                          <span className="sp-val">{dur.toFixed(2)}s</span>
                        </div>
                        <button className="btn small" onClick={() => setSelectedTelopTrans(null)}>
                          選択を解除
                        </button>
                        <div className="tpl-divider" />
                      </div>
                    )
                  })()}
                {!selectedTrans && !selectedTelopTrans && (
                  <div className="tpl-hint">
                    下のトランジションを<b>タイムラインへドラッグ</b>。落とす<b>マウス位置</b>で置き場所が決まります。
                    置いた<b>帯をクリック</b>で長さ・種類の変更／削除、<b>帯の端をドラッグ</b>で長さ変更。
                  </div>
                )}
                <div className="sp-row">
                  <span className="sp-label">新規の長さ</span>
                  <input
                    type="range"
                    min={0.05}
                    max={2}
                    step={0.05}
                    value={transDur}
                    onChange={(e) => setTransDur(Number(e.target.value))}
                  />
                  <span className="sp-val">{transDur.toFixed(2)}s</span>
                </div>
                {accSec(
                  'transition',
                  'video',
                  '🎬 動画クリップ',
                  null,
                  <>
                    <div className="tpl-hint">
                      どの種類も<b>頭・間・尻のどこにでも</b>置けます。
                      <b>カットの境目＝間</b>／クリップ本体の<b>前半＝頭・後半＝尻</b>。
                    </div>
                    <div className="fx-list">
                      {TRANS_TYPES.map((x) => (
                        <button
                          key={x.type}
                          className="fx-item fx-draggable"
                          draggable
                          onDragStart={(e) => {
                            draggingTransRef.current = { type: x.type }
                            setDragChip(e, x.ico, x.label)
                          }}
                          onDragEnd={() => {
                            draggingTransRef.current = null
                            setTransDrop(null)
                          }}
                          title={`${x.label}。クリップの頭/間/尻へドラッグ`}
                        >
                          <span className="fx-ico">{x.ico}</span>
                          <span className="fx-name">{x.label}</span>
                          <span className="fx-drag-hint">⠿</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
                {accSec(
                  'transition',
                  'telop',
                  '💬 テロップ',
                  null,
                  <>
                    <div className="tpl-hint">
                      テロップの<b>頭＝出現 / 尻＝消失 / 間＝隣のテロップとの切替</b>。
                    </div>
                    <div className="fx-list">
                      {TELOP_MOTIONS.map((m) => (
                        <button
                          key={m.type}
                          className="fx-item fx-draggable"
                          draggable
                          onDragStart={(e) => {
                            draggingTelopAnimRef.current = { type: m.type }
                            setDragChip(e, m.ico, m.label)
                          }}
                          onDragEnd={() => {
                            draggingTelopAnimRef.current = null
                            setTelopDrop(null)
                          }}
                          title={`${m.label}。テロップの頭/尻/間へドラッグ`}
                        >
                          <span className="fx-ico">{m.ico}</span>
                          <span className="fx-name">{m.label}</span>
                          <span className="fx-drag-hint">⠿</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
                {accSec(
                  'transition',
                  'effect',
                  '✨ エフェクト（テロップ強調）',
                  null,
                  <>
                    <div className="tpl-hint">
                      選択中のテロップに<b>クリックでON/OFF</b>（クリップ全体にかかる動き）。
                    </div>
                    <div className="fx-list">
                      <button className="fx-item" onClick={() => toggleTelopEmphasis('shake')}>
                        <span className="fx-ico">〰️</span>
                        <span className="fx-name">揺れ</span>
                      </button>
                      <button className="fx-item" onClick={() => toggleTelopEmphasis('pulse')}>
                        <span className="fx-ico">❤️</span>
                        <span className="fx-name">脈動</span>
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </section>
        </div>

        <div className="resizer resizer-h" onPointerDown={(e) => startResize('timeline', e)} />

        {/* ===== タイムライン ===== */}
        <section
          className={`timeline ${isFloating('timeline') ? 'pane-float' : ''}`}
          style={
            isFloating('timeline') ? floatStyle('timeline') : { height: timelineH, flex: '0 0 auto' }
          }
        >
          {isFloating('timeline') && floatHead('timeline')}
          <div className="tl-toolbar">
            <button
              className={`tool ${tool === 'select' ? 'tool-on' : ''}`}
              title={`選択ツール (${formatCombo(shortcuts.toolSelect)})`}
              onClick={() => setTool('select')}
            >
              ▤
            </button>
            <button
              className={`tool ${tool === 'razor' ? 'tool-on' : ''}`}
              title={`レザー / カット (${formatCombo(shortcuts.toolRazor)})`}
              onClick={() => setTool('razor')}
            >
              ✂
            </button>
            <button
              className={`tool ${snap ? 'tool-on' : ''}`}
              title={`スナップ (${formatCombo(shortcuts.toggleSnap)})`}
              onClick={toggleSnap}
            >
              🧲
            </button>
            <button
              className={`tool ${tool === 'trackBack' ? 'tool-on' : ''}`}
              title="トラック選択（左）: クリック位置から左を全選択 / Shiftでそのレーンだけ"
              onClick={() => setTool(tool === 'trackBack' ? 'select' : 'trackBack')}
            >
              ⇤
            </button>
            <button
              className={`tool ${tool === 'trackFwd' ? 'tool-on' : ''}`}
              title="トラック選択（右）: クリック位置から右を全選択 / Shiftでそのレーンだけ"
              onClick={() => setTool(tool === 'trackFwd' ? 'select' : 'trackFwd')}
            >
              ⇥
            </button>
            <span className="tl-sep" />
            <button
              className="tool"
              title={`元に戻す (${formatCombo(shortcuts.undo)})`}
              onClick={undo}
              disabled={undoStackRef.current.length === 0 && !isDirty()}
            >
              ↶
            </button>
            <button
              className="tool"
              title={`やり直す (${formatCombo(shortcuts.redo)})`}
              onClick={redo}
              disabled={redoStackRef.current.length === 0}
            >
              ↷
            </button>
            <button
              className="tool"
              title={`再生ヘッドで分割 (${formatCombo(shortcuts.split)})`}
              onClick={() => {
                splitVideoAtPlayhead()
                splitAtPlayhead('all')
              }}
            >
              ⎇
            </button>
            <div className="tl-zoom">
              <button
                className="tool tool-sm"
                title="タイムライン全体を表示（フィット）"
                onClick={() => {
                  fitTimelineZoom()
                }}
              >
                ↔
              </button>
              <span>拡大</span>
              <input
                type="range"
                min={6}
                max={120}
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                title="タイムラインの拡大率（Ctrl+ホイールでも操作可）"
              />
            </div>
            <span className="tl-hint">
              {tool === 'razor'
                ? 'クリップをクリックで分割'
                : videoGhost?.moving
                  ? 'ドラッグで移動 / Alt=複製 / Ctrl=割り込み（後続が後ろへずれる）'
                  : videoGhost
                    ? 'ドロップで上書き配置 / Ctrl押しながらで挿入（後続がシフト）'
                  : `${formatCombo(shortcuts.undo)} 元に戻す / ${formatCombo(shortcuts.copy)}・${formatCombo(shortcuts.paste)} コピー貼付 / ${formatCombo(shortcuts.duplicate)} 複製 / ${formatCombo(shortcuts.split)} 分割 / ${formatCombo(shortcuts.addMarker)} マーカー`}
            </span>
          </div>

          <div className="tl-body">
            {/* 左端のトラック高さ調整バー（丸グリップ2個：映像グループ／音声グループ）*/}
            <div className="tl-resize-gutter">
              {groupGrips.map((g) => (
                <div
                  key={g.kind}
                  className="tl-grip"
                  style={{ top: g.y }}
                  title={g.kind === 'video' ? '映像レーンの高さを調整' : '音声レーンの高さを調整'}
                  onPointerDown={(e) => startGroupResize(g.kind, e)}
                >
                  <span className="tl-grip-knob" />
                </div>
              ))}
            </div>

            {/* トラックヘッダ */}
            <div className="track-headers">
              <div className="th-spacer">
                <button className="th-add" title="映像トラックを追加" onClick={addVideoTrack}>
                  ＋
                </button>
              </div>
              {/* トラック側と同じ余白。ここがずれると、押した段と実際の段が食い違う */}
              <div className="track-pad" style={{ height: padTop }} />
              {tracks.map((tr) => {
                // 状態が無いトラックがあっても落ちないようにする。
                // トラックを足したのに状態を作り忘れると、ここで画面全体が落ちる。
                const st = trackStates[tr.id] ?? newTrackState(tr.id)
                return (
                  <div
                    key={tr.id}
                    className={`th th-${tr.kind} ${selectedTrackId === tr.id ? 'th-selected' : ''}`}
                    style={{ height: trackHOf(tr.kind) }}
                    onClick={() => selectTrack(tr.id)}
                    title="クリックでトラック選択（Deleteで削除）"
                  >
                    {/* 以前はここが「ターゲット切替」だったが、target はどこからも
                        参照されない死んだフラグで、ヘッダー内で一番強い色（既定で
                        V1/A1 が青く光る）が何の意味も持たない状態だった。しかも
                        名前クリックがそれに占領されてリネームができなかった。
                        クリック＝トラック選択、ダブルクリック＝名前の変更にする。 */}
                    <span
                      className="th-name"
                      onClick={(e) => {
                        e.stopPropagation()
                        selectTrack(tr.id)
                      }}
                      onDoubleClick={(e) => {
                        e.stopPropagation()
                        askText('トラック名を変更', tr.name, (v) => {
                          const name = v.trim()
                          if (!name) return
                          setTracks((prev) =>
                            prev.map((t) => (t.id === tr.id ? { ...t, name } : t))
                          )
                        })
                      }}
                      title="クリックでトラック選択 / ダブルクリックで名前を変更"
                    >
                      {tr.name}
                    </span>
                    <span className="th-icons" onClick={(e) => e.stopPropagation()}>
                      <button
                        className={`th-btn ${st.locked ? 'th-on' : ''}`}
                        title="ロック"
                        onClick={() => toggleTrack(tr.id, 'locked')}
                      >
                        {st.locked ? '🔒' : '🔓'}
                      </button>
                      {tr.kind === 'video' ? (
                        <>
                          <button
                            className={`th-btn ${st.hidden ? 'th-off' : ''}`}
                            title="表示/非表示"
                            onClick={() => toggleTrack(tr.id, 'hidden')}
                          >
                            {st.hidden ? '🙈' : '👁'}
                          </button>
                          {/* 映像には M/S が無いが、空きを置いて列を揃える。
                              揃っていないと、段によってボタンの位置がずれて毎回探すことになる。 */}
                          <span className="th-ms th-ms-blank" aria-hidden="true" />
                          <span className="th-ms th-ms-blank" aria-hidden="true" />
                        </>
                      ) : (
                        <>
                          <button
                            className={`th-ms ${st.muted ? 'th-mute' : ''}`}
                            title="ミュート"
                            onClick={() => toggleTrack(tr.id, 'muted')}
                          >
                            M
                          </button>
                          <button
                            className={`th-ms ${st.solo ? 'th-solo' : ''}`}
                            title="ソロ"
                            onClick={() => toggleTrack(tr.id, 'solo')}
                          >
                            S
                          </button>
                          {tr.id === EXTRA_AUDIO_TRACK && (
                            <button
                              className="th-ms th-bgm-add"
                              title="このトラックに音声ファイル（BGM等）を追加"
                              onClick={() => void addBgm()}
                            >
                              ♪＋
                            </button>
                          )}
                        </>
                      )}
                    </span>
                  </div>
                )
              })}
              <button className="th-add th-add-audio" title="音声トラックを追加" onClick={addAudioTrack}>
                ＋
              </button>
              <div className="track-pad" style={{ height: padBottom }} />
            </div>

            {/* トラック領域 */}
            <div
              className="track-scroll"
              ref={scrollRef}
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
                  const rect = trackInnerRef.current?.getBoundingClientRect()
                  if (rect) setHoverX(e.clientX - rect.left)
                }}
                onPointerLeave={() => setHoverX(null)}
              >
                {/* ルーラー（ドラッグでスクラブ） */}
                <div className="ruler" onPointerDown={startScrub}>
                  {rulerTicks.map((t, i) => (
                    <div
                      key={i}
                      className={`tick ${t.major ? 'tick-major' : 'tick-minor'}`}
                      style={{ left: t.left }}
                    >
                      {t.label && <span>{t.label}</span>}
                    </div>
                  ))}
                </div>

                {/* ホバーガイド線 */}
                {hoverX != null && (
                  <div className="hover-line" style={{ left: hoverX }}>
                    <span className="hover-time">{formatTime(hoverX / zoom)}</span>
                  </div>
                )}

                {/* スナップの吸着線は表示しない（ピンクの縦線が再生ヘッドと紛らわしく邪魔なので）。
                    吸着の挙動自体は有効。 */}

                {/* マーキー（範囲選択） */}
                {marquee && (
                  <div
                    className="marquee"
                    style={{
                      left: Math.min(marquee.x0, marquee.x1),
                      top: Math.min(marquee.y0, marquee.y1),
                      width: Math.abs(marquee.x1 - marquee.x0),
                      height: Math.abs(marquee.y1 - marquee.y0)
                    }}
                  />
                )}

                {/* マーカー（頭出し/メモ）: ルーラーの旗＋タイムライン縦線 */}
                {markers.map((mk) => (
                  <div
                    key={mk.id}
                    className={`marker ${selectedMarkerId === mk.id ? 'marker-sel' : ''}`}
                    style={{ left: mk.t * zoom }}
                  >
                    <div className="marker-line" />
                    <div
                      className="marker-flag"
                      title={`${formatTimecode(mk.t, fps)}${mk.label ? '：' + mk.label : ''}（クリックで頭出し / ドラッグで移動 / ダブルクリックで名前 / Delete で削除）`}
                      onPointerDown={(e) => onMarkerPointerDown(mk, e)}
                      onDoubleClick={(e) => {
                        e.stopPropagation()
                        setSelectedMarkerId(mk.id)
                        setEditingMarkerId(mk.id)
                      }}
                    >
                      🚩
                    </div>
                    {mk.label && editingMarkerId !== mk.id && (
                      <span className="marker-label">{mk.label}</span>
                    )}
                    {editingMarkerId === mk.id && (
                      <input
                        className="marker-input"
                        autoFocus
                        defaultValue={mk.label}
                        onPointerDown={(e) => e.stopPropagation()}
                        onBlur={(e) => {
                          const v = e.target.value.trim()
                          setMarkers((prev) =>
                            prev.map((m) => (m.id === mk.id ? { ...m, label: v } : m))
                          )
                          setEditingMarkerId(null)
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                          else if (e.key === 'Escape') setEditingMarkerId(null)
                          e.stopPropagation()
                        }}
                      />
                    )}
                  </div>
                ))}

                {/* 再生ヘッド */}
                <div className="playhead" style={{ left: currentTime * zoom }}>
                  <div className="playhead-handle" onPointerDown={startScrub} />
                </div>

                {/* 上の余白。端に貼り付いていると足す余地が見えず窮屈に感じる */}
                <div className="track-pad" style={{ height: padTop }} />
                {/* 各トラック */}
                {tracks.map((tr) => (
                  <div
                    key={tr.id}
                    data-tid={tr.id}
                    className={`track track-${tr.kind}`}
                    style={{
                      height: trackHOf(tr.kind),
                      cursor:
                        tool === 'razor'
                          ? 'crosshair'
                          : tool === 'trackFwd'
                            ? 'e-resize'
                            : tool === 'trackBack'
                              ? 'w-resize'
                              : 'default'
                    }}
                    onPointerDown={onTrackAreaPointerDown}
                  >
                    {tr.kind === 'video' &&
                      tr.id !== 'V1' &&
                      cues
                        .filter((cue) => cueTrack(cue) === tr.id)
                        .map((cue) => (
                        <div
                          key={cue.id}
                          className={`clip telop-clip ${isSelected(cue.id) ? 'clip-selected' : ''}`}
                          style={{
                            left: cue.start * zoom,
                            width: Math.max((cue.end - cue.start) * zoom, 12),
                            background: cue.label
                          }}
                          title={cue.text}
                          onPointerDown={(e) => onClipPointerDown(cue, e)}
                          onContextMenu={(e) => onClipContextMenu(cue, e)}
                          onDragOver={(e) => {
                            if (!draggingTelopAnimRef.current) return
                            e.preventDefault()
                            e.dataTransfer.dropEffect = 'copy'
                            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                            const r = resolveTelopTransDrop(cue, e.clientX, rect)
                            setTelopDrop({
                              cueId: cue.id,
                              left: r.left,
                              width: r.width,
                              label: r.label,
                              kind: r.kind
                            })
                          }}
                          onDragLeave={() => {
                            // クリップ外へ出たらゴースト帯を消す（残り防止）
                            if (draggingTelopAnimRef.current) setTelopDrop(null)
                          }}
                          onDrop={(e) => {
                            if (!draggingTelopAnimRef.current) return
                            e.preventDefault()
                            e.stopPropagation()
                            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                            applyTelopTransDrop(cue, e.clientX, rect)
                            setTelopDrop(null)
                          }}
                          onDoubleClick={() => {
                            stopPlayback() // 再生中はシークが上書きされ編集が消えるため必ず停止
                            setSelectedIds([cue.id])
                            seekTo(clamp(currentTimeRef.current, cue.start, cue.end - 0.01))
                            setEditingId(cue.id)
                          }}
                        >
                          <div
                            className="clip-trim clip-trim-l"
                            onPointerDown={(e) => onTrimStart(cue, 'l', e)}
                          />
                          <span className="clip-text">{cue.text}</span>
                          {/* テロップの出入りアニメ帯（動画トランジションと同じ流儀: 範囲表示＋クリック選択） */}
                          {cue.style.anim && cue.style.anim.in !== 'none' && (
                            <div
                              className={`ttrans ttrans-telop ${selectedTelopTrans?.cueId === cue.id && selectedTelopTrans.kind === 'in' ? 'ttrans-sel' : ''}`}
                              style={{
                                left: 0,
                                width: Math.max(
                                  Math.min(
                                    cue.style.anim.inDur * zoom,
                                    (cue.end - cue.start) * zoom * 0.5
                                  ),
                                  8
                                )
                              }}
                              title={`頭 ${motionLabel(cue.style.anim.in)} ${cue.style.anim.inDur.toFixed(2)}s（クリックで選択・Deleteで削除）`}
                              onPointerDown={(e) => {
                                e.stopPropagation()
                                if (e.button === 0) selectTelopTrans(cue.id, 'in')
                              }}
                            >
                              <span className="ttrans-lb">▶{motionLabel(cue.style.anim.in)}</span>
                              <div
                                className="ttrans-resize ttrans-resize-r"
                                title="ドラッグで長さ変更"
                                onPointerDown={(e) => {
                                  selectTelopTrans(cue.id, 'in')
                                  startTransResize(
                                    e,
                                    cue.style.anim!.inDur,
                                    1,
                                    (nd) => patchCueAnim(cue.id, { inDur: nd }),
                                    cue.end - cue.start
                                  )
                                }}
                              />
                            </div>
                          )}
                          {cue.style.anim && cue.style.anim.out !== 'none' && (
                            <div
                              className={`ttrans ttrans-telop ttrans-telop-out ${selectedTelopTrans?.cueId === cue.id && selectedTelopTrans.kind === 'out' ? 'ttrans-sel' : ''}`}
                              style={{
                                right: 0,
                                width: Math.max(
                                  Math.min(
                                    cue.style.anim.outDur * zoom,
                                    (cue.end - cue.start) * zoom * 0.5
                                  ),
                                  8
                                )
                              }}
                              title={`尻 ${motionLabel(cue.style.anim.out)} ${cue.style.anim.outDur.toFixed(2)}s（クリックで選択・Deleteで削除）`}
                              onPointerDown={(e) => {
                                e.stopPropagation()
                                if (e.button === 0) selectTelopTrans(cue.id, 'out')
                              }}
                            >
                              <span className="ttrans-lb">{motionLabel(cue.style.anim.out)}◀</span>
                              <div
                                className="ttrans-resize ttrans-resize-l"
                                title="ドラッグで長さ変更"
                                onPointerDown={(e) => {
                                  selectTelopTrans(cue.id, 'out')
                                  startTransResize(
                                    e,
                                    cue.style.anim!.outDur,
                                    -1,
                                    (nd) => patchCueAnim(cue.id, { outDur: nd }),
                                    cue.end - cue.start
                                  )
                                }}
                              />
                            </div>
                          )}
                          <div
                            className="clip-trim clip-trim-r"
                            onPointerDown={(e) => onTrimStart(cue, 'r', e)}
                          />
                        </div>
                      ))}
                    {/* 映像レイヤークリップ（V2以降の動画）。音声は対の音声トラックに連動表示。 */}
                    {tr.kind === 'video' &&
                      tr.id !== 'V1' &&
                      vClips
                        .filter((c) => c.track === tr.id)
                        .map((clip) => (
                          <div
                            key={`vc-${clip.id}`}
                            className={`clip video-clip vclip ${selectedVClipIds.includes(clip.id) ? 'clip-selected' : ''}`}
                            style={{
                              // ラベルカラーはクリップ全体を塗る（種類ごとの色より優先）。線だと見つけにくい。
                              background: clip.label || undefined,
                              left: clip.tStart * zoom,
                              width: Math.max(vcLen(clip) * zoom - 1, 12)
                            }}
                            title={`${clip.name}（音声は ${pairedAudioOf(clip.track)} に連動）`}
                            onPointerDown={(e) => onVClipPointerDown(clip, e)}
                            onContextMenu={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              setSelectedVClipIds([clip.id])
                              setMenu(null)
                              setClipMenu({
                                x: e.clientX,
                                y: e.clientY,
                                kind: 'vclip',
                                id: clip.id,
                                name: clip.name
                              })
                            }}
                          >
                            <div
                              className="clip-trim clip-trim-l"
                              onPointerDown={(e) => onVClipPointerDown(clip, e, 'l')}
                            />
                            {(() => {
                              const th = mediaItems.find((m) => m.path === clip.path)?.thumb
                              return th ? <img className="clip-thumb" src={th} alt="" /> : null
                            })()}
                            <span className="clip-text">🎬 {clip.name}</span>
                            <div
                              className="clip-trim clip-trim-r"
                              onPointerDown={(e) => onVClipPointerDown(clip, e, 'r')}
                            />
                          </div>
                        ))}
                    {/* 映像レイヤーの音声（対の音声トラックに同じ位置・同じ長さで表示。掴めば映像も動く） */}
                    {tr.kind === 'audio' &&
                      vClips
                        .filter((c) => 'A' + trackNum(c.track) === tr.id)
                        .map((clip) => (
                          <div
                            key={`vca-${clip.id}`}
                            className={`clip audio-clip vclip-audio ${selectedVClipIds.includes(clip.id) ? 'clip-selected' : ''} ${clip.muted ? 'clip-muted' : ''}`}
                            style={{
                              // ラベルカラーはクリップ全体を塗る（種類ごとの色より優先）。線だと見つけにくい。
                              background: clip.label || undefined,
                              left: clip.tStart * zoom,
                              width: Math.max(vcLen(clip) * zoom - 1, 12)
                            }}
                            title={`${clip.name} の音声（${clip.track} の映像とリンク）`}
                            onPointerDown={(e) => onVClipPointerDown(clip, e)}
                            onContextMenu={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              setSelectedVClipIds([clip.id])
                              setMenu(null)
                              setClipMenu({
                                x: e.clientX,
                                y: e.clientY,
                                kind: 'vclip',
                                id: clip.id,
                                name: clip.name
                              })
                            }}
                          >
                            <div
                              className="clip-trim clip-trim-l"
                              onPointerDown={(e) => onVClipPointerDown(clip, e, 'l')}
                            />
                            {mediaMeta[clip.path]?.wave ? (
                              <WaveformCanvas
                                min={mediaMeta[clip.path]!.wave!.min}
                                max={mediaMeta[clip.path]!.wave!.max}
                                srcStart={clip.srcStart}
                                srcEnd={clip.srcEnd}
                                audioDuration={
                                  mediaMeta[clip.path]!.wave!.dur ||
                                  clip.srcDur ||
                                  mediaMeta[clip.path]?.dur ||
                                  vcLen(clip)
                                }
                                width={Math.max(vcLen(clip) * zoom - 1, 12)}
                                height={trackHOf('audio') - 6}
                              />
                            ) : (
                              <span className="clip-text audio-loading">波形解析中…</span>
                            )}
                            {clip.muted && <span className="clip-mute-badge">🔇 消音</span>}
                            <div
                              className="clip-trim clip-trim-r"
                              onPointerDown={(e) => onVClipPointerDown(clip, e, 'r')}
                            />
                          </div>
                        ))}
                    {/* 画像クリップ（映像トラックの静止画。移動/右端リサイズ/削除可） */}
                    {tr.kind === 'video' &&
                      tr.id !== 'V1' &&
                      imgClips
                        .filter((c) => c.track === tr.id)
                        .map((clip) => (
                          <div
                            key={`img-${clip.id}`}
                            className={`clip img-clip ${selectedImgIds.includes(clip.id) ? 'clip-selected' : ''}`}
                            style={{
                              // ラベルカラーはクリップ全体を塗る（種類ごとの色より優先）。線だと見つけにくい。
                              background: clip.label || undefined,
                              left: clip.tStart * zoom,
                              width: Math.max(clip.duration * zoom - 1, 12)
                            }}
                            title={`${clip.name}（ドラッグで移動・左右端で長さ変更・Deleteで削除）`}
                            onPointerDown={(e) => onImgPointerDown(clip, e)}
                            onContextMenu={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              setSelectedImgIds([clip.id])
                              setMenu(null)
                              setClipMenu({
                                x: e.clientX,
                                y: e.clientY,
                                kind: 'img',
                                id: clip.id,
                                name: clip.name
                              })
                            }}
                          >
                            <div
                              className="clip-trim clip-trim-l"
                              onPointerDown={(e) => onImgPointerDown(clip, e, 'l')}
                            />
                            <span className="clip-text">🖼 {clip.name}</span>
                            <button
                              className="se-del"
                              title="画像を削除"
                              onPointerDown={(e) => {
                                e.stopPropagation()
                                // ロック中は消さない（Delete キー側は守っているので揃える）
                                if (trackStates[clip.track]?.locked) {
                                  showToast('このトラックはロックされています。')
                                  return
                                }
                                setImgClips((prev) => prev.filter((c) => c.id !== clip.id))
                                setSelectedImgIds([])
                              }}
                            >
                              ✕
                            </button>
                            <div
                              className="clip-trim clip-trim-r"
                              onPointerDown={(e) => onImgPointerDown(clip, e, 'r')}
                            />
                          </div>
                        ))}
                    {/* 画像配置ゴースト */}
                    {imgGhost && imgGhost.track === tr.id && (
                      <div
                        className="clip img-clip se-ghost"
                        style={{
                          left: imgGhost.t * zoom,
                          width: Math.max(imgGhost.dur * zoom - 1, 12)
                        }}
                      >
                        <span className="clip-text">🖼 {imgGhost.name}</span>
                      </div>
                    )}
                    {/* テロップアニメD&Dの配置プレビュー帯（トラック行に描画＝間は2テロップに跨って表示） */}
                    {tr.kind === 'video' &&
                      tr.id !== 'V1' &&
                      telopDrop &&
                      (() => {
                        const dc = cues.find((c) => c.id === telopDrop.cueId)
                        if (!dc || cueTrack(dc) !== tr.id) return null
                        return (
                          <div
                            className={`ttrans ttrans-ghost ttrans-ghost-telop ${telopDrop.kind === 'between' ? 'ttrans-ghost-between' : ''}`}
                            style={{ left: telopDrop.left, width: telopDrop.width }}
                          >
                            <span className="ttrans-lb">{telopDrop.label}</span>
                          </div>
                        )
                      })()}
                    {tr.id === 'V1' &&
                      videoSrc &&
                      segLayout.map((L) =>
                        // クリップを動かしてできた空きは「帯」を描かない（動かした跡が
                        // 残って見えるため）。ただし当たり判定は残して、クリックで選べて
                        // Delete で詰められるようにする＝見た目は空き、操作は普通のクリップ。
                        L.seg.gap ? (
                          <div
                            key={L.seg.id}
                            className={`clip gap-clip ${isVideoSel(L.seg.id) ? 'clip-selected' : ''}`}
                            style={{ left: L.tStart * zoom, width: Math.max(L.len * zoom - 1, 6) }}
                            title="空き（クリックして Delete で詰める）"
                            onPointerDown={(e) => onSegPointerDown(L, e, 'video')}
                            onContextMenu={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              setSelectedVideoIds([L.seg.id])
                              setSelectedImgIds([])
                              setMenu(null)
                              setClipMenu({ x: e.clientX, y: e.clientY, kind: 'seg', id: L.seg.id, name: '空き' })
                            }}
                          />
                        ) : (
                        // 映像を消した区間(videoBlank)は帯を残す（点線＋バッジ）。
                        // 帯を消すと選択できず「戻す」導線に到達できないため、消音と同じ扱いにする。
                        <div
                          key={L.seg.id}
                          className={`clip video-clip ${L.seg.videoBlank ? 'clip-blank' : ''} ${isVideoSel(L.seg.id) ? 'clip-selected' : ''} ${overwriteIds.includes(L.seg.id) ? 'clip-overwrite' : ''}`}
                          style={{
                            left: L.tStart * zoom,
                            width: Math.max(L.len * zoom - 1, 10),
                            // ラベルカラーはクリップ全体を塗る（種類ごとの色より優先）。線だと見つけにくい。
                            background: L.seg.label || undefined
                          }}
                          title={
                            L.seg.gap
                              ? '空白（映像なし・無音）'
                              : (srcOfSeg(L.seg)?.name ?? videoName ?? '')
                          }
                          onPointerDown={(e) => onSegPointerDown(L, e, 'video')}
                          onContextMenu={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            setSelectedVideoIds([L.seg.id])
                            setSelectedImgIds([])
                            setMenu(null) // テロップ用メニューが開いていたら閉じる
                            setClipMenu({
                              x: e.clientX,
                              y: e.clientY,
                              kind: 'seg',
                              id: L.seg.id,
                              name: srcOfSeg(L.seg)?.name ?? '動画クリップ'
                            })
                          }}
                        >
                          <div
                            className="clip-trim clip-trim-l"
                            onPointerDown={(e) => onSegTrimStart(L, 'l', e)}
                          />
                          {/* サムネはその切片の元動画のものを出す（先頭固定にすると別動画の絵が出る） */}
                          {(() => {
                            const sp = srcOfSeg(L.seg)?.path
                            const th =
                              (sp && mediaItems.find((m) => m.path === sp)?.thumb) ||
                              (L.index === 0 ? thumbnailSrc : undefined)
                            return th && !L.seg.videoBlank ? (
                              <img className="clip-thumb" src={th} alt="" />
                            ) : null
                          })()}
                          <span className="clip-text">
                            {/* 空白（移動や位置指定配置でできた隙間）と、
                                「映像だけ消した」区間は別物なので言葉を分ける */}
                            {L.seg.gap
                              ? '⬛ 空白'
                              : L.seg.videoBlank
                                ? '🚫 映像なし'
                                : `🎬 ${srcOfSeg(L.seg)?.name ?? videoName ?? '動画'}`}
                            {/* 同じ素材を切った断片は名前が全部同じで見分けがつかない。
                                元動画のどこを使っているか（イン点）を出して区別する。 */}
                            {segLayout.length > 1 && !L.seg.gap && !L.seg.videoBlank && (
                              <span className="clip-in">{formatTime(L.seg.srcStart)}〜</span>
                            )}
                            {segSpeed(L.seg) !== 1 && (
                              <span className="clip-speed">{segSpeed(L.seg)}x</span>
                            )}
                          </span>
                          <div
                            className="clip-trim clip-trim-r"
                            onPointerDown={(e) => onSegTrimStart(L, 'r', e)}
                          />
                        </div>
                        )
                      )}
                    {/* 動画ドロップの配置ゴースト（V1）: 上書き=青 / Ctrl挿入=緑。
                        音声(A1)にも同じ位置・同じ長さでゴーストを出して「映像と音はセット」を示す。 */}
                    {tr.id === videoGhost?.track && videoGhost && (
                      <div
                        className={`clip video-clip se-ghost ${videoGhost.track === 'V1' && videoGhost.insert ? 'ghost-insert' : ''}`}
                        style={{
                          left: videoGhost.t * zoom,
                          width: Math.max(videoGhost.dur * zoom - 1, 12)
                        }}
                      >
                        <span className="clip-text">
                          🎬 {videoGhost.name}
                          {videoGhost.moving
                            ? videoGhost.mode === 'copy'
                              ? '（複製）'
                              : videoGhost.mode === 'insert'
                                ? '（割り込み）'
                                : '（移動）'
                            : videoGhost.track !== 'V1'
                              ? '（重ねる）'
                              : videoGhost.insert
                                ? '（挿入）'
                                : '（上書き）'}
                        </span>
                      </div>
                    )}
                    {videoGhost && tr.id === 'A' + trackNum(videoGhost.track) && (
                      <div
                        className={`clip audio-clip se-ghost ${videoGhost.track === 'V1' && videoGhost.insert ? 'ghost-insert' : ''}`}
                        style={{
                          left: videoGhost.t * zoom,
                          width: Math.max(videoGhost.dur * zoom - 1, 12)
                        }}
                      >
                        {/* 取り込み時に用意した波形をそのまま出す（掴んでいる間から中身が見える） */}
                        {mediaMeta[videoGhost.path]?.wave ? (
                          <WaveformCanvas
                            min={mediaMeta[videoGhost.path]!.wave!.min}
                            max={mediaMeta[videoGhost.path]!.wave!.max}
                            srcStart={0}
                            srcEnd={videoGhost.dur}
                            audioDuration={
                              mediaMeta[videoGhost.path]!.wave!.dur ||
                              mediaMeta[videoGhost.path]?.dur ||
                              videoGhost.dur
                            }
                            width={Math.max(videoGhost.dur * zoom - 1, 12)}
                            height={trackHOf('audio') - 6}
                          />
                        ) : (
                          <span className="clip-text audio-loading">🔊 音声（解析中…）</span>
                        )}
                      </div>
                    )}
                    {/* トランジション枠（クリップより前面・クリックで選択可）。範囲が一目で分かる。 */}
                    {tr.id === 'V1' &&
                      videoSrc &&
                      segLayout.flatMap((L) => {
                        const boxes: React.ReactNode[] = []
                        // 削除(映像なし)切片は V1 に何も描かないのでトランジション帯も出さない
                        if (L.seg.videoBlank) return boxes
                        // 頭ディップ（明転/白）: [tStart, tStart+dur]。
                        // 直前の境界に有効な xfade があるときは頭ディップは出さない
                        // （書き出し・プレビューが xfade 優先で頭ディップを抑制するのと表示を一致させる）。
                        if (L.seg.transIn && (L.index === 0 || xfadeDurAt(segLayout, L.index - 1) <= 0)) {
                          const d = Math.min(L.seg.transIn.dur, L.len)
                          const sel =
                            selectedTrans?.segId === L.seg.id && selectedTrans.kind === 'in'
                          boxes.push(
                            <div
                              key={`in-${L.seg.id}`}
                              className={`ttrans ${bandClass(L.seg.transIn.type)} ${sel ? 'ttrans-sel' : ''}`}
                              style={{ left: L.tStart * zoom, width: Math.max(d * zoom, 8) }}
                              title={`頭 ${transLabel(L.seg.transIn.type)} ${d.toFixed(2)}s（クリックで選択・Deleteで削除）`}
                              onPointerDown={(e) => {
                                e.stopPropagation()
                                if (e.button === 0) selectTransition(L.seg.id, 'in')
                              }}
                            >
                              <span className="ttrans-lb">
                                {transIco(L.seg.transIn.type)} {d.toFixed(1)}s
                              </span>
                              <div
                                className="ttrans-resize ttrans-resize-r"
                                title="ドラッグで長さ変更"
                                onPointerDown={(e) => {
                                  selectTransition(L.seg.id, 'in')
                                  startTransResize(e, L.seg.transIn!.dur, 1, (nd) =>
                                    setVideoTransDur(L.seg.id, 'in', nd), L.len)
                                }}
                              />
                            </div>
                          )
                        }
                        // 尻ディップ（暗転/白）: [tEnd-dur, tEnd]。ただしその境界に xfade があるなら xfade を優先表示。
                        if (L.seg.transOut && xfadeDurAt(segLayout, L.index) <= 0) {
                          const d = Math.min(L.seg.transOut.dur, L.len)
                          const sel =
                            selectedTrans?.segId === L.seg.id && selectedTrans.kind === 'out'
                          boxes.push(
                            <div
                              key={`out-${L.seg.id}`}
                              className={`ttrans ${bandClass(L.seg.transOut.type)} ${sel ? 'ttrans-sel' : ''}`}
                              style={{ left: (L.tEnd - d) * zoom, width: Math.max(d * zoom, 8) }}
                              title={`尻 ${transLabel(L.seg.transOut.type)} ${d.toFixed(2)}s（クリックで選択・Deleteで削除）`}
                              onPointerDown={(e) => {
                                e.stopPropagation()
                                if (e.button === 0) selectTransition(L.seg.id, 'out')
                              }}
                            >
                              <span className="ttrans-lb">
                                {transIco(L.seg.transOut.type)} {d.toFixed(1)}s
                              </span>
                              <div
                                className="ttrans-resize ttrans-resize-l"
                                title="ドラッグで長さ変更"
                                onPointerDown={(e) => {
                                  selectTransition(L.seg.id, 'out')
                                  startTransResize(e, L.seg.transOut!.dur, -1, (nd) =>
                                    setVideoTransDur(L.seg.id, 'out', nd), L.len)
                                }}
                              />
                            </div>
                          )
                        }
                        // カット間クロスディゾルブ: カットをまたいで両クリップに掛かる表示 [cut-d/2, cut+d/2]
                        const xd = xfadeDurAt(segLayout, L.index)
                        if (xd > 0) {
                          const cut = L.tEnd
                          const sel =
                            selectedTrans?.segId === L.seg.id && selectedTrans.kind === 'xfade'
                          boxes.push(
                            <div
                              key={`xf-${L.seg.id}`}
                              className={`ttrans ${bandClass(L.seg.xfade?.type ?? 'fade')} ${sel ? 'ttrans-sel' : ''}`}
                              style={{ left: (cut - xd / 2) * zoom, width: Math.max(xd * zoom, 12) }}
                              title={`${transLabel(L.seg.xfade?.type)} ${xd.toFixed(2)}s（両クリップの間・クリックで選択・Deleteで削除）`}
                              onPointerDown={(e) => {
                                e.stopPropagation()
                                if (e.button === 0) selectTransition(L.seg.id, 'xfade')
                              }}
                            >
                              <span className="ttrans-lb">
                                {transIco(L.seg.xfade?.type)} {xd.toFixed(1)}s
                              </span>
                              <div
                                className="ttrans-resize ttrans-resize-r"
                                title="ドラッグで長さ変更"
                                onPointerDown={(e) => {
                                  selectTransition(L.seg.id, 'xfade')
                                  startTransResize(
                                    e,
                                    xd,
                                    2,
                                    (nd) => setVideoTransDur(L.seg.id, 'xfade', nd),
                                    Math.min(L.len, segLayout[L.index + 1]?.len ?? L.len)
                                  )
                                }}
                              />
                            </div>
                          )
                        }
                        return boxes
                      })}
                    {/* 動画トランジションD&Dの配置プレビュー帯（マグネットで前/間/後ろにスナップ） */}
                    {tr.id === 'V1' &&
                      transDrop &&
                      (() => {
                        const L = segLayout.find((l) => l.seg.id === transDrop.segId)
                        if (!L) return null
                        return (
                          <div
                            className={`ttrans ttrans-ghost ttrans-ghost-${transDrop.kind}`}
                            style={{ left: L.tStart * zoom + transDrop.left, width: transDrop.width }}
                          >
                            <span className="ttrans-lb">{transDrop.label}</span>
                          </div>
                        )
                      })()}
                    {tr.id === 'A1' &&
                      videoSrc &&
                      segLayout.map((L) => {
                        if (L.seg.gap) return null // 空白（ギャップ）切片は音声レーンにも描かない
                        // マルチソース: 各切片は自分の元動画の波形/尺で描画
                        const ssrc = srcOfSeg(L.seg)
                        // 自分のソースの波形を使う。未取得なら「解析中」表示。
                        // ただし主ソース（=グローバルの waveform と同じ動画）は
                        // そちらにフォールバックしてよい（別動画の波形は絶対に使わない）。
                        const isPrimary = !!ssrc && !!sources[0] && ssrc.id === sources[0].id
                        const wf = ssrc?.waveform ?? (isPrimary || !ssrc ? waveform : null)
                        const sdur = ssrc?.duration || videoDuration
                        return (
                          <div
                            key={L.seg.id}
                            className={`clip audio-clip ${isAudioSel(L.seg.id) ? 'clip-selected' : ''} ${L.seg.muted ? 'clip-muted' : ''}`}
                            style={{ left: L.tStart * zoom, width: Math.max(L.len * zoom - 1, 10),
                              // ラベルカラーはクリップ全体を塗る（種類ごとの色より優先）
                              background: L.seg.label || undefined
                            }}
                            title={ssrc?.name ?? videoName ?? ''}
                            onPointerDown={(e) => onSegPointerDown(L, e, 'audio')}
                          >
                            {wf ? (
                              <WaveformCanvas
                                min={wf.min}
                                max={wf.max}
                                srcStart={L.seg.srcStart}
                                srcEnd={L.seg.srcEnd}
                                audioDuration={wf.dur || sdur}
                                width={Math.max(L.len * zoom - 1, 10)}
                                height={trackHOf('audio') - 6}
                              />
                            ) : (
                              <span className="clip-text audio-loading">波形解析中…</span>
                            )}
                            {L.seg.muted && <span className="clip-mute-badge">🔇 消音</span>}
                          </div>
                        )
                      })}
                    {(tr.kind === 'audio' ? seClips.filter((c) => c.track === tr.id) : []).map(
                      (clip) => (
                        <div
                          key={clip.id}
                          className={`clip se-clip ${selectedSeIds.includes(clip.id) ? 'clip-selected' : ''}`}
                          style={{
                            left: clip.tStart * zoom,
                            width: Math.max(clip.duration * zoom - 1, 12),
                            // ラベルカラーはクリップ全体を塗る（他の種類と同じ扱い）。
                            // ここだけ抜けていて、色を選んでも見た目が変わらなかった。
                            background: clip.label || undefined
                          }}
                          title={`${clip.name}（ドラッグで移動・左右端で長さ変更・Deleteで削除）`}
                          onPointerDown={(e) => onSePointerDown(clip, e)}
                          onContextMenu={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            setSelectedSeIds([clip.id])
                            setMenu(null)
                            setClipMenu({
                              x: e.clientX,
                              y: e.clientY,
                              kind: 'se',
                              id: clip.id,
                              name: clip.name
                            })
                          }}
                        >
                          <div
                            className="clip-trim clip-trim-l"
                            onPointerDown={(e) => onSePointerDown(clip, e, 'l')}
                          />
                          <span className="clip-text">🔊 {clip.name}</span>
                          <div
                            className="clip-trim clip-trim-r"
                            onPointerDown={(e) => onSePointerDown(clip, e, 'r')}
                          />
                          <button
                            className="se-del"
                            title="削除"
                            onPointerDown={(e) => {
                              e.stopPropagation()
                              // ロック中は消さない（Delete キー側は守っているので揃える）
                              if (trackStates[clip.track]?.locked) {
                                showToast('このトラックはロックされています。')
                                return
                              }
                              setSeClips((prev) => prev.filter((c) => c.id !== clip.id))
                              setSelectedSeIds([])
                            }}
                          >
                            ✕
                          </button>
                        </div>
                      )
                    )}
                    {/* SE/BGM配置ゴースト（ドラッグ中の半透明プレビュー・対象トラックに表示）*/}
                    {seGhost && seGhost.track === tr.id && (
                      <div
                        className="clip se-clip se-ghost"
                        style={{
                          left: seGhost.t * zoom,
                          width: Math.max(seGhost.dur * zoom - 1, 12)
                        }}
                      >
                        {mediaMeta[seGhost.path]?.wave ? (
                          <WaveformCanvas
                            min={mediaMeta[seGhost.path]!.wave!.min}
                            max={mediaMeta[seGhost.path]!.wave!.max}
                            srcStart={0}
                            srcEnd={seGhost.dur}
                            audioDuration={
                              mediaMeta[seGhost.path]!.wave!.dur ||
                              mediaMeta[seGhost.path]?.dur ||
                              seGhost.dur
                            }
                            width={Math.max(seGhost.dur * zoom - 1, 12)}
                            height={trackHOf('audio') - 6}
                          />
                        ) : (
                          <span className="clip-text">🔊 {seGhost.name}</span>
                        )}
                      </div>
                    )}
                  </div>
                ))}
                {/* 下の余白。位置の計算には効かないので、上と同じ高さでなくてよい */}
                <div className="track-pad" style={{ height: padBottom }} />
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* ===== ステータスバー ===== */}
      <footer className="statusbar">
        <span>{cues.length ? `${cues.length} テロップ` : 'テロップなし'}</span>
        <span>
          {/* 選択中の内訳（0の種別は出さない＝今なにを選んでいるか一目で分かる） */}
          選択:{' '}
          {[
            selectedIds.length ? `テロップ${selectedIds.length}` : '',
            selectedVideoIds.length ? `動画${selectedVideoIds.length}` : '',
            selectedAudioIds.length ? `音声${selectedAudioIds.length}` : '',
            selectedSeIds.length ? `SE/BGM${selectedSeIds.length}` : '',
            selectedImgIds.length ? `画像${selectedImgIds.length}個` : '',
            selectedVClipIds.length ? `映像レイヤー${selectedVClipIds.length}個` : '',
            selectedTrans ? 'トランジション' : '',
            selectedTelopTrans ? 'テロップアニメ' : '',
            selectedMarkerId != null ? 'マーカー1個' : '',
            selectedTrackId ? `トラック(${selectedTrackId})` : ''
          ]
            .filter(Boolean)
            .join(' / ') || 'なし'}
        </span>
        <span>
          ツール:{' '}
          {tool === 'select'
            ? '選択'
            : tool === 'razor'
              ? 'レザー'
              : tool === 'trackFwd'
                ? 'トラック選択(右)'
                : 'トラック選択(左)'}
        </span>
        <span>比率 {ratio}</span>
        <span>再生ヘッド {formatTimecode(currentTime, fps)}</span>
        {playRateUI !== 0 && <span>シャトル {playRateUI}x</span>}
        <span className="grow" />
        <span>GiftCut</span>
      </footer>

      {/* ===== ドラッグ中の時間ツールチップ ===== */}
      {dragTip && (
        <div className="drag-tip" style={{ left: dragTip.x + 14, top: dragTip.y - 28 }}>
          {dragTip.text}
        </div>
      )}

      {/* ===== 書き出し中オーバーレイ ===== */}
      {/* 書き出し設定ダイアログ */}
      {showExportDialog && (
        <div className="export-overlay" onPointerDown={() => setShowExportDialog(false)}>
          <div className="restore-box" onPointerDown={(e) => e.stopPropagation()}>
            <div className="restore-title">書き出し設定</div>
            <div className="sp-row">
              <span className="sp-label">📤 書き出す解像度</span>
              <select
                className="pq-select pq-export"
                value={exportOpts.resP}
                onChange={(e) =>
                  setExportOpts((o) => ({ ...o, resP: Number(e.target.value) as 2160 | 1080 | 720 | 480 }))
                }
              >
                <option value={2160}>4K（2160p）</option>
                <option value={1080}>フルHD（1080p）</option>
                <option value={720}>HD（720p）</option>
                <option value={480}>SD（480p）</option>
              </select>
            </div>
            <div className="sp-row">
              <span className="sp-label">フレームレート</span>
              <select
                className="pq-select"
                value={String(exportOpts.fps)}
                onChange={(e) => {
                  const v = e.target.value
                  setExportOpts((o) => ({
                    ...o,
                    fps: v === 'source' ? 'source' : (Number(v) as 24 | 30 | 60)
                  }))
                }}
                title="「素材と同じ」なら素材のフレームレートをそのまま保つ（60fps素材が30fpsに落ちない）"
              >
                <option value="source">素材と同じ（{fpsLabel(srcFpsForExport())}fps）</option>
                <option value="24">24fps</option>
                <option value="30">30fps</option>
                <option value="60">60fps</option>
              </select>
            </div>
            <div className="sp-row">
              <span className="sp-label">画質</span>
              <select
                className="pq-select"
                value={exportOpts.quality}
                onChange={(e) =>
                  setExportOpts((o) => ({ ...o, quality: e.target.value as 'high' | 'med' | 'low' }))
                }
              >
                <option value="high">高画質（ファイル大）</option>
                <option value="med">標準</option>
                <option value="low">軽量（ファイル小）</option>
              </select>
            </div>
            <div className="tpl-hint" style={{ marginTop: 4 }}>
              形式は保存ダイアログの拡張子（.mp4 / .mov）で選べます。H.264 / AAC。
            </div>
            <div className="restore-btns">
              <button className="btn small" onClick={() => setShowExportDialog(false)}>
                キャンセル
              </button>
              <button
                className="btn small primary"
                onClick={() => {
                  setShowExportDialog(false)
                  void exportProject()
                }}
              >
                この設定で書き出す
              </button>
            </div>
          </div>
        </div>
      )}
      {exportStatus && (
        <div className="export-overlay">
          <div className="export-box">
            <div className="export-spinner" />
            <div className="export-msg">
              {exportStatus}
              {exportPct != null && <span className="export-pct">　{exportPct}%</span>}
            </div>
            {exportPct != null && (
              <div className="export-bar">
                <div className="export-bar-fill" style={{ width: `${exportPct}%` }} />
              </div>
            )}
            <button
              className="export-cancel"
              onClick={() => {
                setExportStatus('キャンセル中…')
                void window.giftcut.cancelExport()
              }}
            >
              キャンセル
            </button>
          </div>
        </div>
      )}

      {/* ===== クラッシュ復帰プロンプト ===== */}
      {restorePrompt && (
        <div className="export-overlay">
          <div className="restore-box">
            <div className="restore-title">前回の作業が残っています</div>
            <div className="restore-msg">
              {restorePrompt.onlyPrev
                ? '最後の自動保存が読めませんでした。その1つ前なら残っています。'
                : '自動保存された編集内容が見つかりました。復元しますか？'}
              {restorePrompt.savedAt && (
                <div className="restore-when">最後に自動保存: {restorePrompt.savedAt}</div>
              )}
              {!restorePrompt.videoExists && (
                <div className="restore-warn">
                  ※ 元の動画ファイルが見つからないため、テロップ/カット情報のみ復元されます。
                </div>
              )}
            </div>
            <div className="restore-btns">
              <button
                className="btn"
                onClick={() => {
                  void window.giftcut.autosaveClear()
                  setRestorePrompt(null)
                }}
              >
                破棄して新規
              </button>
              {/* 落ちる原因になった操作ごと戻ってきてしまうと逃げ場が無い。
                  1世代前も選べるようにしておく。 */}
              {restorePrompt.prev && (
                <button
                  className="btn"
                  title={
                    restorePrompt.prev.savedAt
                      ? `${restorePrompt.prev.savedAt} の内容に戻します`
                      : undefined
                  }
                  onClick={() => {
                    const p = restorePrompt.prev!
                    setRestorePrompt(null)
                    void applyProjectData(p.data, p.videoExists, null)
                  }}
                >
                  1つ前の状態で復元
                </button>
              )}
              <button
                className="btn btn-primary"
                onClick={() => {
                  const r = restorePrompt
                  setRestorePrompt(null)
                  void applyProjectData(r.data, r.videoExists, null)
                }}
              >
                復元する
              </button>
            </div>
          </div>
        </div>
      )}

      {/* テンプレート選択（起動時 or ファイル→テンプレートを開く） */}
      {templatePicker && (
        <div className="export-overlay">
          <div className="restore-box">
            <div className="restore-title">
              {templatePicker.startup ? 'テンプレートから始める' : 'テンプレートを開く'}
            </div>
            <div className="restore-msg">
              {templatePicker.startup
                ? '保存済みのテンプレートを選ぶか、空で開始できます。'
                : 'テンプレートフォルダ内のテンプレートを選んで開きます（新規プロジェクト扱い）。'}
            </div>
            <div className="tpl-picker-list">
              {templatePicker.items.map((t) => (
                <button key={t.path} className="tpl-picker-item" onClick={() => void pickTemplate(t.path)}>
                  📄 {t.name}
                </button>
              ))}
            </div>
            <div className="restore-btns">
              <button className="btn" onClick={() => setTemplatePicker(null)}>
                {templatePicker.startup ? '空で始める' : '閉じる'}
              </button>
            </div>
          </div>
        </div>
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

      {/* ===== 環境設定（ショートカット）===== */}
      {prefsOpen && (
        <div
          className="prefs-overlay"
          onClick={() => {
            setPrefsOpen(false)
            setCapturingId(null)
          }}
        >
          <div className="prefs-box" onClick={(e) => e.stopPropagation()}>
            <div className="prefs-head">
              <span>環境設定 — キーボードショートカット</span>
              <button
                className="prefs-close"
                onClick={() => {
                  setPrefsOpen(false)
                  setCapturingId(null)
                }}
              >
                ✕
              </button>
            </div>
            <div className="prefs-body">
              {['ファイル', 'ツール', '再生', '編集'].map((group) => (
                <div key={group} className="prefs-group">
                  <div className="prefs-group-title">{group}</div>
                  {ACTION_LIST.filter((a) => a.group === group).map((a) => {
                    const combo = shortcuts[a.id]
                    const conflict = (Object.keys(shortcuts) as ShortcutId[]).some(
                      (k) => k !== a.id && shortcuts[k] === combo
                    )
                    return (
                      <div className="prefs-row" key={a.id}>
                        <span className="prefs-label">{a.label}</span>
                        <button
                          className={`prefs-key ${capturingId === a.id ? 'capturing' : ''} ${conflict ? 'conflict' : ''}`}
                          onClick={() => setCapturingId(a.id)}
                          title={conflict ? '他のショートカットと重複しています' : ''}
                        >
                          {capturingId === a.id ? 'キーを押す…' : formatCombo(combo)}
                        </button>
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
            <div className="prefs-foot">
              <span className="prefs-hint">
                行のキーをクリック → 新しいキーを押す（Esc でキャンセル）
              </span>
              <button className="btn" onClick={resetShortcuts}>
                ショートカットをリセット
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== アイコン設定（色ごとに画像を割当）===== */}
      {iconSettingsOpen && (
        <div className="prefs-overlay" onClick={() => setIconSettingsOpen(false)}>
          <div className="prefs-box" onClick={(e) => e.stopPropagation()}>
            <div className="prefs-head">
              <span>アイコン設定 — 色／レーンごとに画像を割当</span>
              <button className="prefs-close" onClick={() => setIconSettingsOpen(false)}>
                ✕
              </button>
            </div>
            <div className="prefs-body">
              <div className="prefs-hint" style={{ marginBottom: 10 }}>
                「アイコン」タブで追加した画像を割り当て。優先順位は 個別D&amp;D → 色 → レーン。
              </div>
              {iconLibrary.length === 0 && (
                <div className="sp-label" style={{ marginBottom: 10 }}>
                  先に「アイコン」タブで画像を追加してください。
                </div>
              )}
              {(() => {
                // 画像選択行（色/レーン共用）
                const picker = (cur: string | undefined, pick: (img: string | null) => void): JSX.Element => (
                  <div className="assign-picker">
                    <button className={`assign-thumb ${!cur ? 'on' : ''}`} onClick={() => pick(null)} title="なし">
                      ✕
                    </button>
                    {iconLibrary.map((it) => (
                      <button
                        key={it.id}
                        className={`assign-thumb ${cur === it.image ? 'on' : ''}`}
                        onClick={() => pick(it.image)}
                        title={it.name}
                      >
                        <img src={it.image} alt="" />
                      </button>
                    ))}
                  </div>
                )
                // 使用中の色だけ表示（全色ズラッと並べない）。割当済みの色は使ってなくても出す＝解除できるように。
                const usedLabels = new Set(cues.map((c) => c.label))
                const colorRows = LABEL_COLORS.filter(
                  (l) => usedLabels.has(l.color) || iconAssign[l.color]
                )
                // テロップを置けるレーン（V1=動画を除く映像トラック）
                const telopLanes = tracks.filter((t) => t.kind === 'video' && t.id !== 'V1')
                return (
                  <>
                    <div className="sp-subhead"><span>色ごと（使用中の色のみ表示）</span></div>
                    {colorRows.length === 0 && (
                      <div className="sp-label" style={{ marginBottom: 8 }}>
                        テロップがまだありません。テロップに色を付けるとここに出ます。
                      </div>
                    )}
                    {colorRows.map((l) => (
                      <div className="assign-row" key={l.color}>
                        <span className="lg-swatch" style={{ background: l.color }} />
                        <span className="assign-name">{l.name}</span>
                        {picker(iconAssign[l.color], (img) => setIconForColor(l.color, img))}
                      </div>
                    ))}
                    <div className="sp-subhead" style={{ marginTop: 12 }}>
                      <span>レーンごと（そのトラックのテロップ全部に表示）</span>
                    </div>
                    {telopLanes.map((t) => (
                      <div className="assign-row" key={t.id}>
                        <span className="assign-name" style={{ minWidth: 64 }}>
                          {t.id === 'V2' ? 'V2 テロップ' : t.name || t.id}
                        </span>
                        {picker(laneIconAssign[t.id], (img) => setIconForLane(t.id, img))}
                      </div>
                    ))}
                  </>
                )
              })()}
            </div>
            <div className="prefs-foot">
              <span className="prefs-hint">画像は「アイコン」タブで管理（追加・削除）</span>
              <button className="btn" onClick={() => setIconSettingsOpen(false)}>
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== アイコン画像のクロップ（ライブラリ追加時）===== */}
      {cropSrc && (
        <CropModal
          src={cropSrc.src}
          ringColor="#2b8fef"
          onCancel={() => setCropSrc(null)}
          onConfirm={(image) => {
            cropSrc.onDone(image)
            setCropSrc(null)
          }}
        />
      )}

      {/* 開発中だけ出る検査票。配布ビルドでは QaPanel が null になり、
          このブロックごと消える。 */}
      {QaPanel && (
        <>
          {/* 見た目もここに書く。styles.css に置くと配布ビルドに残るため。
              開いている間はパネルの裏に隠れるので出さない。 */}
          {!qaOpen && (
          <button
            onClick={() => setQaOpen(true)}
            title="動作確認チェックリストを開く（開発中のみ）"
            style={{
              position: 'fixed',
              right: 12,
              bottom: 12,
              zIndex: 8000,
              background: '#1b2027',
              color: '#e0a94a',
              border: '1px solid #3a3320',
              borderRadius: 999,
              padding: '6px 14px',
              fontSize: 12,
              letterSpacing: '0.06em',
              cursor: 'pointer',
              opacity: 0.72
            }}
          >
            検査票
          </button>
          )}
          {qaOpen && (
            <Suspense fallback={null}>
              <QaPanel onClose={() => setQaOpen(false)} />
            </Suspense>
          )}
        </>
      )}

      {/* ===== トースト通知 ===== */}
      <div className="toast-wrap">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.type}`}>
            <span className="toast-ico">
              {t.type === 'success' ? '✓' : t.type === 'error' ? '!' : 'i'}
            </span>
            <span className="toast-msg">{t.msg}</span>
          </div>
        ))}
      </div>

      {/* ===== テキスト入力モーダル（prompt置き換え）===== */}
      {promptState && (
        <div className="modal-overlay" onClick={() => setPromptState(null)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">{promptState.title}</div>
            <input
              className="modal-input"
              autoFocus
              value={promptState.value}
              onChange={(e) =>
                setPromptState((s) => (s ? { ...s, value: e.target.value } : s))
              }
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  promptState.onOk(promptState.value)
                  setPromptState(null)
                } else if (e.key === 'Escape') setPromptState(null)
              }}
            />
            <div className="modal-actions">
              <button className="modal-btn ghost" onClick={() => setPromptState(null)}>
                キャンセル
              </button>
              <button
                className="modal-btn primary"
                onClick={() => {
                  promptState.onOk(promptState.value)
                  setPromptState(null)
                }}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== 確認モーダル（OS標準ダイアログの置き換え）===== */}
      {confirmState && (
        <div className="modal-overlay" onClick={() => closeConfirm(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">{confirmState.title}</div>
            <div className="modal-body">{confirmState.body}</div>
            <div className="modal-actions">
              <button className="modal-btn ghost" onClick={() => closeConfirm(false)}>
                {confirmState.cancelLabel}
              </button>
              <button
                className={`modal-btn ${confirmState.danger ? 'danger' : 'primary'}`}
                autoFocus
                onClick={() => closeConfirm(true)}
                // Enter=実行 / Escape=中止。ボタンにフォーカスがあるので
                // キーだけで閉じられる（OS ダイアログと同じ操作感）。
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.stopPropagation() // 裏のタイムラインの Esc 処理まで走らせない
                    closeConfirm(false)
                  }
                }}
              >
                {confirmState.okLabel}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== タブの並び順（タブを右クリック）===== */}
      {tabMenu && (
        <div
          className="ctx-menu"
          ref={clampMenu}
          style={{ left: tabMenu.x, top: tabMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {(() => {
            const pane: PaneId = tabMenu.group === 'monitor' ? 'preview' : 'right'
            return (
              <>
                <div className="ctx-title">{PANE_LABEL[pane]}</div>
                <button
                  className="ctx-item"
                  onClick={() => {
                    if (isFloating(pane)) dockPane(pane)
                    else undockPane(pane)
                    setTabMenu(null)
                  }}
                >
                  {isFloating(pane) ? '⇤ 元の場所に戻す' : '⇱ このパネルを切り離す'}
                </button>
                <div className="ctx-sep" />
                {(['left', 'preview', 'right', 'timeline'] as PaneId[])
                  .filter((id) => id !== pane)
                  .map((id) => (
                    <button
                      key={id}
                      className="ctx-item"
                      onClick={() => {
                        if (isFloating(id)) dockPane(id)
                        else undockPane(id)
                        setTabMenu(null)
                      }}
                    >
                      {isFloating(id) ? `⇤ ${PANE_LABEL[id]} を戻す` : `⇱ ${PANE_LABEL[id]} を切り離す`}
                    </button>
                  ))}
              </>
            )
          })()}
        </div>
      )}

      {/* ===== 見えていないタブの一覧（≫）===== */}
      {tabOverflow && (
        <div
          className="ctx-menu"
          ref={clampMenu}
          style={{ left: tabOverflow.x, top: tabOverflow.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="ctx-title">
            {tabOverflow.hidden.length ? '見えていないタブ' : 'タブを選ぶ'}
          </div>
          {orderedTabs(tabOverflow.group, TAB_DEFS[tabOverflow.group] ?? [])
            .filter((t) => !tabOverflow.hidden.length || tabOverflow.hidden.includes(t.id))
            .map((t) => (
            <button
              key={t.id}
              className="ctx-item"
              onClick={() => {
                pickTab(tabOverflow.group, t.id)
                setTabOverflow(null)
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* ===== 右クリックメニュー ===== */}
      {menu && (
        <div
          className="ctx-menu"
          ref={clampMenu}
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="ctx-title">
            ラベルカラー
            {isSelected(menu.cueId) && selectedIds.length > 1 ? `（${selectedIds.length}個）` : ''}
          </div>
          <div className="ctx-swatches">
            {LABEL_COLORS.map((l) => (
              <button
                key={l.color}
                className="ctx-swatch"
                style={{ background: l.color }}
                title={l.name}
                onClick={() => {
                  setLabelFor(menu.cueId, l.color)
                  setMenu(null)
                }}
              />
            ))}
          </div>
          <div className="ctx-sep" />
          <button
            className="ctx-item"
            onClick={() => {
              const c = cues.find((x) => x.id === menu.cueId)
              if (c) selectByLabel(c.label)
              setMenu(null)
            }}
          >
            同じ色をまとめて選択
          </button>
          <div className="ctx-sep" />
          <button
            className="ctx-item"
            onClick={() => {
              copyAttributes()
              setMenu(null)
            }}
          >
            設定をコピー（位置・大きさ・見た目）（{formatCombo(shortcuts.attrCopy)}）
          </button>
          {copiedAttrs && (
            <button
              className="ctx-item"
              onClick={() => {
                pasteAttributes()
                setMenu(null)
              }}
            >
              設定を貼り付け: {attrSummary(copiedAttrs)}（{formatCombo(shortcuts.attrPaste)}）
            </button>
          )}
          <div className="ctx-sep" />
          <button
            className="ctx-item"
            onClick={() => {
              rippleDeleteSelected()
              setMenu(null)
            }}
          >
            リップル削除（詰める）
          </button>
          <button
            className="ctx-item ctx-danger"
            onClick={() => {
              deleteSelected()
              setMenu(null)
            }}
          >
            選択を削除
          </button>
        </div>
      )}
      {/* 動画切片 / SE・BGM / 画像 の右クリックメニュー（テロップ以外の共通操作） */}
      {clipMenu && (
        <div
          className="ctx-menu"
          ref={clampMenu}
          style={{ left: clipMenu.x, top: clipMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="ctx-title">
            {clipMenu.kind === 'se' ? '🔊' : clipMenu.kind === 'img' ? '🖼' : '🎬'}{' '}
            {clipMenu.name}
          </div>
          {/* ラベルカラー: どのクリップにも付けられる */}
          <div className="ctx-swatches">
            {LABEL_COLORS.map((l) => (
              <button
                key={l.color}
                className="ctx-swatch"
                style={{ background: l.color }}
                title={l.name}
                onClick={() => {
                  setClipLabel(clipMenu.kind, clipMenu.id, l.color)
                  setClipMenu(null)
                }}
              />
            ))}
            <button
              className="ctx-swatch ctx-swatch-none"
              title="色なし"
              onClick={() => {
                setClipLabel(clipMenu.kind, clipMenu.id, undefined)
                setClipMenu(null)
              }}
            />
          </div>
          {clipMenu.kind !== 'seg' && (
            <button
              className="ctx-item"
              onClick={() => {
                copySelected()
                setClipMenu(null)
              }}
            >
              コピー（{formatCombo(shortcuts.copy)}）
            </button>
          )}
          <button
            className="ctx-item"
            onClick={() => {
              if (clipMenu.kind === 'vclip') {
                const dupes = vClips
                  .filter((c) => selectedVClipIds.includes(c.id))
                  .map((c) => ({
                    ...c,
                    id: vClipIdCounter.current++,
                    tStart: c.tStart + Math.max(0.05, c.srcEnd - c.srcStart)
                  }))
                setVClips((prev) => [...prev, ...dupes])
                setSelectedVClipIds(dupes.map((d) => d.id))
              } else if (clipMenu.kind === 'seg') duplicateSelectedSegments()
              else if (clipMenu.kind === 'se') {
                const dupes = seClips
                  .filter((c) => selectedSeIds.includes(c.id))
                  .map((c) => ({ ...c, id: seIdCounter.current++, tStart: c.tStart + c.duration }))
                setSeClips((prev) => [...prev, ...dupes])
                setSelectedSeIds(dupes.map((d) => d.id))
              } else {
                const dupes = imgClips
                  .filter((c) => selectedImgIds.includes(c.id))
                  .map((c) => ({ ...c, id: imgIdCounter.current++, tStart: c.tStart + c.duration }))
                setImgClips((prev) => [...prev, ...dupes])
                setSelectedImgIds(dupes.map((d) => d.id))
              }
              setClipMenu(null)
            }}
          >
            複製（{formatCombo(shortcuts.duplicate)}）
          </button>
          {clipMenu.kind === 'seg' && (
            <>
              <button
                className="ctx-item"
                onClick={() => {
                  splitVideoAtPlayhead()
                  setClipMenu(null)
                }}
              >
                再生ヘッドで分割（{formatCombo(shortcuts.split)}）
              </button>
              <button
                className="ctx-item"
                onClick={() => {
                  toggleBlankSelectedVideo()
                  setClipMenu(null)
                }}
              >
                映像だけ消す / 戻す（音と長さは残す）
              </button>
            </>
          )}
          <div className="ctx-sep" />
          <button
            className="ctx-item"
            onClick={() => {
              copyAttributes()
              setClipMenu(null)
            }}
          >
            設定をコピー（{formatCombo(shortcuts.attrCopy)}）
          </button>
          {copiedAttrs && (
            <button
              className="ctx-item"
              onClick={() => {
                pasteAttributes()
                setClipMenu(null)
              }}
            >
              設定を貼り付け: {attrSummary(copiedAttrs)}（{formatCombo(shortcuts.attrPaste)}）
            </button>
          )}
          <div className="ctx-sep" />
          {/* 本編以外は「消して同じトラックの後続を詰める」も選べる
              （本編の削除は元から詰める動作なので出さない） */}
          {clipMenu.kind !== 'seg' && (
            <button
              className="ctx-item"
              onClick={() => {
                rippleDeleteSelected()
                setClipMenu(null)
              }}
            >
              リップル削除（このトラックの後続を詰める）
            </button>
          )}
          {/* 本編は「消すだけ（空きが残る）」と「消して詰める」の2つを出す。
              どちらになるか分からないまま押すと、後ろのタイミングが崩れて事故になる。 */}
          {clipMenu.kind === 'seg' && (
            <button
              className="ctx-item"
              onClick={() => {
                rippleDeleteVideoSegments()
                setClipMenu(null)
              }}
            >
              削除して詰める（{formatCombo(shortcuts.rippleDel)}）
            </button>
          )}
          <button
            className="ctx-item ctx-danger"
            onClick={() => {
              if (clipMenu.kind === 'vclip') deleteSelectedVClip()
              else if (clipMenu.kind === 'seg') deleteVideoSegmentsLeavingGap()
              else if (clipMenu.kind === 'se') deleteSelectedSE()
              else deleteSelectedImg()
              setClipMenu(null)
            }}
          >
            {clipMenu.kind === 'seg' ? '削除（詰めない）' : '削除'}（
            {formatCombo(shortcuts.del)}）
          </button>
        </div>
      )}
      {/* テロップカード右クリック→フォルダ（カテゴリ）へ移動 */}
      {tplMenu && (
        <div
          className="ctx-menu"
          ref={clampMenu}
          style={{ left: tplMenu.x, top: tplMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="ctx-title">フォルダへ移動</div>
          {allCats.map((c) => (
            <button
              key={c.key}
              className={`ctx-item ${tplMenu.curCat === c.key ? 'ctx-on' : ''}`}
              onClick={() => {
                setTplCat(tplMenu.name, c.key)
                setTplMenu(null)
              }}
            >
              {tplMenu.curCat === c.key ? '✓ ' : ''}
              {customCats.some((cc) => cc.key === c.key) ? '📁 ' : ''}
              {c.label}
            </button>
          ))}
          <div className="ctx-sep" />
          <button
            className="ctx-item"
            onClick={() => {
              toggleFav(tplMenu.name)
              setTplMenu(null)
            }}
          >
            {isFav(tplMenu.name) ? '★ お気に入り解除' : '☆ お気に入りに追加'}
          </button>
        </div>
      )}
      {/* SE/アイコンの右クリックメニュー（フォルダ移動＋お気に入り。テロップと同じ見た目） */}
      {orgMenu && (
        <div
          className="ctx-menu"
          ref={clampMenu}
          style={{ left: orgMenu.x, top: orgMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="ctx-title">フォルダへ移動</div>
          {orgMenu.options.map((o, i) => (
            <button
              key={i}
              className={`ctx-item ${o.checked ? 'ctx-on' : ''}`}
              onClick={() => {
                o.act()
                setOrgMenu(null)
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
