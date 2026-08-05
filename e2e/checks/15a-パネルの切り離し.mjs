// パネルの**切り離し**（別ウィンドウ・別モニター）。
//
// `15-パネルと見た目.mjs` が 629行あったので出した（決まり: 600超は500以下に割る）。
// 章「パネルの切り離し」を名乗るのはここ。入口は ./15-パネルと見た目.mjs

import { readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'

export default async function (C) {
  const {
    app, assert, check, fx, near, page, resetProject, section, seekTo, setDialogFiles,
    touchedRef
  } = C
  section('パネルの切り離し（別ウィンドウ・別モニター）')
  await resetProject()

  /** いま開いている別ウィンドウ（本体を除く） */
  const popWindows = () => app.windows().filter((w) => w !== page)

  await check('タブを右クリックして、パネルを切り離すと窓になる', async () => {
    const before = await page.locator('.panel-tabs-strip').count()
    await page.locator('.panel-tabs-strip').last().locator('.tab').first().click({ button: 'right' })
    await page.waitForSelector('.ctx-menu')
    const item = page.locator('.ctx-item', { hasText: 'このパネルを切り離す' }).first()
    assert(await item.count(), 'メニューに切り離しが無い')
    await item.click()
    await page.waitForTimeout(2000)
    const pops = popWindows()
    assert(pops.length === 1, `別ウィンドウが開いていない（${pops.length}枚）`)
    const pop = pops[0]
    await pop.waitForSelector('.pane-pop-root .panel', { timeout: 15000 })
    // 中身が本当に入っているか（枠だけ出て中が空、では意味が無い）
    const tabs = await pop.locator('.pane-pop-root .tab').allTextContents()
    assert(tabs.includes('プロジェクト'), `別ウィンドウにタブが出ていない（${tabs.join(',')}）`)
    // スタイルが写っていないと、素の HTML が並んだだけの見た目になる
    const bg = await pop
      .locator('.pane-pop-root')
      .evaluate((el) => getComputedStyle(el).backgroundColor)
    assert(bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent', `見た目が写っていない（${bg}）`)
    // 本体側からは消えて、残りが広がる
    const after = await page.locator('.panel-tabs-strip').count()
    assert(after === before - 1, `本体からパネルが消えていない（${before} → ${after}）`)
  })

  await check('別ウィンドウの中でも、掴んで動かす操作が効く', async () => {
    // 掴んで動かす処理は本体側の window に耳を付けている。別ウィンドウの中で
    // 動かしたぶんが届かないと、掴んだまま固まる。タブの並べ替えで確かめる。
    //
    // 窓は前の項目が出していることが多いが、絞って回すと無いので、無ければ自分で出す。
    if (!popWindows().length) {
      await page.locator('.panel-tabs-strip').last().locator('.tab').first().click({ button: 'right' })
      await page.waitForSelector('.ctx-menu')
      await page.locator('.ctx-item', { hasText: 'このパネルを切り離す' }).first().click()
      await page.waitForTimeout(2000)
    }
    const pop = popWindows()[0]
    assert(pop, '別ウィンドウが無い')
    const strip = pop.locator('.panel-tabs-strip').first()
    const before = await strip.locator('.tab').allTextContents()
    const a = await strip.locator('.tab').nth(0).boundingBox()
    const b = await strip.locator('.tab').nth(1).boundingBox()
    await pop.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
    await pop.mouse.down()
    const goal = b.x + b.width + 6
    for (let i = 1; i <= 8; i++)
      await pop.mouse.move(
        a.x + a.width / 2 + ((goal - (a.x + a.width / 2)) * i) / 8,
        a.y + a.height / 2
      )
    await pop.mouse.up()
    await pop.waitForTimeout(500)
    const after = await strip.locator('.tab').allTextContents()
    assert(after[0] === before[1], `別ウィンドウで並べ替えできない（${before.join(',')} → ${after.join(',')}）`)
  })

  await check('切り離した状態は保存され、開き直すと同じ形で始まる', async () => {
    // 「今のこの状態」が戻らないと切り離す意味が無い。
    // 配置はプロジェクトの中身と一緒に保存し、開き直したら同じ形にする。
    //
    // 窓は前の項目が出していることが多いが、絞って回すと無いので、無ければ自分で出す。
    if (!popWindows().length) {
      await page.locator('.panel-tabs-strip').last().locator('.tab').first().click({ button: 'right' })
      await page.waitForSelector('.ctx-menu')
      await page.locator('.ctx-item', { hasText: 'このパネルを切り離す' }).first().click()
      await page.waitForTimeout(2000)
    }
    const pop = popWindows()[0]
    assert(pop, '別ウィンドウが無い')
    // いまの配置（切り離し中）を、開いているファイルへ保存する
    await page.keyboard.press('Control+s')
    await page.waitForTimeout(1800)
    const data = JSON.parse(readFileSync(fx.gcproj, 'utf-8'))
    assert(data.layout, '保存した中身に画面の配置が入っていない')
    assert(
      Array.isArray(data.layout.panes) && data.layout.panes.includes('right'),
      `切り離しているパネルが保存されていない（${JSON.stringify(data.layout.panes)}）`
    )
    assert(
      typeof data.layout.leftW === 'number' && typeof data.layout.rightW === 'number',
      'パネルの大きさが保存されていない'
    )
    const g = data.layout.geom?.right
    assert(g && g.w > 0 && g.h > 0, `窓の大きさ・位置が保存されていない（${JSON.stringify(g)}）`)
    // いったん本体へ戻してから、保存したものを開く
    await pop.close()
    await page.waitForTimeout(1500)
    assert(popWindows().length === 0, '窓が閉じていない')
    await setDialogFiles([fx.gcproj], null)
    await page.keyboard.press('Control+o')
    await page.waitForTimeout(3000)
    const cont = page.locator('.modal-btn', { hasText: 'このまま続ける' })
    if (await cont.count()) {
      await cont.click()
      await page.waitForTimeout(2500)
    }
    assert(popWindows().length === 1, `開き直しても切り離した形にならない（${popWindows().length}枚）`)
    for (const w of popWindows()) await w.close().catch(() => {})
    await page.waitForTimeout(1500)
  })
  await check('別ウィンドウのプレビューで、映像が出て再生できる', async () => {
    // 動画の部品（video）が別の document へ移る。作り直しに失敗すると、
    // 窓が白いまま・落ちる、という一番まずい形になる。
    for (const w of popWindows()) await w.close().catch(() => {})
    await page.waitForTimeout(1200)
    await page.locator('.panel.monitor .panel-tabs-strip .tab').first().click({ button: 'right' })
    await page.waitForSelector('.ctx-menu')
    await page.locator('.ctx-menu > .ctx-item', { hasText: '切り離す' }).first().click()
    await page.waitForTimeout(2500)
    const pop = popWindows()[0]
    assert(pop, 'プレビューの別ウィンドウが開かない')
    await pop.waitForSelector('.pane-pop-root .panel.monitor', { timeout: 15000 })
    // 映像が生きているか（読めない・エラー付きなら作り直しに失敗している）
    const v = await pop.evaluate(() => {
      const el = document.querySelector('video')
      if (!el) return null
      return { ready: el.readyState, w: el.videoWidth, err: el.error ? el.error.code : null }
    })
    assert(v, '別ウィンドウに映像の部品が無い')
    assert(!v.err, `映像がエラーになっている（code=${v.err}）`)
    assert(v.w > 0, `映像の大きさが取れていない（${JSON.stringify(v)}）`)
    // 再生してみる（落ちるならここで落ちる）
    await pop.locator('.pane-pop-root .transport button', { hasText: '▶' }).first().click()
    await pop.waitForTimeout(2000)
    assert(!pop.isClosed(), '再生したら別ウィンドウが落ちた')
    const t = await pop.locator('.pane-pop-root .tc-cur').first().textContent()
    assert(t && t !== '00:00:00:00', `別ウィンドウで再生が進んでいない（${t}）`)
    await pop.locator('.pane-pop-root .transport button', { hasText: '▶' }).first().click()
    await pop.waitForTimeout(300)
    assert(!pop.isClosed(), '止めたら別ウィンドウが落ちた')
    assert(!page.isClosed(), '本体が落ちた')
  })

  await check('別ウィンドウを選んだままでも、ショートカットが効く', async () => {
    // 別ウィンドウで作業している最中に、いちいち本体を選び直すのは面倒。
    for (const w of popWindows()) await w.close().catch(() => {})
    await page.waitForTimeout(1200)
    await page.locator('.panel-tabs-strip').last().locator('.tab').first().click({ button: 'right' })
    await page.waitForSelector('.ctx-menu')
    await page.locator('.ctx-item', { hasText: 'このパネルを切り離す' }).first().click()
    await page.waitForTimeout(2000)
    const pop = popWindows()[0]
    assert(pop, '別ウィンドウが開かない')
    const clips = () => page.locator('[data-tid="V1"] .video-clip:not(.se-ghost)').count()
    // 分割はクリップの途中でしかできない。ここへ来るまでに再生ヘッドが
    // どこにあるかは、前の項目次第で変わる（絞って回すと 0 秒のまま）。
    // 見たいのは「別ウィンドウでもキーが効くか」なので、位置は自分で決める。
    await seekTo(7)
    // **選択を外しておく。** カットは「何も選んでいなければ全部・選んでいれば
    // その物だけ」なので、前の項目の選択が残っていると本編の動画は切れない
    // （見たいのは「別ウィンドウでもキーが効くか」であって、切る範囲の話ではない）。
    await page.evaluate(() => {
      const el = document.querySelector('.track-scroll')
      if (!el) return
      const r = el.getBoundingClientRect()
      // 何も無い所を押す＝選択解除
      el.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          button: 0,
          clientX: r.right - 6,
          clientY: r.bottom - 6
        })
      )
    })
    await page.waitForTimeout(300)
    const before = await clips()
    // 別ウィンドウを選んでから、そちらで Ctrl+K（分割）を押す
    await pop.locator('.pane-pop-root').first().click({ position: { x: 5, y: 5 } })
    await pop.keyboard.press('Control+k')
    await page.waitForTimeout(800)
    const after = await clips()
    assert(after === before + 1, `別ウィンドウでショートカットが効かない（${before} → ${after}）`)
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(600)
  })

  await check('別ウィンドウで文字を打っても、ショートカットとして効かない', async () => {
    // 流しっぱなしにすると、1文字打つたびに削除や分割が走る。
    // 「効く」だけ見て「効いてはいけない場合」を見ないと、この事故を通す。
    for (const w of popWindows()) await w.close().catch(() => {})
    await page.waitForTimeout(1200)
    // 文字を打てるのはプロパティ（左パネル）。テロップを選ぶと打ち直し欄が出る
    await page.locator('.telop-clip').first().click()
    await page.waitForTimeout(400)
    await page.locator('.panel-tabs-strip').last().locator('.tab').first().click({ button: 'right' })
    await page.waitForSelector('.ctx-menu')
    await page.locator('.ctx-item', { hasText: 'プロパティ を切り離す' }).first().click()
    await page.waitForTimeout(2000)
    const pop = popWindows()[0]
    assert(pop, '別ウィンドウが開かない')
    const input = pop.locator('.pane-pop-root textarea, .pane-pop-root input[type="text"]').first()
    await input.waitFor({ timeout: 8000 })
    const clips = () => page.locator('[data-tid="V1"] .video-clip:not(.se-ghost)').count()
    const before = await clips()
    await input.click()
    await input.type('kkk') // k は分割のショートカット
    await page.waitForTimeout(800)
    const after = await clips()
    assert(after === before, `文字を打っただけでクリップが増えた（${before} → ${after}）`)
    for (const w of popWindows()) await w.close().catch(() => {})
    await page.waitForTimeout(1200)
  })

  await check('本体の見た目が変わると、別ウィンドウにも追いつく', async () => {
    // 開いた瞬間の見た目を1回写すだけだと、別ウィンドウだけ古いまま取り残される。
    // 本体に見た目を足して、別ウィンドウに届くかを見る。
    if (!popWindows().length) {
      await page.locator('.panel-tabs-strip').last().locator('.tab').first().click({ button: 'right' })
      await page.waitForSelector('.ctx-menu')
      await page.locator('.ctx-item', { hasText: 'このパネルを切り離す' }).first().click()
      await page.waitForTimeout(2000)
    }
    const pop = popWindows()[0]
    assert(pop, '別ウィンドウが開かない')
    await page.evaluate(() => {
      const s = document.createElement('style')
      s.id = '__e2e_theme'
      s.textContent = '.pane-pop-root { outline: 3px solid rgb(255, 0, 0) !important; }'
      document.head.appendChild(s)
    })
    await page.waitForTimeout(700)
    const outline = await pop
      .locator('.pane-pop-root')
      .evaluate((el) => getComputedStyle(el).outlineColor)
    await page.evaluate(() => document.getElementById('__e2e_theme')?.remove())
    await page.waitForTimeout(400)
    assert(outline === 'rgb(255, 0, 0)', `後から足した見た目が届いていない（${outline}）`)
  })

  await check('別ウィンドウに出したパネルは、下の帯から戻せる', async () => {
    // 出すと本体から消えるので、どこへ行ったのか分からなくなる。
    // 下の帯に出ているものを並べ、押せば戻せるようにしてある。
    // 前の項目が何を出していても同じ結果になるよう、ここで作り直す
    for (const w of popWindows()) await w.close().catch(() => {})
    await page.waitForTimeout(1500)
    await page.locator('.panel-tabs-strip').last().locator('.tab').first().click({ button: 'right' })
    await page.waitForSelector('.ctx-menu')
    await page.locator('.ctx-item', { hasText: 'このパネルを切り離す' }).first().click()
    await page.waitForTimeout(2000)
    const chip = page.locator('.status-pop')
    assert((await chip.count()) === 1, `下の帯に出ていない（${await chip.count()}個）`)
    await chip.first().click()
    await page.waitForTimeout(1500)
    assert(popWindows().length === 0, '押しても別ウィンドウが閉じない')
    assert((await page.locator('.status-pop').count()) === 0, '戻したのに帯に残っている')
  })

  await check('別ウィンドウを閉じると、パネルが本体へ戻る', async () => {
    // 上の項目で戻してしまったので、もう一度出してから閉じる
    for (const w of popWindows()) await w.close().catch(() => {})
    await page.waitForTimeout(1500)
    await page.locator('.panel-tabs-strip').last().locator('.tab').first().click({ button: 'right' })
    await page.waitForSelector('.ctx-menu')
    await page.locator('.ctx-item', { hasText: '切り離す' }).first().click()
    await page.waitForTimeout(2000)
    const before = await page.locator('.panel-tabs-strip').count()
    const pop = popWindows()[0]
    assert(pop, '別ウィンドウが無い')
    await pop.close()
    await page.waitForTimeout(1500)
    assert(popWindows().length === 0, '別ウィンドウが残っている')
    const after = await page.locator('.panel-tabs-strip').count()
    assert(after === before + 1, `本体へ戻っていない（${before} → ${after}）`)
  })

  // =========================================================================
}
