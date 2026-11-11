// バックアップ（時刻つきのプロジェクトの写し）を書く・並べる・読む。
//
// ## 下書き（自動保存）とは別物
//
// 下書き（./projectFiles の `giftcut-autosave.json`）は「落ちたときに続きから開く」ための
// 最新1つ＋1つ前。こちらは**さかのぼるための履歴**で、ファイルメニューの
// 「バックアップから復元」に並ぶ。なぜ要るか・どれだけ残すかは shared/backupPrune の頭。
//
// ## いつ書くか（呼ぶのは ./projectFiles の2か所）
//
//   auto … 下書きを書いたとき（編集している間、1分おき）。**置き換えずに毎回残す**——
//          「近い物は置き換える」にすると、1分おきでは毎回置き換えになって最新の1つしか
//          残らず、壊した直後の状態で壊す前が消える（書いている途中で気づいて外した）。
//          増えたぶんは間引きに任せる
//   prev … 上書き保存の直前に、**上書きされる前のファイルの中身**
//          （壊れた状態で Ctrl+S しても、保存する前の中身へ戻れるように）
//   save … 上書き保存・名前を付けて保存したとき
//
// **同じ中身は2つ置かない**（名前に中身の指紋を入れて、在れば書かない）。
//
// ## 保存や下書きを絶対に止めない
//
// ここは保険なので、失敗しても呼んだ側（保存・下書き）は成功のまま進める。
// 書けなかったことは console に出すだけ。
//
// ## 中身
//
// - `writeBackup` … 1つ書いて、古い物を間引く
// - `registerBackupHandlers` … 画面からの受け口（一覧・読む）
// - `backupDir` … 置き場（userData/backups）
// - `parseName` … 名前から時刻・種類・中身の指紋を読む
// - `listFiles` … 置いてある物を新しい順に
import { app, ipcMain } from 'electron'
import { join } from 'path'
import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import {
  BACKUP_KEEP_RECENT,
  backupSummary,
  backupsToDelete,
  type BackupInfo
} from '../shared/backupPrune'
import { allowProjectMedia } from './allowProjectMedia'

type Origin = BackupInfo['origin']

const backupDir = (): string => join(app.getPath('userData'), 'backups')

/** 名前は `<時刻ms>-<種類>-<中身の指紋8桁>.gcproj`。**拡張子は .gcproj**（手で開いても読める） */
const NAME_RE = /^(\d{13})-(auto|save|prev)-([0-9a-f]{8})\.gcproj$/

function parseName(name: string): { name: string; time: number; origin: Origin; hash: string } | null {
  const m = NAME_RE.exec(name)
  return m ? { name, time: Number(m[1]), origin: m[2] as Origin, hash: m[3] } : null
}

/** 置いてある物（新しい順）。置き場が無ければ空 */
function listFiles(): NonNullable<ReturnType<typeof parseName>>[] {
  if (!existsSync(backupDir())) return []
  return readdirSync(backupDir())
    .map(parseName)
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => b.time - a.time)
}

/** バックアップを1つ書く。**失敗しても投げない**（保存・下書きを止めない） */
export function writeBackup(json: string, origin: Origin): void {
  try {
    const hash = createHash('sha1').update(json).digest('hex').slice(0, 8)
    const files = listFiles()
    // 同じ中身が既にあれば置かない（保存 → すぐ下書き、で2つ並ばない）
    if (files.some((f) => f.hash === hash)) return
    mkdirSync(backupDir(), { recursive: true })
    const now = Date.now()
    writeFileSync(join(backupDir(), `${now}-${origin}-${hash}.gcproj`), json, 'utf-8')
    const left = listFiles()
    const drop = new Set(
      backupsToDelete(
        left.map((f) => f.time),
        now
      )
    )
    for (const f of left) if (drop.has(f.time)) rmSync(join(backupDir(), f.name), { force: true })
  } catch (e) {
    console.warn('[backup] バックアップを書けませんでした:', e)
  }
}

/** 画面からの受け口。**app.whenReady() の中で1回だけ呼ぶ**（./projectFiles の登録から） */
export function registerBackupHandlers(): void {
  // 一覧（新しい順）。品書きに並べるのは直近ぶんだけ——全部読むと数百個を parse することになる
  ipcMain.handle('project:backups', async (): Promise<BackupInfo[]> => {
    const out: BackupInfo[] = []
    for (const f of listFiles().slice(0, BACKUP_KEEP_RECENT)) {
      try {
        const data = JSON.parse(readFileSync(join(backupDir(), f.name), 'utf-8'))
        out.push({ id: f.name, time: f.time, origin: f.origin, ...backupSummary(data) })
      } catch {
        /* 読めない物は並べない */
      }
    }
    return out
  })
  // 1つ読む。**名前は自分で付けた形しか受けない**（置き場の外を読ませない）
  ipcMain.handle('project:backupRead', async (_e, id: string) => {
    if (typeof id !== 'string' || !NAME_RE.test(id)) return { ok: false, error: '名前が正しくありません' }
    try {
      const data = JSON.parse(readFileSync(join(backupDir(), id), 'utf-8'))
      // 開く・下書きと同じ入口で、素材を画面へ配ってよいかを決める
      return { ok: true, data, videoExists: allowProjectMedia(data) }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })
}
