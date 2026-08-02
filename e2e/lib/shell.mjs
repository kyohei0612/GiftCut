// 外の道具（ffmpeg / ffprobe など）を呼ぶ。
//
// **落ちても投げない。** { code, out, err } を返して、判断は呼ぶ側に任せる。
// 測定の途中で例外が飛ぶと、そこまでの結果ごと失われるため。
import { spawn } from 'node:child_process'

/** @param {string} cmd @param {string[]} args */
export const sh = (cmd, args) =>
  new Promise((res) => {
    const p = spawn(cmd, args)
    let out = ''
    let err = ''
    p.stdout.on('data', (d) => (out += d))
    p.stderr.on('data', (d) => (err += d))
    p.on('error', () => res({ code: -1, out: '', err: 'spawn failed' }))
    p.on('close', (code) => res({ code, out, err }))
  })
