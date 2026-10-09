// 直近の書き出しが**実際に何をしたか**を控えに残す。
//
// ## なぜ要るか
//
// 作業フォルダ（tmp）は書き出しが終わると消えるので、あとから
// 「なぜ遅かったか」「なぜ絵が違ったか」を調べる手がかりが1つも残らない。
//
// **フィルタだけでは足りない。** 2026-08-04 に書き出しを速くしようとして、
// まず引数が無くて詰まった——「同じ素材を何本開いているか」「デコードを
// GPU へ投げているか」はフィルタ側には出てこない。
//
// ## 控えが残せなくても書き出しは止めない
//
// 調べるための物なので、ここで例外を投げると**本編を巻き添えにする**。
// 呼ぶ側が try で包まなくて済むよう、この中で握りつぶす。
//
// ## 中身
//
// - `put` … userData へ書く（失敗しても握りつぶす）
// - `dumpExportFilter` … フィルタグラフと入力の一覧
// - `dumpExportArgs` … ffmpeg の引数そのものと、同じファイルを開いた回数
// - `dumpEncoderPick` … 起動時の試し焼きで、どの符号化器が何で落ちたか
import { app } from 'electron'
import { join } from 'path'
import { writeFileSync } from 'fs'
import { formatGraphProblems, type GraphInput, type GraphProblem } from '../shared/filterGraph'

/**
 * userData へ書く。**`GIFTCUT_EXPORT_DUMP` があればそちらへも置く。**
 *
 * 測定（e2e・bench・repro-export）は userData を使い捨ての一時フォルダへ
 * 向けるので、控えが**測り終わった瞬間に消える**。速くする作業は
 * 「前と後を並べる」ことが仕事なので、消えると何も比べられない。
 */
const put = (name: string, body: string): void => {
  const dirs = [app.getPath('userData'), process.env.GIFTCUT_EXPORT_DUMP].filter(
    (d): d is string => !!d
  )
  for (const d of dirs) {
    try {
      writeFileSync(join(d, name), body, 'utf-8')
    } catch {
      // 控えが残せなくても書き出し自体は続ける
    }
  }
}

/**
 * 起動時の試し焼きの控え。**どの符号化器が、何で落ちたか**。
 *
 * サブPCで「GPU はあるのに最初から OpenH264」になっていたが、試し焼きが
 * 何で落ちたかはどこにも残っていなかった（2026-10-09）。画面には選んだ結果しか
 * 出ないので、落ちた理由はここでしか読めない。
 */
export function dumpEncoderPick(
  tries: { v: string; label: string; ok: boolean; ms: number; why: string }[],
  chosen: string
): void {
  put(
    'last-encoder-pick.txt',
    `# 選んだ: ${chosen}\n` +
      tries
        .map(
          (t) =>
            `${t.ok ? '○' : '✗'} ${t.v}（${t.label}） ${t.ms}ms` +
            (t.ok ? '' : `\n    ${t.why.trim().split('\n').slice(-3).join('\n    ')}`)
        )
        .join('\n')
  )
}

/** フィルタグラフの控え。`;` で改行して読める形にする */
export function dumpExportFilter(o: {
  filter: string
  graphInputs: GraphInput[]
  audioMap: string[]
  graphProblems: GraphProblem[]
}): void {
  put(
    'last-export-filter.txt',
    `# 入力 ${o.graphInputs.length} 個\n` +
      o.graphInputs
        .map((g, i) => `#  ${i}: ${g.name}  video=${g.hasVideo} audio=${g.hasAudio}`)
        .join('\n') +
      `\n# -map ${o.audioMap.join(' ')}\n` +
      (o.graphProblems.length ? `# 指摘:\n${formatGraphProblems(o.graphProblems)}\n` : '') +
      '\n' +
      o.filter.split(';').join(';\n')
  )
}

/**
 * ffmpeg の引数の控え。
 *
 * **「同じファイルを何回開いているか」を先頭に出す。** 切片ごとに `-ss` が
 * 違えば別入力になる作りなので、カットが増えるとデコーダが増える。
 * 引数を眺めるだけでは数えきれないので、ここで数えておく。
 */
export function dumpExportArgs(o: {
  args: string[]
  inputSpecs: { path: string }[]
  pngCount: number
  filterLen: number
}): void {
  const paths = [...new Set(o.inputSpecs.map((s) => s.path))]
  put(
    'last-export-args.txt',
    `# 入力 ${o.inputSpecs.length} 個（別ファイル ${paths.length} 本）/ ` +
      `テロップPNG ${o.pngCount} 枚 / フィルタ ${o.filterLen} 字\n` +
      '# 同じファイルを何回開いているか:\n' +
      paths
        .map((p) => `#  ${o.inputSpecs.filter((s) => s.path === p).length} 回  ${p}`)
        .join('\n') +
      '\n\n' +
      o.args.map((a) => (a.startsWith('-') ? '\n' + a : ' ' + a)).join('')
  )
}
