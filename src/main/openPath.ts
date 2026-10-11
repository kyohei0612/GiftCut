// ダブルクリック（関連付け）で開かれたプロジェクトを、画面へ渡す。
//
// **関連付けから開くと、パスは起動の引数で来る。** 受け取る側が居ないと
// 「メモ帳で開きますか？」のまま何も起きない。
//
// ## 起動時は送らない。画面が取りに来る
//
// 前は「画面の読み込みが終わってから送る」形だった。ところが画面側の受け口
// （React の effect）は読み込み完了より**後**に付くので、送った物は届く前に流れ、
// 「プロジェクトから起動しても普通に立ち上がるだけ」になっていた
// （2026-10-11・本人の報告）。起動の引数は置いておき、画面側が
// `project:startupPath` で取りに来る。取りに行く形なら順番に寄らない。
//
// 2つ目の起動（second-instance。アプリが開いている所へもう1つダブルクリック）は
// 画面が出来上がっていて受け口も付いているので、今までどおり送る。
//
// ## 中身
//
// - `openPathFromArgv`       … 引数から .gcproj を拾う。起動時は置く、2つ目以降は送る
// - `sendOpenPath`           … 画面へ送る（まだ読み込み中なら覚えておく）
// - `flushPendingOpenPath`   … 画面が出来上がったとき、覚えていた物を送る
// - `registerOpenPathHandlers` … 画面が取りに来る口（ipc）を開く
import { BrowserWindow, ipcMain } from 'electron'
import { existsSync } from 'fs'
import { resolve } from 'path'
import { allowFile } from './allowList'

let pendingOpenPath: string | null = null
let startupOpenPath: string | null = null

export function sendOpenPath(p: string): void {
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

export function openPathFromArgv(argv: string[], atStartup = false): void {
  // 先頭は実行ファイル。開発中は「.」も混ざるので、拡張子で選ぶ
  const p = argv.slice(1).find((a) => /\.gcproj$/i.test(a) && existsSync(a))
  if (!p) return
  if (atStartup) {
    startupOpenPath = resolve(p)
    allowFile(startupOpenPath)
  } else sendOpenPath(resolve(p))
}

/** 画面が出来上がった（確認済みになった）ときに呼ぶ */
export function flushPendingOpenPath(win: BrowserWindow): void {
  if (!pendingOpenPath) return
  const p = pendingOpenPath
  pendingOpenPath = null
  allowFile(p)
  win.webContents.send('project:openPath', p)
}

export function registerOpenPathHandlers(): void {
  ipcMain.handle('project:startupPath', () => startupOpenPath)
}
