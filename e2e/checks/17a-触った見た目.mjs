// 触ったときの**見た目**（数値欄を振る・横だけ拡大・2つ選んで拡大・動かした跡）。
//
// `17-目と耳の確認.mjs` が 669行あったので出した（決まり: 600超は500以下に割る）。
// 章を名乗るのはここ（17a）だけ。17b・17c は続きとして呼ばれる。
//
// 入口は ./17-目と耳の確認.mjs

import { join } from 'node:path'

export default async function (C) {
  const {
    assert, avgColor, avgColorAt, check, clipLayout, clipW, dragBy, page, shotDir, similarity,
    resetProject, section, seekTo, shot, v1Clips
  } = C
  section('目で見る確認（画面を撮って中身を測る）')
  await resetProject()

  // ---- 数値欄を「押して振る」まわり ---------------------------------------
  //
  // ここは**画面を撮って確かめる**。数字が変わったことだけ見ても、
  // 実際にプレビューの見た目が変わったかは分からない
  // （値だけ動いて絵が付いてこない、という壊れ方が一番たちが悪い）。

  /** 数値欄を押して、横に振る。ScrubNumber の操作 */
  const scrubField = async (input, dx) => {
    const b = await input.boundingBox()
    assert(b, '数値欄が画面に無い')
    const y = b.y + b.height / 2
    await page.mouse.move(b.x + b.width / 2, y)
    await page.mouse.down()
    // 4px 動かすまではクリック扱いなので、必ず何回かに分けて動かす
    for (let i = 1; i <= 8; i++) await page.mouse.move(b.x + b.width / 2 + (dx * i) / 8, y)
    await page.mouse.up()
    await page.waitForTimeout(300)
  }
  /** モーションタブの行（ラベルで探す） */
  const moRow = (label) => page.locator('.mo-row', { hasText: label }).first()
  /** テロップを選んでモーションタブを開く */
  const openMotion = async () => {
    await page.locator('.telop-clip').first().click()
    await page.waitForTimeout(300)
    await page.locator('.panel-tabs .tab', { hasText: 'モーション' }).first().click()
    await page.waitForTimeout(400)
  }

  await check('数値欄は押して振ると変わり、プレビューの見た目も動く', async () => {
    await resetProject()
    await seekTo(1)
    // **文字が画面に出ている時刻でないと始まらない。** 素材任せにせず、ここで作る
    await page.keyboard.press('t')
    await page.waitForTimeout(500)
    await openMotion()
    // **文字のいる所だけを撮る。** 画面全体で平均を取ると、文字は面積が小さいので
    // 動いても数字がほとんど変わらない（実際それで見逃しかけた）。
    //
    // 撮る範囲は**文字の箱そのもの**にする。以前は真ん中の 28×20 と決め打ちだったが、
    // プレビューの大きさが変わると当たり所がずれ、**同じだけ動いても平均が動かない**
    // ことがあった（操作バーを1段にして映像が30px 広がったときに実際に起きた）。
    // 箱に合わせておけば、文字が退いた分がそのまま平均に出る。
    const b0 = await page.locator('.telop-box').first().boundingBox()
    assert(b0, 'プレビューに文字が無い')
    const clip = {
      x: Math.round(b0.x),
      y: Math.round(b0.y),
      width: Math.max(8, Math.round(b0.width)),
      height: Math.max(8, Math.round(b0.height))
    }
    const before = join(shotDir, 'scrub-before.png')
    const after = join(shotDir, 'scrub-after.png')
    await page.screenshot({ path: before, clip })

    const field = moRow('位置 Y').locator('input').first()
    const v0 = Number(await field.inputValue())
    await scrubField(field, 600) // 大きく動かす（少しだと画面上では数pxで、見分けが付かない）
    const v1 = Number(await field.inputValue())
    // ※向きは見ない。押し込むと画面が固定される（ポインタロック）ので、
    //   自動操作では振る向きが安定しない。ここで見たいのは「振れば変わる」こと
    assert(v1 !== v0, `押して振っても値が変わらない（${v0} → ${v1}）`)

    // 同じ場所をもう一度撮る。文字が退いていれば、そこは平坦になる
    await page.screenshot({ path: after, clip })
    const a = await avgColor(before)
    const b = await avgColor(after)
    // 明るさだけでなく色味も見る。白い文字が退いた跡が下地と同じ明るさだと、
    // 明るさの平均は動かないのに色は大きく変わる（実際にそうなった）
    const moved =
      Math.abs((a.y ?? 0) - (b.y ?? 0)) > 3 ||
      Math.abs((a.range ?? 0) - (b.range ?? 0)) > 10 ||
      Math.abs((a.u ?? 0) - (b.u ?? 0)) > 3 ||
      Math.abs((a.v ?? 0) - (b.v ?? 0)) > 3
    assert(
      moved,
      `値は変わったのに、プレビューの絵が変わっていない（${v0} → ${v1} / ` +
        `明るさ ${a.y}→${b.y} 色 ${a.u},${a.v}→${b.u},${b.v}）`
    )
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(400)
  })

  await check('「横だけ拡大」も、印を打たずに触れる', async () => {
    // 元の値を持たない行は ⏱ を押すまで触れなかった。
    // 値を見ながら決めたいのに、先に印を打たせるのは順番が逆
    await openMotion()
    // 「詳細設定」は畳まずに出ている（見出しを押すと選択になるので、押さない）
    const more = page.locator('.mo-sec', { hasText: '詳細設定' }).first()
    assert(await more.count(), '「詳細設定」の見出しが無い')
    const field = moRow('横だけ拡大').locator('input').first()
    assert(await field.count(), '「横だけ拡大」の行が無い')
    assert(!(await field.isDisabled()), '「横だけ拡大」が触れないままになっている')
    const v0 = Number(await field.inputValue())
    await scrubField(field, 90)
    const v1 = Number(await field.inputValue())
    assert(v1 !== v0, `押して振っても値が変わらない（${v0} → ${v1}）`)
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(400)
  })

  await check('文字を2つ選んで拡大すると、両方が大きくなる（元の差は保つ）', async () => {
    await resetProject()
    await seekTo(1)
    // 同じ時刻に2つ作る（素材任せにしない）
    await page.keyboard.press('t')
    await page.waitForTimeout(400)
    await page.keyboard.press('t')
    await page.waitForTimeout(500)
    const sizes = () =>
      page.evaluate(() =>
        [...document.querySelectorAll('.telop-box')].slice(0, 2).map((el) => {
          const r = el.getBoundingClientRect()
          return { w: Math.round(r.width), h: Math.round(r.height) }
        })
      )
    const before = await sizes()
    assert(before.length >= 2, `文字を2つ作れなかった（${before.length}個）`)

    const clips = page.locator('.telop-clip')
    await clips.nth(0).click()
    await clips.nth(1).click({ modifiers: ['Control'] })
    await page.waitForTimeout(300)
    await page.locator('.panel-tabs .tab', { hasText: 'モーション' }).first().click()
    await page.waitForTimeout(400)

    const screen = page.locator('.screen').first()
    const sb = await screen.boundingBox()
    const clip = {
      x: Math.round(sb.x),
      y: Math.round(sb.y),
      width: Math.round(sb.width),
      height: Math.round(sb.height)
    }
    await page.screenshot({ path: join(shotDir, 'group-scale-before.png'), clip })

    // **打ち込みで確かめる。** 押して振る動きは画面が固定される（ポインタロック）ため
    // 自動操作では向きが安定しない。まとめて効くかを見るのが目的で、
    // 打ち込みも振るのも通る道筋は同じ（どちらも onValue）
    const field = moRow('拡大').locator('input').first()
    await field.fill('160')
    await field.press('Enter')
    await page.waitForTimeout(500)
    const after = await sizes()
    await page.screenshot({ path: join(shotDir, 'group-scale-after.png'), clip })

    assert(after[0].w > before[0].w + 2, `掴んだ方が大きくなっていない（${before[0].w} → ${after[0].w}）`)
    assert(
      after[1].w > before[1].w + 2,
      `選んである他の文字が大きくなっていない（${before[1].w} → ${after[1].w}）`
    )
    // 倍率がそろっている＝元の大小関係が崩れていない
    const r0 = after[0].w / before[0].w
    const r1 = after[1].w / before[1].w
    assert(
      Math.abs(r0 - r1) < 0.15,
      `一緒に大きくはなったが、倍率が違う（${r0.toFixed(2)} と ${r1.toFixed(2)}）`
    )
  })

  await check('動かした跡が、本当に「何も無い」ように見えている', async () => {
    // 「帯が残っていない」は数値では確かめられないので、画面を撮って見比べる。
    // 同じ場所を動かす前と後で撮り、(1) 見た目が変わったこと（クリップが消えた）
    // (2) 後の絵が平坦なこと（模様＝帯や文字が無い）の2つで判定する。
    const rect = await page.evaluate(() => {
      const row = document.querySelector('[data-tid="V1"]')
      const b = row.getBoundingClientRect()
      return {
        x: Math.round(b.x + 8),
        y: Math.round(b.y + 5),
        width: 40,
        height: Math.round(b.height - 10)
      }
    })
    const a = join(shotDir, 'cmp-before.png')
    const b = join(shotDir, 'cmp-after.png')
    await page.screenshot({ path: a, clip: rect })
    const beforeLayout = await clipLayout()
    const W2 = await clipW()
    await dragBy(v1Clips().nth(0), W2 * 0.6)
    await page.waitForTimeout(300)
    await page.screenshot({ path: b, clip: rect })
    // 画像を比べる前に、そもそも動いたかを数値で確かめる
    // （動いていないのに「見た目が変わらない」と言われても原因が分からない）
    const moved = await clipLayout()
    assert(
      moved[0].x > beforeLayout[0].x + 5,
      `クリップが動いていない（${beforeLayout[0].x} → ${moved[0].x}）`
    )
    const sim = await similarity(a, b)
    assert(sim < 0.95, `動かしたのに見た目が変わっていない（一致度 ${sim.toFixed(3)}）`)
    const after = await avgColor(b)
    assert(after.range != null, '明暗の幅を測れなかった')
    // クリップにはサムネや文字があるので明暗の幅が大きい。跡は平坦なはず。
    assert(
      after.range < 40,
      `跡に模様が残っている（明暗の幅 ${after.range}）。帯やサムネが残っている疑い`
    )
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(400)
  })

}
