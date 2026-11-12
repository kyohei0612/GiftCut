// カット・元に戻す・クリップの色分け
//
// 章: 4. カットとキー操作の続き / 12. 元に戻す・やり直す / 15. クリップの色分け
//
// **通しの本体は e2e/run.mjs から分けてある。** 1ファイル7,400行だと、
// 直したい章を探すのに毎回全部を読むことになり、足す場所も決まらないので
// 「仕上げ」に流れ込んでいた。道具（check・assert・素材づくり）は
// run.mjs 側に置いたままで、まとめて受け取る。

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import mediaUndo from './05b-素材の出し入れを戻す.mjs'

export default async function (C) {
  const {
    clipW,
    assert,
    check,
    clipLayout,
    dndFromBin,
    dragBy,
    fx,
    near,
    page,
    resetProject,
    section,
    seekTo,
    setDialogFiles,
    touchedRef,
    v1Clips,
  } = C

  section('4. カットとキー操作の続き')
  await resetProject()
  // クリップ1つぶんの幅（5秒）。章をまたいで持ち回さず、その場で測る。
  // **開き直したあとで測る**（2026-08-07）。前は resetProject より先に測っていて、
  // 「前の章が帯を残している」に黙って寄りかかっていた——前の章が空で終わると、
  // 章そのものが「実行に失敗」で落ちる（項目が1つも走らない）
  const W = await clipW()

  await check('C でカッター、V で矢印に戻る', async () => {
    await page.keyboard.press('c')
    await page.waitForTimeout(150)
    let cls = await page.locator('.track-inner').getAttribute('class')
    const razorOn = await page.locator('.tool.tool-on').evaluateAll((els) =>
      els.some((e) => (e.textContent ?? '').includes('✂'))
    )
    assert(razorOn, 'C でカッターにならない')
    await page.keyboard.press('v')
    await page.waitForTimeout(150)
    const stillRazor = await page.locator('.tool.tool-on').evaluateAll((els) =>
      els.some((e) => (e.textContent ?? '').includes('✂'))
    )
    assert(!stillRazor, 'V で矢印に戻らない')
    void cls
  })

  await check('Ctrl+K で再生位置にカットが入る', async () => {
    await seekTo(7) // 2番目のクリップの真ん中
    const n0 = await v1Clips().count()
    await page.keyboard.press('Control+k')
    await page.waitForTimeout(400)
    const n1 = await v1Clips().count()
    assert(n1 === n0 + 1, `カットが増えていない（${n0} → ${n1}）`)
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(300)
  })

  await check('D は「消すだけ」— 後ろのクリップも文字も動かない', async () => {
    await resetProject()
    const before = await clipLayout()
    assert((await page.locator('.telop-clip').count()) === 2, '文字が2つある状態から始められていない')
    const cue0 = await page.locator('.telop-clip').last().boundingBox()
    await v1Clips().nth(0).click()
    await page.keyboard.press('d')
    await page.waitForTimeout(500)
    const after = await clipLayout()
    assert(after.length === before.length - 1, `クリップが1つ減っていない（${before.length} → ${after.length}）`)
    // 残ったクリップは1ミリも動かない
    near(after[0].x, before[1].x, 2, '後ろのクリップが前へ詰まってしまった')
    const cue1 = await page.locator('.telop-clip').last().boundingBox()
    near(cue1.x, cue0.x, 2, '文字が動いてしまった')
    // 消した所は「空き」として残り、クリックできる
    assert((await page.locator('[data-tid="V1"] .gap-clip').count()) > 0, '空きが残っていない')
  })

  await check('F は「消して詰める」— 後ろが前へ寄る', async () => {
    await resetProject()
    const before = await clipLayout()
    assert((await page.locator('.telop-clip').count()) === 2, '文字が2つある状態から始められていない')
    const cue0 = await page.locator('.telop-clip').last().boundingBox()
    await v1Clips().nth(0).click()
    await page.keyboard.press('f')
    await page.waitForTimeout(500)
    const after = await clipLayout()
    assert(after.length === before.length - 1, 'クリップが1つ減っていない')
    near(after[0].x, before[0].x, 2, '先頭に詰まっていない')
    assert((await page.locator('[data-tid="V1"] .gap-clip').count()) === 0, '詰めたのに空きが残っている')
    const cue1 = await page.locator('.telop-clip').last().boundingBox()
    assert(cue1.x < cue0.x - 5, '文字が一緒に前へ寄っていない')
  })

  await check('D と Delete と Backspace が同じ動きをする', async () => {
    const trial = async (key) => {
      const n0 = await v1Clips().count()
      await v1Clips().nth(0).click()
      await page.keyboard.press(key)
      await page.waitForTimeout(400)
      const n1 = await v1Clips().count()
      await page.keyboard.press('Control+z')
      await page.waitForTimeout(400)
      return n0 - n1
    }
    const d = await trial('d')
    const del = await trial('Delete')
    const bs = await trial('Backspace')
    assert(d === del && del === bs, `減り方が違う（D:${d} Delete:${del} Backspace:${bs}）`)
  })

  await check('複数のクリップを選んでまとめて動かせる', async () => {
    await resetProject()
    const before = await clipLayout()
    await v1Clips().nth(1).click()
    await v1Clips().nth(2).click({ modifiers: ['Control'] })
    await page.waitForTimeout(200)
    await dragBy(v1Clips().nth(1), W * 0.6)
    const after = await clipLayout()
    assert(after.length >= before.length, 'クリップが消えた')
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(400)
  })

  // =========================================================================
  section('12. 元に戻す・やり直す')
  await resetProject()

  await check('動かす → Ctrl+Z で戻る → Ctrl+Y でやり直せる', async () => {
    const before = await clipLayout()
    await dragBy(v1Clips().nth(0), W * 0.8)
    const moved = await clipLayout()
    assert(moved[0].x > before[0].x + 5, '動かせていない')
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(400)
    const undone = await clipLayout()
    near(undone[0].x, before[0].x, 2, 'Ctrl+Z で戻っていない')
    assert(undone.length === before.length, 'クリップ数が戻っていない')
    await page.keyboard.press('Control+y')
    await page.waitForTimeout(400)
    const redone = await clipLayout()
    assert(redone[0].x > before[0].x + 5, 'Ctrl+Y でやり直せていない')
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(400)
  })

  await check('Ctrl+Shift+Z でもやり直せる', async () => {
    const base = await clipLayout()
    await dragBy(v1Clips().nth(0), 130)
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(400)
    await page.keyboard.press('Control+Shift+z')
    await page.waitForTimeout(400)
    const after = await clipLayout()
    assert(after[0].x > base[0].x + 5, 'Ctrl+Shift+Z でやり直せない')
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(400)
  })

  // ---- 戻す・やり直すの総当たり（2026-11-12・本人「一番見るのはやり直しが効かない挙動」）----
  //
  // 帯の位置ではなく**プロジェクトの中身そのもの**を比べる（履歴が控える9項目。
  // 読む口は state/useAutosaveDraft の `__gcProjectJson`）。操作を1つずつ
  // 「やる → 戻す → やり直す」して、戻したら元と一字一句同じか・やり直したら同じかを見る。
  // 1つずつやるのは、**どの操作が悪いかを名指しするため**（続けてやると最初の1つで全部ずれる）
  const HIST_KEYS = ['cues', 'segments', 'seClips', 'markers', 'imgClips', 'vClips', 'tracks', 'trackStates', 'ratio']
  const histSnap = () =>
    page.evaluate((keys) => {
      const d = JSON.parse(window.__gcProjectJson())
      return Object.fromEntries(keys.map((k) => [k, JSON.stringify(d[k])]))
    }, HIST_KEYS)
  const histDiff = (a, b) => HIST_KEYS.filter((k) => a[k] !== b[k])
  const menuItem = async (loc, text) => {
    await loc.click({ button: 'right' })
    await page.waitForSelector('.ctx-menu')
    await page.locator('.ctx-menu').getByText(text, { exact: false }).first().click()
  }
  const telop = () => page.locator('.telop-clip')
  const HIST_OPS = [
    ['本編を掴んで動かす', () => dragBy(v1Clips().nth(0), 130)],
    ['再生位置にカットを入れる', async () => { await seekTo(7); await page.keyboard.press('Control+k') }],
    ['テロップを消す', async () => { await telop().first().click(); await page.keyboard.press('Delete') }],
    ['テロップを掴んで動かす', () => dragBy(telop().first(), 60)],
    ['テロップを足す', async () => { await seekTo(12); await page.keyboard.press('t'); await page.waitForTimeout(300); await page.keyboard.press('Escape') }],
    ['めじるしを足す', async () => { await seekTo(3); await page.keyboard.press('m') }],
    ['本編に色を付ける', async () => {
      await v1Clips().nth(1).click({ button: 'right' })
      await page.waitForSelector('.ctx-menu')
      await page.locator('.ctx-swatch:not(.ctx-swatch-none)').nth(2).click()
    }],
    ['本編を複製する', async () => { await v1Clips().nth(1).click(); await page.keyboard.press('Control+d') }],
    ['離れた本編を2本複製する', async () => {
      await v1Clips().nth(0).click()
      await v1Clips().nth(2).click({ modifiers: ['Control'] })
      await page.keyboard.press('Control+d')
    }],
    ['本編のコピーを先頭に並べる', () => menuItem(v1Clips().nth(1), 'コピーを先頭に並べる')],
    ['本編を消して詰める', async () => { await v1Clips().nth(0).click(); await page.keyboard.press('f') }],
    ['本編を消す（空きが残る）', async () => { await v1Clips().nth(1).click(); await page.keyboard.press('Delete') }],
    ['効果音を複製する', async () => { await page.locator('.se-clip').first().click(); await page.keyboard.press('Control+d') }],
    ['効果音を掴んで動かす', () => dragBy(page.locator('.se-clip').first(), 80)],
    ['画像を消す', async () => { await page.locator('.img-clip:not(.se-ghost)').first().click(); await page.keyboard.press('Delete') }],
    ['全部選んで消して詰める', async () => { await page.keyboard.press('Control+a'); await page.keyboard.press('f') }]
  ]

  await check('どの操作も、戻すと元と同じ中身になり、やり直すと同じ中身になる（1つずつ）', async () => {
    const bad = []
    for (const [name, run] of HIST_OPS) {
      await resetProject()
      touchedRef.dirty = true // 次の操作も必ずまっさらから始める
      const a = await histSnap()
      await run()
      await page.waitForTimeout(800) // 履歴は 450ms でまとまる
      const b = await histSnap()
      if (!histDiff(a, b).length) {
        bad.push(`${name}: 操作しても中身が変わらない（準備が成立していない）`)
        continue
      }
      await page.keyboard.press('Control+z')
      await page.waitForTimeout(500)
      const u = histDiff(a, await histSnap())
      if (u.length) bad.push(`${name}: 戻しても元に戻らない（違う項目: ${u.join(', ')}）`)
      await page.keyboard.press('Control+y')
      await page.waitForTimeout(500)
      const r = histDiff(b, await histSnap())
      if (r.length) bad.push(`${name}: やり直しても同じにならない（違う項目: ${r.join(', ')}）`)
    }
    assert(!bad.length, `戻す・やり直すが合わない操作が ${bad.length} 件:\n        ` + bad.join('\n        '))
  })

  // **値を入れた・選んだ直後は、フォーカスがその欄に残る。** 前はそこで Ctrl+Z が欄に吸われて
  // 何も起きなかった（別の所を押すまで戻せない）。決まりは shared/keymap の
  // isChoiceControl / blursOnEnter。**どこも押さずにそのまま Ctrl+Z する**のが要点
  await check('数値を入れて Enter した直後・フォントを選んだ直後に、そのまま Ctrl+Z で戻せる', async () => {
    await resetProject()
    await seekTo(2)
    await page.waitForTimeout(300)
    await telop().first().click()
    await page.waitForTimeout(400)
    const a = await histSnap()
    // フォント（ドロップダウン）
    const sel = page.locator('select.sp-select').first()
    assert(await sel.count(), 'フォントのドロップダウンが無い')
    const cur = await sel.inputValue()
    const other = await sel.locator('option').evaluateAll((os, c) => os.map((o) => o.value).find((v) => v !== c), cur)
    await sel.selectOption(other)
    await sel.focus() // 選んだ直後の状態（フォーカスは残る）
    await page.waitForTimeout(800)
    assert(histDiff(a, await histSnap()).includes('cues'), 'フォントを変えても中身が変わらない（準備が成立していない）')
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(500)
    assert(!histDiff(a, await histSnap()).length, 'フォントを選んだ直後の Ctrl+Z で戻らない（欄に吸われている）')
    // 縁取りの太さ（数値欄）→ Enter → そのまま Ctrl+Z
    const num = page
      .locator('.sp-row')
      .filter({ has: page.locator('.sp-color[title="縁の色"]') })
      .first()
      .locator('input.sp-num')
      .first()
    assert(await num.count(), '縁取りの太さの入力が無い')
    await num.fill(String((Number(await num.inputValue()) || 5) + 7))
    await num.press('Enter')
    await page.waitForTimeout(800)
    assert(histDiff(a, await histSnap()).includes('cues'), '太さを変えても中身が変わらない（準備が成立していない）')
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(500)
    assert(!histDiff(a, await histSnap()).length, '数値を入れて Enter した直後の Ctrl+Z で戻らない（欄に吸われている）')
  })

  // **何も変えていないのに履歴が積まれる**と、Ctrl+Z を押しても何も起きない「空振り」が挟まる。
  // 履歴は「配列が別物になったか」で積むので、中身が同じでも作り直すだけで1手になる
  await check('選ぶ・再生位置を動かす・品書きを開いて閉じるだけでは、戻す手が増えない', async () => {
    const canUndo = () => page.locator('button.tool[title^="元に戻す"]').first().isEnabled()
    const idle = [
      ['本編を選ぶ', () => v1Clips().nth(1).click()],
      ['テロップを選ぶ', () => telop().first().click()],
      ['効果音を選ぶ', () => page.locator('.se-clip').first().click()],
      ['画像を選ぶ', () => page.locator('.img-clip:not(.se-ghost)').first().click()],
      ['全部選んで外す', async () => { await page.keyboard.press('Control+a'); await page.keyboard.press('Escape') }],
      ['再生位置を動かす', () => seekTo(8)],
      ['品書きを開いて閉じる', async () => {
        await v1Clips().nth(0).click({ button: 'right' })
        await page.waitForSelector('.ctx-menu')
        await page.keyboard.press('Escape')
      }],
      ['再生して止める', async () => { await page.keyboard.press('Space'); await page.waitForTimeout(600); await page.keyboard.press('Space') }]
    ]
    const bad = []
    for (const [name, run] of idle) {
      await resetProject()
      touchedRef.dirty = true
      assert(!(await canUndo()), `${name}: 開き直した直後なのに、もう戻す手がある（準備が成立していない）`)
      const a = await histSnap()
      await run()
      await page.waitForTimeout(800)
      if (histDiff(a, await histSnap()).length) bad.push(`${name}: 中身が変わった`)
      else if (await canUndo()) bad.push(`${name}: 中身は同じなのに、戻す手が1つ増えた（Ctrl+Z の空振りになる）`)
    }
    assert(!bad.length, `触っただけで履歴が動く操作が ${bad.length} 件:\n        ` + bad.join('\n        '))
  })

  await check('操作を続けて重ねても、全部戻せて、全部やり直せる', async () => {
    await resetProject()
    // 続けてやっても成立する順に並べた物だけ（消す系は後ろへ）
    const chain = ['本編に色を付ける', '再生位置にカットを入れる', 'テロップを掴んで動かす', '本編を複製する',
      'めじるしを足す', '効果音を複製する', '本編のコピーを先頭に並べる', '画像を消す', '本編を消して詰める']
    const snaps = [await histSnap()]
    for (const name of chain) {
      await HIST_OPS.find((o) => o[0] === name)[1]()
      await page.waitForTimeout(800)
      const s = await histSnap()
      assert(histDiff(snaps.at(-1), s).length, `${name}: 操作しても中身が変わらない（準備が成立していない）`)
      snaps.push(s)
    }
    for (let i = chain.length - 1; i >= 0; i--) {
      await page.keyboard.press('Control+z')
      await page.waitForTimeout(450)
      const d = histDiff(snaps[i], await histSnap())
      assert(!d.length, `「${chain[i]}」を戻した所で、その前の中身と合わない（違う項目: ${d.join(', ')}）`)
    }
    for (let i = 0; i < chain.length; i++) {
      await page.keyboard.press('Control+y')
      await page.waitForTimeout(450)
      const d = histDiff(snaps[i + 1], await histSnap())
      assert(!d.length, `「${chain[i]}」をやり直した所で、やった後の中身と合わない（違う項目: ${d.join(', ')}）`)
    }
  })

  // 素材は 5秒×3本で、2本目の上に「ふたつめ」(6〜8秒)が載っている（e2e/lib/e2eFixture）。
  // 1本目と3本目を複製すると並びは 1・1'・2・3・3' になり、2本目は 5秒後ろへ動く。
  // 前は「最後に選んだ切片より後ろ」しか送らなかったので、間のテロップが置き去りになった
  await check('離れた本編を2本選んで複製しても、間のテロップが映像についていく', async () => {
    await resetProject()
    await v1Clips().nth(0).click()
    await v1Clips().nth(2).click({ modifiers: ['Control'] })
    const sel = await v1Clips().evaluateAll((els) => els.map((e) => e.classList.contains('clip-selected')))
    assert(JSON.stringify(sel) === '[true,false,true]', `1本目と3本目が選べていない（${JSON.stringify(sel)}）`)
    await page.keyboard.press('Control+d')
    await page.waitForTimeout(600)
    assert((await v1Clips().count()) === 5, `本編が5本になっていない（${await v1Clips().count()}本）`)
    const box0 = await v1Clips().first().boundingBox()
    const pxPerSec = box0.width / 5
    const tel = page.locator('.telop-clip[title="ふたつめ"]').first()
    assert(await tel.count(), '「ふたつめ」のテロップが無い')
    const at = +(((await tel.boundingBox()).x - box0.x) / pxPerSec).toFixed(1)
    assert(Math.abs(at - 11) <= 0.2, `2本目に載っていたテロップが 6 + 5 = 11秒へ送られていない（${at}秒）`)
  })

  // 本人（2026-11-12）「動画をダブルクリックしたら配置されて2度と元に戻れない」。
  // 動画を読み込むと、前は**履歴を全部捨てていた**ので、置く前にも、その前の手にも
  // 戻れなかった（state/useMediaOps の loadVideo）。
  // **置く前の手（テロップを消す）を自分で作ってから**確かめる。
  //
  // 同じ日のうちに、ダブルクリックでは**置かない**ことになった（本人「クリックしたら
  // 動画入れなくてよい。基本はドラッグでプロジェクトからタイムラインに配置する」）。
  // 置かれないことを見てから、ドラッグで置いて戻る
  await check('動画はダブルクリックでは置かれない。ドラッグで置けば、Ctrl+Z で置く前とその前へ戻れる', async () => {
    const proj = JSON.parse(readFileSync(fx.gcprojOrig, 'utf-8'))
    Object.assign(proj, { videoPath: null, sources: [], segments: [] })
    const p = join(fx.dir, 'no-video.gcproj')
    writeFileSync(p, JSON.stringify(proj), 'utf-8')
    await setDialogFiles([p], null)
    await page.keyboard.press('Control+o')
    await page.waitForTimeout(400)
    const cont = page.locator('.modal-btn', { hasText: 'このまま続ける' })
    if (await cont.count()) await cont.click()
    await page.waitForTimeout(800)
    const telops = () => page.locator('.telop-clip').count()
    assert((await v1Clips().count()) === 0, `動画の無いプロジェクトが開けていない（本編 ${await v1Clips().count()}本）`)
    const t0 = await telops()
    assert(t0 >= 2, `テロップが開けていない（${t0}枚）`)
    // 置く前の手: テロップを1枚消す（履歴は 450ms で1手にまとまる）
    await page.locator('.telop-clip').first().click()
    await page.keyboard.press('Delete')
    await page.waitForTimeout(700)
    assert((await telops()) === t0 - 1, 'テロップが消えていない（準備が成立していない）')
    const card = page.locator('.media-card', { hasText: 'test_video' }).first()
    assert(await card.count(), '素材ビンに動画のカードが無い')
    await card.dblclick()
    await page.waitForTimeout(1500)
    assert((await v1Clips().count()) === 0, 'ダブルクリックしただけで、動画がタイムラインに置かれた')
    const hint = (await page.locator('.toast').allTextContents()).join(' ')
    assert(hint.includes('ドラッグ'), `置き方の案内が出ていない: ${hint}`)
    await dndFromBin('test_video', '[data-tid="V1"]', { x: 60, y: 10 })
    await page.waitForSelector('[data-tid="V1"] .video-clip', { timeout: 15000 })
    await page.waitForTimeout(700)
    assert((await v1Clips().count()) === 1, 'ドラッグで動画が1本並んでいない（準備が成立していない）')
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(500)
    assert((await v1Clips().count()) === 0, 'Ctrl+Z で「動画を置く前」に戻らない')
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(500)
    assert((await telops()) === t0, `もう一度 Ctrl+Z で、置く前に消したテロップが戻らない（${await telops()}枚）`)
  })

  // 素材の出し入れ・差し替えを戻す（./05b）。自分で開き直してから始める
  await mediaUndo(C)

  // =========================================================================
  section('15. クリップの色分け')
  await resetProject()

  await check('右クリックから色を付けられて、Ctrl+Z で戻る', async () => {
    const bg = () => v1Clips().nth(0).evaluate((el) => getComputedStyle(el).backgroundColor)
    const before = await bg()
    await v1Clips().nth(0).click({ button: 'right' })
    await page.waitForSelector('.ctx-menu')
    const swatch = page.locator('.ctx-swatch:not(.ctx-swatch-none)').first()
    if (!(await swatch.count())) {
      await page.keyboard.press('Escape')
      throw new Error('右クリックメニューに色の選択肢が無い')
    }
    await swatch.click()
    await page.waitForTimeout(400)
    const after = await bg()
    assert(after !== before, `色が変わっていない（${before}）`)
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(400)
    assert((await bg()) === before, 'Ctrl+Z で色が戻らない')
  })

  // =========================================================================
}
