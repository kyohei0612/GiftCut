// 自動更新（GitHub の Releases から）。
//
// 目指す形は「起動したら勝手に新しくなっている」。ユーザーに更新作業をさせない。
// ただし作業中の内容は絶対に巻き添えにしない（いつ当てるかは shared/updatePolicy）。
//
// 仕組み:
//   1. 起動して少し経ったら見に行き、以降も**開いている間ずっと30分おき**に見る
//   2. あれば裏で落とす（進み具合は画面の右下に出す）
//   3. 落とし終わったら帯で知らせるだけ。**こちらから再起動は促さない**
//   4. 本人が閉じたときに、黙って入れ替える
//
// ## なぜ「開いている間に落としきる」か
//
// 落とすのは裏でできるが、**入れ替えはアプリが動いている間はできない**
// （自分のファイルを使っている最中なので Windows が置き換えさせない）。
// なので閉じるときに残す仕事を「入れ替えだけ」にしておく。
// 起動時に1回しか見に行かないと、長く開いた日は閉じる段になって
// 落とし始めることになり、待たされた感じだけが残る。
//
// 開発中（パッケージしていない状態）は何もしない。electron-updater は
// インストーラ経由で入った実体でないと動かないため。
import { app, BrowserWindow, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { planUpdate, type BusyState } from '../shared/updatePolicy'

export interface UpdateDeps {
  /** 今の状態（未保存・書き出し中）を教えてもらう。当てていいかの判断に使う */
  busy: () => BusyState
}

// **書き写さない**（前は main / preload の2ファイルに同じ型があった。
// 理由は shared/updateState.ts の頭）
export type { UpdateState } from '../shared/updateState'
import type { UpdateState } from '../shared/updateState'

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
    // **書く物が無いなら待たない。**
    //
    // ここは常に「下書きを書け」と頼んで返事を待っていた（最大4秒）。
    // ところが未保存が無ければ書く物も無いので、**押した人はただ待たされる**。
    // 更新が遅いと感じる時間の一部が、これだった。
    if (deps.busy().dirty) {
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
    }
    // **閉じる前に「入れ替えています」を出す。**
    //
    // ここから先はインストーラの仕事で、終わるまで十数秒かかる。
    // 何も出さないと**押した直後から無反応**に見える。
    send({ phase: 'installing', version: '' })
    await new Promise((r) => setTimeout(r, 120))

    // **`quitAndInstall` を使わない。** あれは
    //
    //   install(...)                    インストーラを起動して
    //   setImmediate(() => app.quit())  **すぐ閉じる**
    //
    // なので、知らせを出した窓が **0.1秒で消える**。
    // 「入れ替えています」を出しても、実質見えない。
    //
    // ## 自分で閉じないと、どれだけ見えるか
    //
    // NSIS 側は動いているアプリを**強制終了させる**作りで、その前に猶予がある
    // （`allowOnlyOneInstallerInstance.nsh`）:
    //
    //   Sleep 300 → プロセスを探す → Sleep 1000（猶予）→ KILL_PROCESS
    //
    // つまり**こちらから閉じなければ 1.3〜1.6秒は窓が生きている。**
    // しかもこの待ちはインストーラ側で必ず起きるので、
    // **自分で閉じるより遅くはならない**（ただ乗りしているだけ）。
    //
    // **第1引数（黙って当てるか）は true。** false だと NSIS が対話モードで
    // 立ち上がり、更新のたびにセットアップの画面（置き場所の選択まで）が出る。
    // 初回の導入では選ばせたいので oneClick は false のままにしてある。
    // 第2引数は「当て終わったら開き直す」。
    // `install` は `BaseUpdater`（NsisUpdater の親）にあるが、electron-updater が
    // 公開している `autoUpdater` の型は抽象の `AppUpdater` なので**型の上では見えない**。
    // 実体は NsisUpdater なので実行時には在る。
    // **無ければ従来の道へ落とす**——知らせが一瞬しか出ないだけで済み、
    // 更新そのものは動く。ここで落ちて更新できなくなる方がずっと困る。
    const u = autoUpdater as unknown as { install?: (s?: boolean, f?: boolean) => boolean }
    if (typeof u.install !== 'function') {
      console.warn('[update] install が無いので quitAndInstall を使います')
      autoUpdater.quitAndInstall(true, true)
      return
    }
    const started = u.install(true, true)
    if (!started) {
      // 起動できなかったら、いつもの道へ戻す（黙って何も起きないのが一番まずい）
      console.warn('[update] インストーラを起動できませんでした。閉じるときに当てます')
      send({ phase: 'error', message: '更新を始められませんでした。次に閉じたときに当てます。' })
      return
    }
    // **殺されなかったときの逃げ道。** インストーラが何かの理由で
    // 強制終了に来なかった場合、窓が出たまま固まって見える。
    // 猶予（約1.6秒）より十分長く待ってから、自分で閉じる。
    setTimeout(() => {
      console.warn('[update] 強制終了が来ないので、自分で閉じます')
      app.quit()
    }, 8000)
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

  /**
   * **更新が当たった後の最初の起動で、一度だけ知らせる。**
   *
   * 本人の言葉:「なんか一回ロード挟んで起動したりする」。
   * アプリが消えて、しばらくして戻ってくるのに、**戻ってきた側が何も言わない**ので、
   * 何のための間だったのか分からず不具合に見える。
   *
   * 前に開いたときの版を覚えておいて、変わっていたら一度だけ言う。
   * 待ちは減らせないが、**何だったのかは説明できる。**
   */
  const seenPath = join(app.getPath('userData'), 'last-version.txt')
  try {
    const now = app.getVersion()
    const before = existsSync(seenPath) ? readFileSync(seenPath, 'utf-8').trim() : ''
    writeFileSync(seenPath, now, 'utf-8')
    // **初回起動では言わない。** 前の版を知らないだけで、更新したわけではない
    if (before && before !== now) {
      // 画面が用意できてから送る（起動直後は受け手がまだ居ない）
      setTimeout(() => send({ phase: 'updated', version: now }), 2500)
    }
  } catch {
    /* 覚えられなくても本体は動く */
  }
  autoUpdater.on('download-progress', (p) => {
    const mb = (n: number): number => Math.round((n / 1024 / 1024) * 10) / 10
    send({
      phase: 'downloading',
      version: autoUpdater.currentVersion?.version ?? '',
      percent: Math.round(p.percent),
      doneMB: mb(p.transferred),
      totalMB: mb(p.total)
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

  /**
   * 見に行って、あれば裏で落とす（落とすのは autoDownload が勝手にやる）。
   *
   * **開いている間ずっと、たまに見に行く。** 起動時に1回だけだと、
   * 長く開いたまま作業した日は新しい版が出ても気づかず、
   * **閉じるときに初めて落とし始める**ことになる。それだと「閉じたのに
   * 何か動いている」「次の起動が遅い」になり、待たされた感じだけが残る。
   *
   * 落とし終わっていれば、閉じるときにやるのは**入れ替えだけ**で済む。
   */
  const look = (): void => {
    if (deps.busy().exporting) return // 書き出し中は帯域も CPU も渡さない
    autoUpdater.checkForUpdates().catch((e) => console.warn('[update] 確認に失敗:', e))
  }
  // 起動直後は読み込みで忙しい。少し待ってから見に行く
  setTimeout(look, 4000)
  // 以降は30分おき。**落とし終わるのは早いほどよい**（閉じるときに待たされない）
  setInterval(look, 30 * 60 * 1000)
}
