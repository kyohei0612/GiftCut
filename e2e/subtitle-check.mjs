// 字幕の出来を測る（npm run subcheck <動画>）
//
// ## なぜ要るか
//
// **「なんとなく合っている」では直せない。** 前に出した SRT が
// 「開始位置がバラバラ」だったが、どれくらいずれているのかが数字で無いので、
// 直したかどうかも分からなかった。
//
// 聞き取り → 間で割る → 合わせる、を実物で通して、
//
//   ・喋り出しからのズレ（合わせる前と後）
//   ・1枚あたりの文字数と枚数
//   ・**語が裂けていないか**（1〜2文字の断片が出ていないか）
//
// を出す。直すたびにこれを回して、数字が良くなったかで判断する。
//
//   npm run subcheck "C:\path\to\video.mp4"
//   npm run subcheck "...mp4" -- --sec=60   頭の60秒だけで試す（速い）

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { parseWhisperOut } from '../src/shared/whisperOut.ts'
import { splitAtPauses } from '../src/shared/splitTelop.ts'
import { alignCues, speechRanges } from '../src/shared/alignCues.ts'
import { DB_LADDER, enoughSilences } from '../src/shared/silenceLadder.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argOf = (n, d) => {
  const a = process.argv.find((x) => x.startsWith(`--${n}=`))
  return a ? a.slice(n.length + 3) : d
}
const src = process.argv.slice(2).find((a) => !a.startsWith('--'))
if (!src || !existsSync(src)) {
  console.error('動画を指定してください: npm run subcheck "C:\path\to\video.mp4"')
  process.exit(2)
}
const SEC = Number(argOf('sec', '0'))
const MAXC = Number(argOf('chars', '17'))

const FFMPEG = join(ROOT, 'resources', 'ffmpeg', 'ffmpeg.exe')
const WHISPER = join(ROOT, 'resources', 'whisper', 'whisper-cli.exe')
const MODEL = join(
  process.env.APPDATA ?? '',
  'GiftCut',
  'whisper',
  'ggml-large-v3-turbo-q5_0.bin'
)
for (const [p, what] of [
  [FFMPEG, 'ffmpeg（resources/ffmpeg）'],
  [WHISPER, 'whisper（npm run fetch:whisper）'],
  [MODEL, '聞き取りデータ（アプリの「字幕」から一度作ると入ります）']
]) {
  if (!existsSync(p)) {
    console.error(`${what} が見つかりません: ${p}`)
    process.exit(2)
  }
}

const wav = join(tmpdir(), `giftcut-subcheck-${Date.now()}.wav`)
const cut = SEC > 0 ? ['-t', String(SEC)] : []
spawnSync(FFMPEG, ['-y', ...cut, '-i', src, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav])
if (!existsSync(wav)) {
  console.error('音を取り出せませんでした')
  process.exit(1)
}

console.log('聞き取っています…')
const w = spawnSync(WHISPER, ['-m', MODEL, '-f', wav, '-l', 'ja'], { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 })
const segs = parseWhisperOut((w.stdout ?? '') + '\n' + (w.stderr ?? ''))

// **無音は素材で変わる。** 取れるまで少しずつ緩める（アプリと同じ手順）
const total = SEC > 0 ? SEC : Math.max(...segs.map((s) => s.end), 1)
let sil = []
for (const db of DB_LADDER) {
  const r = spawnSync(FFMPEG, ['-i', wav, '-af', `silencedetect=noise=${db}dB:d=0.2`, '-f', 'null', '-'], {
    encoding: 'utf-8',
    maxBuffer: 64 * 1024 * 1024
  })
  const got = []
  let st = null
  for (const line of ((r.stderr ?? '') + '').split(/\r?\n/)) {
    const a = /silence_start:\s*(-?[\d.]+)/.exec(line)
    const b = /silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/.exec(line)
    if (a) st = Number(a[1])
    if (b) {
      got.push({ start: st ?? Number(b[1]) - Number(b[2]), dur: Number(b[2]) })
      st = null
    }
  }
  if (got.length > sil.length) sil = got
  if (enoughSilences(sil.length, total)) break
}
rmSync(wav, { force: true })
const ranges = speechRanges(sil, total)
const split = segs.flatMap((s) => splitAtPauses(s, ranges, MAXC))
const aligned = alignCues(split, sil, total)

const dist = (t) => Math.min(...ranges.map((r) => Math.abs(r.start - t)))
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0)
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] ?? 0
const lens = aligned.map((c) => [...c.text].length)
// **語が裂けた印。** 1〜2文字だけの札は、間で切りすぎたときに出る
const shreds = aligned.filter((c) => [...c.text].length <= 2)

console.log('')
console.log(`無音 ${sil.length} / 喋りの区間 ${ranges.length}`)
console.log(`聞き取り ${segs.length} → テロップ ${aligned.length}枚`)
console.log('')
console.log('喋り出しからのズレ（秒）— 小さいほど声と合っている')
console.log(`  聞き取りそのまま  平均 ${avg(segs.map((s) => dist(s.start))).toFixed(3)} / 中央 ${med(segs.map((s) => dist(s.start))).toFixed(3)}`)
console.log(`  合わせた後        平均 ${avg(aligned.map((s) => dist(s.start))).toFixed(3)} / 中央 ${med(aligned.map((s) => dist(s.start))).toFixed(3)}`)
console.log('')
console.log(`1枚の文字数  平均 ${avg(lens).toFixed(1)} / 最長 ${Math.max(0, ...lens)}`)
console.log(
  shreds.length
    ? `※ 語が裂けている疑い: ${shreds.length}枚（${shreds.slice(0, 5).map((c) => `「${c.text}」`).join(' ')}）`
    : '語の裂け: なし'
)
console.log('')
for (const c of aligned.slice(0, 12)) console.log(`  ${c.start.toFixed(2)} → ${c.end.toFixed(2)}  ${c.text}`)
