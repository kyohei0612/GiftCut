// アプリを触る道具。再生位置を移す・クリップの位置を測る・素材ビンから落とす。
//
// **e2e/run.mjs から出しただけ。中身は1文字も変えていない**（2026-08-03）。
// 借りているのは page / assert / v1Clips の3つだけで、数えたら切り出せる形だった。
//
// ## 章をまたいで同じ物を使う
//
// 1ファイルだった頃は前の章で作った物が後ろの章から見えていた。分けたら見えなくなり、
// 通しで6件が「定義されていない」で落ちた。**章をまたぐ物は run.mjs の C に載せる**
// （ここで作って、あちらが配る）。

/**
 * @param page    操作する画面
 * @param assert  条件が崩れたら止める
 * @param v1Clips 本編（V1）のクリップ一覧を返す関数
 */
export function makeAppHelpers(page, assert, v1Clips) {

  /** 秒を指定して再生位置を移す（拡大率に依存しない） */
  async function seekTo(sec) {
    const pps = (await clipW()) / 5 // クリップ1つ＝5秒
    const rb = await page.locator('.ruler').boundingBox()
    const inner = await page.locator('.track-inner').boundingBox()
    await page.mouse.click(inner.x + sec * pps, rb.y + rb.height / 2)
    await page.waitForTimeout(300)
  }
  /** クリップ1つぶんの幅（＝5秒）。拡大率が変わっても壊れないよう、距離はこれを基準にする。 */
  async function clipW() {
    const b = await v1Clips().nth(0).boundingBox()
    return b.width
  }
  /** クリップの左端の位置（px）と幅を並べたもの。移動の前後比較に使う。 */
  async function clipLayout() {
    const n = await v1Clips().count()
    const out = []
    for (let i = 0; i < n; i++) {
      const b = await v1Clips().nth(i).boundingBox()
      const t = (await v1Clips().nth(i).textContent()) ?? ''
      out.push({ x: Math.round(b.x), w: Math.round(b.width), text: t.trim() })
    }
    return out
  }

  // =========================================================================
  // ---- 章をまたいで使う道具 ----
  //
  // **1ファイルだった頃は、前の章で作った物が後ろの章から見えていた。**
  // 分けたら見えなくなり、通しで6件が「定義されていない」で落ちた。
  // 章をまたぐ物はここに置く（どの章からも同じ物が見える）。

  const setSlider = (row, v) =>
    page
      .locator('.sil-row', { hasText: row })
      .locator('input')
      .evaluate((el, val) => {
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          'value'
        ).set
        setter.call(el, String(val))
        el.dispatchEvent(new Event('input', { bubbles: true }))
      }, v)
  /** 無音カットを開いて、確認用の素材でも見つかる設定にしてから調べる */

  const trackHead = (id) => page.locator('.th', { has: page.locator('.th-name', { hasText: new RegExp(`^${id}$`) }) })

  async function binCardReady(name) {
    const card = page.locator('.media-card', { hasText: name }).first()
    if (await card.isVisible().catch(() => false)) return card
    // 素材ビンは種類ごとの折りたたみ（「▶ 画像（1）」など）。閉じているものを順に開く。
    for (const label of ['画像', 'SE', '音声', '動画']) {
      const acc = page.locator('.tpl-acc', { hasText: label })
      const cnt = await acc.count()
      for (let i = 0; i < cnt; i++) {
        const one = acc.nth(i)
        if (!(await one.isVisible().catch(() => false))) continue
        const cls = (await one.getAttribute('class')) ?? ''
        if (cls.includes('open')) continue
        await one.click()
        await page.waitForTimeout(200)
        if (await card.isVisible().catch(() => false)) return card
      }
    }
    assert(
      await card.isVisible().catch(() => false),
      `素材ビンに「${name}」が見当たらない（折りたたみを開けなかった）`
    )
    return card
  }

  async function dndFromBin(name, targetSel, offset = { x: 200, y: 10 }, mods = {}) {
    await binCardReady(name)
    // 掴む。DataTransfer は使い回す必要があるので window に置いておく
    // （毎回新しく作ると、アプリ側が掴んでいる素材を見失う）。
    await page.evaluate((name) => {
      const card = [...document.querySelectorAll('.media-card')].find((e) =>
        (e.textContent ?? '').includes(name)
      )
      if (!card) throw new Error('素材カードが見つからない: ' + name)
      window.__dt = new DataTransfer()
      card.dispatchEvent(
        new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: window.__dt })
      )
    }, name)
    // 重ねる
    const prevented = await page.evaluate(
      ({ targetSel, ox, oy, mods }) => {
        const el = document.querySelector(targetSel)
        if (!el) throw new Error('置き先が見つからない: ' + targetSel)
        const b = el.getBoundingClientRect()
        window.__dropAt = { x: b.x + ox, y: b.y + oy }
        const ev = new DragEvent('dragover', {
          bubbles: true,
          cancelable: true,
          clientX: window.__dropAt.x,
          clientY: window.__dropAt.y,
          dataTransfer: window.__dt,
          ...mods
        })
        el.dispatchEvent(ev)
        return ev.defaultPrevented
      },
      { targetSel, ox: offset.x, oy: offset.y, mods }
    )
    // アプリが掴んだものを認識しているか（置く予定の影が出ているか）で確かめる。
    // これが無いと、掴めていないのに「何も起きなかった＝合格」になってしまう。
    await page.waitForTimeout(250)
    const ghost = (await page.locator('.se-ghost').count()) > 0
    // 離す
    await page.evaluate(
      ({ targetSel, mods }) => {
        const el = document.querySelector(targetSel)
        el.dispatchEvent(
          new DragEvent('drop', {
            bubbles: true,
            cancelable: true,
            clientX: window.__dropAt.x,
            clientY: window.__dropAt.y,
            dataTransfer: window.__dt,
            ...mods
          })
        )
      },
      { targetSel, mods }
    )
    // 本物のブラウザは drop のあと掴んだ元へ dragend を飛ばす。後片付けまで同じにする
    await page.evaluate(() => {
      document
        .querySelector('.media-card')
        ?.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: window.__dt }))
    })
    await page.waitForTimeout(400)
    // **置いたら影は消えていること。** 消え残ると触れない破線の枠が段に居座り、
    // 「見覚えのない透明な枠」と映る（実際に言われた）。素材を落とす確認すべてが見張りになる
    const strayGhost = await page.locator('.se-ghost').count()
    assert(strayGhost === 0, `置いたのに「置き先の影」が ${strayGhost} 個残っている`)
    return { prevented, ghost }
  }

  async function placePiP() {
    const r = await dndFromBin('test_video', '[data-tid="V2"]', { x: 150, y: 10 })
    assert(r.ghost, '掴んだ動画の影が出なかった')
    await page.waitForTimeout(1800)
    const n = await page.locator('[data-tid="V2"] .clip:not(.se-ghost)').count()
    assert(n > 0, 'V2 に重ねた動画を置けなかった')
  }

  return {
    seekTo, clipW, clipLayout, setSlider, trackHead, binCardReady, dndFromBin, placePiP
  }
}
