// 再生中のレイアウト（強制レイアウト含む）を**誰が起こしているか**を名指しする。
// Chrome の記録（Tracing）で Layout / UpdateLayoutTree の出来事と、その呼び出し元の JS を取る。
// 使い方: node e2e/layout-who.mjs [秒]（先に npm run build）
//
// 出る物: 出来事の種類ごとの時間 / JS から強制されたレイアウトの呼び出し元 /
// レイアウトを汚した要素と理由（invalidationTracking）/ perf.measure の名札。
// 2026-11-08 の実測（初期素材・テロップを選んでモーションのタブを開いて再生）:
//   Layout 60回/秒・99ms/秒。強制は 0.8ms/秒だけ＝**残りは DOM を毎コマ変えたぶんの普通のレイアウト**。
//   汚し主: panel-body の Scrollbar changed 158回/秒、テロップの SVG（text/defs/g/svg）150+75×3回/秒、
//   telop-textmain の Style changed 75回/秒、#text の文字変更 60回/秒、playhead / preview-scrub-head の inline style 60回/秒
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const require = createRequire(join(ROOT, 'package.json'))
const { _electron: electron } = require('playwright')
const { makeFixture } = await import(`file:///${ROOT}/e2e/lib/e2eFixture.mjs`)
const { makeAppHelpers } = await import(`file:///${ROOT}/e2e/lib/appHelpers.mjs`)

const SEC = Number(process.argv[2] ?? 6)
const fx = await makeFixture()
const app = await electron.launch({
  executablePath: require('electron'),
  args: [ROOT, `--user-data-dir=${fx.userData}`, '--gc-auto'],
  cwd: ROOT
})
const page = await app.firstWindow()
// 作業中の画面を占領しない。裏に隠すと再生の時計が毎秒1コマに絞られて測れないので、別のディスプレイへ寄せる
const { placeOnOtherDisplay } = await import(`file:///${ROOT}/e2e/lib/placeWindow.mjs`)
await placeOnOtherDisplay(app)
await page.waitForSelector('.app', { timeout: 20000 })
page.setDefaultTimeout(8000)
await page.waitForSelector('.restore-box', { timeout: 15000 })
await page.locator('.restore-btns button', { hasText: '復元' }).first().click()
await page.waitForSelector('[data-tid="V1"] .video-clip', { timeout: 15000 })
await page.waitForTimeout(8000)

const assert = (c, m) => { if (!c) throw new Error(m) }
const v1Clips = () => page.locator('[data-tid="V1"] .video-clip:not(.se-ghost)')
const { seekTo } = makeAppHelpers(page, assert, v1Clips)
await page.locator('.telop-clip').first().click()
await page.waitForTimeout(300)
await page.locator('.panel-tabs .tab', { hasText: 'モーション' }).first().click()
await page.waitForTimeout(500)
await seekTo(0.5)
await page.waitForTimeout(400)

const client = await app.context().newCDPSession(page)
await client.send('Performance.enable')
const metrics = async () => {
  const { metrics: m } = await client.send('Performance.getMetrics')
  const get = (k) => m.find((x) => x.name === k)?.value ?? 0
  return { layout: get('LayoutDuration') * 1000, layoutN: get('LayoutCount'), js: get('ScriptDuration') * 1000, task: get('TaskDuration') * 1000 }
}
const headX = () => page.locator('.tl-playhead, .playhead').first().boundingBox().then((b) => b?.x ?? NaN).catch(() => NaN)
const events = []
client.on('Tracing.dataCollected', ({ value }) => events.push(...value))
await client.send('Tracing.start', {
  transferMode: 'ReportEvents',
  traceConfig: {
    includedCategories: [
      'devtools.timeline',
      'disabled-by-default-devtools.timeline',
      'disabled-by-default-devtools.timeline.stack',
      'disabled-by-default-devtools.timeline.invalidationTracking',
      'disabled-by-default-devtools.timeline.frame',
      'blink.user_timing'
    ]
  }
})
const x0 = await headX()
const m0 = await metrics()
await page.keyboard.press(' ')
await page.waitForTimeout(SEC * 1000)
await page.keyboard.press(' ')
const m1 = await metrics()
const x1 = await headX()
const done = new Promise((r) => client.once('Tracing.tracingComplete', r))
await client.send('Tracing.end')
await done
await app.close()
console.log(`再生ヘッドの位置 ${x0.toFixed(0)} → ${x1.toFixed(0)} px（動いていなければ再生が始まっていない）`)
console.log(`Performance.getMetrics の差分（ms/秒）: レイアウト ${((m1.layout - m0.layout) / SEC).toFixed(1)}（${((m1.layoutN - m0.layoutN) / SEC).toFixed(0)} 回/秒） JS ${((m1.js - m0.js) / SEC).toFixed(1)} 仕事の合計 ${((m1.task - m0.task) / SEC).toFixed(1)}`)
// 名札（perf.measure）があれば数える
const marks = new Map()
for (const e of events) {
  if (e.cat !== 'blink.user_timing' || !e.dur) continue
  const r = marks.get(e.name) ?? { n: 0, ms: 0 }
  r.n++; r.ms += e.dur / 1000
  marks.set(e.name, r)
}
if (marks.size) {
  console.log('名札（perf.measure）ごと（ms/秒・回/秒）:')
  for (const [k, r] of [...marks].sort((a, b) => b[1].ms - a[1].ms).slice(0, 10))
    console.log(`   ${(r.ms / SEC).toFixed(1).padStart(7)}  ${(r.n / SEC).toFixed(0).padStart(5)}  ${k}`)
}

// ---- 集計 ----
const byName = new Map()
for (const e of events) {
  if (e.ph !== 'X' || !e.dur) continue
  const r = byName.get(e.name) ?? { n: 0, ms: 0 }
  r.n++; r.ms += e.dur / 1000
  byName.set(e.name, r)
}
console.log(`再生 ${SEC} 秒の記録: 出来事の種類ごと（ms/秒・回/秒）、長い順`)
for (const [name, r] of [...byName].sort((a, b) => b[1].ms - a[1].ms).slice(0, 18))
  console.log(`   ${(r.ms / SEC).toFixed(1).padStart(7)} ms/秒  ${(r.n / SEC).toFixed(0).padStart(5)} 回/秒  ${name}`)

// 強制レイアウト（JS の途中で起きた Layout）は beginData.stackTrace を持つ
const forced = new Map()
let forcedMs = 0, forcedN = 0, layoutMs = 0, layoutN = 0
for (const e of events) {
  if (e.name !== 'Layout' || e.ph !== 'X') continue
  layoutN++; layoutMs += e.dur / 1000
  const st = e.args?.beginData?.stackTrace
  if (!st || !st.length) continue
  forcedN++; forcedMs += e.dur / 1000
  const top = st[0]
  const key = `${top.functionName || '(名前なし)'}  ${(top.url || '').split('/').pop()}:${top.lineNumber}:${top.columnNumber}`
  const r = forced.get(key) ?? { n: 0, ms: 0, deeper: new Map() }
  r.n++; r.ms += e.dur / 1000
  // 1つ下の呼び出し元も添える（React の中から呼ばれているときに、どの部品かを知るため）
  for (const f of st.slice(1, 4)) {
    const k2 = `${f.functionName || '(名前なし)'} ${(f.url || '').split('/').pop()}:${f.lineNumber}`
    r.deeper.set(k2, (r.deeper.get(k2) ?? 0) + 1)
  }
  forced.set(key, r)
}
console.log(`\nLayout 合計 ${(layoutMs / SEC).toFixed(1)} ms/秒・${(layoutN / SEC).toFixed(0)} 回/秒。` +
  `うち JS から強制された物 ${(forcedMs / SEC).toFixed(1)} ms/秒・${(forcedN / SEC).toFixed(0)} 回/秒`)
console.log('強制レイアウトの呼び出し元（ms/秒・回/秒）:')
for (const [k, r] of [...forced].sort((a, b) => b[1].ms - a[1].ms).slice(0, 12)) {
  console.log(`   ${(r.ms / SEC).toFixed(1).padStart(7)}  ${(r.n / SEC).toFixed(0).padStart(5)}  ${k}`)
  for (const [k2, n] of [...r.deeper].sort((a, b) => b[1] - a[1]).slice(0, 3))
    console.log(`              ↑ ${k2}  ×${n}`)
}
// レイアウトの規模（1回あたり何個の箱を並べ直したか）と、**何がレイアウトを汚したか**（invalidationTracking）
{
  let dirty = 0, total = 0, n = 0
  for (const e of events) {
    if (e.name !== 'Layout' || e.ph !== 'X') continue
    const bd = e.args?.beginData
    if (!bd) continue
    n++; dirty += bd.dirtyObjects ?? 0; total += bd.totalObjects ?? 0
  }
  if (n) console.log(`\nLayout 1回あたり: 汚れた箱 ${(dirty / n).toFixed(0)} / 全部 ${(total / n).toFixed(0)}（平均）`)
  const inv = new Map()
  for (const e of events) {
    if (e.name !== 'LayoutInvalidationTracking' && e.name !== 'StyleRecalcInvalidationTracking' && e.name !== 'ScheduleStyleInvalidationTracking') continue
    const d = e.args?.data ?? {}
    const st = d.stackTrace?.[0]
    const who = st ? `${st.functionName || '(名前なし)'} ${(st.url || '').split('/').pop()}:${st.lineNumber}` : ''
    const key = `${e.name.replace('InvalidationTracking', '')}  ${d.nodeName ?? ''}  ${d.reason ?? d.invalidationSet ?? d.changedAttribute ?? d.changedClass ?? ''}  ${who}`
    inv.set(key, (inv.get(key) ?? 0) + 1)
  }
  console.log('レイアウト／スタイルを汚した物（回/秒・種類 / 要素 / 理由 / 呼び出し元）:')
  for (const [k, c] of [...inv].sort((a, b) => b[1] - a[1]).slice(0, 16))
    console.log(`   ${(c / SEC).toFixed(0).padStart(6)}  ${k}`)
}
// スタイル計算の呼び出し元
const styleWho = new Map()
let styleMs = 0, styleN = 0
for (const e of events) {
  if (e.name !== 'UpdateLayoutTree' || e.ph !== 'X') continue
  styleN++; styleMs += e.dur / 1000
  const st = e.args?.beginData?.stackTrace
  if (!st?.length) continue
  const top = st[0]
  const key = `${top.functionName || '(名前なし)'}  ${(top.url || '').split('/').pop()}:${top.lineNumber}`
  const r = styleWho.get(key) ?? { n: 0, ms: 0 }
  r.n++; r.ms += e.dur / 1000
  styleWho.set(key, r)
}
console.log(`\nスタイル計算 合計 ${(styleMs / SEC).toFixed(1)} ms/秒・${(styleN / SEC).toFixed(0)} 回/秒。JS から強制された物の呼び出し元:`)
for (const [k, r] of [...styleWho].sort((a, b) => b[1].ms - a[1].ms).slice(0, 8))
  console.log(`   ${(r.ms / SEC).toFixed(1).padStart(7)}  ${(r.n / SEC).toFixed(0).padStart(5)}  ${k}`)
