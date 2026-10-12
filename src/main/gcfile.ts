// `gcfile://media/<パス>` でローカルのファイルを画面へ配る。**名簿（allowList）にある物だけ。**
//
// 動画の途中シークに必須の HTTP Range（206 Partial Content）を自前で処理する。
//
// ## CORS を開けておく（2026-10-12）
//
// <img>/<video> は要らないが、切り抜きの土台（onnxruntime-web）は `.mjs` を import() で、
// `.wasm` と模型を fetch で読む。画面は file:// なので gcfile は別オリジン扱いになり、
// `Access-Control-Allow-Origin` が無いと「no available backend found」で黙って落ちる
// （実物で出た。名簿で守っているので * で開けてよい）。
//
// ## 中身
//
// - `mimeFor`                … 拡張子 → Content-Type（.mjs は JS として返す。import() が種類を見る）
// - `registerGcfileProtocol` … 受け口を開く（app.whenReady の中で1回）
import { protocol } from 'electron'
import { normalize } from 'path'
import { createReadStream, statSync } from 'fs'
import { Readable } from 'stream'
import { isAllowed } from './allowList'

export function mimeFor(p: string): string {
  switch (p.toLowerCase().split('.').pop()) {
    case 'mp4':
      return 'video/mp4'
    case 'mov':
      return 'video/quicktime'
    case 'mkv':
      return 'video/x-matroska'
    case 'webm':
      return 'video/webm'
    case 'avi':
      return 'video/x-msvideo'
    case 'png':
      return 'image/png'
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'mjs':
    case 'js':
      return 'text/javascript'
    case 'wasm':
      return 'application/wasm'
    default:
      return 'application/octet-stream'
  }
}

export function registerGcfileProtocol(): void {
  protocol.handle('gcfile', (request) => {
    const url = new URL(request.url)
    const filePath = normalize(decodeURIComponent(url.pathname).replace(/^\//, ''))
    if (!isAllowed(filePath)) {
      return new Response('forbidden', { status: 403 })
    }
    let size: number
    try {
      size = statSync(filePath).size
    } catch {
      return new Response('not found', { status: 404 })
    }
    const type = mimeFor(filePath)
    const range = request.headers.get('Range')
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range)
      let start = m && m[1] !== '' ? parseInt(m[1], 10) : 0
      let end = m && m[2] !== '' ? parseInt(m[2], 10) : size - 1
      if (isNaN(start) || start < 0) start = 0
      if (isNaN(end) || end >= size) end = size - 1
      if (start > end) start = 0
      const stream = createReadStream(filePath, { start, end })
      return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
        status: 206,
        headers: {
          'Content-Type': type,
          'Content-Range': `bytes ${start}-${end}/${size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': String(end - start + 1),
          'Access-Control-Allow-Origin': '*'
        }
      })
    }
    return new Response(Readable.toWeb(createReadStream(filePath)) as unknown as ReadableStream, {
      status: 200,
      headers: {
        'Content-Type': type,
        'Accept-Ranges': 'bytes',
        'Content-Length': String(size),
        'Access-Control-Allow-Origin': '*'
      }
    })
  })
}
