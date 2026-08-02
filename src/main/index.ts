import { app, shell, BrowserWindow, ipcMain, dialog, protocol, screen } from 'electron'
import { join, normalize, resolve } from 'path'
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  renameSync,
  copyFileSync,
  statSync,
  existsSync,
  readdirSync,
  createReadStream,
  createWriteStream,
  utimesSync
} from 'fs'
import { writeFile as writeFileAsync } from 'fs/promises'
import { createHash } from 'crypto'
import { tmpdir, cpus, setPriority, constants as osConstants } from 'os'
import { Readable } from 'stream'
import { spawn, type ChildProcess } from 'child_process'
// フィルタグラフは ffmpeg を起動する前に検証する（入力indexのズレ・ラベルの
// 定義漏れ・無音素材からの音声参照は、起動して初めて分かると原因が読めない）。
import {
  formatGraphProblems,
  hasGraphError,
  overlayEnableExpr,
  validateFilterGraph,
  type GraphInput
} from '../shared/filterGraph'
// 保存するプロジェクトの整合性検査（参照切れ・長さ0・id重複など）
import { checkProject, formatProjectProblems } from '../shared/projectCheck'
// クリップ・画像の動き（キーフレーム）。**画面と同じ折れ線を式にする**ので、
// 焼き方をここで別に考えない（別々に書くと、見た絵と出来た絵が違う事故になる）。
import { hasClipMotion, zoomPanChain, zoompanFilter, type ClipMotion } from '../shared/clipMotion'
// 色調整のフィルタ。**GPL 専用の eq は使えない**（同梱は LGPL 版）ので、
// 同じ計算を lutyuv で書いてある。
import { colorAdjustFilter } from '../shared/colorAdjust'
// Premiere のプリセット（.prfpset）を読んで、こちらの「動き」にする。
// **読むのも変換するのも shared に置いてある**ので、本体側は置き場の世話だけをする。
import { parsePrfpset } from '../shared/prfpset'
import { toMotion, isFullyCopyable, endsHidden } from '../shared/prfpsetImport'
import type { MotionPresetFile } from '../shared/telopMotion'
// 本体ウィンドウの大きさ・位置（初回の既定と、前回の形の引き継ぎ）
import { nextBounds, MIN_SIZE, type WindowState } from '../shared/windowBounds'
// プロジェクトの持ち出し（素材ごと ZIP に入れる／展開してパスを繋ぎ直す）
import { planPack, relinkProject, PROJECT_ENTRY, MANIFEST_ENTRY } from '../shared/projectPack'
import { writeZip, extractZip } from './zip'
// 自動更新（GitHub の Releases を見に行く）
import { setupAutoUpdate } from './updater'
// 同梱素材のパスを今の置き場へ繋ぎ直す（家庭用 exe は起動ごとに展開先が変わる）
import { relinkBundledPath } from '../shared/relinkBundled'
import {
  MODEL,
  dirOf,
  downloadTo,
  findExe,
  modelPath,
  modelReady,
  runWhisper
} from './subtitles'
// 書き出し先が素材と同じだと ffmpeg は必ず失敗する。始める前に気づいて日本語で言う
import { clashingSource } from '../shared/exportTarget'

// 未保存の変更があるか（renderer から 'project:dirty' で通知される）。×ボタンの確認に使う。
let projectDirty = false

import { ENCODERS, type Enc } from './encoders'
// ffmpeg / ffprobe を呼ぶ所は全部ここを通す（同梱物の場所・終了時の後始末・
// 使えるエンコーダ選び）。**直に spawn しないこと。**
import {
  FFMPEG,
  FFPROBE,
  filterScriptArgs,
  hasAudioStream,
  killAllChildren,
  liveTmpDirs,
  trackedSpawn,
  tryEncoder,
  useEncoder,
  videoEncoder
} from './ffmpegRun'
import { isExporting, registerExportHandlers } from './exportRun'
// gcfile:// で画面へ配ってよいファイルの名簿。**新しく渡す道を作ったら必ず通す**
import { allowFile, isAllowed } from './allowList'
import { registerMediaProbeHandlers } from './mediaProbe'
import { inspectProject, isProjectDirty, registerProjectFileHandlers } from './projectFiles'

// 自動実行（e2e・監査・計測）で動かしているかどうか。
//
// **窓で止まるのが、自動の道具がこける一番の理由だった。**
// 中でも厄介なのが「保存せずに終了しますか」で、これは *閉じるのを止める* ため、
// 機械側からは窓を閉じることすらできず、最後に必ず時間切れで殺される。
// 画面の中の窓は e2e/dismiss.mjs でどけられるが、これはどけようがない。
//
// なので自動実行のときだけ、閉じる確認を飛ばす。
// **普段の使用には一切効かない**（この印は自動の道具しか付けない）。
const AUTO = process.argv.includes('--gc-auto') || process.env.GC_AUTO === '1'





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



// ローカル動画を http オリジンから読むための特権スキーム
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'gcfile',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true }
  }
])

// 前回どんな形で閉じたかを覚えておく場所。プロジェクトではなくアプリの設定なので
// userData に置く（プロジェクトを別PCへ持って行っても、その人の画面の形が優先される）。
const windowStatePath = (): string => join(app.getPath('userData'), 'giftcut-window.json')

function readWindowState(): WindowState | null {
  try {
    const o = JSON.parse(readFileSync(windowStatePath(), 'utf-8'))
    return o && typeof o === 'object' ? (o as WindowState) : null
  } catch {
    return null // 初回起動・壊れている → 既定の形で開く
  }
}

/**
 * ダブルクリックで開かれたプロジェクトを、画面へ渡す。
 *
 * **関連付けから開くと、パスは起動の引数で来る。**
 * 受け取る側が居ないと「メモ帳で開きますか？」のまま何も起きない。
 *
 * 画面はまだ出来ていないことがあるので、その時は覚えておいて、
 * 出来上がってから渡す（起動直後に落としたら、開いたのに何も出ない）。
 */
let pendingOpenPath: string | null = null
function sendOpenPath(p: string): void {
  const win = BrowserWindow.getAllWindows()[0]
  if (!win || win.webContents.isLoading()) {
    pendingOpenPath = p
    return
  }
  allowFile(p)
  win.webContents.send('project:openPath', p)
  if (win.isMinimized()) win.restore()
  win.focus()
}
function openPathFromArgv(argv: string[]): void {
  // 先頭は実行ファイル。開発中は「.」も混ざるので、拡張子で選ぶ
  const p = argv.slice(1).find((a) => /\.gcproj$/i.test(a) && existsSync(a))
  if (p) sendOpenPath(resolve(p))
}

function createWindow(): void {
  const displays = screen.getAllDisplays().map((d) => d.workArea)
  const { bounds, maximized } = nextBounds(
    readWindowState(),
    displays,
    screen.getPrimaryDisplay().workArea
  )
  const mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    show: false,
    backgroundColor: '#121416',
    autoHideMenuBar: true,
    title: 'GiftCut',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })
  if (maximized) mainWindow.maximize()

  // 形が変わるたびに覚え直す。動かしている間ずっと書くと遅いので、手が止まってから書く。
  // 最大化中の getBounds() は画面いっぱいの値なので、記録するのは
  // 「元に戻したときの形」＝ getNormalBounds()。これを取り違えると、
  // 最大化→解除で開いた次回に、画面いっぱいの大きさの窓が出てくる。
  let saveTimer: NodeJS.Timeout | null = null
  const rememberWindow = (): void => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      if (mainWindow.isDestroyed()) return
      const state: WindowState = {
        bounds: mainWindow.getNormalBounds(),
        maximized: mainWindow.isMaximized()
      }
      try {
        writeFileSync(windowStatePath(), JSON.stringify(state, null, 1), 'utf-8')
      } catch (e) {
        console.warn('[window] 窓の形を覚えられませんでした:', e)
      }
    }, 400)
  }
  mainWindow.on('resize', rememberWindow)
  mainWindow.on('move', rememberWindow)
  mainWindow.on('maximize', rememberWindow)
  mainWindow.on('unmaximize', rememberWindow)

  mainWindow.on('ready-to-show', () => mainWindow.show())
  // 起動の引数で渡されたプロジェクトは、画面が出来てから渡す
  mainWindow.webContents.on('did-finish-load', () => {
    if (!pendingOpenPath) return
    const p = pendingOpenPath
    pendingOpenPath = null
    allowFile(p)
    mainWindow.webContents.send('project:openPath', p)
  })

  // 更新を見に行く。当てていいかは「今なにをしているか」で決める
  // （書き出し中・未保存のときに勝手に再起動しない）。
  setupAutoUpdate(mainWindow, {
    busy: () => ({ dirty: isProjectDirty(), exporting: isExporting() })
  })

  // 未保存の変更があるまま閉じようとしたら確認する（無警告で編集内容を失わないため）。
  //
  // 確認そのものはレンダラ側のモーダルに任せる。OS のメッセージボックスは
  // 見た目も文言の作法もアプリと揃わず、「Windows のダイアログが出てきた」という
  // 見え方になるため。ここは「閉じるのを止めて、レンダラに聞きに行く」だけ。
  // レンダラが app:close-confirmed を返したら allowClose を立てて閉じ直す。
  let allowClose = false
  mainWindow.on('close', (e) => {
    if (allowClose || !isProjectDirty() || AUTO) return
    e.preventDefault()
    mainWindow.webContents.send('app:close-request')
  })
  ipcMain.on('app:close-confirmed', () => {
    allowClose = true
    mainWindow.close()
  })

  // パネルを別ウィンドウ（別モニター）へ出すための穴。
  //
  // 開けるのは**自前のパネル用ウィンドウだけ**。外部のURLは今まで通り
  // 既定のブラウザへ渡して、アプリの中では開かない（開けてしまうと、
  // 素材に紛れ込んだリンクを踏んだときにアプリの中でページが開く）。
  mainWindow.webContents.setWindowOpenHandler((details) => {
    if (details.frameName.startsWith('gc-pane-')) {
      // 保存してあった位置に開く場合、その位置のモニターがもう無いことがある
      // （ノートを持ち出した、モニターを外した）。画面の外に開くと、
      // 出したパネルが見えないまま行方不明になるので、その時は位置を捨てる。
      const opts: Electron.BrowserWindowConstructorOptions = {
        backgroundColor: '#1b1b1e',
        autoHideMenuBar: true,
        minWidth: 260,
        minHeight: 200,
        webPreferences: {
          preload: join(__dirname, '../preload/index.js'),
          sandbox: false,
          contextIsolation: true
        }
      }
      const f = details.features
      const num = (k: string): number | null => {
        const m = new RegExp(`\\b${k}=(-?\\d+)`).exec(f)
        return m ? Number(m[1]) : null
      }
      const x = num('left')
      const y = num('top')
      if (x !== null && y !== null) {
        const w = num('width') ?? 480
        const h = num('height') ?? 400
        const visible = screen.getAllDisplays().some((d) => {
          const b = d.workArea
          // 窓の一部でも画面に重なっていればよい（完全に外なら捨てる）
          return x + w > b.x && x < b.x + b.width && y + h > b.y && y < b.y + b.height
        })
        if (visible) {
          opts.x = x
          opts.y = y
        } else {
          // 本体の画面の真ん中へ寄せる（そのままだと見えない所に開く）
          const b = screen.getDisplayMatching(mainWindow.getBounds()).workArea
          opts.x = Math.round(b.x + (b.width - w) / 2)
          opts.y = Math.round(b.y + (b.height - h) / 2)
          console.warn('[pane] 保存されていた位置に画面が無いので、本体の画面へ寄せます')
        }
      }
      return { action: 'allow', overrideBrowserWindowOptions: opts }
    }
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // 本体を閉じたら、出したパネルも一緒に閉じる。
  // 残ると、中身が動かないウィンドウだけが画面に取り残される。
  const panes = new Set<BrowserWindow>()
  mainWindow.webContents.on('did-create-window', (win) => {
    panes.add(win)
    win.on('closed', () => panes.delete(win))
  })
  mainWindow.on('closed', () => {
    for (const w of panes) {
      if (!w.isDestroyed()) w.destroy()
    }
    panes.clear()
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

// **同時に2つ立ち上げない。**
// 関連付けから別のプロジェクトを開くたびに新しい GiftCut が立ち上がると、
// 下書き（自動保存）を2つのアプリが取り合い、あとから閉じた方の内容で上書きされる。
// 2つ目は起動せず、すでに動いている方へ「これを開いて」と伝える。
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    openPathFromArgv(argv)
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })
}

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
    if (!isAllowed(filePath)) {
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
    if (!path || !isAllowed(path)) return { ok: false }
    return await new Promise((resolve) => {
      const p = trackedSpawn(FFPROBE, [
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
    if (!path || !isAllowed(path)) return { ok: false }
    return await new Promise((resolve) => {
      const p = trackedSpawn(FFPROBE, [
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
    // 置き場。渡した相手に「ここへ入れて」と言える固定の場所（userData）が要る。
    //
    // **起動時のカレントディレクトリは見ない。**
    // 以前は候補に入れていたが、
    //   ・たまたま素材フォルダのある所から起動すると、意図しない素材を読む
    //   ・手元で配布版を確かめると「素材が入っている」ように見えてしまう
    //     （実際に検証中、空のはずの配布版でテロップ素材が217件出た）
    // という事故になる。開発中は appPath がリポジトリ直下を指すので、
    // これを外しても手元の素材は今までどおり読める。
    const candidates = [
      join(app.getAppPath(), 'SE'),
      // **exe 1つで配る版**は、素材を中に同梱する（解凍させないため）
      join(process.resourcesPath ?? '', 'SE'),
      join(app.getPath('userData'), 'SE')
    ]
    // **見つかった置き場を全部足す。** 1つ目で打ち切ると、同梱の素材が入っている版
    // （exe 1つで配る身内用）では userData に足したぶんが永遠に出てこない。
    // 「フォルダを開く」から入れたのに増えない、という筋の通らない状態になる。
    const roots = candidates.filter((r) => existsSync(r))
    if (roots.length === 0)
      return { ok: false, items: [] as { category: string; name: string; path: string }[] }
    const items: { category: string; name: string; path: string }[] = []
    const isAudio = (n: string): boolean => AUDIO.includes(n.toLowerCase().split('.').pop() ?? '')
    const nameOf = (n: string): string => n.replace(/\.[^.]+$/, '')
    // 同じ「分類/名前」が2つの置き場にあれば、先に見つけた方だけを出す
    const seen = new Set<string>()
    const add = (category: string, name: string, path: string): void => {
      const key = `${category}/${name}`
      if (seen.has(key)) return
      seen.add(key)
      allowFile(path)
      items.push({ category, name, path })
    }
    for (const root of roots) {
      let entries: import('fs').Dirent[]
      try {
        entries = readdirSync(root, { withFileTypes: true })
      } catch {
        continue
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
          for (const f of sub) if (isAudio(f)) add(ent.name, nameOf(f), join(full, f))
        } else if (isAudio(ent.name)) {
          add('その他', nameOf(ent.name), full)
        }
      }
    }
    return { ok: true, root: roots[0], items }
  })

  // ---- SE を置き場へ入れる ----
  //
  // **一覧に「ここへ入れてください」と書くだけでは入口になっていない。**
  // まっさらな状態の SE タブは「GiftCut/SE フォルダに mp3 を入れてください」
  // としか出ておらず、そこから辿れるボタンが1つも無かった。
  // 追加はプロジェクトと同じ作法（ボタンで選ぶ／掴んで落とす）に揃える。
  //
  // 入れ方は2通り。**どちらも userData/SE の下に写す**（更新で消えない場所）。
  //   ファイル … 直下へ。一覧では「その他」に並ぶ
  //   フォルダ … 名前ごと1階層で写す。一覧では**畳んだ分類**として出る
  const SE_AUDIO = ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac']
  const seImportRoot = (): string => join(app.getPath('userData'), 'SE')
  /** 同じ名前があっても上書きしない（消えたと思われるのが一番困る） */
  const freeName = (dir: string, name: string): string => {
    const dot = name.lastIndexOf('.')
    const stem = dot > 0 ? name.slice(0, dot) : name
    const ext = dot > 0 ? name.slice(dot) : ''
    let p = join(dir, name)
    for (let i = 2; existsSync(p); i++) p = join(dir, `${stem} (${i})${ext}`)
    return p
  }
  const isSeAudio = (n: string): boolean =>
    SE_AUDIO.includes(n.toLowerCase().split('.').pop() ?? '')
  /**
   * 受け取った物を SE の置き場へ写す。
   * ファイルは直下（一覧では「その他」）、フォルダは名前ごと1階層（畳んだ分類）。
   */
  const seImportPaths = (
    list: string[]
  ): { ok: boolean; files?: number; folders?: number; root?: string; error?: string } => {
    const root = seImportRoot()
    mkdirSync(root, { recursive: true })
    let files = 0
    let folders = 0
    for (const src of list) {
      if (!src || !existsSync(src)) continue
      if (statSync(src).isDirectory()) {
        // Windows のパスは \ 区切り。**両方入れること**（片方だと分解できず、
        // 置き場の下にフルパスの名前でファイルを作ろうとして失敗する）
        const name = src.split(/[\\/]/).filter(Boolean).pop() ?? 'SE'
        const dst = freeName(root, name)
        mkdirSync(dst, { recursive: true })
        let got = 0
        for (const f of readdirSync(src)) {
          const full = join(src, f)
          try {
            if (statSync(full).isFile() && isSeAudio(f)) {
              copyFileSync(full, freeName(dst, f))
              got++
            }
          } catch {
            /* 読めない物は飛ばす */
          }
        }
        if (got > 0) {
          folders++
          files += got
        } else rmSync(dst, { recursive: true, force: true }) // 空の分類は作らない
      } else if (isSeAudio(src)) {
        copyFileSync(src, freeName(root, src.split(/[\\/]/).pop() ?? '音.mp3'))
        files++
      }
    }
    if (files === 0)
      return { ok: false, error: '音のファイルが見つかりませんでした（mp3 / wav / m4a など）' }
    return { ok: true, files, folders, root }
  }
  /** 掴んで落とした物・選んだ物を入れる（paths を渡さなければファイル選択を出す） */
  ipcMain.handle('se:import', async (_e, paths?: string[]) => {
    try {
      let list = Array.isArray(paths) ? paths.filter((p) => typeof p === 'string' && p) : []
      if (!list.length) {
        const r = await dialog.showOpenDialog({
          title: '音を追加',
          filters: [{ name: '音', extensions: SE_AUDIO }],
          properties: ['openFile', 'multiSelections']
        })
        if (r.canceled || !r.filePaths.length) return { ok: false, canceled: true }
        list = r.filePaths
      }
      return seImportPaths(list)
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })
  /** フォルダを選んで、そのフォルダごと入れる（分類として畳んだ状態で入る） */
  ipcMain.handle('se:importFolder', async () => {
    try {
      const r = await dialog.showOpenDialog({
        title: 'フォルダごと音を追加',
        properties: ['openDirectory', 'multiSelections']
      })
      if (r.canceled || !r.filePaths.length) return { ok: false, canceled: true }
      return seImportPaths(r.filePaths)
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  // ローカルのテロップテンプレ集（GiftCut/telop-presets/*.json）。Geba等・配布に含めない。
  ipcMain.handle('telop:presets', () => {
    // SE と同じ理由で userData も見る（起動のされ方に左右されない置き場）
    const candidates = [
      join(app.getAppPath(), 'telop-presets'),
      join(process.resourcesPath ?? '', 'telop-presets'),
      join(app.getPath('userData'), 'telop-presets')
    ]
    // SE と同じく、見つかった置き場を全部足す（同梱があると自分で足したぶんが
    // 出てこない、という状態を作らないため）。同じ名前は先に見つけた方が勝つ。
    const roots = candidates.filter((r) => existsSync(r))
    if (roots.length === 0) return { ok: false, items: [] as unknown[] }
    const items: unknown[] = []
    // 重複を落とすのは**置き場をまたいだ時だけ**。1つの置き場の中で同じ名前が
    // 並んでいるのは向こうの都合なので、勝手に間引くと「素材が減った」になる。
    const seen = new Set<string>()
    for (const root of roots) {
      const here = new Set<string>()
      let files: string[]
      try {
        files = readdirSync(root)
      } catch {
        continue
      }
      for (const f of files) {
        if (!f.toLowerCase().endsWith('.json')) continue
        try {
          const arr = JSON.parse(readFileSync(join(root, f), 'utf-8'))
          if (Array.isArray(arr)) {
            for (const t of arr) {
              if (!t || !t.name || !t.style || seen.has(t.name)) continue
              here.add(t.name)
              items.push(t)
            }
          }
        } catch {
          /* 壊れたJSONはスキップ */
        }
      }
      for (const n of here) seen.add(n)
    }
    return { ok: true, items }
  })

  // ---- 動きのプリセット（Premiere の .prfpset から写し取ったもの）----
  //
  // 置き場はテロップのテンプレ集と同じ考え方（cwd / appPath / userData）。
  // **取り込んだ物は userData に書く**（アプリを入れ直しても消えない側）。
  // .prfpset そのものは持たない。読んだ結果（＝こちらの Motion）だけを残す。
  const motionRoots = (): string[] =>
    [
      join(app.getAppPath(), 'motion-presets'),
      join(app.getPath('userData'), 'motion-presets')
    ].filter((r) => existsSync(r))
  const motionWriteRoot = (): string => join(app.getPath('userData'), 'motion-presets')
  /** 前に .prfpset を選んだ場所。次に開くときの出発点にする（毎回探し直させない） */
  let lastMotionDir: string | null = null

  ipcMain.handle('motion:list', () => {
    const items: MotionPresetFile[] = []
    const seen = new Set<string>()
    for (const root of motionRoots()) {
      let files: string[]
      try {
        files = readdirSync(root)
      } catch {
        continue
      }
      for (const f of files) {
        if (!f.toLowerCase().endsWith('.json')) continue
        try {
          const arr = JSON.parse(readFileSync(join(root, f), 'utf-8'))
          if (!Array.isArray(arr)) continue
          for (const t of arr) {
            // 同じ名前が2つの置き場にあれば、先に見つけた方（自分で取り込んだぶん）が勝つ
            if (!t || typeof t.name !== 'string' || !t.motion || seen.has(t.name)) continue
            seen.add(t.name)
            items.push(t)
          }
        } catch {
          /* 壊れた JSON は飛ばす（1つで全部が読めなくなるのを避ける） */
        }
      }
    }
    return { ok: true, items }
  })

  // .prfpset を選んで読み、こちらの形にして保存する。
  //
  // **1つも落とさない。** 動きが取れなかった物も名前だけ残す。
  // どれを使うか（どれを配布に載せるか）を決めるのは人で、こちらが先に間引くと
  // 「そもそも何が入っていたか」が見えなくなる。押したときに理由を言えばいい。
  ipcMain.handle('motion:import', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Premiere のプリセット（.prfpset）を選ぶ',
      // **どこを開くかを決めておく。** 決めないと前回どこかで開いた場所から始まり、
      // 探しているファイルまで自力で辿ることになる（見つけられず閉じる＝
      // 「押しても何も起きない」に見える）。2回目からは前に選んだ場所。
      defaultPath: lastMotionDir ?? app.getPath('desktop'),
      filters: [
        { name: 'Premiere のプリセット (*.prfpset)', extensions: ['prfpset'] },
        // 拡張子で隠れて「ファイルが1つも見えない」を避ける逃げ道
        { name: 'すべてのファイル', extensions: ['*'] }
      ],
      properties: ['openFile']
    })
    if (canceled || filePaths.length === 0) return { ok: false, canceled: true }
    try {
      const src = filePaths[0]
      lastMotionDir = src.replace(/[\\/][^\\/]*$/, '')
      const presets = parsePrfpset(readFileSync(src, 'utf-8'))
      // 選んだのに0件なら**必ず言う。** 黙って終わると「壊れている」としか見えない
      if (presets.length === 0)
        return {
          ok: false,
          error: `「${src.split(/[\\/]/).pop()}」から動きが1つも見つかりませんでした。Premiere で書き出した .prfpset か確認してください。`
        }
      const items: MotionPresetFile[] = []
      for (const p of presets) {
        const { motion, skipped } = toMotion(p)
        // 動きが空でも入れる。**押したときに「何が要るか」を言える**ようにするため、
        // 持ってこられなかったエフェクトの名前は必ず添える
        const missing = [
          ...new Set([
            ...p.effects.filter((e) => !isFullyCopyable({ name: '', effects: [e] })).map((e) => e.matchName),
            ...skipped
          ])
        ]
        items.push({
          name: p.name,
          motion,
          ...(missing.length ? { partial: missing } : {}),
          // 終わりで消える物（2枚重ねの上側）。単体で当てると文字が消えるので印を付ける
          ...(endsHidden(motion) ? { endsHidden: true } : {})
        })
      }
      const empty = items.filter((t) => Object.keys(t.motion).length === 0).length
      const root = motionWriteRoot()
      mkdirSync(root, { recursive: true })
      const base =
        (src.split(/[\\/]/).pop() ?? 'presets').replace(/\.prfpset$/i, '').replace(/[\\/:*?"<>|]/g, '_') ||
        'presets'
      const out = join(root, base + '.json')
      writeFileSync(out, JSON.stringify(items, null, 2), 'utf-8')
      return {
        ok: true,
        path: out,
        items,
        // 中身の内訳を返す。**どれが「そのまま使える」かを人が決められるように。**
        //   total   … ファイルに入っていた数（＝並ぶ数。1つも落とさない）
        //   partial … 一部だけ再現できる（こちらに無いエフェクトが混ざっている）
        //   empty   … 動きが1つも取れなかった（名前だけ並ぶ）
        total: presets.length,
        imported: items.length,
        partial: items.filter((t) => t.partial?.length && Object.keys(t.motion).length).length,
        empty
      }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  // 動きの記録を書き出す。**画面側の blob ダウンロードは Electron では落ちる**
  // （何も起きないので「保存した」と思ったまま失われる）。本体で書けば確実に残る。
  //
  // toDownloads=true なら**ダウンロードへ、確認なしで**置く。
  // 「おかしいぞ」と思った人がボタン1つで出せて、そのファイルをそのまま渡せる形にする。
  // 保存ダイアログを挟むと、置き場所で迷って結局出てこない。
  ipcMain.handle('perf:save', (_e, text: string, toDownloads?: boolean) => {
    try {
      const dir = toDownloads
        ? app.getPath('downloads')
        : join(app.getPath('userData'), 'perf')
      mkdirSync(dir, { recursive: true })
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      const p = join(dir, `GiftCut-動きの記録-${stamp}.md`)
      writeFileSync(p, text, 'utf-8')
      return { ok: true, path: p }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  // ---- 利用者がいじった物を、ファイルとして残す ----
  //
  // お気に入り・自作のテロップスタイル・人物・アイコン・自分の動きは
  // 画面側の保存領域（localStorage）に入っていて、**目にも見えないし持ち出せない**。
  // 同じ内容をここへ書いておけば、入れ直しても・配り直しても・別の機械へ移しても、
  // このファイルさえ持っていけば元に戻る。
  //
  // 置き場は userData の直下（＝「設定・保存データのフォルダを開く」で出る所）。
  // 中身は JSON なので、メモ帳でも開いて中を見られる。
  // いま動いている本体のバージョン。**package.json ではなく本体に聞く**
  // （自動更新で入れ替わったあと、画面に出る数字が本物と食い違わないように）
  ipcMain.handle('app:version', () => app.getVersion())

  const userStorePath = (): string => join(app.getPath('userData'), 'ユーザー設定.json')
  ipcMain.handle('userstore:read', () => {
    try {
      const p = userStorePath()
      if (!existsSync(p)) return { ok: true, data: {} }
      const o = JSON.parse(readFileSync(p, 'utf-8'))
      return { ok: true, data: o && typeof o === 'object' ? o : {} }
    } catch (e) {
      // 壊れていても起動は止めない（戻せないだけ）
      return { ok: false, error: String(e), data: {} }
    }
  })
  ipcMain.handle('userstore:write', (_e, data: Record<string, string>) => {
    try {
      if (!data || typeof data !== 'object') return { ok: false, error: '中身がありません' }
      const p = userStorePath()
      // 一時ファイルへ書いてから置き換える（書いている途中で落ちても元が壊れない）
      const tmpFile = p + '.tmp'
      writeFileSync(tmpFile, JSON.stringify(data, null, 1), 'utf-8')
      renameSync(tmpFile, p)
      return { ok: true, path: p }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  // ---- 字幕を作る（聞き取り）----
  //
  // 流れ: 音を取り出す → 聞き取る → 呼んだ側（画面）が割って合わせる。
  // **合わせる所は画面側**（カット点を知っているのがそちらなので）。
  // ここは「音を文字にする」までを受け持つ。
  const subCancel = { canceled: false }
  let subProc: ChildProcess | null = null
  /** 動画の長さ（秒）。進み具合を出すのに要る。取れなければ 0 */
  const probeDuration = (path: string): Promise<number> =>
    new Promise((resolve) => {
      const p = spawn(FFPROBE, [
        '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path
      ])
      let out = ''
      p.stdout?.on('data', (d) => (out += d.toString()))
      p.on('error', () => resolve(0))
      p.on('close', () => {
        const d = parseFloat(out.trim())
        resolve(Number.isFinite(d) && d > 0 ? d : 0)
      })
    })
  ipcMain.handle('subtitles:status', () => ({
    ok: true,
    exe: !!findExe(),
    model: modelReady(),
    label: MODEL.label,
    // 落とすのは模型だけ（実行ファイルは同梱してある）
    sizeMB: modelReady() ? 0 : MODEL.sizeMB
  }))
  ipcMain.handle('subtitles:cancel', () => {
    subCancel.canceled = true
    try {
      subProc?.kill()
    } catch {
      /* すでに終わっている */
    }
    return { ok: true }
  })
  ipcMain.handle('subtitles:run', async (e, videoPath: string) => {
    subCancel.canceled = false
    const send = (s: unknown): void => {
      if (!e.sender.isDestroyed()) e.sender.send('subtitles:progress', s)
    }
    const tmpWav = join(tmpdir(), `giftcut-sub-${Date.now()}.wav`)
    try {
      if (!videoPath || !existsSync(videoPath))
        return { ok: false, error: '聞き取る動画がありません' }

      // 1) 模型を落とす（初回だけ）。実行ファイルは同梱してある
      if (!findExe())
        return {
          ok: false,
          error: '聞き取りの実行ファイルが見つかりません（同梱物が欠けています）'
        }
      if (!modelReady()) {
        send({ phase: 'download', percent: 0 })
        const r = await downloadTo(
          MODEL.url,
          modelPath(),
          (p) => send({ phase: 'download', percent: p }),
          subCancel
        )
        if (!r.ok) return { ok: false, error: `聞き取りの模型を落とせません: ${r.error}` }
      }
      if (subCancel.canceled) return { ok: false, canceled: true }

      // 2) 音を取り出す。**16kHz モノラルの wav**（whisper.cpp が受ける形）
      send({ phase: 'extract' })
      const okWav = await new Promise<boolean>((resolve) => {
        const ff = spawn(FFMPEG, [
          '-y', '-i', videoPath,
          '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le',
          tmpWav
        ])
        subProc = ff
        ff.on('error', () => resolve(false))
        ff.on('close', (c) => resolve(c === 0 && existsSync(tmpWav)))
      })
      if (subCancel.canceled) return { ok: false, canceled: true }
      if (!okWav) return { ok: false, error: '音を取り出せませんでした' }

      // 3) 聞き取る
      send({ phase: 'listen', percent: 0 })
      const dur = await probeDuration(videoPath)
      const r = await runWhisper(
        findExe()!,
        tmpWav,
        dur,
        (p) => send({ phase: 'listen', percent: p }),
        (p) => (subProc = p)
      )
      if (subCancel.canceled) return { ok: false, canceled: true }
      if (!r.ok || !r.segs) return { ok: false, error: r.error }
      return { ok: true, segs: r.segs, duration: dur }
    } catch (er) {
      return { ok: false, error: String(er) }
    } finally {
      subProc = null
      try {
        rmSync(tmpWav, { force: true })
      } catch {
        /* 消せなくても結果は変わらない */
      }
    }
  })

  // ---- 素材パック（ZIP）をまとめて取り込む ----
  //
  // 「フォルダを開いて、展開して、中身を貼る」は手順が3つあり、
  // **どれか1つでも間違えると素材が出てこない**（しかも間違いに気づけない）。
  // ZIP を選ぶだけで済むようにする。展開も置き場所の判断もこちらでやる。
  //
  // **入れるのは決まった名前のフォルダだけ。** ZIP の中に何が入っていても、
  // 知らない物は userData へ撒かない（受け取った ZIP を無条件に展開しない）。
  const ASSET_FOLDERS = ['SE', 'telop-presets', 'motion-presets', 'テンプレート'] as const
  ipcMain.handle('assets:importZip', async (_e, zipPath?: string) => {
    let target = zipPath
    if (!target) {
      const r = await dialog.showOpenDialog({
        title: '素材パック（ZIP）を選ぶ',
        filters: [{ name: '素材パック', extensions: ['zip'] }],
        properties: ['openFile']
      })
      if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true }
      target = r.filePaths[0]
    }
    if (!existsSync(target)) return { ok: false, error: 'ファイルが見つかりません' }
    // 一度どこにも影響しない場所へ展開してから、要る物だけを移す。
    // 直接 userData へ展開すると、途中で失敗したときに半端な物が残る。
    const tmpDir = join(tmpdir(), 'giftcut-assets-' + Date.now())
    try {
      mkdirSync(tmpDir, { recursive: true })
      await extractZip(target, tmpDir)
      const base = app.getPath('userData')
      const added: Record<string, number> = {}
      // **入れた物は1つ残らず覚えておく。**
      // 途中で失敗したときに戻せないと、半端に入った素材が残る。
      // 「取り込めませんでした」と言われたのに一部だけ入っている、が一番困る。
      const written: string[] = []
      /** フォルダごと足す（同じ名前は上書き。無い物はそのまま残す） */
      const merge = (from: string, to: string): number => {
        let n = 0
        mkdirSync(to, { recursive: true })
        for (const name of readdirSync(from)) {
          const src = join(from, name)
          const dst = join(to, name)
          const st = statSync(src)
          if (st.isDirectory()) n += merge(src, dst)
          else {
            // すでに有る物は上書きしない印を付けておく（戻すときに消さないため）
            if (!existsSync(dst)) written.push(dst)
            copyFileSync(src, dst)
            n++
          }
        }
        return n
      }
      /** 入れた物を消して、元の状態へ戻す */
      const rollback = (): void => {
        for (const f of written) {
          try {
            rmSync(f, { force: true })
          } catch {
            /* 消せない物は残るが、できる限り戻す */
          }
        }
      }
      try {
        for (const folder of ASSET_FOLDERS) {
          const src = join(tmpDir, folder)
          if (!existsSync(src)) continue
          const n = merge(src, join(base, folder))
          if (n > 0) added[folder] = n
        }
      } catch (er) {
        rollback()
        throw er
      }
      rmSync(tmpDir, { recursive: true, force: true })
      if (Object.keys(added).length === 0) {
        // **知らない ZIP を選んだとき。** 何も入れずに、何を探したかを言って終わる
        rollback()
        return {
          ok: false,
          error:
            'この ZIP には素材が入っていませんでした（' +
            ASSET_FOLDERS.join(' / ') +
            ' のフォルダを探します）。何も取り込んでいません。'
        }
      }
      return { ok: true, added, path: base }
    } catch (er) {
      try {
        rmSync(tmpDir, { recursive: true, force: true })
      } catch {
        /* 消せなくても取り込みの結果は変わらない */
      }
      return { ok: false, error: `${String(er)}\n何も取り込んでいません。` }
    }
  })

  // ---- 「更新で消えない置き場」を開く（ファイルメニュー）----
  //
  // 自動更新はアプリ本体を丸ごと入れ替えるが、**userData の下は触らない**。
  // 利用者が足した効果音・テロップ素材・動きのプリセット・テンプレートは
  // ここに置いてあるので、退避も引っ越しもここを開ければできる。
  // 開けないと「消えない場所」があっても本人には無いのと同じなので、道を作る。
  //
  // 無ければ作ってから開く。「開いたら何も無い」より「空の置き場が見える」方が、
  // どこへ入れればよいかが分かる。
  const OPENABLE: Record<string, string> = {
    se: 'SE',
    telop: 'telop-presets',
    motion: 'motion-presets',
    template: 'テンプレート',
    // 設定・自動保存・プロキシ。userData の直下そのもの
    data: ''
  }
  ipcMain.handle('folder:open', async (_e, key: string) => {
    if (!Object.prototype.hasOwnProperty.call(OPENABLE, key))
      return { ok: false, error: `知らない置き場です: ${key}` }
    const base = app.getPath('userData')
    const dir = OPENABLE[key] ? join(base, OPENABLE[key]) : base
    try {
      mkdirSync(dir, { recursive: true })
    } catch {
      /* 作れなくても、すでに在るかもしれないので開いてみる */
    }
    // openPath は「失敗した理由」を文字列で返す（成功なら空文字）
    const err = await shell.openPath(dir)
    return err ? { ok: false, error: err, path: dir } : { ok: true, path: dir }
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





  // 受け口はそれぞれ別ファイル（この1つのファイルに全部置くと読み切れなくなる）。
  // どれも「app.whenReady() の中で1回だけ」呼ぶ約束。
  registerExportHandlers() //     書き出し（./exportRun）
  registerMediaProbeHandlers() // サムネ・焼き直し・波形（./mediaProbe）
  registerProjectFileHandlers() // 保存・下書き・持ち出し・雛形（./projectFiles）

  createWindow()
  // 引数で渡されたプロジェクトを開く（関連付けからのダブルクリック）
  openPathFromArgv(process.argv)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
