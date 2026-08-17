// 開き直しと、持ち込む素材（SE・テンプレート・素材パック・テロップ素材）。
//
// `07-保存とプロジェクト.mjs` から出した（決まり: 600超は500以下に割る）。
// 章は名乗らない——07b（2. 保存とプロジェクトの切り替え）の続きとして呼ばれる。
// 入口は ./07-保存とプロジェクト.mjs

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'

export default async function (C) {
  const {
    app, assert, check, clipLayout, clipW, dndFromBin, dragBy, fx, outDir, page,
    resetProject, section, setDialogFiles, touchedRef, v1Clips, zipNames
  } = C
  await check('保存したプロジェクトは、そのファイルから開き直しても中身が残っている', async () => {
    // **「保存したつもり」が一番損害が大きい。**
    // 書けているか・開けるか・開いたあとも同じ中身か・ファイルが残っているかを
    // 通しで見る（保存の直後だけ見ても、開き直しで落ちる型の事故は見つからない）。
    await resetProject()
    const out = join(outDir, '保存して開き直す.gcproj')
    await page.locator('.telop-clip').first().click()
    await page.waitForTimeout(300)
    await setDialogFiles(null, out)
    // 「別名で保存」はファイルメニューから（Ctrl+S は開いているファイルへ上書き）
    await page.locator('.menu-item', { hasText: 'ファイル' }).first().click()
    await page.waitForTimeout(300)
    await page.locator('.menu-drop-item', { hasText: '別名で保存' }).first().click()
    await page.waitForTimeout(2500)
    assert(existsSync(out), `保存できていない（${out}）`)
    const before = JSON.parse(readFileSync(out, 'utf-8'))
    const nCue = (before.cues ?? []).length
    const nSeg = (before.segments ?? []).length
    assert(nCue > 0, '保存した中身にテロップが入っていない')

    // いったん別の状態にしてから、そのファイルを開く
    await resetProject()
    await setDialogFiles([out], null)
    await page.keyboard.press('Control+o')
    await page.waitForTimeout(2500)
    const cont = page.locator('.modal-btn', { hasText: 'このまま続ける' })
    if (await cont.count()) {
      await cont.click()
      await page.waitForTimeout(1500)
    }
    const shown = await page.locator('.telop-clip').count()
    assert(shown === nCue, `開き直したらテロップの数が違う（${nCue} → ${shown}）`)
    const segs = await v1Clips().count()
    assert(segs === nSeg || nSeg === 0, `開き直したら切片の数が違う（${nSeg} → ${segs}）`)

    // **開いたあともファイルが残っていること。**（開くときに壊す/消す事故を見る）
    assert(existsSync(out), '開いたらプロジェクトファイルが消えた')
    const after = JSON.parse(readFileSync(out, 'utf-8'))
    assert(
      (after.cues ?? []).length === nCue,
      `開いただけで中身が変わった（${nCue} → ${(after.cues ?? []).length}）`
    )
    touchedRef.dirty = true
    await resetProject()
  })

  await check('SE は、パネルから足せて、その場で一覧に出る', async () => {
    // **一覧に「ここへ入れて」と書くだけでは入口になっていない。**
    // まっさらな SE タブには、そこから辿れるボタンが1つも無かった
    // （あるのは「フォルダ作成」＝中身の無い分類箱と「更新」だけ）。
    // ここで見るのは「足す口がある」ことと「足したら使える」ことの2つ。
    await resetProject()
    await page.locator('.panel-tabs .tab', { hasText: 'SE' }).last().click()
    await page.waitForTimeout(500)
    const bar = page.locator('.bin-toolbar').last()
    const labels = await bar.locator('button').allTextContents()
    assert(
      labels.some((t) => t.includes('音を追加')),
      `SE タブに足す口が無い（${labels.join(' / ')}）`
    )
    // **並び順まで見る。** 物が1つも無いのに「分類を作る」が先頭だと、
    // 最初にやりたいこと（入れる）へ辿り着けない
    const iAdd = labels.findIndex((t) => t.includes('音を追加'))
    const iFolder = labels.findIndex((t) => t.includes('フォルダ作成'))
    assert(
      iAdd >= 0 && (iFolder < 0 || iAdd < iFolder),
      `足す口より先に「フォルダ作成」が居る（${labels.join(' / ')}）`
    )

    // ファイルを1つ足すと、その場で一覧に出ること
    const before = await page.evaluate(async () => {
      const r = await window.giftcut.listSE()
      return (r?.items ?? []).length
    })
    const r = await page.evaluate((p) => window.giftcut.importSe([p]), fx.sound)
    assert(r?.ok, `足せない: ${JSON.stringify(r)}`)
    assert(existsSync(join(fx.userData, 'SE')), '置き場に入っていない')
    const after = await page.evaluate(async () => {
      const rr = await window.giftcut.listSE()
      return (rr?.items ?? []).length
    })
    assert(after > before, `足したのに一覧が増えない（${before} → ${after}）`)

    // **同じ物を2回足しても、上書きで消えないこと**（消えたと思われるのが一番困る）
    await page.evaluate((p) => window.giftcut.importSe([p]), fx.sound)
    const after2 = await page.evaluate(async () => {
      const rr = await window.giftcut.listSE()
      return (rr?.items ?? []).length
    })
    assert(after2 > after, `2回目が上書きされている（${after} → ${after2}）`)

    // 音でない物は断る（何を入れても入る、にしない）
    const bad = await page.evaluate((p) => window.giftcut.importSe([p]), fx.image)
    assert(bad?.ok === false, '画像まで SE に入れてしまう')
    touchedRef.dirty = true
    // **見ていたタブを戻す。** SE タブに置いたまま抜けると、次の項目が
    // プロジェクトのボタンを探して見つけられない（通しで23件が巻き添えになった）
    await resetProject()
  })

  await check('テンプレートを開く画面から、自分で作ったぶんを消せる', async () => {
    // 作ったはいいが**消す道が無い**と、増える一方で選べなくなる。
    // ただし**同梱のテンプレートは消させない**（消しても更新で戻るし、
    // 書き込みできない場所のこともある）。両方をここで見る。
    await resetProject()
    // 利用者のテンプレートは userData に居る（配った先では常にここ）。
    // 開発中の書き込み先はリポジトリ側なので、本番と同じ場所へ直接置いて見る。
    const made = join(fx.userData, 'テンプレート', 'E2E_消せるテンプレ.gcproj')
    mkdirSync(join(fx.userData, 'テンプレート'), { recursive: true })
    writeFileSync(made, JSON.stringify({ cues: [], segments: [] }), 'utf-8')
    assert(existsSync(made), `テンプレートを置けない（${made}）`)

    // 画面から消せること
    await page.locator('.menu-item', { hasText: 'ファイル' }).first().click()
    await page.waitForTimeout(300)
    await page.locator('.menu-drop-item', { hasText: 'テンプレートを開く' }).first().click()
    await page.waitForTimeout(800)
    const row = page.locator('.tpl-picker-row', { hasText: 'E2E_消せるテンプレ' }).first()
    assert(await row.count(), '作ったテンプレートが一覧に出ていない')
    const del = row.locator('.tpl-picker-del')
    assert(await del.count(), '消すボタンが無い')
    // **一発では消えない**（押し間違いで消えると作り直すしかない）
    await del.click()
    await page.waitForTimeout(200)
    assert(existsSync(made), '1回押しただけで消えてしまった')
    assert(
      (await del.innerText()).includes('消す'),
      `1回目で確認の見た目にならない（「${await del.innerText()}」）`
    )
    await del.click()
    await page.waitForTimeout(800)
    assert(!existsSync(made), '2回押しても消えていない')

    // フォルダを開くボタンが出ていること（一覧に無い物を足す道）
    const picker = page.locator('.restore-box')
    if (await picker.count()) {
      const txt = await picker.innerText()
      assert(
        txt.includes('フォルダを開く') || (await page.locator('.tpl-picker-row').count()) === 0,
        'テンプレートの置き場を開く道が無い'
      )
    }
    // **窓は必ず閉じる。** Escape では閉じない作りなので、閉じるボタンを押す
    //（開けっぱなしだと画面全体を覆い、次の項目が何も押せなくなる）
    const closeBtn = page.locator('.restore-btns button', { hasText: /閉じる|空で始める/ })
    if (await closeBtn.count()) await closeBtn.first().click()
    await page.waitForTimeout(400)

    // **同梱のテンプレートは消せない**（置き場の外を消す穴にしない）
    const bad = await page.evaluate(async () => {
      const list = await window.giftcut.listTemplates()
      const bundled = (list?.items ?? []).find((t) => !t.path.includes('AppData'))
      if (!bundled) return { skipped: true }
      const r = await window.giftcut.deleteTemplate(bundled.path)
      return { ok: r?.ok, path: bundled.path }
    })
    if (!bad.skipped) {
      assert(bad.ok === false, `同梱のテンプレートを消せてしまう（${bad.path}）`)
      assert(existsSync(bad.path), '同梱のテンプレートが消えた')
    }
    touchedRef.dirty = true
    await resetProject()
  })

  await check('素材パック（ZIP）を選ぶだけで、置き場へまとめて入る', async () => {
    // 「開いて・展開して・貼る」は手順が3つあり、**どれか1つ間違えても
    // 何も起きないだけ**なので、間違いに気づけない。ZIP を選ぶだけで済ませる。
    const zip = join(outDir, 'assets.zip')
    const stage = join(outDir, 'assets-src')
    mkdirSync(join(stage, 'telop-presets'), { recursive: true })
    mkdirSync(join(stage, 'motion-presets'), { recursive: true })
    writeFileSync(
      join(stage, 'telop-presets', 'pack.json'),
      JSON.stringify([{ name: 'E2E_パックの素材', style: { fontSize: 60 } }]),
      'utf-8'
    )
    writeFileSync(
      join(stage, 'motion-presets', 'pack.json'),
      JSON.stringify([{ name: 'E2E_パックの動き', motion: { tx: [{ t: 0, v: 10 }, { t: 0.3, v: 0 }] } }]),
      'utf-8'
    )
    // ZIP を作る（PowerShell の Compress-Archive を使う。ここは中身より結果が大事）
    const ps = spawn('powershell', [
      '-NoProfile',
      '-Command',
      `Compress-Archive -Path '${join(stage, '*')}' -DestinationPath '${zip}' -Force`
    ])
    await new Promise((res) => ps.on('close', res))
    assert(existsSync(zip), 'ZIP を作れなかった（この項目の準備が失敗）')

    const r = await page.evaluate((z) => window.giftcut.importAssetZip(z), zip)
    assert(r?.ok, `取り込めない: ${JSON.stringify(r)}`)
    assert(r.added?.['telop-presets'] >= 1, `テロップ素材が入っていない: ${JSON.stringify(r.added)}`)
    assert(r.added?.['motion-presets'] >= 1, `動きが入っていない: ${JSON.stringify(r.added)}`)
    // **置き場に本当に入っていること**（返事だけ ok なのが一番たちが悪い）
    assert(
      existsSync(join(fx.userData, 'telop-presets', 'pack.json')),
      '置き場にファイルが無い＝入ったことになっているだけ'
    )
    // **入れた種類が全部その場で使えること。**
    // 1種類でも読み飛ばすと、そこだけ再起動するまで出てこない
    //（「入れました」と言われたのに見当たらない、が起きる）
    const hit = await page.evaluate(async () => {
      const a = await window.giftcut.listTelopPresets()
      const b = await window.giftcut.listMotionPresets()
      return {
        telop: (a?.items ?? []).some((x) => x && x.name === 'E2E_パックの素材'),
        motion: (b?.items ?? []).some((x) => x && x.name === 'E2E_パックの動き')
      }
    })
    assert(hit.telop, 'テロップ素材が一覧へ出てこない')
    assert(hit.motion, '動きが一覧へ出てこない')

    // 知らない物は撒かない（受け取った ZIP を無条件に展開しない）
    const stray = join(outDir, 'stray.zip')
    mkdirSync(join(outDir, 'stray-src'), { recursive: true })
    writeFileSync(join(outDir, 'stray-src', 'あやしい.txt'), 'x', 'utf-8')
    const ps2 = spawn('powershell', [
      '-NoProfile',
      '-Command',
      `Compress-Archive -Path '${join(outDir, 'stray-src', '*')}' -DestinationPath '${stray}' -Force`
    ])
    await new Promise((res) => ps2.on('close', res))
    const r2 = await page.evaluate((z) => window.giftcut.importAssetZip(z), stray)
    assert(r2?.ok === false, '素材の入っていない ZIP を受け入れてしまう')
    assert(
      !existsSync(join(fx.userData, 'あやしい.txt')),
      '知らないファイルを置き場へ撒いている'
    )
    // **入れた物は片付ける。**
    // 置き場は次の項目とも共有なので、残すと件数を数えている項目が狂う
    //（実際、動きの見本帳の件数が1件ずれて通しで落ちた）
    for (const f of [
      join(fx.userData, 'motion-presets', 'pack.json'),
      join(fx.userData, 'telop-presets', 'pack.json')
    ])
      rmSync(f, { force: true })
    await page.evaluate(() => window.giftcut.listMotionPresets())
  })

  await check('自分で足したテロップ素材は、更新で消えない場所から読まれる', async () => {
    // **自動更新はアプリのフォルダを丸ごと入れ替える。**
    // 読む場所が userData の外へ移ると、更新した瞬間に利用者の素材が消える
    // ——しかも消えたことに気づくのは、次に使おうとした時。
    // 「置き場を開く」の行があるかは別の項目で見ているので、ここでは
    // **その場所に置いた物が本当に読まれるか**を見る。
    const dir = join(fx.userData, 'telop-presets')
    mkdirSync(dir, { recursive: true })
    const mark = 'E2E_更新で消えない'
    writeFileSync(
      join(dir, 'e2e-keep.json'),
      JSON.stringify([{ name: mark, style: { fontSize: 64, color: '#fff' } }]),
      'utf-8'
    )
    const got = await page.evaluate(async (mark) => {
      const r = await window.giftcut.listTelopPresets()
      const items = (r?.items ?? []).map((x) => (x && typeof x === 'object' ? x.name : ''))
      return { ok: !!r?.ok, hit: items.includes(mark), n: items.length }
    }, mark)
    assert(
      got.hit,
      `userData/telop-presets に置いた素材が読まれない（${got.n}件・ok=${got.ok}）` +
        '＝更新でユーザーの素材が消える置き場になっている疑い'
    )
  })

  await check('**サブPCへ移す: 素材と設定ごとまとめ、開くと置き場へ戻る**', async () => {
    // 2026-08-17 に足した。**持ち出しの往復は、それまで e2e が1件も無かった。**
    //
    // ## なぜ往復で見るか
    //
    // 「ZIP に入っている」だけでは、移した先で使える保証にならない。
    // 逆に「置き場に在る」だけでも、それが**元から在っただけ**かもしれない。
    // → 入れる → **消す** → 開く → 戻っている、まで通して初めて確かめたことになる。
    //
    // わざと壊すなら `main/projectPackIpc` の `settingsForZip()` を `[]` にする。
    // → 「ZIP に設定が入っていない」で落ちる（確認済み）。
    const zip = join(outDir, '移行テスト.zip')
    rmSync(zip, { force: true })
    const seDir = join(fx.userData, 'SE')
    const seFile = join(seDir, 'e2e-移行.wav')
    const storeFile = join(fx.userData, 'ユーザー設定.json')
    mkdirSync(seDir, { recursive: true })
    writeFileSync(seFile, 'E2E_SE_中身', 'utf-8')
    writeFileSync(storeFile, JSON.stringify({ 'giftcut.e2e移行': 'ここに在った' }), 'utf-8')

    await setDialogFiles(null, zip)
    await page.locator('.menu-item', { hasText: 'ファイル' }).first().click()
    await page.waitForTimeout(300)
    await page.locator('.menu-drop-item', { hasText: 'まとめて書き出す' }).first().click()
    // **`existsSync` で待たない。** ZIP は作られた瞬間に真になり、
    // 書き終わる前に読んで「壊れた ZIP」と出る（CLAUDE.md の「測れたか」）。
    // 実際にそれで1回落ちた。**アプリ自身の「終わった」合図（お知らせ）を待つ。**
    const 済んだ = async () =>
      (await page.locator('.toast').allTextContents()).join(' ').includes('まとめました')
    let 待った = 0
    for (; 待った < 120 && !(await 済んだ()); 待った++) await page.waitForTimeout(500)
    assert(
      await 済んだ(),
      `まとめ終わりのお知らせが出ない（${待った / 2}秒待った。いまのお知らせ: ` +
        `${(await page.locator('.toast').allTextContents()).join(' / ') || 'なし'}）`
    )
    assert(existsSync(zip), `お知らせは出たのに ZIP が無い（${zip}）`)

    const names = await zipNames(zip)
    assert(
      names.includes('設定/SE/e2e-移行.wav'),
      `ZIP に置き場の素材が入っていない（設定/ で始まるもの: ${
        names.filter((n) => n.startsWith('設定/')).slice(0, 5).join(' / ') || 'なし'
      }）`
    )
    assert(names.includes('設定/ユーザー設定.json'), 'ZIP にお気に入り等の控えが入っていない')

    // **まっさらなサブPCの真似。** ここで消さないと、次の assert は
    // 「元から在っただけ」でも通る（＝何も試さないまま緑になる）
    rmSync(seFile, { force: true })
    rmSync(storeFile, { force: true })
    assert(!existsSync(seFile), '消せていない（この先の確認が意味を持たない）')

    await setDialogFiles([zip], null)
    await page.locator('.menu-item', { hasText: 'ファイル' }).first().click()
    await page.waitForTimeout(300)
    await page.locator('.menu-drop-item', { hasText: 'まとめたプロジェクトを開く' }).first().click()
    await page.waitForTimeout(600)
    const cont = page.locator('.modal-btn', { hasText: 'このまま続ける' })
    if (await cont.count()) {
      await cont.click()
      await page.waitForTimeout(300)
    }
    for (let i = 0; i < 60 && !existsSync(seFile); i++) await page.waitForTimeout(500)

    assert(existsSync(seFile), '開いても、置き場の素材が戻っていない')
    assert(readFileSync(seFile, 'utf-8') === 'E2E_SE_中身', '戻ったが中身が違う')
    assert(existsSync(storeFile), '開いても、お気に入り等の控えが戻っていない')
    assert(
      JSON.parse(readFileSync(storeFile, 'utf-8'))['giftcut.e2e移行'] === 'ここに在った',
      '控えは戻ったが、中身が違う'
    )
    await page.waitForSelector('[data-tid="V1"] .video-clip', { timeout: 15000 })
    touchedRef.dirty = true
    await resetProject()
  })

  await check('取り消せない操作の実行ボタンが赤い', async () => {
    await setDialogFiles([fx.srt], null)
    await page.locator('button', { hasText: 'SRT読込' }).first().click()
    await page.waitForSelector('.modal-box')
    const danger = await page.locator('.modal-btn.danger').count()
    assert(danger > 0, '置き換えのボタンが赤（danger）になっていない')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    assert((await page.locator('.modal-box').count()) === 0, 'Escape で確認を中止できない')
  })

  // =========================================================================
}
