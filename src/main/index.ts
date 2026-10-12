import { app, shell, BrowserWindow, ipcMain, protocol, screen } from 'electron'
import { join } from 'path'
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  renameSync,
  statSync,
  existsSync,
  readdirSync
} from 'fs'
// 本体ウィンドウの大きさ・位置（初回の既定と、前回の形の引き継ぎ）
import { nextBounds, MIN_SIZE, type WindowState } from '../shared/windowBounds'
// 自動更新（GitHub の Releases を見に行く）
import { setupAutoUpdate } from './updater'
import { cleanOtherBundles, markVerified, runningVersion } from './bundleUpdate'
import { registerSubtitleHandlers } from './subtitles'
import { registerCutoutHandlers } from './cutout'
// 閉じるときの後片付け。**このファイルはもう ffmpeg を直接は動かさない**
// （長さ・コマ数は ./mediaProbe、聞き取りは ./subtitles、書き出しは ./exportRun）
import { killAllChildren } from './ffmpegRun'
import { isExporting, registerExportHandlers } from './exportRun'
// gcfile:// で画面へ配ってよいファイルの名簿。**新しく渡す道を作ったら必ず通す**
import { setAllowHook } from './allowList'
import { registerGcfileProtocol } from './gcfile'
import { pathFromArgv, registerOpenPathHandlers, setWindowStartupPath, windowForPath } from './openPath'
import { stopWatching, watchMedia } from './fileWatch'

// 名簿に入った素材は、外から書き換えられたら画面へ知らせる（main/fileWatch）。
// 名簿（allowList）は Electron を知らない純粋な物なので、繋ぐのはここ
setAllowHook(watchMedia)
import { registerAssetHandlers } from './assetLibrary'
import { registerSeHandlers } from './seLibrary'
import { registerMotionPresetHandlers } from './motionPresets'
import { registerAssetPackHandlers } from './assetPacks'
import { registerDialogHandlers } from './dialogs'
import { registerMediaProbeHandlers } from './mediaProbe'
import { registerMediaProxyHandlers } from './mediaProxy'
import { registerMediaAudioHandlers } from './mediaAudio'
import {
  isProjectDirty, registerProjectFileHandlers, registerWindowSlot, releaseWindowSlot
} from './projectFiles'
import { clearMark, installCrashHooks, recentCrashes, record, startSession } from './crashLog'

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

// ダブルクリック（関連付け）で開かれたプロジェクトを画面へ渡す道は ./openPath
/**
 * 窓を1つ作る。`openPath` を渡すと、その窓はそのプロジェクトから始まる。
 *
 * **窓は何個でも作れる**（2026-10-12・本人の指定「2つ目のプロジェクトは別ウィンドウで」）。
 * 窓ごとに違う物: 下書き（自動保存）の置き場・「未保存」の札・閉じる確認・開くパス。
 * 1つしか無い物: 自動更新の見張り（最初の窓で1回だけ起こし、知らせは全窓へ）
 */
let updaterStarted = false
function createWindow(openPath?: string): void {
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
  // この窓の番号（下書きの置き場と「未保存」の札を窓ごとに分ける）
  registerWindowSlot(mainWindow.webContents.id)
  if (openPath) setWindowStartupPath(mainWindow, openPath)

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
    // **画面が出たことをもって「この版は起動できた」とする。**
    //
    // JS だけ差し替えて更新したとき、これが書かれないと次の起動で捨てられて
    // 同梱へ戻る（`bootGate.js`）。**書く側ではなく消す側に倒してある**ので、
    // 落ちた・電源が切れたときは黙って安全な方（同梱）へ落ちる。
    //
    // 読み込めた時点ではなく**画面が出てから**呼ぶ。前者だと
    // 「起動はするが真っ白」を確認済みにしてしまう。
    markVerified()
    cleanOtherBundles()
  })

  // 更新を見に行く。当てていいかは「今なにをしているか」で決める
  // （書き出し中・未保存のときに勝手に再起動しない）。
  // **起こすのは最初の窓で1回だけ**（窓ごとに起こすと見張りが二重になる）。
  // 知らせ（update:state / update:flush）は updater が全窓へ送る。
  // 「未保存」はどれか1つの窓でもあれば当てない
  if (!updaterStarted) {
    updaterStarted = true
    setupAutoUpdate(mainWindow, {
      busy: () => ({ dirty: isProjectDirty(), exporting: isExporting() })
    })
  }

  // 未保存の変更があるまま閉じようとしたら確認する（無警告で編集内容を失わないため）。
  //
  // 確認そのものはレンダラ側のモーダルに任せる。OS のメッセージボックスは
  // 見た目も文言の作法もアプリと揃わず、「Windows のダイアログが出てきた」という
  // 見え方になるため。ここは「閉じるのを止めて、レンダラに聞きに行く」だけ。
  // レンダラが app:close-confirmed を返したら allowClose を立てて閉じ直す。
  // **窓ごと。** 「未保存」も確認もこの窓の分だけ（他の窓の了承で閉じない）
  let allowClose = false
  const myId = mainWindow.webContents.id
  mainWindow.on('close', (e) => {
    if (allowClose || !isProjectDirty(myId) || AUTO) return
    e.preventDefault()
    mainWindow.webContents.send('app:close-request')
  })
  const onCloseConfirmed = (e: Electron.IpcMainEvent): void => {
    if (e.sender.id !== myId) return
    allowClose = true
    mainWindow.close()
  }
  ipcMain.on('app:close-confirmed', onCloseConfirmed)

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
    ipcMain.removeListener('app:close-confirmed', onCloseConfirmed)
    releaseWindowSlot(myId)
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
app.on('will-quit', stopWatching) // 見張りを残すとプロセスが終われない
// **正常に終わったので印を消す**（次の起動で「前回落ちた」と出さない）。
// 落ちた側で書くのではなく、終わる側で消す形にしてある——落ちた瞬間に
// 書けるとは限らないため（電源断・強制終了・メモリ枯渇）。理由は ./crashLog
app.on('will-quit', clearMark)

// **同時に2つ立ち上げない。**
// 関連付けから別のプロジェクトを開くたびに新しい GiftCut が立ち上がると、
// 下書き（自動保存）を2つのアプリが取り合い、あとから閉じた方の内容で上書きされる。
// 2つ目は起動せず、すでに動いている方へ「これを開いて」と伝える。
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    // **2つ目のプロジェクトは別の窓で開く**（2026-10-12・本人の指定）。
    // 前は動いている窓へ送り、今の作業を保存して閉じてから入れ替えていた。
    // 同じプロジェクトをもう一度ダブルクリックしたら、その窓を前へ出すだけ
    const p = pathFromArgv(argv)
    const win = (p && windowForPath(p)) || (p ? null : BrowserWindow.getAllWindows()[0])
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
      return
    }
    if (p) createWindow(p)
  })
}

app.whenReady().then(() => {
  // **落ちたことを、アプリ自身が知る**（2026-08-05 に足した。中身は ./crashLog）。
  // それまでは crashReporter も render-process-gone も無く、
  // 「使っている人の所で何が起きたか」が丸ごと見えなかった。
  installCrashHooks()
  // 落ちた記録に残す版も、動いているコードの版（同梱の版ではない）
  const session = startSession(runningVersion())
  ipcMain.handle('crash:last', () => ({ ...session, entries: recentCrashes() }))
  // 画面側で握り損ねた例外も同じ所へ入れる。
  // **画面が落ちなくても、機能が1つ死んでいることはある**（描き直しの中で投げると
  // React がその区画を丸ごと外す）。落ちた記録と同じ場所に並べておけば、
  // 「落ちてはいないが何かおかしい」も後から辿れる
  ipcMain.handle('crash:report', (_e, detail: string) => record('renderer-error', detail))

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
  // gcfile://media/<パス> → ローカルファイルを配信（名簿にある物だけ。./gcfile）
  registerGcfileProtocol()

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
  // （自動更新で入れ替わったあと、画面に出る数字が本物と食い違わないように）。
  //
  // **`app.getVersion()` では足りない。** JS だけ差し替えて更新したとき、
  // あれが返すのは同梱の版＝インストーラが入れた exe の版で、
  // **動いているコードの版ではない**。題名の横に出る数字は
  //「直したはずが直っていない」を切り分けるための物なので、ここが嘘だと困る
  ipcMain.handle('app:version', () => runningVersion())

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
  registerCutoutHandlers() //   画像の背景を透過する（./cutout）

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

  // 引数で渡されたプロジェクト（関連付けからのダブルクリック）は窓に置いておき、
  // 画面が取りに来る（./openPath の頭。送ると届く前に流れていた）
  registerOpenPathHandlers()
  createWindow(pathFromArgv(process.argv) ?? undefined)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
