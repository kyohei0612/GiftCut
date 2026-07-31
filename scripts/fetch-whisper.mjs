#!/usr/bin/env node
// ============================================================================
// 聞き取りの実行ファイル（whisper.cpp）を取ってきて、同梱できる形に置く。
//
//   npm run fetch:whisper
//   → resources/whisper/ に whisper-cli.exe と必要な dll だけを置く（約10MB）
//
// なぜ同梱するか:
//   最初は「初回に落とす」形にしたが、**取得先が版ごとに変わって 404 になった**
//   （v1.7.4 の zip は既に無かった）。使う人の初回に外の都合で失敗するのは、
//   こちらでは直せない。10MB なら本体に入れてしまう方が確実。
//
//   模型（547MB）は大きいので同梱しない。そちらは初回に落として
//   %APPDATA%\GiftCut\whisper へ置く（更新でも消えない）。
//
// なぜ履歴に入れないか:
//   ffmpeg と同じ理由。実行ファイルを git に積むと、履歴が重くなるうえ
//   差し替えのたびに増える。置き方はここに書いてあるので、必要なら回せばよい。
//
// ライセンス:
//   whisper.cpp は MIT。同梱・再配布してよい（SE やテロップ素材とは事情が違う）。
// ============================================================================
import { createWriteStream, existsSync, mkdirSync, rmSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { get as httpsGet } from 'node:https'
import { spawnSync } from 'node:child_process'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'resources', 'whisper')
const TAG = 'v1.9.1'
const URL = `https://github.com/ggerganov/whisper.cpp/releases/download/${TAG}/whisper-bin-x64.zip`

/** 入れる物。**これ以外は捨てる**（zip には試験用の実行ファイルまで入っている） */
const KEEP = (name) =>
  name === 'whisper-cli.exe' ||
  name === 'whisper.dll' ||
  name === 'ggml.dll' ||
  name === 'ggml-base.dll' ||
  // CPU ごとの実装。実行時に合う物が選ばれるので、まとめて入れる
  /^ggml-cpu-.*\.dll$/.test(name)

const download = (url, dest, redirects = 0) =>
  new Promise((res, rej) => {
    if (redirects > 5) return rej(new Error('置き場所を辿れませんでした'))
    httpsGet(url, { headers: { 'User-Agent': 'GiftCut' } }, (r) => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
        r.resume()
        return res(download(r.headers.location, dest, redirects + 1))
      }
      if (r.statusCode !== 200) {
        r.resume()
        return rej(new Error(`落とせません（${r.statusCode}） ${url}`))
      }
      const total = Number(r.headers['content-length'] ?? 0)
      let got = 0
      let last = -1
      const ws = createWriteStream(dest)
      r.on('data', (c) => {
        got += c.length
        if (total) {
          const p = Math.round((got / total) * 100)
          if (p !== last && p % 10 === 0) {
            last = p
            process.stdout.write(`  ${p}%\r`)
          }
        }
      })
      r.pipe(ws)
      ws.on('close', () => res(dest))
      ws.on('error', rej)
    }).on('error', rej)
  })

const tmp = join(ROOT, 'whisper-bin.tmp.zip')
const tmpDir = join(ROOT, 'whisper-bin.tmp')
try {
  console.log(`取ってきます: ${TAG}`)
  await download(URL, tmp)
  console.log(`  ${(statSync(tmp).size / 1024 / 1024).toFixed(1)} MB`)

  rmSync(tmpDir, { recursive: true, force: true })
  mkdirSync(tmpDir, { recursive: true })
  // 展開は OS の物を使う（この道具のために zip の実装を抱えない）
  const un = spawnSync(
    'powershell',
    ['-NoProfile', '-Command', `Expand-Archive -Path '${tmp}' -DestinationPath '${tmpDir}' -Force`],
    { stdio: 'inherit' }
  )
  if (un.status !== 0) throw new Error('展開できませんでした')

  mkdirSync(OUT, { recursive: true })
  let n = 0
  let bytes = 0
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name)
      if (e.isDirectory()) walk(full)
      else if (KEEP(e.name)) {
        const dst = join(OUT, e.name)
        spawnSync('powershell', ['-NoProfile', '-Command', `Copy-Item '${full}' '${dst}' -Force`])
        n++
        bytes += statSync(dst).size
      }
    }
  }
  walk(tmpDir)
  if (!existsSync(join(OUT, 'whisper-cli.exe')))
    throw new Error('whisper-cli.exe が見つかりませんでした（zip の中身が変わった可能性）')
  console.log(`置きました: ${OUT}（${n}ファイル / ${(bytes / 1024 / 1024).toFixed(1)} MB）`)
} catch (e) {
  console.error('失敗:', e.message)
  process.exitCode = 1
} finally {
  rmSync(tmp, { force: true })
  rmSync(tmpDir, { recursive: true, force: true })
}
