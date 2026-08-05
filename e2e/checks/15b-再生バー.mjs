// プレビューの**再生バー**（画質・全体のどこを見ているか・掴んで早送り）。
//
// `15-パネルと見た目.mjs` から出した（決まり: 600超は500以下に割る）。
// 章「プレビューの再生バー」を名乗るのはここ。入口は ./15-パネルと見た目.mjs

import { spawn } from 'node:child_process'

export default async function (C) {
  const {
    app, assert, check, fx, near, page, resetProject, section, seekTo, setDialogFiles,
    touchedRef
  } = C
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
}
