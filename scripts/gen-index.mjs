// リポジトリの**目次**を作る。`npm run index`
//
// ## 何のためか
//
// 「その機能、もうある？ どこ？」に答えるための入口。
// 2026-08-03 に直した11件のうち**5件が「正典・仕組みはあるのに、その道を
// 通っていなかった」型**で、どれも毎回 grep で探し当てていた。
// 探す前に一覧が見られれば、その手間ごと消える。
//
// ## なぜ git に入れないか
//
// **生成物を置くと腐る。** このリポジトリは同じ失敗を一度している——
// `lib/telopAnim.ts` に、本体が別ファイルへ引っ越したあとの説明だけが残り、
// **誰も気づかなかった**（`readability.test.ts` の冒頭に経緯がある）。
//
// ここは数百ms で作り直せるので、**呼ばれるたびに作る**。
// そうすれば原理的に古くならない。照合の検査も要らない。
//
// ## 中身は「冒頭コメントの1行目」
//
// 説明を書き起こしているのではなく、**各ファイルが自分で名乗っている物**を集める。
// `readability.test.ts` が「冒頭コメントがある」ことを機械で保証しているので
//（例外は DEBT_HEAD の10本）、集めれば目次になる。実測で 87% が名乗っている。
//
// ※ **`readability` の対象は `src/` の非テストファイルだけ。**
//   e2e / scripts / テストは検査の外にいるので、説明が無い物が混ざる。
//   その場合は「（説明なし）」と出す——**無い物を無いと出す**のが正しい。
//   隠すと「このファイルは何も無い」と読み違える。
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SKIP = new Set(['node_modules', 'out', 'dist', '.git', 'shots'])
const WATCH = ['src', 'e2e', 'scripts']
// **css も数える**（2026-08-09）。`.ts/.tsx/.mjs` だけだったので、styles/ の
// 17本が「それ、もうある？」の網から外れていた——**`.snap-line` の二重定義は
// CSS で起きた**のに、見た目の質問に目次が答えられない形だった。
// `headline()` は `/* */` を元から読めるので、拾う対象を足すだけでよい。
// （fileSize の検査が 08-05 に .css/.md へ広がったのと同じ「数えたつもりで
//   数えていない」型。md は目次に載せない——説明の1行目が見出しではないため）
const EXT = /\.(ts|tsx|mjs|css)$/

/** 1行の説明をどこまで載せるか（長い説明は次の行へ続くので、頭だけで足りる） */
const MAX_DESC = 78

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (EXT.test(name)) out.push(full)
  }
  return out
}

/**
 * そのファイルが自分で名乗っている1行。
 *
 * `//` でも `/*` でも `/**` でも拾う。**空の飾り行は飛ばして、中身のある行を探す**
 * （`/**` だけの行で始まるファイルがあり、そこで諦めると説明を取り逃す）。
 */
function headline(lines) {
  for (const raw of lines.slice(0, 12)) {
    const l = raw.trim()
    if (!l) continue
    const m = l.match(/^(?:\/\/|\/\*\*?|\*)\s*(.*)$/)
    if (!m) return null // コメントでない行に当たった＝冒頭コメントが無い
    // css の1行コメントは `/* 説明 */` と閉じまで同じ行に来るので、閉じは説明から落とす。
    // 「===== 見出し =====」の飾りの = も落とす（説明は中の言葉）
    const t = m[1].trim().replace(/\s*\*\/\s*$/, '').replace(/^=+\s*|\s*=+$/g, '')
    if (!t || t === '*/') continue
    // **飾りの区切り線は説明ではない。** `shared/timeline.ts` は `====…` で始まっていて、
    // そのまま採ると目次に「====」と並ぶ（実際に作ってみて出た）
    if (/^[=\-─━_~#.*+]{3,}$/.test(t)) continue
    return t.length > MAX_DESC ? t.slice(0, MAX_DESC) + '…' : t
  }
  return null
}

const files = WATCH.flatMap((d) => walk(join(ROOT, d)))
  .map((f) => relative(ROOT, f).split(sep).join('/'))
  .sort()

const rows = files.map((p) => {
  const lines = readFileSync(join(ROOT, p), 'utf8').split(/\r?\n/)
  return { path: p, desc: headline(lines), lines: lines.length }
})

const named = rows.filter((r) => r.desc)
const out = []
out.push('# GiftCut の目次（機械生成。`npm run index` で作り直す）')
out.push('')
out.push(`${rows.length} ファイル中 ${named.length} が説明を持っている` +
  `（${Math.round((named.length / rows.length) * 100)}%）。`)
out.push('')
out.push('**これは生成物で、git には入っていない。** 中身は各ファイルの冒頭コメントの')
out.push('1行目そのままで、書き起こしではない。詳しくはそのファイルを開くこと。')
out.push('')

// 部門ごとにまとめる（触るパスで担当が決まるので、探す順もそれに合わせる）
const GROUPS = [
  ['心臓・配線部', 'src/renderer/src/state/'],
  ['画面部', 'src/renderer/src/components/'],
  ['計算（画面側）', 'src/renderer/src/lib/'],
  ['計算（共通）', 'src/shared/'],
  ['本体側（ffmpeg・ファイル・IPC）', 'src/main/'],
  ['橋渡し', 'src/preload/'],
  ['検査（e2e）', 'e2e/'],
  ['道具', 'scripts/'],
  ['その他', '']
]
const done = new Set()
for (const [label, prefix] of GROUPS) {
  const mine = rows.filter(
    (r) => !done.has(r.path) && (prefix === '' || r.path.startsWith(prefix))
  )
  if (!mine.length) continue
  mine.forEach((r) => done.add(r.path))
  // **パスの頭は見出しに1回だけ書く。** 399行ぶん繰り返すと、それだけで1万字を超える
  //（秘書が毎回まるごと読む物なので、削れる所は削る）
  out.push(`## ${label}（${mine.length}）　\`${prefix || '（リポジトリ直下）'}\``)
  out.push('')
  for (const r of mine) {
    const short = prefix ? r.path.slice(prefix.length) : r.path
    out.push(`- \`${short}\`（${r.lines}行） — ${r.desc ?? '**（説明なし）**'}`)
  }
  out.push('')
}

console.log(out.join('\n'))
