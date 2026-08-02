// 章に収まらなかった確認（いずれ各章へ移す）
//
// 章: 仕上げ（残っていた確認）
//
// **通しの本体は e2e/run.mjs から分けてある。** 1ファイル7,400行だと、
// 直したい章を探すのに毎回全部を読むことになり、足す場所も決まらないので
// 「仕上げ」に流れ込んでいた。道具（check・assert・素材づくり）は
// run.mjs 側に置いたままで、まとめて受け取る。

import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'

export default async function (C) {
  const {
    trackHead,
    binCardReady,
    dndFromBin,
    placePiP,
    assert,
    avgColor,
    check,
    fillExportName,
    setExportTarget,
    clipLayout,
    clipW,
    dragBy,
    fx,
    near,
    outDir,
    page,
    resetProject,
    section,
    seekTo,
    setDialogFiles,
    shotDir,
    touchedRef,
    v1Clips,
  } = C
  section('仕上げ（残っていた確認）')
  await resetProject()

  await check('「破棄して新規」を押すと、前回の内容が残らない', async () => {
    // 自動保存からの復元プロンプトを出し直すため、アプリを開き直す代わりに
    // 「新規」相当としてプロジェクトを開かずに中身を消す経路を確かめる
    await page.keyboard.press('Control+a')
    await page.keyboard.press('f')
    await page.waitForTimeout(700)
    assert((await v1Clips().count()) === 0, '中身が消えていない')
    assert((await page.locator('.telop-clip').count()) === 0, '文字が残っている')
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(600)
  })

  await check('落ちたときに「1つ前の状態」でも復元できる', async () => {
    // 落ちる原因になった操作ごと戻ってきてしまうと逃げ場が無いので、
    // 下書きは1世代前も残している。実際に読み込み直して確かめる。
    await resetProject()
    // 見分けのつく内容を「最後の自動保存」として置く（クリップ7個）
    const older = JSON.parse(readFileSync(fx.gcprojOrig, 'utf-8'))
    older.segments = Array.from({ length: 7 }, (_, i) => ({
      id: i + 1,
      srcId: 1,
      srcStart: i * 2,
      srcEnd: (i + 1) * 2
    }))
    writeFileSync(join(fx.userData, 'giftcut-autosave.json'), JSON.stringify(older), 'utf-8')
    // 開き直すと、閉じる直前の内容が新しい下書きになり、いま置いた方が1つ前へ回る
    await page.reload()
    await page.waitForSelector('.restore-btns', { timeout: 30000 })
    const prevBtn = page.locator('.restore-btns button', { hasText: '1つ前' })
    assert(await prevBtn.count(), '「1つ前の状態で復元」が出ていない')
    await prevBtn.first().click()
    await page.waitForSelector('[data-tid="V1"] .video-clip', { timeout: 30000 })
    await page.waitForTimeout(1000)
    const n = await v1Clips().count()
    assert(n === 7, `1つ前の内容が戻っていない（クリップ ${n} 個。7個のはず）`)
  },
  // **下書きの世代交代が、手前の項目が残した状態に寄りかかっている。**
  // 絞って回すと「1つ前」が育っておらず、必ず赤くなる（通しでは緑）。
  { orderDependent: true })

  await check('未保存で「プロジェクトを開く」→「中止して保存する」で何も変わらない', async () => {
    await resetProject()
    await dragBy(v1Clips().nth(0), (await clipW()) * 0.4)
    const before = await clipLayout()
    await page.waitForTimeout(1100)
    await setDialogFiles([fx.gcprojOrig], null)
    await page.keyboard.press('Control+o')
    await page.waitForTimeout(500)
    const cancel = page.locator('.modal-btn', { hasText: '中止して保存する' })
    assert(await cancel.count(), '「中止して保存する」が出ていない')
    await cancel.click()
    await page.waitForTimeout(600)
    const after = await clipLayout()
    near(after[0].x, before[0].x, 2, '中止したのに内容が変わった')
  })

  await check('動画を差し替えると、確認のうえで差し替わる', async () => {
    await resetProject()
    await setDialogFiles([fx.video], null)
    await page.locator('.menu-item', { hasText: 'ファイル' }).first().click()
    const item = page.locator('.menu-drop-item', { hasText: '差し替え' })
    assert(await item.count(), 'メニューに「動画を差し替え」が無い')
    await item.first().click()
    await page.waitForTimeout(700)
    const box = page.locator('.modal-box')
    assert(await box.count(), '差し替えの確認が出ていない')
    const t = await page.locator('.modal-title').textContent()
    assert(t.includes('差し替え'), `確認の見出しが違う: ${t}`)
    await page.locator('.modal-btn.danger', { hasText: '差し替える' }).first().click()
    await page.waitForTimeout(2000)
    assert((await v1Clips().count()) > 0, '差し替え後にクリップが無い')
  })

  await check('一覧のファイルを移動してから選ぶと、エラーが出て一覧から消える', async () => {
    await resetProject()
    const gone = join(outDir, 'gone.gcproj')
    copyFileSync(fx.gcprojOrig, gone)
    await setDialogFiles([gone], null)
    await page.keyboard.press('Control+o')
    await page.waitForTimeout(500)
    const cont = page.locator('.modal-btn', { hasText: 'このまま続ける' })
    if (await cont.count()) await cont.click()
    await page.waitForTimeout(1200)
    rmSync(gone, { force: true }) // ファイルを消してから、一覧経由で開き直す
    await page.locator('.menu-item', { hasText: 'ファイル' }).first().click()
    await page.waitForTimeout(300)
    const entry = page.locator('.menu-drop-recent', { hasText: 'gone.gcproj' })
    assert(await entry.count(), '一覧に出ていない')
    await entry.first().click()
    await page.waitForTimeout(1000)
    const toast = await page.locator('.toast').allTextContents()
    assert(toast.some((t) => t.includes('開けません')), `エラーが出ていない: ${toast.join(' / ')}`)
    await page.locator('.menu-item', { hasText: 'ファイル' }).first().click()
    await page.waitForTimeout(300)
    assert(
      (await page.locator('.menu-drop-recent', { hasText: 'gone.gcproj' }).count()) === 0,
      '見つからなかった項目が一覧に残っている'
    )
    await page.keyboard.press('Escape')
  })

  await check('Ctrl を押しながら落とすと、割り込みで入って後ろがずれる', async () => {
    await resetProject()
    const before = await clipLayout()
    const total0 = before.reduce((a, c) => a + c.w, 0)
    const r = await dndFromBin('test_video', '[data-tid="V1"]', { x: 60, y: 10 }, { ctrlKey: true })
    assert(r.ghost, '掴んだ動画の影が出なかった')
    await page.waitForTimeout(1500)
    const after = await clipLayout()
    const total1 = after.reduce((a, c) => a + c.w, 0)
    assert(total1 > total0 + 10, `割り込みで全体が伸びていない（${total0} → ${total1}）`)
  })

  await check('ドラッグ中、置く予定の場所に影が出て、音の波形も見える', async () => {
    await resetProject()
    await binCardReady('test_video')
    await page.evaluate((name) => {
      const card = [...document.querySelectorAll('.media-card')].find((e) =>
        (e.textContent ?? '').includes(name)
      )
      window.__dt = new DataTransfer()
      card.dispatchEvent(
        new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: window.__dt })
      )
    }, 'test_video')
    await page.evaluate(() => {
      const el = document.querySelector('[data-tid="V1"]')
      const b = el.getBoundingClientRect()
      el.dispatchEvent(
        new DragEvent('dragover', {
          bubbles: true,
          cancelable: true,
          clientX: b.x + 200,
          clientY: b.y + 10,
          dataTransfer: window.__dt
        })
      )
    })
    await page.waitForTimeout(500)
    assert((await page.locator('.se-ghost').count()) > 0, '置く予定の影が出ていない')
    const audioGhost = await page.locator('[data-tid="A1"] .se-ghost').count()
    assert(audioGhost > 0, '音声側の影が出ていない')
    await page.evaluate(() => {
      document.querySelector('.app').dispatchEvent(new DragEvent('dragend', { bubbles: true }))
    })
    await page.waitForTimeout(300)
  })

  await check('文字がある段に動画を置くと、文字が1段上へ避難する', async () => {
    await resetProject()
    const onV2 = await page.locator('[data-tid="V2"] .telop-clip').count()
    assert(onV2 > 0, 'V2 に文字が無い状態から始まっている')
    const r = await dndFromBin('test_video', '[data-tid="V2"]', { x: 150, y: 10 })
    assert(r.ghost, '掴んだ動画の影が出なかった')
    await page.waitForTimeout(2000)
    const moved = await page.locator('[data-tid="V3"] .telop-clip, [data-tid="V4"] .telop-clip').count()
    assert(moved > 0, '文字が1段上へ避難していない')
  })

  await check('画像は、端をつまんで長さを変えられてカッターで切れる', async () => {
    await resetProject()
    const img = page.locator('[data-tid="V3"] .img-clip:not(.se-ghost)').first()
    const b0 = await img.boundingBox()
    await page.mouse.move(b0.x + b0.width - 3, b0.y + b0.height / 2)
    await page.mouse.down()
    await page.mouse.move(b0.x + b0.width + 60, b0.y + b0.height / 2, { steps: 5 })
    await page.mouse.up()
    await page.waitForTimeout(500)
    const b1 = await page.locator('[data-tid="V3"] .img-clip:not(.se-ghost)').first().boundingBox()
    assert(b1.width > b0.width + 20, `長さが変わっていない（${Math.round(b0.width)} → ${Math.round(b1.width)}）`)
    const n0 = await page.locator('[data-tid="V3"] .img-clip:not(.se-ghost)').count()
    await page.keyboard.press('c')
    await page.locator('[data-tid="V3"] .img-clip:not(.se-ghost)').first().click({ position: { x: 40, y: 8 } })
    await page.waitForTimeout(500)
    await page.keyboard.press('v')
    assert(
      (await page.locator('[data-tid="V3"] .img-clip:not(.se-ghost)').count()) === n0 + 1,
      'カッターで切れていない'
    )
  })

  await check('画像や音声をプレビューへ落とすと、一番近い場所に置かれる', async () => {
    await resetProject()
    const n0 = await page.locator('.img-clip:not(.se-ghost)').count()
    const r = await dndFromBin('spare_image', '.panel.monitor', { x: 200, y: 150 })
    assert(r.ghost, '掴んだ画像の影が出なかった')
    await page.waitForTimeout(700)
    assert(
      (await page.locator('.img-clip:not(.se-ghost)').count()) > n0,
      'プレビューに落としても置かれない'
    )
  })

  await check('文字が無い場所で Q を押すと、カットまで詰まる', async () => {
    await resetProject()
    await seekTo(13) // 3つ目のクリップの後半（文字も効果音も無い）
    const before = (await clipLayout()).reduce((a, c) => a + c.w, 0)
    await page.keyboard.press('q')
    await page.waitForTimeout(600)
    const after = (await clipLayout()).reduce((a, c) => a + c.w, 0)
    assert(after < before - 5, `詰まっていない（${before} → ${after}）`)
  })

  await check('空きが入ったまま書き出すと、黒と無音になって尺が合う', async () => {
    await resetProject()
    const W2 = await clipW()
    await dragBy(v1Clips().nth(0), W2 * 0.8)
    await page.waitForTimeout(500)
    const out = join(outDir, 'with-gap.mp4')
    await setExportTarget(out)
    await page.keyboard.press('Control+m')
    await page.waitForSelector('.export-overlay')
    await fillExportName(out)
    await page.locator('button', { hasText: 'この設定で書き出す' }).first().click()
    await page.waitForSelector('.export-overlay', { state: 'detached', timeout: 240000 })
    assert(existsSync(out), '書き出しファイルができていない')
    // 空きの真ん中のコマは真っ黒（明暗の幅がほぼ無い）
    const f = join(shotDir, 'gap-frame.png')
    // 画像は1秒から乗っているので、その手前のコマを見る
    const p = spawn('ffmpeg', ['-y', '-ss', '0.4', '-i', out, '-frames:v', '1', f])
    await new Promise((res) => p.on('close', res))
    const c = await avgColor(f)
    assert(c.y != null && c.y < 30, `空きの所が黒くない（明るさ ${c.y}）`)
    // **中身を変えたら必ず立てる。** 立て忘れると次の resetProject が素通りし、
    // ここで作った「頭の2秒の空き」が次の項目へ残る。
    // 実際、音の確認が「素材には無い無音が 0.0〜2.0秒にある」と赤くなり、
    // 本物の不具合と見分けが付かなかった。
    touchedRef.dirty = true
  })

  await check('重ねた動画を選んだあと本編を消しても、重ねた動画は残る', async () => {
    await resetProject()
    await placePiP()
    const pip0 = await page.locator('[data-tid="V2"] .clip:not(.se-ghost)').count()
    await page.locator('[data-tid="V2"] .clip:not(.se-ghost)').first().click()
    await page.waitForTimeout(300)
    const n0 = await v1Clips().count()
    await v1Clips().nth(0).click()
    await page.keyboard.press('Delete')
    await page.waitForTimeout(600)
    assert((await v1Clips().count()) === n0 - 1, '本編が消えていない')
    assert(
      (await page.locator('[data-tid="V2"] .clip:not(.se-ghost)').count()) === pip0,
      '重ねた動画まで消えた'
    )
  })

  await check('画像を複数選んで、まとめて動かせる', async () => {
    await resetProject()
    const pps = (await clipW()) / 5
    await dndFromBin('spare_image', '[data-tid="V3"]', { x: Math.round(pps * 9), y: 10 })
    await page.waitForTimeout(600)
    const imgs = page.locator('[data-tid="V3"] .img-clip:not(.se-ghost)')
    assert((await imgs.count()) >= 2, '画像が2つになっていない')
    const xs0 = await imgs.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().x)))
    await imgs.nth(0).click()
    await imgs.nth(1).click({ modifiers: ['Control'] })
    await dragBy(imgs.nth(0), 60)
    await page.waitForTimeout(500)
    const xs1 = await imgs.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().x)))
    assert(xs1.every((x, i) => x > xs0[i] + 5), `まとめて動いていない（${xs0} → ${xs1}）`)
  })

  await check('文字をリップル削除しても、別の段の効果音や画像は動かない', async () => {
    await resetProject()
    const se0 = await page.locator('.se-clip').first().boundingBox()
    const img0 = await page.locator('.img-clip:not(.se-ghost)').first().boundingBox()
    const lower = page.locator('[data-tid="V2"] .telop-clip').first()
    await lower.click()
    await lower.click({ button: 'right' })
    await page.waitForSelector('.ctx-menu')
    await page.locator('.ctx-item', { hasText: 'リップル削除' }).first().click()
    await page.waitForTimeout(600)
    const se1 = await page.locator('.se-clip').first().boundingBox()
    const img1 = await page.locator('.img-clip:not(.se-ghost)').first().boundingBox()
    near(se1.x, se0.x, 3, '別の段の効果音まで動いてしまった')
    near(img1.x, img0.x, 3, '別の段の画像まで動いてしまった')
  })

  await check('一番下の映像の段に鍵をかけると、動画を落としても本編が上書きされない', async () => {
    await resetProject()
    const before = await clipLayout()
    const lock = trackHead('V1').locator('button[title="ロック"]').first()
    await lock.click()
    await page.waitForTimeout(300)
    const r = await dndFromBin('test_video', '[data-tid="V1"]', { x: 60, y: 10 })
    assert(r.ghost, '掴んだ動画の影が出なかった')
    await page.waitForTimeout(1200)
    const after = await clipLayout()
    assert(after.length === before.length, '鍵をかけたのに本編が書き換えられた')
    near(after[0].w, before[0].w, 3, '鍵をかけたのに本編の長さが変わった')
    await lock.click()
    await page.waitForTimeout(300)
  })

  await check('分割と複製も Ctrl+Z で戻る', async () => {
    await resetProject()
    const n0 = await v1Clips().count()
    await seekTo(7)
    await page.keyboard.press('Control+k') // 分割
    await page.waitForTimeout(500)
    assert((await v1Clips().count()) === n0 + 1, '分割できていない')
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(600)
    assert((await v1Clips().count()) === n0, '分割が戻っていない')
    await v1Clips().nth(0).click()
    await page.keyboard.press('Control+d') // 複製
    await page.waitForTimeout(500)
    const dup = await v1Clips().count()
    assert(dup > n0, '複製できていない')
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(600)
    assert((await v1Clips().count()) === n0, '複製が戻っていない')
  })

  await check('元に戻す→やり直す をしても、素材が入れ替わらない', async () => {
    await resetProject()
    const names0 = await v1Clips().evaluateAll((els) => els.map((e) => e.textContent?.trim() ?? ''))
    await dragBy(v1Clips().nth(0), (await clipW()) * 0.4)
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(500)
    await page.keyboard.press('Control+y')
    await page.waitForTimeout(500)
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(600)
    const names1 = await v1Clips().evaluateAll((els) => els.map((e) => e.textContent?.trim() ?? ''))
    assert(
      JSON.stringify(names0) === JSON.stringify(names1),
      `素材が入れ替わった\n前: ${names0.join(' | ')}\n後: ${names1.join(' | ')}`
    )
  })

  await check('色を付けたまま保存して開き直すと、色が残っている', async () => {
    await resetProject()
    await v1Clips().nth(0).click({ button: 'right' })
    await page.waitForSelector('.ctx-menu')
    const sw = page.locator('.ctx-swatch:not(.ctx-swatch-none)').first()
    const want = await sw.evaluate((e) => getComputedStyle(e).backgroundColor)
    await sw.click()
    await page.waitForTimeout(500)
    const saved = join(outDir, 'colored.gcproj')
    await setDialogFiles([saved], saved)
    await page.locator('.menu-item', { hasText: 'ファイル' }).first().click()
    await page.locator('.menu-drop-item', { hasText: '別名で保存' }).first().click()
    await page.waitForTimeout(1500)
    await page.keyboard.press('Control+o')
    await page.waitForTimeout(500)
    const cont = page.locator('.modal-btn', { hasText: 'このまま続ける' })
    if (await cont.count()) await cont.click()
    await page.waitForSelector('[data-tid="V1"] .video-clip', { timeout: 15000 })
    await page.waitForTimeout(800)
    const got = await v1Clips().nth(0).evaluate((el) => getComputedStyle(el).backgroundColor)
    assert(got === want, `色が残っていない（${got} / 期待 ${want}）`)
  })

  // **再生ヘッドとタイムラインの横位置は、必ず一緒に戻る。**
  //
  // 前は横位置だけ起動直後に1回書いていた。その時点では中身の幅がまだ無いので
  // ブラウザが黙って0へ丸め、再生ヘッドだけ後から戻る＝
  // 「再生ヘッドは32秒、タイムラインは先頭」という食い違いが残っていた。
  // その状態だと、そこに置いた画像はプレビューに出るのにタイムラインには
  // 帯が無い（見えている範囲の帯しか作らないため）＝本人から上がった
  // 「タイムラインから消えている画像が、プレビューには出る」の正体。
  await check('前回の続きを開くと、タイムラインの横位置も戻る', async () => {
    await resetProject()
    const scroller = page.locator('.track-scroll').first()
    // 送れる幅が無いと、この確認は何も見ていないことになる。まず寄る
    const thumb = page.locator('.zoom-bar-thumb').first()
    const tb0 = await thumb.boundingBox()
    const knob = page.locator('.zbk-r').first()
    const kb = await knob.boundingBox()
    await page.mouse.move(kb.x + kb.width / 2, kb.y + kb.height / 2)
    await page.mouse.down()
    await page.mouse.move(tb0.x + tb0.width * 0.4, kb.y + kb.height / 2, { steps: 10 })
    await page.mouse.up()
    await page.waitForTimeout(600)
    const room = await scroller.evaluate((el) => el.scrollWidth - el.clientWidth)
    assert(room > 100, `準備が成立していない（送れる幅が ${Math.round(room)}px しかない）`)

    // 先頭から離れた所へ送る（スクロールの見張りが localStorage へ書く）
    const want = Math.round(room * 0.6)
    await scroller.evaluate((el, x) => el.scrollTo({ left: x }), want)
    await page.waitForTimeout(600)
    const sx0 = await scroller.evaluate((el) => Math.round(el.scrollLeft))
    assert(sx0 > 50, `送れていない（${sx0}）`)

    // **下書きを自分で置いてから開き直す。** 置かないと復元の箱が出ず、
    // 「テンプレートから始める」が出て中身が空になる（＝何も見ていないことになる）
    writeFileSync(
      join(fx.userData, 'giftcut-autosave.json'),
      readFileSync(fx.gcprojOrig, 'utf-8'),
      'utf-8'
    )
    await page.reload()
    await page.waitForSelector('.restore-btns', { timeout: 30000 })
    // **.first() を使わない。** 「1つ前の状態で復元」も『復元』を含むので、
    // それが出ている場面では先頭がそちらになる
    await page.locator('.restore-btns button', { hasText: '復元' }).last().click()
    // **クリップの帯を待ってはいけない。** 帯は見えている範囲にしか作らないので、
    // 横位置を戻した先に帯が無ければ永遠に出ない（それで30秒待って落ちた）。
    // 待つのは段そのもの
    await page.waitForSelector('[data-tid="V1"]', { timeout: 30000 })
    await page.waitForTimeout(2500) // 中身の幅が育つのを待つ（そこで初めて戻せる）
    const after = await page
      .locator('.track-scroll')
      .first()
      .evaluate((el) => ({
        sx: Math.round(el.scrollLeft),
        room: Math.round(el.scrollWidth - el.clientWidth)
      }))
    assert(
      Math.abs(after.sx - sx0) < 40,
      `横位置が戻っていない（${sx0} → ${after.sx}／送れる幅 ${room} → ${after.room}）`
    )
  })

  await check('下の拡大バーで、拡大縮小と移動ができる', async () => {
    // **拡大のつまみと横スクロールを1本にまとめた。**
    // 真ん中を掴めば移動、左右の●で拡大・縮小（プレミアと同じ形）。
    //
    // 見るのは3つ: 寄れる／戻せる（位置がずれない）／掴んで動かすと見る所が変わる。
    await resetProject()
    const bar = page.locator('.zoom-bar').first()
    const thumb = page.locator('.zoom-bar-thumb').first()
    assert(await bar.count(), '下の拡大バーが無い')
    assert((await page.locator('.tl-zoom input[type="range"]').count()) === 0,
      '古い拡大のつまみが残っている（2か所で操れる状態）')

    const innerX = async () => (await page.locator('.track-inner').boundingBox()).x
    const xs = async () => {
      const ix = await innerX()
      return (await clipLayout()).map((c) => Math.round(c.x - ix))
    }
    const before = await xs()
    const w0 = (await thumb.boundingBox()).width

    // 右の●を左へ引く＝見える範囲が狭まる＝寄る。
    // **いまの幅から相対で狭める。** ここへ来るまでの拡大率は前の項目次第なので、
    // 「バーの40%」のような決め打ちだと、元の方が狭いときに逆に広げてしまう
    // （実際にそれで赤くなった）。
    const tb0 = await thumb.boundingBox()
    const knob = page.locator('.zbk-r').first()
    const kb = await knob.boundingBox()
    const target = tb0.x + tb0.width * 0.5 // いまの半分の幅にする
    await page.mouse.move(kb.x + kb.width / 2, kb.y + kb.height / 2)
    await page.mouse.down()
    await page.mouse.move(target, kb.y + kb.height / 2, { steps: 10 })
    await page.mouse.up()
    await page.waitForTimeout(600)
    const w1 = (await thumb.boundingBox()).width
    assert(w1 < w0 - 2, `寄れていない（つまみ ${Math.round(w0)} → ${Math.round(w1)}px）`)
    const zoomed = await xs()
    assert(
      zoomed.every((x, i) => i === 0 || x > zoomed[i - 1]),
      '拡大したら順序が崩れた'
    )

    // 真ん中を掴んで右へ＝見る所が動く（拡大率は変わらない）
    const tb = await thumb.boundingBox()
    const wBefore = tb.width
    await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2)
    await page.mouse.down()
    await page.mouse.move(tb.x + tb.width / 2 + 60, tb.y + tb.height / 2, { steps: 8 })
    await page.mouse.up()
    await page.waitForTimeout(600)
    const moved = await page.locator('.zoom-bar-thumb').first().boundingBox()
    assert(moved.x > tb.x + 10, `掴んで動かしても見る所が変わらない（${Math.round(tb.x)} → ${Math.round(moved.x)}）`)
    assert(
      Math.abs(moved.width - wBefore) < 3,
      `移動なのに拡大率まで変わった（${Math.round(wBefore)} → ${Math.round(moved.width)}px）`
    )

    // 全体表示へ戻すと、元の位置関係に戻る
    await page.locator('.tool', { hasText: '↔' }).first().click()
    await page.waitForTimeout(600)
    const after = await xs()
    assert(after.length === before.length, 'クリップの数が変わった')
    assert(
      after.every((x, i) => i === 0 || x > after[i - 1]),
      `戻したら順序が崩れた（${after}）`
    )
  })

  // =========================================================================
}
