// 11. トラック（段）の後半 — 帯の細さ・段への置き場・段の高さ・鍵
//
// ## なぜ出したか（2026-08-04）
//
// `02-タイムライン編集.mjs` が1,078行あり、7つの章が同居していた。
// **500 を超えると AI は通しで読まず grep に切り替わる**ので、話題（章）で
// 5つに割った。11章だけは1つで557行あったので、さらに2つに分けている
// （こちらが後半。前半は `02d-トラックと縦スクロール.mjs`）。
//
// ## 順番の話（**ここを動かすと後ろが崩れる**）
//
// ・**章の名前を宣言していない。** `11. トラック（段）` は前半が宣言していて、
//   **前半の直後に呼ばれる前提**（絞り込みも結果の集計も章の名前で束ねている）。
// ・`W`（クリップ1つ＝5秒ぶんの幅）は `02a-クリップを掴んで動かす.mjs` が
//   章の頭で測った物を受け取る。**ここで測り直すと値が変わる**——手前の項目が
//   拡大率を動かすので、掴む量が変わって「鍵を外しても動かせない」に化ける。
// ・「段の高さ」の2項目には元から `{ orderDependent: true }` が付いている
//   （タイムラインの高さが手前の項目の残した状態で決まるため。絞ると必ず赤い）。
// ・「縦に送っても、秒数の目盛りは残る」「境目を動かして縮めると…」は
//   前半と同じ縦スクロールの道具を使う。だから道具だけ
//   `e2e/lib/timelineVScroll.mjs` に出して、両方から作っている。
import { makeTimelineVScroll } from '../lib/timelineVScroll.mjs'

/**
 * @param {object} C 道具の束（e2e/run.mjs から渡ってくる物をそのまま）
 * @param {number} W クリップ1つぶんの幅。02a が章の頭で測った値（上の「順番の話」）
 */
export default async function (C, W) {
  const {
    trackHead,
    assert,
    check,
    clipLayout,
    dragBy,
    near,
    page,
    resetProject,
    skipHere,
    seekTo,
    v1Clips,
  } = C
  const timelineVScroll = makeTimelineVScroll(C)
  // **細い帯には端のつまみを出さない。**
  //
  // つまみは片側 7px。帯が 14px 以下だと**左右のつまみで全部埋まり、本体を
  // 掴んで動かせない**——出しても掴めないうえ、動かす操作の邪魔になる。
  // 実データの全体表示では `clip-trim` が 558個あり、タイムラインで一番多かった。
  // 掴んでいる間はタイムラインが描き直されるので、数が直に効く（2026-08-03）。
  await check('細い帯には端のつまみを出さない（寄せれば出てくる）', async () => {
    await resetProject()
    const trims = () => page.locator('.clip-trim').count()
    const scr = await page.locator('.track-scroll').boundingBox()
    const wheel = async (dir, n) => {
      await page.keyboard.down('Control')
      await page.mouse.move(scr.x + scr.width / 2, scr.y + 60)
      for (let i = 0; i < n; i++) {
        await page.mouse.wheel(0, dir * 120)
        await page.waitForTimeout(30)
      }
      await page.keyboard.up('Control')
      await page.waitForTimeout(700)
    }
    /** いちばん手前の帯の幅（px）。**回数ではなく、この幅で見る** */
    const bandW = () =>
      page.evaluate(() => {
        const c = document.querySelector('.telop-clip, .video-clip')
        return c ? Math.round(c.getBoundingClientRect().width) : 0
      })
    // **先に寄せる。** 起動直後はもう一番引いた状態（拡大率の下限）なので、
    // そこから引いても何も変わらない——最初そう書いて、実測で気づいた。
    await wheel(-1, 20)
    const wWide = await bandW()
    const nWide = await trims()
    assert(wWide > 14, `寄せても帯が細いまま（${wWide}px）`)
    assert(nWide > 0, '寄せても、つまみが1つも出ていない')

    // 引く＝帯が細くなる → 掴めない幅のつまみは出さない
    await wheel(1, 30)
    const wThin = await bandW()
    const nThin = await trims()
    assert(wThin < 14, `引いても帯が細くならない（${wThin}px）`)
    assert(nThin < nWide, `帯が ${wThin}px なのに、つまみが減らない（${nWide} → ${nThin}）`)

    // 寄せ直すと戻る（掴めなくなったままにしない）。
    // **幅が戻るまで寄せる**——同じ回数では戻らない（引くときに下限へ張り付くため）
    for (let i = 0; i < 6 && (await bandW()) <= 14; i++) await wheel(-1, 10)
    const wBack = await bandW()
    assert(wBack > 14, `寄せ直しても帯が広がらない（${wBack}px）`)
    assert((await trims()) > nThin, '帯が広がったのに、つまみが戻らない')
  })

  // **細すぎる演出の帯は作らない。**
  //
  // 出入りの演出は 0.3秒ほど。**長い動画を全体表示にすると帯の幅が約2px** で、
  // 見えていないのに1つにつき6個（頭・尻 × 帯・名前・つまみ）の要素が増える。
  // 実測で、演出248個のとき DOM が 1,678 → 3,166 になり、
  // **再生ヘッドを掴んだときの重さもそれに比例して増えていた**
  //（本人の症状は「再生ヘッドがカクつく。タイムラインだけ」。2026-08-03）。
  //
  // ここで見るのは**決まりそのもの**（`components/timeline/TelopAnimBand`）。
  // 確認用の素材はテロップが3秒しかなく、全体表示でも 0.3秒が十分な幅を持つので、
  // 画面の操作では「細すぎる」状態を作れない。**拡大率を直接下げて作る。**
  await check('細すぎる演出の帯は作らない（寄せれば出てくる）', async () => {
    await resetProject()
    // **見本帳は自分で開く。**
    //
    // 右パネルのタブと節は `resetProject()` が既定へ戻す（節の開け閉めは覚える作りだが、
    // 覚えているのは localStorage で、戻しの対象に入っている）。開けずに始めると
    // `.fx-item` が1つも無く、下の `ok` が false になって**この確認は丸ごと飛ぶ**
    // ＝一度も走らない見張りになる（2026-08-03 の通しで実際に飛んでいた。
    // 手前の「細い帯には端のつまみを出さない」が拡大率を残し、その戻しでタブも既定へ帰った）。
    await page.locator('.panel-tabs .tab', { hasText: 'トランジション' }).first().click()
    await page.waitForTimeout(300)
    if (!(await page.locator('.tpl-acc.open', { hasText: '💬 テロップ' }).count())) {
      await page.locator('.tpl-acc', { hasText: '💬 テロップ' }).first().click()
      await page.waitForTimeout(400)
    }
    // テロップに出入りの演出を付ける（帯へ落とす道は別の項目で見ている）
    const ok = await page.evaluate(() => {
      const card = document.querySelector('.fx-item')
      const target = document.querySelector('[data-tid="V2"] .telop-clip')
      if (!card || !target) return false
      const b = target.getBoundingClientRect()
      const dt = new DataTransfer()
      card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }))
      const at = { clientX: b.x + 6, clientY: b.y + b.height / 2 }
      target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, ...at }))
      target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, ...at }))
      card.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }))
      return true
    })
    // **飛ばさずに落とす。** 前は skipHere で逃げていたが、逃げると
    // 「見張りがあるのに一度も見ていない」状態が緑のまま続く（実際に続いていた）。
    // 見本帳は上で自分で開いているので、無いなら本当におかしい。
    assert(ok, '演出の一覧かテロップの帯が見つからない（見本帳を開く手順が壊れている）')
    await page.waitForTimeout(600)
    const bands = () => page.locator('.ttrans-telop').count()
    const nWide = await bands()
    assert(nWide > 0, '演出を置いても帯が出ない')

    // **目一杯まで引く**＝1秒あたりの幅が最小になり、0.3秒の帯は数pxになる
    const scr = await page.locator('.track-scroll').boundingBox()
    await page.keyboard.down('Control')
    await page.mouse.move(scr.x + scr.width / 2, scr.y + 60)
    for (let i = 0; i < 30; i++) {
      await page.mouse.wheel(0, 120)
      await page.waitForTimeout(30)
    }
    await page.keyboard.up('Control')
    await page.waitForTimeout(700)
    const nThin = await bands()
    assert(nThin < nWide, `引いても細い帯が消えない（寄せた ${nWide} → 引いた ${nThin}）`)

    // 寄せ直せば戻る（消えたままにならない）。
    //
    // **ホイールで戻さない。** 寄せ／引きはマウスの位置を中心にするので、
    // 30回ぶん往復すると横位置がずれ、テロップ自体が窓の外へ出る。
    // 帯は**見えている範囲にしか作られない**ので、そうなると
    // 「戻らない」と「そこを見ていない」の区別が付かない（実際にそれで赤くなった。
    // この確認は長らく飛ばされていて、走らせた初回に出た）。
    // 「↔ 全体表示」は起動直後と同じ所へ一発で戻る（restoreView も同じ手を使う）。
    await page.locator('.tl-zoom button').first().click()
    await page.waitForTimeout(700)
    // **先に成立を確かめる。** ここが0なら見ている場所の問題で、演出の話ではない
    assert(
      await page.locator('[data-tid="V2"] .telop-clip').count(),
      '全体表示に戻したのにテロップの帯そのものが無い（この確認は成立していない）'
    )
    assert((await bands()) > nThin, '寄せ直しても演出の帯が戻らない')
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(400)
  })
  // ※ 前は `{ orderDependent: true }` を付けていた。理由は「右パネルの演出の一覧が
  //   開いている状態が要る。それを作るのは手前の項目（見本帳を帯へ落とす所）」で、
  //   自分で開くと確かめたい所から遠くなる、という判断だった。
  //
  //   **その判断は裏目に出ていた。** 手前の項目が拡大率を残す → その戻しで
  //   右パネルのタブも既定へ帰る → **通しでも一覧が無く飛ばされる**。
  //   絞ると見ない・通しでも飛ぶ＝**一度も走らない見張り**が緑のまま残っていた
  //   （2026-08-03 の通しで発覚。252件中これ1件だけが「見ていません」だった）。
  //
  //   → 上で自分でタブと節を開くようにして印を外した。数行増えるが、
  //     **走らない見張りより、少し遠回りでも毎回走る見張りの方がよい。**

  // 「動き」の節は components/panels/MotionPresetList。  // ※ 前は { orderDependent: true } を付けていた（「見本は手前の章が作る」ため）。
  //   実際に確かめたら、開ける節の中に**最初から入っている「プリセット」10枚**が
  //   あり、手前の章に頼っていなかった。印を外して絞っても回せるようにした
  //   （2026-08-03。嘘の赤を消す印なので、要らない所に付いていると
  //     絞った確認から永久に外れる＝直したかどうかを確かめられなくなる）。

  // **新しいテロップは、被らない一番下の段に作る。**
  // 再生ヘッドを頭にして作るので、そこに何か居ると作った瞬間から重なる。
  // 相手はテロップだけでなく画像も見る（同じ段に絵が居ると文字が裏に隠れる）。
  await check('テロップを足すと、被っていない段に作られる', async () => {
    await resetProject()
    // 文字は 1〜3秒（V2）、画像は 1〜5秒（V3）。2秒の所へ足すと、両方に被る
    await seekTo(2)
    const before = await page.locator('.telop-clip').count()
    await page.keyboard.press('t')
    await page.waitForTimeout(700)
    const after = await page.locator('.telop-clip').count()
    assert(after === before + 1, `テロップが増えていない（${before} → ${after}）`)
    // V2（文字）にも V3（画像）にも作られていないこと
    const onV2 = await page.locator('[data-tid="V2"] .telop-clip').count()
    assert(onV2 === before, `被っている段（V2）に作られた（${before} → ${onV2}）`)
    const made = await page.evaluate(() => {
      const el = [...document.querySelectorAll('.telop-clip')].find((e) =>
        e.className.includes('clip-selected')
      )
      return el?.closest('[data-tid]')?.getAttribute('data-tid') ?? null
    })
    assert(made && made !== 'V2' && made !== 'V3', `被っている段に作られた（${made}）`)
  })

  // **段に置いた物は、段に固定されない。**
  // 置いたら最後その段から動かせない、という状態が長く続いていた（本人から
  // 「レーン固定で他レーンに動かせなかった」）。掴んで縦に振れば移せる。
  // 上下の動きは種類ごとに別々の仕掛け（テロップ＝state/useTimelineDrag、
  // 画像＝state/useClipDrag）なので、**両方見る**。片方だけ直っても気づけない。
  await check('テロップを縦に振ると、別の段へ移せる（往復とも）', async () => {
    await resetProject()
    const rowY = async (id) => (await page.locator(`[data-tid="${id}"]`).boundingBox()).y
    const dy = (await rowY('V3')) - (await rowY('V2')) // 上へ（負）
    assert(Math.abs(dy) > 5, `段の高さが取れない（${dy}）`)
    const n2 = await page.locator('[data-tid="V2"] .telop-clip').count()
    const n3 = await page.locator('[data-tid="V3"] .telop-clip').count()
    assert(n2 > 0, 'V2 に文字が無い状態から始まっている')

    await dragBy(page.locator('[data-tid="V2"] .telop-clip').first(), 0, dy)
    await page.waitForTimeout(500)
    const up3 = await page.locator('[data-tid="V3"] .telop-clip').count()
    assert(up3 === n3 + 1, `上の段へ移っていない（V3 が ${n3} → ${up3}）`)

    // 戻せないと「片道だけ動く」状態に気づけない
    await dragBy(page.locator('[data-tid="V3"] .telop-clip').first(), 0, -dy)
    await page.waitForTimeout(500)
    const back2 = await page.locator('[data-tid="V2"] .telop-clip').count()
    assert(back2 === n2, `元の段へ戻せない（V2 が ${n2} → ${back2}）`)
  })

  await check('画像も別の段へ移せる', async () => {
    await resetProject()
    const rowY = async (id) => (await page.locator(`[data-tid="${id}"]`).boundingBox()).y
    const dy = (await rowY('V2')) - (await rowY('V3')) // 下へ（正）
    const img = page.locator('[data-tid="V3"] .img-clip:not(.se-ghost)')
    assert(await img.count(), 'V3 に画像が無い状態から始まっている')
    const before = await page.locator('[data-tid="V2"] .img-clip:not(.se-ghost)').count()
    await dragBy(img.first(), 0, dy)
    await page.waitForTimeout(500)
    const after = await page.locator('[data-tid="V2"] .img-clip:not(.se-ghost)').count()
    assert(after === before + 1, `下の段へ移っていない（V2 が ${before} → ${after}）`)
    // **元の段へ戻す。** 戻さないと、この確認のあと画像が V2 に居座ったままになり、
    // 画面を見た人に「V2 に見覚えのない枠がある」と映る（実際そう言われた）。
    // 戻せること自体も確かめたい（片道だけ動く状態に気づけない）
    await dragBy(page.locator('[data-tid="V2"] .img-clip:not(.se-ghost)').first(), 0, -dy)
    await page.waitForTimeout(500)
    const back = await page.locator('[data-tid="V3"] .img-clip:not(.se-ghost)').count()
    assert(back >= 1, '元の段へ戻せない')
  })

  await check('段見出しの境目を掴んで、レーンの高さを変えられる', async () => {
    // 高さを変える所は、左端の丸の列から**段見出しの境目**へ移した（プレミアと同じ）。
    // 境目は見出しと一緒に動くので、縦に送っても見えている段の境目は必ず掴める。
    await timelineVScroll.scrollTo(0)
    const rowH = () =>
      page.evaluate(() =>
        Math.round(document.querySelector('.track-video')?.getBoundingClientRect().height ?? 0)
      )
    const before = await rowH()
    const divider = page.locator('.th-video .th-divider').first()
    assert(await divider.count(), '段見出しに境目が見つからない')
    await dragBy(divider, 0, 60) // 下へ＝太くなる
    await page.waitForTimeout(300)
    const after = await rowH()
    assert(after > before + 4, `境目を下へ引いても太くならない（${before} → ${after}）`)
    await dragBy(page.locator('.th-video .th-divider').first(), 0, -200) // 元の細さへ戻す
    await page.waitForTimeout(300)
  },
  // **タイムラインの高さが、手前の項目の残した状態で決まる。**
  // 低いままだと境目を掴んでも広げる余地が無く、`26 → 26` で必ず赤くなる
  //（通しでは緑。実際に stash して変更前と比べ、同じ数値で落ちるのを確かめた）。
  { orderDependent: true })

  // **既定を黙って書き換えない代わりの口。** 段の高さは1つずつ覚えているので、
  // 既定を変えても前に触った人の画面は前のまま。戻すかどうかは本人に決めてもらう
  //（`やること.md` の「段」で決めた形）。押す口が無いと、その決め方が成立しない。
  // ※ 上の「境目を掴んで高さを変えられる」と同じ手を使うので、
  //   あちらが順番の都合で赤いときは、こちらも同じ理由で赤くなる
  await check('段の高さは「既定へ戻す」で戻せる', async () => {
    const rowH = () =>
      page.evaluate(() =>
        Math.round(document.querySelector('.track-video')?.getBoundingClientRect().height ?? 0)
      )
    const base = await rowH()
    await dragBy(page.locator('.th-video .th-divider').first(), 0, 80)
    await page.waitForTimeout(300)
    const fat = await rowH()
    assert(fat > base + 4, `準備が成立していない（太くできていない ${base} → ${fat}）`)
    const reset = page.locator('button[title="段の高さを既定へ戻す"]').first()
    assert(await reset.count(), '「段の高さを既定へ戻す」の口が無い')
    await reset.click()
    await page.waitForTimeout(400)
    const back = await rowH()
    assert(back < fat - 4, `戻っていない（${fat} → ${back}）`)
  },
  // 上と同じ手（境目を掴んで太くする）を使うので、同じ理由で順番に依存する
  { orderDependent: true })

  await check('縦に送っても、秒数の目盛りは残る', async () => {
    const st = await timelineVScroll.tops('V1')
    const rulerAtTop = await page.evaluate(() => {
      const r = document.querySelector('.ruler')?.getBoundingClientRect()
      const s = document.querySelector('.track-scroll')?.getBoundingClientRect()
      return r && s ? Math.round(r.top - s.top) : null
    })
    assert(st.ruler != null, '目盛りが見つからない')
    near(rulerAtTop, 0, 2, `縦に送ったら目盛りが流れて消えた（枠の上端から ${rulerAtTop}px）`)
    await timelineVScroll.scrollTo(0)
  })

  await check('境目を動かして縮めると、上と下が一緒に小さくなる', async () => {
    // 素のままだと枠は下端だけが動く＝音声側から順に消えて、映像側は全部見えたまま。
    // それでは片側だけが減る動きになるので、映像と音声の境目を枠に残す。
    await timelineVScroll.squeeze()
    const st = await timelineVScroll.where()
    assert(st, 'タイムラインか音声の段が見つからない')
    assert(st.over > 0, `縮めたのに送り分が無い（はみ出し ${st.over}px）`)
    assert(
      st.rel > 0 && st.rel < st.view,
      `縮めたら映像と音声の境目が枠の外へ出た（枠 ${st.view}px / 境目 ${st.rel}px）`
    )
    near(
      st.rel,
      st.view / 2,
      st.view * 0.2,
      `境目が真ん中に残っていない（枠 ${st.view}px の中で ${st.rel}px）＝片側だけが減っている`
    )
  })

  await check('境目を戻して広げると、送り分が消えて全部見える', async () => {
    await dragBy(page.locator('.resizer-h').first(), 0, -400) // 上へ＝タイムラインを広げる
    await page.waitForTimeout(300)
    const st = await timelineVScroll.where()
    assert(st, 'タイムラインか音声の段が見つからない')
    assert(st.over <= 0, `広げたのにはみ出しが残っている（${st.over}px）`)
    assert(st.top === 0, `全部入るのに送ったままになっている（${st.top}px）`)
  })

  await check('鍵をかけると、そのトラックのクリップを動かせない', async () => {
    const btn = trackHead('V1').locator('button[title="ロック"]').first()
    assert(await btn.count(), 'V1 の鍵ボタンが見つからない')
    const before = await clipLayout()
    await btn.click()
    await page.waitForTimeout(300)
    await dragBy(v1Clips().nth(0), W * 1.2)
    const after = await clipLayout()
    near(after[0].x, before[0].x, 2, '鍵をかけたのにクリップが動いた')
    await btn.click() // 鍵を戻す
    await page.waitForTimeout(300)
    await dragBy(v1Clips().nth(0), 150)
    const after2 = await clipLayout()
    assert(after2[0].x > before[0].x + 5, '鍵を外しても動かせないままになっている')
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(400)
  })

  // =========================================================================
}
