#!/usr/bin/env node
// ============================================================================
// 同梱する ffmpeg が「配ってよいもの」かを確かめる。
//
//   npm run check:ffmpeg
//
// なぜ機械に見張らせるか:
//   ffmpeg には GPL 版と LGPL 版があり、**見た目では区別が付かない**。
//   GPL 版（x264 入り）を同梱すると、GiftCut 全体を GPL で配ることになり、
//   ソース公開の義務が付く。うっかり入れ替わっても誰も気づけないので、
//   ビルド設定の文字列を実際に読んで確かめる。
//
//   あわせて「H.264 で焼ける手段が1つ以上あるか」も見る。
//   LGPL 版は x264 が無いので、GPU か OpenH264 が要る。
//   どちらも無いビルドを同梱すると、書き出せないアプリを配ることになる。
// ============================================================================
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIR = join(ROOT, 'resources', 'ffmpeg')
const EXE = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
const PROBE = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'

const ff = join(DIR, EXE)
if (!existsSync(ff)) {
  console.error(
    `同梱する ffmpeg がありません: ${ff}\n` +
      `LGPL 版の ffmpeg/ffprobe を resources/ffmpeg/ に置いてください。\n` +
      `（GPL 版は置かないこと。ソース公開の義務が付きます）`
  )
  process.exit(1)
}
if (!existsSync(join(DIR, PROBE))) {
  console.error(`ffprobe がありません: ${join(DIR, PROBE)}（尺の取得に使っています）`)
  process.exit(1)
}

const out = spawnSync(ff, ['-hide_banner', '-version'], { encoding: 'utf-8' })
const text = (out.stdout ?? '') + (out.stderr ?? '')
if (!text.includes('ffmpeg version')) {
  console.error('同梱の ffmpeg を実行できませんでした。')
  process.exit(1)
}

const problems = []
if (/--enable-gpl/.test(text)) {
  problems.push(
    'GPL 版が置かれています（--enable-gpl）。これを配ると GiftCut のソース公開が必要になります。\n' +
      '    LGPL 版に差し替えてください。'
  )
}
if (/--enable-nonfree/.test(text)) {
  problems.push('nonfree 版が置かれています（--enable-nonfree）。これは配布できません。')
}

// H.264 で焼ける手段があるか（無いと書き出せないアプリになる）
const enc = spawnSync(ff, ['-hide_banner', '-encoders'], { encoding: 'utf-8' })
const encText = (enc.stdout ?? '') + (enc.stderr ?? '')
const ways = ['h264_nvenc', 'h264_qsv', 'h264_amf', 'libopenh264', 'libx264'].filter((v) =>
  new RegExp(`\\b${v}\\b`).test(encText)
)
if (!ways.length) {
  problems.push('H.264 で焼ける手段が1つもありません（GPU も OpenH264 も無い）。')
}
// GPU が無い機械のための砦
if (!ways.includes('libopenh264') && !ways.includes('libx264')) {
  problems.push(
    'CPU だけで焼く手段がありません（libopenh264 が入っていない）。\n' +
      '    GPU の無い PC で書き出せなくなります。'
  )
}

const ver = /ffmpeg version (\S+)/.exec(text)?.[1] ?? '不明'

// ---- ライセンスの表示が、いま置いてある物と合っているか ----
//
// LGPL は「使っていることを知らせ、本文を添える」ことを求める。
// **ffmpeg を差し替えたのに表示が古いまま**だと、間違った版を案内することになる。
// 版の文字列まで突き合わせて、ずれていたら止める。
const NOTICE = join(ROOT, 'licenses', 'FFmpeg', 'NOTICE.md')
if (!existsSync(NOTICE)) {
  problems.push('ライセンスの表示がありません: licenses/FFmpeg/NOTICE.md')
} else {
  const notice = readFileSync(NOTICE, 'utf-8')
  if (!notice.includes(ver)) {
    problems.push(
      `ライセンスの表示が古いです。同梱は ${ver} ですが、licenses/FFmpeg/NOTICE.md に
` +
        '    その版が書かれていません。差し替えたら表示も直してください。'
    )
  }
  // version3 付き＝LGPL v3。本文が v3 でないと、間違った物を配ることになる
  const v3 = /--enable-version3/.test(text)
  const need = v3 ? ['LGPL-3.0.txt', 'GPL-3.0.txt'] : ['LGPL-2.1.txt']
  for (const f of need) {
    if (!existsSync(join(ROOT, 'licenses', 'FFmpeg', f)))
      problems.push(`ライセンス本文がありません: licenses/FFmpeg/${f}（このビルドは ${v3 ? 'LGPL v3' : 'LGPL v2.1'}）`)
  }
}
if (problems.length) {
  console.error(`同梱の ffmpeg に問題があります（${ver}）:`)
  for (const p of problems) console.error(`  ・${p}`)
  process.exit(1)
}
console.log(`同梱の ffmpeg: ${ver}`)
console.log(`H.264 で焼ける手段: ${ways.join(' / ')}`)
console.log('ライセンス上の問題は見つかりませんでした（GPL でも nonfree でもない）。')
console.log('表示: licenses/FFmpeg/NOTICE.md（同梱の版と一致）')
