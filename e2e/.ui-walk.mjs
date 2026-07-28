// 実際に触ってみる（使用感とバグ探し）。使い捨て。
//
// 切り抜きの普段の流れをなぞって、各所で画面を撮る。
//   素材を置く → 切る → テロップ → 見た目を変える → 無音カット → 書き出し設定
import { _electron as electron } from 'playwright'
import { createRequire } from 'node:module'
import { mkdtempSync, copyFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const ROOT = 'C:/Users/kyohei/GiftCut'
const SHOTS = join(ROOT, 'e2e', 'ui-shots')
mkdirSync(SHOTS, { recursive: true })
const dir = mkdtempSync(join(tmpdir(), 'giftcut-ui-'))

const app = await electron.launch({
  executablePath: require('electron'),
  args: [ROOT, `--user-data-dir=${join(dir, 'ud')}`],
  cwd: ROOT
})
const page = await app.firstWindow()
const notes = []
const note = (t) => {
  notes.push(t)
  console.log('・' + t)
}
page.on('pageerror', (e) => note(`【例外】${e.message.split('\n')[0]}`))
page.on('console', (m) => {
  if (m.type() === 'error') note(`【console.error】${m.text().slice(0, 160)}`)
})

const shot = async (name) => {
  await page.screenshot({ path: join(SHOTS, `${name}.png`) })
}

await page.waitForTimeout(3500)
// 起動直後の案内
const d = page.locator('.restore-btns button', { hasText: '破棄' })
if (await d.count()) await d.first().click()
await page.waitForTimeout(800)
const ov = page.locator('.export-overlay')
if (await ov.count()) {
  await ov.locator('button').last().click({ force: true })
  await page.waitForTimeout(600)
}
await shot('01-起動直後')

// 素材を読み込む（Downloads の実素材）
const dl = 'C:/Users/kyohei/Downloads'
const cand = existsSync(dl)
  ? readdirSync(dl)
      .filter((f) => /\.mp4$/i.test(f))
      .slice(0, 1)
      .map((f) => join(dl, f))
  : []
if (!cand.length) {
  note('Downloads に mp4 が無いので、素材ありの確認は飛ばす')
} else {
  const media = join(dir, 'src.mp4')
  copyFileSync(cand[0], media)
  await app.evaluate(({ dialog }, files) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: files })
  }, [media])
  // 「ファイル追加」で素材ビンへ
  const addBtn = page.locator('button', { hasText: 'ファイル追加' }).first()
  if (await addBtn.count()) {
    await addBtn.click()
    await page.waitForTimeout(4000)
    await shot('02-素材を読み込んだ')
    const cards = await page.locator('.media-card').count()
    note(`素材ビンのカード: ${cards}枚`)
  } else {
    note('「ファイル追加」ボタンが見つからない')
  }
}

// 空の状態で各所を押してみる（何が起きるか）
const clickIf = async (sel, label) => {
  const el = page.locator(sel).first()
  if (await el.count()) {
    await el.click().catch(() => note(`${label}: 押せない`))
    await page.waitForTimeout(900)
    return true
  }
  note(`${label}: 見つからない`)
  return false
}
if (await clickIf('.tool-wide:has-text("無音カット")', '無音カット')) {
  await shot('03-無音カット')
  const msg = await page.locator('.sil-result').textContent().catch(() => '')
  note(`無音カットの案内: ${(msg ?? '').slice(0, 60)}`)
  const close = page.locator('.sil-box .btn', { hasText: '閉じる' })
  if (await close.count()) await close.click()
  await page.waitForTimeout(400)
}
// 書き出し設定
await page.keyboard.press('Control+m')
await page.waitForTimeout(1200)
await shot('04-書き出し設定')
const exportBox = page.locator('.export-overlay')
if (await exportBox.count()) {
  const btns = await exportBox.locator('button').allTextContents()
  note(`書き出し設定のボタン: ${btns.join(' / ')}`)
  const cancel = exportBox.locator('button', { hasText: /閉じる|キャンセル|中止/ }).first()
  if (await cancel.count()) await cancel.click()
  await page.waitForTimeout(600)
}
// 右パネルの各タブを覗く
for (const tab of ['テロップ', 'アイコン', 'SE', 'トランジション', 'プロジェクト']) {
  const t = page.locator('.panel-tabs-strip .tab', { hasText: tab }).last()
  if (await t.count()) {
    await t.click().catch(() => {})
    await page.waitForTimeout(700)
    await shot(`05-右パネル-${tab}`)
  } else {
    note(`右パネルのタブが見つからない: ${tab}`)
  }
}
// 左パネル（プロパティ）の見え方
await shot('06-プロパティ')

console.log('\n--- 気づき ---')
notes.forEach((n) => console.log('・' + n))
console.log(`\n画面: ${SHOTS}`)
await app.evaluate(({ app: a }) => a.exit(0)).catch(() => {})
console.log('ok')
