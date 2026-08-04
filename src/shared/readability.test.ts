// **AI が余裕を持って読める形か**を、機械で見張る。
//
// ## なぜ行数ではなく「読み方」で決めるか
//
// AI は行数によって**読み方を変える**。ここが全ての土台:
//
//   〜500 行        頭から通しで読む
//   500〜1,250 行   冒頭コメントを読んで、あとは grep で当たりを付ける ← ここが本番
//   1,250 行〜      読めない（fileSize.test.ts が止める）
//
// **500 を超えた瞬間から、AI は「そのファイルを読んだ」と言いながら読んでいない。**
//
// 2026-08-03 に実際に起きた:
//
//   害になった例  main/exportRun.ts（1,220行）。冒頭コメントだけ読んで
//                「ffmpeg を直に spawn していない」と断言して間違えた。本文を見ていない。
//                **頭のコメントが「読んだ気」を作った。**
//   効いた例      state/useClipDrag.ts（534行）。冒頭に「バラバラに置いて片方だけ
//                直した事故」と書いてあったので、読んで割るのをやめた。
//
// ## だから道を2つ用意する（どちらかを満たせばよい）
//
//   ① 500 行以下にする
//   ② **取説**（下の「## 中身」）を付けて、**それを機械で照合する**
//
// **割ることが目的ではない。読めることが目的。** 割るのにもコストがある:
// ファイルが増えると「どれを見ればいいか」を探す所から始まるし、継ぎ目が
// 増えると**片側だけ直す事故**が増える（08-03 の不具合8件は全部これ）。
//
// ## 取説は「機械で照合する」のが条件。できないなら書かない
//
// **腐った取説は、無いより悪い。** AI はそれを信じて「このファイルには
// これしか無い」と判断する——exportRun でやったのと同じ間違え方をする。
//
// 実例（このリポジトリで既に腐っていた）:
//
//   lib/telopAnim.ts の末尾に、本体の無い説明が残っていた。
//   「文字の箱がフレームのどこを占めるかを出す」という doc だけが残り、
//   中身の textRectInFrame は telopStyle.ts へ引っ越し済み。**誰も気づいていない**
//   （noUnusedLocals は説明を見ない）。
//
// ## 取説の書き方
//
//   // ## 中身
//   //
//   // - `関数名` … 何をするか
//   // - `関数名2` … 何をするか
//
// **top-level の関数（`function` と、中身が矢印関数の `const`）が全部並んでいること。**
// 1つでも欠けたら赤。存在しない名前が載っていても赤。
// 定数（`const TRIM_PX = 7` のような物）は載せなくてよい。
//
// **型（`interface` / `type`）と目印の定数は「載せてもよい」**（義務ではない）。
// 渡す形を探して開くことは多いので、載せたければ載せられる。ただし**嘘は赤**——
// 引っ越したら説明も連れて行くのは関数と同じ。
//
// ## 赤くなったら
//
// **DEBT から消す方向にだけ動かす。足さない。**
// 足したくなったら、それは「割るか取説を書くか」を先送りしているだけ。
//
// ## この検査の持ち主
//
// **リファクタリング部**（`.company/engineering/departments/refactor/CLAUDE.md`）。
//
// 他の部門は「触ったパス」で担当が決まるが、**この部門だけはパスを持たない**
//（全パスが対象だから）。つまり**パスからは絶対に辿り着けない**——
// 思い出したときにしか読まれない。それは 07-31〜08-02 に `.company/` の記録が
// 1行も残らなかったのと同じ壊れ方をする。
//
// **だからこの検査そのものを入口にしている。** 赤くなったら上のファイルを読むこと。
// （`.company/` は .gitignore なので、clone しただけでは無い。
//   無ければこのファイルの説明だけで足りるように書いてある）
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SKIP = new Set(['node_modules', 'out', 'dist', '.git', 'shots'])

/** 取説が要る大きさ。ここを超えたら AI は通しで読まない */
const NEED_INDEX = 500

/**
 * まだ取説も分割も無い物（2026-08-03 時点）。**減らす方向にだけ動かす。**
 *
 * 行数の多い順。上から片付ける。
 */
const DEBT_INDEX = new Set([
  // exportRun は**返済済み**（2026-08-03）。1,229 → 479。
  // **取説の道が塞がっていたので、先に割るしか無かった**——top-level の callable が
  // `isExporting` と `registerExportHandlers` の2つしか無く（1,012行が `export:run` の
  // 中の1コールバック）、取説を書いても2行で「これしか無い」という嘘の案内になる。
  // → 話題で3つに割った（08-04 に組み立てをさらに4つへ。どれも500行未満）。
  //   詳しくは `引き継ぎ-読める形.md`
  'src/renderer/src/state/useAppWiring.tsx', // 1,213
  // useTimelineEdit は**返済済み**（08-03 に取説 → 08-04 に4つへ割って 959 → 654）。
  //
  // **08-03 に書いた「切り口が見つからなかった」は、測っていなかった。**
  // 「mapContentTimes が4群からまたいで使われるので、どこで切っても導管になる」と
  // 書いてあったが**逆だった**——またぐなら**それこそが土台**で、先に
  // ./useContentShift として出したら、次の群の「返す」が 1 → 0 になった。
  // 目で探して諦めたら、必ず記号解決で測り直すこと（`引き継ぎ-心臓の分け直し.md`）。
  // StylePanel は**返済済み**（2026-08-03）。アピアランス225行を
  // ./StyleAppearance へ出して 679 → 451。冒頭コメントも付けた
  // useProjectFile は**返済済み**（2026-08-03）。テンプレート141行を
  // ./useProjectTemplates へ出して 667 → 537 にし、取説を付けて照合下に入れた
  // telopStyle.ts は**返済済み**（2026-08-03）。測る112行を ./telopMeasure へ出して
  // 623 → 510 にし、残り10行ぶんは取説（// ## 中身）を付けて機械の照合下に入れた。
  // useTimelineDrag は**返済済み**（2026-08-04）。596 → 295。
  // 掴む物で3つ: ./useTrackSelectTool（トラック選択ツール。**土台**）・
  // ./useTelopDrag（テロップを動かす／端を摘む）・ここ（擦る／囲う／束ねる）。
  // **どの群も連れて行く局所の名前が0**だった（受け取るのは import だけ）。
  // telopSvg は**割らない判断**（2026-08-04）。566 → 594（説明を足したぶん増えた）。
  // 448行が1つのパイプラインで、後ろが前の全部に乗っている。記号解決の実測:
  // **94行を出すのに 連れて行く文33／受け取る15／返す21**。導管21本は割に合わない。
  // 割るなら「行を動かす」ではなく作り直し（組版の下ごしらえを1つの値にまとめ、
  // 段を4枚返す形）。**画素の突き合わせ（npm run frames）が要る**ので別の作業。
  // 数字と理由はあのファイルの冒頭にそのまま書いてある。
  'src/renderer/src/lib/telopSvg.ts', // 594
  // useClipDrag は**わざと割らない**（2026-08-04 に測ったうえで見送り）。
  // 効果音・画像・映像クリップの3つは**やっていることが同じ**で、
  // バラバラに置いていた頃に「端の伸ばし方が2通り」になった事故が頭に書いてある。
  // 割ると、このリポジトリが最優先にしている「②直し漏れが出ない」を自分から壊す。
  'src/renderer/src/state/useClipDrag.ts', // 524
  // useLibraries は**返済済み**（2026-08-03）。整理（★・フォルダ・畳み）を
  // ./useLibraryOrganize へ出して 530 → 210。JSX が無くなったので .ts になった
  // useMediaDrop は**返済済み**（2026-08-04）。533 → 243。
  // 「落とし先を決めて置く」13個を ./useMediaPlace へ（受け取る5・返す1）。
  // usePlaybackEngine は**返済済み**（2026-08-04）。521 → 282。
  // 切片をまたぐ時計（A面/B面）を ./useSegClock へ（受け取る4・返す2）。
  // usePreviewManip は**返済済み**（2026-08-04）。526 → 413。
  // 拡大の基準点を ./usePreviewAnchor へ（**どの話題もこれを土台にしていた**）。
])

/**
 * 冒頭コメントがまだ無い物（2026-08-03 時点。11本）。**減らす方向にだけ動かす。**
 *
 * 冒頭コメントが無いファイルほど話題が多い、という関係が実測で出ている:
 * FillPicker（宣言なし）は3話題で、割った瞬間に**同じ25行が2つある**と検査に出た。
 * 1ファイルに収まっている間は誰にも見えなかった。
 */
const DEBT_HEAD = new Set([
  'src/main/index.ts',
  'src/renderer/src/components/TelopText.tsx',
  'src/preload/index.ts',
  'src/renderer/src/components/FillPicker.tsx',
  'src/preload/index.d.ts',
  'src/renderer/src/App.tsx',
  'src/renderer/src/components/CropModal.tsx',
  'src/renderer/src/components/WaveformCanvas.tsx',
  'src/renderer/src/lib/srt.ts',
  'src/renderer/src/main.tsx'
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
const files = walk(join(REPO, 'src')).map((f) => ({
  path: rel(f),
  lines: readFileSync(f, 'utf8').split(/\r?\n/)
}))

/**
 * 取説に並べるべき「呼べる物」の名前。
 *
 * ## `function` は中に入っていても数える
 *
 * 大きいファイルはほぼ全部フックで、**中身が1つの関数の中に入っている**
 *（`useProjectFile` は524行のうち約500行が `useProjectFile()` の中）。
 * top-level だけ見ると取説が1行になって、何の役にも立たない。
 * **grep で探す相手はその中の関数**なので、そちらを並べさせる。
 *
 * ## 矢印の `const` は top-level だけ
 *
 * 中の矢印関数まで数えると、3行のヘルパーが全部並んで取説が読めなくなる。
 * 線を「`function` と書いたか」に引いてある——**名前を付けて外から呼ぶ物は
 * `function` で書く**、という書き分けがこのリポジトリで既に守られている。
 *
 * 定数は数えない（`const TRIM_PX = 7` まで並べると、誰も直さなくなる）。
 */
function topLevelCallables(lines: string[]): string[] {
  const out: string[] = []
  lines.forEach((l, i) => {
    // 先頭の空白を許す＝関数の中の function も拾う
    const fn = l.match(/^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/)
    if (fn) {
      out.push(fn[1])
      return
    }
    const cn = l.match(/^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]*)?=\s*(.*)$/)
    if (!cn) return
    const tail = cn[2]
    const next = lines[i + 1] ?? ''
    const isArrow =
      /=>/.test(tail) ||
      /^(?:async\s*)?\(\s*$/.test(tail.trim()) ||
      (tail.trim() === '' && /^\s*\(/.test(next))
    if (isArrow) out.push(cn[1])
  })
  return out
}

/**
 * top-level で**名前を付けている物**（`interface` `type` `class` と、矢印でない `const`）。
 *
 * ## これは「並べてよい」の判定であって「並べろ」ではない（2026-08-04 に足した）
 *
 * 取説は目次なので、**要件は「嘘を書かないこと」**。並べる義務は関数だけに
 * 掛けてある（`topLevelCallables`）——型まで必須にすると、フックの `*Deps` が
 * 全部並んで目次が読めなくなる（実測12ファイルが赤くなった）。
 *
 * 足した理由: `main/exportGraph.ts` を4つへ割ったとき、渡す形（`ExportPayload`）や
 * 目印（`RAW_BASE_A`）を並べたら「**本体が無い**」と**嘘の赤**が出た。本体はある。
 * 探す物は関数だけではない——「渡す形が知りたい」で開くほうがむしろ多い。
 */
function topLevelNamed(lines: string[]): string[] {
  const out: string[] = []
  for (const l of lines) {
    const m = l.match(
      /^(?:export\s+)?(?:declare\s+)?(?:abstract\s+)?(?:interface|type|class|const|let)\s+([A-Za-z_$][\w$]*)/
    )
    if (m) out.push(m[1])
  }
  return out
}

/** 「## 中身」の節に並んだ名前（バッククォートで囲った物だけ拾う） */
function indexedNames(lines: string[]): string[] | null {
  const start = lines.findIndex((l) => /^\s*\/\/\s*##\s*中身\s*$/.test(l))
  if (start < 0) return null
  const out: string[] = []
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i]
    if (!/^\s*\/\//.test(l)) break // コメントが途切れたら終わり
    if (/^\s*\/\/\s*##\s/.test(l)) break // 次の節が始まったら終わり
    const m = l.match(/^\s*\/\/\s*-\s*`([A-Za-z_$][\w$]*)`/)
    if (m) out.push(m[1])
  }
  return out
}

describe('AI が余裕を持って読める形', () => {
  it('見張る対象が見つかっている（歩き方が壊れていないか）', () => {
    expect(files.length).toBeGreaterThan(200)
  })

  it('**冒頭コメントがある**（何のファイルか、読まずに分かる）', () => {
    const bad: string[] = []
    for (const f of files) {
      if (DEBT_HEAD.has(f.path)) continue
      const first = f.lines.find((l) => l.trim().length > 0) ?? ''
      if (!/^\s*(\/\/|\/\*)/.test(first)) bad.push(`${f.path}  (${f.lines.length}行)`)
    }
    expect(bad, '\n冒頭コメントが無い:\n' + bad.join('\n') + '\n\n上の説明を読むこと').toEqual([])
  })

  it(`**${NEED_INDEX}行を超えたら、割るか取説を付ける**`, () => {
    const bad: string[] = []
    for (const f of files) {
      if (f.lines.length <= NEED_INDEX || DEBT_INDEX.has(f.path)) continue
      if (indexedNames(f.lines) === null) bad.push(`${f.path}  (${f.lines.length}行)`)
    }
    expect(
      bad,
      '\n' +
        NEED_INDEX +
        '行を超えているのに取説（// ## 中身）が無い:\n' +
        bad.join('\n') +
        '\n\n割るか、取説を付けること'
    ).toEqual([])
  })

  it('**取説が腐っていない**（並べた名前と、実際の中身が一致する）', () => {
    const bad: string[] = []
    for (const f of files) {
      const listed = indexedNames(f.lines)
      if (listed === null) continue
      const actual = topLevelCallables(f.lines)
      // 並べる**義務**は関数だけ。型や目印は「並べてもよい」（`topLevelNamed` の真上）
      const mayList = [...actual, ...topLevelNamed(f.lines)]
      const missing = actual.filter((n) => !listed.includes(n))
      const ghost = listed.filter((n) => !mayList.includes(n))
      if (missing.length) bad.push(`${f.path}  取説に無い: ${missing.join(', ')}`)
      if (ghost.length) bad.push(`${f.path}  **本体が無い**: ${ghost.join(', ')}`)
    }
    expect(
      bad,
      '\n取説と中身がズレている:\n' +
        bad.join('\n') +
        '\n\n**腐った取説は無いより悪い。** 引っ越したら説明も連れて行くこと'
    ).toEqual([])
  })

  it('DEBT は減らす方向にだけ動かす（この数を増やしたら赤くする）', () => {
    // 増やしたくなったら、それは「割るか取説を書くか」を先送りしているだけ。
    // 2026-08-03 に 13 で始めて、その日のうちに telopStyle / useLibraries /
    // useProjectFile を返して 10。
    expect(DEBT_INDEX.size).toBeLessThanOrEqual(8)
    expect(DEBT_HEAD.size).toBeLessThanOrEqual(10)
  })
})
