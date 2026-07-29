// 動きを「1コマずつ」確かめる（npm run frames）
//
// ## なぜ要るか
//
// いままでの確認は「前と後ろの2枚を比べる」だった。これだと**途中がズレていても
// 通ってしまう**。動きで本当に見たいのは「打った表のとおりに、毎コマその値に
// なっているか」なので、**1コマずつ・キーフレームの表と並べて**見る。
//
// ズレたときに「何秒目のコマから、どれだけズレたか」がそのまま出る。
// 原因を探す時間が丸ごと消える。
//
// ## やり方
//
//   1. 測れる素材を作る（黒地に白い四角）。四角の大きさは絵から測れる
//   2. 本物の zoompanFilter で書き出す（式は書き出しで使う物そのもの）
//   3. **全コマ**から四角を測り、zoomAt の表と突き合わせる
//
// 期待値も式も**アプリと同じ物を import している**ので、ここが合えば
// 「画面で見た値のとおりに焼けている」と言い切れる。
//
// 普段の verify からは外してある（ffmpeg を回すので数十秒かかる）。
// 動きに触ったときだけ回す。

import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { readFileSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { zoomAt, zoompanFilter, type ClipMotion } from './clipMotion'

const ROOT = resolve(__dirname, '..', '..')
const FF = join(ROOT, 'resources', 'ffmpeg', 'ffmpeg.exe')
const DIR = join(ROOT, 'e2e', 'frames')
const W = 640
const H = 360
const FPS = 30
const BOX = 120 // 元の白い四角の一辺

const ff = (args: string[]): void => {
  const r = spawnSync(FF, args, { encoding: 'buffer' })
  if (r.status !== 0) {
    throw new Error(`ffmpeg 失敗:\n  ${args.join(' ')}\n${r.stderr?.toString().slice(-800)}`)
  }
}

/** 黒地に白い四角の素材。四角の大きさが絵から測れるので、拡大率を実測できる */
function makeSource(path: string, sec: number): void {
  ff([
    '-v', 'error', '-y',
    '-f', 'lavfi', '-i', `color=c=black:s=${W}x${H}:d=${sec}:r=${FPS}`,
    '-vf', `drawbox=x=${(W - BOX) / 2}:y=${(H - BOX) / 2}:w=${BOX}:h=${BOX}:color=white:t=fill`,
    '-c:v', 'libopenh264', '-b:v', '8000k', '-pix_fmt', 'yuv420p',
    path
  ])
}

/** 全コマから白い四角を測る（幅・高さ・中心） */
function measureAll(video: string): ({ w: number; h: number; cx: number; cy: number } | null)[] {
  const raw = join(DIR, 'all.gray')
  ff(['-v', 'error', '-y', '-i', video, '-pix_fmt', 'gray', '-f', 'rawvideo', raw])
  const buf = readFileSync(raw)
  const size = W * H
  const out: ({ w: number; h: number; cx: number; cy: number } | null)[] = []
  for (let f = 0; (f + 1) * size <= buf.length; f++) {
    const off = f * size
    let x0 = W, x1 = -1, y0 = H, y1 = -1
    for (let y = 0; y < H; y++) {
      const row = off + y * W
      for (let x = 0; x < W; x++) {
        if (buf[row + x] > 128) {
          if (x < x0) x0 = x
          if (x > x1) x1 = x
          if (y < y0) y0 = y
          if (y > y1) y1 = y
        }
      }
    }
    out.push(x1 < 0 ? null : { w: x1 - x0 + 1, h: y1 - y0 + 1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 })
  }
  rmSync(raw, { force: true })
  return out
}

/** 1コマぶんの記録（表と実測を並べる） */
interface Row {
  f: number
  t: number
  want: number
  got: number
  diff: number
}

function report(name: string, rows: Row[], tol: number): void {
  const bad = rows.filter((r) => r.diff > tol)
  const md = [
    `# 1コマずつの確認: ${name}`,
    '',
    `- コマ数: ${rows.length}`,
    `- 許容: ±${tol}`,
    `- ずれたコマ: ${bad.length}`,
    '',
    '| # | 時刻 | 表の値 | 実測 | 差 | |',
    '|---|---|---|---|---|---|',
    ...rows.map(
      (r) =>
        `| ${r.f} | ${r.t.toFixed(3)}s | ${r.want.toFixed(4)} | ${r.got.toFixed(4)} | ${r.diff.toFixed(4)} | ${r.diff > tol ? '✗' : ''} |`
    )
  ].join('\n')
  writeFileSync(join(DIR, `${name}.md`), md, 'utf-8')
}

describe('動きが、1コマずつ表のとおりに焼けているか', () => {
  if (!existsSync(FF)) {
    it.skip('同梱の ffmpeg が無いので飛ばす', () => {})
    return
  }
  mkdirSync(DIR, { recursive: true })

  /** 動きを1つ焼いて、全コマを表と突き合わせる */
  const check = (name: string, m: ClipMotion, sec: number, tol: number): Row[] => {
    const src = join(DIR, `${name}-src.mp4`)
    const out = join(DIR, `${name}.mp4`)
    makeSource(src, sec)
    const zp = zoompanFilter({ scale: 1, x: 0, y: 0 }, m, {
      width: W,
      height: H,
      timeExpr: `on/${FPS}`,
      fpsArg: String(FPS),
      frames: 1
    })
    ff([
      '-v', 'error', '-y', '-i', src,
      '-vf', `${zp},setsar=1`,
      '-c:v', 'libopenh264', '-b:v', '8000k', '-pix_fmt', 'yuv420p',
      out
    ])
    const got = measureAll(out)
    const rows: Row[] = []
    got.forEach((g, f) => {
      if (!g) return
      const t = f / FPS
      const want = zoomAt({ scale: 1, x: 0, y: 0 }, m, t).scale
      // 四角は元が BOX。拡大率 s なら BOX*s になる（画面からはみ出す手前まで）
      const gotScale = g.w / BOX
      if (BOX * want > Math.min(W, H) * 0.95) return // はみ出したコマは測れない
      rows.push({ f, t, want, got: gotScale, diff: Math.abs(gotScale - want) })
    })
    report(name, rows, tol)
    return rows
  }

  it('まっすぐ寄る（1倍→2倍）が、毎コマ表どおり', () => {
    const m: ClipMotion = {
      sc: [
        { t: 0, v: 1 },
        { t: 1, v: 2 }
      ]
    }
    const rows = check('linear', m, 1.5, 0.06)
    expect(rows.length).toBeGreaterThan(20)
    const bad = rows.filter((r) => r.diff > 0.06)
    expect(bad.map((r) => `${r.t.toFixed(2)}s 表${r.want.toFixed(3)}/実${r.got.toFixed(3)}`)).toEqual([])
  })

  // **ベジェ（写し取った動き）が本命。** 途中が合っているかは、
  // 2枚比べる確認では絶対に分からない。
  it('曲がって寄る（ベジェ）が、毎コマ表どおり', () => {
    const m: ClipMotion = {
      sc: [
        { t: 0, v: 1, to: { speed: 0, influence: 1 / 3 } },
        { t: 1, v: 2, ti: { speed: 0, influence: 1 / 3 } }
      ]
    }
    const rows = check('bezier', m, 1.5, 0.06)
    expect(rows.length).toBeGreaterThan(20)
    const bad = rows.filter((r) => r.diff > 0.06)
    expect(bad.map((r) => `${r.t.toFixed(2)}s 表${r.want.toFixed(3)}/実${r.got.toFixed(3)}`)).toEqual([])
    // 曲がっている証拠: 真ん中の手前が、直線より遅れている
    const mid = rows.find((r) => Math.abs(r.t - 0.25) < 0.02)
    expect(mid!.want).toBeLessThan(1.25)
  })
})
