// 書き出しの受け渡し。**定義は main/exportTypes.ts が正典。ここでは写さない。**
//
// ## なぜ（2026-08-06）
//
// ここには `ExportFrame` / `ExportSeg` / `ExportSEClip` / `ExportPayload` の
// **78行ぶんの写し**があった。main 側は名前付きの型に分けてあるのに、
// こちらは中身を展開して書き写してあり、**同じ物だと機械は見ていなかった。**
//
// 同じ日に `UpdateState` が3か所にあって、片方だけ新しくなる事故を起こしている
// （理由は shared/updateState.ts の頭）。**受け渡しの約束は1か所にしか書かない。**
export type {
  ExportFrame,
  ExportSeg,
  ExportSEClip,
  ExportPayload
} from '../main/exportTypes'

// **書き写さない。** 前は同じ型が3か所にあって、片方だけ新しくなった
// （理由は shared/updateState.ts の頭）
export type { UpdateState } from '../shared/updateState'

// 持ち出しの受け取り結果。**正典は shared/userAssets**（同じ理由で写さない）
import type { InstalledSettings } from '../shared/userAssets'

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
  /** 素材パック（ZIP）を選んで、置き場（userData）へまとめて入れる */
  importAssetZip: (zipPath?: string) => Promise<{
    ok: boolean
    canceled?: boolean
    /** 入れたフォルダごとの件数 */
    added?: Record<string, number>
    path?: string
    error?: string
  }>
  /** いま動いている本体のバージョン */
  getVersion: () => Promise<string>
  /** 利用者がいじった物の控えを読む（無ければ空。更新・入れ直し・引っ越しで戻す用） */
  readUserStore: () => Promise<{ ok: boolean; data: Record<string, string> }>
  /** 同じ内容をファイルへ写す（変わった時だけ呼ぶ） */
  writeUserStore: (
    data: Record<string, string>
  ) => Promise<{ ok: boolean; path?: string; error?: string }>
  savePerfReport: (
    text: string,
    /** true ならダウンロードへ（確認なし）。既定は userData/perf */
    toDownloads?: boolean
  ) => Promise<{ ok: boolean; path?: string; error?: string }>
  /**
   * 前回が正常に終わったか＋落ちた記録。
   *
   * `crashed` は「前回の起動で印が消えていない」＝**正常終了していない**。
   * 落ちた瞬間に書けるとは限らない（電源断・強制終了）ので、
   * `entries` が空でも `crashed` が真になることはある。理由は main/crashLog
   */
  lastCrash: () => Promise<{
    crashed: boolean
    last?: { at?: string; version?: string; platform?: string }
    entries: { at: string; kind: string; detail: string }[]
  }>
  /** 画面側で握り損ねた例外を、落ちた記録と同じ所へ入れる */
  reportError: (detail: string) => Promise<void>
  /** 更新で消えない置き場（userData の下）を開く。無ければ作ってから開く */
  openFolder: (
    key: 'se' | 'telop' | 'motion' | 'template' | 'data'
  ) => Promise<{ ok: boolean; path?: string; error?: string }>
  getDuration: (path: string) => Promise<{ ok: boolean; duration?: number }>
  getFps: (path: string) => Promise<{ ok: boolean; fps?: number; w?: number; h?: number }>
  defaultExportDir: () => Promise<{ ok: boolean; path?: string }>
  chooseExportDir: (current?: string) => Promise<{ path: string } | null>
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
    /** 一緒に入れた「アプリ側の持ち物」の数 */
    settings?: number
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
    /** 入っていた設定を、この機械へ入れた結果（無ければ null） */
    settings?: InstalledSettings | null
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
  /** 関連付け（ダブルクリック）で開かれたプロジェクトの通知 */
  onOpenProjectPath: (fn: (path: string) => void) => () => void
  // ---- 字幕（聞き取り）----
  /** 聞き取りの準備が手元にあるか。無ければ落とす大きさ（MB） */
  subtitleStatus: () => Promise<{
    ok: boolean
    exe: boolean
    model: boolean
    label: string
    sizeMB: number
  }>
  /** 聞き取る（足りない物があれば先に落とす） */
  runSubtitles: (videoPath: string) => Promise<{
    ok: boolean
    canceled?: boolean
    segs?: { start: number; end: number; text: string }[]
    duration?: number
    error?: string
  }>
  cancelSubtitles: () => Promise<{ ok: boolean }>
  /** 進み具合（落とす → 音を取り出す → 聞き取る） */
  onSubtitleProgress: (fn: (s: unknown) => void) => () => void
  /** SE を置き場へ入れる（paths 省略でファイル選択。フォルダは畳んだ分類として入る） */
  importSe: (paths?: string[]) => Promise<{
    ok: boolean
    canceled?: boolean
    files?: number
    folders?: number
    error?: string
  }>
  /** フォルダを選んで、そのフォルダごと SE へ入れる */
  importSeFolder: () => Promise<{
    ok: boolean
    canceled?: boolean
    files?: number
    folders?: number
    error?: string
  }>
  /** テンプレートを1つ消す（消せるのは自分で作ったぶんだけ。同梱の物は断る） */
  deleteTemplate: (path: string) => Promise<{ ok: boolean; error?: string }>
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
