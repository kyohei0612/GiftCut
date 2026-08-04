// 負荷チェックが**画面を触るための道具**（寄せる・送る・時刻で指す）。
//
// ## なぜ本体から出したか（2026-08-04）
//
// `bench.mjs` が上限（1,250行）に当たった。話題は明確に2つに分かれていて、
// **「何を測るか」と「画面をどう触るか」**が混ざっていた。こちらは後者だけ。
//
// ## ここに集めた物は、全部「測れていなかった」を潰した跡
//
// 2026-08-04 に、本体の4項目と限界さがしの3軸が**測れていないのに
// 「重い」「崩れる」と報告していた**ことが分かった。原因は3つとも別:
//
//   寄せ方が足りない  60分の素材は全体表示 0.36px/秒。10ノッチ寄せても
//                     2.4秒の帯が**3.5px**で、掴む条件（20px）を満たさない
//   送っていない      帯は**見えている範囲にしか作られない**。物の無い所に
//                     居ると `querySelector` が null を返して詰む
//   px で判定した     引いた状態だと 3秒＝**1.2px**。しきい値5pxに届かず
//                     「再生が進んでいない」＝アプリの不具合に見えた
//
// **どれも「成立しなければ落ちる」に倒してある。** 黙って進むと、
// 掴めていないのに「軽い」、違う時刻を見くらべて「絵が違う」になる。
//
// ## 中身
//
// - `makeViewTools` … 下の道具をまとめて作る（本体の局所変数を引数で借りる）

/**
 * @param {object} o 本体から借りる物
 * @param {object} o.page 画面（Playwright）
 * @param {number} o.totalSec タイムライン全体の長さ（秒）
 * @param {Function} o.zoomIn 拡大（x, y, 回数）
 * @param {Function} o.visMid 見えている範囲の真ん中（呼ぶたびに読む）
 * @param {Function} o.visY 見えている範囲の上端からの y
 * @param {Function} o.ruler ルーラーの箱（頭出しで押す所）
 * @param {Function} o.fmt 数字の整形
 */
export function makeViewTools({ page, totalSec, zoomIn, visMid, visY, ruler, fmt }) {
  /** 中身の幅（＝尺×拡大率）から、1秒あたり何 px かを出す */
  const pxPerSec = async () => {
    const w = await page.evaluate(() => {
      const inner = document.querySelector('.track-inner')
      return inner ? parseFloat(inner.style.width || '0') : 0
    })
    return w / Math.max(1, totalSec)
  }

  /**
   * 再生ヘッドの位置（タイムライン上の px）。
   *
   * **画面上の座標で読まない。** 寄せていると再生ヘッドは画面の外へ出るので
   * `boundingBox()` が null になり、`?? NaN` で守ると
   * `Math.abs(NaN - x0) < 5` が **false ＝「動いた」**で素通りする。
   */
  const headX = async () => {
    const v = await page.evaluate(() => {
      const el = document.querySelector('.playhead')
      if (!el) return null
      const l = parseFloat(el.style.left || '')
      return Number.isFinite(l) ? l : null
    })
    if (v === null) throw new Error('再生ヘッドが見つからない（測れていない）')
    return v
  }

  /** 再生ヘッドの**時刻（秒）**。px は拡大率で変わるので、比べるならこちら */
  const headSec = async () => {
    const v = await page.evaluate(() => {
      const el = document.querySelector('.playhead')
      const inner = document.querySelector('.track-inner')
      if (!el || !inner) return null
      const left = parseFloat(el.style.left || '')
      const w = parseFloat(inner.style.width || '')
      return Number.isFinite(left) && w > 0 ? { left, w } : null
    })
    if (!v) throw new Error('再生ヘッドが見つからない（測れていない）')
    return (v.left / v.w) * totalSec
  }

  /**
   * その種類の1個目が見える所まで、横に送る。
   *
   * **見つからないときは先頭へ戻す。** 帯は「見えている範囲」にしか作られない
   * ので、物の無い所に居ると `querySelector` は null を返し、
   * 「送り先が分からない → そのまま → やはり何も無い」で詰む。
   * 素材はどの基準でも頭の方から並ぶので、先頭へ戻せば必ず何か入る。
   */
  const scrollToFirst = async (sel) => {
    await page.evaluate((s) => {
      const sc = document.querySelector('.track-scroll')
      if (!sc) return
      const el = document.querySelector(s)
      sc.scrollLeft = el ? Math.max(0, el.offsetLeft - sc.clientWidth / 3) : 0
    }, sel)
    await page.waitForTimeout(200)
  }

  /**
   * **掴める幅の帯が画面に出るまで寄せる。**
   *
   * 固定回数（10ノッチ）では**60分の素材に足りない**。全体表示は 0.36px/秒で、
   * 10ノッチ寄せても 1.46px/秒＝2.4秒の帯が**3.5px**。
   * 寄せるたびに送り直すのは、寄せると見える範囲が狭まるから。
   * **足りなければ落とす**（黙って進むと、掴めていないのに「軽い」と出る）。
   */
  const zoomUntilGrabbable = async (sel, minW = 20) => {
    const widest = () =>
      page.evaluate((s) => {
        const els = [...document.querySelectorAll(s)]
        return els.reduce((m, e) => Math.max(m, e.getBoundingClientRect().width), 0)
      }, sel)
    for (let i = 0; i < 12; i++) {
      await scrollToFirst(sel)
      if ((await widest()) >= minW) return
      await zoomIn(visMid(), visY(40), 4)
    }
    const w = await widest()
    throw new Error(`寄せても掴める幅にならない（いちばん広い帯で ${fmt(w)}px／要 ${minW}px）`)
  }

  /**
   * **決まった時刻へ移る。画面上の位置では指さない。**
   *
   * 前は「見えている範囲の真ん中」を押していた。だが前後の項目で拡大率も
   * 横位置も変わるので、**同じ画面位置＝違う時刻**になる。
   * 「元に戻したら映像も戻る」で**違う時刻どうしを見くらべて 0.745**と出て、
   * 「元に戻したのに絵が違う」というアプリの不具合に見えた（2026-08-04）。
   *
   * **先に寄せるのが要る。** 全体表示は 0.36px/秒しかなく、押す位置が5pxずれると
   * **14秒ずれる**。20px/秒あれば、5px のずれは 0.25秒。
   */
  const seekAt = async (sec) => {
    await page.keyboard.press('Escape')
    for (let i = 0; i < 15 && (await pxPerSec()) < 20; i++) await zoomIn(visMid(), visY(40), 4)
    const pps = await pxPerSec()
    if (!(pps >= 20)) throw new Error(`寄せ切れない（${fmt(pps)}px/秒。測れていない）`)
    // 目当ての時刻が画面の左寄りに来るように送る
    await page.evaluate(
      (o) => {
        const sc = document.querySelector('.track-scroll')
        if (sc) sc.scrollLeft = Math.max(0, o.sec * o.pps - sc.clientWidth / 3)
      },
      { sec, pps }
    )
    await page.waitForTimeout(150)
    const box = await page.locator('.track-scroll').boundingBox()
    const left = await page.evaluate(() => document.querySelector('.track-scroll')?.scrollLeft ?? 0)
    const rb = await ruler()
    await page.mouse.click(box.x + sec * pps - left, rb.y + rb.height / 2)
    await page.waitForTimeout(900) // プレビューが描き変わるのを待つ
  }

  return { pxPerSec, headX, headSec, scrollToFirst, zoomUntilGrabbable, seekAt }
}
