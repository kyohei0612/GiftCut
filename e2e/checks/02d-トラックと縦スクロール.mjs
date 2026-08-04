// 11. トラック（段）の前半 — 段の名前・縦スクロールの追従・帯が受け付ける物
//
// ## なぜ出したか（2026-08-04）
//
// `02-タイムライン編集.mjs` が1,078行あり、7つの章が同居していた。
// **500 を超えると AI は通しで読まず grep に切り替わる**ので、話題（章）で
// 5つに割った。11章だけは1つで557行あったので、さらに2つに分けている
// （こちらが前半。後半は `02e-帯の細さと段の高さ.mjs`）。
//
// ## 順番の話（**ここを動かすと後ろが崩れる**）
//
// ・章の宣言（`11. トラック（段）`）をするのはこのファイル。**後半は宣言せず、
//   ここに続けて呼ばれる前提**（絞り込みも結果の集計も章の名前で束ねている）。
// ・縦スクロールの道具（`timelineVScroll`）は前半と後半の両方が使うので
//   `e2e/lib/timelineVScroll.mjs` へ出した。元は1つのファイルの中の局所変数。
// ・「縦に送っても、段の見出しが行についてくる」は、直前の項目が縮めた
//   タイムラインの上で測る。**縮んでいないと送り分が0で成立しない。**
//
// ※ `trackHead` を受け取っているのは、下に「run.mjs にある」と書いた説明文に
//   名前が出るため（実際に掴むのは後半）。走らせる前の見張り
//   （`e2e/lint-checks.mjs`）は**コメントの中の名前も見る**ので、
//   受け取らないと「書き忘れ」として止まる。
import { makeTimelineVScroll } from '../lib/timelineVScroll.mjs'

export default async function (C) {
  const {
    trackHead,
    assert,
    check,
    near,
    page,
    resetProject,
    section,
  } = C
  // =========================================================================
  section('11. トラック（段）')
  await resetProject()

  /** 指定した段のヘッダー（V1 / A1 など） */
  // trackHead は章をまたいで使うので e2e/run.mjs にある

  await check('トラック名をダブルクリックして名前を変えられる', async () => {
    const name = page.locator('.th-name').first()
    const before = await name.textContent()
    await name.dblclick()
    await page.waitForTimeout(300)
    const input = page.locator('.modal-input')
    assert(await input.count(), 'ダブルクリックしても名前の入力欄が出ない')
    await input.fill('テスト段')
    await page.locator('.modal-btn.primary').click()
    await page.waitForTimeout(300)
    // 段の頭は「番号＋名前」に分かれている（番号は切らせない作りにした）。
    // 見るのは名前の方。全体を見ると "V3テスト段" になって食い違う。
    const after = await page.locator('.th-label').first().textContent()
    assert(after === 'テスト段', `名前が変わっていない: ${before} → ${after}`)
    // 番号は残っている（どの段か分からなくならない）
    const id = await page.locator('.th-id').first().textContent()
    assert(id.trim().length > 0, '段の番号が消えた')
  })

  await check('トラック名をクリックしても、意味のない青い表示にならない', async () => {
    // 以前は「ターゲット」という、どこからも参照されない死んだ表示に占領されていた
    await page.locator('.th-name').first().click()
    await page.waitForTimeout(200)
    const cls = await page.locator('.th').first().getAttribute('class')
    assert(cls.includes('th-selected'), 'クリックしてもトラックが選択状態にならない')
  })

  // 縦スクロールの道具は e2e/lib/timelineVScroll.mjs に出してある。
  // **後半（02e-帯の細さと段の高さ.mjs）からも同じ物を使う**ので、
  // どちらか片方に置くと「持っていない方」が触れなくなる。
  const timelineVScroll = makeTimelineVScroll(C)

  await check('タイムラインを縮めると、中身は縦に送れるようになる', async () => {
    await timelineVScroll.squeeze()
    const st = await timelineVScroll.tops('V1')
    assert(st.over > 0, `縮めたのに送り分が無い（はみ出し ${st.over}px）`)
  })

  await check('縦に送っても、段の見出しが行についてくる', async () => {
    // 縮めた時点で既に真ん中へ送られている（境目を残す動き）ので、
    // 「最初は先頭」と決めつけない。**送る前の位置を自分で作る。**
    await timelineVScroll.scrollTo(0)
    const before = await timelineVScroll.tops('V1')
    assert(before.row != null && before.head != null, 'V1 の行か見出しが見つからない')
    // 行と見出しは、送る前は同じ高さに並んでいる
    near(before.head, before.row, 2, '送る前から行と見出しがずれている')
    await timelineVScroll.scrollTo(60)
    const after = await timelineVScroll.tops('V1')
    near(
      before.row - after.row,
      60,
      2,
      `送った量と行の動きが合わない（${before.row} → ${after.row}／送った量 60px）`
    )
    // ここが本体。**見出しだけ残ると、V1 の行に別の段の中身が見える。**
    near(
      after.head,
      after.row,
      2,
      `行と見出しがずれた（行 ${after.row} / 見出し ${after.head}）＝掴める段と見えている段が食い違う`
    )
  })

  // **見本帳は、タイムラインの帯にも落とせる。**
  // プレビューの文字の上には元から落とせたのに、帯には落とせなかった。
  // 同じ物を同じように扱えないと「どこへ落とせるのか」を毎回思い出す羽目になる。
  await check('見本帳をタイムラインの帯へ落とすと、その文字に当たる', async () => {
    await resetProject()
    const strip = page.locator('.panel-tabs-strip').last()
    await page.locator('.telop-clip').first().click()
    await page.waitForTimeout(300)
    await strip.locator('.tab', { hasText: 'テロップ' }).first().click()
    await page.waitForTimeout(600)
    // **節を開いてから数える。** 2026-08-03 に「触っていない所は畳んで始まる」へ
    // 変わったので、開く前は見本が1枚も描かれていない（画面にも「下の ▶ を押して
    // 開くと…」と出ている）。開かずに数えていた頃の書き方は嘘になる。
    const sec = page.locator('.tpl-acc').first()
    assert(await sec.count(), '見本帳の節が1つも無い')
    if (!(await sec.getAttribute('class'))?.includes('open')) {
      await sec.click()
      await page.waitForTimeout(600)
    }
    assert(await page.locator('.tpl-card').count(), '節を開いても見本が1つも無い')
    // **見るのは「帯が受け付けるか」。** 直す前は見本帳を無視していた（＝
    // dragover を受け入れず、落としても何も起きない）。当てた結果まで見ようとすると
    // 「元と違う見本を用意する」準備が要り、確認したい所から遠くなる。
    // 当てる中身そのものは、プレビューの文字へ落とす道と**同じ関数**を通っている。
    const accepted = await page.evaluate(() => {
      const card = document.querySelector('.tpl-card')
      const band = document.querySelector('[data-tid="V2"] .telop-clip')
      if (!card || !band) return null
      const dt = new DataTransfer()
      card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }))
      const b = band.getBoundingClientRect()
      const at = { clientX: b.x + b.width / 2, clientY: b.y + b.height / 2 }
      const over = new DragEvent('dragover', {
        bubbles: true,
        cancelable: true,
        dataTransfer: dt,
        ...at
      })
      band.dispatchEvent(over)
      const drop = new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer: dt,
        ...at
      })
      band.dispatchEvent(drop)
      card.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }))
      return { over: over.defaultPrevented, drop: drop.defaultPrevented }
    })
    assert(accepted, '見本または帯が見つからない')
    assert(accepted.over, '帯が見本帳を受け付けない（落とし先になっていない）')
    assert(accepted.drop, '帯へ落としても何も起きない')
  })

  // **エフェクト（揺れ・脈動）も掴んで置ける。**
  //
  // 見本帳・アイコン・出入りの演出は先に掴めるようにしてあり、**ここだけ
  // クリック専用で取り残されていた**（本人の方針＝「クリックが多い。D&D でも
  // 持ってこられるように」）。2026-08-03 に足した。
  //
  // ※ **見ているのは「帯が受け付けるか」まで。** 強調は再生したときの動きなので
  //   DOM に印が出ず、付いたかどうかをここからは読めない。当てる先は既にある
  //   `patchCueAnim`（クリックの道と同じ）を通しているので、そこは信じている。
  //   **つまり「落としても何も起きない」は捕まえるが、「別の物が付いた」は
  //   捕まえられない。** 付ける中身を変えるときは、この確認では守られない。
  await check('エフェクトをタイムラインの帯へ落とせる（クリックは据え置き）', async () => {
    await resetProject()
    await page.locator('.panel-tabs .tab', { hasText: 'トランジション' }).first().click()
    await page.waitForTimeout(300)
    // 節は畳んで始まるので自分で開く（開かないと .fx-item が1つも無い）
    if (!(await page.locator('.tpl-acc.open', { hasText: '✨ エフェクト' }).count())) {
      await page.locator('.tpl-acc', { hasText: '✨ エフェクト' }).first().click()
      await page.waitForTimeout(400)
    }
    const accepted = await page.evaluate(() => {
      // 強調のボタンは「エフェクト」の節の中。掴める印（fx-draggable）で選ぶ
      const chip = document.querySelector('.fx-item.fx-draggable')
      const band = document.querySelector('[data-tid="V2"] .telop-clip')
      if (!chip || !band) return null
      const dt = new DataTransfer()
      chip.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }))
      const b = band.getBoundingClientRect()
      const at = { clientX: b.x + b.width / 2, clientY: b.y + b.height / 2 }
      const over = new DragEvent('dragover', {
        bubbles: true,
        cancelable: true,
        dataTransfer: dt,
        ...at
      })
      band.dispatchEvent(over)
      const drop = new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer: dt,
        ...at
      })
      band.dispatchEvent(drop)
      chip.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }))
      return { over: over.defaultPrevented, drop: drop.defaultPrevented }
    })
    assert(accepted, 'エフェクトの札または帯が見つからない（節を開く手順が壊れている）')
    assert(accepted.over, '帯がエフェクトを受け付けない（落とし先になっていない）')
    assert(accepted.drop, '帯へ落としても何も起きない')
  })
}
