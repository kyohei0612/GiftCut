// 自動更新（GitHub の Releases から）。
//
// 目指す形は「起動したら勝手に新しくなっている」。ユーザーに更新作業をさせない。
// ただし作業中の内容は絶対に巻き添えにしない（いつ当てるかは shared/updatePolicy）。
//
// 仕組み:
//   1. 起動して少し経ったら、GitHub の Releases に新しい版があるか見に行く
//   2. あれば裏で落とす（進み具合は画面の右下に出す）
//   3. 落とし終わったら、手が空いていれば再起動して当てる。
//      書き出し中・未保存なら、次に閉じたときに当てる
//
// 開発中（パッケージしていない状態）は何もしない。electron-updater は
// インストーラ経由で入った実体でないと動かないため。
import { app, BrowserWindow, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'
import { planUpdate, type BusyState } from '../shared/updatePolicy'

export interface UpdateDeps {
  /** 今の状態（未保存・書き出し中）を教えてもらう。当てていいかの判断に使う */
  busy: () => BusyState
}

/** 画面へ知らせる内容。renderer 側はこれを見て表示を決める */
export type UpdateState =
  | { phase: 'checking' }
  | { phase: 'none' }
  | { phase: 'downloading'; version: string; percent: number }
  | { phase: 'ready'; version: string; when: 'now' | 'onQuit'; message: string; countdownSec: number }
  | { phase: 'error'; message: string }

export function setupAutoUpdate(win: BrowserWindow, deps: UpdateDeps): void {
  const send = (s: UpdateState): void => {
    if (!win.isDestroyed()) win.webContents.send('update:state', s)
  }

  // 帯を閉じるだけ（こちらから再起動を仕掛けていないので、止める物が無い）。
  // 受け口は残す——無いと画面側が送った先で握りつぶされたか分からなくなる。
  ipcMain.on('update:later', () => {})
  ipcMain.on('update:now', () => void restartWithUpdate())

  // 再起動する前に、必ず今の状態を書かせる。
  //
  // 更新は「作業を中断してよい時」にしか当てないが、それでも
  // 開いているプロジェクト・再生位置・画面の形は消したくない。
  // 画面側に下書きを書かせて、書けたと返事が来てから落とす。
  // 返事が来ない（固まっている等）ときも、待ち続けずに進む
  // ——更新できないまま起動し続ける方が困るので。
  let flushed: (() => void) | null = null
  ipcMain.on('update:flushed', () => flushed?.())
  async function restartWithUpdate(): Promise<void> {
    await new Promise<void>((res) => {
      const done = (): void => {
        flushed = null
        clearTimeout(timer)
        res()
      }
      const timer = setTimeout(() => {
        console.warn('[update] 保存の返事が来ないので、待たずに再起動します')
        done()
      }, 4000)
      flushed = done
      if (!win.isDestroyed()) win.webContents.send('update:flush')
      else done()
    })
    // **第1引数（黙って当てるか）を true にすること。**
    // false だと NSIS のインストーラが対話モードで立ち上がり、
    // **更新のたびにセットアップの画面（置き場所の選択まで）が出る**。
    // 初回の導入では選ばせたいので oneClick は false のままにしてあり、
    // 更新のときだけここで黙らせる。第2引数は「当て終わったら開き直す」。
    autoUpdater.quitAndInstall(true, true)
  }

  if (!app.isPackaged) {
    console.log('[update] 開発中なので更新は見に行きません')
    return
  }

  autoUpdater.autoDownload = true
  // 再起動しないと決めた場合でも、次に閉じたときには当たるようにしておく
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = {
    info: (m: unknown) => console.log('[update]', m),
    warn: (m: unknown) => console.warn('[update]', m),
    error: (m: unknown) => console.error('[update]', m),
    debug: () => {}
  }

  autoUpdater.on('checking-for-update', () => send({ phase: 'checking' }))
  autoUpdater.on('update-not-available', () => send({ phase: 'none' }))
  autoUpdater.on('download-progress', (p) => {
    send({
      phase: 'downloading',
      version: autoUpdater.currentVersion?.version ?? '',
      percent: Math.round(p.percent)
    })
  })
  autoUpdater.on('update-downloaded', (info) => {
    // **ここで再起動を仕掛けない。** 落とし終わったことを細い帯で伝えるだけ。
    // 当てるのは本人が閉じたとき（autoInstallOnAppQuit が黙って当てる）。
    // 待てない人のために「今すぐ再起動」は帯に残してあるが、押されたときだけ動く。
    send({ phase: 'ready', version: info.version, ...planUpdate(deps.busy(), info.version) })
  })
  autoUpdater.on('error', (err) => {
    // 更新に失敗しても、アプリは普通に使えなければならない。
    // 落とさず、画面にも押し付けない（右下に小さく出すだけ）。
    console.warn('[update] 見に行けませんでした:', err)
    send({ phase: 'error', message: String(err?.message ?? err) })
  })

  // 起動直後は読み込みで忙しい。少し待ってから見に行く
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((e) => console.warn('[update] 確認に失敗:', e))
  }, 4000)
}
