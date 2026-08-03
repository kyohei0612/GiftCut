// 正典台帳（`canon.ts`）が**腐っていない**ことを見張る。
//
// ## なぜ要るか
//
// 台帳は「この問いの答えはここ」と言い切る物なので、**外れていると害の方が大きい**。
// AI はそれを信じて「答えはここだ」と判断し、実物を見に行かない。
// このリポジトリは同じ壊れ方を一度している——`lib/telopAnim.ts` に、本体が
// 別ファイルへ引っ越したあとの説明だけが残り、**誰も気づかなかった**
//（`readability.test.ts` の冒頭に経緯がある）。
//
// ## 見張る2つ
//
//   ① `home` に `name` が本当にある      … 引っ越したら赤
//   ② `name` が `home` の外から使われている … **参照0の正典は正典ではない**
//
// ③（生の式を他所で書いていないか）は `noDuplicate.test.ts` が見ている。
// あちらは `canon.ts` の `re` / `debt` を読んでいるので、台帳は1つ。
//
// ## ②を入れた理由
//
// 「正典を置いたが、呼ぶ側を直し忘れた」を捕まえるため。2026-08-03 に
// `wasCanceled` という**誰からも呼ばれない export** を作りかけた（`noUnusedLocals` は
// export を見ないので、型検査では止まらない）。台帳に載っている物が誰にも使われて
// いないなら、それは正典ではなく置き忘れ。
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CANON } from './canon'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SKIP = new Set(['node_modules', 'out', 'dist', '.git', 'shots'])

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.tsx?$/.test(name)) out.push(full)
  }
  return out
}

const rel = (p: string): string => relative(REPO, p).split(sep).join('/')
const files = walk(join(REPO, 'src')).map((f) => ({
  path: rel(f),
  src: readFileSync(f, 'utf8')
}))

/**
 * そのファイルが `name` を export しているか。
 *
 * **`type` と `interface` も見る。** 台帳に**型**を載せられるようにするため——
 * 2026-08-03 に `Wired`（心臓の受け口の型をどこから引くか）を足したとき、
 * ここが `function / const / class` しか見ておらず、
 * **実在するのに「引っ越した？」と赤くなった。**
 *
 * 台帳の問いは「その答えはどこにあるか」なので、答えが**型**であることは普通にある。
 */
function declares(src: string, name: string): boolean {
  const re = new RegExp(
    `^\\s*export\\s+(?:async\\s+)?(?:function|const|class|let|type|interface)\\s+${name}\\b`,
    'm'
  )
  return re.test(src)
}

describe('正典台帳が腐っていない', () => {
  it('台帳が空になっていない（読み込みが壊れていないか）', () => {
    expect(CANON.length).toBeGreaterThan(5)
  })

  it('**正典が実在する**（引っ越したら赤）', () => {
    const bad: string[] = []
    for (const c of CANON) {
      const f = files.find((x) => x.path === c.home)
      if (!f) {
        bad.push(`${c.name}: ${c.home} というファイルが無い`)
        continue
      }
      if (!declares(f.src, c.name))
        bad.push(`${c.name}: ${c.home} に export が見つからない（引っ越した？）`)
    }
    expect(
      bad,
      '\n' +
        bad.join('\n') +
        '\n\n**台帳（shared/canon.ts）と実体がズレている。**\n' +
        '引っ越したなら home を直す。消したなら台帳からも消す'
    ).toEqual([])
  })

  it('**誰かが実際に使っている**（参照0の正典は正典ではない）', () => {
    const bad: string[] = []
    for (const c of CANON) {
      const users = files.filter(
        (f) =>
          f.path !== c.home &&
          !f.path.endsWith('/canon.ts') &&
          new RegExp(`\\b${c.name}\\b`).test(f.src)
      )
      if (!users.length) bad.push(`${c.name}（${c.home}）を使っている所が1つも無い`)
    }
    expect(
      bad,
      '\n' +
        bad.join('\n') +
        '\n\n**置いただけで、呼ぶ側を直していない可能性がある。**\n' +
        'noUnusedLocals は export を見ないので、型検査では止まらない'
    ).toEqual([])
  })

  it('台帳の書き方が揃っている（探す人が読める形か）', () => {
    const bad: string[] = []
    for (const c of CANON) {
      // **問いの形で書く。** 「◯◯の長さ」ではなく「◯◯の長さは？」——
      // 探すときは問いで探すので、答えの名前で書かれていると引けない
      if (!c.what.includes('？')) bad.push(`${c.name}: what が問いになっていない「${c.what}」`)
      if (!c.use.trim()) bad.push(`${c.name}: use（どう使うか）が空`)
      // debt があるなら re も要る（式が無いと生の式を数えようが無い）
      if (c.debt && !c.re) bad.push(`${c.name}: debt があるのに re が無い`)
    }
    expect(bad, '\n' + bad.join('\n')).toEqual([])
  })
})
