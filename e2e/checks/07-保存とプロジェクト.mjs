// 起動時の配置・保存・プロジェクトの切り替え
//
// 章: 1・3. 起動直後と素材の配置 / 2. 保存とプロジェクトの切り替え
//
// **通しの本体は e2e/run.mjs から分けてある。** 1ファイル7,400行だと、
// 直したい章を探すのに毎回全部を読むことになり、足す場所も決まらないので
// 「仕上げ」に流れ込んでいた。道具（check・assert・素材づくり）は
// run.mjs 側に置いたままで、まとめて受け取る。

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'

export default async function (C) {
  const {
    dndFromBin,
    app,
    assert,
    check,
    clipLayout,
    clipW,
    dragBy,
    fx,
    outDir,
    page,
    resetProject,
    section,
    setDialogFiles,
    touchedRef,
    v1Clips,
  } = C
  section('1・3. 起動直後と素材の配置')
  await resetProject()

  await check('起動直後の画質設定が 1080p になっている', async () => {
    // **黙って低画質で始めない。** 何もしていないのに粗く見えているのが一番困る
    const v = await page.locator('.pq-preview').first().inputValue()
    assert(v === '1080', `画質設定が 1080p になっていない（${v}）`)
  })

  await check('効果音の「お気に入り」は最初から開いていて、フォルダを開いても畳まれない', async () => {
    // 実際に使うのはお気に入りがほとんど。1つだけ開く作りだと、
    // フォルダを見に行くたびにお気に入りが畳まれて、毎回開き直すことになる。
    await page.locator('.panel-tabs-strip').last().locator('.tab', { hasText: 'SE' }).first().click()
    await page.waitForTimeout(500)
    // 開いている節の見出し（.tpl-acc が見出しボタンそのもの）
    const openTitles = () =>
      page.evaluate(() =>
        [...document.querySelectorAll('.tpl-acc.open')].map((el) =>
          (el.textContent ?? '').slice(0, 24).trim()
        )
      )
    // **お気に入りは1件も無いと節ごと出ない。** 中身を出すため、まずフォルダを開く
    const folder = page.locator('.tpl-acc', { hasText: '📁' }).first()
    assert(await folder.count(), '効果音のフォルダが1つも無い')
    await folder.click()
    await page.waitForTimeout(600)
    // ★は**マウスを乗せるまで隠れている**（visibility: hidden）ので、先に乗せる
    const item = page.locator('.se-item').first()
    assert(await item.count(), 'フォルダを開いても効果音が出てこない')
    await item.hover()
    await page.waitForTimeout(200)
    await item.locator('.item-fav').first().click()
    await page.waitForTimeout(600)

    const after = await openTitles()
    // お気に入りは、できた瞬間から開いている
    assert(
      after.some((t) => t.includes('お気に入り')),
      `お気に入りが開いた状態で出てこない（開いている節: ${after.join(' / ') || 'なし'}）`
    )
    // **開いたフォルダも畳まれていない。** ここが本題
    // （1つだけ開く作りだと、お気に入りが出た時点でフォルダが閉じる）
    assert(
      after.some((t) => t.includes('📁')),
      `お気に入りが出たらフォルダが畳まれた（開いている節: ${after.join(' / ') || 'なし'}）`
    )
    // ★を戻す（次の項目に持ち越さない）
    const unstar = page.locator('.item-fav.on').first()
    if (await unstar.count()) await unstar.click()
    await page.waitForTimeout(300)
  })

  await check('タイムラインが中身の長さに収まっている（左端の小さな塊にならない）', async () => {
    const { content, view } = await page.evaluate(() => {
      const inner = document.querySelector('.track-inner').getBoundingClientRect()
      const scroll = document.querySelector('.track-scroll').getBoundingClientRect()
      const clips = [...document.querySelectorAll('[data-tid="V1"] .video-clip:not(.se-ghost)')]
      const last = clips[clips.length - 1].getBoundingClientRect()
      return { content: last.right - inner.x, view: scroll.width }
    })
    // 中身が画面幅の半分以上を占めていれば「収まっている」とみなす
    assert(content > view * 0.5, `中身が画面の左端に寄っている（${Math.round(content)} / ${Math.round(view)}）`)
  })

  await check('素材を追加しても、タイムラインには載らない', async () => {
    // **押すボタンのある所を自分で開く。**
    // 直前が SE タブを見たまま終わっていると、プロジェクトの「ファイル追加」が
    // 見つからずに落ちる（通しで実際に踏んだ）
    await page.locator('.panel-tabs-strip').last().locator('.tab', { hasText: 'プロジェクト' }).first().click()
    await page.waitForTimeout(400)
    const n0 = await v1Clips().count()
    await setDialogFiles([fx.video], null)
    await page.locator('button', { hasText: 'ファイル追加' }).first().click()
    await page.waitForTimeout(900)
    assert((await v1Clips().count()) === n0, '追加しただけでタイムラインに載った')
  })

  await check('ビンからドラッグして落とすと、その位置から始まる', async () => {
    await resetProject()
    const r = await dndFromBin('test_image', '[data-tid="V3"]', { x: 300, y: 10 })
    assert(r.ghost, '掴んだ素材の影が出なかった')
    await page.waitForTimeout(500)
    const imgs = await page.locator('[data-tid="V3"] .img-clip:not(.se-ghost)').all()
    assert(imgs.length >= 2, `落とした画像が増えていない（${imgs.length}）`)
    const boxes = await Promise.all(imgs.map((i) => i.boundingBox()))
    const inner = await page.locator('.track-inner').boundingBox()
    // 落とした位置（+300px）の近くから始まっているものがある
    assert(
      boxes.some((b) => Math.abs(b.x - (inner.x + 300)) < 25),
      `落とした位置から始まっていない（${boxes.map((b) => Math.round(b.x - inner.x)).join(',')}）`
    )
  })

  await check('動画を上から2段目に置くと、対の音声段に音が入って連動する', async () => {
    await resetProject()
    const r = await dndFromBin('test_video', '[data-tid="V2"]', { x: 200, y: 10 })
    assert(r.ghost, '掴んだ動画の影が出なかった')
    await page.waitForTimeout(1500)
    const v2 = await page.locator('[data-tid="V2"] .clip:not(.se-ghost)').count()
    const a2 = await page.locator('[data-tid="A2"] .clip:not(.se-ghost)').count()
    assert(v2 > 0, 'V2 に動画が置かれていない')
    assert(a2 > 0, '対の音声段（A2）に音が入っていない')
  })

  await check('お知らせが積み上がらず、多くても2つまでで消える', async () => {
    await resetProject()
    // わざと立て続けに操作してお知らせを何度も出す
    for (let i = 0; i < 4; i++) {
      await v1Clips().nth(0).click({ button: 'right' })
      await page.waitForSelector('.ctx-menu')
      await page.locator('.ctx-swatch:not(.ctx-swatch-none)').nth(i % 3).click()
      await page.waitForTimeout(120)
    }
    const n = await page.locator('.toast').count()
    assert(n <= 2, `お知らせが ${n} 件たまっている`)
    await page.waitForTimeout(3600)
    assert((await page.locator('.toast').count()) === 0, 'しばらく経ってもお知らせが消えない')
  })

  // =========================================================================
  section('2. 保存とプロジェクトの切り替え')
  await resetProject()

  await check('編集していると、落ちたときのための下書きが勝手に書かれる', async () => {
    // **ここが一番損害の大きい所。** 落ちて失うのは「最後に下書きを書いてから」の
    // ぶんなので、下書きが書かれていなければ作業まるごと消える。
    //
    // 戻す側（下書きがあれば復元できる）は別の項目で見ているが、
    // **アプリが自分で書いているか**は誰も見ていなかった。定期の書き込みが
    // 壊れても全部緑のまま通る＝空振り合格になる。
    //
    // 5分は待てないので、確認のときだけ間隔を縮められるようにしてある。
    const draft = join(fx.userData, 'giftcut-autosave.json')
    rmSync(draft, { force: true })
    await page.evaluate(() => localStorage.setItem('giftcut.autosaveMs', '1500'))
    await page.reload()
    await page.waitForSelector('.app', { timeout: 20000 })
    await page.waitForTimeout(2000)
    const cont = page.locator('.restore-btns button', { hasText: '復元' })
    if (await cont.count()) {
      await cont.first().click()
      await page.waitForTimeout(1200)
    }
    rmSync(draft, { force: true }) // 起動時に書かれた物は数えない

    await dragBy(v1Clips().nth(0), (await clipW()) * 0.3) // 何か編集する
    let wrote = false
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(500)
      if (existsSync(draft)) {
        wrote = true
        break
      }
    }
    assert(wrote, '編集しても下書きが書かれない（落ちたら全部消える）')
    const saved = JSON.parse(readFileSync(draft, 'utf-8'))
    assert(
      Array.isArray(saved.segments) && saved.segments.length > 0,
      `下書きの中身が空: ${Object.keys(saved).join(',')}`
    )
    touchedRef.dirty = true
  })

  await check('下書きが書けないときは、黙らずに知らせる', async () => {
    // 書けない理由（ディスクが一杯・ウイルス対策に止められている）は人によるので、
    // ここでは**書けなかったときの振る舞い**を見る。
    // 黙って失敗されると、落ちて初めて「下書きが無い」と分かる。
    //
    // 画面側の窓口（window.giftcut）は差し替えられない作りなので、**本物の失敗**を
    // 起こす: 書き込み先（一時ファイルの名前）をフォルダで塞ぐ。
    // ディスクが一杯・書き込みを止められている、と同じ結果になる。
    const blocker = join(fx.userData, 'giftcut-autosave.json.tmp')
    rmSync(blocker, { recursive: true, force: true })
    mkdirSync(blocker, { recursive: true })
    await dragBy(v1Clips().nth(0), (await clipW()) * 0.2)
    let shown = false
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(500)
      if ((await page.locator('.status-ng').count()) > 0) {
        shown = true
        break
      }
    }
    assert(shown, '下書きが書けないのに、画面のどこにも出ない')
    // 塞ぎを外すと、警告も消える（直ったのに出しっぱなしにしない）
    rmSync(blocker, { recursive: true, force: true })
    await dragBy(v1Clips().nth(0), (await clipW()) * 0.1)
    let cleared = false
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(500)
      if ((await page.locator('.status-ng').count()) === 0) {
        cleared = true
        break
      }
    }
    assert(cleared, '書けるようになっても警告が出たまま')
    // 間隔を元に戻す（以降の項目が1.5秒ごとに書き込むのを避ける）
    await page.evaluate(() => localStorage.removeItem('giftcut.autosaveMs'))
    touchedRef.dirty = true
  })

  await check('保存するとタイトルの「＊」が消える', async () => {
    // 見た目で確実に分かる編集をする（クリップを動かす）
    const before = await clipLayout()
    await dragBy(v1Clips().nth(0), (await clipW()) * 0.4)
    await page.waitForTimeout(600)
    const after = await clipLayout()
    assert(after[0].x > before[0].x + 5, '編集（クリップの移動）ができていない')
    // 「＊」は編集が止まってから見直される（以前の0.8秒ごとの総当たりをやめた）
    await page.waitForTimeout(600)
    const dirty = await page.locator('.modebar-title').first().textContent()
    assert(dirty.includes('*'), `編集したのに「＊」が出ていない: ${dirty.slice(0, 60)}`)
    // 開いているファイルへ上書き保存される（別名保存のダイアログは出ない）
    await page.keyboard.press('Control+s')
    await page.waitForTimeout(1600)
    const clean = await page.locator('.modebar-title').first().textContent()
    assert(!clean.includes('*'), `保存したのに「＊」が残っている: ${clean.slice(0, 60)}`)
  })

  await check('元に戻して保存時と同じ内容になれば「＊」も消える', async () => {
    // 「＊」は保存した内容と今の内容を直接くらべて決めている。
    // 変わった回数を数える作りにすると、元に戻しても「＊」が残ってしまう。
    const before = await clipLayout()
    await dragBy(v1Clips().nth(0), (await clipW()) * 0.3)
    await page.waitForTimeout(700)
    const dirty = await page.locator('.modebar-title').first().textContent()
    assert(dirty.includes('*'), `動かしたのに「＊」が出ていない: ${dirty.slice(0, 60)}`)

    await page.keyboard.press('Control+z')
    await page.waitForTimeout(700)
    const after = await clipLayout()
    assert(Math.abs(after[0].x - before[0].x) < 3, '元に戻せていない（位置が戻っていない）')
    const clean = await page.locator('.modebar-title').first().textContent()
    assert(!clean.includes('*'), `保存時と同じ内容なのに「＊」が残っている: ${clean.slice(0, 60)}`)
  })

  await check('保存すると「最近使ったプロジェクト」に増える', async () => {
    const fileMenu = page.locator('.menu-item', { hasText: 'ファイル' }).first()
    await fileMenu.click()
    await page.waitForTimeout(300)
    const items = await page.locator('.menu-drop-recent').allTextContents()
    assert(
      items.some((t) => t.includes('fixture.gcproj')),
      `開いて保存したファイルが一覧に出ていない: ${items.join(', ')}`
    )
    // Escape で閉じること自体を見る。閉じないと「閉じたつもり」で次へ渡り、
    // 見出しをもう一度押す動き（＝閉じる）と噛み合って、次の項目が
    // 「メニューに項目が無い」という別物の失敗になる（実際になった）。
    await page.keyboard.press('Escape')
    await page.waitForTimeout(250)
    const left = await page.locator('.menu-dropdown').count()
    assert(left === 0, 'Escape を押してもファイルメニューが閉じない')
  })

  await check('ファイルメニューから「更新で消えない置き場」を開ける', async () => {
    // 自動更新はアプリ本体を丸ごと入れ替えるが、userData の下は触らない。
    // **開く道が無いと、消えない場所があっても本人には無いのと同じ**なので見張る。
    //
    // **押しはしない。** 押すとエクスプローラの窓が本当に開いてしまう。
    // 行が出ていることと、配線（preload → main）が通っていることを別々に見る。
    await page.locator('.menu-item', { hasText: 'ファイル' }).first().click()
    await page.waitForTimeout(300)
    const rows = await page.locator('.menu-drop-item').allTextContents()
    for (const label of [
      '効果音（SE）のフォルダを開く',
      'テロップ素材のフォルダを開く',
      '動きのプリセットのフォルダを開く',
      'テンプレートのフォルダを開く',
      '設定・保存データのフォルダを開く'
    ]) {
      assert(rows.some((t) => t.includes(label)), `ファイルメニューに無い: ${label}`)
    }
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)
    // 知らない置き場は断る＝ハンドラが居る（開かずに配線だけ確かめられる）
    const bad = await page.evaluate(() => window.giftcut.openFolder('nope'))
    assert(bad?.ok === false, `知らない置き場を断っていない: ${JSON.stringify(bad)}`)
  })

  await check('右パネルの設定（お気に入り等）が、更新をまたいでも同じ場所に紐づく', async () => {
    // お気に入り・自作のテロップスタイル・人物・アイコンの割り当て・自分の動きは
    // **ファイルではなく画面側の保存領域（localStorage）**に入っている。
    // これは userData の下（Local Storage）にあるので更新では消えないが、
    // **紐づく先は「画面をどこから読み込んだか」で決まる**。
    //
    // いまは file:// ＝場所を含まない原点なので、入れ直しても引っ越しても同じ所を見る。
    // ここを独自の仕組み（app:// のような物）へ変えると、その更新の瞬間に
    // **利用者の設定が全部消える。しかも黙って消える。**
    // 変えるときに気づけるよう、ここで釘を打っておく。
    const origin = await page.evaluate(() => ({
      protocol: location.protocol,
      origin: location.origin
    }))
    assert(
      origin.protocol === 'file:',
      `画面の読み込み元が file:// ではない（${origin.protocol} / ${origin.origin}）` +
        '＝この更新で、お気に入りなど右パネルの設定が全部消える'
    )
    // 実際に書けて、読み直せること（保存領域そのものが死んでいないか）
    const rt = await page.evaluate(() => {
      try {
        localStorage.setItem('giftcut.e2e.probe', 'ok')
        const v = localStorage.getItem('giftcut.e2e.probe')
        localStorage.removeItem('giftcut.e2e.probe')
        return v
      } catch (e) {
        return String(e)
      }
    })
    assert(rt === 'ok', `画面側の保存領域が使えない（${rt}）`)
  })

  await check('お気に入りなど、いじった物がファイルにも残る（持ち出せる形で）', async () => {
    // 画面側の保存領域だけだと、**目に見えない・持ち出せない・仕組みを変えた瞬間に消える**。
    // 同じ内容をファイルにも書いておき、無ければそこから戻す。
    // ここでは「本当にファイルになるか」「そのファイルから戻せるか」を両方見る。
    const p = join(fx.userData, 'ユーザー設定.json')
    await page.evaluate(() => {
      localStorage.setItem('giftcut.seFavorites', JSON.stringify(['E2E_お気に入り']))
    })
    // 写しは変わったときに書かれる（間隔を置いているので少し待つ）
    for (let i = 0; i < 20 && !existsSync(p); i++) await page.waitForTimeout(500)
    let saved = null
    for (let i = 0; i < 20; i++) {
      if (existsSync(p)) {
        saved = JSON.parse(readFileSync(p, 'utf-8'))
        if (saved['giftcut.seFavorites']?.includes('E2E_お気に入り')) break
      }
      await page.waitForTimeout(500)
    }
    assert(existsSync(p), `控えのファイルができていない（${p}）`)
    assert(
      saved?.['giftcut.seFavorites']?.includes('E2E_お気に入り'),
      `お気に入りが控えに入っていない: ${JSON.stringify(saved)?.slice(0, 200)}`
    )
    // 中身は人が読める形（メモ帳で開いて確かめられること）
    assert(readFileSync(p, 'utf-8').includes('giftcut.seFavorites'), '控えが読める形になっていない')

    // **消えた状態から戻せるか。** ここが本番（更新・入れ直し・引っ越し）
    const back = await page.evaluate(async () => {
      localStorage.removeItem('giftcut.seFavorites')
      const r = await window.giftcut.readUserStore()
      const v = r?.data?.['giftcut.seFavorites']
      if (typeof v === 'string') localStorage.setItem('giftcut.seFavorites', v)
      return localStorage.getItem('giftcut.seFavorites')
    })
    assert(
      back?.includes('E2E_お気に入り'),
      `控えから戻せない（${back}）＝更新や入れ直しで設定が失われる`
    )
  })

  await check('更新で再起動したときは、復元を聞かずに続きから開く', async () => {
    // **勝手に閉じておいて「復元しますか？」と聞くのは筋が通らない。**
    // 更新のために自分で落としたときは、黙って続きから開いて、そう伝える。
    // 印（resumeAfterUpdate）が効いているかを、実際に開き直して見る。
    await resetProject()
    // 下書きを作る（更新前に書かれる物と同じ）
    await page.locator('.telop-clip').first().click()
    await page.waitForTimeout(300)
    await page.keyboard.press('Control+s').catch(() => {})
    await page.waitForTimeout(300)
    const wrote = await page.evaluate(async () => {
      const json = JSON.stringify({
        cues: [{ id: 1, start: 1, end: 3, text: 'E2E_更新後の続き', style: {} }],
        segments: [],
        seClips: []
      })
      await window.giftcut.autosaveProject(json)
      localStorage.setItem('giftcut.resumeAfterUpdate', '1')
      return true
    })
    assert(wrote, '下書きを書けない')
    await page.reload()
    await page.waitForSelector('.app', { timeout: 30000 })
    await page.waitForTimeout(2500)
    // 復元を聞かれないこと
    assert(
      (await page.locator('.restore-box').count()) === 0,
      '更新後なのに「復元しますか」と聞いている'
    )
    // 続きが開いていること
    const txt = await page.locator('.telop-clip').allTextContents()
    assert(
      txt.some((t) => t.includes('E2E_更新後の続き')),
      `続きから開いていない: ${JSON.stringify(txt)}`
    )
    // 印は使い切りであること（残ると、次に落ちたとき黙って読み込んでしまう）
    const flag = await page.evaluate(() => localStorage.getItem('giftcut.resumeAfterUpdate'))
    assert(flag === null, '更新の印が残っている（次の起動でも復元を聞かなくなる）')
    touchedRef.dirty = true
    await resetProject()
  })

  await check('保存したプロジェクトは、そのファイルから開き直しても中身が残っている', async () => {
    // **「保存したつもり」が一番損害が大きい。**
    // 書けているか・開けるか・開いたあとも同じ中身か・ファイルが残っているかを
    // 通しで見る（保存の直後だけ見ても、開き直しで落ちる型の事故は見つからない）。
    await resetProject()
    const out = join(outDir, '保存して開き直す.gcproj')
    await page.locator('.telop-clip').first().click()
    await page.waitForTimeout(300)
    await setDialogFiles(null, out)
    // 「別名で保存」はファイルメニューから（Ctrl+S は開いているファイルへ上書き）
    await page.locator('.menu-item', { hasText: 'ファイル' }).first().click()
    await page.waitForTimeout(300)
    await page.locator('.menu-drop-item', { hasText: '別名で保存' }).first().click()
    await page.waitForTimeout(2500)
    assert(existsSync(out), `保存できていない（${out}）`)
    const before = JSON.parse(readFileSync(out, 'utf-8'))
    const nCue = (before.cues ?? []).length
    const nSeg = (before.segments ?? []).length
    assert(nCue > 0, '保存した中身にテロップが入っていない')

    // いったん別の状態にしてから、そのファイルを開く
    await resetProject()
    await setDialogFiles([out], null)
    await page.keyboard.press('Control+o')
    await page.waitForTimeout(2500)
    const cont = page.locator('.modal-btn', { hasText: 'このまま続ける' })
    if (await cont.count()) {
      await cont.click()
      await page.waitForTimeout(1500)
    }
    const shown = await page.locator('.telop-clip').count()
    assert(shown === nCue, `開き直したらテロップの数が違う（${nCue} → ${shown}）`)
    const segs = await v1Clips().count()
    assert(segs === nSeg || nSeg === 0, `開き直したら切片の数が違う（${nSeg} → ${segs}）`)

    // **開いたあともファイルが残っていること。**（開くときに壊す/消す事故を見る）
    assert(existsSync(out), '開いたらプロジェクトファイルが消えた')
    const after = JSON.parse(readFileSync(out, 'utf-8'))
    assert(
      (after.cues ?? []).length === nCue,
      `開いただけで中身が変わった（${nCue} → ${(after.cues ?? []).length}）`
    )
    touchedRef.dirty = true
    await resetProject()
  })

  await check('SE は、パネルから足せて、その場で一覧に出る', async () => {
    // **一覧に「ここへ入れて」と書くだけでは入口になっていない。**
    // まっさらな SE タブには、そこから辿れるボタンが1つも無かった
    // （あるのは「フォルダ作成」＝中身の無い分類箱と「更新」だけ）。
    // ここで見るのは「足す口がある」ことと「足したら使える」ことの2つ。
    await resetProject()
    await page.locator('.panel-tabs .tab', { hasText: 'SE' }).last().click()
    await page.waitForTimeout(500)
    const bar = page.locator('.bin-toolbar').last()
    const labels = await bar.locator('button').allTextContents()
    assert(
      labels.some((t) => t.includes('音を追加')),
      `SE タブに足す口が無い（${labels.join(' / ')}）`
    )
    // **並び順まで見る。** 物が1つも無いのに「分類を作る」が先頭だと、
    // 最初にやりたいこと（入れる）へ辿り着けない
    const iAdd = labels.findIndex((t) => t.includes('音を追加'))
    const iFolder = labels.findIndex((t) => t.includes('フォルダ作成'))
    assert(
      iAdd >= 0 && (iFolder < 0 || iAdd < iFolder),
      `足す口より先に「フォルダ作成」が居る（${labels.join(' / ')}）`
    )

    // ファイルを1つ足すと、その場で一覧に出ること
    const before = await page.evaluate(async () => {
      const r = await window.giftcut.listSE()
      return (r?.items ?? []).length
    })
    const r = await page.evaluate((p) => window.giftcut.importSe([p]), fx.sound)
    assert(r?.ok, `足せない: ${JSON.stringify(r)}`)
    assert(existsSync(join(fx.userData, 'SE')), '置き場に入っていない')
    const after = await page.evaluate(async () => {
      const rr = await window.giftcut.listSE()
      return (rr?.items ?? []).length
    })
    assert(after > before, `足したのに一覧が増えない（${before} → ${after}）`)

    // **同じ物を2回足しても、上書きで消えないこと**（消えたと思われるのが一番困る）
    await page.evaluate((p) => window.giftcut.importSe([p]), fx.sound)
    const after2 = await page.evaluate(async () => {
      const rr = await window.giftcut.listSE()
      return (rr?.items ?? []).length
    })
    assert(after2 > after, `2回目が上書きされている（${after} → ${after2}）`)

    // 音でない物は断る（何を入れても入る、にしない）
    const bad = await page.evaluate((p) => window.giftcut.importSe([p]), fx.image)
    assert(bad?.ok === false, '画像まで SE に入れてしまう')
    touchedRef.dirty = true
    // **見ていたタブを戻す。** SE タブに置いたまま抜けると、次の項目が
    // プロジェクトのボタンを探して見つけられない（通しで23件が巻き添えになった）
    await resetProject()
  })

  await check('テンプレートを開く画面から、自分で作ったぶんを消せる', async () => {
    // 作ったはいいが**消す道が無い**と、増える一方で選べなくなる。
    // ただし**同梱のテンプレートは消させない**（消しても更新で戻るし、
    // 書き込みできない場所のこともある）。両方をここで見る。
    await resetProject()
    // 利用者のテンプレートは userData に居る（配った先では常にここ）。
    // 開発中の書き込み先はリポジトリ側なので、本番と同じ場所へ直接置いて見る。
    const made = join(fx.userData, 'テンプレート', 'E2E_消せるテンプレ.gcproj')
    mkdirSync(join(fx.userData, 'テンプレート'), { recursive: true })
    writeFileSync(made, JSON.stringify({ cues: [], segments: [] }), 'utf-8')
    assert(existsSync(made), `テンプレートを置けない（${made}）`)

    // 画面から消せること
    await page.locator('.menu-item', { hasText: 'ファイル' }).first().click()
    await page.waitForTimeout(300)
    await page.locator('.menu-drop-item', { hasText: 'テンプレートを開く' }).first().click()
    await page.waitForTimeout(800)
    const row = page.locator('.tpl-picker-row', { hasText: 'E2E_消せるテンプレ' }).first()
    assert(await row.count(), '作ったテンプレートが一覧に出ていない')
    const del = row.locator('.tpl-picker-del')
    assert(await del.count(), '消すボタンが無い')
    // **一発では消えない**（押し間違いで消えると作り直すしかない）
    await del.click()
    await page.waitForTimeout(200)
    assert(existsSync(made), '1回押しただけで消えてしまった')
    assert(
      (await del.innerText()).includes('消す'),
      `1回目で確認の見た目にならない（「${await del.innerText()}」）`
    )
    await del.click()
    await page.waitForTimeout(800)
    assert(!existsSync(made), '2回押しても消えていない')

    // フォルダを開くボタンが出ていること（一覧に無い物を足す道）
    const picker = page.locator('.restore-box')
    if (await picker.count()) {
      const txt = await picker.innerText()
      assert(
        txt.includes('フォルダを開く') || (await page.locator('.tpl-picker-row').count()) === 0,
        'テンプレートの置き場を開く道が無い'
      )
    }
    // **窓は必ず閉じる。** Escape では閉じない作りなので、閉じるボタンを押す
    //（開けっぱなしだと画面全体を覆い、次の項目が何も押せなくなる）
    const closeBtn = page.locator('.restore-btns button', { hasText: /閉じる|空で始める/ })
    if (await closeBtn.count()) await closeBtn.first().click()
    await page.waitForTimeout(400)

    // **同梱のテンプレートは消せない**（置き場の外を消す穴にしない）
    const bad = await page.evaluate(async () => {
      const list = await window.giftcut.listTemplates()
      const bundled = (list?.items ?? []).find((t) => !t.path.includes('AppData'))
      if (!bundled) return { skipped: true }
      const r = await window.giftcut.deleteTemplate(bundled.path)
      return { ok: r?.ok, path: bundled.path }
    })
    if (!bad.skipped) {
      assert(bad.ok === false, `同梱のテンプレートを消せてしまう（${bad.path}）`)
      assert(existsSync(bad.path), '同梱のテンプレートが消えた')
    }
    touchedRef.dirty = true
    await resetProject()
  })

  await check('素材パック（ZIP）を選ぶだけで、置き場へまとめて入る', async () => {
    // 「開いて・展開して・貼る」は手順が3つあり、**どれか1つ間違えても
    // 何も起きないだけ**なので、間違いに気づけない。ZIP を選ぶだけで済ませる。
    const zip = join(outDir, 'assets.zip')
    const stage = join(outDir, 'assets-src')
    mkdirSync(join(stage, 'telop-presets'), { recursive: true })
    mkdirSync(join(stage, 'motion-presets'), { recursive: true })
    writeFileSync(
      join(stage, 'telop-presets', 'pack.json'),
      JSON.stringify([{ name: 'E2E_パックの素材', style: { fontSize: 60 } }]),
      'utf-8'
    )
    writeFileSync(
      join(stage, 'motion-presets', 'pack.json'),
      JSON.stringify([{ name: 'E2E_パックの動き', motion: { tx: [{ t: 0, v: 10 }, { t: 0.3, v: 0 }] } }]),
      'utf-8'
    )
    // ZIP を作る（PowerShell の Compress-Archive を使う。ここは中身より結果が大事）
    const ps = spawn('powershell', [
      '-NoProfile',
      '-Command',
      `Compress-Archive -Path '${join(stage, '*')}' -DestinationPath '${zip}' -Force`
    ])
    await new Promise((res) => ps.on('close', res))
    assert(existsSync(zip), 'ZIP を作れなかった（この項目の準備が失敗）')

    const r = await page.evaluate((z) => window.giftcut.importAssetZip(z), zip)
    assert(r?.ok, `取り込めない: ${JSON.stringify(r)}`)
    assert(r.added?.['telop-presets'] >= 1, `テロップ素材が入っていない: ${JSON.stringify(r.added)}`)
    assert(r.added?.['motion-presets'] >= 1, `動きが入っていない: ${JSON.stringify(r.added)}`)
    // **置き場に本当に入っていること**（返事だけ ok なのが一番たちが悪い）
    assert(
      existsSync(join(fx.userData, 'telop-presets', 'pack.json')),
      '置き場にファイルが無い＝入ったことになっているだけ'
    )
    // **入れた種類が全部その場で使えること。**
    // 1種類でも読み飛ばすと、そこだけ再起動するまで出てこない
    //（「入れました」と言われたのに見当たらない、が起きる）
    const hit = await page.evaluate(async () => {
      const a = await window.giftcut.listTelopPresets()
      const b = await window.giftcut.listMotionPresets()
      return {
        telop: (a?.items ?? []).some((x) => x && x.name === 'E2E_パックの素材'),
        motion: (b?.items ?? []).some((x) => x && x.name === 'E2E_パックの動き')
      }
    })
    assert(hit.telop, 'テロップ素材が一覧へ出てこない')
    assert(hit.motion, '動きが一覧へ出てこない')

    // 知らない物は撒かない（受け取った ZIP を無条件に展開しない）
    const stray = join(outDir, 'stray.zip')
    mkdirSync(join(outDir, 'stray-src'), { recursive: true })
    writeFileSync(join(outDir, 'stray-src', 'あやしい.txt'), 'x', 'utf-8')
    const ps2 = spawn('powershell', [
      '-NoProfile',
      '-Command',
      `Compress-Archive -Path '${join(outDir, 'stray-src', '*')}' -DestinationPath '${stray}' -Force`
    ])
    await new Promise((res) => ps2.on('close', res))
    const r2 = await page.evaluate((z) => window.giftcut.importAssetZip(z), stray)
    assert(r2?.ok === false, '素材の入っていない ZIP を受け入れてしまう')
    assert(
      !existsSync(join(fx.userData, 'あやしい.txt')),
      '知らないファイルを置き場へ撒いている'
    )
    // **入れた物は片付ける。**
    // 置き場は次の項目とも共有なので、残すと件数を数えている項目が狂う
    //（実際、動きの見本帳の件数が1件ずれて通しで落ちた）
    for (const f of [
      join(fx.userData, 'motion-presets', 'pack.json'),
      join(fx.userData, 'telop-presets', 'pack.json')
    ])
      rmSync(f, { force: true })
    await page.evaluate(() => window.giftcut.listMotionPresets())
  })

  await check('自分で足したテロップ素材は、更新で消えない場所から読まれる', async () => {
    // **自動更新はアプリのフォルダを丸ごと入れ替える。**
    // 読む場所が userData の外へ移ると、更新した瞬間に利用者の素材が消える
    // ——しかも消えたことに気づくのは、次に使おうとした時。
    // 「置き場を開く」の行があるかは別の項目で見ているので、ここでは
    // **その場所に置いた物が本当に読まれるか**を見る。
    const dir = join(fx.userData, 'telop-presets')
    mkdirSync(dir, { recursive: true })
    const mark = 'E2E_更新で消えない'
    writeFileSync(
      join(dir, 'e2e-keep.json'),
      JSON.stringify([{ name: mark, style: { fontSize: 64, color: '#fff' } }]),
      'utf-8'
    )
    const got = await page.evaluate(async (mark) => {
      const r = await window.giftcut.listTelopPresets()
      const items = (r?.items ?? []).map((x) => (x && typeof x === 'object' ? x.name : ''))
      return { ok: !!r?.ok, hit: items.includes(mark), n: items.length }
    }, mark)
    assert(
      got.hit,
      `userData/telop-presets に置いた素材が読まれない（${got.n}件・ok=${got.ok}）` +
        '＝更新でユーザーの素材が消える置き場になっている疑い'
    )
  })

  await check('取り消せない操作の実行ボタンが赤い', async () => {
    await setDialogFiles([fx.srt], null)
    await page.locator('button', { hasText: 'SRT読込' }).first().click()
    await page.waitForSelector('.modal-box')
    const danger = await page.locator('.modal-btn.danger').count()
    assert(danger > 0, '置き換えのボタンが赤（danger）になっていない')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    assert((await page.locator('.modal-box').count()) === 0, 'Escape で確認を中止できない')
  })

  // =========================================================================
}
