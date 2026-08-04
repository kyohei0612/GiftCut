// 通しe2e の**記録と、1件を回す段取り**（札を出す・飛ばす・落ちた時を残す）。
//
// ## なぜ本体から出したか（2026-08-04）
//
// `run.mjs` が 1,024行あり、**500行を超えると AI は通しで読まず grep に切り替わる**。
// ここは「1件をどう回して、どう控えるか」だけを持つ。**何を確認するかは知らない**
// （確認そのものは e2e/checks/*.mjs にある）。
//
// ## いちばん怖い壊れ方
//
// **見ていないのに緑になること。** ここは3か所で確認を飛ばす（--shot / --only /
// orderDependent）ので、飛ばした物を `skipped` に数え忘れると、
// **0件回して「通った」**と読んでしまう。飛ばしたら必ず results に残すこと。
//
// もう1つは**後始末の警告が鳴りっぱなしになること**。窓の閉じ忘れ・画面の寄せ
// っぱなしは「誰の後始末か」を名指しで出す作りにしてある（黙って直すと、
// 閉じ忘れ自体が見えなくなる）。鳴りすぎる警告は読み飛ばされて、あるだけ有害。
//
// ## 中身
//
// - `makeRunReport` … 下の道具と、共有の控え（*Ref）をまとめて作る
import { mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { clearModals } from '../dismiss.mjs'

/**
 * 記録・札・1件を回す段取りを1つの束にして作る。
 *
 * @param o.ROOT リポジトリの根（落ちた画面の置き場を組むのに使う）
 * @param o.SLOW/FAST/ONLY/SHOT_ONLY/RATIO readRunArgs() の束をそのまま渡す
 *
 * **画面（page）は起動より後にしか無い**ので、引数では受け取らず
 * `setPage` で後から入れる。`curSection` も中で書き換わるため、値ではなく
 * `sectionName()` で読む（写しを配ると、章が変わっても古い名前が札に出る）。
 */
export function makeRunReport({ ROOT, SLOW, FAST, ONLY, SHOT_ONLY, RATIO }) {
const results = []
// 前のリセット以降に確認を実行したか（実行していれば状態が変わっている可能性がある）
const touchedRef = { dirty: true }
/** 後始末で戻し切れなかった回数。最後にまとめて出す（黙って流さない） */
const viewWarnRef = { n: 0 }
/** 縦横比を当て直す関数の置き場（check から呼ぶ。定義は下の run の中） */
const applyRatioRef = { fn: null }
/**
 * **画面を寄せた／送ったまま終わった項目を、名指しで覚えておく。**
 *
 * 画面の状態を戻すのは `resetProject()` の中だけなので、寄せっぱなしは
 * **次の項目以降へそのまま漏れる**。しかも帯（クリップ）は**見えている範囲にしか
 * 作られない**ので、漏れると後ろの確認が
 *
 *   「クリップの数が変わった（3 → 1）」  ← 窓の外に居るだけ。消えていない
 *   「後ろのクリップが動いてしまった（実際: -2074）」  ← 左外へ送られただけ
 *
 * という**アプリが壊れたようにしか見えない**赤に化ける。
 *
 * 2026-08-03 に実際にこれで4件が赤くなり、**まる1日「元からある不具合」として
 * 控えられた**（リファクタ前へ戻しても同じ赤が出たので、そう見えた——
 * 原因の確認が、その戻し先にも既に入っていた）。
 *
 * 窓の閉じ忘れと同じ扱いにする＝**黙って直さず、誰の後始末かを出す。**
 * `fn` は viewDrift の置き場（定義は下の run の中）、`by` は最初に残した項目の名前。
 */
const viewDirtyRef = { fn: null, by: null }
/**
 * この比率では成り立たない確認を、理由付きで飛ばす。
 *
 * **黙って通さないこと。** 元動画（横長）と直接比べる作りの確認は、
 * 縦長にすると必ず食い違う（レターボックスの黒帯が入るため）。
 * 赤にしても直しようが無く、緑にすると見ていないのに見たことになる。
 */
function skipHere(reason) {
  const e = new Error(reason)
  e.__skip = reason
  throw e
}
let curSection = ''
let pageRef = null
const TOTAL_HINT = 46 // だいたいの件数（進み具合の表示用。増減しても表示が崩れないだけ）

/**
 * アプリの画面に「今なにを確認しているか」を出す。
 *
 * 操作が速すぎて何のテストか分からない、という声を受けて足した。
 * アプリのコードには一切触らず、テスト側から画面に札を貼るだけ。
 * pointer-events: none なので、テストのクリック判定には影響しない。
 */
async function banner(state) {
  if (!pageRef) return
  try {
    await pageRef.evaluate((s) => {
      let el = document.getElementById('__e2e_banner')
      if (!el) {
        el = document.createElement('div')
        el.id = '__e2e_banner'
        el.style.cssText = [
          'position:fixed', 'left:50%', 'top:14px', 'transform:translateX(-50%)',
          'z-index:2147483647', 'pointer-events:none',
          'font:13px/1.5 system-ui,sans-serif', 'color:#fff',
          'background:#0b1220f2', 'border:1px solid #ffffff26', 'border-radius:12px',
          'padding:10px 16px', 'min-width:420px', 'max-width:78vw',
          'box-shadow:0 8px 30px #0009', 'text-align:center'
        ].join(';')
        document.body.appendChild(el)
      }
      const color = s.status === 'ok' ? '#4ade80' : s.status === 'ng' ? '#f87171' : '#7dd3fc'
      const mark = s.status === 'ok' ? '✓' : s.status === 'ng' ? '✗' : '▶'
      el.innerHTML =
        `<div style="font-size:11px;opacity:.6;letter-spacing:.06em">${s.section} ・ ${s.done}/${s.total}</div>` +
        `<div style="margin-top:3px;font-size:14px;font-weight:700;color:${color}">${mark} ${s.name}</div>` +
        (s.err ? `<div style="margin-top:4px;font-size:11px;color:#fca5a5">${s.err}</div>` : '') +
        `<div style="margin-top:8px;height:3px;background:#ffffff1a;border-radius:2px;overflow:hidden">` +
        `<div style="height:100%;width:${Math.round((s.done / Math.max(1, s.total)) * 100)}%;background:${color}"></div></div>`
    }, state)
  } catch {
    /* 画面が入れ替わった直後などは無視 */
  }
}
const esc = (t) => String(t).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c])

async function section(name) {
  curSection = name
  console.log(`\n\x1b[1m${name}\x1b[0m`)
}
async function check(name, fn, opts = {}) {
  // setup:true の項目は「絞っても必ず通す」。ここを飛ばすと編集中の状態が
  // 作られず、以降が全部こけて何を見ているのか分からなくなる。
  // --shot は「今の画面を見たいだけ」。確認は全部飛ばす。
  if (SHOT_ONLY && !opts.setup) {
    results.push({ name, skipped: true })
    return
  }
  if (ONLY.length && !opts.setup && !ONLY.some((w) => name.includes(w) || curSection.includes(w))) {
    results.push({ name, skipped: true })
    return
  }
  // **絞ったときは「順番に依存する項目」を見ない。** 手前が作った状態に
  // 寄りかかっている確認は、絞ると必ず赤くなるが通しでは緑＝嘘の赤で、
  // 見るたびに stash して変更前と比べる羽目になる（実際に何度もやった）。
  // 印を付けるときは**なぜ順番に依存するのか**を必ずその場に書くこと。
  if (ONLY.length && opts.orderDependent) {
    results.push({ name, skipped: true })
    console.log(`  \x1b[2m− ${name}（順番に依存するので、絞ったときは見ない）\x1b[0m`)
    return
  }
  const total = Math.max(TOTAL_HINT, results.length + 1)
  await banner({ status: 'run', name: esc(name), section: esc(curSection), done: results.length, total })
  // 何を確認しているか読めるだけの間を置く（--slow ならもっと長く）
  // **--fast なら間を置かない。** 人が眺めないなら要らない間で、221件で約70秒になる
  if (pageRef && !FAST) await pageRef.waitForTimeout(SLOW ? 900 : 320)
  // **前の項目が窓を開けっぱなしにしていたら、ここで閉じる。**
  //
  // 開いたままの窓は画面全体を覆うので、以降の項目が「押せない」で落ち続ける。
  // 実際、通しで**1件の閉じ忘れが20件以上を巻き添え**にした。
  // ただし黙って直すと閉じ忘れ自体が見えなくなるので、**誰の後始末かを出す**。
  if (pageRef && !opts.setup) {
    try {
      if (await pageRef.locator('.export-overlay').count()) {
        const prev = results.filter((r) => !r.skipped).slice(-1)[0]?.name ?? '（不明）'
        console.log(
          `  \x1b[33m※ 窓が開いたままでした。閉じて続けます（直前: ${prev}）\x1b[0m`
        )
        // どける手順は e2e/dismiss.mjs に1つだけ置いてある
        // （道具ごとに書くと必ずどれかが抜ける。実際1日で4回踏んだ）
        await clearModals(pageRef)
      }
    } catch {
      /* 閉じられなくても本題は続ける */
    }
  }
  // 縦横比を指定して回すときは、**各項目の頭で当て直す**。
  // 比率はプロジェクトに入っているので、開き直すたびに 16:9 へ帰る。
  // ここで当て直さないと、縦長で通したつもりが途中から横長になっていて、
  // 通ったことにならない（起動直後は窓が出ていて押せないので、そこも拾い直す）
  if (pageRef && RATIO !== '16:9' && typeof applyRatioRef.fn === 'function') {
    await applyRatioRef.fn().catch(() => {})
  }
  // **1件ずつ時間を測る。**
  // どれが重いのかを誰も知らないまま「多すぎる気がする」と削ると、
  // 軽くて価値のある物を消して、重くて価値の低い物が残る。
  const t0 = Date.now()
  try {
    touchedRef.dirty = true
    await fn()
    results.push({ name, ok: true, ms: Date.now() - t0, section: curSection })
    console.log(`  \x1b[32m✓\x1b[0m ${name}`)
    await banner({ status: 'ok', name: esc(name), section: esc(curSection), done: results.length, total })
  } catch (e) {
    // **「この比率では見られない」は赤にしない。**
    // ただし黙って通すと、見ていないのに緑を見て「大丈夫」と読んでしまう。
    // 飛ばした理由をその場に出し、最後の集計でも「見ていない」に数える。
    if (e && e.__skip) {
      results.push({ name, skipped: true })
      console.log(`  \x1b[33m－\x1b[0m ${name}\n      見ていません: ${e.__skip}`)
      return
    }
    const msg = String(e?.message ?? e).split('\n')[0]
    const state = await ngState()
    let png = null
    if (pageRef) {
      png = join(ROOT, 'e2e', 'shots', `NG-${String(results.length + 1).padStart(2, '0')}.png`)
      try {
        mkdirSync(dirname(png), { recursive: true })
        await pageRef.screenshot({ path: png })
      } catch {
        png = null
      }
    }
    results.push({ name, ok: false, err: String(e?.message ?? e), state, png, ms: Date.now() - t0, section: curSection })
    // **落ちた理由はその場で1行出す。**
    // 「回し終わってから報告書を読む」だと、読むためにもう一度回すことになる。
    // 印を付けておけば、流しっぱなしのまま ✓ ✗ 理由 だけを拾える。
    // 落ちた時の画面は最後の一覧にだけ出す（同じ物を2度出すと理由が埋もれる）。
    console.log(`  \x1b[31m✗\x1b[0m ${name}\n      \x1b[31m理由:\x1b[0m ${msg}`)
    await banner({
      status: 'ng',
      name: esc(name),
      section: esc(curSection),
      done: results.length,
      total,
      err: esc(msg)
    })
    if (pageRef) await pageRef.waitForTimeout(1200) // 失敗は読む時間を長めに
  }
  // 画面を寄せた／送ったまま終わったなら、**最初に残した項目の名前だけ**控える
  //（2件目以降は、1件目の漏れを引き継いでいるだけなので上書きしない）。
  // 出すのは restoreView。ここで出すと、正しく resetProject を呼ぶ項目まで
  // 毎回鳴って**警告が読み飛ばされる**（効かない見張りは、あるだけ有害）。
  if (typeof viewDirtyRef.fn === 'function' && !viewDirtyRef.by) {
    const d = await viewDirtyRef.fn().catch(() => [])
    if (d.length) viewDirtyRef.by = name
  }
  if (pageRef) await pageRef.waitForTimeout(SLOW ? 500 : 180)
}
/**
 * 落ちた瞬間の「画面がどうなっていたか」を残す。
 *
 * 通しでだけ落ちる項目は、単体で回すと通ってしまうので、あとから調べ直せない。
 * メッセージだけでは「押したのに効かなかった」としか分からず、
 * 前の項目が何を残したのかが読めない。撮るのは落ちたときだけ。
 */
async function ngState() {
  if (!pageRef) return null
  try {
    return await pageRef.evaluate(() => {
      const txt = (el) => (el?.textContent ?? '').trim().replace(/\s+/g, ' ')
      const all = (sel) => [...document.querySelectorAll(sel)]
      return {
        // 画面に出ているお知らせ（失敗の理由はたいていここに出る）
        お知らせ: all('.toast, .toasts > *').map((e) => txt(e).slice(0, 160)),
        // 開いたままの物（これが残っていると、以降のクリックが全部吸われる）
        メニュー: all('.ctx-menu').length,
        ダイアログ: all('.modal, .restore-box').map((e) => txt(e).slice(0, 40)),
        // パネルの配置
        選ばれているタブ: all('.panel-tabs-strip').map((s) => txt(s.querySelector('.tab-on'))),

        パネル幅: {
          左: localStorage.getItem('gc.leftW'),
          右: localStorage.getItem('gc.rightW'),
          並び: localStorage.getItem('giftcut.tabOrder')
        },
        モニタ: txt(document.querySelector('.panel.monitor .tab-on')),
        // 素材ビン
        見えている素材: all('.media-card')
          .filter((e) => e.getBoundingClientRect().height > 0)
          .map((e) => txt(e).slice(0, 24)),
        折りたたみ: all('.tpl-acc').map((e) => `${txt(e).slice(0, 12)}:${e.className.includes('open') ? '開' : '閉'}`),
        // タイムライン
        クリップ数: all('[data-tid="V1"] .video-clip:not(.se-ghost)').length,
        // 選ばれている印は .clip-selected（.sel という名前は今は使っていない）。
        // 古い名前のままだと、何を選んでいても必ず 0 と出て調べる手掛かりを失う。
        選択中: all('.clip-selected').length,
        再生位置: txt(document.querySelector('.tc-cur'))
      }
    })
  } catch {
    return null
  }
}
  return {
    results,
    touchedRef,
    viewWarnRef,
    applyRatioRef,
    viewDirtyRef,
    TOTAL_HINT,
    skipHere,
    banner,
    esc,
    section,
    check,
    setPage: (p) => (pageRef = p),
    sectionName: () => curSection
  }
}
