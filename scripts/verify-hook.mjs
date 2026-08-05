#!/usr/bin/env node
// ============================================================================
// GiftCut 自動検証フック
//
// 目的: 「AI が検証を実行し忘れる」余地を無くす。
// 作者はコードを読まない前提なので、検証を人間の記憶にも AI の記憶にも依存させない。
//
// 呼ばれ方（**配線は `.claude/settings.json`**。リポジトリの中にある）:
//   PostToolUse (Write|Edit)  … GiftCut の src を編集した直後に検証
//   Stop                      … ターンを終える前に検証（全編集の最終確認）
//
// ## 2026-08-05 まで、配線がリポジトリの外にしか無かった
//
// `~/.claude/settings.json`（この PC のユーザ設定）に絶対パスで書いてあり、
// **clone した人はこのファイルだけ貰って、フックは一度も鳴らなかった。**
// 「通っていない道」を数えたときに見つかった——ファイルはあるのに入口が無い、
// という一番気づけない形。`.claude/settings.json` へ移して、
// `$CLAUDE_PROJECT_DIR` で書いてある（他の人の置き場所でも動く）。
//
// ※ ユーザ設定側に同じ物が残っていると**1回の編集で verify が2回走る**。
//   移したら向こうは消すこと。
//
// 失敗時は exit 2 + stderr。Claude はこの stderr を必ず読むので、
// 壊れたまま次へ進めない。GiftCut 以外を編集中は何もしない（exit 0）。
// ============================================================================
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// フックのペイロード（JSON）を stdin から読む。無い/壊れていても止めない。
let payload = {}
try {
  const raw = readFileSync(0, 'utf8')
  if (raw.trim()) payload = JSON.parse(raw)
} catch {
  payload = {}
}

const event = payload.hook_event_name || ''

// Stop フックが自分の指摘で再度走るのを防ぐ（無限ループ対策）
if (event === 'Stop' && payload.stop_hook_active) process.exit(0)

// PostToolUse: GiftCut の実コードを触ったときだけ検証する
if (event === 'PostToolUse') {
  const p = payload.tool_input?.file_path || payload.tool_input?.notebook_path || ''
  const norm = String(p).replace(/\\/g, '/')
  const repo = REPO.replace(/\\/g, '/')
  const touched =
    norm.startsWith(repo + '/src/') ||
    norm.startsWith(repo + '/scripts/') ||
    /\/(package|tsconfig[^/]*|vitest\.config|electron\.vite\.config)\.(json|ts)$/.test(norm)
  if (!touched) process.exit(0)
}

// 依存が入っていない環境では検証できないので黙って通す
if (!existsSync(resolve(REPO, 'node_modules'))) process.exit(0)

// ---- 検証本体 ----
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const r = spawnSync(npm, ['run', 'verify'], {
  cwd: REPO,
  encoding: 'utf8',
  shell: process.platform === 'win32',
  timeout: 180000
})

if (r.status !== 0) {
  const detail = `${r.stdout || ''}\n${r.stderr || ''}`.trim()
  // 出力は長くなりうるので、失敗に関係する末尾だけ渡す
  const tail = detail.split('\n').slice(-60).join('\n')
  process.stderr.write(
    'GiftCut 自動検証が失敗しました（npm run verify）。\n' +
      '型エラーもテスト失敗も本物の不整合です。修正してから次へ進んでください。\n' +
      `作業ディレクトリ: ${REPO}\n\n` +
      tail +
      '\n'
  )
  process.exit(2)
}

process.exit(0)
