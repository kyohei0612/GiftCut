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
//
// ## 素材だけでは「渡す前と同じ」にならない（2026-08-17 に足した）
//
// プロジェクトが指しているファイル（動画・SE・画像）を入れても、
// **アプリ側に貯まっている物**——自分で足した効果音、テロップ素材、
// 動きのプリセット、テンプレート、お気に入り・自作スタイル・人物の控え——は
// `%APPDATA%\GiftCut\` に居るので付いていかない。サブPCで開くと
// 「プロジェクトは開けたが、いつも使っている物が無い」になる。
//
// なので ZIP の中に `設定/` を作って、そちらも丸ごと持っていく。
// 何が「利用者の持ち物」かは `shared/userAssets` が1か所で決めている。
//
// **入れる側は上書きしない向きに倒してある**（`mergeUserStore`）。
// まっさらなサブPCなら丸ごと入る＝渡す前と同じ状態。既に使っているPCなら
// そちらが勝つ。**黙って消すより、入らない方がまし。**
import { app, dialog, ipcMain } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'fs'
import { planPack, relinkProject, PROJECT_ENTRY, MANIFEST_ENTRY } from '../shared/projectPack'
import {
  ASSET_FOLDERS,
  SETTINGS_DIR,
  USER_STORE_FILE,
  mergeUserStore,
  type InstalledSettings
} from '../shared/userAssets'
import { listForZip, mergeDir, rollbackWritten } from './assetInstall'
import { writeZip, extractZip } from './zip'
import { allowProjectMedia } from './allowProjectMedia'

/** 持ち出しに入れる「アプリ側の持ち物」を集める（無い物は飛ばす＝持っていなくて正常） */
function settingsForZip(): { name: string; from: string }[] {
  const base = app.getPath('userData')
  const out = ASSET_FOLDERS.flatMap((f) => listForZip(join(base, f), `${SETTINGS_DIR}/${f}`))
  const store = join(base, USER_STORE_FILE)
  if (existsSync(store)) out.push({ name: `${SETTINGS_DIR}/${USER_STORE_FILE}`, from: store })
  return out
}

/**
 * 受け取った `設定/` を、この機械の置き場へ入れる。
 *
 * **プロジェクトを開くこと自体は止めない。** ここで転んでも、素材の繋ぎ直しは
 * 済んでいるので開ける方が良い（設定が入らなかったことは呼ぶ側が言う）。
 */
function installSettings(dir: string): InstalledSettings | null {
  if (!existsSync(dir)) return null
  const base = app.getPath('userData')
  const written: string[] = []
  const added: Record<string, number> = {}
  try {
    for (const folder of ASSET_FOLDERS) {
      const src = join(dir, folder)
      if (!existsSync(src)) continue
      const n = mergeDir(src, join(base, folder), written)
      if (n > 0) added[folder] = n
    }
    // 控え（localStorage の写し）は、鍵ごとに混ぜる。**この機械に在る鍵は触らない**
    let keysAdded = 0
    let keysKept = 0
    const incomingPath = join(dir, USER_STORE_FILE)
    if (existsSync(incomingPath)) {
      const read = (p: string): Record<string, string> => {
        if (!existsSync(p)) return {}
        try {
          const o = JSON.parse(readFileSync(p, 'utf-8'))
          return o && typeof o === 'object' ? o : {}
        } catch {
          return {} // 壊れていたら「無い」扱い（開くのを止めない）
        }
      }
      const dst = join(base, USER_STORE_FILE)
      const { merged, added: ka, kept } = mergeUserStore(read(dst), read(incomingPath))
      if (ka.length) {
        // 一時ファイルへ書いてから置き換える（途中で落ちても元が壊れない。`main/index` と同じ手）
        const tmpFile = dst + '.tmp'
        writeFileSync(tmpFile, JSON.stringify(merged, null, 1), 'utf-8')
        renameSync(tmpFile, dst)
      }
      keysAdded = ka.length
      keysKept = kept.length
    }
    return { added, keysAdded, keysKept }
  } catch (er) {
    rollbackWritten(written)
    return { added: {}, keysAdded: 0, keysKept: 0, error: String(er) }
  }
}

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

      // **アプリ側の持ち物も一緒に。** 素材だけだと、渡した先で
      // 「いつも使っている効果音・テロップ素材・お気に入り」が全部無い状態になる
      const settings = settingsForZip()
      const manifest = {
        app: 'GiftCut',
        version: app.getVersion(),
        作成: new Date().toISOString(),
        素材の数: plan.files.length,
        設定の数: settings.length,
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
          ...plan.files.map((f) => ({ name: f.to.replace(/\\/g, '/'), from: f.from })),
          ...settings
        ],
        (percent) => e.sender.send('pack:progress', { percent })
      )
      const size = statSync(save.filePath).size
      return {
        ok: true,
        path: save.filePath,
        files: plan.files.length,
        settings: settings.length,
        missing: plan.missing,
        size
      }
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
      // **設定はプロジェクトの後。** ここで転んでも開くのは止めない
      const settings = installSettings(join(dest, SETTINGS_DIR))
      const videoExists = allowProjectMedia(data)
      e.sender.send('pack:progress', { percent: 100 })
      return { ok: true, path: outPath, dir: dest, data, videoExists, settings }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })
}
