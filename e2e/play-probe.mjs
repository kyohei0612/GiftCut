// 「同じコードなのに再生中の重さが10倍振れる」の正体をつかむ。1回の再生で同時に出す:
//   Performance の差分（JS / レイアウト / 仕事の合計）・React の commit 回数・
//   PlaybackProvider のどの state（currentTime / playing / playRateUI / fps）が何回変わったか・
//   毎コマ描き直った部品の上位
//
// 使い方: node e2e/play-probe.mjs <ラベル> [待ち秒=8]（先に npm run build）
//
// **currentTime の更新が毎秒30回未満なら「測れていない」と出す。** 窓が裏に回ると Chromium が
// 再生の時計を毎秒1コマに絞り、JS も レイアウトも 10分の1 に見える（2026-11-08 に実際に
// 「同じコードで10倍振れる」を作った）。軽い回を「速くなった」と読まないこと。
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const require = createRequire(join(ROOT, 'package.json'))
const { _electron: electron } = require('playwright')
const { makeFixture } = await import(`file:///${ROOT}/e2e/lib/e2eFixture.mjs`)
const { makeAppHelpers } = await import(`file:///${ROOT}/e2e/lib/appHelpers.mjs`)

const label = process.argv[2] ?? '?'
const SETTLE = Number(process.argv[3] ?? 8)
const fx = await makeFixture()
const app = await electron.launch({
  executablePath: require('electron'),
  args: [ROOT, `--user-data-dir=${fx.userData}`, '--gc-auto'],
  cwd: ROOT
})
const page = await app.firstWindow()
// 作業中の画面を占領しないよう、e2e と同じく別のディスプレイへ寄せる（裏に隠すと再生の時計が毎秒1コマに絞られて測れない）
const { placeOnOtherDisplay } = await import(`file:///${ROOT}/e2e/lib/placeWindow.mjs`)
await placeOnOtherDisplay(app)
await page.waitForSelector('.app', { timeout: 20000 })
page.setDefaultTimeout(8000)

await page.addInitScript(() => {
  let on = false
  let commits = 0
  const comp = new Map()
  const pb = { currentTime: 0, playing: 0, playRateUI: 0, fps: 0, other: 0 }
  const hookAt = (f, i) => { let h = f.memoizedState; for (let k = 0; k < i && h; k++) h = h.next; return h }
  const walk = (f) => {
    for (let n = f; n; n = n.sibling) {
      const t = n.type
      const name = typeof t === 'function' ? t.displayName || t.name : ''
      if (name && (n.flags & 1)) comp.set(name, (comp.get(name) ?? 0) + 1)
      if (name === 'PlaybackProvider' && n.alternate) {
        // usePlayback の hooks の並び: 0 currentTime / 3 playing / 4 playRateUI / 7 fps（state/usePlayback.ts）
        const pairs = [['currentTime', 0], ['playing', 3], ['playRateUI', 4], ['fps', 7]]
        let any = false
        for (const [k, i] of pairs) {
          const a = hookAt(n, i), b = hookAt(n.alternate, i)
          if (a && b && a.memoizedState !== b.memoizedState) { pb[k]++; any = true }
        }
        if (!any && (n.flags & 1)) pb.other++
      }
      if (n.child) walk(n.child)
    }
  }
  globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true, renderers: new Map(), inject() { return 1 },
    onCommitFiberRoot(_id, root) { if (!on) return; commits++; walk(root.current) },
    onCommitFiberUnmount() {}, onPostCommitFiberRoot() {}
  }
  globalThis.__probe = {
    start() { on = true; commits = 0; comp.clear(); for (const k in pb) pb[k] = 0 },
    stop() { on = false; return { commits, pb: { ...pb }, comp: [...comp].sort((a, b) => b[1] - a[1]).slice(0, 12) } }
  }
})
await page.reload()
await page.waitForSelector('.app', { timeout: 20000 })
await page.waitForTimeout(800)
if (await page.locator('.restore-box').count()) {
  await page.locator('.restore-btns button', { hasText: '復元' }).first().click()
} else {
  await app.evaluate(({ dialog }, { gcproj }) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [gcproj] }) }, { gcproj: fx.gcproj })
  await page.keyboard.press('Control+o')
  await page.waitForTimeout(400)
  const cont = page.locator('.modal-btn', { hasText: 'このまま続ける' })
  if (await cont.count()) await cont.click()
}
await page.waitForSelector('[data-tid="V1"] .video-clip', { timeout: 15000 })
await page.waitForTimeout(SETTLE * 1000)

const assert = (c, m) => { if (!c) throw new Error(m) }
const v1Clips = () => page.locator('[data-tid="V1"] .video-clip:not(.se-ghost)')
const { seekTo } = makeAppHelpers(page, assert, v1Clips)
await page.locator('.telop-clip').first().click()
await page.waitForTimeout(300)
await page.locator('.panel-tabs .tab', { hasText: 'モーション' }).first().click()
await page.waitForTimeout(500)

const client = await app.context().newCDPSession(page)
await client.send('Performance.enable')
const metrics = async () => {
  const { metrics: m } = await client.send('Performance.getMetrics')
  const get = (k) => m.find((x) => x.name === k)?.value ?? 0
  return { js: get('ScriptDuration') * 1000, layout: get('LayoutDuration') * 1000, layoutN: get('LayoutCount'), task: get('TaskDuration') * 1000 }
}
const SEC = 5
for (let i = 0; i < 2; i++) {
  await seekTo(0.5)
  await page.waitForTimeout(400)
  const a = await metrics()
  await page.evaluate(() => globalThis.__probe.start())
  await page.keyboard.press(' ')
  await page.waitForTimeout(SEC * 1000)
  await page.keyboard.press(' ')
  const r = await page.evaluate(() => globalThis.__probe.stop())
  const b = await metrics()
  const d = (k) => ((b[k] - a[k]) / SEC).toFixed(1)
  // 再生の時計（currentTime）が毎秒30回も動いていなければ、窓が裏に回って絞られている＝測れていない
  if (r.pb.currentTime / SEC < 30) console.log(`[${label}] 回${i + 1}  **測れていない**（currentTime の更新 ${(r.pb.currentTime / SEC).toFixed(1)} 回/秒。窓が裏に回っている）`)
  console.log(`[${label}] 回${i + 1}  JS ${d('js')}  レイアウト ${d('layout')}（${d('layoutN')} 回/秒） 仕事の合計 ${d('task')} ms/秒 | commit ${(r.commits / SEC).toFixed(1)} 回/秒 | PlaybackProvider の state の変化（回/秒）: ` +
    Object.entries(r.pb).map(([k, v]) => `${k} ${(v / SEC).toFixed(1)}`).join(' / '))
  console.log(`      描いた部品（回/秒）: ` + r.comp.map(([k, v]) => `${k} ${(v / SEC).toFixed(0)}`).join(', '))
  await page.waitForTimeout(800)
}
await app.close()
