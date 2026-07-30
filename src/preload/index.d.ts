export interface ExportFrame {
  png: string
  start: number
  end: number
}
export interface ExportSeg {
  srcIdx?: number
  srcStart: number
  srcEnd: number
  muted?: boolean
  videoBlank?: boolean
  speed?: number
  transIn?: { type: string; dur: number } // 頭
  transOut?: { type: string; dur: number } // 尻
  xfade?: { type: string; dur: number } // 次の切片との間
  adjust?: { b: number; c: number; s: number } // 色調整（明るさ/コントラスト/彩度）
  rotate?: number // 回転（90/180/270 or 自由角度）
  flipH?: boolean
  flipV?: boolean
  vol?: number
  afadeIn?: number
  afadeOut?: number
  zoom?: { scale: number; x: number; y: number }
  crop?: { l: number; t: number; r: number; b: number }
}
export interface ExportSEClip {
  path: string
  tStart: number
  duration: number
  srcOffset?: number
  volume?: number
  fadeIn?: number
  fadeOut?: number
}
export interface ExportPayload {
  videoPath: string
  sources?: { path: string }[]
  images?: {
    path: string
    tStart: number
    duration: number
    zoom?: { scale: number; x: number; y: number }
    rotate?: number
    flipH?: boolean
    flipV?: boolean
    opacity?: number
    adjust?: { b: number; c: number; s: number }
    crop?: { l: number; t: number; r: number; b: number }
  }[]
  // 映像レイヤークリップ（V2以降に置いた動画。本編映像の上に重ねる。音声もミックスする）
  vClips?: {
    path: string
    tStart: number
    srcStart: number
    srcEnd: number
    zoom?: { scale: number; x: number; y: number }
    rotate?: number
    flipH?: boolean
    flipV?: boolean
    opacity?: number
    adjust?: { b: number; c: number; s: number }
    crop?: { l: number; t: number; r: number; b: number }
    volume?: number
    fadeIn?: number
    fadeOut?: number
  }[]
  width: number
  height: number
  frames: ExportFrame[]
  extendSec?: number
  segments?: ExportSeg[]
  seClips?: ExportSEClip[]
  baseAudioVolume?: number
  loudnormLUFS?: number | null
  totalDurationSec?: number
  fps?: number
  crf?: number
}

/** 更新の状況（本体から届く。src/main/updater.ts と同じ形） */
export type UpdateState =
  | { phase: 'checking' }
  | { phase: 'none' }
  | { phase: 'downloading'; version: string; percent: number }
  | { phase: 'ready'; version: string; when: 'now' | 'onQuit'; message: string; countdownSec: number }
  | { phase: 'error'; message: string }

export interface GiftcutApi {
  importSrt: () => Promise<{ path: string; content: string; error?: string } | null>
  openVideo: () => Promise<{ path: string } | null>
  addMedia: () => Promise<{ paths: string[] } | null>
  addFolder: () => Promise<{ folder: string; paths: string[] } | null>
  listSE: () => Promise<{
    ok: boolean
    root?: string
    items: { category: string; name: string; path: string }[]
  }>
  listTelopPresets: () => Promise<{ ok: boolean; items: unknown[] }>
  /** 取り込んで置いてある「動きのプリセット」。中身の検査は受け取った側でやる */
  listMotionPresets: () => Promise<{ ok: boolean; items: unknown[] }>
  /**
   * .prfpset を選んで取り込む。**1つも落とさない**（どれを使うかは人が決める）。
   * total=ファイルの数 / imported=並べた数 / partial=一部だけ / empty=動きが取れなかった数
   */
  importMotionPresets: () => Promise<{
    ok: boolean
    canceled?: boolean
    path?: string
    items?: unknown[]
    total?: number
    imported?: number
    partial?: number
    empty?: number
    error?: string
  }>
  /** 動きの記録を userData/perf へ書く */
  savePerfReport: (text: string) => Promise<{ ok: boolean; path?: string; error?: string }>
  /** 更新で消えない置き場（userData の下）を開く。無ければ作ってから開く */
  openFolder: (
    key: 'se' | 'telop' | 'motion' | 'template' | 'data'
  ) => Promise<{ ok: boolean; path?: string; error?: string }>
  getDuration: (path: string) => Promise<{ ok: boolean; duration?: number }>
  getFps: (path: string) => Promise<{ ok: boolean; fps?: number }>
  generateWaveform: (
    videoPath: string
  ) => Promise<{ ok: boolean; min?: number[]; max?: number[]; duration?: number; error?: string }>
  /** 喋っていない所を探す（noiseDb=これより静かなら無音, minSec=これより短いのは無視） */
  detectSilences: (
    videoPath: string,
    noiseDb?: number,
    minSec?: number
  ) => Promise<{ ok: boolean; silences?: { start: number; dur: number }[]; error?: string }>
  generateThumbnail: (videoPath: string) => Promise<{ ok: boolean; path?: string; error?: string }>
  generateProxy: (
    videoPath: string,
    height?: number
  ) => Promise<{ ok: boolean; path?: string; cached?: boolean; error?: string }>
  onProxyProgress: (cb: (data: { path: string; percent: number }) => void) => () => void
  exportVideo: (
    payload: ExportPayload
  ) => Promise<{ ok: boolean; outPath?: string; error?: string; canceled?: boolean }>
  cancelExport: () => Promise<{ ok: boolean }>
  onExportProgress: (cb: (data: { percent: number }) => void) => () => void
  saveProject: (
    json: string,
    curPath?: string | null,
    asNew?: boolean
  ) => Promise<{ ok: boolean; path?: string; error?: string }>
  saveImage: (dataUrl: string) => Promise<{ ok: boolean; path?: string; error?: string }>
  openProject: (path?: string) => Promise<{
    ok: boolean
    path?: string
    data?: unknown
    videoExists?: boolean
    error?: string
  } | null>
  packProject: (
    json: string,
    suggestName?: string
  ) => Promise<{
    ok: boolean
    path?: string
    files?: number
    missing?: string[]
    size?: number
    canceled?: boolean
    error?: string
  }>
  openPack: (zipPath?: string) => Promise<{
    ok: boolean
    path?: string
    dir?: string
    data?: unknown
    videoExists?: boolean
    canceled?: boolean
    error?: string
  }>
  onPackProgress: (cb: (data: { percent: number }) => void) => () => void
  onUpdateState: (cb: (s: UpdateState) => void) => () => void
  updateLater: () => void
  updateNow: () => void
  onUpdateFlush: (fn: () => void) => () => void
  updateFlushed: () => void
  listTemplates: () => Promise<{ ok: boolean; items: { name: string; path: string }[]; error?: string }>
  saveTemplate: (name: string, json: string) => Promise<{ ok: boolean; path?: string; error?: string }>
  loadTemplate: (
    path: string
  ) => Promise<{ ok: boolean; path?: string; data?: unknown; videoExists?: boolean; error?: string }>
  openTemplateDialog: () => Promise<{
    ok: boolean
    path?: string
    data?: unknown
    videoExists?: boolean
    error?: string
  } | null>
  exportSrt: (content: string) => Promise<{ ok: boolean; path?: string; error?: string }>
  autosaveProject: (json: string) => Promise<{ ok: boolean }>
  autosaveCheck: () => Promise<{
    exists: boolean
    data?: unknown
    videoExists?: boolean
    mtime?: number
    /** 1つ前の下書き（あれば）。落ちる直前の状態を選びたくないときの逃げ道。 */
    prev?: { data: unknown; videoExists: boolean; mtime: number }
    /** 最新が壊れていて、1つ前だけが読めた場合 */
    onlyPrev?: boolean
  }>
  autosaveClear: () => Promise<{ ok: boolean }>
  setDirty: (dirty: boolean) => void
  /** ウィンドウを閉じる要求。戻り値は購読解除。確認後は confirmClose を呼ぶ。 */
  onCloseRequest: (fn: () => void) => () => void
  confirmClose: () => void
}

declare global {
  interface Window {
    giftcut: GiftcutApi
  }
}
