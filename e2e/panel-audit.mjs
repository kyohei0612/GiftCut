// 右パネルの導線を、撮って・数えて見る（npm run audit）
//
// ## なぜ撮るか
//
// **設計の粗は「文章で読む」と見落とす。** 空のときに何が出ているか、
// 入口がどこにあるか、押せる物がいくつ並んでいるかは、絵で見た方が早い。
//
// まっさらな状態（初めて入れた人）で撮る。素材も履歴も無い状態こそ、
// 導線が切れていると手が止まる。
//
//   node e2e/panel-audit.mjs [exeへのパス]

import { _electron as electron } from 'playwright'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const OUT = join(ROOT, 'e2e', 'audit')
mkdirSync(OUT, { recursive: true })

const exe = process.argv[2]
const ud = mkdtempSync(join(tmpdir(), 'gc-audit-'))
const app = exe
  ? await electron.launch({ executablePath: exe, args: [`--user-data-dir=${ud}`] })
  : await electron.launch({
      executablePath: require('electron'),
      args: [ROOT, `--user-data-dir=${ud}`],
      cwd: ROOT
    })
const page = await app.firstWindow()
await page.waitForSelector('.app', { timeout: 60000 })
await page.waitForTimeout(2000)
// 初回のテンプレート選びを閉じる
const empty = page.locator('.restore-btns button', { hasText: '空で始める' })
if (await empty.count()) {
  await empty.first().click()
  await page.waitForTimeout(800)
}
await page.setViewportSize({ width: 1600, height: 950 }).catch(() => {})
await page.waitForTimeout(500)

/** 右パネルの見出し（タブ）を全部拾う */
const tabs = await page.evaluate(() => {
  const panels = [...document.querySelectorAll('.panel')]
  const right = panels[panels.length - 1]
  if (!right) return []
  return [...right.querySelectorAll('.panel-tabs .tab')].map((t) => (t.textContent ?? '').trim())
})
console.log('右パネルのタブ:', tabs.join(' / '))

const findings = []
for (const t of tabs) {
  const tab = page.locator('.panel-tabs .tab', { hasText: t }).last()
  await tab.click()
  await page.waitForTimeout(700)
  const box = await page.locator('.panel').last().boundingBox()
  const file = join(OUT, `右パネル-${t.replace(/[\\/:*?"<>|]/g, '_')}.png`)
  if (box) await page.screenshot({ path: file, clip: box })

  // 何が出ているかを数える（絵と数字の両方で見る）
  const info = await page.evaluate(() => {
    const panels = [...document.querySelectorAll('.panel')]
    const p = panels[panels.length - 1]
    if (!p) return null
    const txt = (el) => (el?.textContent ?? '').trim()
    return {
      buttons: [...p.querySelectorAll('button')].map(txt).filter(Boolean),
      sections: [...p.querySelectorAll('.tpl-acc')].map(txt).map((s) => s.slice(0, 24)),
      openSections: p.querySelectorAll('.tpl-acc.open').length,
      empty: [...p.querySelectorAll('.empty')].map(txt),
      hints: [...p.querySelectorAll('.tpl-hint')].map(txt),
      items: p.querySelectorAll('.fx-item, .se-item, .bin-item, .tpl-item').length,
      hasSearch: !!p.querySelector('input[type="search"], .search, .filter-input')
    }
  })
  findings.push({ tab: t, file, ...info })
  console.log(`\n=== ${t} ===`)
  console.log('  節:', info.sections.length ? info.sections.join(' / ') : '（無し）')
  console.log('  開いている節:', info.openSections)
  console.log('  並んでいる物:', info.items)
  console.log('  ボタン:', info.buttons.join(' / ') || '（無し）')
  if (info.empty.length) console.log('  空のときの案内:', info.empty.join(' ／ '))
  if (!info.hints.length) console.log('  ※ 使い方の案内が無い')
  if (!info.hasSearch && info.items > 30) console.log('  ※ 物が多いのに探す手段が無い')
}

console.log('\n撮った画像:', OUT)
await app.close().catch(() => {})
