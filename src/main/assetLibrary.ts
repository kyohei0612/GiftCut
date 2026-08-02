// 素材の置き場——効果音・テロップの見本・動きの見本帳・取り込み（ZIP）・フォルダを開く。
//
// ## 置き場は1つではない。**全部足す**
//
// 素材は3か所に居る:
//
//   同梱（アプリと一緒に配る物）      … resources/ か appPath/
//   ユーザーが入れた物                … userData/
//   開発中に置いた物                  … cwd/
//
// **見つかった1つ目で打ち切ってはいけない。** 以前そうなっていて、同梱ぶんが入っている
// 身内用の exe では **userData に足した音が永遠に出てこなかった**。
// 「フォルダを開く」から入れても増えない、という筋の通らない状態になる。
//
// 同じ名前は先に見つけた方が勝つ。ただし**重複を落とすのは置き場をまたいだ時だけ**
//（1つの置き場の中で間引くと「素材が減った」になる）。
//
// ## 「フォルダを開く」が要る理由
//
// 更新で消えない場所があっても、**開く道が無ければ本人には無いのと同じ**。
// 無ければ作ってから開く。
//
// ## 配布物には同梱しない物がある
//
// 効果音（効果音ラボ由来）とテロップの見本は再配布できないので、公開用のビルドからは
// 外してある（scripts/check-packaged.mjs が見張っている）。無ければ空を返すこと。
import { app, dialog, ipcMain, shell } from 'electron'
import { join, normalize } from 'path'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'fs'
import { createHash } from 'crypto'
import { tmpdir } from 'os'
// Premiere のプリセット（.prfpset）を読んで、こちらの「動き」にする。
// **読むのも変換するのも shared に置いてある**ので、ここは置き場の世話だけをする。
import { parsePrfpset } from '../shared/prfpset'
import { toMotion, isFullyCopyable, endsHidden } from '../shared/prfpsetImport'
import type { MotionPresetFile } from '../shared/telopMotion'
import { extractZip } from './zip'
import { allowFile } from './allowList'
import { seRoots } from './assetRoots'
// 保存する物の整合性検査。取り込んだプロジェクトも同じ道を通す
import { inspectProject } from './projectFiles'

/** 更新で消えない置き場（ファイルメニューから開ける物）。無ければ作ってから開く */
const ASSET_FOLDERS = ['SE', 'telop-presets', 'motion-presets', 'テンプレート'] as const

/** 素材の置き場まわりの受け口。**app.whenReady() の中で1回だけ呼ぶ。** */
export function registerAssetHandlers(): void {

// 内蔵SEライブラリ: GiftCut/SE をサブフォルダ=カテゴリで列挙。
// 各ファイルを allowlist に登録してプレビュー再生(gcfile://)を可能にする。
// ※効果音ラボ由来のため配布ビルドにはSEフォルダを含めない（無ければ空を返す）。

ipcMain.handle('se:list', () => {
  const AUDIO = ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac']
  // 置き場。渡した相手に「ここへ入れて」と言える固定の場所（userData）が要る。
  //
  // **起動時のカレントディレクトリは見ない。**
  // 以前は候補に入れていたが、
  //   ・たまたま素材フォルダのある所から起動すると、意図しない素材を読む
  //   ・手元で配布版を確かめると「素材が入っている」ように見えてしまう
  //     （実際に検証中、空のはずの配布版でテロップ素材が217件出た）
  // という事故になる。開発中は appPath がリポジトリ直下を指すので、
  // これを外しても手元の素材は今までどおり読める。
  const candidates = [
    join(app.getAppPath(), 'SE'),
    // **exe 1つで配る版**は、素材を中に同梱する（解凍させないため）
    join(process.resourcesPath ?? '', 'SE'),
    join(app.getPath('userData'), 'SE')
  ]
  // **見つかった置き場を全部足す。** 1つ目で打ち切ると、同梱の素材が入っている版
  // （exe 1つで配る身内用）では userData に足したぶんが永遠に出てこない。
  // 「フォルダを開く」から入れたのに増えない、という筋の通らない状態になる。
  const roots = candidates.filter((r) => existsSync(r))
  if (roots.length === 0)
    return { ok: false, items: [] as { category: string; name: string; path: string }[] }
  const items: { category: string; name: string; path: string }[] = []
  const isAudio = (n: string): boolean => AUDIO.includes(n.toLowerCase().split('.').pop() ?? '')
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
        for (const f of sub) if (isAudio(f)) add(ent.name, nameOf(f), join(full, f))
      } else if (isAudio(ent.name)) {
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

// ローカルのテロップテンプレ集（GiftCut/telop-presets/*.json）。Geba等・配布に含めない。
ipcMain.handle('telop:presets', () => {
  // SE と同じ理由で userData も見る（起動のされ方に左右されない置き場）
  const candidates = [
    join(app.getAppPath(), 'telop-presets'),
    join(process.resourcesPath ?? '', 'telop-presets'),
    join(app.getPath('userData'), 'telop-presets')
  ]
  // SE と同じく、見つかった置き場を全部足す（同梱があると自分で足したぶんが
  // 出てこない、という状態を作らないため）。同じ名前は先に見つけた方が勝つ。
  const roots = candidates.filter((r) => existsSync(r))
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

// ---- 動きのプリセット（Premiere の .prfpset から写し取ったもの）----
//
// 置き場はテロップのテンプレ集と同じ考え方（cwd / appPath / userData）。
// **取り込んだ物は userData に書く**（アプリを入れ直しても消えない側）。
// .prfpset そのものは持たない。読んだ結果（＝こちらの Motion）だけを残す。
const motionRoots = (): string[] =>
  [
    join(app.getAppPath(), 'motion-presets'),
    join(app.getPath('userData'), 'motion-presets')
  ].filter((r) => existsSync(r))
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
    /** フォルダごと足す（同じ名前は上書き。無い物はそのまま残す） */
    const merge = (from: string, to: string): number => {
      let n = 0
      mkdirSync(to, { recursive: true })
      for (const name of readdirSync(from)) {
        const src = join(from, name)
        const dst = join(to, name)
        const st = statSync(src)
        if (st.isDirectory()) n += merge(src, dst)
        else {
          // すでに有る物は上書きしない印を付けておく（戻すときに消さないため）
          if (!existsSync(dst)) written.push(dst)
          copyFileSync(src, dst)
          n++
        }
      }
      return n
    }
    /** 入れた物を消して、元の状態へ戻す */
    const rollback = (): void => {
      for (const f of written) {
        try {
          rmSync(f, { force: true })
        } catch {
          /* 消せない物は残るが、できる限り戻す */
        }
      }
    }
    try {
      for (const folder of ASSET_FOLDERS) {
        const src = join(tmpDir, folder)
        if (!existsSync(src)) continue
        const n = merge(src, join(base, folder))
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

// プロジェクト保存（JSON を .gcproj として書き出す）
// curPath があり asNew でなければ「上書き保存」＝ダイアログを出さない
// （毎回ダイアログだと project(1).gcproj が増殖して最新版が分からなくなるため）。
ipcMain.handle(
  'project:save',
  async (_e, json: string, curPath?: string | null, asNew?: boolean) => {
    let target = curPath && !asNew && existsSync(curPath) ? curPath : null
    if (!target) {
      const save = await dialog.showSaveDialog({
        title: asNew ? 'プロジェクトを別名で保存' : 'プロジェクトを保存',
        defaultPath: curPath || 'project.gcproj',
        filters: [{ name: 'GiftCut Project', extensions: ['gcproj', 'json'] }]
      })
      if (save.canceled || !save.filePath) return { ok: false, error: 'キャンセル' }
      target = save.filePath
    }
    try {
      // 一時ファイルへ書いてから rename（書き込み中のクラッシュ/電源断で本体を壊さない）
      const tmpFile = target + '.tmp'
      writeFileSync(tmpFile, json, 'utf-8')
      renameSync(tmpFile, target)
      // 保存したものが壊れていないかを毎回検査する（保存自体は止めない）
      inspectProject(json, 'save')
      return { ok: true, path: target }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  }
)

// スクリーンショット保存（data:image/png;base64 を PNG として書き出す）
}
