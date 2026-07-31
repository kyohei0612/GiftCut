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

/** 更新の状況（本体から届く。src/main/updater.ts と同じ形） */
type UpdateState =
  | { phase: 'checking' }
  | { phase: 'none' }
  | { phase: 'downloading'; version: string; percent: number }
  | { phase: 'ready'; version: string; when: 'now' | 'onQuit'; message: string; countdownSec: number }
  | { phase: 'error'; message: string }

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
  /** 素材パック（ZIP）を選んで、置き場へまとめて入れる */
  importAssetZip: (
    zipPath?: string
  ): Promise<{
    ok: boolean
    canceled?: boolean
    added?: Record<string, number>
    path?: string
    error?: string
  }> => ipcRenderer.invoke('assets:importZip', zipPath),
  /** いま動いている本体のバージョン（自動更新で入れ替わったら、その値になる） */
  getVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),
  // ---- 利用者がいじった物（お気に入り等）の控え ----
  // 画面側の保存領域は目に見えないし持ち出せない。同じ内容をファイルにも残す。
  readUserStore: (): Promise<{ ok: boolean; data: Record<string, string> }> =>
    ipcRenderer.invoke('userstore:read'),
  writeUserStore: (
    data: Record<string, string>
  ): Promise<{ ok: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke('userstore:write', data),
  // ---- 動きのプリセット（Premiere から写し取った物）----
  // 形の検査は受け取った側（renderer の sanitizeMotion）でやるので unknown で渡す。
  listMotionPresets: (): Promise<{ ok: boolean; items: unknown[] }> =>
    ipcRenderer.invoke('motion:list'),
  importMotionPresets: (): Promise<{
    ok: boolean
    canceled?: boolean
    path?: string
    items?: unknown[]
    /** ファイルに入っていた数 / 並べた数（＝全部） / 一部だけの数 / 動きが取れなかった数 */
    total?: number
    imported?: number
    partial?: number
    empty?: number
    error?: string
  }> => ipcRenderer.invoke('motion:import'),
  /** 動きの記録を userData/perf へ書く（画面側の blob 保存は Electron では落ちる） */
  savePerfReport: (
    text: string,
    toDownloads?: boolean
  ): Promise<{ ok: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke('perf:save', text, toDownloads),
  /** 更新で消えない置き場をエクスプローラで開く（無ければ作ってから開く） */
  openFolder: (
    key: 'se' | 'telop' | 'motion' | 'template' | 'data'
  ): Promise<{ ok: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke('folder:open', key),
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
  // ---- 自動更新 ----
  onUpdateState: (cb: (s: UpdateState) => void): (() => void) => {
    const h = (_e: unknown, s: UpdateState): void => cb(s)
    ipcRenderer.on('update:state', h)
    return () => ipcRenderer.removeListener('update:state', h)
  },
  /** 「あとで」= この起動中は再起動しない（次に閉じたときに当たる） */
  updateLater: (): void => ipcRenderer.send('update:later'),
  /** 「今すぐ」= すぐ再起動して当てる */
  updateNow: (): void => ipcRenderer.send('update:now'),
  /** 更新の再起動の直前に呼ばれる。今の状態を書き終えたら updateFlushed() を返す */
  onUpdateFlush: (fn: () => void): (() => void) => {
    const h = (): void => fn()
    ipcRenderer.on('update:flush', h)
    return () => ipcRenderer.removeListener('update:flush', h)
  },
  updateFlushed: (): void => ipcRenderer.send('update:flushed'),
  // ---- プロジェクトテンプレート ----
  listTemplates: (): Promise<{ ok: boolean; items: { name: string; path: string }[]; error?: string }> =>
    ipcRenderer.invoke('template:list'),
  /** テンプレートを1つ消す（消せるのは自分で作ったぶんだけ） */
  deleteTemplate: (path: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('template:delete', path),
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
