// プロジェクトの持ち出し——素材ごと1つの ZIP にまとめる／受け取って展開する。
//
// 渡す側は「まとめて書き出す」で ZIP を作り、受け取る側は「まとめを開く」で展開する。
// 素材のパスは ZIP の中の場所（素材/○○）に書き換えて入れ、展開時に展開先の
// 絶対パスへ戻す。書き換え規則は `shared/projectPack` にあり、単体で確かめてある。
//
// ## 圧縮は掛けない
//
// 動画も音声も画像も既に圧縮済みで、掛けても数%しか減らないのに
// **数GBを読み直すぶんの時間だけ確実に増える**（＝待たせるだけになる）。
//
// ## 受け取り先を上書きしない
//
// 展開先は「ドキュメント/GiftCut/受け取ったプロジェクト/<ZIPの名前>」。
// 同じ名前があれば (2) を付けて別の場所にする。
import { app, dialog, ipcMain } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'fs'
import { planPack, relinkProject, PROJECT_ENTRY, MANIFEST_ENTRY } from '../shared/projectPack'
import { writeZip, extractZip } from './zip'
import { allowProjectMedia } from './allowProjectMedia'

/** 持ち出しの受け口。**`registerProjectFileHandlers()` から1回だけ呼ぶ。** */
export function registerPackHandlers(): void {
  ipcMain.handle('pack:save', async (e, json: string, suggestName?: string) => {
    try {
      const project = JSON.parse(json)
      const plan = planPack(project, { exists: (p: string) => existsSync(p) })
      const base = (suggestName || '無題プロジェクト').replace(/[\\/:*?"<>|]/g, '_')
      const save = await dialog.showSaveDialog({
        title: 'プロジェクトを素材ごとまとめて書き出す',
        defaultPath: base + '.zip',
        filters: [{ name: 'GiftCut まとめ', extensions: ['zip'] }]
      })
      if (save.canceled || !save.filePath) return { ok: false, canceled: true }

      const manifest = {
        app: 'GiftCut',
        version: app.getVersion(),
        作成: new Date().toISOString(),
        素材の数: plan.files.length,
        見つからなかった素材: plan.missing,
        // 元がどこにあったかは、受け取り側で差し替えるときの手がかりになる
        対応表: plan.files.map((f) => ({ 元: f.from, 中: f.to }))
      }
      await writeZip(
        save.filePath,
        [
          {
            name: PROJECT_ENTRY,
            data: Buffer.from(JSON.stringify(plan.project, null, 1), 'utf-8')
          },
          { name: MANIFEST_ENTRY, data: Buffer.from(JSON.stringify(manifest, null, 2), 'utf-8') },
          ...plan.files.map((f) => ({ name: f.to.replace(/\\/g, '/'), from: f.from }))
        ],
        (percent) => e.sender.send('pack:progress', { percent })
      )
      const size = statSync(save.filePath).size
      return { ok: true, path: save.filePath, files: plan.files.length, missing: plan.missing, size }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  // 受け取り側。ZIP を展開し、パスを繋ぎ直した .gcproj を書いてから、その中身を返す。
  ipcMain.handle('pack:open', async (e, zipPath?: string) => {
    let target = zipPath
    if (!target) {
      const { canceled, filePaths } = await dialog.showOpenDialog({
        title: 'まとめたプロジェクトを開く',
        filters: [{ name: 'GiftCut まとめ', extensions: ['zip'] }],
        properties: ['openFile']
      })
      if (canceled || !filePaths.length) return { ok: false, canceled: true }
      target = filePaths[0]
    }
    if (!existsSync(target)) return { ok: false, error: 'ファイルが見つかりません: ' + target }
    try {
      const stem = target.split(/[\\/]/).pop()!.replace(/\.zip$/i, '')
      const root = join(app.getPath('documents'), 'GiftCut', '受け取ったプロジェクト')
      let dest = join(root, stem)
      for (let i = 2; existsSync(dest); i++) dest = join(root, `${stem} (${i})`)
      mkdirSync(dest, { recursive: true })

      const held = await extractZip(target, dest, {
        keepInMemory: [PROJECT_ENTRY],
        onProgress: (percent) => e.sender.send('pack:progress', { percent })
      })
      const projectJson = held[PROJECT_ENTRY]
      if (!projectJson) {
        // 展開はしたが中身が違った。空のフォルダを残さない
        rmSync(dest, { recursive: true, force: true })
        return {
          ok: false,
          error: 'この ZIP は GiftCut のまとめではないようです（プロジェクトが入っていません）'
        }
      }
      const data = relinkProject(JSON.parse(projectJson), dest)
      const outPath = join(dest, stem + '.gcproj')
      writeFileSync(outPath, JSON.stringify(data, null, 1), 'utf-8')
      const videoExists = allowProjectMedia(data)
      e.sender.send('pack:progress', { percent: 100 })
      return { ok: true, path: outPath, dir: dest, data, videoExists }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })
}
