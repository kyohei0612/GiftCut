// アイコン案を並べて撮る（Electron で描画）。使い捨てではなく、
// 案を練り直すたびに使えるように残しておく。
//
//   node build/render-icons.mjs
import { _electron as electron } from 'playwright'
import { createRequire } from 'node:module'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const dir = mkdtempSync(join(tmpdir(), 'giftcut-icon-'))
mkdirSync(join(dir, 'app'), { recursive: true })
writeFileSync(
  join(dir, 'app', 'package.json'),
  JSON.stringify({ name: 'iconshot', version: '1.0.0', main: 'main.js' }),
  'utf-8'
)
writeFileSync(
  join(dir, 'app', 'main.js'),
  `const { app, BrowserWindow } = require('electron')
app.whenReady().then(() => {
  const w = new BrowserWindow({ width: 700, height: 1180, show: true })
  w.loadFile(${JSON.stringify(resolve(HERE, 'icon-ideas.html'))})
})`,
  'utf-8'
)

const require2 = createRequire(import.meta.url)
const app = await electron.launch({
  executablePath: require2('electron'),
  args: [join(dir, 'app')]
})
const page = await app.firstWindow()
await page.waitForTimeout(1500)
await page.screenshot({ path: join(HERE, 'icon-ideas.png') })
// 案ごとに 256px の単体も出す（採用したものをそのまま使えるように）
for (const id of ['i1', 'i2', 'i3']) {
  await page.locator(`#${id}`).screenshot({ path: join(HERE, `icon-${id}.png`) })
}
console.log('できました:', join(HERE, 'icon-ideas.png'))
await app.evaluate(({ app: a }) => a.exit(0)).catch(() => {})
