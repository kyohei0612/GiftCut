#!/usr/bin/env node
// ============================================================================
// 配布ビルドに開発用のものが混ざっていないか確かめる。
//
//   npm run build && npm run check:dist
//
// 検査票（動作確認チェックリスト）は開発中だけ出るもので、配布物には
// 入ってはいけない。import.meta.env.DEV の分岐で消える前提だが、書き方を
// 変えた拍子に残ることがあるので、実際のビルド結果を見て確かめる。
// ============================================================================
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(REPO, 'out', 'renderer', 'assets')

// 配布物にあってはいけない印。検査票の中身を指す文字列を選んである。
const FORBIDDEN = [
  '検査票',
  'qa-checklist',
  '症状・修正案',
  '修正を依頼するプロンプトを作る',
  '配布ビルドには入りません'
]

if (!existsSync(DIST)) {
  process.stderr.write(`ビルド結果がありません: ${DIST}\n先に npm run build を実行してください。\n`)
  process.exit(1)
}

const files = readdirSync(DIST).filter((f) => /\.(js|css)$/.test(f))
const hits = []
for (const f of files) {
  const body = readFileSync(join(DIST, f), 'utf8')
  for (const word of FORBIDDEN) {
    if (body.includes(word)) hits.push({ file: f, word })
  }
}

if (hits.length) {
  process.stderr.write('配布ビルドに開発用のものが混ざっています:\n')
  for (const h of hits) process.stderr.write(`  ${h.file}: 「${h.word}」\n`)
  process.stderr.write(
    '\n検査票は import.meta.env.DEV の分岐の中だけで読み込むこと。\n' +
      'スタイルを styles.css に書くと常に配布物へ入るので、dev 配下に閉じること。\n'
  )
  process.exit(1)
}

process.stdout.write(`配布ビルドは問題ありません（${files.length} ファイルを検査）\n`)
