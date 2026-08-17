// 置き場へ入れる側（実際にファイルを触る）。
//
// **本物のフォルダで確かめる。** ここは「入れたつもりで入っていない」と
// 「失敗したのに半端に残った」が怖い所で、どちらも作り物の fs では出ない
// （`main/zip.test.ts` も同じ理由で本物の一時フォルダを使っている）。
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { listForZip, mergeDir, rollbackWritten } from './assetInstall'

let dir = ''
const put = (p: string, body: string): string => {
  const full = join(dir, p)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, body, 'utf-8')
  return full
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'giftcut-assetinstall-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('ZIP へ詰める', () => {
  it('入れ子のまま集める', () => {
    put('SE/効果音.wav', 'a')
    put('SE/戦闘/斬撃.wav', 'b')
    const list = listForZip(join(dir, 'SE'), '設定/SE')
    expect(list.map((x) => x.name).sort()).toEqual(['設定/SE/効果音.wav', '設定/SE/戦闘/斬撃.wav'])
  })

  it('**持っていないフォルダは空**（無いのが正常。ここで落ちない）', () => {
    expect(listForZip(join(dir, '無い'), '設定/無い')).toEqual([])
  })
})

describe('置き場へ入れる', () => {
  it('相手にしか無い物は残し、同じ名前は上書きする', () => {
    put('from/a.wav', '新')
    put('from/新顔.wav', '新')
    put('to/a.wav', '古')
    put('to/元からある.wav', '大事')
    const written: string[] = []
    const n = mergeDir(join(dir, 'from'), join(dir, 'to'), written)
    expect(n).toBe(2)
    expect(readFileSync(join(dir, 'to/a.wav'), 'utf-8')).toBe('新')
    expect(readFileSync(join(dir, 'to/元からある.wav'), 'utf-8')).toBe('大事')
  })

  it('**戻すときに、元からあった物を消さない**', () => {
    // 上書きした物を控えに入れてしまうと、戻したときに相手の物ごと消える。
    // これが起きると「取り込みに失敗しただけ」で持っていた素材が減る
    put('from/a.wav', '新')
    put('from/新顔.wav', '新')
    put('to/a.wav', '古')
    const written: string[] = []
    mergeDir(join(dir, 'from'), join(dir, 'to'), written)
    expect(written.map((p) => p.split(/[\\/]/).pop())).toEqual(['新顔.wav'])

    rollbackWritten(written)
    expect(readdirSync(join(dir, 'to'))).toEqual(['a.wav'])
    // 上書きした中身までは戻らない（控えを取っていないため）。**そう決めてある**——
    // 元の中身を残すと、取り込みのたびに置き場が2倍になる
    expect(readFileSync(join(dir, 'to/a.wav'), 'utf-8')).toBe('新')
  })

  it('入れ子ごと入る', () => {
    put('from/戦闘/斬撃.wav', 'x')
    const written: string[] = []
    expect(mergeDir(join(dir, 'from'), join(dir, 'to'), written)).toBe(1)
    expect(readFileSync(join(dir, 'to/戦闘/斬撃.wav'), 'utf-8')).toBe('x')
  })

  it('消せない物があっても、戻す処理は最後まで走る', () => {
    put('to/a.wav', '1')
    const written = [join(dir, 'to/無い.wav'), join(dir, 'to/a.wav')]
    expect(() => rollbackWritten(written)).not.toThrow()
    expect(readdirSync(join(dir, 'to'))).toEqual([])
  })
})
