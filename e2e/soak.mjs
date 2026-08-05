// **長く動かし続けたときに、じわじわ太らないか**を測る。
//
//   npm run soak                 既定 10分
//   npm run soak -- --min=30     30分
//   npm run soak -- --selfcheck  **測定そのものが効いているか**を確かめる
//
// ## なぜ要るか（2026-08-05 に足した）
//
// 負荷チェック（`npm run bench`）が見ているのは**規模**——テロップ4000枚、
// カット2000、画像1000枚…を置いた「1操作の重さ」。**時間の軸が1本も無かった。**
//
// 「1時間ぶんの量」は測っていても、**1時間動かし続けたことは一度も無い。**
// 外部のレビューで「長時間の起動・操作の観点が抜けていないか」と指摘されて、
// 数えたらそのとおりだった。規模で出ない不具合（片付け忘れの積み上がり）は、
// 時間でしか出ない。
//
// ## 何を見るか
//
// ```
// JS の山（ヒープ）   片付け忘れたオブジェクトが積み上がる
// 節（DOM）の数        帯や旗を作って消し忘れる
// 聞き耳（listener）   付けて外し忘れる。**React で一番出やすい**
// ```
//
// **傾き（1分あたりの増え方）で判定する。**「最後の値が大きいか」で見ると、
// 単に素材が多いだけの状態と区別が付かない。増え続けているかどうかが本題。
//
// ## 落とし穴（先に潰してある）
//
// - **窓が裏に回ると Chromium は rAF を毎秒1コマに絞る**ので、操作が進まない
//   まま「増えていない＝健全」と出る。前に出せているかを毎回確かめる
// - **ゴミ拾い（GC）は気まぐれ**。山は上下するので、測る前に毎回明示的に集める
// - **操作が空振りしても増えない**ので健全に見える。1周ごとに
//   「本当に触れたか」を数え、届いていなければその場で落とす

import { _electron as electron } from 'playwright'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { clearModals, watchdog } from './dismiss.mjs'
import { cleanBigTemp } from './lib/e2eFixture.mjs'
import { prepareFixture } from './lib/benchSetup.mjs'
import { fmt, mb } from './lib/fmt.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const require = createRequire(import.meta.url)

const MINUTES = Number((process.argv.find((a) => a.startsWith('--min=')) ?? '').slice(6)) || 10
const SELFCHECK = process.argv.includes('--selfcheck')

/** 1周でやる編集（実際の使い方に近い順で並べる） */
const ROUND = [
  'テロップを足す',
  'クリップを掴んで動かす',
  '再生して止める',
  '拡大して戻す',
  '元に戻す'
]

/**
 * **暖機を捨てる（分）。**
 *
 * 起動直後は波形・サムネ・プロキシの読み込みで山が一気に伸びる。実測で
 * **最初の1分で 18 → 36MB**（1分あたり12.6MB）になるが、これは漏れではなく
 * 「一度作れば済む物」を作っているだけ。ここを混ぜて傾きを出すと、
 * **健全なアプリでも必ず赤になる**——そして数字を緩めて誤魔化すことになる。
 *
 * 判定に使うのは、暖機のあとの区間だけ。
 */
const WARMUP_MIN = 2

/** 増えてよい上限（1分あたり）。超えたら赤 */
const LIMIT = {
  // 10分で 50MB。編集を続ければ多少は増えるが、**片付いていれば頭打ちになる**
  ヒープMB: 5,
  // 節が毎分100 増え続けるなら、作った物を消していない
  節: 100,
  // **聞き耳は増え続けてはいけない**。開いて閉じれば元に戻るのが正しい
  聞き耳: 20
}

/** 1つ測る。GC を促してから読む（山の上下でぶれないように） */
async function sample(page, client) {
  // **測る前に集める。** ゴミ拾いは気まぐれなので、
  // 集める前の値を並べると「増えた／減った」がただの運になる
  await client.send('HeapProfiler.collectGarbage').catch(() => {})
  const { metrics } = await client.send('Performance.getMetrics')
  const get = (k) => metrics.find((x) => x.name === k)?.value ?? 0
  return {
    ヒープMB: get('JSHeapUsedSize') / 1024 / 1024,
    節: get('Nodes'),
    聞き耳: get('JSEventListeners')
  }
}

/** 最小二乗で「1分あたりどれだけ増えたか」を出す */
function slopePerMin(points, key) {
  const n = points.length
  if (n < 3) return NaN
  const mx = points.reduce((s, p) => s + p.分, 0) / n
  const my = points.reduce((s, p) => s + p[key], 0) / n
  let num = 0
  let den = 0
  for (const p of points) {
    num += (p.分 - mx) * (p[key] - my)
    den += (p.分 - mx) ** 2
  }
  return den === 0 ? NaN : num / den
}

async function main() {
  cleanBigTemp()
  // **編集された物の上で回す。** 何も置いていない画面で回すと、掴む物も消す物も
  // 無いまま「増えていない＝健全」と出る。最初に作った版が実際そうで、
  // 節も聞き耳も**1つも動かないまま緑**だった（`bench` と同じ素材を借りる）
  const { fx } = await prepareFixture({
    REAL: '',
    MINUTES: 60,
    PROFILE: 'tv',
    MINUS: '',
    DO_LIMITS: false,
    DO_EXPORT: false
  })
  const app = await electron.launch({
    executablePath: require('electron'),
    // `--expose-gc` … 測る前に一度ゴミを片付けるため
    // `--enable-precise-memory-info` … 無いと丸められて、何をしても同じ数字が返る
    args: [
      ROOT,
      `--user-data-dir=${fx.userData}`,
      '--gc-auto',
      '--js-flags=--expose-gc',
      '--enable-precise-memory-info'
    ],
    cwd: ROOT
  })
  const page = await app.firstWindow()
  await page.waitForSelector('.app', { timeout: 30000 })
  page.setDefaultTimeout(20000)
  // **起動直後の窓を片付ける。**「前回の続きを復元しますか」が出たままだと、
  // 下の操作は1つも届かない（そして「増えていない」と出る）
  await clearModals(page)
  // **見張りは「分数」を取る**（page ではない）。測る時間より余裕を持たせる
  const guard = watchdog(MINUTES + 5, () => app.close())
  const client = await page.context().newCDPSession(page)
  await client.send('Performance.enable')
  await client.send('HeapProfiler.enable')

  // **前に出す。**裏に回ったまま測ると rAF が毎秒1コマに絞られ、
  // 操作が進まないまま「増えていない」と出る（bench で実際に6項目が同時に赤になった）
  const win = await app.browserWindow(page)
  await win.evaluate((w) => {
    w.show()
    w.focus()
  })

  const points = []
  const t0 = Date.now()
  let rounds = 0
  let touched = 0

  console.log(`\n\x1b[1m長時間の確認（soak）\x1b[0m  ${MINUTES}分 / 1周 ${ROUND.length}操作\n`)

  while ((Date.now() - t0) / 60000 < MINUTES) {
    const before = touched
    touched += await doRound(page)
    // **空振りを健全と読ませない。** 何も触れていないなら、
    // 増えないのは当たり前で、測定として成立していない
    if (touched === before)
      throw new Error(
        `${rounds + 1}周目で、どの操作も届いていません。` +
          '画面の作りが変わったか、窓が裏に回っています（これを緑にしてはいけません）'
      )
    rounds++
    const s = await sample(page, client)
    points.push({ 分: (Date.now() - t0) / 60000, ...s })
    if (rounds % 5 === 0)
      console.log(
        `  ${fmt((Date.now() - t0) / 60000)}分  ` +
          `ヒープ ${mb(s.ヒープMB * 1024 * 1024)}  節 ${s.節}  聞き耳 ${s.聞き耳}`
      )
  }

  // **自分で壊して、ちゃんと赤くなるかを見る**（--selfcheck）
  if (SELFCHECK) {
    await page.evaluate(() => {
      const g = globalThis
      g.__leak = []
      for (let i = 0; i < 200000; i++) g.__leak.push({ x: new Array(50).fill(i) })
    })
    const s = await sample(page, client)
    points.push({ 分: (Date.now() - t0) / 60000 + 0.001, ...s })
  }

  clearTimeout(guard)
  await app.close()
  report(points, rounds, touched)
}

/**
 * 1周ぶん触る。**「押した数」ではなく「本当に変わった数」を返す。**
 *
 * 最初の版は `page.keyboard.press` を押すたびに数えていた。キーは相手が居なくても
 * 押せるので、**素材がゼロの画面でも毎周4を返して緑になった。**
 * 押せたことは、届いたことの証拠にならない（CLAUDE.md 7番）。
 */
async function doRound(page) {
  let changed = 0
  const cueCount = () => page.locator('.cue-clip').count()
  const zoomOf = () =>
    page.locator('.track-inner').first().evaluate((el) => el.getBoundingClientRect().width)

  // 1. テロップを足す → **数が増えたか**
  const c0 = await cueCount()
  const addBtn = page.locator('button[title*="テロップ"]').first()
  if (await addBtn.count()) await addBtn.click({ timeout: 3000 }).catch(() => {})
  if ((await cueCount()) > c0) changed++

  // 2. クリップを掴んで動かす → **左端が動いたか**
  const clip = page.locator('.video-clip').first()
  if (await clip.count()) {
    const b = await clip.boundingBox()
    if (b) {
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
      await page.mouse.down()
      await page.mouse.move(b.x + b.width / 2 + 60, b.y + b.height / 2, { steps: 6 })
      await page.mouse.up()
      const after = await clip.boundingBox()
      if (after && Math.abs(after.x - b.x) > 5) changed++
    }
  }

  // 3. 再生して止める → **再生ヘッドの時刻が進んだか**
  const timeOf = async () =>
    (await page.locator('.tc-cur').first().textContent().catch(() => '')) ?? ''
  const t0 = await timeOf()
  await page.keyboard.press('Space')
  await page.waitForTimeout(600)
  await page.keyboard.press('Space')
  if ((await timeOf()) !== t0) changed++

  // 4. 拡大して戻す → **中身の幅が変わったか**
  const w0 = await zoomOf()
  await page.keyboard.press('=')
  await page.waitForTimeout(120)
  if (Math.abs((await zoomOf()) - w0) > 5) changed++
  await page.keyboard.press('-')

  // 5. 元に戻す → **テロップの数が戻ったか**
  const c1 = await cueCount()
  await page.keyboard.press('Control+z')
  await page.waitForTimeout(150)
  if ((await cueCount()) !== c1) changed++

  return changed
}

function report(points, rounds, touched) {
  console.log(`\n\x1b[1m結果\x1b[0m  ${rounds}周 / ${touched}回ぶん本当に変わった\n`)
  const warm = points.filter((p) => p.分 >= WARMUP_MIN)

  // **判定できないときは、緑にせず落とす。**
  // 「点が足りないので合格」にすると、短く回すだけで通せてしまう
  if (warm.length < 3) {
    console.error(
      `\n最初の ${WARMUP_MIN} 分は暖機として捨てるので、` +
        `**判定には ${WARMUP_MIN + 1} 分以上要ります**（いま ${fmt(points[points.length - 1].分)}分）。\n` +
        '`npm run soak -- --min=10` のように延ばしてください。\n'
    )
    process.exit(1)
  }

  console.log(`  （最初の ${WARMUP_MIN} 分は暖機として捨てた。判定は残り ${warm.length} 点）\n`)
  let ng = 0
  for (const key of ['ヒープMB', '節', '聞き耳']) {
    const k = slopePerMin(warm, key)
    const bad = Number.isFinite(k) && k > LIMIT[key]
    if (bad) ng++
    console.log(
      `  ${bad ? '\x1b[31m✗\x1b[0m' : '\x1b[32m✓\x1b[0m'} ${key.padEnd(8)} ` +
        `${fmt(warm[0][key])} → ${fmt(warm[warm.length - 1][key])}   ` +
        `1分あたり ${fmt(k)}（上限 ${LIMIT[key]}）`
    )
  }
  if (ng) {
    console.error(`\n\x1b[31m${ng}件が増え続けています。\x1b[0m 片付け忘れを疑うこと\n`)
    process.exit(1)
  }
  console.log('\n増え続けている物はありません\n')
}

main().catch((e) => {
  console.error(`\n\x1b[31m落ちました\x1b[0m ${e.message}\n`)
  process.exit(1)
})
