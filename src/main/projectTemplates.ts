// プロジェクトの雛形（GiftCut/テンプレート/*.gcproj）——一覧・保存・削除・読み込み。
//
// ## 置き場は複数ある。**読むのは全部から、書くのは1つへ**
//
//   開発フォルダ … 開発中はここに本物がある
//   resources/   … **配布物に同梱したぶん**（電子ビルダーがここへ置く）
//   userData/    … 渡した相手が自分で作ったぶん（同梱先は書けないことがある）
//
// resources を見ていなかったため、**同梱したのに相手のPCでは一覧が空**だった。
// 開発機は cwd に本物があるので気づけない（プロキシ・OpenH264 と同じ型の穴）。
//
// ## 消せるのは「自分で作ったぶん」だけ
//
// 受け取ったパスをそのまま消すと、画面側の不具合や細工で**関係ないファイルを
// 消せる穴**になる。置き場に居ること・拡張子が合っていることの両方を確かめる。
import { app, dialog, ipcMain } from 'electron'
import { join, normalize, resolve } from 'path'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { allowProjectMedia } from './allowProjectMedia'

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

/** 雛形の受け口。**`registerProjectFileHandlers()` から1回だけ呼ぶ。** */
export function registerTemplateHandlers(): void {
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
}
