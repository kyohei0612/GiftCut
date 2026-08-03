// 外の道具（ffmpeg / ffprobe など）を呼ぶ。
//
// **落ちても投げない。** { code, out, err } を返して、判断は呼ぶ側に任せる。
// 測定の途中で例外が飛ぶと、そこまでの結果ごと失われるため。
import { spawn } from 'node:child_process'

/**
 * @param {string} cmd @param {string[]} args
 * @param {{raw?: boolean}} [opts] raw:true で `raw`（Buffer）も返す。
 *   **生の画素を取るときは文字列にしない**——UTF-8 として読むと 0x80 以上が
 *   置換文字に化けて、数えた結果が丸ごと嘘になる。
 */
export const sh = (cmd, args, opts = {}) =>
  new Promise((res) => {
    const p = spawn(cmd, args)
    let out = ''
    let err = ''
    const chunks = []
    p.stdout.on('data', (d) => {
      if (opts.raw) chunks.push(d)
      else out += d
    })
    p.stderr.on('data', (d) => (err += d))
    p.on('error', () => res({ code: -1, out: '', err: 'spawn failed', raw: Buffer.alloc(0) }))
    p.on('close', (code) =>
      res({ code, out, err, raw: opts.raw ? Buffer.concat(chunks) : Buffer.alloc(0) })
    )
  })
