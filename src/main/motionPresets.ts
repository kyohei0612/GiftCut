// 動きの見本帳——並べる・Premiere の .prfpset から取り込む。
//
// ## なぜ素材の置き場から出したか
//
// 元は `assetLibrary.ts` に5つと同居していた（またぐ名前は 0 / 0）。
// `parsePrfpset` / `toMotion` / `isFullyCopyable` / `endsHidden` は
// **全部この話題でしか使っていない**ので、丸ごと連れてきた
// （2026-08-03。中身は変えていない）。
//
// ## 読むのも変換するのも shared
//
// .prfpset の解釈は `shared/prfpset`、こちらの「動き」への変換は
// `shared/prfpsetImport`。ここは**置き場の世話だけ**をする。
// .prfpset そのものは持たない——読んだ結果（＝Motion）だけを残す。
//
// ## 取り込んだ物は userData へ書く
//
// アプリを入れ直しても消えない側。並べるときは同梱ぶんも見る
// （`./assetRoots`。**ここだけ resourcesPath が抜けていて、exe 1つで配る版では
// 同梱した動きが1つも出てこなかった**——2026-08-03 に直した）。

import { app, dialog, ipcMain } from 'electron'
import { join } from 'path'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs'
import { parsePrfpset } from '../shared/prfpset'
import { toMotion, isFullyCopyable, endsHidden } from '../shared/prfpsetImport'
import type { MotionPresetFile } from '../shared/telopMotion'
import { assetRoots } from './assetRoots'

/** 動きの見本帳の受け口。**app.whenReady() の中で1回だけ呼ぶ。** */
export function registerMotionPresetHandlers(): void {
// ---- 動きのプリセット（Premiere の .prfpset から写し取ったもの）----
//
// 置き場はテロップのテンプレ集と同じ考え方（appPath / resourcesPath / userData）。
// **取り込んだ物は userData に書く**（アプリを入れ直しても消えない側）。
// .prfpset そのものは持たない。読んだ結果（＝こちらの Motion）だけを残す。
//
// **`resourcesPath` は 2026-08-03 に足した。ここだけ抜けていた。**
// 効果音（se:list）とテロップの見本（telop:presets）は最初から3つ見ているのに、
// 動きの見本帳だけ2つしか見ていなかった＝**exe 1つで配る版では、同梱した
// 動きが1つも出てこない**。このファイルの冒頭が名指しで戒めている
// 「同梱ぶんが出てこない」事故が、ここでは現に起きる形だった。
const motionRoots = (): string[] => assetRoots('motion-presets')
const motionWriteRoot = (): string => join(app.getPath('userData'), 'motion-presets')
/** 前に .prfpset を選んだ場所。次に開くときの出発点にする（毎回探し直させない） */
let lastMotionDir: string | null = null

ipcMain.handle('motion:list', () => {
  const items: MotionPresetFile[] = []
  const seen = new Set<string>()
  for (const root of motionRoots()) {
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
        if (!Array.isArray(arr)) continue
        for (const t of arr) {
          // 同じ名前が2つの置き場にあれば、先に見つけた方（自分で取り込んだぶん）が勝つ
          if (!t || typeof t.name !== 'string' || !t.motion || seen.has(t.name)) continue
          seen.add(t.name)
          items.push(t)
        }
      } catch {
        /* 壊れた JSON は飛ばす（1つで全部が読めなくなるのを避ける） */
      }
    }
  }
  return { ok: true, items }
})

// .prfpset を選んで読み、こちらの形にして保存する。
//
// **1つも落とさない。** 動きが取れなかった物も名前だけ残す。
// どれを使うか（どれを配布に載せるか）を決めるのは人で、こちらが先に間引くと
// 「そもそも何が入っていたか」が見えなくなる。押したときに理由を言えばいい。
ipcMain.handle('motion:import', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Premiere のプリセット（.prfpset）を選ぶ',
    // **どこを開くかを決めておく。** 決めないと前回どこかで開いた場所から始まり、
    // 探しているファイルまで自力で辿ることになる（見つけられず閉じる＝
    // 「押しても何も起きない」に見える）。2回目からは前に選んだ場所。
    defaultPath: lastMotionDir ?? app.getPath('desktop'),
    filters: [
      { name: 'Premiere のプリセット (*.prfpset)', extensions: ['prfpset'] },
      // 拡張子で隠れて「ファイルが1つも見えない」を避ける逃げ道
      { name: 'すべてのファイル', extensions: ['*'] }
    ],
    properties: ['openFile']
  })
  if (canceled || filePaths.length === 0) return { ok: false, canceled: true }
  try {
    const src = filePaths[0]
    lastMotionDir = src.replace(/[\\/][^\\/]*$/, '')
    const presets = parsePrfpset(readFileSync(src, 'utf-8'))
    // 選んだのに0件なら**必ず言う。** 黙って終わると「壊れている」としか見えない
    if (presets.length === 0)
      return {
        ok: false,
        error: `「${src.split(/[\\/]/).pop()}」から動きが1つも見つかりませんでした。Premiere で書き出した .prfpset か確認してください。`
      }
    const items: MotionPresetFile[] = []
    for (const p of presets) {
      const { motion, skipped } = toMotion(p)
      // 動きが空でも入れる。**押したときに「何が要るか」を言える**ようにするため、
      // 持ってこられなかったエフェクトの名前は必ず添える
      const missing = [
        ...new Set([
          ...p.effects.filter((e) => !isFullyCopyable({ name: '', effects: [e] })).map((e) => e.matchName),
          ...skipped
        ])
      ]
      items.push({
        name: p.name,
        motion,
        ...(missing.length ? { partial: missing } : {}),
        // 終わりで消える物（2枚重ねの上側）。単体で当てると文字が消えるので印を付ける
        ...(endsHidden(motion) ? { endsHidden: true } : {})
      })
    }
    const empty = items.filter((t) => Object.keys(t.motion).length === 0).length
    const root = motionWriteRoot()
    mkdirSync(root, { recursive: true })
    const base =
      (src.split(/[\\/]/).pop() ?? 'presets').replace(/\.prfpset$/i, '').replace(/[\\/:*?"<>|]/g, '_') ||
      'presets'
    const out = join(root, base + '.json')
    writeFileSync(out, JSON.stringify(items, null, 2), 'utf-8')
    return {
      ok: true,
      path: out,
      items,
      // 中身の内訳を返す。**どれが「そのまま使える」かを人が決められるように。**
      //   total   … ファイルに入っていた数（＝並ぶ数。1つも落とさない）
      //   partial … 一部だけ再現できる（こちらに無いエフェクトが混ざっている）
      //   empty   … 動きが1つも取れなかった（名前だけ並ぶ）
      total: presets.length,
      imported: items.length,
      partial: items.filter((t) => t.partial?.length && Object.keys(t.motion).length).length,
      empty
    }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
})
}
