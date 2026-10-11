// 画面へ配っている素材（動画・画像・音）が**外から書き換えられた**ら、画面に知らせる。
//
// ## なぜ要るか
//
// 素材は写しを取らず、置いてある場所をそのまま参照している（Downloads の画像など）。
// 本人の指定（2026-10-11）: 「GiftCut を使っている最中にその画像が別の物に上書き
// されたら、入れ替えなくてもアプリも変わるように」。
// 画面（Chromium）は同じ URL の <img>/<video> を取り直さないので、
// 書き換わったことを**こちらが見張って**画面へ言う必要がある。
//
// ## 見張り方
//
// `fs.watch` ではなく `fs.watchFile`（1秒ごとの polling）。Windows では
// 「別名で書いて名前を付け替える」保存を `fs.watch` が取りこぼすことがあり、
// 上書き保存の最中（書きかけ）も拾ってしまう。mtime と size が**1秒動かなくなってから**
// 1回だけ知らせる（書いている最中に読むと壊れた絵が出る）。
//
// アプリが自分で作った物（プロキシ・サムネ＝userData の中）は見張らない。
// 自分で書き換えるので、知らせると空回りする。OS の一時フォルダは除外しない
//（確認（e2e）の素材はそこに置かれる。アプリが一時フォルダに作る物は名簿に入れない）。
//
// ## 中身
//
// - `watchMedia` … そのファイルを見張り始める（名簿に入ったときに呼ばれる）
// - `stopWatching` … 終了時に全部やめる
// - `isOwnFile` … アプリが自分で作った物か（見張らない）
// - `broadcast` … 全部の窓へ `media:changed` を送る
import { BrowserWindow, app } from 'electron'
import { statSync, unwatchFile, watchFile } from 'fs'
import { normalize } from 'path'

const watching = new Map<string, { mtime: number; size: number; timer: NodeJS.Timeout | null }>()
/** 見張る本数の上限。素材ビンが数百でも足りるが、際限なく増えないように */
const MAX_WATCH = 500

function isOwnFile(p: string): boolean {
  const n = p.toLowerCase()
  return n.startsWith(app.getPath('userData').toLowerCase())
}

function broadcast(p: string, mtimeMs: number): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('media:changed', { path: p, mtimeMs })
  }
}

/** そのファイルを見張り始める。既に見張っていれば何もしない */
export function watchMedia(path: string): void {
  const p = normalize(path)
  if (watching.has(p) || isOwnFile(p) || watching.size >= MAX_WATCH) return
  let st: { mtime: number; size: number }
  try {
    const s = statSync(p)
    st = { mtime: s.mtimeMs, size: s.size }
  } catch {
    return // 無いファイルは見張れない（後で置かれても、名簿に入り直すときに見張る）
  }
  const entry = { ...st, timer: null as NodeJS.Timeout | null }
  watching.set(p, entry)
  watchFile(p, { interval: 1000 }, (cur) => {
    // 消えた・書きかけは待つ。落ち着いてから1回
    if (cur.mtimeMs === entry.mtime && cur.size === entry.size) return
    entry.mtime = cur.mtimeMs
    entry.size = cur.size
    if (entry.timer) clearTimeout(entry.timer)
    entry.timer = setTimeout(() => {
      entry.timer = null
      if (cur.size > 0) broadcast(p, cur.mtimeMs)
    }, 1000)
  })
}

/** 終了時。全部やめる（残すとプロセスが終われない） */
export function stopWatching(): void {
  for (const [p, e] of watching) {
    if (e.timer) clearTimeout(e.timer)
    unwatchFile(p)
  }
  watching.clear()
}
