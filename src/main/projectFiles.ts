// プロジェクトのファイル——保存・復元・下書き・持ち出し（ZIP）・雛形・字幕の書き出し。
//
// ## 拾い忘れるとエラーも出ずに消える
//
// 保存する項目を1つ書き忘れても、**何も言わずにその設定だけ失われる**。
// 開き直して初めて気づくので、ここは1か所にまとめてある。
//
// ## 「持ち出す」は素材ごと固める
//
// プロジェクトのファイルは素材の**置き場所**しか覚えていない。別のPCへ渡すと
// 全部リンク切れになるので、使っている素材を集めて1つの箱（ZIP）にする。
//
// ## 下書き（自動保存）は捨てない
//
// 保存していない変更があるまま閉じても、次に開いたときに戻せるようにする。
// **1つ前の世代も残す**（落ちる原因になった操作ごと戻ってきてしまうと逃げ場が無い）。
import { app, dialog, ipcMain } from 'electron'
import { join, normalize, resolve } from 'path'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'fs'
import { writeFile as writeFileAsync } from 'fs/promises'
// プロジェクトの持ち出し（素材ごと ZIP に入れる／展開してパスを繋ぎ直す）
import { planPack, relinkProject, PROJECT_ENTRY, MANIFEST_ENTRY } from '../shared/projectPack'
import { writeZip, extractZip } from './zip'
// 保存するプロジェクトの整合性検査（参照切れ・長さ0・id重複など）
import { checkProject, formatProjectProblems } from '../shared/projectCheck'
import { allowFile } from './allowList'
// 同梱素材の置き場（開く側と並べる側の両方が要るので別ファイル）
import { relinkBundled, seRoots } from './assetRoots'

/** 未保存の変更があるか（画面から project:dirty で知らされる）。×ボタンの確認に使う */
let projectDirty = false
/** 未保存の変更があるか。**×ボタンの確認と自動更新が見ている** */
export function isProjectDirty(): boolean {
  return projectDirty
}

// ---- 自動保存 / クラッシュ復帰 ----
const autosavePath = (): string => join(app.getPath('userData'), 'giftcut-autosave.json')
// 1つ前の下書き。落ちる直前の状態そのものが壊れていたり、
// 「落ちる原因になった操作」ごと復元してしまうと逃げ場が無くなるので、
// 1世代だけ前も残して選べるようにする。
const autosavePrevPath = (): string => join(app.getPath('userData'), 'giftcut-autosave.prev.json')

// 保存のたびにプロジェクトの整合性を検査する。
// 「壊れたプロジェクトを保存してしまい、開き直して初めて気づく」を無くすため、
// ファイルの場所を探してコマンドを打つのではなく、保存経路そのものに検査を挿す。
// 保存自体は絶対に止めない（作業内容を失う方が害が大きい）。結果は
// userData/giftcut-check.json に残し、問題があればコンソールにも出す。
const checkReportPath = (): string => join(app.getPath('userData'), 'giftcut-check.json')
/**
 * 保存のたびにプロジェクトの整合性を検査する。**保存自体は絶対に止めない**
 * （作業内容を失う方が害が大きい）。結果は userData/giftcut-check.json に残す。
 *
 * 「壊れたプロジェクトを保存してしまい、開き直して初めて気づく」を無くすため、
 * ファイルの場所を探してコマンドを打つのではなく、**保存経路そのものに検査を挿す**。
 */
export const inspectProject = (json: string, origin: string): void => {
  try {
    const problems = checkProject(JSON.parse(json))
    const errors = problems.filter((x: { severity: string }) => x.severity === 'error')
    writeFileSync(
      checkReportPath(),
      JSON.stringify(
        {
          ok: errors.length === 0,
          origin,
          errors: errors.length,
          warnings: problems.length - errors.length,
          problems
        },
        null,
        2
      ),
      'utf-8'
    )
    if (problems.length) {
      console.warn(`[project:${origin}] 整合性の指摘:\n` + formatProjectProblems(problems))
    }
  } catch {
    // 検査で保存を妨げない
  }
}

/** プロジェクトのファイルまわりの受け口。**app.whenReady() の中で1回だけ呼ぶ。** */

export function registerProjectFileHandlers(): void {
// ※ `project:save` は 2026-08-03 に ./assetLibrary から移した。
//   開く・下書き・持ち出し・雛形が全部こちらに居るのに、**保存だけが
//   素材の置き場のファイルに紛れ込んでいた**（あちらの冒頭コメントにも
//   宣言が無かった）。整合性検査 inspectProject も同じファイルの中になる。
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

ipcMain.handle('project:autosave', async (_e, json: string) => {
  try {
    // 非同期＋アトミック書き込み（メインスレッドを止めず、途中で落ちても壊れない）。
    // 壊れると autosaveCheck が JSON.parse に失敗し、復帰プロンプトが無言で出なくなる。
    const dst = autosavePath()
    const tmpFile = dst + '.tmp'
    await writeFileAsync(tmpFile, json, 'utf-8')
    // 今の下書きを1つ前へ送ってから、新しいものを置く。
    // コピーではなく改名なので、途中で落ちてもどちらかは必ず読める。
    if (existsSync(dst)) {
      try {
        renameSync(dst, autosavePrevPath())
      } catch {
        /* 送れなくても新しい方の保存は続ける */
      }
    }
    renameSync(tmpFile, dst)
    inspectProject(json, 'autosave')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
})
// 起動時: 自動保存の有無・内容・動画の生存を返す（復元プロンプト用）
ipcMain.handle('project:autosaveCheck', async () => {
  const read = (
    p: string
  ): { data: unknown; videoExists: boolean; mtime: number } | null => {
    if (!existsSync(p)) return null
    try {
      const data = JSON.parse(readFileSync(p, 'utf-8'))
      // 他ハンドラと同様、拡張子ホワイトリスト＋存在チェックでのみ配信許可（任意ファイルを載せない）
      return { data, videoExists: allowProjectMedia(data), mtime: statSync(p).mtimeMs }
    } catch {
      return null
    }
  }
  const cur = read(autosavePath())
  const prev = read(autosavePrevPath())
  // 最新が壊れていても、1つ前が読めるなら復帰の道を残す
  if (!cur) {
    if (!prev) return { exists: false }
    return { exists: true, ...prev, onlyPrev: true }
  }
  return { exists: true, ...cur, prev: prev ?? undefined }
})
// renderer から未保存状態を受け取る（×ボタンで閉じるときの確認に使う）
ipcMain.on('project:dirty', (_e, v: boolean) => {
  projectDirty = !!v
})
ipcMain.handle('project:autosaveClear', async () => {
  try {
    rmSync(autosavePath(), { force: true })
    rmSync(autosavePrevPath(), { force: true })
  } catch {
    /* 無視 */
  }
  return { ok: true }
})

// プロジェクトを開く（動画パスが生きていれば gcfile 配信を許可）
// path を渡すとダイアログを出さずにそのファイルを開く（「最近使ったプロジェクト」用）。
ipcMain.handle('project:open', async (_e, path?: string) => {
  let target = path
  if (!target) {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'プロジェクトを開く',
      filters: [{ name: 'GiftCut Project', extensions: ['gcproj', 'json'] }],
      properties: ['openFile']
    })
    if (canceled || filePaths.length === 0) return null
    target = filePaths[0]
  } else if (!existsSync(target)) {
    // 最近使った一覧から消えたファイルを開こうとした場合
    return { ok: false, error: 'ファイルが見つかりません: ' + target }
  }
  try {
    const data = JSON.parse(readFileSync(target, 'utf-8'))
    // 動画/追加ソース/SE/画像のパスを拡張子チェック付きで配信許可（allowProjectMedia と共通）
    const videoExists = allowProjectMedia(data)
    return { ok: true, path: target, data, videoExists }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
})

// ---- プロジェクトの持ち出し（素材ごと1つの ZIP）----
//
// 渡す側は「まとめて書き出す」で ZIP を作り、受け取る側は「まとめを開く」で展開する。
// 素材のパスは ZIP の中の場所（素材/○○）に書き換えて入れ、展開時に展開先の
// 絶対パスへ戻す。書き換え規則は shared/projectPack にあり、単体で確かめてある。
//
// 圧縮は掛けない。動画も音声も画像も既に圧縮済みで、掛けても数%しか減らないのに
// 数GBを読み直すぶんの時間だけ確実に増える（＝待たせるだけになる）。
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
// 展開先は「ドキュメント/GiftCut/受け取ったプロジェクト/<ZIPの名前>」。
// 同じ名前があれば (2) を付けて別の場所にする（前に受け取ったものを上書きしない）。
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

// ---- プロジェクトテンプレート（GiftCut/テンプレート/*.gcproj）----
//
// 置き場は複数ある。**読むのは全部から、書くのは1つへ。**
//
//   開発フォルダ … 開発中はここに本物がある
//   resources/   … **配布物に同梱したぶん**（電子ビルダーがここへ置く）
//   userData/    … 渡した相手が自分で作ったぶん（同梱先は書けないことがある）
//
// resources を見ていなかったため、**同梱したのに相手のPCでは一覧が空**だった。
// 開発機は cwd に本物があるので気づけない（プロキシ・OpenH264 と同じ型の穴）。
const templateRoots = (): string[] => {
  const cands = [
    join(app.getAppPath(), 'テンプレート'),
    join(process.resourcesPath ?? '', 'テンプレート'),
    join(app.getPath('userData'), 'テンプレート')
  ]
  // 同じ場所を2回読まない（開発中は cwd と appPath が同じになる）
  const seen = new Set<string>()
  return cands.filter((r) => {
    if (!r || !existsSync(r)) return false
    const k = normalize(r).toLowerCase()
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}
const templatesRoot = (): string => templateRoots()[0] || join(process.cwd(), 'テンプレート')
/** 自分で作ったテンプレートの書き込み先。同梱先は読み取り専用のことがあるので逃げ場を持つ */
const templateWriteRoot = (): string =>
  app.isPackaged
    ? join(app.getPath('userData'), 'テンプレート')
    : join(process.cwd(), 'テンプレート')
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const allowProjectMedia = (data: any): boolean => {
  let videoExists = false
  if (data && typeof data.videoPath === 'string' && data.videoPath) {
    const okExt = /\.(mp4|mov|mkv|webm|avi)$/i.test(data.videoPath)
    videoExists = okExt && existsSync(data.videoPath)
    if (videoExists) allowFile(data.videoPath)
  }
  if (data && Array.isArray(data.seClips)) {
    const roots = seRoots()
    for (const s of data.seClips) {
      if (!s || typeof s.path !== 'string' || !/\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(s.path)) continue
      // **同梱 SE は置き場が毎回変わる**ので、無ければ今の置き場へ繋ぎ直す。
      // data ごと書き換えるので、画面側もそのまま新しいパスを受け取る。
      s.path = relinkBundled(s.path, 'SE', roots)
      if (existsSync(s.path)) allowFile(s.path)
    }
  }
  // マルチソースの追加動画も配信許可（動画拡張子のみ）
  if (data && Array.isArray(data.sources)) {
    for (const s of data.sources) {
      if (s && typeof s.path === 'string' && /\.(mp4|mov|mkv|webm|avi)$/i.test(s.path) && existsSync(s.path))
        allowFile(s.path)
    }
  }
  // 映像レイヤークリップの動画も配信許可（動画拡張子のみ）
  if (data && Array.isArray(data.vClips)) {
    for (const c of data.vClips) {
      if (c && typeof c.path === 'string' && /\.(mp4|mov|mkv|webm|avi)$/i.test(c.path) && existsSync(c.path))
        allowFile(c.path)
    }
  }
  // 画像クリップも配信許可（画像拡張子のみ）
  if (data && Array.isArray(data.imgClips)) {
    for (const c of data.imgClips) {
      if (c && typeof c.path === 'string' && /\.(png|jpe?g|gif|webp)$/i.test(c.path) && existsSync(c.path))
        allowFile(c.path)
    }
  }
  // テンプレートのメディアビン（動画/音声/画像）も配信許可
  if (data && Array.isArray(data.mediaItems)) {
    for (const m of data.mediaItems) {
      if (
        m &&
        typeof m.path === 'string' &&
        /\.(mp4|mov|mkv|webm|avi|mp3|wav|m4a|aac|ogg|flac|png|jpe?g|gif|webp)$/i.test(m.path) &&
        existsSync(m.path)
      )
        allowFile(m.path)
    }
  }
  return videoExists
}
ipcMain.handle('template:list', () => {
  try {
    const items: { name: string; path: string }[] = []
    const seen = new Set<string>()
    for (const root of templateRoots()) {
      for (const f of readdirSync(root)) {
        if (!/\.(gcproj|json)$/i.test(f)) continue
        const name = f.replace(/\.(gcproj|json)$/i, '')
        if (seen.has(name)) continue // 同じ名前は先に見つけた方（自分で作ったぶんが勝つ）
        seen.add(name)
        items.push({ name, path: join(root, f) })
      }
    }
    return { ok: true, items }
  } catch (e) {
    return { ok: false, items: [] as { name: string; path: string }[], error: String(e) }
  }
})
ipcMain.handle('template:save', (_e, name: string, json: string) => {
  try {
    const root = templateWriteRoot()
    mkdirSync(root, { recursive: true })
    const safe = (String(name || 'テンプレート').replace(/[\\/:*?"<>|]/g, '_').trim() || 'テンプレート')
    const p = join(root, safe + '.gcproj')
    writeFileSync(p, json, 'utf-8')
    return { ok: true, path: p }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
})
/**
 * テンプレートを1つ消す。
 *
 * **消せるのは置き場の中の物だけ。** 受け取ったパスをそのまま消すと、
 * 画面側の不具合や細工で**関係ないファイルを消せる穴**になる。
 * 置き場に居ること・拡張子が合っていることの両方を確かめてから消す。
 *
 * 同梱のテンプレート（アプリのフォルダ側）は消させない。消しても更新で戻るし、
 * 書き込みできない場所のこともある。消せるのは自分で作ったぶん（userData）。
 */
ipcMain.handle('template:delete', (_e, path: string) => {
  try {
    if (!path || typeof path !== 'string') return { ok: false, error: 'パスがありません' }
    const target = resolve(path)
    if (!/\.(gcproj|json)$/i.test(target))
      return { ok: false, error: 'テンプレートのファイルではありません' }
    // **userData の中だけ。** 「書き込み先」を基準にすると、開発中は
    // リポジトリ直下が書き込み先になるため、**同梱のテンプレートまで消せてしまう**
    //（自動チェックが実際にそれを捕まえた）。配った先で利用者の物が居るのは
    // 常に userData なので、そこに固定する。
    const root = resolve(join(app.getPath('userData'), 'テンプレート'))
    const inside = target.toLowerCase().startsWith((root + '\\').toLowerCase())
    if (!inside)
      return {
        ok: false,
        error: '同梱のテンプレートは消せません（自分で作ったぶんだけ消せます）'
      }
    if (!existsSync(target)) return { ok: false, error: 'もうありません' }
    rmSync(target, { force: true })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
})
ipcMain.handle('template:load', (_e, path: string) => {
  try {
    // 置き場が複数あるので、**どれかの下にあれば通す**（1つだけ見ていると、
    // 同梱ぶんを開こうとして「不正なパス」で弾かれる）
    const p = normalize(String(path))
    const roots = [...templateRoots(), templateWriteRoot()].map((r) => normalize(r))
    if (!roots.some((r) => p.startsWith(r))) return { ok: false, error: '不正なパス' }
    const data = JSON.parse(readFileSync(p, 'utf-8'))
    const videoExists = allowProjectMedia(data)
    return { ok: true, path: p, data, videoExists }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
})
ipcMain.handle('template:openDialog', async () => {
  const root = templatesRoot()
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'テンプレートを開く',
    defaultPath: existsSync(root) ? root : undefined,
    filters: [{ name: 'GiftCut Template', extensions: ['gcproj', 'json'] }],
    properties: ['openFile']
  })
  if (canceled || filePaths.length === 0) return null
  try {
    const data = JSON.parse(readFileSync(filePaths[0], 'utf-8'))
    const videoExists = allowProjectMedia(data)
    return { ok: true, path: filePaths[0], data, videoExists }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
})

// SRT 書き出し
ipcMain.handle('srt:export', async (_e, content: string) => {
  const save = await dialog.showSaveDialog({
    title: 'SRT を書き出し',
    defaultPath: 'subtitles.srt',
    filters: [{ name: 'SubRip', extensions: ['srt'] }]
  })
  if (save.canceled || !save.filePath) return { ok: false, error: 'キャンセル' }
  try {
    writeFileSync(save.filePath, content, 'utf-8')
    return { ok: true, path: save.filePath }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
})
}
