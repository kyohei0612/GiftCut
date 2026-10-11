// ダブルクリック（関連付け）で開かれたプロジェクトを、**その窓**へ渡す。
//
// **関連付けから開くと、パスは起動の引数で来る。** 受け取る側が居ないと
// 「メモ帳で開きますか？」のまま何も起きない。
//
// ## 送らない。窓が取りに来る
//
// 前は「画面の読み込みが終わってから送る」形だった。ところが画面側の受け口
// （React の effect）は読み込み完了より**後**に付くので、送った物は届く前に流れ、
// 「プロジェクトから起動しても普通に立ち上がるだけ」になっていた
// （2026-10-11・本人の報告）。パスは窓ごとに置いておき、画面側が
// `project:startupPath` で取りに来る。取りに行く形なら順番に寄らない。
//
// ## 2つ目のプロジェクトは別の窓（2026-10-12・本人の指定）
//
// 前は動いている窓へ「これを開いて」と送り、今の作業を保存して閉じてから
// 入れ替えていた。いまは**窓を1つ増やして**そこで開く（index.ts の second-instance）。
// 窓を作る側が `setWindowStartupPath(窓, パス)` で置き、その窓が取りに来る。
//
// ## 中身
//
// - `pathFromArgv`            … 引数から .gcproj を拾う（無ければ null）
// - `setWindowStartupPath`    … その窓が起動したら開くパスを置く
// - `windowForPath`           … そのパスのために作った窓（同じ物を2つ開かず、前へ出す）
// - `registerOpenPathHandlers` … 画面が取りに来る口（ipc）を開く
import { BrowserWindow, ipcMain } from 'electron'
import { existsSync } from 'fs'
import { resolve } from 'path'
import { allowFile } from './allowList'

/** 窓（webContents.id）→ その窓が開くべきプロジェクト */
const startupPaths = new Map<number, string>()

export function pathFromArgv(argv: string[]): string | null {
  // 先頭は実行ファイル。開発中は「.」も混ざるので、拡張子で選ぶ
  const p = argv.slice(1).find((a) => /\.gcproj$/i.test(a) && existsSync(a))
  return p ? resolve(p) : null
}

export function setWindowStartupPath(win: BrowserWindow, p: string): void {
  allowFile(p)
  startupPaths.set(win.webContents.id, p)
  win.on('closed', () => startupPaths.delete(win.webContents.id))
}

/** そのパスのために作った窓（まだ開いていれば） */
export function windowForPath(p: string): BrowserWindow | null {
  const key = resolve(p).toLowerCase()
  for (const w of BrowserWindow.getAllWindows()) {
    const sp = startupPaths.get(w.webContents.id)
    if (sp && resolve(sp).toLowerCase() === key && !w.isDestroyed()) return w
  }
  return null
}

export function registerOpenPathHandlers(): void {
  ipcMain.handle('project:startupPath', (e) => startupPaths.get(e.sender.id) ?? null)
}
