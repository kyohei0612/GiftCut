// **書き出しの時間がどこで消えているかを割る**（準備／合成／エンコード）。
//
// ## 使い方（2段階）
//
// ```
// 1  GIFTCUT_EXPORT_DUMP=e2e/.cache/export-dump を渡してアプリで1回書き出す
//    （bench:export でもよい。**焼き上がりを待つ必要は無い**——控えは
//      書き出しが始まった瞬間に書かれるので、始まったら止めてよい。
//      ただし t*.png と filter.txt は一時フォルダに居るので、止める前に
//      %TEMP%\giftcut_* を export-dump/work へ丸ごと写すこと）
// 2  node scripts/export-abc.mjs
// ```
//
// ## 何が分かるか（2026-08-09 の実測・tv 基準60分）
//
// ```
// C 準備（1261入力を開く）    50.8秒   （4%）
// B−C 合成（フィルタ）      1034.0秒   （**83%**）
// A−B エンコード（nvenc p4）  211.0秒   （17%）
// ```
//
// **「遅さはほぼエンコーダだけ」（08-04 の結論）は tv 規模では成り立たない。**
// あれは軽い条件で hwaccel・scale・カット数を1つずつ抜いた結論で、
// テロップ1200枚が同時に立つ規模では**合成がエンコードの5倍**食う。
// preset をいくら上げても 17% の外は縮まない——掘るなら合成側。
//
// ## なぜ「本物の命令の頭5分」で測るか
//
// - 10分版のプロジェクトを**作らない**——テロップ1200枚を短い尺へ詰めると
//   密度が変わり、別物を測ることになる。本物の graph のまま `-t 300` で
//   出力だけ切れば、1本20分弱で回る
// - **アプリを通さない**——ffmpeg だけなら ±1%（08-04 の実測。アプリ越しは
//   71秒と126.8秒に振れた）
// - ※ 頭5分は平均より濃い（換算250分 vs 実測104.6分）。**比率だけを読む**こと
import { readFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DUMP = join(ROOT, 'e2e', '.cache', 'export-dump')
const WORK = join(DUMP, 'work') // t*.png と filter.txt（ここを cwd にして回す）
const FF = join(ROOT, 'resources', 'ffmpeg', 'ffmpeg.exe')

if (!existsSync(join(DUMP, 'last-export-args.txt')) || !existsSync(join(WORK, 'filter.txt'))) {
  console.error('控えがありません。冒頭の「使い方」の1（ダンプの取り方）から。')
  process.exit(2)
}

// 引数を読む（1行1オプション・# はコメント。パスに空白は無い前提——
// 空白が入る日はダンプ側を引用符付きにしてから直すこと）
const lines = readFileSync(join(DUMP, 'last-export-args.txt'), 'utf8')
  .split(/\r?\n/)
  .filter((l) => l.trim() && !l.startsWith('#'))
const tokens = lines.flatMap((l) => l.trim().split(' '))
// 尻の出力ファイルを外す
const out0 = tokens.pop()
if (!/\.(mp4|mov|mp3)$/.test(out0)) throw new Error('尻が出力ファイルでない: ' + out0)

// 共通部（入力と filter）と、コーデック指定を分ける
const iMap = tokens.indexOf('-map')
const common = tokens.slice(0, iMap)
const maps = ['-map', '[v]', '-map', '[aout]', '-r', '29.998000']
const codec = ['-c:v', 'h264_nvenc', '-preset', 'p4', '-rc', 'vbr', '-cq', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac']

const run = (name, args) => {
  const t0 = Date.now()
  const r = spawnSync(FF, ['-v', 'error', ...args], { cwd: WORK, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const sec = (Date.now() - t0) / 1000
  console.log(`${name}: ${sec.toFixed(1)}秒  exit=${r.status}`)
  if (r.status !== 0) console.log(r.stderr.slice(-600))
  return sec
}

console.log('C: 準備だけ（-t 1・全入力を開く固定費）')
const c = run('C', [...common, ...maps, '-t', '1', '-f', 'null', '-'])
console.log('B: 合成だけ（-t 300・エンコードせず捨てる）')
const b = run('B', [...common, ...maps, '-t', '300', '-f', 'null', '-'])
console.log('A: そのまま（-t 300・nvenc p4）')
const a = run('A', [...common, ...maps, '-t', '300', ...codec, join(DUMP, 'slice-a.mp4'), '-y'])

console.log('\n=== 内訳（頭5分ぶん） ===')
console.log(`準備（入力を開く）  ${c.toFixed(1)}秒`)
console.log(`合成               ${(b - c).toFixed(1)}秒`)
console.log(`エンコード          ${(a - b).toFixed(1)}秒`)
console.log('※ slice-a.mp4 は確かめたら消してよい（数百MB）')
