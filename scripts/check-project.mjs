#!/usr/bin/env node
// ============================================================================
// プロジェクトファイルの整合性チェック（CLI）
//
//   npm run check                       自動保存ファイルを検査
//   npm run check -- foo.gcproj         指定ファイルを検査
//   npm run check -- foo.gcproj --json  JSON で出力（AI/CI が読む形）
//
// 不整合（error）があれば exit 1。warning だけなら exit 0。
//
// checkProject 本体は src/shared/projectCheck.ts（テスト済みの純粋関数）。
// ここはファイルを読んで結果を出すだけ。
// ============================================================================
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// TypeScript をそのまま読むために vitest 同梱の esbuild を使う（別途ビルドしない）
async function loadChecker() {
  // Windows では動的 import に絶対パスをそのまま渡せない（file:// URL が必要）
  const { build } = await import(
    pathToFileURL(join(REPO, 'node_modules/esbuild/lib/main.js')).href
  )
  const out = await build({
    entryPoints: [join(REPO, 'src/shared/projectCheck.ts')],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    target: 'node18'
  })
  const code = out.outputFiles[0].text
  const url = 'data:text/javascript;base64,' + Buffer.from(code, 'utf8').toString('base64')
  return import(url)
}

const args = process.argv.slice(2)
const asJson = args.includes('--json')
const target = args.find((a) => !a.startsWith('--'))

/**
 * 引数が無ければ自動保存ファイルを検査する。
 * 場所は main/index.ts の autosavePath() と同じ:
 *   app.getPath('userData')/giftcut-autosave.json
 * userData は package.json の name（giftcut）から決まる。
 */
function defaultTarget() {
  const appData = process.env.APPDATA || join(homedir(), 'AppData/Roaming')
  const candidates = [
    join(appData, 'giftcut', 'giftcut-autosave.json'),
    join(homedir(), 'Library/Application Support/giftcut/giftcut-autosave.json'),
    join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'giftcut/giftcut-autosave.json')
  ]
  return candidates.find((p) => existsSync(p)) ?? null
}

const file = target ? resolve(target) : defaultTarget()

function fail(message) {
  if (asJson) {
    process.stdout.write(JSON.stringify({ ok: false, file, message, problems: [] }, null, 2) + '\n')
  } else {
    process.stderr.write(message + '\n')
  }
  process.exit(1)
}

if (!file) {
  fail(
    '検査するファイルがありません。\n' +
      '  npm run check -- path/to/project.gcproj\n' +
      '（引数なしのときは自動保存ファイルを探しますが、見つかりませんでした）'
  )
}
if (!existsSync(file)) fail(`ファイルが見つかりません: ${file}`)

let data
try {
  data = JSON.parse(readFileSync(file, 'utf8'))
} catch (e) {
  fail(`JSON として読めません: ${file}\n${e.message}`)
}

const { checkProject, formatProjectProblems, hasProjectError } = await loadChecker()
const problems = checkProject(data)
const errors = problems.filter((p) => p.severity === 'error').length
const warnings = problems.length - errors

if (asJson) {
  process.stdout.write(
    JSON.stringify({ ok: !hasProjectError(problems), file, errors, warnings, problems }, null, 2) +
      '\n'
  )
} else {
  process.stdout.write(`検査: ${file}\n`)
  process.stdout.write(formatProjectProblems(problems) + '\n')
  if (problems.length) process.stdout.write(`\nエラー ${errors} 件 / 警告 ${warnings} 件\n`)
}

process.exit(hasProjectError(problems) ? 1 : 0)
