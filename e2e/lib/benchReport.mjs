// 負荷チェックの**記録と表示**。行を貯め、画面に札を出し、最後にまとめる。
//
// ## なぜ本体から出したか（2026-08-04）
//
// 話題で分けたうちの1つ。**何を測るかとは無関係**で、測る側（./bench-ops ほか）は
// `say` / `done` の2つしか使わない。
//
// ## 札はアプリのコードに一切触らない
//
// 外から `<div>` を貼るだけ（pointer-events:none）。**本番のコードに仕掛けを
// 入れない**——入れると、測るために足した物が製品に残る。
//
// ## 撮る前に札を隠すこと（呼ぶ側の仕事）
//
// 隠さないと、札の文言の違いだけで「見た目が変わった」と誤判定する
// （実際にそれで一致度が 0.89 まで落ちた）。
//
// ## 中身
//
// - `makeReporter` … 記録と札を1つにまとめて返す
const esc = (t) => String(t).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c])

export function makeReporter(totalSteps) {
  const rows = []
  let pageRef = null
  let stepNo = 0
  const TOTAL_STEPS = totalSteps

function row(lens, what, detail, verdict) {
  rows.push({ lens, what, detail, verdict })
  const mark = verdict === 'ok' ? '\x1b[32m✓\x1b[0m' : verdict === 'warn' ? '\x1b[33m△\x1b[0m' : '\x1b[31m✗\x1b[0m'
  console.log(`  ${mark} [${lens}] ${what}  ${detail}`)
}

/**
 * 画面に「今なにを測っているか」を出す。
 * アプリのコードには一切触らず、外から札を貼るだけ（pointer-events:none）。
 */
async function banner(state) {
  if (!pageRef) return
  try {
    await pageRef.evaluate((s) => {
      let el = document.getElementById('__bench_banner')
      if (!el) {
        el = document.createElement('div')
        el.id = '__bench_banner'
        el.style.cssText = [
          'position:fixed', 'left:50%', 'top:14px', 'transform:translateX(-50%)',
          'z-index:2147483647', 'pointer-events:none',
          'font:13px/1.5 system-ui,sans-serif', 'color:#fff',
          'background:#0b1220f2', 'border:1px solid #ffffff26', 'border-radius:12px',
          'padding:10px 16px', 'min-width:460px', 'max-width:80vw',
          'box-shadow:0 8px 30px #0009', 'text-align:center'
        ].join(';')
        document.body.appendChild(el)
      }
      const color = s.status === 'ok' ? '#4ade80' : s.status === 'ng' ? '#f87171' : s.status === 'warn' ? '#fbbf24' : '#7dd3fc'
      const mark = s.status === 'ok' ? '✓' : s.status === 'ng' ? '✗' : s.status === 'warn' ? '△' : '▶'
      el.innerHTML =
        `<div style="font-size:11px;opacity:.6;letter-spacing:.06em">負荷チェック ・ ${s.lens} ・ ${s.done}/${s.total}</div>` +
        `<div style="margin-top:3px;font-size:14px;font-weight:700;color:${color}">${mark} ${s.name}</div>` +
        (s.detail ? `<div style="margin-top:4px;font-size:11px;opacity:.85">${s.detail}</div>` : '') +
        `<div style="margin-top:8px;height:3px;background:#ffffff1a;border-radius:2px;overflow:hidden">` +
        `<div style="height:100%;width:${Math.round((s.done / Math.max(1, s.total)) * 100)}%;background:${color}"></div></div>`
    }, state)
  } catch {
    /* 画面が入れ替わった直後などは無視 */
  }
}
const say = (lens, name, detail = '') =>
  banner({ status: 'run', lens, name: esc(name), detail: esc(detail), done: stepNo, total: TOTAL_STEPS })
async function done(lens, what, detail, verdict) {
  stepNo++
  row(lens, what, detail, verdict)
  await banner({ status: verdict, lens, name: esc(what), detail: esc(detail), done: stepNo, total: TOTAL_STEPS })
  await new Promise((r) => setTimeout(r, 700)) // 目で読める間を置く
}
  /**
   * 最後の札（まとめ）。**画面に残して終わる**ので、
   * 窓を見ているだけで結果が分かる（数字はコンソールにも出る）。
   */
  const finish = (ng, warn, head) =>
    banner({
      status: ng ? 'ng' : warn ? 'warn' : 'ok',
      lens: 'まとめ',
      name: `${rows.length - ng - warn} 良好 / ${warn} 要注意 / ${ng} 問題あり`,
      detail: esc(head),
      done: TOTAL_STEPS,
      total: TOTAL_STEPS
    })
  return { rows, setPage: (p) => (pageRef = p), say, done, finish }
}
