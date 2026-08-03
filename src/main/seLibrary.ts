// 効果音（SE）の置き場——並べる・入れる。
//
// ## なぜ素材の置き場から出したか
//
// 元は `assetLibrary.ts` に、テロップの見本・動きの見本帳・素材パック・
// プロジェクト保存と同居していた。**あのファイルの頭のコメント自身が5つ挙げていて**、
// 実際には6つ（宣言されていない `project:save` を含む）入っていた。
// 5組は定数もヘルパも1つも共有していない（またぐ名前は 0 / 0）
// （2026-08-03。中身は変えていない）。
//
// ## 置き場は1つではない。全部足す
//
// 並べ方は `./assetRoots` の1本に寄せてある。**見つかった1つ目で打ち切らない**
// ——同梱ぶんが入っている版で、userData に足した音が永遠に出てこなくなる。
//
// ## 配布物には同梱しない
//
// 効果音ラボ由来なので再配布できない。公開用のビルドからは外してある
// （scripts/check-packaged.mjs が見張っている）。無ければ空を返すこと。

import { app, dialog, ipcMain } from 'electron'
import { join } from 'path'
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'fs'
import { allowFile } from './allowList'
import { assetRoots } from './assetRoots'

/** 効果音の受け口（並べる・入れる）。**app.whenReady() の中で1回だけ呼ぶ。** */
export function registerSeHandlers(): void {
// 内蔵SEライブラリ: GiftCut/SE をサブフォルダ=カテゴリで列挙。
// 各ファイルを allowlist に登録してプレビュー再生(gcfile://)を可能にする。
// ※効果音ラボ由来のため配布ビルドにはSEフォルダを含めない（無ければ空を返す）。

ipcMain.handle('se:list', () => {
  // 置き場。渡した相手に「ここへ入れて」と言える固定の場所（userData）が要る。
  //
  // **起動時のカレントディレクトリは見ない。**
  // 以前は候補に入れていたが、
  //   ・たまたま素材フォルダのある所から起動すると、意図しない素材を読む
  //   ・手元で配布版を確かめると「素材が入っている」ように見えてしまう
  //     （実際に検証中、空のはずの配布版でテロップ素材が217件出た）
  // という事故になる。開発中は appPath がリポジトリ直下を指すので、
  // これを外しても手元の素材は今までどおり読める。
  // **見つかった置き場を全部足す。** 1つ目で打ち切ると、同梱の素材が入っている版
  // （exe 1つで配る身内用）では userData に足したぶんが永遠に出てこない。
  // 「フォルダを開く」から入れたのに増えない、という筋の通らない状態になる。
  // 並べ方は ./assetRoots に1本化してある（3回書けば1回は抜ける、を実際にやった）
  const roots = assetRoots('SE')
  if (roots.length === 0)
    return { ok: false, items: [] as { category: string; name: string; path: string }[] }
  const items: { category: string; name: string; path: string }[] = []
  const nameOf = (n: string): string => n.replace(/\.[^.]+$/, '')
  // 同じ「分類/名前」が2つの置き場にあれば、先に見つけた方だけを出す
  const seen = new Set<string>()
  const add = (category: string, name: string, path: string): void => {
    const key = `${category}/${name}`
    if (seen.has(key)) return
    seen.add(key)
    allowFile(path)
    items.push({ category, name, path })
  }
  for (const root of roots) {
    let entries: import('fs').Dirent[]
    try {
      entries = readdirSync(root, { withFileTypes: true })
    } catch {
      continue
    }
    for (const ent of entries) {
      const full = join(root, ent.name)
      if (ent.isDirectory()) {
        let sub: string[]
        try {
          sub = readdirSync(full)
        } catch {
          continue
        }
        for (const f of sub) if (isSeAudio(f)) add(ent.name, nameOf(f), join(full, f))
      } else if (isSeAudio(ent.name)) {
        add('その他', nameOf(ent.name), full)
      }
    }
  }
  return { ok: true, root: roots[0], items }
})

// ---- SE を置き場へ入れる ----
//
// **一覧に「ここへ入れてください」と書くだけでは入口になっていない。**
// まっさらな状態の SE タブは「GiftCut/SE フォルダに mp3 を入れてください」
// としか出ておらず、そこから辿れるボタンが1つも無かった。
// 追加はプロジェクトと同じ作法（ボタンで選ぶ／掴んで落とす）に揃える。
//
// 入れ方は2通り。**どちらも userData/SE の下に写す**（更新で消えない場所）。
//   ファイル … 直下へ。一覧では「その他」に並ぶ
//   フォルダ … 名前ごと1階層で写す。一覧では**畳んだ分類**として出る
// **音として扱う拡張子は、この1つだけ。**
// 2026-08-03 まで `AUDIO`（se:list の中）と `SE_AUDIO`（取り込み側）に
// 同じ並びが2つあり、判定関数（isAudio / isSeAudio）も本体が同一だった。
// 片方に足しただけだと「一覧には出るのに取り込めない」形でズレる。
const SE_AUDIO = ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac']
const seImportRoot = (): string => join(app.getPath('userData'), 'SE')
/** 同じ名前があっても上書きしない（消えたと思われるのが一番困る） */
const freeName = (dir: string, name: string): string => {
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  let p = join(dir, name)
  for (let i = 2; existsSync(p); i++) p = join(dir, `${stem} (${i})${ext}`)
  return p
}
const isSeAudio = (n: string): boolean =>
  SE_AUDIO.includes(n.toLowerCase().split('.').pop() ?? '')
/**
 * 受け取った物を SE の置き場へ写す。
 * ファイルは直下（一覧では「その他」）、フォルダは名前ごと1階層（畳んだ分類）。
 */
const seImportPaths = (
  list: string[]
): { ok: boolean; files?: number; folders?: number; root?: string; error?: string } => {
  const root = seImportRoot()
  mkdirSync(root, { recursive: true })
  let files = 0
  let folders = 0
  for (const src of list) {
    if (!src || !existsSync(src)) continue
    if (statSync(src).isDirectory()) {
      // Windows のパスは \ 区切り。**両方入れること**（片方だと分解できず、
      // 置き場の下にフルパスの名前でファイルを作ろうとして失敗する）
      const name = src.split(/[\\/]/).filter(Boolean).pop() ?? 'SE'
      const dst = freeName(root, name)
      mkdirSync(dst, { recursive: true })
      let got = 0
      for (const f of readdirSync(src)) {
        const full = join(src, f)
        try {
          if (statSync(full).isFile() && isSeAudio(f)) {
            copyFileSync(full, freeName(dst, f))
            got++
          }
        } catch {
          /* 読めない物は飛ばす */
        }
      }
      if (got > 0) {
        folders++
        files += got
      } else rmSync(dst, { recursive: true, force: true }) // 空の分類は作らない
    } else if (isSeAudio(src)) {
      copyFileSync(src, freeName(root, src.split(/[\\/]/).pop() ?? '音.mp3'))
      files++
    }
  }
  if (files === 0)
    return { ok: false, error: '音のファイルが見つかりませんでした（mp3 / wav / m4a など）' }
  return { ok: true, files, folders, root }
}
/** 掴んで落とした物・選んだ物を入れる（paths を渡さなければファイル選択を出す） */
ipcMain.handle('se:import', async (_e, paths?: string[]) => {
  try {
    let list = Array.isArray(paths) ? paths.filter((p) => typeof p === 'string' && p) : []
    if (!list.length) {
      const r = await dialog.showOpenDialog({
        title: '音を追加',
        filters: [{ name: '音', extensions: SE_AUDIO }],
        properties: ['openFile', 'multiSelections']
      })
      if (r.canceled || !r.filePaths.length) return { ok: false, canceled: true }
      list = r.filePaths
    }
    return seImportPaths(list)
  } catch (e) {
    return { ok: false, error: String(e) }
  }
})
/** フォルダを選んで、そのフォルダごと入れる（分類として畳んだ状態で入る） */
ipcMain.handle('se:importFolder', async () => {
  try {
    const r = await dialog.showOpenDialog({
      title: 'フォルダごと音を追加',
      properties: ['openDirectory', 'multiSelections']
    })
    if (r.canceled || !r.filePaths.length) return { ok: false, canceled: true }
    return seImportPaths(r.filePaths)
  } catch (e) {
    return { ok: false, error: String(e) }
  }
})
}
