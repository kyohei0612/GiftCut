// 「利用者の持ち物」を持ち出すときの決まり。
//
// ここで見るのは**混ぜ方だけ**（ファイルを触る側は `main/assetInstall.test.ts`）。
// 混ぜ方を間違えると、**サブPCの設定が黙って消える**——一番取り返しがつかない壊れ方なので、
// 「受け側に在る鍵は触らない」を機械で押さえておく。
import { describe, it, expect } from 'vitest'
import { ASSET_FOLDERS, SETTINGS_DIR, USER_STORE_FILE, mergeUserStore } from './userAssets'

describe('持ち出す「利用者の持ち物」', () => {
  it('置き場の一覧が、ファイルメニューで開ける4つと揃っている', () => {
    // ここが減ると「入れたつもりで入っていない」になる。増やすときは
    // `assetPacks.ts` の「開く」側（OPENABLE）も一緒に足すこと
    expect([...ASSET_FOLDERS]).toEqual(['SE', 'telop-presets', 'motion-presets', 'テンプレート'])
  })

  it('ZIP の中の場所は日本語の1語（受け取った人が中身を見て分かる）', () => {
    expect(SETTINGS_DIR).toBe('設定')
    expect(USER_STORE_FILE).toBe('ユーザー設定.json')
  })

  describe('控えの混ぜ方', () => {
    it('**まっさらな機械なら、丸ごと入る**（＝渡す前と同じ状態になる）', () => {
      const r = mergeUserStore({}, { 'giftcut.favorites': '[1]', 'gc.styles': '{}' })
      expect(r.merged).toEqual({ 'giftcut.favorites': '[1]', 'gc.styles': '{}' })
      expect(r.added.sort()).toEqual(['gc.styles', 'giftcut.favorites'])
      expect(r.kept).toEqual([])
    })

    it('**この機械に在る鍵は触らない**（黙って上書きしない）', () => {
      const r = mergeUserStore(
        { 'giftcut.favorites': 'こっちが本物' },
        { 'giftcut.favorites': '渡された方', 'giftcut.icons': '新しい' }
      )
      expect(r.merged['giftcut.favorites']).toBe('こっちが本物')
      expect(r.merged['giftcut.icons']).toBe('新しい')
      expect(r.added).toEqual(['giftcut.icons'])
      expect(r.kept).toEqual(['giftcut.favorites'])
    })

    it('元の物を壊さない（渡された物が空でも、在る物は残る）', () => {
      const before = { 'giftcut.a': '1' }
      const r = mergeUserStore(before, {})
      expect(r.merged).toEqual(before)
      expect(before).toEqual({ 'giftcut.a': '1' }) // 引数を書き換えていない
    })

    it('文字列でない値は入れない（壊れた控えを読んでも、そこで止まらない）', () => {
      const r = mergeUserStore({}, { よい: 'ok', だめ: 123 as unknown as string })
      expect(r.merged).toEqual({ よい: 'ok' })
      expect(r.added).toEqual(['よい'])
    })

    it('中身が無くても落ちない', () => {
      expect(mergeUserStore({}, undefined as unknown as Record<string, string>).merged).toEqual({})
    })
  })
})
