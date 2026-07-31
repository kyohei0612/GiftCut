// パネルの切り離し、再生バー、タブの並び
//
// 章: パネルの切り離し（別ウィンドウ・別モニター） / プレビューの再生バー / パネルのタブ（見切れ対策と並び順）
//
// **通しの本体は e2e/run.mjs から分けてある。** 1ファイル7,400行だと、
// 直したい章を探すのに毎回全部を読むことになり、足す場所も決まらないので
// 「仕上げ」に流れ込んでいた。道具（check・assert・素材づくり）は
// run.mjs 側に置いたままで、まとめて受け取る。

import { readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'

export default async function (C) {
  const {
    app,
    assert,
    check,
    fx,
    near,
    page,
    resetProject,
    section,
    seekTo,
    setDialogFiles,
    touchedRef,
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
  section('プレビューの再生バー')
  await resetProject()

  await check('画質は 1080 / 720 / 360 の3つで、どれも焼き直した映像で再生する', async () => {
    // **同梱の ffmpeg で本当に作れるか**を見る確認。
    //
    // ここは長い間どこも見ていなかった。作る指定が `libx264` 固定だったが、
    // 同梱の ffmpeg は LGPL 版で x264 が入っていないので、配布物では必ず失敗する。
    // しかも**失敗しても原本のまま再生され続ける**ので、画面上は何も起きない
    // （＝使う人には「軽くならないアプリ」に見えるだけで、原因が出ない）。
    //
    // **見た目では確かめられない。** 静かに1つ下の画質で再生していても
    // 「なんとなく綺麗」に見えてしまうので、実際の画素数で見る。
    const vid = page.locator('.screen-video').first()
    const sizeOf = () =>
      vid.evaluate((el) => ({
        w: el.videoWidth,
        h: el.videoHeight,
        src: el.getAttribute('src') ?? ''
      }))
    const pick = async (res) => {
      // **作っている間は前の画質のまま映る**（真っ暗にしないための作り）。
      // なので「焼き直した物か」だけ見ると、切り替わる前に通ってしまう。
      // 前と違う物に変わるまで待つ
      const prev = (await sizeOf()).src
      await page.locator('.pq-preview').first().selectOption(res)
      let s = await sizeOf()
      for (let i = 0; i < 90; i++) {
        await page.waitForTimeout(500)
        s = await sizeOf()
        if (s.src !== prev && s.src.includes('giftcut-proxies') && s.h > 0) break
      }
      assert(
        s.src.includes('giftcut-proxies') && s.src !== prev,
        `${res}p にしても焼き直した映像に切り替わらない（作れていない）: ${s.src}`
      )
      return s
    }
    // **素材そのものの高さを基準にする。**
    // 確認用の素材は 640x360 に縮めて作ってあるので、720 も 1080 も
    // 「素材より大きくはしない」規則どおり 360 のままになる。
    // それを「効いていない」と読むと、正しい物を不具合と呼ぶことになる
    const srcH = await (async () => {
      const probe = spawn('ffprobe', [
        '-v', 'error', '-select_streams', 'v:0',
        '-show_entries', 'stream=height', '-of', 'csv=p=0', fx.video
      ])
      let o = ''
      probe.stdout.on('data', (d) => (o += d))
      await new Promise((res) => probe.on('close', res))
      return Number(o.trim()) || 0
    })()
    assert(srcH > 0, '素材の高さを測れなかった')

    const s360 = await pick('360')
    const s720 = await pick('720')
    const s1080 = await pick('1080')
    const want = (h) => (srcH > 0 ? Math.min(srcH, h) : h)

    assert(Math.abs(s360.h - want(360)) <= 2, `360p のはずが ${s360.h}px（素材 ${srcH}px）`)
    assert(Math.abs(s720.h - want(720)) <= 2, `720p のはずが ${s720.h}px（素材 ${srcH}px）`)
    assert(Math.abs(s1080.h - want(1080)) <= 2, `1080p のはずが ${s1080.h}px（素材 ${srcH}px）`)
    // 素材が十分大きいときだけ、3つが本当に違う高さになることも見る
    if (srcH >= 1080) {
      assert(s360.h < s720.h && s720.h < s1080.h, `3つが別々の高さになっていない`)
    }
    touchedRef.dirty = true
  })

  await check('全体のどこを見ているかが、プレビューの下のバーで分かる', async () => {
    const head = page.locator('.preview-scrub-head')
    assert(await head.count(), '再生バーが無い')
    const pos = async () =>
      head.evaluate((el) => parseFloat(getComputedStyle(el).left))
    const p0 = await pos()
    await seekTo(10)
    await page.waitForTimeout(400)
    const p1 = await pos()
    assert(p1 > p0 + 5, `再生位置に付いてこない（${p0} → ${p1}）`)
  })

  await check('バーを押すと、その位置へ飛べる', async () => {
    const bar = page.locator('.preview-scrub')
    const b = await bar.boundingBox()
    const tcOf = async () => page.locator('.tc-cur').first().textContent()
    await page.mouse.click(b.x + b.width * 0.2, b.y + b.height / 2)
    await page.waitForTimeout(500)
    const a = await tcOf()
    await page.mouse.click(b.x + b.width * 0.75, b.y + b.height / 2)
    await page.waitForTimeout(500)
    const c = await tcOf()
    assert(a !== c, `押した所へ飛んでいない（${a} / ${c}）`)
  })

  await check('押した所と、つまみの位置がぴったり合う', async () => {
    // 外枠で位置を測ると、左右の余白ぶんつまみが右へずれる（実際にずれていた）
    const track = page.locator('.preview-scrub-track')
    const head = page.locator('.preview-scrub-head')
    const tb = await track.boundingBox()
    for (const ratio of [0.15, 0.5, 0.85]) {
      const cx = tb.x + tb.width * ratio
      await page.mouse.click(cx, tb.y + tb.height / 2)
      await page.waitForTimeout(400)
      const hb = await head.boundingBox()
      const center = hb.x + hb.width / 2
      near(center, cx, 3, `押した所とつまみがずれている（${Math.round(ratio * 100)}%の位置）`)
    }
  })

  await check('掴んだまま動かすと、早送り・巻き戻しできる', async () => {
    const bar = page.locator('.preview-scrub')
    const b = await bar.boundingBox()
    await page.mouse.move(b.x + b.width * 0.2, b.y + b.height / 2)
    await page.mouse.down()
    const t0 = await page.locator('.tc-cur').first().textContent()
    for (let i = 1; i <= 5; i++)
      await page.mouse.move(b.x + b.width * (0.2 + 0.1 * i), b.y + b.height / 2)
    await page.waitForTimeout(300)
    const t1 = await page.locator('.tc-cur').first().textContent()
    await page.mouse.up()
    assert(t0 !== t1, `掴んで動かしても進まない（${t0} / ${t1}）`)
  })

  // =========================================================================
  section('パネルのタブ（見切れ対策と並び順）')
  await resetProject()

  /** 右パネルを狭めて、タブがはみ出す状態を作る */
  async function narrowRightPanel() {
    const handle = page.locator('.resizer-v').last()
    const b = await handle.boundingBox()
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
    await page.mouse.down()
    await page.mouse.move(b.x + 260, b.y + b.height / 2, { steps: 8 })
    await page.mouse.up()
    await page.waitForTimeout(500)
  }

  await check('送りと一覧のボタンは、狭めていなくても常に出ている', async () => {
    // 出たり消えたりすると押す場所がずれて、どこにあるか覚えられない。
    // 「狭めたときだけ出る」だと、この確認は広いままでも通ってしまう（空振り）ので、
    // **狭める前**に見る。
    for (const panel of [page.locator('.panel-tabs').last(), page.locator('.panel.monitor .panel-tabs')]) {
      assert((await panel.locator('.tab-more').count()) > 0, '一覧（≫）が出ていない')
      assert((await panel.locator('.tab-nav').count()) >= 3, '送りのボタンが出ていない')
    }
    // 送るものが無いときは薄くなる。右パネルは既定の幅でもタブが入りきらないので、
    // 余裕のあるモニタ側（プログラム／ミキサーの2つ）で見る。
    const off = await page.locator('.panel.monitor .tab-nav.tab-nav-off').count()
    assert(off >= 2, `送るものが無いのに薄くなっていない（${off}個）`)
  })

  await check('パネルを狭めると、送りのボタンが押せる状態に変わる', async () => {
    await narrowRightPanel()
    const strip = page.locator('.panel-tabs-strip').last()
    const over = await strip.evaluate((el) => el.scrollWidth > el.clientWidth + 2)
    assert(over, 'タブがはみ出す状態を作れなかった')
    const off = await page.locator('.panel-tabs').last().locator('.tab-nav.tab-nav-off').count()
    assert(off === 0, `はみ出しているのに送りが薄いまま（${off}個）`)
  })

  await check('送りボタンを押しっぱなしにすると、タブが横に流れる', async () => {
    const strip = page.locator('.panel-tabs-strip').last()
    const x0 = await strip.evaluate((el) => el.scrollLeft)
    const next = page.locator('.tab-nav', { hasText: '›' }).last()
    const b = await next.boundingBox()
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
    await page.mouse.down()
    await page.waitForTimeout(600) // 押しっぱなし
    await page.mouse.up()
    await page.waitForTimeout(200)
    const x1 = await strip.evaluate((el) => el.scrollLeft)
    assert(x1 > x0 + 5, `押しっぱなしで流れていない（${x0} → ${x1}）`)
  })

  await check('一覧（≫）から、見えていないタブへ移動できる', async () => {
    // 送りボタンで流れたままだと「隠れているタブ」が変わるので、先頭に戻す
    await page.locator('.panel-tabs-strip').last().evaluate((el) => (el.scrollLeft = 0))
    await page.waitForTimeout(300)
    await page.locator('.tab-more').last().click()
    await page.waitForSelector('.ctx-menu')
    const item = page.locator('.ctx-item', { hasText: 'トランジション' })
    assert(await item.count(), '一覧に「トランジション」が無い')
    await item.first().click()
    await page.waitForTimeout(600)
    const on = await page.locator('.panel-tabs-strip .tab.tab-on').last().textContent()
    assert(on.includes('トランジション'), `切り替わっていない: ${on}`)
    await page.mouse.click(5, 5) // メニューを閉じる
    await page.waitForTimeout(200)
  })

  await check('一覧（≫）には、いま見えていないタブだけが出る', async () => {
    const strip = page.locator('.panel-tabs-strip').last()
    await strip.evaluate((el) => (el.scrollLeft = 0))
    await page.waitForTimeout(300)
    const visible = await strip.evaluate((el) => {
      const box = el.getBoundingClientRect()
      return [...el.querySelectorAll('.tab')]
        .filter((t) => {
          const r = t.getBoundingClientRect()
          return r.left >= box.left - 1 && r.right <= box.right + 1
        })
        .map((t) => t.textContent.trim())
    })
    await page.locator('.tab-more').last().click()
    await page.waitForSelector('.ctx-menu')
    const listed = await page.locator('.ctx-menu .ctx-item').allTextContents()
    assert(listed.length > 0, '一覧が空')
    assert(
      listed.every((t) => !visible.includes(t.trim())),
      `見えているタブまで出ている（見えている: ${visible.join(',')} / 一覧: ${listed.join(',')}）`
    )
    await page.mouse.click(5, 5)
    await page.waitForTimeout(200)
  })

  await check('一覧（≫）の並び替えコーナーで、長押しして並び順を変えられる', async () => {
    const strip = page.locator('.panel-tabs-strip').last()
    const before = await strip.locator('.tab').allTextContents()
    await page.locator('.tab-more').last().click()
    await page.waitForSelector('.ctx-menu')
    const rows = page.locator('.ctx-menu .tab-sort-row')
    assert((await rows.count()) >= 2, '並び替えコーナーが出ていない')
    const a = await rows.nth(0).boundingBox()
    const b = await rows.nth(1).boundingBox()
    // 長押し → 掴めたことを見てから動かす（掴めていないのに動かして
    // 「並びが変わらない＝正しい」に化けるのを防ぐ）
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
    await page.mouse.down()
    await page.waitForTimeout(450)
    assert((await page.locator('.tab-sort-grab').count()) === 1, '長押ししても掴めていない')
    for (let i = 1; i <= 6; i++)
      await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2 + ((b.y + b.height - a.y) * i) / 6)
    await page.mouse.up()
    await page.waitForTimeout(400)
    const after = await strip.locator('.tab').allTextContents()
    assert(after[0] === before[1], `並び替わっていない（${before.join(',')} → ${after.join(',')}）`)
    await page.mouse.click(5, 5)
    await page.waitForTimeout(200)
  })

  await check('並び替えコーナーは、長押ししていなければ並びが変わらない', async () => {
    // 押しただけ・触れただけで並びが崩れると、選ぼうとしただけで壊れる。
    const strip = page.locator('.panel-tabs-strip').last()
    const before = await strip.locator('.tab').allTextContents()
    await page.locator('.tab-more').last().click()
    await page.waitForSelector('.ctx-menu')
    const rows = page.locator('.ctx-menu .tab-sort-row')
    const a = await rows.nth(0).boundingBox()
    const b = await rows.nth(1).boundingBox()
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
    await page.mouse.down()
    // 長押しの手前（280ms）より短い間に動かす
    for (let i = 1; i <= 6; i++)
      await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2 + ((b.y + b.height - a.y) * i) / 6)
    await page.mouse.up()
    await page.waitForTimeout(400)
    const after = await strip.locator('.tab').allTextContents()
    assert(
      after.join(',') === before.join(','),
      `長押ししていないのに並びが変わった（${before.join(',')} → ${after.join(',')}）`
    )
    await page.mouse.click(5, 5)
    await page.waitForTimeout(200)
  })

  await check('タブを掴んで動かすと、並び順を変えられる', async () => {
    const strip = page.locator('.panel-tabs-strip').last()
    await strip.evaluate((el) => (el.scrollLeft = 0))
    await page.waitForTimeout(300)
    const before = await strip.locator('.tab').allTextContents()
    const a = await strip.locator('.tab').nth(0).boundingBox()
    const b = await strip.locator('.tab').nth(1).boundingBox()
    // 1つ目を2つ目より右へ運ぶ
    const goal = b.x + b.width + 6 // 2つ目の右端を越える所まで運ぶ
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
    await page.mouse.down()
    for (let i = 1; i <= 8; i++)
      await page.mouse.move(
        a.x + a.width / 2 + ((goal - (a.x + a.width / 2)) * i) / 8,
        a.y + a.height / 2
      )
    await page.mouse.up()
    await page.waitForTimeout(400)
    const after = await strip.locator('.tab').allTextContents()
    assert(after[0] === before[1], `入れ替わっていない（${before.join(',')} → ${after.join(',')}）`)
  })

  await check('掴んで動かしただけでは、タブが切り替わらない', async () => {
    const strip = page.locator('.panel-tabs-strip').last()
    const on = await strip.locator('.tab.tab-on').textContent()
    const t = strip.locator('.tab').nth(1)
    const b = await t.boundingBox()
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
    await page.mouse.down()
    for (let i = 1; i <= 5; i++) await page.mouse.move(b.x + b.width / 2 - i * 8, b.y + b.height / 2)
    await page.mouse.up()
    await page.waitForTimeout(400)
    const on2 = await strip.locator('.tab.tab-on').textContent()
    assert(on === on2, `並べ替えただけでタブが切り替わった（${on} → ${on2}）`)
  })

  await check('タブの右クリックは、切り離しのメニューだけを出す', async () => {
    // 並び順を変えるのは「掴んで動かす」だけ、右クリックはドッキング関連だけ、
    // と決めた（右クリックに両方入れると、押し間違いで並びが変わってしまう）。
    // 以前はここで「並び順を元に戻す」を探していたが、その項目はアプリに無い。
    const strip = page.locator('.panel-tabs-strip').last()
    // 前の項目で流れたままだと、1つ目のタブが帯からはみ出していて、
    // 右クリックが帯の外（パネル本体）へ落ち、別のメニューが出る。
    await strip.evaluate((el) => (el.scrollLeft = 0))
    await page.waitForTimeout(300)
    await strip.locator('.tab').nth(0).click({ button: 'right' })
    await page.waitForSelector('.ctx-menu')
    const items = await page.locator('.ctx-menu .ctx-item').allTextContents()
    assert(items.length > 0, 'メニューが空')
    assert(
      items.some((t) => t.includes('切り離す') || t.includes('戻す')),
      `切り離しの項目が無い（${items.join(' / ')}）`
    )
    assert(
      !items.some((t) => t.includes('並び順')),
      `右クリックに並び替えが混ざっている（${items.join(' / ')}）`
    )
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    assert((await page.locator('.ctx-menu').count()) === 0, 'Escape でメニューが閉じない')
  })

  // =========================================================================
}
