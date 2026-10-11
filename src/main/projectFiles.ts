// プロジェクトの保存・復元・下書き（自動保存）。
//
// ## 拾い忘れるとエラーも出ずに消える
//
// 保存する項目を1つ書き忘れても、**何も言わずにその設定だけ失われる**。
// 開き直して初めて気づくので、ここは1か所にまとめてある。
//
// ## 下書き（自動保存）は捨てない
//
// 保存していない変更があるまま閉じても、次に開いたときに戻せるようにする。
// **1つ前の世代も残す**（落ちる原因になった操作ごと戻ってきてしまうと逃げ場が無い）。
//
// ## 2026-08-03 に4つ出した
//
// 元は497行で、頭のコメント自身が**6つの話題を挙げていた**
//（保存・復元・下書き・持ち出し・雛形・字幕）。しかも**全部が
// `registerProjectFileHandlers()` という1つの関数の中**に入っていて
//（86行目で開いて497行目まで閉じない）、中の `allowProjectMedia`
// ——**配信を許すかという安全の判断**——が、テンプレートの置き場と
// 一覧の間に挟まって**外から名前が見えなかった**。
//
//   ./allowProjectMedia … 素材を画面へ配ってよいか（4か所から呼ばれる）
//   ./projectPackIpc    … 持ち出し（ZIP）
//   ./projectTemplates  … 雛形
//   ./srtExport         … 字幕の書き出し
//
// またぐ名前は 0 個だった（`allowProjectMedia` を先に外へ出したため）。
import { app, dialog, ipcMain } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'fs'
import { writeFile as writeFileAsync } from 'fs/promises'
// 保存するプロジェクトの整合性検査（参照切れ・長さ0・id重複など）
import { checkProject, formatProjectProblems } from '../shared/projectCheck'
// 外から来たファイルを画面へ配ってよいか（開く・下書き・まとめ・雛形の共通の入口）
import { allowProjectMedia } from './allowProjectMedia'
import { registerPackHandlers } from './projectPackIpc'
import { registerTemplateHandlers } from './projectTemplates'
import { registerSrtHandlers } from './srtExport'

// ---- 窓ごとの物（2026-10-12・窓を複数にした）----
//
// 窓（webContents.id）に 1, 2, 3… の番号を振る。番号は**下書きの置き場**と
// 「未保存」の札を窓ごとに分けるのに使う。閉じた窓の番号は次の窓が使い回す
// （2 を閉じて次に開いた窓は 2。下書きの名前が増え続けない）。
// 1番は今までどおり `giftcut-autosave.json`（1窓のときは何も変わらない）
const slots = new Map<number, number>()
export function registerWindowSlot(webContentsId: number): number {
  const used = new Set(slots.values())
  let n = 1
  while (used.has(n)) n++
  slots.set(webContentsId, n)
  return n
}
export function releaseWindowSlot(webContentsId: number): void {
  slots.delete(webContentsId)
  dirtyByWindow.delete(webContentsId)
}
const slotOf = (e: { sender: { id: number } }): number => slots.get(e.sender.id) ?? 1

/** 未保存の変更があるか（画面から project:dirty で知らされる）。窓ごと */
const dirtyByWindow = new Map<number, boolean>()
/**
 * 未保存の変更があるか。**×ボタンの確認と自動更新が見ている。**
 * 窓を指定すればその窓、指定しなければ**どれか1つでも**（自動更新は全窓を止める）
 */
export function isProjectDirty(webContentsId?: number): boolean {
  if (webContentsId !== undefined) return dirtyByWindow.get(webContentsId) ?? false
  for (const v of dirtyByWindow.values()) if (v) return true
  return false
}

// ---- 自動保存 / クラッシュ復帰 ----
const autosavePath = (slot = 1): string =>
  join(app.getPath('userData'), slot > 1 ? `giftcut-autosave-${slot}.json` : 'giftcut-autosave.json')
// 1つ前の下書き。落ちる直前の状態そのものが壊れていたり、
// 「落ちる原因になった操作」ごと復元してしまうと逃げ場が無くなるので、
// 1世代だけ前も残して選べるようにする。
const autosavePrevPath = (slot = 1): string =>
  join(app.getPath('userData'), slot > 1 ? `giftcut-autosave-${slot}.prev.json` : 'giftcut-autosave.prev.json')

const checkReportPath = (): string => join(app.getPath('userData'), 'giftcut-check.json')
/**
 * 保存のたびにプロジェクトの整合性を検査する。**保存自体は絶対に止めない**
 * （作業内容を失う方が害が大きい）。結果は userData/giftcut-check.json に残す。
 *
 * 「壊れたプロジェクトを保存してしまい、開き直して初めて気づく」を無くすため、
 * ファイルの場所を探してコマンドを打つのではなく、**保存経路そのものに検査を挿す**。
 */
const inspectProject = (json: string, origin: string): void => {
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
  //   宣言が無かった）。
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

  ipcMain.handle('project:autosave', async (e, json: string) => {
    try {
      // 非同期＋アトミック書き込み（メインスレッドを止めず、途中で落ちても壊れない）。
      // 壊れると autosaveCheck が JSON.parse に失敗し、復帰プロンプトが無言で出なくなる。
      const slot = slotOf(e)
      const dst = autosavePath(slot)
      const tmpFile = dst + '.tmp'
      await writeFileAsync(tmpFile, json, 'utf-8')
      // 今の下書きを1つ前へ送ってから、新しいものを置く。
      // コピーではなく改名なので、途中で落ちてもどちらかは必ず読める。
      if (existsSync(dst)) {
        try {
          renameSync(dst, autosavePrevPath(slot))
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
  ipcMain.handle('project:autosaveCheck', async (e) => {
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
    const cur = read(autosavePath(slotOf(e)))
    const prev = read(autosavePrevPath(slotOf(e)))
    // 最新が壊れていても、1つ前が読めるなら復帰の道を残す
    if (!cur) {
      if (!prev) return { exists: false }
      return { exists: true, ...prev, onlyPrev: true }
    }
    return { exists: true, ...cur, prev: prev ?? undefined }
  })
  // renderer から未保存状態を受け取る（×ボタンで閉じるときの確認に使う）
  ipcMain.on('project:dirty', (e, v: boolean) => {
    dirtyByWindow.set(e.sender.id, !!v)
  })
  ipcMain.handle('project:autosaveClear', async (e) => {
    try {
      rmSync(autosavePath(slotOf(e)), { force: true })
      rmSync(autosavePrevPath(slotOf(e)), { force: true })
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
      // 動画/追加ソース/SE/画像のパスを拡張子チェック付きで配信許可
      const videoExists = allowProjectMedia(data)
      return { ok: true, path: target, data, videoExists }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  registerPackHandlers()
  registerTemplateHandlers()
  registerSrtHandlers()
}
