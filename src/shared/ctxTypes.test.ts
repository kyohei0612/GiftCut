// 心臓（context）の**受け口が `any` で開いていない**ことを機械で見張る。
//
// ## なぜ要るか（実際に起きた）
//
// 区画（左・右・プレビュー・タイムライン）は prop を受けず、心臓を自分で見に行く。
// その受け口（`state/*Context.tsx` の interface）が**全部 `any` で手書きされていた**——
// 341件。`any` は「何でも通る」なので、
//
//   ・存在しない物を触っても通る
//   ・引数の数を間違えても通る
//   ・**手で書いた型が実体とズレていても、ズレたまま通る**
//
// 2026-08-03 の不具合11件のうち2件がこの型（「宣言だけあって実体が無い」）。
// `rightPanelContext` の `draggingEmphasisRef` がその実例で、
// 「`any` なので型検査も素通りする」と当日の記録にそのまま残っている。
//
// 潰した日（2026-08-03）に**もう1件出た**——`TimelineArea.tsx` が
// `setTracks((prev: { id: string; name: string }[]) => …)` と手で書いていて、
// 実体（`Track[]`）の `kind` が抜けていた。`{ ...t, name }` で広げていたので
// 実害は出ていなかったが、`{ id: t.id, name }` と書き直した瞬間に段の種類が黙って消える。
//
// ## 決まり
//
// R1  `state/*Context.tsx` に `any` を書かない
// R2  `type W = Wired<'キー'>` を持つファイルでは、メンバーの型は `W['同じ名前']` だけ
//     （**名前がズレた物も赤**。別のキーの型を当てて辻褄を合わせられると意味が無い）
// R3  `useAppWiring` は、引かれている側の const に型注釈を付け直さない
//     （付けると「型を引く先が自分」になって輪になり、型が消える）
// R4  受け口を**部品の props 型に別名付けしない**（`= XxxProps`）
//
// ## R4 は 2026-08-04 に実際に踏んで足した
//
// `headerContext.tsx` は `export type HeaderValue = AppHeaderProps` で、その
// `AppHeaderProps` は `{ [k: string]: any }` だった。**R1 は `state/` しか見ないので
// 素通りしていた**——`any` が1ファイル隣に置いてあるだけで抜けられる。
//
// 配線から名前を6個外したとき、**型検査は1件も出ず、画面で `undefined` になった**
//（ファイルメニューが開かない）。捕まえたのは `App.behavior.test.tsx` の方。
// **受け口の型は必ず `Wired<'キー'>` で実体から引くこと。**
//
// なぜ手で341件書かずに引くのか・どう腐らないかは `state/wiredValue.ts`。
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const STATE = join(REPO, 'src', 'renderer', 'src', 'state')

/** `*Context.tsx` を全部拾う（新しく足した物も自動で対象になる） */
function contextFiles(): string[] {
  return readdirSync(STATE)
    .filter((f) => f.endsWith('Context.tsx'))
    .sort()
}

const read = (f: string): string[] => readFileSync(join(STATE, f), 'utf8').split(/\r?\n/)

/** `export interface X {` 〜 行頭 `}` の中身（行番号は1始まり） */
function interfaceBody(lines: string[]): { line: string; no: number }[] {
  const start = lines.findIndex((l) => /^export interface /.test(l))
  if (start < 0) return []
  const out: { line: string; no: number }[] = []
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i] === '}') break
    out.push({ line: lines[i], no: i + 1 })
  }
  return out
}

describe('心臓の受け口', () => {
  it('R1 any で開けない（区画が何でも触れてしまう）', () => {
    const bad: string[] = []
    for (const f of contextFiles()) {
      read(f).forEach((l, i) => {
        if (/\bany\b/.test(l) && !l.trimStart().startsWith('//') && !l.trimStart().startsWith('*'))
          bad.push(`${f}:${i + 1}  ${l.trim()}`)
      })
    }
    expect(bad, `受け口に any がある。実体から引くこと（state/wiredValue.ts）:\n${bad.join('\n')}`)
      .toEqual([])
  })

  it("R2 Wired を使う受け口は、型が W['同じ名前'] だけ", () => {
    const bad: string[] = []
    for (const f of contextFiles()) {
      const lines = read(f)
      if (!lines.some((l) => /^type W = Wired</.test(l))) continue
      for (const { line, no } of interfaceBody(lines)) {
        const m = /^ {2}([A-Za-z_][A-Za-z0-9_]*)\??: (.+)$/.exec(line)
        if (!m) continue // コメント・空行・入れ子の続き
        const want = `W['${m[1]}']`
        if (m[2] !== want) bad.push(`${f}:${no}  ${m[1]} は ${want} のはず → ${m[2]}`)
      }
    }
    expect(bad, `手で書いた型が混ざっている（実体とズレても誰も気づけない）:\n${bad.join('\n')}`)
      .toEqual([])
  })

  it('R3 useAppWiring 側で型注釈を付け直していない（輪になって型が消える）', () => {
    const keys = new Set<string>()
    for (const f of contextFiles()) {
      const m = /^type W = Wired<'([A-Za-z0-9_]+)'>/m.exec(readFileSync(join(STATE, f), 'utf8'))
      if (m) keys.add(m[1])
    }
    expect(keys.size, 'Wired を使う受け口が1つも無い（この検査が空回りしている）')
      .toBeGreaterThan(0)

    const wiring = readFileSync(join(STATE, 'useAppWiring.tsx'), 'utf8').split(/\r?\n/)
    const bad: string[] = []
    wiring.forEach((l, i) => {
      const m = /^ {2}const ([A-Za-z0-9_]+): [A-Za-z][A-Za-z0-9_]* = \{$/.exec(l)
      if (m && keys.has(m[1])) bad.push(`useAppWiring.tsx:${i + 1}  ${l.trim()}`)
    })
    expect(bad, `注釈を外すこと。付けると「引く先が自分」になって型が消える:\n${bad.join('\n')}`)
      .toEqual([])
  })
})

describe('受け口を props 型へ逃がしていない（R4）', () => {
  it('**受け口の型を部品の props に別名付けしない**（`any` の抜け道になる）', () => {
    const bad: string[] = []
    for (const f of contextFiles()) {
      const src = readFileSync(join(STATE, f), 'utf8')
      for (const m of src.matchAll(/^export type (\w+Value) = (\w+Props)\s*$/gm))
        bad.push(`${f}  ${m[1]} = ${m[2]}`)
    }
    expect(
      bad,
      '受け口を部品の props 型に別名付けしている。**`any` が1ファイル隣にあるだけで\n' +
        'R1 を素通りする**（2026-08-04 に実際に踏んだ。画面が undefined になった）。\n' +
        "`type W = Wired<'キー'>` で実体から引くこと:\n" +
        bad.join('\n')
    ).toEqual([])
  })
})
