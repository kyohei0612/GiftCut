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
// 実例と数え方は 引き継ぎ-心臓の分け直し.md。
// **ただし「またぐ名前40個」は横に割るときの目安。** フックを囲い（*Context.tsx）へ
// 上げる（縦）ときは数えなくてよい——配線を通らなくなるので、またぐ数が消える。
//
// やることの順番:
//   1. 説明の重複を削る（別ファイルへ移った物の説明が残っていないか）
//   2. 話題ごとにまとめて切り出せるか数える（40個まで）
//   3. どちらも駄目なら、受け取る側（context の束）を小さくして流れを分ける
//
// ## 「行数が多い＝悪い」ではない
//
// **1つのファイルが2つ以上の話題を持っているかどうか**が本当の基準。
// 話題が1つなら大きくてよい（例: main/exportRun.ts は 1,133行だが「書き出し」1つで、
// 渡す物を数えたら0個だった）。
//
// このリポジトリの90%点は約430行。**そこを目標にしないこと**——定義上いつも
// 1割が超えるので、追いかけても終わらない。
//
// ## 数えるときに3回踏んだ穴（2026-08-02）
//
// 「渡す物」を数える使い捨てのスクリプトを書くたびに、同じ所で嘘の数字が出た:
//
//   1. **片方向しか数えていない。** 「外で作って中で使う物」だけ見て、
//      「中で作って外で使われる物」を見落とす（自動更新が書き出しの状態を
//      見ていたのを取りこぼした）
//   2. **トップレベルの宣言しか見ていない。** フックや関数の中にある塊は、
//      字下げされているので1つも数えられず、**必ず0個と出る**
//   3. **同じ名前が複数回宣言されていると、最初の1つしか見ない。**
//      節ごとに使い回す短い名前（t, n, p…）が全部「外から借りている」に化ける
//
// 数える前に、**その3つに当てはまらないかを確かめること。**
// 一番確実なのは「切り出してから型検査を回し、Cannot find name を全部拾う」。
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** 1回で読み切れる上限（観測で決めた。上の説明を読むこと） */
export const MAX_LINES = 1250

/**
 * **「もうすぐ壁」を先に知らせる線。**
 *
 * 上限は超えた瞬間に赤くなるが、それだと**直したい変更の途中で壁にぶつかる**。
 * 実際 2026-08-03 に2回起きた（`useAppWiring.tsx` と `e2e/run.mjs`)。
 * どちらも本題と関係ない所で説明を削る羽目になり、削るべきでない「なぜ」まで
 * 削りかけた。
 *
 * ここを超えた物は**次にそこを触るときに、まず出す物を決める**。
 * 止めはしない（止めると、関係ない変更が全部そこで詰まる）。
 */
export const WARN_LINES = 1200

/**
 * **目指す大きさ（2026-08-03・本人の指定）。**
 *
 * 上限（1,250）は「AI が1回で読めるか」の実測で決めた線で、**読めなくなる境目**。
 * こちらは別の話で、**直すときに全部を頭に入れていられる大きさ**を狙う。
 *
 * 1,200行は読めるが、読めても端の事情を忘れて片方だけ直す——今日見つけた不具合の
 * 多くが「同じ物が2か所」型だった（`trackGain` / `DEFAULT_LABEL`）。
 * 小さいほど、この型は起きにくい。
 *
 * **止めない。** いま超えているのは71本（全体の21%・はみ出し16,807行）で、
 * 一気に止めると関係ない変更まで全部そこで詰まる。
 * 800 → 500 → 300 と段階的に `MAX_LINES` を下げ、各段で赤くなった物だけ、
 * **数えてから**割る（`引き継ぎ-心臓の分け直し.md` の「境目をまたぐ名前 40個まで」）。
 * 割れない物は理由と数字を付けて `DEBT` に載せる——**割れない理由が残る方が
 * 無理に割って壊すより価値がある。**
 */
export const GOAL_LINES = 300

/**
 * 上限を超えている物を、**今の行数のまま据え置く**ための逃げ道。
 *
 * ## いまは空（2026-08-02 に全部返した）
 *
 * | ファイル | 前 | 後 | 出した先 |
 * |---|---|---|---|
 * | `src/main/index.ts` | 3,352 | 758 | exportRun / assetLibrary / mediaProbe / projectFiles / ffmpegRun / assetRoots / allowList |
 * | `lib/telopStyle.ts` | 1,730 | 659 | telopSvg / telopAnim / telopMotion |
 * | `e2e/bench.mjs` | 1,641 | 977 | bench-limits / lib/fixture / lib/measure / lib/shell / lib/fmt |
 * | `e2e/run.mjs` | 1,457 | 1,261 | lib/e2eFixture |
 *
 * **空のまま保つのが理想。** 足すのは「いま直せないが、増やすのは止めたい」ときだけ。
 * 足したら必ず理由も書くこと（なぜ今は返せないのか）。減らしたらこの数字も直す。
 */
export const DEBT: Record<string, number> = {}

/**
 * **段階的に下げるときの控え。**
 *
 * `MAX_LINES` を 800 → 500 → 300 と下げていく途中で、「数えた結果まだ割れない」
 * と分かった物をここに書く。**DEBT とは別**——あちらは「上限を超えている物の据え置き」で、
 * こちらは「次の段で赤くなるが、理由があって今は割らない物」の下書き。
 *
 * 段を下げるときは、まずここを見て `DEBT` へ移す（数字も一緒に）。
 *
 * | ファイル | 行 | 数えた結果 | なぜ今は割らないか |
 * |---|---|---|---|
 * | ~~`state/useAppWiring.tsx`~~ | ~~1,250~~ | **返済済み（2026-08-04）。1,229 → 362** | ここに「またぐ名前 300〜506個なので割れない」と3回書いた。**数字は正しく、結論が間違っていた**——横に切るのではなく、フックを1本ずつ囲い（`state/*Context.tsx`）へ上げれば、またぐ数は関係なくなる。順番は `npm run passthrough`。経緯は `引き継ぎ-配線を剥がす.md` |
 * | ~~`main/exportRun.ts`~~ | ~~1,227~~ | **返済済み（2026-08-03）。1,229 → 499** | 話題で3つ（受け口 / 組み立て / 走らせる）。組み立ては 08-04 にさらに4つへ |
 * | `e2e/run.mjs` | **1,024** | 道具の塊はまだ複数ある | 素材づくり・後片付け（`resetProject` まわり）が次の候補 |
 * | `e2e/checks/09-モーション.mjs` | **1,131** | 21項目→19項目 | 途中の塊を出すと**印の付いていない順番依存**がずれる。先にそこへ印を付けるのが順序 |
 *
 * **`src/` に 500行超は1本も無い（2026-08-04）。** 残るのは e2e の2本だけ。
 */
export const SPLIT_NOTES = null

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

  // **止めない見張り。** 上限に当たってから慌てるのを避けるためだけにある。
  // 赤くしないのは、関係ない変更まで「先にリファクタしてから」で詰まらせないため。
  it(`上限まで残りわずかなファイルを知らせる（${WARN_LINES}行〜）`, () => {
    const near = files
      .filter((f) => !(f.path in DEBT) && f.lines > WARN_LINES && f.lines <= MAX_LINES)
      .sort((a, b) => b.lines - a.lines)
    if (near.length)
      console.warn(
        '\n※ 上限（' +
          MAX_LINES +
          '行）が近い。**次にここを触るときは、まず出す物を決めること**:\n' +
          near.map((f) => `   ${f.path} … ${f.lines}行（残り ${MAX_LINES - f.lines}）`).join('\n') +
          '\n'
      )
    expect(true).toBe(true) // 知らせるだけ。止めない
  })

  // **目標（300行）までの距離を出す。** 止めない。
  // 数が見えていないと「もう十分小さい」と思い込むし、逆に一気に割って壊す。
  it(`目標（${GOAL_LINES}行）までの残りを出す`, () => {
    const over = files.filter((f) => f.lines > GOAL_LINES).sort((a, b) => b.lines - a.lines)
    if (over.length)
      console.warn(
        `\n※ 目標 ${GOAL_LINES}行 を超えているのは ${over.length}本 / 全${files.length}本` +
          `（はみ出し合計 ${over.reduce((a, f) => a + f.lines - GOAL_LINES, 0)}行）。上位5本:\n` +
          over.slice(0, 5).map((f) => `   ${f.path} … ${f.lines}行`).join('\n') +
          '\n   下げ方は上の GOAL_LINES の説明を読むこと\n'
      )
    expect(true).toBe(true)
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
