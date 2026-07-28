// ZIP の読み書き（プロジェクトの持ち出しで使う）。
//
// Electron に依存しない形にしてある。ここが動くことは実際に ZIP を作って
// 展開して確かめられる（zip.test.ts）。「渡した ZIP が相手の環境で開けない」は
// 起きてからでは直しようがないので、往復を自動で見張る価値がある。
//
// 圧縮は既定で掛けない。動画・音声・画像は既に圧縮済みで、掛けても数%しか
// 減らないのに、数GBを読み直すぶんの時間だけ確実に増える。
import { createWriteStream, mkdirSync, statSync } from 'fs'
import { join } from 'path'
import { ZipFile } from 'yazl'
import yauzl from 'yauzl'

export interface ZipEntry {
  /** ZIP の中での名前（例: 素材/a.mp4）。区切りは / */
  name: string
  /** ファイルから入れる場合 */
  from?: string
  /** 中身を直接入れる場合（プロジェクト本体や控えなど） */
  data?: Buffer
}

/**
 * ZIP の中の名前を、展開先の中だけに収まる相対パスへ均す。
 * 人からもらう ZIP には「../../」や「C:\」で始まる名前を仕込めるので
 * （いわゆる Zip Slip）、そのまま join すると展開先の外へ書けてしまう。
 * 受け付けられない名前は null。
 */
export function safeZipName(name: string): string | null {
  const n = name.replace(/\\/g, '/')
  if (!n || n.startsWith('/') || /^[a-zA-Z]:/.test(n)) return null
  if (n.split('/').some((seg) => seg === '..')) return null
  return n
}

/** ZIP を書く。進捗は「書けたバイト数 / 入れる中身の合計」で出す。 */
export function writeZip(
  dest: string,
  entries: ZipEntry[],
  onProgress: (percent: number) => void = () => {}
): Promise<void> {
  const total = entries.reduce((n, e) => {
    if (e.data) return n + e.data.length
    try {
      return n + (e.from ? statSync(e.from).size : 0)
    } catch {
      return n
    }
  }, 0)
  const zip = new ZipFile()
  for (const e of entries) {
    if (e.data) zip.addBuffer(e.data, e.name)
    else if (e.from) zip.addFile(e.from, e.name, { compress: false })
  }
  zip.end()
  return new Promise((res, rej) => {
    let written = 0
    let last = -1
    const out = createWriteStream(dest)
    zip.outputStream.on('data', (chunk: Buffer) => {
      written += chunk.length
      const p = total > 0 ? Math.min(99, Math.round((written / total) * 100)) : 0
      if (p !== last) {
        last = p
        onProgress(p)
      }
    })
    zip.outputStream.on('error', rej)
    out.on('error', rej)
    out.on('close', () => {
      onProgress(100)
      res()
    })
    zip.outputStream.pipe(out)
  })
}

/** ZIP に入っている中身の合計サイズ（進捗のために先に数える。展開はしない） */
export function zipTotalBytes(zipPath: string): Promise<number> {
  return new Promise((res, rej) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zf) => {
      if (err || !zf) return rej(err ?? new Error('ZIP を開けません'))
      let total = 0
      zf.on('entry', (entry) => {
        total += entry.uncompressedSize
        zf.readEntry()
      })
      zf.on('end', () => res(total))
      zf.on('error', rej)
      zf.readEntry()
    })
  })
}

/**
 * ZIP を展開する。keepInMemory に挙げた名前だけはファイルに書かず中身を返す
 * （プロジェクト本体は、展開先が決まってからパスを繋ぎ直して書きたいので）。
 */
export async function extractZip(
  zipPath: string,
  destDir: string,
  opts: { keepInMemory?: string[]; onProgress?: (percent: number) => void } = {}
): Promise<Record<string, string>> {
  const keep = new Set(opts.keepInMemory ?? [])
  const onProgress = opts.onProgress ?? ((): void => {})
  const total = await zipTotalBytes(zipPath)
  return new Promise((resolve, reject) => {
    const held: Record<string, string> = {}
    let done = 0
    let last = -1
    const tick = (n: number): void => {
      done += n
      const p = total > 0 ? Math.min(99, Math.round((done / total) * 100)) : 0
      if (p !== last) {
        last = p
        onProgress(p)
      }
    }
    yauzl.open(zipPath, { lazyEntries: true }, (err, zf) => {
      if (err || !zf) return reject(err ?? new Error('ZIP を開けません'))
      zf.on('error', reject)
      zf.on('end', () => {
        onProgress(100)
        resolve(held)
      })
      zf.on('entry', (entry) => {
        const name = safeZipName(entry.fileName)
        if (!name) {
          console.warn('[zip] 展開先の外を指す名前なので飛ばします:', entry.fileName)
          return zf.readEntry()
        }
        if (name.endsWith('/')) {
          mkdirSync(join(destDir, name), { recursive: true })
          return zf.readEntry()
        }
        zf.openReadStream(entry, (e2, rs) => {
          if (e2 || !rs) return reject(e2 ?? new Error('ZIP の中身を読めません'))
          rs.on('error', reject)
          if (keep.has(name)) {
            const chunks: Buffer[] = []
            rs.on('data', (c: Buffer) => {
              chunks.push(c)
              tick(c.length)
            })
            rs.on('end', () => {
              held[name] = Buffer.concat(chunks).toString('utf-8')
              zf.readEntry()
            })
            return
          }
          const out = join(destDir, name)
          mkdirSync(join(out, '..'), { recursive: true })
          const ws = createWriteStream(out)
          rs.on('data', (c: Buffer) => tick(c.length))
          ws.on('error', reject)
          ws.on('close', () => zf.readEntry())
          rs.pipe(ws)
        })
      })
      zf.readEntry()
    })
  })
}
