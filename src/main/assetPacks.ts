// 素材パック（ZIP）をまとめて取り込む／「更新で消えない置き場」を開く。
//
// ## なぜ素材の置き場から出したか
//
// 元は `assetLibrary.ts` に5つと同居していた（またぐ名前は 0 / 0）。
// `ASSET_FOLDERS` はこの2つでしか読まれないので、一緒に連れてきた
// （2026-08-03。中身は変えていない）。
//
// ## 手順が3つあると、必ずどれかで間違える
//
// 「フォルダを開いて、展開して、中身を貼る」は3手あり、**どれか1つでも
// 間違えると素材が出てこない**（しかも間違いに気づけない）。
// ZIP を選ぶだけで済むようにする。展開も置き場所の判断もこちらでやる。
//
// **入れるのは決まった名前のフォルダだけ。** ZIP の中に何が入っていても、
// 知らない物は userData へ撒かない（受け取った ZIP を無条件に展開しない）。
//
// ## 開く道が無ければ、無いのと同じ
//
// 更新で消えない場所があっても、本人が辿れなければ意味がない。
// 無ければ作ってから開く。

import { app, dialog, ipcMain, shell } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { extractZip } from './zip'
import { mergeDir, rollbackWritten } from './assetInstall'
// **一覧は `shared/userAssets` が持つ。ここで数えない。**
// 2026-08-17 まではここが唯一の持ち主で、**持ち出す側からは見えなかった**
import { ASSET_FOLDERS } from '../shared/userAssets'

/** 素材パックと「フォルダを開く」の受け口。**app.whenReady() の中で1回だけ呼ぶ。** */
export function registerAssetPackHandlers(): void {
// 動きの記録を書き出す。**画面側の blob ダウンロードは Electron では落ちる**
// （何も起きないので「保存した」と思ったまま失われる）。本体で書けば確実に残る。
//
// toDownloads=true なら**ダウンロードへ、確認なしで**置く。
// 「おかしいぞ」と思った人がボタン1つで出せて、そのファイルをそのまま渡せる形にする。
// 保存ダイアログを挟むと、置き場所で迷って結局出てこない。
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
    /** 入れた物を消して、元の状態へ戻す（道具は `./assetInstall`） */
    const rollback = (): void => rollbackWritten(written)
    try {
      for (const folder of ASSET_FOLDERS) {
        const src = join(tmpDir, folder)
        if (!existsSync(src)) continue
        const n = mergeDir(src, join(base, folder), written)
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
}
