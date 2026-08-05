// 保存と下書き（落ちたときの備え・「＊」・最近使った・更新で消えない置き場）。
//
// `07-保存とプロジェクト.mjs` から出した（決まり: 600超は500以下に割る）。
// 章「2. 保存とプロジェクトの切り替え」を名乗るのはここ。入口は ./07-保存とプロジェクト.mjs

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'

export default async function (C) {
  const {
    app, assert, check, clipLayout, clipW, dndFromBin, dragBy, fx, outDir, page,
    resetProject, section, setDialogFiles, touchedRef, v1Clips
  } = C
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

}
