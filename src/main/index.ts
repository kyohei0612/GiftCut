import { app, shell, BrowserWindow, ipcMain, protocol, screen } from 'electron'
import { join, normalize, resolve } from 'path'
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  renameSync,
  statSync,
  existsSync,
  readdirSync,
  createReadStream
} from 'fs'
import { Readable } from 'stream'
// 本体ウィンドウの大きさ・位置（初回の既定と、前回の形の引き継ぎ）
import { nextBounds, MIN_SIZE, type WindowState } from '../shared/windowBounds'
// 自動更新（GitHub の Releases を見に行く）
import { setupAutoUpdate } from './updater'
import { registerSubtitleHandlers } from './subtitles'
// 閉じるときの後片付け。**このファイルはもう ffmpeg を直接は動かさない**
// （長さ・コマ数は ./mediaProbe、聞き取りは ./subtitles、書き出しは ./exportRun）
import { killAllChildren } from './ffmpegRun'
import { isExporting, registerExportHandlers } from './exportRun'
// gcfile:// で画面へ配ってよいファイルの名簿。**新しく渡す道を作ったら必ず通す**
import { allowFile, isAllowed } from './allowList'
import { registerAssetHandlers } from './assetLibrary'
import { registerSeHandlers } from './seLibrary'
import { registerMotionPresetHandlers } from './motionPresets'
import { registerAssetPackHandlers } from './assetPacks'
import { registerDialogHandlers } from './dialogs'
import { registerMediaProbeHandlers } from './mediaProbe'
import { registerMediaProxyHandlers } from './mediaProxy'
import { registerMediaAudioHandlers } from './mediaAudio'
import { isProjectDirty, registerProjectFileHandlers } from './projectFiles'

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

  // 字幕を作る（聞き取り）の受け口は ./subtitles
  registerSubtitleHandlers()

  // ※ ここにあった「素材パック（ZIP）をまとめて取り込む」の説明は、
  //    受け口が ./assetLibrary へ移ったあとの**空の看板**だった（下にあったのは
  //    スクショ保存で、ZIP とは関係なかった）。中身と一緒に消した。


  // 受け口はそれぞれ別ファイル（この1つのファイルに全部置くと読み切れなくなる）。
  // どれも「app.whenReady() の中で1回だけ」呼ぶ約束。
  registerDialogHandlers() //    開く・フォルダを選ぶ・保存する（./dialogs）
  registerExportHandlers() //     書き出し（./exportRun）
  registerAssetHandlers() //     テロップの見本帳（./assetLibrary）
  registerSeHandlers() //        効果音（./seLibrary）
  registerMotionPresetHandlers() // 動きの見本帳（./motionPresets）
  registerAssetPackHandlers() // 素材パック・フォルダを開く（./assetPacks）
  registerMediaProbeHandlers() // 長さ・コマ数・サムネ（./mediaProbe）
  registerMediaProxyHandlers() // 焼き直し（./mediaProxy）
  registerMediaAudioHandlers() // 波形・喋っていない所（./mediaAudio）
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
