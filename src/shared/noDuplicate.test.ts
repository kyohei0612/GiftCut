// 同じ物を2か所に書いていないかを、機械で見張る。
//
// ## なぜ機械で見るのか
//
// **これがこのプロジェクトで一番たちの悪い壊れ方をする。**
// 同じ問いに2つの答えがあると、片方だけ直したときに気づけない。しかも
// 画面と書き出しでズレた場合、**画面では正しく見える**ので発覚が遅れる。
//
// 実際に 2026-08-02 に見つかった例（これを見つけたのがこの検査を作った理由）:
//
//   isNeutralZoom が3か所にあり、**そのうち1つだけ「ぴったり比較」**だった。
//   つまみで戻して 1.0000001 になると、画面は「等倍」として何も出さないのに、
//   書き出しは「等倍ではない」と見て zoompan を1段掛けていた。
//
// 過去にも「同じ物が2回以上書かれていた」を6件まとめて直した記録がある
//（クロップの押し戻し規則／トランジションの編集画面／テロップの出入りの帯／
//  帯の色の塗り方／ミキサーのつまみ／comboFromEvent）。**放っておくと必ず増える。**
//
// ## 見るのは2つだけ（欲張ると使われなくなる）
//
//   ① shared/ に出してある名前を、他所で作り直していないか
//   ② 同じ中身の塊が、別のファイルにそっくり入っていないか
//
// 「同じ物」の完全な判定は無理なので、**実際に事故になった型だけ**を見る。
// これで捕まらない二重実装はある。それは人が気づくしかない。
//
// ## 赤くなったら
//
// **消す前に、2つが本当に同じか確かめること。** わざと違えている場合もある
//（その場合は下の ALLOW に理由付きで足す）。同じなら、片方を消して
// もう片方から import する。**新しく作る方を shared/ に置く**のが原則。
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SKIP = new Set(['node_modules', 'out', 'dist', '.git', 'shots'])

/**
 * 見逃してよい物。**必ず理由を書く。**
 *
 * 「たまたま同じ名前」と「本当に同じ物」は違う。前者だけをここへ入れる。
 */
const ALLOW = new Set([
  // 型の受け渡しは preload と main で必ず同じ形になる（片方だけ直せば型検査が捕まえる）
  'src/preload/index.ts',
  'src/preload/index.d.ts'
])

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full)
  }
  return out
}

const rel = (p: string): string => relative(REPO, p).split(sep).join('/')
const files = walk(join(REPO, 'src')).map((f) => ({ path: rel(f), src: readFileSync(f, 'utf8') }))

/** その行で新しく生まれる名前（トップレベルだけ） */
function declaredName(line: string): string | null {
  const m =
    line.match(/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/) ??
    line.match(/^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*[:=]/)
  return m ? m[1] : null
}

describe('同じ物を2か所に書かない', () => {
  it('見張る対象が見つかっている（歩き方が壊れていないか）', () => {
    expect(files.length).toBeGreaterThan(100)
  })

  it('**shared/ に出してある物を、他所で作り直していない**', () => {
    const shared = new Set<string>()
    for (const f of files.filter((f) => f.path.startsWith('src/shared/'))) {
      for (const l of f.src.split(/\r?\n/)) {
        if (!l.startsWith('export ')) continue
        const n = declaredName(l)
        if (n) shared.add(n)
      }
    }
    const bad: string[] = []
    for (const f of files) {
      if (f.path.startsWith('src/shared/') || ALLOW.has(f.path)) continue
      f.src.split(/\r?\n/).forEach((l, i) => {
        const n = declaredName(l)
        if (n && shared.has(n)) bad.push(`${f.path}:${i + 1}  ${n} は shared/ にもある`)
      })
    }
    expect(bad, '\n' + bad.join('\n') + '\n\n上の説明「赤くなったら」を読むこと').toEqual([])
  })

  it('**同じ中身の塊（12行）が、別のファイルにそっくり入っていない**', () => {
    const WIN = 12
    const seen = new Map<string, string[]>()
    for (const f of files) {
      if (ALLOW.has(f.path)) continue
      const ls = f.src
        .split(/\r?\n/)
        .map((l) => l.trim())
        .map((l) => (l.startsWith('//') || l.startsWith('*') || l.startsWith('/*') ? '' : l))
      for (let i = 0; i + WIN <= ls.length; i++) {
        const w = ls.slice(i, i + WIN)
        // 空行・短い行だらけの窓は「同じ」に見えて当たり前なので数えない
        if (w.filter((x) => x.length > 3).length < WIN) continue
        const key = w.join('')
        if (!seen.has(key)) seen.set(key, [])
        seen.get(key)!.push(`${f.path}:${i + 1}`)
      }
    }
    // 同じ塊が続くと窓の数だけ報告されるので、ファイルの組で1件にまとめる
    const pairs = new Map<string, string>()
    for (const at of seen.values()) {
      const inFiles = [...new Set(at.map((x) => x.split(':')[0]))]
      if (inFiles.length < 2) continue
      pairs.set(inFiles.sort().join(' ↔ '), at.slice(0, 2).join('  '))
    }
    const bad = [...pairs.entries()].map(([k, v]) => `${k}\n      例: ${v}`)
    expect(bad, '\n' + bad.join('\n') + '\n\n上の説明「赤くなったら」を読むこと').toEqual([])
  })
})
