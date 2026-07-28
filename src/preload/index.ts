import { contextBridge, ipcRenderer } from 'electron'

interface ExportFrame {
  png: string
  start: number
  end: number
}
interface ExportSeg {
  srcIdx?: number // 入力（元動画）index。マルチソース。未指定=0
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
interface ExportSEClip {
  path: string
  tStart: number
  duration: number
  srcOffset?: number // 音源内の開始オフセット（左端トリム/分割）
  volume?: number
  fadeIn?: number
  fadeOut?: number
}
interface ExportPayload {
  videoPath: string
  sources?: { path: string }[] // マルチソース。入力に使う元動画一覧（未指定なら[videoPath]）
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
  }[] // 画像クリップ（テロップの下に重ねる）
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

const api = {
  importSrt: (): Promise<{ path: string; content: string; error?: string } | null> =>
    ipcRenderer.invoke('dialog:importSrt'),
  openVideo: (): Promise<{ path: string } | null> => ipcRenderer.invoke('dialog:openVideo'),
  addMedia: (): Promise<{ paths: string[] } | null> => ipcRenderer.invoke('dialog:addMedia'),
  addFolder: (): Promise<{ folder: string; paths: string[] } | null> =>
    ipcRenderer.invoke('dialog:addFolder'),
  listSE: (): Promise<{
    ok: boolean
    root?: string
    items: { category: string; name: string; path: string }[]
  }> => ipcRenderer.invoke('se:list'),
  listTelopPresets: (): Promise<{ ok: boolean; items: unknown[] }> =>
    ipcRenderer.invoke('telop:presets'),
  getDuration: (path: string): Promise<{ ok: boolean; duration?: number }> =>
    ipcRenderer.invoke('media:duration', path),
  getFps: (path: string): Promise<{ ok: boolean; fps?: number }> =>
    ipcRenderer.invoke('media:fps', path),
  generateWaveform: (
    videoPath: string
  ): Promise<{ ok: boolean; min?: number[]; max?: number[]; duration?: number; error?: string }> =>
    ipcRenderer.invoke('audio:waveform', videoPath),
  /** 喋っていない所を探す（noiseDb=これより静かなら無音, minSec=これより短いのは無視） */
  detectSilences: (
    videoPath: string,
    noiseDb?: number,
    minSec?: number
  ): Promise<{ ok: boolean; silences?: { start: number; dur: number }[]; error?: string }> =>
    ipcRenderer.invoke('audio:silences', videoPath, noiseDb, minSec),
  generateThumbnail: (
    videoPath: string
  ): Promise<{ ok: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke('video:thumbnail', videoPath),
  // height=プレビュー解像度（360/720。未指定は360）。解像度ごとに別キャッシュになる。
  generateProxy: (
    videoPath: string,
    height?: number
  ): Promise<{ ok: boolean; path?: string; cached?: boolean; error?: string }> =>
    ipcRenderer.invoke('video:proxy', videoPath, height),
  onProxyProgress: (cb: (data: { path: string; percent: number }) => void): (() => void) => {
    const h = (_e: unknown, data: { path: string; percent: number }): void => cb(data)
    ipcRenderer.on('video:proxy:progress', h)
    return () => ipcRenderer.removeListener('video:proxy:progress', h)
  },
  exportVideo: (
    payload: ExportPayload
  ): Promise<{ ok: boolean; outPath?: string; error?: string; canceled?: boolean }> =>
    ipcRenderer.invoke('export:run', payload),
  cancelExport: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('export:cancel'),
  onExportProgress: (cb: (data: { percent: number }) => void): (() => void) => {
    const h = (_e: unknown, data: { percent: number }): void => cb(data)
    ipcRenderer.on('export:progress', h)
    return () => ipcRenderer.removeListener('export:progress', h)
  },
  // curPath があり asNew でなければ上書き保存（ダイアログを出さない）
  saveProject: (
    json: string,
    curPath?: string | null,
    asNew?: boolean
  ): Promise<{ ok: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke('project:save', json, curPath, asNew),
  saveImage: (dataUrl: string): Promise<{ ok: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke('image:save', dataUrl),
  // path 省略=ダイアログで選ぶ / path 指定=そのファイルを直接開く（最近使ったプロジェクト）
  openProject: (
    path?: string
  ): Promise<{
    ok: boolean
    path?: string
    data?: unknown
    videoExists?: boolean
    error?: string
  } | null> => ipcRenderer.invoke('project:open', path),
  // ---- 持ち出し（素材ごと1つの ZIP にまとめる／受け取って開く）----
  packProject: (
    json: string,
    suggestName?: string
  ): Promise<{
    ok: boolean
    path?: string
    files?: number
    missing?: string[]
    size?: number
    canceled?: boolean
    error?: string
  }> => ipcRenderer.invoke('pack:save', json, suggestName),
  openPack: (
    zipPath?: string
  ): Promise<{
    ok: boolean
    path?: string
    dir?: string
    data?: unknown
    videoExists?: boolean
    canceled?: boolean
    error?: string
  }> => ipcRenderer.invoke('pack:open', zipPath),
  onPackProgress: (cb: (data: { percent: number }) => void): (() => void) => {
    const h = (_e: unknown, data: { percent: number }): void => cb(data)
    ipcRenderer.on('pack:progress', h)
    return () => ipcRenderer.removeListener('pack:progress', h)
  },
  // ---- プロジェクトテンプレート ----
  listTemplates: (): Promise<{ ok: boolean; items: { name: string; path: string }[]; error?: string }> =>
    ipcRenderer.invoke('template:list'),
  saveTemplate: (name: string, json: string): Promise<{ ok: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke('template:save', name, json),
  loadTemplate: (
    path: string
  ): Promise<{ ok: boolean; path?: string; data?: unknown; videoExists?: boolean; error?: string }> =>
    ipcRenderer.invoke('template:load', path),
  openTemplateDialog: (): Promise<{
    ok: boolean
    path?: string
    data?: unknown
    videoExists?: boolean
    error?: string
  } | null> => ipcRenderer.invoke('template:openDialog'),
  exportSrt: (content: string): Promise<{ ok: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke('srt:export', content),
  autosaveProject: (json: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('project:autosave', json),
  autosaveCheck: (): Promise<{
    exists: boolean
    data?: unknown
    videoExists?: boolean
    mtime?: number
    prev?: { data: unknown; videoExists: boolean; mtime: number }
    onlyPrev?: boolean
  }> => ipcRenderer.invoke('project:autosaveCheck'),
  autosaveClear: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('project:autosaveClear'),
  // 未保存の変更があるかをメインへ通知（ウィンドウを閉じるときの確認に使う）
  setDirty: (dirty: boolean): void => ipcRenderer.send('project:dirty', dirty),
  // 閉じる要求。確認はアプリ内のモーダルで行い、了承したら confirmClose を返す。
  onCloseRequest: (fn: () => void): (() => void) => {
    const h = (): void => fn()
    ipcRenderer.on('app:close-request', h)
    return () => ipcRenderer.removeListener('app:close-request', h)
  },
  confirmClose: (): void => ipcRenderer.send('app:close-confirmed')
}

contextBridge.exposeInMainWorld('giftcut', api)
