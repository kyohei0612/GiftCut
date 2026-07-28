import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { writeZip, extractZip, safeZipName, zipTotalBytes } from './zip'

let work: string
beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), 'giftcut-zip-test-'))
})
afterAll(() => {
  rmSync(work, { recursive: true, force: true })
})

describe('展開先の外へ書かせない（もらった ZIP を開くので）', () => {
  it('普通の名前は通す', () => {
    expect(safeZipName('素材/a.mp4')).toBe('素材/a.mp4')
    expect(safeZipName('素材\\a.mp4')).toBe('素材/a.mp4')
  })
  it('上へ抜ける・絶対パス・ドライブ名は弾く', () => {
    expect(safeZipName('../外.txt')).toBeNull()
    expect(safeZipName('素材/../../外.txt')).toBeNull()
    expect(safeZipName('/etc/passwd')).toBeNull()
    expect(safeZipName('C:\\Windows\\system32\\x.dll')).toBeNull()
    expect(safeZipName('')).toBeNull()
  })
  it('名前に .. を含むだけのファイルは通す（「..」そのものだけを弾く）', () => {
    expect(safeZipName('素材/あ..い.mp4')).toBe('素材/あ..い.mp4')
  })
})

describe('ZIP の往復', () => {
  it('入れたものが、そのまま出てくる', async () => {
    const src = join(work, 'src')
    mkdirSync(src, { recursive: true })
    // 中身のあるファイル（バイナリのつもりで乱数っぽい並びを作る）
    const big = Buffer.alloc(300 * 1024)
    for (let i = 0; i < big.length; i++) big[i] = (i * 31 + 7) % 251
    writeFileSync(join(src, '動画.mp4'), big)
    writeFileSync(join(src, '音.wav'), 'これは音のつもり', 'utf-8')

    const zipPath = join(work, 'まとめ.zip')
    const seen: number[] = []
    await writeZip(
      zipPath,
      [
        { name: 'プロジェクト.gcproj', data: Buffer.from('{"version":1}', 'utf-8') },
        { name: '素材/動画.mp4', from: join(src, '動画.mp4') },
        { name: '素材/音.wav', from: join(src, '音.wav') }
      ],
      (p) => seen.push(p)
    )
    expect(existsSync(zipPath)).toBe(true)
    // 進捗は増えるだけで、最後は必ず 100 になる（途中で止まったように見せない）
    expect(seen[seen.length - 1]).toBe(100)
    expect([...seen].sort((a, b) => a - b)).toEqual(seen)

    const dest = join(work, 'dest')
    mkdirSync(dest, { recursive: true })
    const held = await extractZip(zipPath, dest, { keepInMemory: ['プロジェクト.gcproj'] })

    // プロジェクト本体は書かずに中身で返る
    expect(held['プロジェクト.gcproj']).toBe('{"version":1}')
    expect(existsSync(join(dest, 'プロジェクト.gcproj'))).toBe(false)
    // 素材は 1バイトも違わずに出てくる
    expect(readFileSync(join(dest, '素材', '動画.mp4')).equals(big)).toBe(true)
    expect(readFileSync(join(dest, '素材', '音.wav'), 'utf-8')).toBe('これは音のつもり')
  })

  it('日本語や空白を含む名前でも壊れない', async () => {
    const src = join(work, 'src2')
    mkdirSync(src, { recursive: true })
    const name = 'テスト 動画 (2)＆記号.mp4'
    writeFileSync(join(src, name), 'なかみ', 'utf-8')
    const zipPath = join(work, 'まとめ2.zip')
    await writeZip(zipPath, [{ name: `素材/${name}`, from: join(src, name) }])
    const dest = join(work, 'dest2')
    mkdirSync(dest, { recursive: true })
    await extractZip(zipPath, dest)
    expect(readFileSync(join(dest, '素材', name), 'utf-8')).toBe('なかみ')
  })

  it('中身の合計サイズを、展開せずに数えられる', async () => {
    const src = join(work, 'src3')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'a.bin'), Buffer.alloc(1000))
    writeFileSync(join(src, 'b.bin'), Buffer.alloc(2000))
    const zipPath = join(work, 'まとめ3.zip')
    await writeZip(zipPath, [
      { name: '素材/a.bin', from: join(src, 'a.bin') },
      { name: '素材/b.bin', from: join(src, 'b.bin') }
    ])
    expect(await zipTotalBytes(zipPath)).toBe(3000)
  })

  it('壊れたファイルを渡されたら、例外で分かる（黙って空にしない）', async () => {
    const bad = join(work, 'こわれ.zip')
    writeFileSync(bad, 'これは ZIP ではない', 'utf-8')
    await expect(extractZip(bad, join(work, 'dest3'))).rejects.toBeTruthy()
  })
})
