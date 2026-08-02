#!/usr/bin/env node
// セッションが始まるたびに、組織の入口と決まりを1回だけ差し込む。
//
// ## なぜフックなのか
//
// 直下の CLAUDE.md にも同じことは書いてあるが、**読み飛ばされたら終わり**。
// `.company/` は自動では読まれないので、秘書と部門は誰も呼ばないと出てこない。
// ここはモデルの判断を経由せずに必ず入る。
//
// ## 短く保つこと
//
// 毎回入るので、長いとそれだけで場所を食う。**入口の案内だけ**にして、
// 中身は各ファイルへ逃がす。
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const COMPANY = join(ROOT, '.company')

// 組織が無ければ何も言わない（clone しただけの環境では .company が無い）
if (!existsSync(COMPANY)) process.exit(0)

const depDir = join(COMPANY, 'engineering', 'departments')
const deps = existsSync(depDir) ? readdirSync(depDir).sort() : []

const lines = [
  'このプロジェクトには組織（.company/）がある。**自動では読まれない**ので、下から入ること。',
  '',
  '| いつ | 何を読む |',
  '|---|---|',
  '| コードを触る前 | `.company/engineering/departments/<部門>/CLAUDE.md`（部門は触るパスで決まる。表は直下の CLAUDE.md） |',
  '| 相談・TODO・記録・雑談 | `.company/secretary/CLAUDE.md`（秘書室） |',
  '| 部門をまたぐ判断・決まりを増やす | `.company/engineering/CLAUDE.md`（開発部長） |',
  '',
  `部門: ${deps.length ? deps.join(' / ') : '（未設定）'}`,
  '',
  '**記録の置き分け（ここを間違えると抜ける）**',
  '`.company/` は .gitignore ＝コードと一緒に travel しない。残すべき物はリポジトリ側へ:',
  '  なぜそう作ったか → そのコードの真上のコメント',
  '  何をどう変えたか・測った数字 → 引き継ぎ-*.md',
  '  これからやること → やること.md'
].join('\n')

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: lines },
    suppressOutput: true
  })
)
