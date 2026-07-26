import { app, shell, BrowserWindow, ipcMain, dialog, protocol } from 'electron'
import { join, normalize } from 'path'
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  renameSync,
  statSync,
  existsSync,
  readdirSync,
  createReadStream,
  utimesSync
} from 'fs'
import { writeFile as writeFileAsync } from 'fs/promises'
import { createHash } from 'crypto'
import { Readable } from 'stream'
import { spawn, type ChildProcess } from 'child_process'
// フィルタグラフは ffmpeg を起動する前に検証する（入力indexのズレ・ラベルの
// 定義漏れ・無音素材からの音声参照は、起動して初めて分かると原因が読めない）。
import {
  formatGraphProblems,
  hasGraphError,
  validateFilterGraph,
  type GraphInput
} from '../shared/filterGraph'
// 保存するプロジェクトの整合性検査（参照切れ・長さ0・id重複など）
import { checkProject, formatProjectProblems } from '../shared/projectCheck'

// 書き出し中の ffmpeg プロセス（キャンセル用）。exportCanceled でユーザー中断とエラーを区別する。
let currentExportFf: ChildProcess | null = null
let exportCanceled = false
// 走行中の ffmpeg/ffprobe 子プロセスと、書き出し用の一時ディレクトリを追跡する。
// アプリ終了時に kill／削除しないと、UIが無いまま変換が走り続け、temp にPNGが数百枚残る。
// 未保存の変更があるか（renderer から 'project:dirty' で通知される）。×ボタンの確認に使う。
let projectDirty = false
const liveProcs = new Set<ChildProcess>()
const liveTmpDirs = new Set<string>()
// spawn をこのラッパ経由にして、終了時に確実に殺せるようにする（＋任意でタイムアウト）
function trackedSpawn(cmd: string, args: string[], timeoutMs = 0): ChildProcess {
  const p = spawn(cmd, args)
  liveProcs.add(p)
  let timer: NodeJS.Timeout | null = null
  if (timeoutMs > 0) {
    // 破損ファイルやネットワークドライブで ffprobe がハングしても Promise が永久未解決にならないように
    timer = setTimeout(() => {
      try {
        p.kill('SIGKILL')
      } catch {
        /* noop */
      }
    }, timeoutMs)
  }
  const done = (): void => {
    liveProcs.delete(p)
    if (timer) clearTimeout(timer)
  }
  p.on('close', done)
  p.on('error', done)
  return p
}
function killAllChildren(): void {
  for (const p of Array.from(liveProcs)) {
    try {
      p.kill('SIGKILL')
    } catch {
      /* noop */
    }
  }
  liveProcs.clear()
  for (const d of Array.from(liveTmpDirs)) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      /* noop */
    }
  }
  liveTmpDirs.clear()
}

// 動画に音声ストリームがあるか（ffprobe）。書き出しの音声連結の可否判定に使う。
// ffprobe 不在等は 'unknown' を返し、呼び出し側は「音声あり」として扱う（無言化を避ける）。
function hasAudioStream(path: string): Promise<boolean | 'unknown'> {
  return new Promise((resolve) => {
    const p = trackedSpawn('ffprobe', [
      '-v',
      'error',
      '-select_streams',
      'a',
      '-show_entries',
      'stream=index',
      '-of',
      'csv=p=0',
      path
    ], 20000)
    let out = ''
    p.stdout?.on('data', (d) => {
      out += d.toString()
    })
    p.on('error', () => resolve('unknown')) // ffprobe が見つからない等
    p.on('close', () => resolve(out.trim().length > 0))
  })
}

function mimeFor(p: string): string {
  switch (p.toLowerCase().split('.').pop()) {
    case 'mp4':
      return 'video/mp4'
    case 'mov':
      return 'video/quicktime'
    case 'mkv':
      return 'video/x-matroska'
    case 'webm':
      return 'video/webm'
    case 'avi':
      return 'video/x-msvideo'
    case 'png':
      return 'image/png'
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    default:
      return 'application/octet-stream'
  }
}

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
  vol?: number // 音量倍率
  afadeIn?: number // 音声フェードイン秒
  afadeOut?: number // 音声フェードアウト秒
  zoom?: { scale: number; x: number; y: number } // リフレーム（切片ごと）
  crop?: { l: number; t: number; r: number; b: number } // クロップ（各辺の切り抜き率, 切った領域は黒）
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
  // 画像クリップ（テロップの下に重ねる）。変形/調整は動画切片と同じモデル。
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
  totalDurationSec?: number // 進捗%算出用の出力尺
  fps?: number // 書き出しフレームレート（既定30）
  crf?: number // 画質（x264 CRF。小さいほど高画質。既定23）
}

// gcfile:// で配信してよいファイルの allowlist（ダイアログで開いた/アプリが生成したものだけ）
const allowedFiles = new Set<string>()
function allowFile(p: string): void {
  allowedFiles.add(normalize(p))
}

// ローカル動画を http オリジンから読むための特権スキーム
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'gcfile',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true }
  }
])

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 680,
    show: false,
    backgroundColor: '#1b1b1e',
    autoHideMenuBar: true,
    title: 'GiftCut',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow.show())

  // 未保存の変更があるまま閉じようとしたら確認する（無警告で編集内容を失わないため）。
  // allowClose を立ててから閉じ直すので、2回目は素通りする。
  let allowClose = false
  mainWindow.on('close', (e) => {
    if (allowClose || !projectDirty) return
    e.preventDefault()
    const r = dialog.showMessageBoxSync(mainWindow, {
      type: 'warning',
      buttons: ['閉じる', 'キャンセル'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
      title: 'GiftCut',
      message: '保存していない変更があります',
      detail:
        '閉じると、最後の保存以降の変更は自動保存の下書きにだけ残ります。\n次回の起動時に復元できます。'
    })
    if (r === 0) {
      allowClose = true
      mainWindow.close()
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // dev: electron-vite が渡す URL / prod: ビルド済み HTML
  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// 終了時: 走行中の ffmpeg を全部殺し、書き出し用の一時ディレクトリを削除する。
// これが無いと、書き出し/プロキシ生成中にウィンドウを閉じた場合に変換が裏で走り続け、
// temp にテロップPNGが数百枚残ったままになる（実測で残存を確認）。
app.on('before-quit', killAllChildren)
app.on('will-quit', killAllChildren)

app.whenReady().then(() => {
  // 起動時に、前回落ちたときの書き出し一時ディレクトリを掃除する（1回の失敗で数MB〜が残る）
  try {
    const tempRoot = app.getPath('temp')
    for (const f of readdirSync(tempRoot)) {
      if (!/^giftcut_\d+$/.test(f)) continue
      try {
        const st = statSync(join(tempRoot, f))
        // 1時間以上前のものだけ（多重起動中の別インスタンスのものを消さない）
        if (Date.now() - st.mtimeMs > 3600_000)
          rmSync(join(tempRoot, f), { recursive: true, force: true })
      } catch {
        /* 無視 */
      }
    }
  } catch {
    /* 無視 */
  }
  // gcfile://media/<パス> → ローカルファイルを配信（allowlist にあるものだけ）
  // 動画の途中シークに必須の HTTP Range (206 Partial Content) を自前で処理する
  protocol.handle('gcfile', (request) => {
    const url = new URL(request.url)
    const filePath = normalize(decodeURIComponent(url.pathname).replace(/^\//, ''))
    if (!allowedFiles.has(filePath)) {
      return new Response('forbidden', { status: 403 })
    }
    let size: number
    try {
      size = statSync(filePath).size
    } catch {
      return new Response('not found', { status: 404 })
    }
    const type = mimeFor(filePath)
    const range = request.headers.get('Range')
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range)
      let start = m && m[1] !== '' ? parseInt(m[1], 10) : 0
      let end = m && m[2] !== '' ? parseInt(m[2], 10) : size - 1
      if (isNaN(start) || start < 0) start = 0
      if (isNaN(end) || end >= size) end = size - 1
      if (start > end) start = 0
      const stream = createReadStream(filePath, { start, end })
      return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
        status: 206,
        headers: {
          'Content-Type': type,
          'Content-Range': `bytes ${start}-${end}/${size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': String(end - start + 1)
        }
      })
    }
    return new Response(Readable.toWeb(createReadStream(filePath)) as unknown as ReadableStream, {
      status: 200,
      headers: {
        'Content-Type': type,
        'Accept-Ranges': 'bytes',
        'Content-Length': String(size)
      }
    })
  })

  // SRT インポート: ファイルを開いて中身を返す
  ipcMain.handle('dialog:importSrt', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'SRT ファイルを選択',
      filters: [{ name: 'Subtitle (SRT)', extensions: ['srt'] }],
      properties: ['openFile']
    })
    if (canceled || filePaths.length === 0) return null
    try {
      const content = readFileSync(filePaths[0], 'utf-8')
      return { path: filePaths[0], content }
    } catch (err) {
      return { path: filePaths[0], content: '', error: String(err) }
    }
  })

  // 動画インポート: パスだけ返す（gcfile 配信を許可）
  ipcMain.handle('dialog:openVideo', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: '動画を選択',
      filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi'] }],
      properties: ['openFile']
    })
    if (canceled || filePaths.length === 0) return null
    allowFile(filePaths[0])
    return { path: filePaths[0] }
  })

  // メディアの尺（秒）を取得（SE をタイムラインに置く時の長さ用）
  ipcMain.handle('media:duration', async (_e, path: string) => {
    if (!path || !allowedFiles.has(normalize(path))) return { ok: false }
    return await new Promise((resolve) => {
      const p = trackedSpawn('ffprobe', [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'csv=p=0',
        path
      ])
      let out = ''
      p.stdout?.on('data', (d) => {
        out += d.toString()
      })
      p.on('error', () => resolve({ ok: false }))
      p.on('close', () => {
        const d = parseFloat(out.trim())
        resolve(d > 0 ? { ok: true, duration: d } : { ok: false })
      })
    })
  })

  // 動画の実フレームレート（ffprobe r_frame_rate = "30000/1001" 等）を返す。素材fps対応用。
  ipcMain.handle('media:fps', async (_e, path: string) => {
    if (!path || !allowedFiles.has(normalize(path))) return { ok: false }
    return await new Promise((resolve) => {
      const p = trackedSpawn('ffprobe', [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=r_frame_rate',
        '-of',
        'csv=p=0',
        path
      ])
      let out = ''
      p.stdout?.on('data', (d) => {
        out += d.toString()
      })
      p.on('error', () => resolve({ ok: false }))
      p.on('close', () => {
        const s = out.trim()
        const m = /^(\d+)\/(\d+)$/.exec(s)
        const fps = m ? Number(m[1]) / Number(m[2]) : parseFloat(s)
        resolve(fps > 0 && isFinite(fps) ? { ok: true, fps } : { ok: false })
      })
    })
  })

  // メディア（動画/音声/画像）を複数追加。gcfile 配信を許可してパス一覧を返す
  const MEDIA_EXT = [
    'mp4', 'mov', 'mkv', 'webm', 'avi',
    'mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac',
    'png', 'jpg', 'jpeg', 'gif', 'webp'
  ]
  ipcMain.handle('dialog:addMedia', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'メディアを追加',
      filters: [
        { name: 'メディア', extensions: MEDIA_EXT },
        { name: 'すべて', extensions: ['*'] }
      ],
      properties: ['openFile', 'multiSelections']
    })
    if (canceled || filePaths.length === 0) return null
    filePaths.forEach((p) => allowFile(p))
    return { paths: filePaths }
  })

  // フォルダを追加（再帰的にメディアファイルを集める。SE のフォルダごと追加用）
  ipcMain.handle('dialog:addFolder', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'フォルダを追加',
      properties: ['openDirectory']
    })
    if (canceled || filePaths.length === 0) return null
    const root = filePaths[0]
    const found: string[] = []
    const walk = (dir: string, depth: number): void => {
      if (depth > 6) return
      let entries: import('fs').Dirent[]
      try {
        entries = readdirSync(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const ent of entries) {
        const full = join(dir, ent.name)
        if (ent.isDirectory()) walk(full, depth + 1)
        else {
          const ext = ent.name.toLowerCase().split('.').pop() ?? ''
          if (MEDIA_EXT.includes(ext)) {
            allowFile(full)
            found.push(full)
          }
        }
      }
    }
    walk(root, 0)
    return { folder: root.split(/[\\/]/).pop() ?? root, paths: found }
  })

  // 内蔵SEライブラリ: GiftCut/SE をサブフォルダ=カテゴリで列挙。
  // 各ファイルを allowlist に登録してプレビュー再生(gcfile://)を可能にする。
  // ※効果音ラボ由来のため配布ビルドにはSEフォルダを含めない（無ければ空を返す）。
  ipcMain.handle('se:list', () => {
    const AUDIO = ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac']
    const candidates = [join(process.cwd(), 'SE'), join(app.getAppPath(), 'SE')]
    const root = candidates.find((r) => existsSync(r))
    if (!root) return { ok: false, items: [] as { category: string; name: string; path: string }[] }
    const items: { category: string; name: string; path: string }[] = []
    const isAudio = (n: string): boolean => AUDIO.includes(n.toLowerCase().split('.').pop() ?? '')
    const nameOf = (n: string): string => n.replace(/\.[^.]+$/, '')
    let entries: import('fs').Dirent[]
    try {
      entries = readdirSync(root, { withFileTypes: true })
    } catch {
      return { ok: false, items }
    }
    for (const ent of entries) {
      const full = join(root, ent.name)
      if (ent.isDirectory()) {
        let sub: string[]
        try {
          sub = readdirSync(full)
        } catch {
          continue
        }
        for (const f of sub) {
          if (isAudio(f)) {
            const p = join(full, f)
            allowFile(p)
            items.push({ category: ent.name, name: nameOf(f), path: p })
          }
        }
      } else if (isAudio(ent.name)) {
        allowFile(full)
        items.push({ category: 'その他', name: nameOf(ent.name), path: full })
      }
    }
    return { ok: true, root, items }
  })

  // ローカルのテロップテンプレ集（GiftCut/telop-presets/*.json）。Geba等・配布に含めない。
  ipcMain.handle('telop:presets', () => {
    const candidates = [join(process.cwd(), 'telop-presets'), join(app.getAppPath(), 'telop-presets')]
    const root = candidates.find((r) => existsSync(r))
    if (!root) return { ok: false, items: [] as unknown[] }
    const items: unknown[] = []
    let files: string[]
    try {
      files = readdirSync(root)
    } catch {
      return { ok: false, items }
    }
    for (const f of files) {
      if (!f.toLowerCase().endsWith('.json')) continue
      try {
        const arr = JSON.parse(readFileSync(join(root, f), 'utf-8'))
        if (Array.isArray(arr)) {
          for (const t of arr) if (t && t.name && t.style) items.push(t)
        }
      } catch {
        /* 壊れたJSONはスキップ */
      }
    }
    return { ok: true, items }
  })

  // プロジェクト保存（JSON を .gcproj として書き出す）
  // curPath があり asNew でなければ「上書き保存」＝ダイアログを出さない
  // （毎回ダイアログだと project(1).gcproj が増殖して最新版が分からなくなるため）。
  ipcMain.handle(
    'project:save',
    async (_e, json: string, curPath?: string | null, asNew?: boolean) => {
      let target = curPath && !asNew && existsSync(curPath) ? curPath : null
      if (!target) {
        const save = await dialog.showSaveDialog({
          title: asNew ? 'プロジェクトを別名で保存' : 'プロジェクトを保存',
          defaultPath: curPath || 'project.gcproj',
          filters: [{ name: 'GiftCut Project', extensions: ['gcproj', 'json'] }]
        })
        if (save.canceled || !save.filePath) return { ok: false, error: 'キャンセル' }
        target = save.filePath
      }
      try {
        // 一時ファイルへ書いてから rename（書き込み中のクラッシュ/電源断で本体を壊さない）
        const tmpFile = target + '.tmp'
        writeFileSync(tmpFile, json, 'utf-8')
        renameSync(tmpFile, target)
        // 保存したものが壊れていないかを毎回検査する（保存自体は止めない）
        inspectProject(json, 'save')
        return { ok: true, path: target }
      } catch (e) {
        return { ok: false, error: String(e) }
      }
    }
  )

  // スクリーンショット保存（data:image/png;base64 を PNG として書き出す）
  ipcMain.handle('image:save', async (_e, dataUrl: string) => {
    const save = await dialog.showSaveDialog({
      title: 'スクショを保存',
      defaultPath: 'giftcut_screenshot.png',
      filters: [{ name: 'PNG', extensions: ['png'] }]
    })
    if (save.canceled || !save.filePath) return { ok: false, error: 'キャンセル' }
    try {
      const b64 = dataUrl.replace(/^data:image\/png;base64,/, '')
      writeFileSync(save.filePath, Buffer.from(b64, 'base64'))
      return { ok: true, path: save.filePath }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  // ---- 自動保存 / クラッシュ復帰 ----
  const autosavePath = (): string => join(app.getPath('userData'), 'giftcut-autosave.json')

  // 保存のたびにプロジェクトの整合性を検査する。
  // 「壊れたプロジェクトを保存してしまい、開き直して初めて気づく」を無くすため、
  // ファイルの場所を探してコマンドを打つのではなく、保存経路そのものに検査を挿す。
  // 保存自体は絶対に止めない（作業内容を失う方が害が大きい）。結果は
  // userData/giftcut-check.json に残し、問題があればコンソールにも出す。
  const checkReportPath = (): string => join(app.getPath('userData'), 'giftcut-check.json')
  const inspectProject = (json: string, origin: string): void => {
    try {
      const problems = checkProject(JSON.parse(json))
      const errors = problems.filter((x: { severity: string }) => x.severity === 'error')
      writeFileSync(
        checkReportPath(),
        JSON.stringify(
          {
            ok: errors.length === 0,
            origin,
            errors: errors.length,
            warnings: problems.length - errors.length,
            problems
          },
          null,
          2
        ),
        'utf-8'
      )
      if (problems.length) {
        console.warn(`[project:${origin}] 整合性の指摘:\n` + formatProjectProblems(problems))
      }
    } catch {
      // 検査で保存を妨げない
    }
  }
  ipcMain.handle('project:autosave', async (_e, json: string) => {
    try {
      // 非同期＋アトミック書き込み（メインスレッドを止めず、途中で落ちても壊れない）。
      // 壊れると autosaveCheck が JSON.parse に失敗し、復帰プロンプトが無言で出なくなる。
      const dst = autosavePath()
      const tmpFile = dst + '.tmp'
      await writeFileAsync(tmpFile, json, 'utf-8')
      renameSync(tmpFile, dst)
      inspectProject(json, 'autosave')
      return { ok: true }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })
  // 起動時: 自動保存の有無・内容・動画の生存を返す（復元プロンプト用）
  ipcMain.handle('project:autosaveCheck', async () => {
    const p = autosavePath()
    if (!existsSync(p)) return { exists: false }
    try {
      const raw = readFileSync(p, 'utf-8')
      const data = JSON.parse(raw)
      const mtime = statSync(p).mtimeMs
      // 他ハンドラと同様、拡張子ホワイトリスト＋存在チェックでのみ配信許可（任意ファイルを載せない）
      const videoExists = allowProjectMedia(data)
      return { exists: true, data, videoExists, mtime }
    } catch {
      return { exists: false }
    }
  })
  // renderer から未保存状態を受け取る（×ボタンで閉じるときの確認に使う）
  ipcMain.on('project:dirty', (_e, v: boolean) => {
    projectDirty = !!v
  })
  ipcMain.handle('project:autosaveClear', async () => {
    try {
      rmSync(autosavePath(), { force: true })
    } catch {
      /* 無視 */
    }
    return { ok: true }
  })

  // プロジェクトを開く（動画パスが生きていれば gcfile 配信を許可）
  ipcMain.handle('project:open', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'プロジェクトを開く',
      filters: [{ name: 'GiftCut Project', extensions: ['gcproj', 'json'] }],
      properties: ['openFile']
    })
    if (canceled || filePaths.length === 0) return null
    try {
      const data = JSON.parse(readFileSync(filePaths[0], 'utf-8'))
      // 動画/追加ソース/SE/画像のパスを拡張子チェック付きで配信許可（allowProjectMedia と共通）
      const videoExists = allowProjectMedia(data)
      return { ok: true, path: filePaths[0], data, videoExists }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  // ---- プロジェクトテンプレート（GiftCut/テンプレート/*.gcproj）----
  const templatesRoot = (): string => {
    const cands = [join(process.cwd(), 'テンプレート'), join(app.getAppPath(), 'テンプレート')]
    return cands.find((r) => existsSync(r)) || cands[0]
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allowProjectMedia = (data: any): boolean => {
    let videoExists = false
    if (data && typeof data.videoPath === 'string' && data.videoPath) {
      const okExt = /\.(mp4|mov|mkv|webm|avi)$/i.test(data.videoPath)
      videoExists = okExt && existsSync(data.videoPath)
      if (videoExists) allowFile(data.videoPath)
    }
    if (data && Array.isArray(data.seClips)) {
      for (const s of data.seClips) {
        if (s && typeof s.path === 'string' && /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(s.path) && existsSync(s.path))
          allowFile(s.path)
      }
    }
    // マルチソースの追加動画も配信許可（動画拡張子のみ）
    if (data && Array.isArray(data.sources)) {
      for (const s of data.sources) {
        if (s && typeof s.path === 'string' && /\.(mp4|mov|mkv|webm|avi)$/i.test(s.path) && existsSync(s.path))
          allowFile(s.path)
      }
    }
    // 映像レイヤークリップの動画も配信許可（動画拡張子のみ）
    if (data && Array.isArray(data.vClips)) {
      for (const c of data.vClips) {
        if (c && typeof c.path === 'string' && /\.(mp4|mov|mkv|webm|avi)$/i.test(c.path) && existsSync(c.path))
          allowFile(c.path)
      }
    }
    // 画像クリップも配信許可（画像拡張子のみ）
    if (data && Array.isArray(data.imgClips)) {
      for (const c of data.imgClips) {
        if (c && typeof c.path === 'string' && /\.(png|jpe?g|gif|webp)$/i.test(c.path) && existsSync(c.path))
          allowFile(c.path)
      }
    }
    // テンプレートのメディアビン（動画/音声/画像）も配信許可
    if (data && Array.isArray(data.mediaItems)) {
      for (const m of data.mediaItems) {
        if (
          m &&
          typeof m.path === 'string' &&
          /\.(mp4|mov|mkv|webm|avi|mp3|wav|m4a|aac|ogg|flac|png|jpe?g|gif|webp)$/i.test(m.path) &&
          existsSync(m.path)
        )
          allowFile(m.path)
      }
    }
    return videoExists
  }
  ipcMain.handle('template:list', () => {
    const root = templatesRoot()
    if (!existsSync(root)) return { ok: true, items: [] as { name: string; path: string }[] }
    try {
      const items = readdirSync(root)
        .filter((f) => /\.(gcproj|json)$/i.test(f))
        .map((f) => ({ name: f.replace(/\.(gcproj|json)$/i, ''), path: join(root, f) }))
      return { ok: true, items }
    } catch (e) {
      return { ok: false, items: [] as { name: string; path: string }[], error: String(e) }
    }
  })
  ipcMain.handle('template:save', (_e, name: string, json: string) => {
    try {
      const root = templatesRoot()
      mkdirSync(root, { recursive: true })
      const safe = (String(name || 'テンプレート').replace(/[\\/:*?"<>|]/g, '_').trim() || 'テンプレート')
      const p = join(root, safe + '.gcproj')
      writeFileSync(p, json, 'utf-8')
      return { ok: true, path: p }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })
  ipcMain.handle('template:load', (_e, path: string) => {
    try {
      const root = normalize(templatesRoot())
      const p = normalize(String(path))
      if (!p.startsWith(root)) return { ok: false, error: '不正なパス' }
      const data = JSON.parse(readFileSync(p, 'utf-8'))
      const videoExists = allowProjectMedia(data)
      return { ok: true, path: p, data, videoExists }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })
  ipcMain.handle('template:openDialog', async () => {
    const root = templatesRoot()
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'テンプレートを開く',
      defaultPath: existsSync(root) ? root : undefined,
      filters: [{ name: 'GiftCut Template', extensions: ['gcproj', 'json'] }],
      properties: ['openFile']
    })
    if (canceled || filePaths.length === 0) return null
    try {
      const data = JSON.parse(readFileSync(filePaths[0], 'utf-8'))
      const videoExists = allowProjectMedia(data)
      return { ok: true, path: filePaths[0], data, videoExists }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  // SRT 書き出し
  ipcMain.handle('srt:export', async (_e, content: string) => {
    const save = await dialog.showSaveDialog({
      title: 'SRT を書き出し',
      defaultPath: 'subtitles.srt',
      filters: [{ name: 'SubRip', extensions: ['srt'] }]
    })
    if (save.canceled || !save.filePath) return { ok: false, error: 'キャンセル' }
    try {
      writeFileSync(save.filePath, content, 'utf-8')
      return { ok: true, path: save.filePath }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  // サムネイル生成（先頭付近の1フレーム）。ライブラリで複数保持するので削除はしない
  // キャッシュのプルーニング: dir 内の match するファイルを新しい順に keep 個だけ残し、古いものを削除。
  // ※プロキシは容量ベースのLRUが必要なので pruneProxyCache を使う（こちらはサムネ用）
  const pruneCache = (dir: string, match: (f: string) => boolean, keep: number): void => {
    try {
      const files = readdirSync(dir)
        .filter(match)
        .map((f) => {
          try {
            return { f, t: statSync(join(dir, f)).mtimeMs }
          } catch {
            return { f, t: 0 }
          }
        })
        .sort((a, b) => b.t - a.t)
      for (const x of files.slice(keep)) {
        try {
          rmSync(join(dir, x.f), { force: true })
        } catch {
          /* 無視 */
        }
      }
    } catch {
      /* 無視 */
    }
  }

  // 編集用プロキシのディレクトリ。userData 配下に置き、キャッシュとして使い回す。
  const proxyDir = join(app.getPath('userData'), 'giftcut-proxies')
  // プロキシキャッシュの上限。360p/720p の2解像度ぶんが並ぶうえ長尺なら1本数十MB〜になるため、
  // 本数だけでは数GBまで膨らんでしまう。総容量で制限し、超過ぶんだけ古い順に削除する。
  const PROXY_CACHE_MAX_BYTES = 3 * 1024 * 1024 * 1024 // 3GB
  const PROXY_CACHE_MAX_FILES = 200 // 極端に短い素材ばかりのときの本数上限
  // このセッションで返した（＝いま編集中のプロジェクトが使っている）プロキシは削除しない。
  // 以前は生成時刻の降順で切っていたため、使用中でも「古い」だけで消され再変換が走っていた。
  const proxyInUse = new Set<string>()
  // プロキシキャッシュの掃除（LRU）。古さは *最終アクセス時刻*（キャッシュヒット時に mtime を
  // 更新している）で判定し、総容量／本数の超過ぶんだけ古い方から消す。
  const pruneProxyCache = (dir: string): void => {
    try {
      const files: { f: string; t: number; size: number }[] = []
      for (const f of readdirSync(dir)) {
        if (f.endsWith('.tmp.mp4')) {
          // 生成途中は消さない（消すと破損プロキシになる）。ただし1時間以上前のものは
          // 前回の異常終了で残った孤児なので消す。
          try {
            const st = statSync(join(dir, f))
            if (Date.now() - st.mtimeMs > 3600_000) rmSync(join(dir, f), { force: true })
          } catch {
            /* 無視 */
          }
          continue
        }
        if (!f.endsWith('.mp4')) continue
        try {
          const st = statSync(join(dir, f))
          files.push({ f, t: st.mtimeMs, size: st.size })
        } catch {
          /* 無視 */
        }
      }
      files.sort((a, b) => b.t - a.t) // 最終アクセスが新しい順に残す
      let bytes = 0
      let count = 0
      for (const x of files) {
        const over = bytes + x.size > PROXY_CACHE_MAX_BYTES || count + 1 > PROXY_CACHE_MAX_FILES
        if (over && !proxyInUse.has(x.f)) {
          try {
            rmSync(join(dir, x.f), { force: true })
          } catch {
            /* 無視 */
          }
          continue
        }
        // 使用中のものは上限を超えていても残す（そのぶん枠を消費させる）
        bytes += x.size
        count++
      }
    } catch {
      /* 無視 */
    }
  }
  // 起動時にも一度掃除する。従来は「プロキシ新規生成の成功時」しか走らなかったため、
  // 上限を超えたまま起動しても解消されなかった。
  pruneProxyCache(proxyDir)

  ipcMain.handle('video:thumbnail', async (_e, videoPath: string) => {
    if (!videoPath) return { ok: false, error: 'パスがありません' }
    if (!allowedFiles.has(normalize(videoPath)))
      return { ok: false, error: '許可されていないファイルです' }
    // 古いサムネを掃除（temp に無制限に溜まるのを防ぐ）。最新100枚だけ残す。
    pruneCache(app.getPath('temp'), (f) => /^giftcut_thumb_.*\.png$/.test(f), 100)
    const out = join(app.getPath('temp'), 'giftcut_thumb_' + Date.now() + '.png')
    const args = ['-y', '-ss', '0.5', '-i', videoPath, '-frames:v', '1', '-vf', 'scale=240:-1', out]
    return await new Promise((resolve) => {
      const ff = spawn('ffmpeg', args)
      let err = ''
      ff.stderr.on('data', (d) => {
        err += d.toString()
      })
      ff.on('error', (e) => resolve({ ok: false, error: e.message }))
      ff.on('close', (code) => {
        if (code === 0) {
          allowFile(out)
          resolve({ ok: true, path: out })
        } else resolve({ ok: false, error: err.slice(-200) })
      })
    })
  })

  // 編集用プロキシ生成: 低解像度・短GOP（キーフレーム密）に変換し、プレビューのシークを一瞬にする。
  // 元動画のキーフレームが疎（例: 8秒間隔）だとシークに数百msかかり、カット通過や再生開始でカクつくため。
  // 書き出しは元ファイル(videoPath)を使うので画質は劣化しない。結果はキャッシュして再変換を避ける。
  // height でプレビュー解像度を選べる（既定360。renderer の「プレビュー解像度」設定に対応）。
  ipcMain.handle('video:proxy', async (e, videoPath: string, height?: number) => {
    if (!videoPath || !existsSync(videoPath)) return { ok: false, error: 'ファイルがありません' }
    if (!allowedFiles.has(normalize(videoPath)))
      return { ok: false, error: '許可されていないファイルです' }
    // 想定外の値でおかしなサイズに変換しないよう、扱う解像度は固定の候補だけに絞る
    const proxyH = height === 720 ? 720 : 360
    try {
      mkdirSync(proxyDir, { recursive: true })
    } catch {
      /* 既存 */
    }
    const st = statSync(videoPath)
    // 解像度もキーに含める。含めないと 360p と 720p が同じファイル名になり、
    // 先に作った方がもう一方として使い回されて解像度が取り違えられる。
    const key = createHash('md5')
      .update(normalize(videoPath) + '|' + st.size + '|' + Math.round(st.mtimeMs) + '|h' + proxyH)
      .digest('hex')
    const outPath = join(proxyDir, key + '.mp4')
    if (existsSync(outPath)) {
      allowFile(outPath)
      proxyInUse.add(key + '.mp4') // 使用中なので prune の対象外にする
      // LRU の印: 「使った」時刻を mtime に書く（古さを生成時刻ではなく最終アクセスで判定するため）
      try {
        utimesSync(outPath, new Date(), new Date())
      } catch {
        /* 無視 */
      }
      !e.sender.isDestroyed() && e.sender.send('video:proxy:progress', { path: videoPath, percent: 100 })
      return { ok: true, path: outPath, cached: true }
    }
    // 進捗計算用に総時間を取得
    const durSec = await new Promise<number>((resolve) => {
      const p = spawn('ffprobe', [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        videoPath
      ])
      let o = ''
      p.stdout.on('data', (d) => (o += d.toString()))
      p.on('close', () => resolve(parseFloat(o) || 0))
      p.on('error', () => resolve(0))
    })
    const tmp = join(proxyDir, key + '.tmp.mp4')
    const args = [
      '-y',
      '-i',
      videoPath,
      '-vf',
      `scale=-2:${proxyH}`, // 編集用の解像度（書き出しは原本フル画質）
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-tune',
      'fastdecode',
      '-g',
      '15', // キーフレーム0.5秒間隔（30fps基準）＝シーク高速
      '-keyint_min',
      '15',
      '-sc_threshold',
      '0',
      '-crf',
      '30',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-movflags',
      '+faststart',
      tmp
    ]
    return await new Promise((resolve) => {
      const ff = spawn('ffmpeg', args)
      let err = ''
      ff.stderr.on('data', (d) => {
        const s = d.toString()
        err += s
        const m = /time=(\d+):(\d+):(\d+\.\d+)/.exec(s)
        if (m && durSec > 0) {
          const cur = +m[1] * 3600 + +m[2] * 60 + parseFloat(m[3])
          const pct = Math.min(99, Math.max(0, Math.round((cur / durSec) * 100)))
          !e.sender.isDestroyed() && e.sender.send('video:proxy:progress', { path: videoPath, percent: pct })
        }
      })
      ff.on('error', (er) => resolve({ ok: false, error: 'ffmpeg起動失敗: ' + er.message }))
      ff.on('close', (code) => {
        if (code === 0 && existsSync(tmp)) {
          try {
            renameSync(tmp, outPath)
          } catch (er) {
            resolve({ ok: false, error: String(er) })
            return
          }
          allowFile(outPath)
          proxyInUse.add(key + '.mp4') // 使用中なので prune の対象外にする
          // 古いプロキシを掃除（userData に無制限に溜まるのを防ぐ）。総容量ベースのLRU。
          pruneProxyCache(proxyDir)
          !e.sender.isDestroyed() && e.sender.send('video:proxy:progress', { path: videoPath, percent: 100 })
          resolve({ ok: true, path: outPath })
        } else {
          try {
            rmSync(tmp, { force: true })
          } catch {
            /* 無視 */
          }
          resolve({ ok: false, error: 'プロキシ生成失敗 (code ' + code + ')\n' + err.slice(-300) })
        }
      })
    })
  })

  // 波形のピーク値を解析（PCMのバケットごとの min/max を返す）。
  // 精度のポイント: ダウンサンプリングすると リサンプラのローパスで真のピークが潰れるため、
  // 高レート(48kHz)の実サンプルから min/max を取る（ClipGift 相当の正確さ）。
  // 長尺でもメモリを食わないよう、チャンクを溜めずに逐次(ストリーミング)でバケット集計する。
  ipcMain.handle('audio:waveform', async (_e, videoPath: string) => {
    if (!videoPath) return { ok: false, error: 'パスがありません' }
    if (!allowedFiles.has(normalize(videoPath)))
      return { ok: false, error: '許可されていないファイルです' }
    const rate = 48000 // 解析サンプルレート（Hz）。高レートの実サンプルからピークを取る
    const perSec = 300 // 秒あたりバケット数（表示密度）
    const per = Math.max(1, Math.round(rate / perSec)) // 1バケットのサンプル数(=160)
    // -ac 1 でモノラル化（L/R の大きい方を拾うため amerge ではなく単純平均だが、
    // ピーク検出には十分。aresample は 48k 化のみで実質ダウンサンプリングしない）
    const args = ['-v', 'error', '-i', videoPath, '-ac', '1', '-ar', String(rate), '-f', 'f32le', '-']
    return await new Promise((resolve) => {
      const ff = spawn('ffmpeg', args)
      const mins: number[] = []
      const maxs: number[] = []
      let curMin = 0
      let curMax = 0
      let cnt = 0
      let total = 0
      let leftover: Buffer = Buffer.alloc(0)
      let err = ''
      ff.stdout.on('data', (d: Buffer) => {
        const buf = leftover.length ? Buffer.concat([leftover, d]) : d
        const full = Math.floor(buf.length / 4)
        for (let i = 0; i < full; i++) {
          const v = buf.readFloatLE(i * 4)
          if (v > curMax) curMax = v
          if (v < curMin) curMin = v
          total++
          if (++cnt >= per) {
            maxs.push(curMax)
            mins.push(curMin)
            curMin = 0
            curMax = 0
            cnt = 0
          }
        }
        leftover = buf.subarray(full * 4)
      })
      ff.stderr.on('data', (d) => {
        err += d.toString()
      })
      ff.on('error', (e) => resolve({ ok: false, error: 'ffmpeg起動失敗: ' + e.message }))
      ff.on('close', (code) => {
        if (code !== 0) {
          resolve({ ok: false, error: '音声解析失敗（音声がない可能性）\n' + err.slice(-200) })
          return
        }
        if (cnt > 0) {
          maxs.push(curMax)
          mins.push(curMin)
        }
        if (!maxs.length) {
          resolve({ ok: false, error: '音声サンプルがありません' })
          return
        }
        // 長尺でバケットが多すぎる場合は隣接をmin/maxマージ（ピークは保持）してIPC/メモリを抑える
        let fmin = mins
        let fmax = maxs
        const CAP = 300000
        if (maxs.length > CAP) {
          const g = Math.ceil(maxs.length / CAP)
          const gm: number[] = []
          const gx: number[] = []
          for (let i = 0; i < maxs.length; i += g) {
            let mn = 0
            let mx = 0
            for (let j = i; j < Math.min(i + g, maxs.length); j++) {
              if (maxs[j] > mx) mx = maxs[j]
              if (mins[j] < mn) mn = mins[j]
            }
            gx.push(mx)
            gm.push(mn)
          }
          fmin = gm
          fmax = gx
        }
        let peak = 1e-6
        for (let b = 0; b < fmax.length; b++) {
          if (fmax[b] > peak) peak = fmax[b]
          if (-fmin[b] > peak) peak = -fmin[b]
        }
        resolve({
          ok: true,
          min: fmin.map((x) => x / peak),
          max: fmax.map((x) => x / peak),
          duration: total / rate
        })
      })
    })
  })

  // 動画書き出し（FFmpegでテロップPNGを焼き込み）
  ipcMain.handle('export:cancel', () => {
    if (currentExportFf) {
      exportCanceled = true
      try {
        currentExportFf.kill('SIGKILL')
      } catch {
        /* noop */
      }
      return { ok: true }
    }
    return { ok: false }
  })

  ipcMain.handle('export:run', async (e, payload: ExportPayload) => {
    const { videoPath, width, height, frames, extendSec, segments } = payload
    const baseVol = typeof payload.baseAudioVolume === 'number' ? payload.baseAudioVolume : 1
    if (!videoPath) {
      return { ok: false, error: '動画がありません' }
    }
    // マルチソース: 入力に使う元動画一覧（未指定なら[videoPath]）。存在チェック。
    const inputPaths = payload.sources?.length ? payload.sources.map((s) => s.path) : [videoPath]
    for (const ip of inputPaths) {
      if (!existsSync(ip)) return { ok: false, error: '元の動画ファイルが見つかりません:\n' + ip }
    }
    const nSrc = inputPaths.length
    // 各入力の音声有無（ffprobe不明はありとして扱う）。音声なしソースの切片は無音で埋める。
    const srcHasAudio = await Promise.all(inputPaths.map(async (ip) => (await hasAudioStream(ip)) !== false))
    // 全体として音声を扱うか（どれか1つでも音声があれば音声トラックを作る）
    const audioPresent = srcHasAudio.some(Boolean)
    const save = await dialog.showSaveDialog({
      title: '書き出し先を選択',
      defaultPath: 'giftcut_output.mp4',
      filters: [
        { name: 'MP4', extensions: ['mp4'] },
        { name: 'MOV', extensions: ['mov'] }
      ]
    })
    if (save.canceled || !save.filePath) return { ok: false, error: 'キャンセルされました' }

    // PNG を一時ファイルへ
    const tmp = join(app.getPath('temp'), 'giftcut_' + Date.now())
    mkdirSync(tmp, { recursive: true })
    liveTmpDirs.add(tmp) // アプリ終了時に確実に消せるよう登録（cleanup で外す）
    const pngPaths: string[] = []
    // PNG は tmp 直下に置き、ffmpeg には「相対パス」で渡す（cwd=tmp で spawn する）。
    // 絶対パスだと 1 枚あたり約63字を消費し、テロップが数百枚でコマンドライン長が
    // Windows の上限(32767字)を超えて spawn ENAMETOOLONG になるため。
    frames.forEach((f, i) => {
      const b64 = f.png.replace(/^data:image\/png;base64,/, '')
      writeFileSync(join(tmp, `t${i}.png`), Buffer.from(b64, 'base64'))
      pngPaths.push(`t${i}.png`)
    })

    // FFmpeg 引数を組み立て
    // 実在する SE ファイルのみ採用（欠損ファイルがあると FFmpeg 全体が失敗するため除外）
    const sesRaw = payload.seClips?.filter((s) => s && s.path && existsSync(s.path)) ?? []
    const ses = sesRaw.length ? sesRaw : null
    // 画像クリップ（実在ファイルのみ）
    const imgsRaw = payload.images?.filter((c) => c && c.path && existsSync(c.path)) ?? []
    const imgs = imgsRaw.length ? imgsRaw : null
    // 映像レイヤークリップ（実在ファイルのみ）
    const vcsRaw = payload.vClips?.filter((c) => c && c.path && existsSync(c.path)) ?? []
    const vcs = vcsRaw.length ? vcsRaw : null
    const args = ['-y']
    const segs = segments && segments.length ? segments : null

    // ---- 入力の重複排除 ----
    // 以前は「クリップ1つ＝-i 1本」だったため、同じ動画をレザーで分割すると同じファイルが
    // クリップ数ぶん開かれ、デコーダも同数走った（絶対パスぶんコマンドライン長も膨らむ）。
    // パス→入力index のマップで同一パスは -i 1本にまとめる。入力は
    // 元動画 → テロップPNG → SE → 画像 → 映像レイヤー の順に登録する（従来の並びを踏襲）。
    const inputSpecs: { path: string; ss: number }[] = [] // ss>0 のときだけ -ss を付けて渡す
    const inputIdx = new Map<string, number>()
    const addInput = (p: string): number => {
      const key = normalize(p)
      const found = inputIdx.get(key)
      if (found !== undefined) return found
      inputIdx.set(key, inputSpecs.length)
      inputSpecs.push({ path: p, ss: 0 })
      return inputSpecs.length - 1
    }
    // 各パスを使うクリップ数。1つだけなら入力 -ss でデコード開始位置を飛ばせる（下記）。
    const userCount = new Map<string, number>()
    const addUser = (p: string): void => {
      const key = normalize(p)
      userCount.set(key, (userCount.get(key) ?? 0) + 1)
    }
    if (segs) segs.forEach((s) => addUser(inputPaths[s.srcIdx ?? 0]))
    else inputPaths.forEach((ip) => addUser(ip)) // カット無し＝元動画をそのまま使う（trim が無いので -ss 不可）
    ses?.forEach((se) => addUser(se.path))
    imgs?.forEach((im) => addUser(im.path))
    vcs?.forEach((vc) => addUser(vc.path))
    const srcInput = inputPaths.map((ip) => addInput(ip)) // 元動画の srcIdx → 入力index
    const pngInput = pngPaths.map((p) => addInput(p))
    const seInput = ses ? ses.map((se) => addInput(se.path)) : []
    const imgInput = imgs ? imgs.map((im) => addInput(im.path)) : []
    const vcInput = vcs ? vcs.map((vc) => addInput(vc.path)) : []

    // 入力 -ss: 素材の後半だけ使うクリップでも毎回先頭からデコードしていたのを短縮する。
    // 要求位置より SS_MARGIN 秒手前から復号し、trim を同じ量だけ前へずらす
    // （切り出す区間は不変＝出力は従来と一致。手前から始めるのはシーク境界のズレを吸収するため）。
    // 付けられる条件（正しさを優先して厳しめにする）:
    //  ・そのパスを使うクリップが1つだけ（-ss は入力単位なので共有すると他クリップまでずれる）
    //  ・その入力の音声をフィルタで使わない（映像は全コンテナでフレーム一致を実測したが、
    //    opus/vorbis/mp3 はシーク後にサンプル位置が数サンプルずれ得るため音声には使わない）
    const SS_MARGIN = 1
    const ssOffsetOf = (idx: number, wantSec: number, audioUsed: boolean): number => {
      const spec = inputSpecs[idx]
      if (spec.ss > 0) return spec.ss // 同じクリップの映像/音声で2回呼ばれるので使い回す
      if (audioUsed) return 0
      if (userCount.get(normalize(spec.path)) !== 1) return 0
      const off = Math.round((wantSec - SS_MARGIN) * 1000) / 1000 // -ss と trim で同一の値を使う
      if (off <= 0.05) return 0
      spec.ss = off
      return off
    }

    // ---- 入力ラベルの払い出し ----
    // 1つの入力を複数クリップで使うときは split/asplit で必要本数に分けてから各 trim へ渡す
    // （同じ入力ラベルを2箇所以上から直接参照するとフィルタグラフが成立しない）。
    // 本数はフィルタを組み終わるまで分からないので、いったんプレースホルダを書き、
    // 最後に split 宣言を先頭へ足しつつ実ラベルへ置換する（1箇所だけなら [N:v] を直接使う＝従来と同じ）。
    const vUses: number[] = []
    const aUses: number[] = []
    const useV = (idx: number): string => {
      const n = vUses[idx] ?? 0
      vUses[idx] = n + 1
      return `@V${idx}_${n}@`
    }
    const useA = (idx: number): string => {
      const n = aUses[idx] ?? 0
      aUses[idx] = n + 1
      return `@A${idx}_${n}@`
    }
    const resolveInputLabels = (f: string): string => {
      let pre = ''
      const fix = (uses: number[], tag: 'V' | 'A', st: 'v' | 'a'): void => {
        uses.forEach((n, idx) => {
          if (!n) return
          if (n === 1) {
            f = f.replace(`@${tag}${idx}_0@`, `[${idx}:${st}]`)
            return
          }
          const labels: string[] = []
          for (let i = 0; i < n; i++) labels.push(`[x${tag}${idx}_${i}]`)
          pre += `[${idx}:${st}]${st === 'v' ? 'split' : 'asplit'}=${n}${labels.join('')};`
          labels.forEach((l, i) => {
            f = f.replace(`@${tag}${idx}_${i}@`, l)
          })
        })
      }
      fix(vUses, 'V', 'v')
      fix(aUses, 'A', 'a')
      return pre + f
    }

    // 映像レイヤー素材に音声があるか（無い素材の [N:a] を参照すると書き出しが失敗する）
    const vcHasAudio = vcs
      ? await Promise.all(vcs.map(async (c) => (await hasAudioStream(c.path)) !== false))
      : []
    let filter = ''
    // カット無し（segs なし）のときだけ元動画をベース映像として直接使う。segs ありでは
    // [vcat] に差し替わるので、ここでラベルを払い出してはいけない（未使用の split 出力はエラー）。
    let baseLabel = segs ? '' : useV(srcInput[0])
    let audioMap: string[] = audioPresent ? ['-map', '0:a?'] : []

    // 出力フレームレート（書き出し設定。既定30）。フィルタ全体で統一する。
    // 「素材と同じ」で 29.97 のような NTSC 系が来るため、以前の Math.round は使えない
    // （29.97 が 30 に化けて素材と1000/1001だけズレ、長尺で音ズレ・尺ズレになる）。
    const outFps =
      typeof payload.fps === 'number' && Number.isFinite(payload.fps) && payload.fps > 0
        ? Math.min(240, Math.max(1, payload.fps))
        : 30
    // ffmpeg へ渡す表記。29.97 等は10進で渡すと丸め誤差が出るので分数(30000/1001)にする。
    // 数値計算（半フレーム詰め）には実数の outFps を使い、表記だけ分数に切り替える。
    const fpsArg = ((): string => {
      const n = Math.round((outFps * 1001) / 1000) // NTSC系なら n/1.001 が整数になる
      if (n > 0 && Math.abs(outFps - (n * 1000) / 1001) < 0.005) return `${n * 1000}/1001`
      if (Math.abs(outFps - Math.round(outFps)) < 1e-6) return String(Math.round(outFps))
      return outFps.toFixed(6)
    })()
    // カットを反映: 残った切片を出力解像度に揃えて連結する
    // 各切片を先に scale/pad して同一サイズにするので、黒ブランクも color で混ぜられる
    const scalePad = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fpsArg}`
    if (segs) {
      // カット間クロスディゾルブ: 切片 i の xfade = 「i と i+1 の間」を d 秒重ねて溶かす。
      // モデルは「カット位置で完了する d 秒クロスフェード」——B側をソースの srcStart より
      // d*速度 だけ手前から取り出して頭を d 秒延長し、Aの尻と xfade で重ねる。
      // 出力尺 = lenA + (lenB + d) - d = 不変（テロップ/SEの enable 時刻に影響しない）。
      const spOf = (s: ExportSeg): number => (s.speed && s.speed > 0 ? s.speed : 1)
      const tlenOf = (s: ExportSeg): number => (s.srcEnd - s.srcStart) / spOf(s)
      // ペア (i, i+1) の実効ディゾルブ長（renderer でクランプ済み。最後の切片は次がないので0）
      const xfOf = (i: number): number =>
        i >= 0 && i < segs.length - 1 && segs[i].xfade && segs[i].xfade!.dur > 0.01
          ? segs[i].xfade!.dur
          : 0
      const hasX = segs.some((_, i) => xfOf(i) > 0)
      // xfade は全入力のタイムベース一致を要求する。scalePad の fps=30 が切片を 1/30 に、
      // concat は出力を 1/1000000(AVTB) にするため、混在チェーンでは xfade が
      // "timebase do not match" で失敗する。xfade を使うときは全切片を AVTB に統一する。
      // （非 xfade 経路は従来どおり付けない＝完全な後方互換）
      // トランジション種別ヘルパー（頭/尻/間すべて同じ種類集合）。
      const XF_ALLOWED = new Set([
        'fade',
        'slideleft',
        'slideright',
        'slideup',
        'slidedown',
        'wipeleft',
        'wiperight'
      ])
      const isDipT = (ty?: string): boolean =>
        ty === 'fade' || ty === 'dipblack' || ty === 'dipwhite'
      const dipCol = (ty?: string): string => (ty === 'dipwhite' ? 'white' : 'black')
      // 頭/尻 slide/wipe（黒とのxfade）用の名前
      const motionName = (ty?: string): string => (ty && XF_ALLOWED.has(ty) ? ty : 'fade')
      // 間 xfade 名: 黒/白ディップは fadeblack/fadewhite（沈んで戻る）
      const betweenName = (ty?: string): string =>
        ty === 'dipblack'
          ? 'fadeblack'
          : ty === 'dipwhite'
            ? 'fadewhite'
            : ty && XF_ALLOWED.has(ty)
              ? ty
              : 'fade'
      const motionIn = (s: ExportSeg, i: number): boolean =>
        !!s.transIn && s.transIn.dur > 0 && xfOf(i - 1) <= 0 && !isDipT(s.transIn.type)
      const motionOut = (s: ExportSeg, i: number): boolean =>
        !!s.transOut && s.transOut.dur > 0 && xfOf(i) <= 0 && !isDipT(s.transOut.type)
      // xfade（間 or 頭/尻の黒xfade）を使うなら全入力のタイムベースを AVTB へ統一（"timebase do not match" 回避）
      const needTb = hasX || segs.some((s, i) => motionIn(s, i) || motionOut(s, i))
      const tb = needTb ? ',settb=AVTB' : ''
      segs.forEach((s, i) => {
        const sp = spOf(s)
        const lenN = tlenOf(s)
        const headExt = xfOf(i - 1)
        const extLenN = lenN + headExt
        const trimStart = Math.max(0, s.srcStart - headExt * sp)
        const tin = s.transIn && s.transIn.dur > 0 && headExt <= 0 ? s.transIn : null
        const tout = s.transOut && s.transOut.dur > 0 && xfOf(i) <= 0 ? s.transOut : null
        // dip系（ディゾルブ/黒/白）は fade フィルタで色付き in/out。ディゾルブ境界のディップは出さない。
        let fade = ''
        if (tin && isDipT(tin.type))
          fade += `,fade=t=in:st=0:d=${Math.min(tin.dur, extLenN).toFixed(3)}:color=${dipCol(tin.type)}`
        if (tout && isDipT(tout.type)) {
          const d = Math.min(tout.dur, extLenN)
          fade += `,fade=t=out:st=${(extLenN - d).toFixed(3)}:d=${d.toFixed(3)}:color=${dipCol(tout.type)}`
        }
        // 色調整（明るさ/コントラスト/彩度）。CSS filter に合わせ b は加算(b-1)、c/s は倍率。黒ブランクには不要。
        const adj = s.adjust
        const eq =
          adj && (Math.abs(adj.b - 1) > 1e-3 || Math.abs(adj.c - 1) > 1e-3 || Math.abs(adj.s - 1) > 1e-3)
            ? `,eq=brightness=${(adj.b - 1).toFixed(3)}:contrast=${adj.c.toFixed(3)}:saturation=${adj.s.toFixed(3)}`
            : ''
        // 変形（回転/反転）。scalePad の前に適用＝回転後に出力サイズへフィット。
        // 90°刻みは transpose（劣化なし）、自由角度は rotate フィルタ（黒埋め）。
        let xf = ''
        const rot = ((Math.round(s.rotate ?? 0) % 360) + 360) % 360
        if (rot === 90) xf += ',transpose=1'
        else if (rot === 270) xf += ',transpose=2'
        else if (rot === 180) xf += ',transpose=1,transpose=1'
        else if (rot !== 0)
          xf += `,rotate=${((rot * Math.PI) / 180).toFixed(5)}:ow=rotw(${((rot * Math.PI) / 180).toFixed(5)}):oh=roth(${((rot * Math.PI) / 180).toFixed(5)}):fillcolor=black`
        if (s.flipH) xf += ',hflip'
        if (s.flipV) xf += ',vflip'
        // 動画ズーム（リフレーム）: プレビューの transform: translate(x,y) scale(s) を切片ごとに焼き込む。
        // s>=1 は拡大して切り出し(crop)、s<1 は縮小して黒余白(pad)。x,y はフレーム比の中心オフセット。
        // scalePad で出力サイズに整えた後に適用する（切片単位＝現セクションのみ反映）。
        let zm = ''
        const z = s.zoom
        if (z && (Math.abs(z.scale - 1) > 1e-3 || z.x !== 0 || z.y !== 0)) {
          const zs = Math.max(0.05, z.scale)
          const zw = Math.round(width * zs)
          const zh = Math.round(height * zs)
          if (zs >= 1) {
            const ox = `(iw-${width})/2-(${(z.x * width).toFixed(1)})`
            const oy = `(ih-${height})/2-(${(z.y * height).toFixed(1)})`
            zm = `,scale=${zw}:${zh},crop=${width}:${height}:${ox}:${oy},setsar=1`
          } else {
            const px = `(${width}-iw)/2+(${(z.x * width).toFixed(1)})`
            const py = `(${height}-ih)/2+(${(z.y * height).toFixed(1)})`
            zm = `,scale=${zw}:${zh},pad=${width}:${height}:${px}:${py}:color=black,setsar=1`
          }
        }
        // クロップ（切り抜き）: 各辺を内側へ切り込み、切った領域は黒。
        // W×H(scalePad/zoom後)から部分矩形をcropし、元位置にpadで黒埋めして戻す（枠サイズ不変）。
        let cr = ''
        const cp = s.crop
        if (cp && (cp.l > 1e-4 || cp.t > 1e-4 || cp.r > 1e-4 || cp.b > 1e-4)) {
          const cl = Math.min(0.9, Math.max(0, cp.l))
          const ct = Math.min(0.9, Math.max(0, cp.t))
          const crgt = Math.min(0.9, Math.max(0, cp.r))
          const cb = Math.min(0.9, Math.max(0, cp.b))
          const cw = Math.max(2, Math.round(width * (1 - cl - crgt)))
          const ch = Math.max(2, Math.round(height * (1 - ct - cb)))
          const cx = Math.round(width * cl)
          const cy = Math.round(height * ct)
          cr = `,crop=${cw}:${ch}:${cx}:${cy},pad=${width}:${height}:${cx}:${cy}:color=black,setsar=1`
        }
        const mIn = motionIn(s, i)
        const mOut = motionOut(s, i)
        const coreLabel = mIn || mOut ? `[c${i}]` : `[sv${i}]`
        const vin = srcInput[s.srcIdx ?? 0] // マルチソース: この切片が使う入力（元動画）index
        if (s.videoBlank) {
          filter += `color=c=black:s=${width}x${height}:d=${extLenN.toFixed(3)}:r=${fpsArg},setsar=1${fade}${tb}${coreLabel};`
        } else {
          // この切片の音声を使うか（下の音声ループの useSilence と同じ条件）
          const aUsed = audioPresent && !s.muted && !!srcHasAudio[s.srcIdx ?? 0]
          const off = ssOffsetOf(vin, trimStart, aUsed) // 入力 -ss を付けたぶん trim を前へずらす
          filter += `${useV(vin)}trim=start=${(trimStart - off).toFixed(3)}:end=${(s.srcEnd - off).toFixed(3)},setpts=(PTS-STARTPTS)/${sp}${xf},${scalePad}${zm}${cr}${eq}${fade}${tb}${coreLabel};`
        }
        // slide/wipe の頭/尻＝黒クリップとの xfade（映像がスライド/ワイプで出入り）。尺は不変。
        if (mIn || mOut) {
          let cur = coreLabel
          if (mIn) {
            const d = Math.min(tin!.dur, extLenN)
            const nx = mOut ? `[ci${i}]` : `[sv${i}]`
            filter += `color=c=black:s=${width}x${height}:d=${d.toFixed(3)}:r=${fpsArg},setsar=1,settb=AVTB[bi${i}];`
            filter += `[bi${i}]${cur}xfade=transition=${motionName(tin!.type)}:duration=${d.toFixed(3)}:offset=0${nx};`
            cur = nx
          }
          if (mOut) {
            const d = Math.min(tout!.dur, extLenN)
            filter += `color=c=black:s=${width}x${height}:d=${d.toFixed(3)}:r=${fpsArg},setsar=1,settb=AVTB[bo${i}];`
            filter += `${cur}[bo${i}]xfade=transition=${motionName(tout!.type)}:duration=${d.toFixed(3)}:offset=${(extLenN - d).toFixed(3)}[sv${i}];`
          }
        }
      })
      if (!hasX) {
        // 従来どおり単純連結
        filter += `${segs.map((_, i) => `[sv${i}]`).join('')}concat=n=${segs.length}:v=1:a=0[vcat];`
      } else {
        // 左から右へペアごとに連結: 間トランジションは xfade、それ以外は concat(n=2)。
        // offset は「出力時間の累計 - d」（速度込みのタイムライン尺で計算）。名前は betweenName で検証。
        let cur = '[sv0]'
        let acc = tlenOf(segs[0])
        for (let i = 1; i < segs.length; i++) {
          const d = xfOf(i - 1)
          const out = i === segs.length - 1 ? '[vcat]' : `[vx${i}]`
          if (d > 0)
            filter += `${cur}[sv${i}]xfade=transition=${betweenName(segs[i - 1]?.xfade?.type)}:duration=${d.toFixed(3)}:offset=${(acc - d).toFixed(3)}${out};`
          else filter += `${cur}[sv${i}]concat=n=2:v=1:a=0${out};`
          cur = out
          acc += tlenOf(segs[i])
        }
        // hasX ⇒ 切片は2つ以上（xfOf が「次の切片あり」を要求）なので、ループは必ず [vcat] を出す
      }
      baseLabel = '[vcat]'
      if (audioPresent) {
        // 無音で埋める切片: muted / 音声なしソース / ギャップ。ソース音声を使わず anullsrc で正確な長さを出す
        // （ギャップはソース尺を超える範囲を指し得るため、atrim だと音声が短くなり concat がズレる）。
        const useSilence = (s: ExportSeg): boolean => !!s.muted || !srcHasAudio[s.srcIdx ?? 0]
        // フォーマット統一が必要: 複数入力を混ぜる or anullsrc(48k/stereo)と混ざるとき。
        // 単一ソース＆無音なしの経路では付けない＝従来動作を完全維持。
        const needAfmt = nSrc > 1 || segs.some(useSilence)
        const afmt = needAfmt ? ',aformat=sample_rates=48000:channel_layouts=stereo' : ''
        segs.forEach((s, i) => {
          const sp = spOf(s)
          const headExt = xfOf(i - 1)
          const extLen = (s.srcEnd - s.srcStart) / sp + headExt // 映像 extLenN と一致（timeline秒）
          if (useSilence(s)) {
            filter += `anullsrc=r=48000:cl=stereo,atrim=0:${Math.max(0.05, extLen).toFixed(3)},asetpts=PTS-STARTPTS${afmt}[sa${i}];`
            return
          }
          // 切片音量倍率。速度は atempo。フェードは頭/尻の指定秒。
          const gain =
            s.vol != null && Math.abs(s.vol - 1) > 1e-3 ? `,volume=${s.vol.toFixed(3)}` : ''
          const tempo = sp !== 1 ? `,atempo=${sp.toFixed(4)}` : ''
          let af = ''
          if (s.afadeIn && s.afadeIn > 0)
            af += `,afade=t=in:st=0:d=${Math.min(s.afadeIn, extLen).toFixed(3)}`
          if (s.afadeOut && s.afadeOut > 0) {
            const d = Math.min(s.afadeOut, extLen)
            af += `,afade=t=out:st=${(extLen - d).toFixed(3)}:d=${d.toFixed(3)}`
          }
          // 映像と同じくディゾルブ受け側は頭を延長（acrossfade 後の合計尺が映像と一致する）
          const trimStart = Math.max(0, s.srcStart - headExt * sp)
          const ain = srcInput[s.srcIdx ?? 0]
          const off = ssOffsetOf(ain, trimStart, true) // 音声を使う入力に -ss は付けない（常に0）
          filter += `${useA(ain)}atrim=start=${(trimStart - off).toFixed(3)}:end=${(s.srcEnd - off).toFixed(3)},asetpts=PTS-STARTPTS${tempo}${gain}${af}${afmt}[sa${i}];`
        })
        if (!hasX) {
          filter += `${segs.map((_, i) => `[sa${i}]`).join('')}concat=n=${segs.length}:v=0:a=1[acat];`
        } else {
          let cur = '[sa0]'
          for (let i = 1; i < segs.length; i++) {
            const d = xfOf(i - 1)
            const out = i === segs.length - 1 ? '[acat]' : `[ax${i}]`
            if (d > 0) filter += `${cur}[sa${i}]acrossfade=d=${d.toFixed(3)}${out};`
            else filter += `${cur}[sa${i}]concat=n=2:v=0:a=1${out};`
            cur = out
          }
        }
        audioMap = ['-map', '[acat]']
      }
    }

    // A1(ベース音声)トラック音量×マスターを適用
    // カット無しのベース音声（元動画の音声そのまま）は、フィルタで使うか -map で直結かが
    // 後段の分岐で決まる。使わないのに asplit の出力を作るとエラーになるので、いったん目印を
    // 置き、全部組み終わってから「目印が残っていたら」入力ラベルを払い出して置換する。
    const RAW_BASE_A = '@BASEA@'
    let baseAudioLbl = audioPresent ? (segs ? '[acat]' : RAW_BASE_A) : null
    if (baseAudioLbl && Math.abs(baseVol - 1) > 1e-3) {
      filter += `${baseAudioLbl}volume=${baseVol.toFixed(3)}[abase];`
      baseAudioLbl = '[abase]'
      audioMap = ['-map', '[abase]']
    }

    // SE と映像レイヤーの音声をベース音声にミックス。
    // ※ここは ses が無くても実行する（以前は if (ses) の内側にあり、SEを1本も置いていない
    //   プロジェクトでは映像レイヤーの音が丸ごと書き出されなかった）。
    if (ses || vcs) {
      const baseLbl = baseAudioLbl
      const mixParts: string[] = []
      if (baseLbl) mixParts.push(baseLbl)
      ses?.forEach((se, k) => {
        const ms = Math.max(0, Math.round(se.tStart * 1000))
        const durN = Math.max(0.05, se.duration)
        const dur = durN.toFixed(3)
        const vol = (se.volume ?? 1).toFixed(2)
        // フェードイン/アウト（afade）を volume と adelay の間に挟む
        const fi = Math.max(0, Math.min(se.fadeIn ?? 0, durN))
        const fo = Math.max(0, Math.min(se.fadeOut ?? 0, durN))
        let fade = ''
        if (fi > 0) fade += `,afade=t=in:st=0:d=${fi.toFixed(3)}`
        if (fo > 0) fade += `,afade=t=out:st=${(durN - fo).toFixed(3)}:d=${fo.toFixed(3)}`
        // 音源内オフセット（左端トリム/分割）ぶん頭を送って、そこから duration 秒を切り出す。
        // ベース音声と同じ 48k/stereo に揃えてから amix に入れる（サンプルレート差で崩れないように）。
        const so = Math.max(0, se.srcOffset ?? 0)
        filter += `${useA(seInput[k])}atrim=${so.toFixed(3)}:${(so + durN).toFixed(3)},asetpts=PTS-STARTPTS,aformat=sample_rates=48000:channel_layouts=stereo,volume=${vol}${fade},adelay=${ms}|${ms}[se${k}];`
        mixParts.push(`[se${k}]`)
      })
      // 映像レイヤーの音声もミックスへ（映像と同じ位置・同じ長さ）
      if (vcs) {
        vcs.forEach((vc, k) => {
          const vol = vc.volume ?? 1
          if (vol <= 0) return // 消音クリップはミックスに入れない
          // 音声ストリームが無い動画（画面録画など）は [N:a] が存在せず、参照すると
          // 書き出し全体が "Stream specifier ':a' matches no streams" で失敗する。
          if (!vcHasAudio[k]) return
          const durN = Math.max(0.05, vc.srcEnd - vc.srcStart)
          const ms = Math.max(0, Math.round(vc.tStart * 1000))
          const fi = Math.max(0, Math.min(vc.fadeIn ?? 0, durN))
          const fo = Math.max(0, Math.min(vc.fadeOut ?? 0, durN))
          let fade = ''
          if (fi > 0) fade += `,afade=t=in:st=0:d=${fi.toFixed(3)}`
          if (fo > 0) fade += `,afade=t=out:st=${(durN - fo).toFixed(3)}:d=${fo.toFixed(3)}`
          const off = ssOffsetOf(vcInput[k], vc.srcStart, true) // 音声を使う入力に -ss は付けない（常に0）
          filter += `${useA(vcInput[k])}atrim=${(vc.srcStart - off).toFixed(3)}:${(vc.srcEnd - off).toFixed(3)},asetpts=PTS-STARTPTS,aformat=sample_rates=48000:channel_layouts=stereo,volume=${vol.toFixed(2)}${fade},adelay=${ms}|${ms}[vca${k}];`
          mixParts.push(`[vca${k}]`)
        })
      }
      if (mixParts.length >= 2 || (mixParts.length === 1 && !baseLbl)) {
        filter += `${mixParts.join('')}amix=inputs=${mixParts.length}:normalize=0:dropout_transition=0[amixout];`
        audioMap = ['-map', '[amixout]']
      }
    }

    // ラウドネス正規化（loudnorm）: 最終音声を目標LUFSへそろえる（YouTube最適 -14 等）
    const lufs = typeof payload.loudnormLUFS === 'number' ? payload.loudnormLUFS : null
    // audioPresent は「元動画に音声があるか」なので条件に入れない
    // （元動画が無音でも SE/BGM だけで音声を作る構成があり、そこでも正規化を効かせる）。
    // loudnorm は内部で192kHzに上げるため、aresample で48kHzへ戻す（AACが96kHzになるのを防ぐ）。
    if (lufs !== null && audioMap.length === 2) {
      const cur = audioMap[1]
      const inLbl = cur.startsWith('[') ? cur : RAW_BASE_A
      filter += `${inLbl}loudnorm=I=${lufs}:TP=-1.5:LRA=11,aresample=48000[aout];`
      audioMap = ['-map', '[aout]']
    }

    // ベース映像を出力解像度に合わせて拡縮＋レターボックス。
    // 動画のカット後より後ろのテロップがある場合は最終フレームを引き伸ばして含める
    const ext = extendSec && extendSec > 0.05 ? `tpad=stop_mode=clone:stop_duration=${extendSec.toFixed(3)},` : ''
    filter += `${baseLabel}${ext}scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1[base];`
    let last = '[base]'
    // 映像レイヤー（V2以降の動画）を本編映像の上に重ねる。テロップ・画像より先に合成する
    // ＝重なり順は 本編 → 映像レイヤー → 画像 → テロップ。
    if (vcs) {
      vcs.forEach((vc, k) => {
        const idx = vcInput[k]
        const vLen = Math.max(0.05, vc.srcEnd - vc.srcStart)
        const vEndT = vc.tStart + vLen
        // 反転 → 出力サイズへフィット → 回転（枠サイズ固定）→ ズーム → クロップ → 色調整 → 不透明度
        let xf = ''
        if (vc.flipH) xf += ',hflip'
        if (vc.flipV) xf += ',vflip'
        const rot = ((Math.round(vc.rotate ?? 0) % 360) + 360) % 360
        let rotF = ''
        if (rot !== 0) {
          const rad = ((rot * Math.PI) / 180).toFixed(5)
          const bl = rot % 90 === 0 ? ':bilinear=0' : ''
          rotF = `,rotate=${rad}:ow=iw:oh=ih:fillcolor=black@0${bl}`
        }
        let zm = ''
        const z = vc.zoom
        if (z && (Math.abs(z.scale - 1) > 1e-3 || z.x !== 0 || z.y !== 0)) {
          const zs = Math.max(0.05, z.scale)
          const zw = Math.round(width * zs)
          const zh = Math.round(height * zs)
          if (zs >= 1) {
            const ox = `(iw-${width})/2-(${(z.x * width).toFixed(1)})`
            const oy = `(ih-${height})/2-(${(z.y * height).toFixed(1)})`
            zm = `,scale=${zw}:${zh},crop=${width}:${height}:${ox}:${oy},setsar=1`
          } else {
            const px = `(${width}-iw)/2+(${(z.x * width).toFixed(1)})`
            const py = `(${height}-ih)/2+(${(z.y * height).toFixed(1)})`
            zm = `,scale=${zw}:${zh},pad=${width}:${height}:${px}:${py}:color=black@0,setsar=1`
          }
        }
        let cr = ''
        const cp = vc.crop
        if (cp && (cp.l > 1e-4 || cp.t > 1e-4 || cp.r > 1e-4 || cp.b > 1e-4)) {
          const cl = Math.min(0.9, Math.max(0, cp.l))
          const ct = Math.min(0.9, Math.max(0, cp.t))
          const crg = Math.min(0.9, Math.max(0, cp.r))
          const cb = Math.min(0.9, Math.max(0, cp.b))
          const cw = Math.max(2, Math.round(width * (1 - cl - crg)))
          const ch = Math.max(2, Math.round(height * (1 - ct - cb)))
          const cx = Math.round(width * cl)
          const cy = Math.round(height * ct)
          cr = `,crop=${cw}:${ch}:${cx}:${cy},pad=${width}:${height}:${cx}:${cy}:color=black@0,setsar=1`
        }
        const adj = vc.adjust
        const hasEq =
          !!adj &&
          (Math.abs(adj.b - 1) > 1e-3 ||
            Math.abs(adj.c - 1) > 1e-3 ||
            Math.abs(adj.s - 1) > 1e-3)
        const op =
          vc.opacity != null && vc.opacity < 1
            ? `,colorchannelmixer=aa=${Math.max(0, vc.opacity).toFixed(3)}`
            : ''
        // trim で必要区間だけ取り出し、setpts で「タイムライン上の開始時刻」へずらす。
        // これで overlay の enable 窓と実フレームの時刻が一致する。
        // このクリップの音声をミックスに入れるか（上の音声ループの除外条件と同じ）
        const aUsed = (vc.volume ?? 1) > 0 && !!vcHasAudio[k]
        const off = ssOffsetOf(idx, vc.srcStart, aUsed) // 入力 -ss を付けたぶん trim を前へずらす
        const geom =
          `trim=start=${(vc.srcStart - off).toFixed(3)}:end=${(vc.srcEnd - off).toFixed(3)},` +
          `setpts=PTS-STARTPTS+${vc.tStart.toFixed(3)}/TB,format=rgba${xf},` +
          `scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
          `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black@0,setsar=1${rotF}${zm}${cr}`
        if (hasEq) {
          // eq はアルファ非対応なので、透明を退避して色調整後に戻す
          const a = adj as { b: number; c: number; s: number }
          const eqf = `eq=brightness=${(a.b - 1).toFixed(3)}:contrast=${a.c.toFixed(3)}:saturation=${a.s.toFixed(3)}`
          filter += `${useV(idx)}${geom},split[vg${k}a][vg${k}b];`
          filter += `[vg${k}a]alphaextract[va${k}];`
          filter += `[vg${k}b]${eqf}[vcc${k}];`
          filter += `[vcc${k}][va${k}]alphamerge${op}[vcv${k}];`
        } else {
          filter += `${useV(idx)}${geom}${op}[vcv${k}];`
        }
        const out = `[vcb${k}]`
        const endT = vEndT - 0.5 / outFps > vc.tStart ? vEndT - 0.5 / outFps : vEndT
        filter += `${last}[vcv${k}]overlay=0:0:eof_action=pass:enable=between(t\\,${vc.tStart.toFixed(3)}\\,${endT.toFixed(3)})${out};`
        last = out
      })
    }
    // 画像クリップをテロップより先に重ねる（＝テロップが常に画像の上）。
    if (imgs) {
      imgs.forEach((im, k) => {
        const idx = imgInput[k]
        // 反転は出力サイズへ整える前でよい（サイズが変わらない）。
        // 回転は「枠サイズを変えずに中心で回す」＝プレビューの CSS rotate と同じ見え方にするため、
        // scale/pad で W×H に整えた *後* に ow=iw:oh=ih で回す（transpose は枠ごと縦横が入れ替わり
        // その後の decrease で縮んでしまい、プレビューと食い違うので使わない）。
        let ixf = ''
        if (im.flipH) ixf += ',hflip'
        if (im.flipV) ixf += ',vflip'
        const irot = ((Math.round(im.rotate ?? 0) % 360) + 360) % 360
        let irotF = ''
        if (irot !== 0) {
          const rad = ((irot * Math.PI) / 180).toFixed(5)
          // 90/180/270 は補間なし（bilinear=0）で劣化を避ける
          const bl = irot % 90 === 0 ? ':bilinear=0' : ''
          irotF = `,rotate=${rad}:ow=iw:oh=ih:fillcolor=black@0${bl}`
        }
        let izm = ''
        const iz = im.zoom
        if (iz && (Math.abs(iz.scale - 1) > 1e-3 || iz.x !== 0 || iz.y !== 0)) {
          const zs = Math.max(0.05, iz.scale)
          const zw = Math.round(width * zs)
          const zh = Math.round(height * zs)
          if (zs >= 1) {
            const ox = `(iw-${width})/2-(${(iz.x * width).toFixed(1)})`
            const oy = `(ih-${height})/2-(${(iz.y * height).toFixed(1)})`
            izm = `,scale=${zw}:${zh},crop=${width}:${height}:${ox}:${oy},setsar=1`
          } else {
            const px = `(${width}-iw)/2+(${(iz.x * width).toFixed(1)})`
            const py = `(${height}-ih)/2+(${(iz.y * height).toFixed(1)})`
            // 縮小時の余白は透明（下の映像が見える）
            izm = `,scale=${zw}:${zh},pad=${width}:${height}:${px}:${py}:color=black@0,setsar=1`
          }
        }
        let icr = ''
        const icp = im.crop
        if (icp && (icp.l > 1e-4 || icp.t > 1e-4 || icp.r > 1e-4 || icp.b > 1e-4)) {
          const cl = Math.min(0.9, Math.max(0, icp.l))
          const ct = Math.min(0.9, Math.max(0, icp.t))
          const crg = Math.min(0.9, Math.max(0, icp.r))
          const cb = Math.min(0.9, Math.max(0, icp.b))
          const cw = Math.max(2, Math.round(width * (1 - cl - crg)))
          const ch = Math.max(2, Math.round(height * (1 - ct - cb)))
          const cx = Math.round(width * cl)
          const cy = Math.round(height * ct)
          // 切った領域は透明（下の映像が見える＝プレビューと一致）
          icr = `,crop=${cw}:${ch}:${cx}:${cy},pad=${width}:${height}:${cx}:${cy}:color=black@0,setsar=1`
        }
        const iadj = im.adjust
        const hasEq =
          !!iadj &&
          (Math.abs(iadj.b - 1) > 1e-3 ||
            Math.abs(iadj.c - 1) > 1e-3 ||
            Math.abs(iadj.s - 1) > 1e-3)
        const iop =
          im.opacity != null && im.opacity < 1
            ? `,colorchannelmixer=aa=${Math.max(0, im.opacity).toFixed(3)}`
            : ''
        // 透明を保持するため rgba に統一（回転/pad の余白と不透明度が効くように）
        const geom = `format=rgba${ixf},scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black@0,setsar=1${irotF}${izm}${icr}`
        if (hasEq) {
          // eq はアルファ非対応（YUV/GRAYのみ）で、通すと透明が不透明の黒に落ちる。
          // アルファを取り出して退避し、色調整後に merge して戻す。
          const a = iadj as { b: number; c: number; s: number }
          const eqf = `eq=brightness=${(a.b - 1).toFixed(3)}:contrast=${a.c.toFixed(3)}:saturation=${a.s.toFixed(3)}`
          filter += `${useV(idx)}${geom},split[ig${k}a][ig${k}b];`
          filter += `[ig${k}a]alphaextract[ia${k}];`
          filter += `[ig${k}b]${eqf}[ic${k}];`
          filter += `[ic${k}][ia${k}]alphamerge${iop}[img${k}];`
        } else {
          filter += `${useV(idx)}${geom}${iop}[img${k}];`
        }
        const out = `[ib${k}]`
        // 隣接する画像が境界で1フレーム二重に重ならないよう半フレーム詰める（テロップと同様）
        const iEndRaw = im.tStart + Math.max(0.05, im.duration)
        const iEnd = iEndRaw - 0.5 / outFps > im.tStart ? iEndRaw - 0.5 / outFps : iEndRaw
        filter += `${last}[img${k}]overlay=0:0:enable=between(t\\,${im.tStart.toFixed(3)}\\,${iEnd.toFixed(3)})${out};`
        last = out
      })
    }
    if (frames.length) {
      // between は両端を含むため、隣接フレーム(end == 次のstart)が境界で1フレーム重なって
      // 二重像になる。終端を半フレーム手前に詰めて重なりを断つ。
      const halfF = 0.5 / outFps
      frames.forEach((f, i) => {
        const out = i === frames.length - 1 ? '[v]' : `[o${i}]`
        // ただし詰めると表示窓が潰れてしまう極短テロップは、そのままの尺を使う（消えるより重なる方がマシ）
        const end = f.end - halfF > f.start ? f.end - halfF : f.end
        // テロップPNGは1枚1入力（重複なし）。enableのカンマはエスケープ。
        filter += `${last}${useV(pngInput[i])}overlay=0:0:enable=between(t\\,${f.start.toFixed(3)}\\,${end.toFixed(3)})${out};`
        last = out
      })
    } else {
      filter += `${last}null[v];` // テロップ無し: 最終ラベルだけ [v] に揃える
    }
    // 目印が残っている＝ベース音声をフィルタで使った。ここで初めて入力ラベルを払い出す。
    if (filter.includes(RAW_BASE_A)) filter = filter.split(RAW_BASE_A).join(useA(srcInput[0]))
    // プレースホルダ→実ラベル（必要な入力だけ split/asplit を先頭に足す）
    filter = resolveInputLabels(filter).replace(/;$/, '')

    // ---- ffmpeg を起動する前にグラフを検証する ----
    // 入力ごとのストリーム有無。確実に「無い」と言えるものだけ false にし、
    // 判断できないものは true（許容）にする。誤検知で動く書き出しを止めないため。
    const graphInputs: GraphInput[] = inputSpecs.map((sp) => ({
      hasVideo: true,
      // 画像は音声を持たない（拡張子で確実に判断できる）
      hasAudio: !/\.(png|jpe?g|webp|gif|bmp|tiff?)$/i.test(sp.path),
      name: sp.path.split(/[\\/]/).pop()
    }))
    // ffprobe した実測を反映（無音の動画から [N:a] を取ろうとする事故を止める）
    srcInput.forEach((idx, i) => {
      if (!srcHasAudio[i] && graphInputs[idx]) graphInputs[idx].hasAudio = false
    })
    vcInput.forEach((idx, k) => {
      if (!vcHasAudio[k] && graphInputs[idx]) graphInputs[idx].hasAudio = false
    })
    const graphProblems = validateFilterGraph(filter, {
      inputs: graphInputs,
      maps: ['[v]', ...audioMap.filter((a) => a !== '-map')]
    })
    if (graphProblems.length) {
      // 警告は書き出しを止めない（動くが設計上おかしい、を記録に残すだけ）
      console.warn('[export] フィルタグラフの指摘:\n' + formatGraphProblems(graphProblems))
    }
    if (hasGraphError(graphProblems)) {
      // ここで止めれば、ffmpeg の暗号のようなエラーではなく原因が読める形で返せる。
      // 検出しているのは ffmpeg でも必ず失敗する不整合なので、成立する書き出しは止まらない。
      const errs = graphProblems.filter((p) => p.severity === 'error')
      return {
        ok: false,
        error:
          '書き出しの合成設定に不整合が見つかったため中止しました。\n' +
          '（この状態で実行しても ffmpeg が失敗します）\n\n' +
          formatGraphProblems(errs)
      }
    }

    const crf = typeof payload.crf === 'number' ? Math.round(payload.crf) : 23
    // フィルタは一時ファイルに書き出して -filter_complex_script で渡す。
    // テロップPNGが多い（＝入力とoverlay行が増える）とコマンドライン長がWindows上限(32767字)を
    // 超えて spawn ENAMETOOLONG になるため、最も長いフィルタ文字列を外出しして回避する。
    writeFileSync(join(tmp, 'filter.txt'), filter, 'utf-8')
    // 直近の書き出しのフィルタグラフを残す。tmp は書き出し後に消えるため、
    // 書き出しの不具合を後から実データで検証できるようにここへ控えを置く。
    try {
      writeFileSync(
        join(app.getPath('userData'), 'last-export-filter.txt'),
        `# 入力 ${graphInputs.length} 個\n` +
          graphInputs
            .map((g, i) => `#  ${i}: ${g.name}  video=${g.hasVideo} audio=${g.hasAudio}`)
            .join('\n') +
          `\n# -map ${audioMap.join(' ')}\n` +
          (graphProblems.length ? `# 指摘:\n${formatGraphProblems(graphProblems)}\n` : '') +
          '\n' +
          filter.split(';').join(';\n'),
        'utf-8'
      )
    } catch {
      // 控えが残せなくても書き出し自体は続行する
    }
    // 入力を並べる（重複排除済み。-ss はフィルタ組み立て中に確定するのでここで反映する）
    for (const sp of inputSpecs) {
      if (sp.ss > 0) args.push('-ss', sp.ss.toFixed(3))
      args.push('-i', sp.path)
    }
    args.push(
      '-filter_complex_script',
      'filter.txt', // cwd=tmp なので相対でよい（コマンドライン長の節約）
      '-map',
      '[v]',
      ...audioMap,
      '-r',
      fpsArg,
      '-c:v',
      'libx264',
      '-crf',
      String(crf),
      '-preset',
      'medium',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      save.filePath
    )

    const totalDur = typeof payload.totalDurationSec === 'number' ? payload.totalDurationSec : 0
    return await new Promise((resolve) => {
      exportCanceled = false
      // cwd=tmp: テロップPNG・フィルタを相対パスで渡してコマンドライン長を抑える
      // （元動画・出力先は絶対パスなので cwd の影響を受けない）
      const ff = spawn('ffmpeg', args, { cwd: tmp })
      currentExportFf = ff
      let err = ''
      ff.stderr.on('data', (d) => {
        const s = d.toString()
        err += s
        // ffmpeg の time= を出力尺で割って進捗%を送る（プロキシ生成と同方式）
        const m = /time=(\d+):(\d+):(\d+\.\d+)/.exec(s)
        if (m && totalDur > 0) {
          const cur = +m[1] * 3600 + +m[2] * 60 + parseFloat(m[3])
          const pct = Math.min(99, Math.max(0, Math.round((cur / totalDur) * 100)))
          !e.sender.isDestroyed() && e.sender.send('export:progress', { percent: pct })
        }
      })
      const cleanup = (): void => {
        currentExportFf = null
        liveTmpDirs.delete(tmp)
        try {
          rmSync(tmp, { recursive: true, force: true }) // 一時PNGを削除（蓄積防止）
        } catch {
          /* noop */
        }
      }
      ff.on('error', (er) => {
        cleanup()
        resolve({ ok: false, error: 'ffmpeg起動失敗: ' + er.message })
      })
      ff.on('close', (code) => {
        cleanup()
        if (exportCanceled) {
          // 中断: 書きかけの出力ファイルを消してキャンセル扱いで返す
          try {
            rmSync(save.filePath, { force: true })
          } catch {
            /* noop */
          }
          resolve({ ok: false, canceled: true })
          return
        }
        if (code === 0) resolve({ ok: true, outPath: save.filePath })
        else resolve({ ok: false, error: `ffmpeg失敗 (code ${code})\n` + err.slice(-600) })
      })
    })
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
