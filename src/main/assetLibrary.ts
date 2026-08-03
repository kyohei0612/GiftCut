// テロップの見本帳（telop-presets/*.json を並べる）。
//
// ## 元は5つ入っていた
//
// このファイルは 2026-08-03 まで「効果音・テロップの見本・動きの見本帳・
// 素材パック・フォルダを開く」の5つ（＋宣言の無かったプロジェクト保存で6つ）を
// 抱えていた。**頭のコメント自身が5つ挙げていた**ので、そこで切った。
// 5組は定数もヘルパも1つも共有しておらず、またぐ名前は 0 / 0 だった:
//
//   効果音        → ./seLibrary
//   動きの見本帳  → ./motionPresets
//   素材パック    → ./assetPacks
//   保存          → ./projectFiles（開く・下書き・持ち出しと同じ場所）
//
// ## 置き場は1つではない。全部足す
//
// 並べ方は `./assetRoots` の1本に寄せてある。**見つかった1つ目で打ち切らない**
// ——同梱ぶんが入っている版で、userData に足した物が永遠に出てこなくなる。
// 同じ名前は先に見つけた方が勝つ。ただし**重複を落とすのは置き場をまたいだ時だけ**
//（1つの置き場の中で間引くと「素材が減った」になる）。
//
// ## 配布物には同梱しない
//
// テロップの見本は再配布できないので、公開用のビルドからは外してある
// （scripts/check-packaged.mjs が見張っている）。無ければ空を返すこと。

import { ipcMain } from 'electron'
import { join } from 'path'
import { readFileSync, readdirSync } from 'fs'
import { assetRoots } from './assetRoots'

/** テロップの見本帳の受け口。**app.whenReady() の中で1回だけ呼ぶ。** */
export function registerAssetHandlers(): void {


// ローカルのテロップテンプレ集（GiftCut/telop-presets/*.json）。Geba等・配布に含めない。
ipcMain.handle('telop:presets', () => {
  // SE と同じ並べ方（./assetRoots）。同じ名前は先に見つけた方が勝つ
  const roots = assetRoots('telop-presets')
  if (roots.length === 0) return { ok: false, items: [] as unknown[] }
  const items: unknown[] = []
  // 重複を落とすのは**置き場をまたいだ時だけ**。1つの置き場の中で同じ名前が
  // 並んでいるのは向こうの都合なので、勝手に間引くと「素材が減った」になる。
  const seen = new Set<string>()
  for (const root of roots) {
    const here = new Set<string>()
    let files: string[]
    try {
      files = readdirSync(root)
    } catch {
      continue
    }
    for (const f of files) {
      if (!f.toLowerCase().endsWith('.json')) continue
      try {
        const arr = JSON.parse(readFileSync(join(root, f), 'utf-8'))
        if (Array.isArray(arr)) {
          for (const t of arr) {
            if (!t || !t.name || !t.style || seen.has(t.name)) continue
            here.add(t.name)
            items.push(t)
          }
        }
      } catch {
        /* 壊れたJSONはスキップ */
      }
    }
    for (const n of here) seen.add(n)
  }
  return { ok: true, items }
})



// スクリーンショット保存（data:image/png;base64 を PNG として書き出す）
}
