// 「どこまで耐えるか」を探す。テロップの枚数・文字数・クリップの数…を増やしていき、
// **1操作あたりアプリが余計にかけた時間**が 50ms を超えた所で打ち切る。
//
// ## 数の軸はどれも頭打ちになっている（2026-07-29 時点）
//
// 画面に出ている物しか作らないので、増やしても1操作の重さが変わらない。
// **壁が戻ってきたら、それは「見えていない物まで作っている」印。**
//
// 本体は ./bench.mjs。ここだけ約380行あるので別にしてある。
// 本体の途中で呼ばれるので、要る物は引数で受ける（本体の局所変数を触らない）。
import { copyFileSync, existsSync, linkSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildProject, makeImages, makeClipVideos } from './lib/fixture.mjs'
import { frameStats } from './lib/measure.mjs'
import { fmt, mb } from './lib/fmt.mjs'

/**
 * @param {object} ctx 本体から借りる物
 * @param {string} ctx.ROOT リポジトリの場所
 * @param {() => number} ctx.nowSec いまの秒
 * @param {Function} ctx.say これから何をするかを出す
 * @param {Function} ctx.done 結果を出す
 * @param {object} ctx.app Electron の窓
 * @param {object} ctx.fx 測るために作った素材（動画のパス・尺など）
 * @param {object} ctx.page 画面（Playwright）
 * @param {Function} ctx.setZoom タイムラインの拡大率を決める
 * @param {Function} ctx.heap いまのメモリ
 * @param {string} ctx.video 測るのに使う動画
 * @param {number} ctx.totalSec その動画の尺
 */
export async function findLimits({ ROOT, nowSec, say, done, app, fx, page, setZoom, heap, video, totalSec }) {
  /**
   * 別の中身のプロジェクトを開いて、開く時間・触ったときの重さ・メモリを見る。
   * what: 何を掴むか。増やした物そのものを掴まないと、その物の重さを測ったことに
   *       ならない（テロップを4000枚に増やして動画を掴んでも、テロップの重さは出ない）。
   */
  async function probe(path, what = 'clip') {
    await app.evaluate((_e, p) => {
      globalThis.__e2e.open = [p]
    }, path)
    const t0 = nowSec()
    await page.keyboard.press('Control+o')
    await page.waitForTimeout(500)
    const cont = page.locator('.modal-btn', { hasText: 'このまま続ける' })
    if (await cont.count()) {
      await cont.click()
      await page.waitForTimeout(200)
    }
    try {
      await page.waitForSelector('[data-tid="V1"] .video-clip', { timeout: 120000 })
    } catch {
      return { openSec: nowSec() - t0, p95: NaN, heap: NaN, ok: false, note: '開けなかった' }
    }
    await page.waitForTimeout(1200)
    const openSec = nowSec() - t0

    // ★拡大率は毎回きっちり同じ値から始める。
    //   ホイールで寄せると前の測定から積み上がり、条件が揃わない。
    await setZoom(30)

    // 掴んで動かしてみて、そのあいだの重さを見る。
    // 端のものは磁石で元の位置に戻るので、真ん中あたりを掴む。
    // 見た目の重さ（縁取り・影・種類）はプレビューを描くたびに効く。
    // 掴んで動かすのではなく、再生ヘッドを動かして描き直させて測る。
    if (what === 'scrub') {
      const rr = await page.locator('.ruler').boundingBox()
      // ★見えている範囲は .track-scroll で測る。
      //   .track-inner は中身そのものなので、拡大すると左端が画面の外へ出る。
      //   そこを起点にすると、トラック名の欄の上を掴むことになって何も起きない。
      const bx = await page.locator('.track-scroll').boundingBox()
      const vpw = (page.viewportSize() ?? { width: 1280 }).width
      const L = Math.max(bx.x, 0) + 20
      const R = Math.min(bx.x + bx.width, vpw) - 20
      await page.evaluate(() => {
        window.__frames = []
        window.__sampling = true
        let last = performance.now()
        const tick = (t) => {
          window.__frames.push(t - last)
          last = t
          if (window.__sampling) requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      })
      const MOVES = 30
      const SLEEP = 8
      // 画面上の位置ではなくタイムライン上の位置で見る。
      // 拡大していると再生ヘッドが画面の外に出て、位置が読めなくなるため。
      const hx = () =>
        page.locator('.playhead').first().evaluate((e) => parseFloat(e.style.left) || 0)
      const hx0 = await hx()
      await page.mouse.move(L, rr.y + rr.height / 2)
      await page.mouse.down()
      const t1 = nowSec()
      for (let i = 1; i <= MOVES; i++) {
        await page.mouse.move(L + ((R - L) * i) / MOVES, rr.y + rr.height / 2)
        await page.waitForTimeout(SLEEP)
      }
      const sec = nowSec() - t1
      await page.mouse.up()
      await page.waitForTimeout(300)
      // 再生ヘッドが動いていなければ、プレビューを描き直させていない＝測っていない
      const hx1 = await hx()
      if (!(Math.abs(hx1 - hx0) > 10))
        return {
          openSec,
          lag: NaN,
          worst: NaN,
          heap: NaN,
          ok: false,
          note: `再生ヘッドが動かない（${fmt(hx0, 0)} → ${fmt(hx1, 0)} / 掴んだ範囲 ${fmt(L, 0)}〜${fmt(R, 0)}px）`
        }
      const fr = await page.evaluate(() => {
        window.__sampling = false
        return window.__frames
      })
      const st = frameStats(fr) ?? { worst: NaN }
      const hh = await heap()
      const lg = (sec * 1000 - MOVES * SLEEP) / MOVES
      return { openSec, lag: lg, worst: st.worst, heap: hh, ok: openSec <= 30 && lg <= 50, note: '' }
    }
    const sel = {
      clip: '[data-tid="V1"] .video-clip',
      telop: '.telop-clip',
      se: '[data-tid="A2"] .se-clip',
      img: '[data-tid="V3"] .img-clip',
      // 動画クリップ（V2 に置いた別素材）。2026-08-04 に足した——それまで
      // fixture が vClips を1本も作っていなかったので、掴む相手も無かった。
      vid: '[data-tid="V2"] .vclip'
    }
    const clips = page.locator(sel[what] ?? sel.clip)
    const nClips = await clips.count()
    if (!nClips) return { openSec, lag: NaN, worst: NaN, heap: NaN, ok: false, note: '掴む物が無い' }
    // 数が多いと1個が数pxしかなく、掴もうとしても外れる。人と同じで先に拡大する。
    // ★拡大すると狙った物が画面の外へ出るので、拡大してから選び直すこと。
    //   先に決めておくと、画面に無い場所を押して空振りする。
    // 見えている範囲は .track-scroll で測る（.track-inner は拡大で画面外へ出る）
    const box0 = await page.locator('.track-scroll').boundingBox()
    const vpw0 = (page.viewportSize() ?? { width: 1280 }).width
    const visLeft = Math.max(box0.x, 0) + 20
    const visRight = Math.min(box0.x + box0.width, vpw0) - 20
    // 掴める幅の物が画面に出るまで、拡大率を段階的に上げる（上限120）
    const findPick = (minW) =>
      clips.evaluateAll(
        (els, o) => {
          for (let i = 0; i < els.length; i++) {
            const r = els[i].getBoundingClientRect()
            if (r.width >= o.minW && r.x > o.l && r.x + r.width < o.r) return i
          }
          // 拡大しすぎて1個が画面より広い場合は、見えている部分があれば掴める
          for (let i = 0; i < els.length; i++) {
            const r = els[i].getBoundingClientRect()
            if (r.x < o.r - 100 && r.x + r.width > o.l + 100) return i
          }
          return -1
        },
        { minW, l: visLeft, r: visRight }
      )
    /**
     * **1個目の所まで横に送る。**
     *
     * `findPick` は「いま画面に見えている範囲」からしか選ばない。素材はタイムライン
     * 全体（1時間）へ散らばるので、**数が少ないほど画面に1個も入らない**——
     * 20個なら180秒に1個、拡大30px/秒で見えるのは約33秒ぶん。
     *
     * しかも見つからないと拡大率を上げる作りで、**寄るほど見える範囲は狭くなる**。
     * 既存の軸（テロップ4000枚など）が通っていたのは、単に密度が高くて
     * 偶然入っていただけだった。
     *
     * 2026-08-04 に、これで3軸（本物の画像・動画クリップ・その元ファイル数）が
     * **「20個で崩れる」と限界のような顔で出ていた**。限界ではなく未測定。
     */
    const scrollToFirst = async () => {
      await page.evaluate((s) => {
        const el = document.querySelector(s)
        const sc = document.querySelector('.track-scroll')
        if (!el || !sc) return
        // 中身の左端からの距離。画面のだいたい真ん中へ来るように送る
        sc.scrollLeft = Math.max(0, el.offsetLeft - sc.clientWidth / 3)
      }, sel[what] ?? sel.clip)
      await page.waitForTimeout(120)
    }
    await scrollToFirst()
    for (const z of [30, 50, 80, 120]) {
      if ((await findPick(24)) >= 0) break
      await setZoom(z)
      await scrollToFirst() // 寄せると見える範囲が狭まるので、そのたびに送り直す
    }
    const pick = await findPick(20)
    if (pick < 0)
      return {
        openSec,
        lag: NaN,
        worst: NaN,
        heap: NaN,
        ok: false,
        // **「崩れた」と読ませない。** 限界ではなく測れていない、と分かる文言にする
        note: `掴める物が画面に無い（${nClips}個あるのに選べなかった＝**測れていない**。限界ではない）`
      }
    const target = clips.nth(pick)
    const c = await target.boundingBox()
    if (!c) return { openSec, lag: NaN, worst: NaN, heap: NaN, ok: false, note: '掴む物が見つからない' }
    await page.evaluate(() => {
      window.__frames = []
      window.__sampling = true
      let last = performance.now()
      const tick = (t) => {
        window.__frames.push(t - last)
        last = t
        if (window.__sampling) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    // 動かせたかは「並び全体が変わったか」で見る。
    // n番目のクリップを見張ると、動かした結果ずれた別のクリップが
    // 同じ番号に来てしまい、動いていないように見える。
    const layout = () =>
      clips.evaluateAll((els) =>
        els.map((e) => Math.round(e.getBoundingClientRect().x) + ':' + Math.round(e.getBoundingClientRect().width)).join(',')
      )
    const before = await layout()
    // 掴む点は「クリップの上」かつ「見えている範囲」に収める
    const x0 = Math.min(Math.max(c.x + 12, visLeft + 10), Math.min(c.x + c.width - 12, visRight - 260))
    const MOVES = 30
    const SLEEP = 8
    const dx = Math.max(4, Math.min(8, (c.width * 1.5) / MOVES)) // 1.5個ぶん動かす
    await page.mouse.move(x0, c.y + c.height / 2)
    await page.mouse.down()
    const tDrag = nowSec()
    for (let i = 1; i <= MOVES; i++) {
      await page.mouse.move(x0 + i * dx, c.y + c.height / 2)
      await page.waitForTimeout(SLEEP)
    }
    const dragSec = nowSec() - tDrag
    await page.mouse.up()
    await page.waitForTimeout(300)
    // 本当に掴めたかを確かめる。掴めていないと「何も起きない＝軽い」に見えてしまう
    // （実際、最初はこれで全部の設定が「平気」と出ていた）。
    const moved = (await layout()) !== before
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(400)
    const frames = await page.evaluate(() => {
      window.__sampling = false
      return window.__frames
    })
    const s = frameStats(frames) ?? { p95: NaN, worst: NaN, janky: 0 }
    const h = await heap()
    // 1回のマウス移動あたり、待ち時間を差し引いて何ミリ秒余計にかかったか。
    // これがアプリ側の手間そのもの（コマ落ちの分布より素直に効く）。
    const lag = (dragSec * 1000 - MOVES * SLEEP) / MOVES
    // 開くのに30秒／1操作あたり50ms超かかるようなら、そこから先は実用に耐えない
    const ok = moved && openSec <= 30 && lag <= 50
    return { openSec, lag, worst: s.worst, heap: h, ok, note: moved ? '' : '掴めなかった' }
  }

  // **実物の画像と動画を先に用意する**（初回だけ ffmpeg が走る。以降は .cache から）。
  // 元ファイルの本数は 40 / 20 に抑えて使い回す——ここで測りたいのは
  // 「タイムラインに置いた数」で、ディスク上のファイル数ではないため。
  // ファイル数そのものの軸は「元ファイル数（全部が別）」で別に持っている。
  await say('動作', '素材の用意', '本物のPNGと動画クリップを作る（初回だけ時間がかかる）')
  const imgsByPx = {}
  for (const px of [512, 1920, 4096]) imgsByPx[px] = await makeImages(20, px)
  const imgs1920 = imgsByPx[1920]
  const vids3s = await makeClipVideos(20, 3)

  const sweeps = [
    {
      name: 'テロップの枚数',
      key: 'telops',
      values: [200, 500, 1000, 2000, 4000],
      label: (v) => `${v}枚`,
      base: { clips: 12 }
    },
    {
      name: 'テロップ1枚の文字数',
      key: 'chars',
      values: [12, 40, 120, 400, 1000],
      label: (v) => `1枚 ${v}字`,
      base: { telops: 300, clips: 12 }
    },
    {
      name: 'クリップの数',
      key: 'clips',
      values: [50, 200, 500, 1000, 2000],
      label: (v) => `${v}個`,
      base: { telops: 100 },
      grab: 'clip'
    },
    {
      name: '効果音の数',
      key: 'se',
      values: [50, 200, 500, 1000],
      label: (v) => `${v}個`,
      base: { telops: 50, clips: 12 },
      grab: 'se'
    },
    {
      name: '画像の数',
      key: 'imgs',
      values: [50, 200, 500, 1000],
      label: (v) => `${v}枚`,
      base: { telops: 50, clips: 12 },
      grab: 'img'
    },
    {
      name: 'めじるしの数',
      key: 'marks',
      values: [200, 1000, 3000, 8000],
      label: (v) => `${v}個`,
      base: { telops: 50, clips: 12 },
      grab: 'clip'
    },
    {
      name: 'テロップの縁取りの枚数',
      key: 'strokes',
      values: [1, 3, 6, 10],
      label: (v) => `${v}枚`,
      base: { telops: 200, clips: 12, shadows: 1 },
      grab: 'scrub'
    },
    {
      name: 'テロップの影の枚数',
      key: 'shadows',
      values: [1, 3, 6, 12],
      label: (v) => `${v}枚`,
      base: { telops: 200, clips: 12, strokes: 2 },
      grab: 'scrub'
    },
    {
      name: 'テロップのスタイルの種類数',
      key: 'kinds',
      values: [1, 10, 50, 200],
      label: (v) => `${v}種`,
      base: { telops: 200, clips: 12, strokes: 2, shadows: 2 },
      grab: 'scrub'
    },
    {
      name: '素材ビンの数（同じファイル）',
      key: 'media',
      values: [10, 100, 500, 2000],
      label: (v) => `${v}件`,
      base: { telops: 50, clips: 12 },
      grab: 'clip'
    },
    {
      // フォルダを丸ごと読み込む使い方は、全部が別ファイルになる。
      // 同じファイルを並べた測定より重いはずで、そこが実際の上限になる。
      name: '素材ビンの数（全部が別ファイル）',
      key: 'media',
      values: [100, 500, 2000],
      label: (v) => `${v}件`,
      base: { telops: 50, clips: 12, mediaFiles: makeDistinctMedia(2000) },
      grab: 'clip'
    },

    // -----------------------------------------------------------------------
    // ここから 2026-08-04 に足した軸。**画像と動画は実物を読ませる。**
    //
    // それまでの「画像の数」は path に元動画を指していて、**帯が並ぶ重さしか
    // 測っていなかった**（デコードもサムネもメモリも0回）。動画クリップに
    // 至っては fixture が1本も作っていなかった＝軸そのものが無かった。
    // -----------------------------------------------------------------------
    {
      name: '画像の数（本物のPNG・1920px）',
      key: 'imgs',
      values: [50, 200, 500, 1000],
      label: (v) => `${v}枚`,
      base: { telops: 50, clips: 12, imgFiles: imgs1920 },
      grab: 'img'
    },
    {
      // **枚数と解像度を分ける。** 混ぜると「重いのは枚数か大きさか」が出ない。
      name: '画像1枚の大きさ（100枚で固定）',
      key: 'imgPx',
      values: [512, 1920, 4096],
      label: (v) => `${v}px 幅`,
      base: { telops: 50, clips: 12, imgs: 100 },
      // 解像度は buildProject の引数ではないので、値ごとに別のファイル一覧を渡す
      makeBase: (v) => ({ imgFiles: imgsByPx[v] }),
      grab: 'img'
    },
    {
      name: '動画クリップの数',
      key: 'vids',
      values: [20, 80, 200, 500],
      label: (v) => `${v}個`,
      base: { telops: 50, clips: 12, vidFiles: vids3s },
      grab: 'vid'
    },
    {
      // 同じファイルを並べるとデコーダが使い回されて実際より軽く出る。
      // 素材ビンの軸で踏んだのと同じ穴なので、別ファイル版を必ず持つ。
      name: '動画クリップの元ファイル数（全部が別）',
      key: 'vids',
      values: [20, 80, 200],
      label: (v) => `${v}個`,
      base: { telops: 50, clips: 12, vidFiles: null },
      grab: 'vid'
    },
    {
      name: '動き（キーフレーム）を持つ数',
      key: 'motions',
      values: [50, 200, 500, 1000],
      label: (v) => `${v}本`,
      base: { telops: 50, clips: 1000, motionKeys: 4 },
      grab: 'clip'
    },
    {
      // 印の数は書き出しの式の長さに直に効く（`keysToExpr`）。
      // 画面が軽くても書き出しが死ぬ形があるので、別の軸にしてある。
      name: '動き1本あたりの印の数（200本で固定）',
      key: 'motionKeys',
      values: [2, 8, 30, 100],
      label: (v) => `1本 ${v}印`,
      base: { telops: 50, clips: 500, motions: 200 },
      grab: 'clip'
    },
    {
      name: '切り替え効果（エフェクト）の数',
      key: 'trans',
      values: [50, 200, 500, 1000],
      label: (v) => `${v}個`,
      base: { telops: 50, clips: 1000 },
      grab: 'clip'
    },
    {
      /**
       * **同じ時刻に重ねる。**
       *
       * 他の軸は素材を尺全体へばらけさせるので、再生ヘッドの位置には常に
       * 1〜2個しか居ない。**「200枚置いた」と「200枚同時に見えている」は
       * 別物**で、描画の重さが出るのは後者。ここだけ 0〜10秒へ寄せる。
       */
      name: '同時に見えている数（テロップ＋画像を重ねる）',
      key: 'telops',
      values: [50, 200, 500, 1000],
      label: (v) => `${v}枚が同時`,
      base: { clips: 12, imgs: 100, imgFiles: imgs1920, overlap: true },
      grab: 'scrub'
    }
  ]

  /**
   * 別ファイルを n 個作る（素材ビンの「フォルダ丸ごと読み込み」を再現する）。
   *
   * 中身は同じでよいが、**パスは全部違う**必要がある。アプリは同じファイルの
   * サムネを作り直さないので、同じパスを並べると1件ぶんの手間しか出ない。
   */
  function makeDistinctMedia(n) {
    const dir = join(fx.dir, 'many')
    mkdirSync(dir, { recursive: true })
    // 元は短いものを使う（本編の10分素材を2000個ぶん解析すると、
    // 測定そのものが何時間もかかって終わらない）。
    const cacheDir = join(ROOT, 'e2e', '.cache')
    const short = existsSync(cacheDir)
      ? readdirSync(cacheDir)
          .filter((f) => f.endsWith('.mp4') && !f.startsWith('bench-'))
          .map((f) => join(cacheDir, f))[0]
      : null
    const src = short ?? video
    const out = []
    for (let i = 0; i < n; i++) {
      const f = join(dir, `m${String(i).padStart(4, '0')}.mp4`)
      if (!existsSync(f)) {
        // 中身は同じでよく、違う必要があるのは**パスだけ**。
        // 2000個コピーすると数GB使うので、ハードリンクで済ませる。
        try {
          linkSync(src, f)
        } catch {
          copyFileSync(src, f)
        }
      }
      out.push(f)
    }
    return out
  }

  for (const sw of sweeps) {
    let lastOk = null
    let broke = null
    const pts = [] // 1つあたりの重さを出すために全部の点を残す
    for (const v of sw.values) {
      // makeBase: 値そのものが buildProject の引数にならない軸（解像度など）で、
      // 値ごとに別の素材一覧を差し替えるための口
      const opts = { ...sw.base, ...(sw.makeBase?.(v) ?? {}), [sw.key]: v }
      const p = join(fx.dir, `limit-${sw.key}-${v}.gcproj`)
      writeFileSync(p, JSON.stringify(buildProject(video, totalSec, opts)), 'utf-8')
      await say('動作', `どこまで耐えるか: ${sw.name}`, `${sw.label(v)} を開いて触ってみる`)
      // 増やした物そのものを掴む（テロップの軸ならテロップを動かす）。
      // ここを合わせないと「置いてあるだけの重さ」しか測れない。
      const r = await probe(p, sw.grab ?? 'telop')
      const line =
        `${sw.label(v)}: 開く ${fmt(r.openSec)}秒 / 1操作 ${fmt(r.lag)}ms` +
        ` / 最悪のコマ ${fmt(r.worst)}ms / メモリ ${mb(r.heap)}`
      console.log(`    ${r.ok ? '·' : '×'} ${line}${r.note ? ' … ' + r.note : ''}`)
      if (Number.isFinite(r.lag)) pts.push({ v, lag: r.lag, heap: r.heap })
      if (r.ok) lastOk = { v, r }
      else {
        broke = { v, r }
        break
      }
    }
    // 1つ増えるごとにどれだけ重くなるか（端どうしを結んだ傾き）。
    // 「どこで崩れるか」だけだと、あとどれくらい余裕があるか分からない。
    let slope = ''
    if (pts.length >= 2) {
      const a = pts[0]
      const b = pts[pts.length - 1]
      const dv = b.v - a.v
      if (dv > 0) {
        // 単位は試した範囲に合わせる。1〜10 の軸を1000倍に伸ばすと、
        // 誤差が1000倍になって「+97MB」のような意味の無い数字が出る。
        const unit = b.v >= 200 ? 1000 : b.v >= 20 ? 100 : 1
        const ms = ((b.lag - a.lag) / dv) * unit
        const mem = ((b.heap - a.heap) / dv) * unit / 1024 / 1024
        const sign = (x) => (x >= 0 ? '+' : '')
        slope =
          ` ／ ${unit}増えるごとに ${sign(ms)}${fmt(ms)}ms・${sign(mem)}${fmt(mem)}MB` +
          (Math.abs(ms) < 2 ? '（ほぼ変わらない）' : '')
      }
    }
    /**
     * **「重かった」と「測れなかった」を混ぜない。**
     *
     * 1操作の重さが数字で出ていれば、それは測ったうえで重かった＝限界。
     * 数字が出ていない（NaN）のは、掴む相手を選べなかった等で**そもそも
     * 測っていない**。2026-08-04 に、後者が「20個で崩れる」と限界の顔で
     * 3軸ぶん出ていた——**限界だと思って直しにいくと、丸ごと無駄になる。**
     */
    const notMeasured = broke && !Number.isFinite(broke.r.lag)
    const detail =
      (notMeasured
        ? `**測れていない**（${sw.label(broke.v)} で ${broke.r.note}）` +
          `${lastOk ? ` ／ ${sw.label(lastOk.v)} までは平気` : ''}`
        : broke
          ? `${lastOk ? sw.label(lastOk.v) : '最小の設定'} までは平気 / ${sw.label(broke.v)} で崩れる` +
            `（開く ${fmt(broke.r.openSec)}秒・1操作 ${fmt(broke.r.lag)}ms${broke.r.note ? '・' + broke.r.note : ''}）`
          : `試した上限 ${sw.label(sw.values[sw.values.length - 1])} まで平気` +
            `（そこで 開く ${fmt(lastOk.r.openSec)}秒・1操作 ${fmt(lastOk.r.lag)}ms・メモリ ${mb(lastOk.r.heap)}）`) +
      slope
    // 測れていないものは **問題あり（ng）**。△ にすると「まあ動いた」に見える
    await done('動作', `どこまで耐えるか: ${sw.name}`, detail, notMeasured ? 'ng' : broke ? 'warn' : 'ok')
  }

  // 元のプロジェクトに戻しておく（このあとの書き出しを本来の条件でやるため）
  await app.evaluate((_e, p) => {
    globalThis.__e2e.open = [p]
  }, fx.gcproj)
  await page.keyboard.press('Control+o')
  await page.waitForTimeout(600)
  const cont2 = page.locator('.modal-btn', { hasText: 'このまま続ける' })
  if (await cont2.count()) await cont2.click()
  await page.waitForSelector('[data-tid="V1"] .video-clip', { timeout: 120000 })
  await page.waitForTimeout(1200)
}
