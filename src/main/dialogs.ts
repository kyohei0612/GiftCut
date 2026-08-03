// 「選ばせる窓」を出す受け口——開く・フォルダを選ぶ・保存する。
//
// ## なぜ本体（index）から出したか
//
// `main/index.ts` には**話題を宣言する冒頭コメントが無く**、窓・`gcfile://` の配信・
// ダイアログ・素材の下調べ・ユーザー設定・聞き取り・計測の7つが同居していた。
// あちらの終わりに「受け口はそれぞれ別ファイル（この1つのファイルに全部置くと
// 読み切れなくなる）」と書いてあるのに、ここが残っていた
// （2026-08-03。中身は変えていない。またぐ名前は0個）。
//
// ## 開いた物は必ず名簿へ通す
//
// 画面へ配ってよいファイルは `allowFile` で名簿に載せた物だけ。
// **選ばせた直後に載せる**（あとで載せる形にすると、載せ忘れた道ができる）。

import { app, dialog, ipcMain } from 'electron'
import { join } from 'path'
import { readFileSync, readdirSync, writeFileSync } from 'fs'
import { allowFile } from './allowList'

/** 「メディアを追加」で拾う拡張子。フォルダごと追加のときの選別にも同じ表を使う */
const MEDIA_EXT = [
  'mp4', 'mov', 'mkv', 'webm', 'avi',
  'mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac',
  'png', 'jpg', 'jpeg', 'gif', 'webp'
]

export function registerDialogHandlers(): void {
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

  // 書き出し先の既定（まだ一度も選んでいないとき）。
  // **プレミアと同じで「ダウンロード」から始める。** 二度目からは
  // 前に選んだ場所を画面側が覚えているので、ここは初回だけ効く。
  ipcMain.handle('path:downloads', () => {
    try {
      return { ok: true, path: app.getPath('downloads') }
    } catch {
      return { ok: false }
    }
  })

  // 書き出し先のフォルダを選ぶ（ファイルではなくフォルダを選ばせる）
  ipcMain.handle('dialog:chooseDir', async (_e, current?: string) => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: '書き出し先のフォルダを選択',
      defaultPath: current || undefined,
      properties: ['openDirectory', 'createDirectory']
    })
    if (canceled || !filePaths.length) return null
    return { path: filePaths[0] }
  })

  // メディア（動画/音声/画像）を複数追加。gcfile 配信を許可してパス一覧を返す
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

  // スクショの保存先を選ばせて書く
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
}
