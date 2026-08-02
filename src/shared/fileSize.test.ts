// ファイルが「1回で読み切れる」大きさを保っているか、機械で見張る。
//
// ## なぜ行数を見張るのか（人のためではなく、AI のため）
//
// **AI がファイルを読むときは1回あたりの上限がある。** 超えると分割して読み、
// 「前半だけ見て答える」事故が起きる。実際に 2026-08-02 の作業で起きた——
// 全体を読まずに grep で数えたせいで、探し物を15か所と数え間違えた
// （本当は21か所。片方の書き方しか grep していなかったのに気づけなかった）。
//
// 人が読む場合と違い、AI は「長いから飛ばし読みしよう」と判断できない。
// **静かに部分だけ見て、自信を持って間違える。** だから機械で止める。
//
// ## 上限の根拠は、理屈ではなく観測
//
//   useAppWiring.tsx が 1,295行のとき … 1回で読めず、1〜984行で切れた
//   同           1,182行のとき … 1回で全部読めた
//
// 境目はこの間。**なぜそこなのかは説明できない**（文字数では5%しか違わない）。
// 観測した2点だけを根拠に 1,250行 を上限とする。
//
// ## すでに超えている物は「借金」として今の行数で固定する
//
// いきなり全部直すのは無理なので、**増やすことだけを禁止**する。
// 減らしたら DEBT の数字も減らすこと（そうしないと、また太る余地が残る）。
//
// ## 赤くなったときにやってはいけないこと
//
// **機械的に割らない。** 割ると「渡す物」が増えて、かえって読みにくくなる。
// 割ってよいかは、割る直前に必ず数えて決める（境目をまたぐ名前が40個まで）。
// 実例と数え方は 引き継ぎ-App分割.md の「段階4・5」。
//
// やることの順番:
//   1. 説明の重複を削る（別ファイルへ移った物の説明が残っていないか）
//   2. 話題ごとにまとめて切り出せるか数える（40個まで）
//   3. どちらも駄目なら、受け取る側（context の束）を小さくして流れを分ける
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** 1回で読み切れる上限（観測で決めた。上の説明を読むこと） */
export const MAX_LINES = 1250

/**
 * すでに超えている物。**この数字を増やす変更は通さない。**
 *
 * 減らしたらここも減らすこと。0 になったら行ごと消す。
 */
export const DEBT: Record<string, number> = {
  // 返した物（記録として残す。同じ手が次にも効く）:
  //   src/main/index.ts            3,352 → 1,238（exportRun / mediaProbe / projectFiles / ffmpegRun / assetRoots / allowList へ）
  //   src/renderer/src/lib/telopStyle.ts  1,730 → 659（telopSvg / telopAnim / telopMotion へ）
  'e2e/bench.mjs': 1641,
  'e2e/run.mjs': 1457
}

const WATCH_DIRS = ['src', 'e2e', 'scripts']
const SKIP_DIRS = new Set(['node_modules', 'out', 'dist', '.git', 'shots'])
const EXT = /\.(ts|tsx|mjs|js)$/

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (EXT.test(name)) out.push(full)
  }
  return out
}

/** リポジトリからの相対パス（区切りは / に揃える。Windows でも同じ名前になるように） */
const relOf = (full: string): string => relative(REPO, full).split(sep).join('/')

describe('1回で読み切れる大きさを保つ', () => {
  const files = WATCH_DIRS.flatMap((d) => walk(join(REPO, d))).map((full) => ({
    path: relOf(full),
    lines: readFileSync(full, 'utf8').split('\n').length
  }))

  it('見張る対象が見つかっている（歩き方が壊れていないか）', () => {
    expect(files.length).toBeGreaterThan(100)
  })

  it(`借金でないファイルは ${MAX_LINES} 行を超えない`, () => {
    const over = files
      .filter((f) => !(f.path in DEBT) && f.lines > MAX_LINES)
      .map((f) => `${f.path} … ${f.lines}行`)
    expect(over, '\n' + over.join('\n') + '\n\n上の説明「赤くなったときに」を読むこと').toEqual([])
  })

  it('借金のファイルが、いまより太っていない', () => {
    const grown = files
      .filter((f) => f.path in DEBT && f.lines > DEBT[f.path])
      .map((f) => `${f.path} … ${DEBT[f.path]}行 → ${f.lines}行（+${f.lines - DEBT[f.path]}）`)
    expect(grown, '\n' + grown.join('\n') + '\n\n借金は増やさない。').toEqual([])
  })

  it('**借金が減ったら DEBT も直す**（放っておくと、また太る余地が残る）', () => {
    const byPath = new Map(files.map((f) => [f.path, f.lines]))
    const stale = Object.entries(DEBT)
      .filter(([p, n]) => byPath.has(p) && (byPath.get(p) as number) < n)
      .map(([p, n]) => `${p} … DEBT は ${n} だが、いま ${byPath.get(p)}行。DEBT を直すこと`)
    const gone = Object.keys(DEBT).filter((p) => !byPath.has(p))
    expect([...stale, ...gone.map((p) => `${p} … もう無い。DEBT から消すこと`)]).toEqual([])
  })
})
