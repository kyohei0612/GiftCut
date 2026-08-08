// **何を測る相手にするか**を決める。引数を読み、その通りの素材とプロジェクトを用意する。
//
// ## なぜ本体から出したか（2026-08-04）
//
// `bench.mjs` が 591行だった。**500 を超えると AI は通しで読まず grep に
// 切り替える**（`引き継ぎ-心臓の分け直し.md`「なぜ 500 行なのか」）ので、
// 段取りを読みたい人が読み切れる大きさへ落とした。
//
// ## 引数と素材づくりを1つにしてある
//
// 別の話題に見えるが、**引数は「どの素材を作るか」を決めるためだけにある**。
// 分けると「--profile を足す」たびに2つのファイルを開くことになる。
//
// ## 中身
//
// - `readArgs` … コマンドラインを読む（基準・抜く物・尺・本物のプロジェクト）
// - `prepareFixture` … その通りに素材とプロジェクトを用意する
import { readFileSync } from 'node:fs'
import { fmt } from './fmt.mjs'
import {
  TELOPS, PROFILES, makeLongVideo, makeProject, useRealProject, makeImages, makeClipVideos
} from './fixture.mjs'

export function readArgs() {
const KEEP = process.argv.includes('--keep')
const DO_EXPORT = !process.argv.includes('--no-export')
const DO_LIMITS = !process.argv.includes('--no-limits')
const MINUTES = Number((process.argv.find((a) => a.startsWith('--min=')) ?? '').slice(6)) || 60
/** 本物のプロジェクトで測る（--project=<path>）。原本は触らず一時フォルダへ写す */
const REAL = (process.argv.find((a) => a.startsWith('--project=')) ?? '').slice(10) || ''
// 測定そのものが機能しているかを確かめるモード。
// わざと間違った操作をして、ちゃんと「できていない」と落ちるかを見る。
// これが無いと「何も起きていない＝軽い」を良い結果として読んでしまう
// （実際、拡大していない・掴めていないのに合格していた項目が5つあった）。
const SELFCHECK = process.argv.includes('--selfcheck')
/**
 * **裏の焼き直しが終わってから測る**（`--wait-proxy`）。
 *
 * 既定は付けない。**使う人はプロキシを焼きながら編集する**ので、焼いている
 * 最中こそが本番。これは「振れている原因が焼き直しか」を切り分けるためだけの口。
 * 待ち役の中身と理由は `./benchClock` の `焼き終わるまで待つ`。
 */
const WAIT_PROXY = process.argv.includes('--wait-proxy')
/**
 * **止まっている間に何をしているか**を出す。中身は `./cpuProfile`。
 *
 *   --cpu       レイアウト・スタイル計算・JS・その他の内訳（**軽い**）
 *   --cpu-deep  ＋関数ごとの標本（**重い**。200μs 刻みで主スレッドを自分で使う）
 *
 * 分けてあるのは、**標本器の分が「その他」に混ざるから**。
 * `--cpu-deep` で「その他が 85%」と出ても、そのうちどれだけが自分の分か分からない。
 * 内訳だけなら累計を引き算するだけなので、その心配が無い。
 */
const CPU_DEEP = process.argv.includes('--cpu-deep')
const CPU = CPU_DEEP || process.argv.includes('--cpu')
const EDITS = 50
/**
 * **どれくらい編集された物を基準にするか**（`--profile=tv|light`。既定 tv）。
 *
 * 2026-08-03 まではテロップ200枚・カット1個で測っていた。**それは編集して
 * いないのとほぼ同じ**なので、既定を「テレビの編集マン1時間ぶん」にした。
 * 過去の数字と比べたいときだけ `--profile=light`。
 *
 * **目指すのは `light` と `tv` で1操作の重さが変わらないこと。**
 * 差が出たら「見えていない物まで作っている」印（限界値より傾きを見る）。
 */
const PROFILE = (process.argv.find((a) => a.startsWith('--profile=')) ?? '').slice(10) || 'tv'
/**
 * いま測っている基準のテロップ枚数。
 *
 * **`TELOPS`（=200）を直に見てはいけない。** プロファイルを足した日に、
 * 「1200枚あるのに 1200 / 200 枚 ＝ 合格」と出す形になっていた。
 * 数える相手と、期待する数は同じ所から取ること。
 */
const WANT_TELOPS = PROFILES[PROFILE]?.telops ?? TELOPS
/**
 * **基準から1種類だけ抜く**（`--minus=vids,imgs`）。
 *
 * 軸ごとに1つずつ増やす測り方（`bench-limits`）では、どの軸も傾きがほぼゼロだった。
 * ところが**全部同時（tv）にすると 95% が 4.4ms → 162.5ms（37倍）に跳ねる**。
 * 足し合わせても +10ms 程度にしかならないので、**組み合わせたときだけ出る何か**がある。
 *
 * 1つずつ増やしても出ないなら、**全部乗せから1つずつ抜く**しかない。
 * 抜いて軽くなった物が原因。
 */
const MINUS = (process.argv.find((a) => a.startsWith('--minus=')) ?? '')
  .slice(8)
  .split(',')
  .filter(Boolean)
  return { KEEP, DO_EXPORT, DO_LIMITS, MINUTES, REAL, SELFCHECK, EDITS, PROFILE, WANT_TELOPS, MINUS, CPU, CPU_DEEP, WAIT_PROXY }
}

/**
 * 素材とプロジェクトを用意する。
 *
 * `--project=<path>` があれば**本物のプロジェクト**で測る（作り物を作らない）。
 * 作り物は「テロップが等間隔に並ぶ」素直な形になりがちで、実際の編集で出る
 * 重さ（段が11本・切片が細かい・効果音が重なる）が出てこない。
 *
 * **`video` を返すこと。** 限界さがし（`findLimits`）が作り物を組み立てるのに要る。
 * ここで返し忘れると `video is not defined` で**最後の最後に**落ちる
 * ——最初のコミットからずっとそうなっていて、限界さがしは一度も走っていなかった。
 */
export async function prepareFixture(a) {
  const { REAL, MINUTES, PROFILE, MINUS, DO_LIMITS, DO_EXPORT } = a
  let fx = null
  // --project=<path> があれば**本物のプロジェクト**で測る（作り物を作らない）。
  // 作り物は「テロップが等間隔に並ぶ」素直な形になりがちで、実際の編集で出る
  // 重さ（段が11本・切片が細かい・効果音が重なる）が出てこない。
  let totalSec = MINUTES * 60
  // **`video` はここで宣言すること。** else の中で `const` にすると、
  // 最後の `findLimits(... video ...)` から見えず `video is not defined` で落ちる。
  // **最初のコミット（87e5234）からずっとそうなっていた**＝限界さがしは
  // 一度も走ったことがない。19項目ぶん測ったあとの最後に落ちるので、
  // 「途中まで結果が出る」ぶん気づきにくかった（2026-08-04 に見つけた）。
  let video = ''
  if (REAL) {
    fx = useRealProject(REAL)
    const d = JSON.parse(readFileSync(REAL, 'utf-8'))
    // 限界さがしは作り物のプロジェクトを組み立てるので、素材だけ本物から借りる
    video = d.videoPath ?? d.sources?.[0]?.path ?? ''
    const cues = d.cues ?? []
    totalSec = Math.ceil(
      Math.max(0, ...cues.map((c) => c.end ?? 0), ...(d.segments ?? []).map((s) => s.tEnd ?? 0))
    )
    console.log(
      `
[1m負荷チェック（本物のプロジェクト）[0m  ${REAL}
` +
        `  尺 ${Math.round(totalSec)}秒 / テロップ${cues.length}枚 / 切片${(d.segments ?? []).length} / ` +
        `効果音${(d.seClips ?? []).length} / 段${(d.tracks ?? []).length} / ` +
        `プロジェクト ${fmt(fx.bytes / 1024, 0)} KB
`
    )
  } else {
    video = await makeLongVideo(MINUTES)
    const baseProf = PROFILES[PROFILE]
    // 抜く指定があれば 0 にする（上の MINUS の説明を読むこと）
    const prof =
      baseProf && MINUS.length
        ? { ...baseProf, ...Object.fromEntries(MINUS.map((k) => [k, 0])) }
        : baseProf
    if (!prof) {
      console.error(
        `--profile=${PROFILE} は知らない名前です（${Object.keys(PROFILES).join(' / ')}）`
      )
      process.exit(2)
    }
    // **本物の画像と動画を用意する。** ここを渡さないと path が元動画を指したままで、
    // デコードもサムネもメモリも1度も測らないまま「軽い」と出る
    //（2026-08-04 まで実際そうだった）。
    // 枚数は元ファイルの上限。置く数は prof.imgs / prof.vids で、使い回して並べる。
    const imgFiles = prof.imgs ? await makeImages(Math.min(prof.imgs, 40), 1920) : null
    const vidFiles = prof.vids ? await makeClipVideos(Math.min(prof.vids, 20), 3) : null
    fx = makeProject(video, totalSec, { ...prof, imgFiles, vidFiles })
    const n = (k) => prof[k] ?? 0
    console.log(
      `  基準 ${PROFILE}${PROFILE === 'tv' ? '（テレビの編集マン1時間ぶん）' : '（2026-08-03 までの基準）'}${MINUS.length ? ` − ${MINUS.join(',')} を抜いた` : ''}
  テロップ${n('telops')}枚 / カット${n('clips')} / 効果音${n('se')} / 画像${n('imgs')} / 動画クリップ${n('vids')}
  動き${n('motions')} / 切り替え効果${n('trans')} / めじるし${n('marks')} / 素材ビン${n('media')}`
    )
    console.log(
      `
[1m負荷チェック[0m  ${MINUTES}分 / プロジェクト ${fmt(fx.bytes / 1024, 0)} KB` +
        `${DO_LIMITS ? ' / 限界さがしあり' : ''}${DO_EXPORT ? ' / 書き出しあり' : ''}
`
    )
  }
  return { fx, totalSec, video }
}
