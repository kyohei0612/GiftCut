import { describe, it, expect } from 'vitest'
import { parseManifest, canStage, bundleAssetNames } from './bundleManifest'

const FP = 'electron31.7.7-format1'
const good = JSON.stringify({
  version: '0.1.28',
  fingerprint: FP,
  sha512: 'abc123==',
  size: 360000
})

describe('荷札を読む', () => {
  it('揃っていれば読める', () => {
    const m = parseManifest(good)
    expect(m?.version).toBe('0.1.28')
    expect(m?.size).toBe(360000)
  })

  it('JSON でなければ null（404 の HTML を掴むことがある）', () => {
    expect(parseManifest('<html>Not Found</html>')).toBeNull()
  })

  it('項目が欠けていれば null', () => {
    expect(parseManifest(JSON.stringify({ version: '0.1.28' }))).toBeNull()
    expect(parseManifest(JSON.stringify({ fingerprint: FP, sha512: 'x', size: 1 }))).toBeNull()
  })

  it('**大きさ 0 は通さない**（通すと「0バイト落とした」で成功してしまう）', () => {
    expect(parseManifest(JSON.stringify({ version: '0.1.28', fingerprint: FP, sha512: 'x', size: 0 }))).toBeNull()
  })

  it('名前は版から決まる', () => {
    expect(bundleAssetNames('0.1.28')).toEqual({
      zip: 'bundle-0.1.28.zip',
      json: 'bundle-0.1.28.json'
    })
  })
})

describe('落としてよいか', () => {
  const m = parseManifest(good)

  it('版と指紋が合えば落とす', () => {
    expect(canStage(m, '0.1.28', FP).ok).toBe(true)
  })

  it('**荷札が無いのは失敗ではない**（差し替えを出さない版が普通に在る）', () => {
    expect(canStage(null, '0.1.28', FP).ok).toBe(false)
  })

  it('版が違えば落とさない（別の版の荷札を掴んだ形）', () => {
    expect(canStage(m, '0.1.29', FP).ok).toBe(false)
  })

  it('**土台が違えば落とさない**（Electron が上がった版へは差し替えでは行けない）', () => {
    expect(canStage(m, '0.1.28', 'electron32.0.0-format1').ok).toBe(false)
  })

  it('**大きすぎる荷札は断る**（桁を間違えた値をそのまま信じない）', () => {
    expect(canStage(m, '0.1.28', FP, 1000).ok).toBe(false)
  })
})
