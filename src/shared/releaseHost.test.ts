import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { RELEASE_OWNER, RELEASE_REPO, releaseAssetUrl } from './releaseHost'

const yml = readFileSync(join(__dirname, '..', '..', 'electron-builder.yml'), 'utf8')

describe('配り先', () => {
  // **electron-builder は自分の設定しか読まない**ので、同じ値が2か所に要る。
  // 消せない重複なので、**食い違ったら落とす**方に倒す。
  // ここがずれると、差し替えは 404 を掴んで「出ていない」と読み、
  // **黙って普通の更新に落ちる**（動くので誰も気づかない）
  it('electron-builder.yml の publish と同じ持ち主', () => {
    expect(yml).toMatch(new RegExp(`owner:\\s*${RELEASE_OWNER}\\b`))
  })

  it('electron-builder.yml の publish と同じ置き場所', () => {
    expect(yml).toMatch(new RegExp(`repo:\\s*${RELEASE_REPO}\\b`))
  })

  it('添付の URL は版とタグ（v付き）で決まる', () => {
    expect(releaseAssetUrl('0.1.28', 'bundle-0.1.28.zip')).toBe(
      `https://github.com/${RELEASE_OWNER}/${RELEASE_REPO}/releases/download/v0.1.28/bundle-0.1.28.zip`
    )
  })
})
