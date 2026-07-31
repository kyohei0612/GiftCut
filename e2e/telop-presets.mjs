// 取り込んだ演出を1つずつ、1コマずつ確かめる（npm run presets）
//
// ## なぜ要るか
//
// 72個を目で見て回るのは無理で、しかも「動いてはいるが違う」が一番多い。
// **本物のアプリを動かして、1コマずつ撮って、数字にする。**
//
//   1. テロップを1つ置き、見本帳から演出を1つ付ける
//   2. 「1フレーム進む」を実際に押しながら、毎コマ撮る
//      （秒を目盛りのピクセルで当てるやり方だと、拡大率しだいでズレる。
//        ボタンを押す方は、作りからしてコマ単位で正確）
//   3. 毎コマの「文字の位置・大きさ・濃さ」を測る
//
// 出来上がるのは e2e/presets/ の下:
//
//   <番号>-<名前>.png … 1コマずつ横に並べた帯（目で見る用）
//   report.md         … 全部の判定（数字で見る用）
//
// 判定はこの4つ。**どれも「見れば分かるが、見ないと分からない」もの**:
//
//   動かない      … 最初から最後まで1ピクセルも変わらない（付けても無意味）
//   戻らない      … 終わっても元の姿に戻らない（テロップがズレたまま座り続ける）
//   消えたまま    … 終わっても透明のまま（文字が出てこない）
//   画面の外      … 終わっても枠の外にいる
//
// ## 使い方
//
//   GIFTCUT_PRFPSET="C:/…/[ONE_telop01].prfpset" npm run presets
//   npm run presets -- --only=飛び出し     名前で絞る（直しながら回す用）
//   npm run presets -- --no-shots          絵を撮らず判定だけ（速い）
//
// **先に npm run build が要る**（out/ のアプリを動かすため）。

import { _electron as electron } from 'playwright'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { watchdog } from './dismiss.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const OUT = join(ROOT, 'e2e', 'presets')
const FF = join(ROOT, 'resources', 'ffmpeg', 'ffmpeg.exe')
const PRF = process.env.GIFTCUT_PRFPSET
const argAfter = (f) => {
  const i = process.argv.indexOf(f)
  return i >= 0 ? process.argv[i + 1] : null
}
const ONLY = ((process.argv.find((a) => a.startsWith('--only=')) ?? '').slice(7) || argAfter('--only') || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const SHOTS = !process.argv.includes('--no-shots')
// △（こちらに無いエフェクトが混ざっている物）は既定で見ない。
// **作っていない物が「動かない」と出ても、直しようが無い＝ただの雑音。**
// 実装したときに --all で見に行く。
const ALL = process.argv.includes('--all')
// 1コマの尺（プロジェクトの既定）。演出は0.2〜0.5秒なので、これで足りる
const FPS = 30
const MAX_FRAMES = 40

if (!PRF || !existsSync(PRF)) {
  console.error(
    '素材の場所を渡してください（リポジトリには置きません）:\n' +
      '  GIFTCUT_PRFPSET="C:/…/[ONE_telop01].prfpset" npm run presets'
  )
  process.exit(2)
}
if (!existsSync(join(ROOT, 'out/main/index.js'))) {
  console.error('先に `npm run build` を実行してください（out/main/index.js が必要）。')
  process.exit(2)
}

const ff = (args) => {
  const r = spawnSync(FF, args, { encoding: 'buffer' })
  if (r.status !== 0) throw new Error(`ffmpeg 失敗:\n${r.stderr?.toString().slice(-600)}`)
}

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })
const tmp = mkdtempSync(join(tmpdir(), 'gc-presets-'))
const userData = join(tmp, 'userData')
mkdirSync(userData, { recursive: true })

const app = await electron.launch({
  executablePath: require('electron'),
  args: [ROOT, `--user-data-dir=${userData}`, '--gc-auto'],
  cwd: ROOT
})
const page = await app.firstWindow()
// 黙って止まり続けないよう、頭打ちを決めておく（e2e/dismiss.mjs）
watchdog(60, () => app.close())
page.on('pageerror', (e) => console.log('  [画面の例外]', String(e).slice(0, 200)))
await page.waitForSelector('.app', { timeout: 20000 })
page.setDefaultTimeout(10000)

// ファイル選択は本物のダイアログなので、選んだことにする
await app.evaluate(({ dialog }, prf) => {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [prf] })
}, PRF)

/**
 * 進路に立ちはだかる問いを片付ける。
 *
 * **これが無いと、1件も出さずに固まる。** アプリは落ちても困らないように
 * 「前回の続きを復元しますか」「保存せずに閉じますか」と必ず聞いてくるので、
 * 自動で回すときは毎回こちらが答えてやる必要がある。
 */
async function dismissDialogs() {
  for (const label of [
    '破棄して新規', // 前回の続きを復元しますか → いらない（毎回まっさらから見たい）
    '空で始める', // テンプレートから始めますか → いらない
    'このまま続ける', // 保存していない変更があります（開き直すとき）
    '保存せずに閉じる' // ✕ で閉じるときの確認
  ]) {
    const b = page.locator('.modal-btn, .btn, .export-overlay button', { hasText: label })
    if (await b.count().catch(() => 0)) {
      await b.first().click().catch(() => {})
      await page.waitForTimeout(500)
    }
  }
}

// --- 下ごしらえ -------------------------------------------------------------
await page.waitForTimeout(1200)
await dismissDialogs()
await page.waitForTimeout(500)

// テロップを1つ置く
await page.locator('button', { hasText: 'テロップ' }).first().click()
await page.waitForTimeout(700)
await page.locator('.telop-clip').first().click()
await page.waitForTimeout(400)
// 見た目は何でもよいが、**素のままだと動きが読みにくい**ので、
// 見本帳のスタイルを1つ着せる（縁と影が付くと、ぼかしや明るさの変化も分かる）
await page.locator('.panel-tabs .tab', { hasText: 'テロップ' }).first().click()
await page.waitForTimeout(400)
const firstSec = page.locator('.tpl-acc').first()
if (await firstSec.count()) {
  await firstSec.click()
  await page.waitForTimeout(400)
  const card = page.locator('.tpl-card').first()
  if (await card.count()) {
    await card.click()
    await page.waitForTimeout(400)
  }
}
// **大きくしておく。** 既定(90)のままだと 1920 幅の中では豆粒で、帯に並べても
// 何が起きているか読めない（動いた事は数字で分かるが、目で見る意味が無くなる）
await page.locator('.panel-tabs .tab', { hasText: 'プロパティ' }).first().click()
await page.waitForTimeout(300)
const sizeInput = page.locator('.sp-row', { hasText: 'サイズ' }).locator('input[type="number"]').first()
if (await sizeInput.count()) {
  await sizeInput.fill('260')
  await sizeInput.press('Enter')
  await page.waitForTimeout(400)
}

// **テロップの尺を伸ばしておく。**
//
// 既定は2秒。演出には 4.5 秒の物があり、尺の外へ出ると文字ごと消える。
// 消えたコマは測れず捨てられるので、**最後に測れたコマ＝まだ動いている途中の姿**が
// 「終わりの姿」として判定に使われてしまう。
// 実際 36.SLIDEx2_上/下 がこれで「戻らない(位置 -8px)」と誤判定されていた
// （取り込みは正しく、ゆっくり戻り切る前に見るのをやめていただけ）。
{
  const clip = page.locator('.telop-clip').first()
  const b = await clip.boundingBox()
  const pxPerSec = b.width / 2 // 既定の尺は2秒
  const grip = page.locator('.telop-clip .clip-trim-r').first()
  const g = await grip.boundingBox()
  const y = g.y + g.height / 2
  await page.mouse.move(g.x + g.width / 2, y)
  await page.mouse.down()
  const wantSec = 14 // 一番長い演出(4.5秒)でも余る
  for (let i = 1; i <= 8; i++) await page.mouse.move(b.x + (pxPerSec * wantSec * i) / 8, y)
  await page.mouse.up()
  await page.waitForTimeout(400)
  const after = await clip.boundingBox()
  const sec = after.width / pxPerSec
  // **伸びなかったら黙らない。** 黙ると、長い演出だけが静かに誤判定に戻る
  console.log(
    sec >= 6
      ? `テロップの尺を ${sec.toFixed(1)} 秒にしました`
      : `⚠ テロップの尺が伸びていません（${sec.toFixed(1)}秒）。長い演出の判定は当てになりません`
  )
}

// 演出を取り込む
await page.locator('.menu-item', { hasText: 'ファイル' }).first().click()
await page.waitForTimeout(300)
await page.locator('.menu-drop-item', { hasText: 'Premiere の動きを取り込む' }).first().click()
await page.waitForTimeout(2500)

// 尺は、書かれた JSON の「最後の印の時刻」から取る
const saved = readdirSync(join(userData, 'motion-presets')).find((f) => f.endsWith('.json'))
const items = JSON.parse(readFileSync(join(userData, 'motion-presets', saved), 'utf-8'))
const durOf = (m) => {
  let d = 0
  // 印の列だけ見る。**動かない設定値（ブラインドの幅・向きなど）は数で入っている**ので、
  // 素通しにすると「数は回せない」で転ぶ
  for (const keys of Object.values(m ?? {})) {
    if (!Array.isArray(keys)) continue
    for (const k of keys) if (k.t > d) d = k.t
  }
  // 波が流れ続ける演出（ユラユラ）には終わりが無い。印だけ見ると尺 0 になり、
  // 3コマしか撮らないので「動かない」と誤判定する。1周ぶんは見る。
  const spd = Math.abs(m?.wavSpd ?? 0)
  if (spd > 0) d = Math.max(d, Math.min(3, 1 / spd))
  return d
}

/**
 * **終わっても効いたままなのが正しい**演出か。
 *
 * 最後まで効果が残る物がある（53.後ろユラユラ、14.揺れる動き_速）。
 * これを「終わっても効果が残る＝戻らない」と言うと、本物の不具合がその中に埋もれる。
 * 判定は名前ではなく中身から:
 *   ・波の高さ／タービュレントの量の、最後の値が 0 でない → 効果が残る作り
 *   ・波の速度が 0 でない                                  → 流れ続ける作り
 *
 * ※これらは「動かない」判定からも外す。揺れの模様（シード）だけが変わる演出は、
 *   見た目は動いているのに、こちらの測り方（位置・大きさ・効果の文字列）では
 *   変化として拾えないため。
 */
const keepsEffect = (m) => {
  if (!m) return false
  if (Math.abs(m.wavSpd ?? 0) > 1e-6) return true
  const lastOf = (keys) =>
    Array.isArray(keys) && keys.length ? Math.abs(keys[keys.length - 1].v ?? 0) : 0
  return lastOf(m.wavH) > 0.01 || lastOf(m.tbAmt) > 0.01
}

await page.locator('.panel-tabs .tab', { hasText: 'トランジション' }).first().click()
await page.waitForTimeout(400)
// 見出しは「💫 動き」。中は 標準 / 自分の動き / 取り込んだ動き の3段。
// ※ここは名前で探しているので、**見出しを変えたら一緒に直すこと**
//   （変えたときに実際、この道具だけが黙って止まった）。
const sec = page.locator('.tpl-acc', { hasText: '動き' }).first()
if (!(await page.locator('.tpl-acc.open', { hasText: '動き' }).count())) await sec.click()
await page.waitForTimeout(400)

const stepFwd = page.locator('.tbtn[title^="1フレーム進む"]').first()
const screen = page.locator('.screen').first()

// --- 動きの中身も撮れるようにしておく ---------------------------------------
//
// 絵だけだと「なんか変」で止まる。**どの項目に、いつ、どの値が入ったか**が
// 並んでいないと直しようがないので、演出ごとに次の2枚も残す:
//
//   設定.png … 左のモーションタブ（15項目の値と、⏱ が付いている項目）
//   キー.png … タイムラインの帯（印がどこに打たれているか）
//
// タイムラインは**目一杯まで拡大してから**撮る。既定の拡大率だと0.2秒の演出は
// 帯の幅が数pxしかなく、印が重なって1つに見える。
const zoom = page.locator('.tl-zoom input[type="range"], .timeline-toolbar input[type="range"]').first()
if (await zoom.count()) {
  const max = await zoom.getAttribute('max')
  await zoom.fill(String(max ?? 100))
  await page.waitForTimeout(400)
}
// 左パネルをモーションにして、隠れている項目も開いておく（ここは出しっぱなしで済む）
await page.locator('.panel-tabs .tab', { hasText: 'モーション' }).first().click()
await page.waitForTimeout(400)
const moreSec = page.locator('.mo-sec', { hasText: '詳しい動き' }).first()
if ((await moreSec.count()) && !(await page.locator('.mo-row', { hasText: '横だけ拡大' }).count())) {
  await moreSec.click()
  await page.waitForTimeout(300)
}
const motionPanel = page.locator('.panel-body').first()

/**
 * 送りのある箱を、**送りながら撮って縦に繋ぐ**。
 *
 * モーションは15項目あり、既定の高さでは下が切れる。切抜のような下の方の項目こそ
 * 見たい物（タイプライターの正体は「切抜 右」）なので、切れると調べる意味が無い。
 *
 * 箱を広げてから1枚で撮る手も試したが、**親に切られて結局下が出ない**。
 * 送って撮る方は、どんな入れ子でも必ず全部入る。
 */
async function shotWhole(loc, path) {
  const { sh, ch } = await loc.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }))
  if (sh <= ch + 4) {
    await loc.screenshot({ path }).catch(() => {})
    return
  }
  const n = Math.ceil(sh / ch)
  const parts = []
  for (let i = 0; i < n; i++) {
    // 最後の1枚は端まで送る（送り切れないぶんは後で上を削って重なりを消す）
    const top = i === n - 1 ? sh - ch : i * ch
    await loc.evaluate((el, t) => (el.scrollTop = t), top)
    await page.waitForTimeout(120)
    const p = join(tmp, `panel-${i}.png`)
    await loc.screenshot({ path: p }).catch(() => {})
    if (existsSync(p)) parts.push({ p, cutTop: i === n - 1 ? n * ch - sh : 0 })
  }
  await loc.evaluate((el) => (el.scrollTop = 0))
  if (!parts.length) return
  if (parts.length === 1) {
    ff(['-v', 'error', '-y', '-i', parts[0].p, path])
  } else {
    const ins = parts.flatMap((x) => ['-i', x.p])
    const chains = parts
      .map((x, k) => (x.cutTop > 0 ? `[${k}]crop=iw:ih-${x.cutTop}:0:${x.cutTop}[v${k}]` : `[${k}]null[v${k}]`))
      .join(';')
    ff([
      '-v', 'error', '-y', ...ins,
      '-filter_complex', `${chains};${parts.map((_, k) => `[v${k}]`).join('')}vstack=inputs=${parts.length}`,
      path
    ])
  }
  for (const x of parts) rmSync(x.p, { force: true })
}

/**
 * 印（キーフレーム）のあたりだけを切り取って撮る。
 * 帯そのものを撮ると、拡大したぶん横に何千pxもある空っぽの帯になり、
 * クリップが左端の点になって何も読めない。**クリップと印を囲む所だけ**にする。
 */
async function shotKeys(path) {
  const box = await page.evaluate(() => {
    const el = document.querySelector('.telop-clip')
    if (!el) return null
    const r = el.getBoundingClientRect()
    let x0 = r.left, y0 = r.top, x1 = r.right, y1 = r.bottom
    for (const m of document.querySelectorAll('.kf-mark')) {
      const b = m.getBoundingClientRect()
      x0 = Math.min(x0, b.left); y0 = Math.min(y0, b.top)
      x1 = Math.max(x1, b.right); y1 = Math.max(y1, b.bottom)
    }
    const W = window.innerWidth, H = window.innerHeight
    const x = Math.max(0, x0 - 24), y = Math.max(0, y0 - 10)
    return { x, y, width: Math.min(W - x, x1 - x0 + 48), height: Math.min(H - y, y1 - y0 + 20) }
  })
  if (box && box.width > 4 && box.height > 4) await page.screenshot({ path, clip: box }).catch(() => {})
}

/**
 * その瞬間の見た目。
 *
 * **枠と濃さだけでは足りない。** 切り抜き（clip-path）・ぼかし・明るさ（filter）は
 * 要素の枠を1pxも変えないので、位置と大きさだけ見ていると
 * 「タイプライターは動かない」という嘘の判定になる（実際は右から刻んで出ている）。
 * 親にかかっている変形・フィルタ・切り抜きも文字列ごと拾う。
 */
async function measure() {
  return page.evaluate(() => {
    const el = document.querySelector('.telop-overlay .telop-textmain')
    if (!el) return null
    const r = el.getBoundingClientRect()
    let op = 1
    const tf = [], fl = [], cp = []
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const s = getComputedStyle(n)
      const o = parseFloat(s.opacity)
      if (Number.isFinite(o)) op *= o
      if (s.transform && s.transform !== 'none') tf.push(s.transform)
      if (s.filter && s.filter !== 'none') fl.push(s.filter)
      if (s.clipPath && s.clipPath !== 'none') cp.push(s.clipPath)
    }
    const scr = document.querySelector('.screen')?.getBoundingClientRect()
    return {
      x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
      op: Math.round(op * 1000) / 1000,
      tf: tf.join(' '), fl: fl.join(' '), cp: cp.join(' '),
      scr: scr ? { x: Math.round(scr.x), y: Math.round(scr.y), w: Math.round(scr.width), h: Math.round(scr.height) } : null
    }
  })
}

// 何も付いていないときの姿（＝終わったらここへ戻ってくるはず）
const rest = await measure()
if (!rest) {
  console.error('テロップがプレビューに出ていません。下ごしらえで失敗しています。')
  await app.close()
  process.exit(1)
}
console.log(`基準の姿: x=${rest.x} y=${rest.y} w=${rest.w} h=${rest.h} 濃さ=${rest.op}`)

// --- 1つずつ回す ------------------------------------------------------------
const near = (a, b, tol) => Math.abs(a - b) <= tol
const results = []
const rows = await page.locator('.mo-preset').all()
console.log(`並んでいる演出: ${rows.length} 個\n`)

let idx = 0
const skipped = []
for (const row of rows) {
  idx++
  const name = (await row.locator('.fx-name').innerText()).trim()
  if (ONLY.length && !ONLY.some((q) => name.includes(q))) continue
  const rec = items.find((t) => t.name === name)
  // 作っていないエフェクトが混ざっている物は飛ばす（--all で見る）。
  // **飛ばした数は必ず言う**（黙って減らすと「全部見た」に見える）
  if (!ALL && !ONLY.length && rec?.partial?.length) {
    skipped.push({ name, why: rec.partial.join(' / ') })
    continue
  }
  const dur = durOf(rec?.motion)
  const frames = Math.min(MAX_FRAMES, Math.max(3, Math.ceil(dur * FPS) + 3))

  await row.click()
  await page.waitForTimeout(350) // 付けると同時に頭へ戻る（アプリ側がそうしている）

  // 演出1つにつき1つのフォルダ。絵・設定・印を並べて置く
  const dir = join(OUT, `${String(idx).padStart(2, '0')}-${name.replace(/[\\/:*?"<>|]/g, '_')}`)
  if (SHOTS) {
    mkdirSync(dir, { recursive: true })
    await shotWhole(motionPanel, join(dir, '設定.png'))
    await shotKeys(join(dir, 'キー.png'))
  }

  const track = []
  const shotFiles = []
  for (let f = 0; f < frames; f++) {
    const m = await measure()
    track.push(m)
    if (SHOTS) {
      const p = join(tmp, `f-${String(f).padStart(3, '0')}.png`)
      await screen.screenshot({ path: p })
      shotFiles.push(p)
    }
    await stepFwd.click()
    await page.waitForTimeout(90)
  }

  // 帯は 40 コマまで（目で見るぶんにはこれで足りる）。
  // **判定はそこで打ち切らない。** 尺の長い演出は、残りを撮らずに送りきってから
  // 「終わりの姿」を測る。途中で測ると、ゆっくり戻っている最中の値を
  // 「戻らない」と読んでしまう（36.SLIDEx2_上/下 が実際にこれで誤判定だった。
  //  4.47秒の演出を1.3秒で打ち切り、残り 8px を「戻らない」と報告していた）。
  const total = Math.max(3, Math.ceil(dur * FPS) + 3)
  let endMissing = false
  if (total > frames) {
    for (let f = frames; f < total; f++) {
      await stepFwd.click()
      await page.waitForTimeout(40)
    }
    await page.waitForTimeout(300) // 座るのを待つ
    const endM = await measure()
    // 測れなかった＝終わりの時点でテロップが居ない。黙って前のコマに戻すと
    // 「途中の姿」を終わりとして読むことになるので、そう言う。
    if (endM) track.push(endM)
    else endMissing = true
  }

  // ---- 判定 ----
  const seen = track.filter(Boolean)
  const last = seen[seen.length - 1]
  const spread = (k) => Math.max(...seen.map((m) => m[k])) - Math.min(...seen.map((m) => m[k]))
  const varies = (k) => new Set(seen.map((m) => m[k])).size > 1
  // 枠が変わらなくても、切り抜き・ぼかし・明るさが変わっていれば「動いている」
  const moved =
    spread('x') > 1 || spread('y') > 1 || spread('w') > 1 || spread('h') > 1 || spread('op') > 0.02 ||
    varies('tf') || varies('fl') || varies('cp')
  const problems = []
  // 「_上」のような2枚重ねの上側は、**終わりで消えるのが設計どおり**。
  // 消えたことを毎回「壊れている」と言うと、本物の不具合がその中に埋もれる。
  const pair = !!rec?.endsHidden
  // 波が最後まで残る作りか（53.後ろユラユラ）。残るのが正しいので、
  // 「終わりも効果が残る」とは言わない。**静止した波は「動かない」でもない**
  const keeps = keepsEffect(rec?.motion)
  if (!moved && !keeps) problems.push('動かない')
  if (endMissing && !pair) problems.push('終わりの姿を測れない（テロップの尺が演出より短い）')
  if (last && !pair) {
    if (last.op < 0.05) problems.push('消えたまま')
    else if (!near(last.op, rest.op, 0.05)) problems.push(`終わりが薄い(${last.op})`)
    if (!near(last.x, rest.x, 3) || !near(last.y, rest.y, 3)) problems.push(`戻らない(位置 ${last.x - rest.x},${last.y - rest.y}px)`)
    if (!near(last.w, rest.w, 3) || !near(last.h, rest.h, 3)) problems.push(`戻らない(大きさ ${last.w}x${last.h}→基準 ${rest.w}x${rest.h})`)
    // 終わっても切り抜きや効果が残っていたら、それも「戻らない」。
    // 枠は元どおりなので位置の比較では絶対に見つからない
    if (last.cp) problems.push(`終わりも切り抜きが残る(${last.cp.slice(0, 40)})`)
    if (last.fl && !keeps) problems.push(`終わりも効果が残る(${last.fl.slice(0, 40)})`)
    const s = last.scr
    if (s && (last.x + last.w < s.x || last.x > s.x + s.w || last.y + last.h < s.y || last.y > s.y + s.h))
      problems.push('画面の外')
  }
  const verdict = problems.length
    ? problems.join(' / ')
    : pair
      ? 'OK（重ね用。終わりで消えるのが設計どおり）'
      : keeps
        ? 'OK（効果がずっと残るのが設計どおり）'
        : 'OK'
  const mark = problems.length ? '×' : pair ? '🔼' : '○'
  console.log(`${mark} ${String(idx).padStart(2)}. ${name}  [${frames}コマ/${dur.toFixed(2)}s] ${verdict}`)

  // ---- 1コマずつ横に並べた帯 ----
  let strip = null
  if (SHOTS && shotFiles.length) {
    strip = join(dir, 'コマ.png')
    ff([
      '-v', 'error', '-y',
      '-i', join(tmp, 'f-%03d.png'),
      '-vf', `scale=360:-1,tile=${Math.min(frames, 6)}x${Math.ceil(frames / 6)}:padding=2:color=0x202428`,
      '-frames:v', '1',
      strip
    ])
    for (const p of shotFiles) rmSync(p, { force: true })
  }
  results.push({ idx, name, dur, frames, total, verdict, problems, pair, partial: rec?.partial ?? [], strip })
}

// --- まとめ -----------------------------------------------------------------
const ng = results.filter((r) => r.problems.length)
const md = [
  '# 取り込んだ演出を1コマずつ確かめた結果',
  '',
  '<!-- npm run presets で自動生成（e2e/telop-presets.mjs）。手で直さない -->',
  '',
  `- 見た数: ${results.length}`,
  `- そのまま使える: ${results.length - ng.length}`,
  `- 直したい: ${ng.length}`,
  `- 見ていない（作っていないエフェクト混じり。--all で見る）: ${skipped.length}`,
  '',
  ...(skipped.length
    ? [
        '## 見ていないもの（先にエフェクトを作る必要がある）',
        '',
        '| 名前 | 何が要るか |',
        '|---|---|',
        ...skipped.map((s) => `| ${s.name} | ${s.why} |`),
        ''
      ]
    : []),
  '## 直したいもの',
  '',
  '| # | 名前 | 何が起きているか | 向こうにあってこちらに無い物 |',
  '|---|---|---|---|',
  ...ng.map((r) => `| ${r.idx} | ${r.name} | ${r.verdict} | ${r.partial.join(' / ') || '—'} |`),
  '',
  '## 全部',
  '',
  '| # | 名前 | 尺 | コマ（帯／全体） | 判定 |',
  '|---|---|---|---|---|',
  // 帯に並べたコマ数と、尺ぶんの全コマ数。**違っていたら帯は途中まで**という印。
  // 判定は全部送りきってから出しているので、帯が途中でも結論は正しい。
  ...results.map(
    (r) =>
      `| ${r.idx} | ${r.name} | ${r.dur.toFixed(2)}s | ${r.frames}${r.total > r.frames ? ` / ${r.total}` : ''} | ${r.verdict} |`
  ),
  ''
].join('\n')
writeFileSync(join(OUT, 'report.md'), md, 'utf8')

console.log(`\nそのまま使える ${results.length - ng.length} / ${results.length}`)
if (skipped.length) console.log(`（${skipped.length} 個は作っていないエフェクト混じりなので見ていません。--all で見ます）`)
console.log(`まとめ: ${join(OUT, 'report.md')}`)

// **閉じる前に「変更なし」と伝える。** 伝えないと「保存せずに閉じますか」が出て、
// 誰も答えないまま止まる（＝道具がいつまでも終わらない）。
// 伝えたあとは素直に閉じるので、閉じたあとの画面には触らない。
await page.evaluate(() => window.giftcut?.setDirty?.(false)).catch(() => {})
await new Promise((r) => setTimeout(r, 400))
await app.close().catch(() => {})
rmSync(tmp, { recursive: true, force: true })
