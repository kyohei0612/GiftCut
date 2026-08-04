// 通しe2e の**画面の状態の見張り**（起動直後と何が違うかを数え、戻す）。
//
// ## なぜ本体から出したか（2026-08-04）
//
// `run.mjs` が 1,024行あり、**500行を超えると AI は通しで読まず grep に切り替わる**。
// ここは「**プロジェクトを開き直しても戻らない物**」だけを見る、独立した話題。
// 中身（クリップやテロップ）を戻すのは呼ぶ側の `resetProject`。
//
// ## いちばん怖い壊れ方
//
// **アプリが壊れたようにしか見えない赤に化けること。** 帯（クリップ）は
// **見えている範囲にしか作られない**ので、寄せた／送ったまま次の項目へ渡すと
//
//   「クリップの数が変わった（3 → 1）」        ← 窓の外に居るだけ。消えていない
//   「後ろのクリップが動いた（実際: -2074）」  ← 左外へ送られただけ
//
// になる。2026-08-03 に実際にこれで4件が赤くなり、**まる1日「元からある不具合」
// として控えられた**。だから見落としを足すなら **VIEW_STATE の表に足すこと**
// ——ここに載っていない物は誰も戻さない。
//
// もう1つは**見張りを甘くすること**。消えたUIを `?? ''` で守ると、いつも空文字
// ＝「ずれていない」になって、戻しが丸ごと効かなくなる（拡大率で実際に起きた）。
//
// ## 中身
//
// - `makeViewState` … 表（VIEW_STATE）と、控える・数える・戻すをまとめて作る

/**
 * @param o.page 画面（Playwright）
 * @param o.viewDirtyRef 寄せたまま終わった項目の名前を控える所（check が書く）
 * @param o.viewWarnRef 戻し切れなかった回数（最後にまとめて出す）
 */
export function makeViewState({ page, viewDirtyRef, viewWarnRef }) {
  // 画面の配置に関わる保存先。プロジェクトの中身ではないので、
  // プロジェクトを開き直しても戻らない。
  const LAYOUT_KEYS = [
    'giftcut.tabOrder', // タブの並び順
    'gc.leftW',
    'gc.rightW',
    'gc.timelineH',
    'gc.videoTrackH',
    'gc.audioTrackH'
  ]

  /**
   * 「画面の状態」の一覧。
   *
   * プロジェクトの中身ではないので、**開き直しても戻らない**もの。
   * ここに載っていないものは誰も戻さないので、前の項目の状態がそのまま
   * 次へ渡り、通しでだけ落ちる。実際、1日で3つ（タブ・見ている場所・拡大率）
   * 取りこぼして14件落とした。**足すならこの表に足すこと。**
   *
   * 各項目:
   *   name    … 落ちたときに出す名前
   *   read    … いまの値。比べられるように文字列で返す
   *   restore … 'reload'（読み込み直しでしか戻らない）か、その場で戻す関数
   */
  const VIEW_STATE = [

    {
      name: '開いたままのメニュー',
      // 右クリックのメニューだけでなく**ファイルメニューも数える**。
      // ここを見ていなかったせいで、開きっぱなしのまま次の項目へ渡り、
      // 「ファイル」をもう一度押す動き（＝閉じる）と噛み合って
      // 「メニューに項目が無い」という別物の失敗になった。
      read: () =>
        page.evaluate(() =>
          String(
            document.querySelectorAll('.ctx-menu').length +
              document.querySelectorAll('.menu-dropdown').length
          )
        ),
      // メニューは押せば閉じる。読み込み直すほどのものではない
      restore: async () => {
        await page.keyboard.press('Escape')
        await page.mouse.click(4, 4)
        await page.waitForTimeout(200)
      }
    },
    {
      // 左パネルは プロパティ / モーション の2枚。モーションを開いたまま次の項目へ
      // 行くと、文字の見た目をいじる欄が出ておらず、後の項目が別の物を見る。
      name: '左パネルのタブ',
      read: () =>
        page.evaluate(() => {
          const s = document.querySelectorAll('.panel-tabs')
          return (s[0]?.querySelector('.tab-on')?.textContent ?? '').trim()
        }),
      restore: async () => {
        const t = page.locator('.panel-tabs .tab', { hasText: 'プロパティ' }).first()
        if (await t.count()) await t.click()
        await page.waitForTimeout(200)
      }
    },
    {
      name: '右パネルのタブ',
      // 素材ビンは右パネルが「プロジェクト」のときだけ描かれる。
      // トランジションの持ち手を触ると勝手に「設定」へ切り替わる
      read: () =>
        page.evaluate(() => {
          const s = [...document.querySelectorAll('.panel-tabs-strip')]
          return (s[s.length - 1]?.querySelector('.tab-on')?.textContent ?? '').trim()
        }),
      restore: 'reload'
    },
    {
      name: 'モニタのタブ',
      read: () =>
        page.evaluate(() =>
          (document.querySelector('.panel.monitor .tab-on')?.textContent ?? '').trim()
        ),
      restore: 'reload'
    },
    ...LAYOUT_KEYS.map((k) => ({
      name: k,
      read: () => page.evaluate((key) => String(localStorage.getItem(key)), k),
      restore: 'reload'
    })),
    {
      name: 'タイムラインの見ている場所',
      // 左へ寄せておかないと、1つ目のクリップが左端に埋もれて一部しか掴めず、
      // 「動かせていない」という**別物の失敗**になる
      read: () =>
        page.evaluate(() =>
          String(Math.round(document.querySelector('.track-scroll')?.scrollLeft ?? 0))
        ),
      restore: async () => {
        await page.evaluate(() => {
          const el = document.querySelector('.track-scroll')
          if (el) el.scrollLeft = 0
        })
        await page.waitForTimeout(250)
      }
    },
    {
      name: 'タイムラインの縦の位置',
      // 縦に送ったまま次の項目へ行くと、狙った段が枠の外にいて掴めない。
      //
      // ※戻す先は**0 ではなく起動時の値**。タイムラインは高さが変わるたびに
      // 映像と音声の境目を枠に残すので、起動直後から送られていることがある
      // （実際に 32px 送られた状態が既定だった）。0 に戻すと「戻したのに違う」
      // となって、後始末そのものが失敗する。
      // ※**中身が枠に収まらない間は、送られているのが正しい。**
      // アプリは高さが変わるたびに映像と音声の境目を枠に残すので、
      // 溢れている状態では 0 に戻しても即座に送り直される。
      // そこを「戻せなかった」と数えると、段を高くしただけで後始末が失敗する
      // （音声の段を既定で高くしたときに、実際にそうなった）。
      read: () =>
        page.evaluate(() => {
          const el = document.querySelector('.track-scroll')
          if (!el) return '0'
          // **ここを甘くしないこと。**
          // 一度「収まらない間は見ない」にしたら、送られたまま次へ進み、
          // 座標で押している項目が3件ずれた（範囲選択・SEのまとめ移動・目盛りの印）。
          // 送られたままなら、それは本当に直すべき状態。
          return String(Math.round(el.scrollTop))
        }),
      restore: async (base) => {
        await page.evaluate((v) => {
          const el = document.querySelector('.track-scroll')
          if (el) el.scrollTop = Number(v) || 0
        }, base)
        await page.waitForTimeout(250)
      }
    },
    {
      name: '再生位置',
      // 前の項目が動かした再生位置が残っていると、次の項目が
      // 「そこに映っているはずの物」を別の時刻で探すことになる
      // 秒までで見る。**フレーム単位の差は無視する。**
      // 目盛りを押して戻すので1フレームずれることがあり、そこで止めても意味が無い
      // （見たいのは「5秒のまま次の項目へ行っていないか」）。
      read: () =>
        page.evaluate(() =>
          (document.querySelector('.tc-cur')?.textContent ?? '').trim().split(':').slice(0, 3).join(':')
        ),
      restore: async () => {
        // Home では戻らない（キーが割り当てられていない）ので目盛りの先頭を押す。
        // **クリップの位置から計算してはいけない。** 読み込み直した直後は
        // タイムラインが空で、クリップを探しに行くと待ち続けて実行ごと落ちる
        // （実際、通しがここで止まった）。
        const rb = await page.locator('.ruler').boundingBox().catch(() => null)
        const inner = await page.locator('.track-inner').boundingBox().catch(() => null)
        if (!rb || !inner) return
        await page.mouse.click(inner.x + 2, rb.y + rb.height / 2)
        await page.waitForTimeout(300)
      }
    },
    {
      name: 'タイムラインの拡大率',
      // 積み上がると「クリップ1つぶんの幅」が変わり、同じ距離を動かしたつもりが
      // 磁石に吸い戻される（負荷チェックでも同じ失敗をした）。
      //
      // **スライダーの値は読まない。** 2026-08-03 に拡大UIが下のバー
      // （components/timeline/ZoomBar）へ移って `.tl-zoom input[type=range]` は
      // 消えた。`?? ''` で守っていたので落ちはしないが、**いつも空文字＝
      // 「ずれていない」**になり、この戻しが丸ごと効かなくなっていた。
      // 中身の幅（拡大すると必ず変わる）で見て、戻すのは「↔ 全体表示」を押す
      // ——基準は起動直後＝全体表示なので、これで同じ所へ戻る。
      read: () =>
        page.evaluate(
          () => document.querySelector('.track-inner')?.style.width ?? ''
        ),
      restore: async () => {
        const fit = page.locator('.tl-zoom button').first()
        if (await fit.count()) await fit.click().catch(() => {})
        await page.waitForTimeout(350)
      }
    }
  ]

  /**
   * 起動直後の画面の状態。既定値を直接書くと、アプリ側で既定を変えた瞬間に
   * 毎回「ずれている」と言い出すので、実際の値を控える。
   *
   * **取るのは起動直後の1回だけ**（遅れて取ると、ずれた状態が基準になる）。
   */
  let viewBase = null
  const readView = async () => {
    const out = []
    for (const s of VIEW_STATE) out.push(await s.read())
    return out
  }
  async function captureViewBase() {
    viewBase = await readView()
  }
  /** 起動時と違っている項目を返す */
  async function viewDrift() {
    if (!viewBase) return []
    const now = await readView()
    return VIEW_STATE.map((s, i) => ({ s, now: now[i], base: viewBase[i] })).filter(
      (x) => x.now !== x.base
    )
  }
  /**
   * 画面の状態を起動直後へ戻す。
   *
   * その場で戻せるものは戻し、読み込み直しでしか戻らないものが1つでもあれば
   * 読み込み直す。**戻したあと、本当に戻ったかを確かめる**（戻せていないのに
   * 先へ進むと、原因が分からないまま次の項目が落ちる）。
   *
   * @param final これが最後の一手か。**プロジェクトを開き直す前は false。**
   *   拡大率は `.track-inner` の幅で見ている（下の VIEW_STATE 参照）が、幅は
   *   **寄せ具合と中身の長さの両方**で決まる。SRT の入れ替えのように中身の長さが
   *   変わった直後は、全体表示に戻しても幅が一致しない——**寄せ具合は正しいのに
   *   「戻し切れなかった」と数えてしまう**（2026-08-03 の通しで実際に1回出た。
   *   直後に開き直して揃うので、実害の無い嘘の警告だった）。
   *   **鳴りっぱなしの警告は読み飛ばされる**ので、中身を戻したあとの1回だけ数える。
   */
  async function restoreView(drift, final = true) {
    const why = drift.map((d) => `${d.s.name}: ${d.base} → ${d.now}`).join(' / ')
    // **誰が残したのかを必ず出す。** ここまで来ると「戻す直前の項目」しか
    // 分からないが、本当の犯人はもっと手前で寄せたまま終わった項目のことが多い
    //（間に挟まった確認が全部、その画面で測られている）。
    const by = viewDirtyRef.by ? `／残したのは「${viewDirtyRef.by}」` : ''
    console.log(`  \x1b[90m画面の状態を戻します（${why}${by}）\x1b[0m`)
    if (drift.some((d) => d.s.restore === 'reload')) {
      await page.evaluate((keys) => {
        for (const k of keys) localStorage.removeItem(k)
        // 右パネルのタブは「前回の続き」として giftcut.session に入っている。
        // ここを消さないと、読み込み直しても同じタブが復活する。
        try {
          const s = JSON.parse(localStorage.getItem('giftcut.session') || '{}')
          delete s.tab
          delete s.rsx
          localStorage.setItem('giftcut.session', JSON.stringify(s))
        } catch {
          localStorage.removeItem('giftcut.session')
        }
      }, LAYOUT_KEYS)
      await page.reload()
      // 読み込み直すと「前回の作業が残っています」が出る。
      // どちらを選んでもこの直後にプロジェクトを開き直すので、破棄でよい。
      const box = page.locator('.restore-btns button', { hasText: '破棄' })
      try {
        await box.first().waitFor({ timeout: 20000 })
        await box.first().click()
      } catch {
        /* 下書きが無ければ出ない */
      }
      await page.waitForTimeout(600)
    }
    for (const d of drift) {
      if (typeof d.s.restore === 'function') await d.s.restore(d.base)
    }
    viewDirtyRef.by = null // 戻したので、次に残した項目を新しく数える
    const left = await viewDrift()
    // **戻し切れなくても、そこで通しを打ち切らない。**
    // ここで例外にすると **1件の戻し漏れで残り全部が回らなくなる**
    //（実際、通しが4回止まった）。見落とさないよう必ず出したうえで、確認は続ける。
    //
    // ※ **この戻しは「各項目の合間」には走らない。`resetProject()` の中だけ。**
    //   つまり画面を寄せた／送った確認は、**自分で戻さないと次の確認へ漏れる**
    //   （2026-08-03: 端まで引っぱる確認が寄せたまま終わり、後ろの4件が
    //   「クリップが消えた（3 → 1）」「後ろのクリップが動いた（x = -2074）」で
    //   赤くなった。帯は見えている範囲にしか作らないので、寄せて送るだけで
    //   **消えたようにも動いたようにも見える**）。
    if (left.length && final) {
      console.log(
        `  \x1b[33m※ 戻し切れなかった: ${left
          .map((d) => `${d.s.name}=${d.now}（起動時 ${d.base}）`)
          .join(' / ')}\x1b[0m`
      )
      viewWarnRef.n++
    }
  }
  return { captureViewBase, viewDrift, restoreView }
}
