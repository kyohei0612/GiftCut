// 落ちた記録から、**そのまま送れる報告文**を組み立てる。
//
// ## なぜ「送る仕組み」を外部のサービスにしないか（2026-08-05）
//
// 外部のレビューで Sentry などの自動収集を勧められた。使わない理由は3つ:
//
//   ・**黙って外へ出す**ことになる。何が送られるか本人に見えない
//   ・切り抜きの素材には人の名前や未公開の内容が入る。事故の重さが釣り合わない
//   ・置き場（公開リポジトリ）が既にあり、作っているのは1人。中継役が要らない
//
// → **記録は手元に置き、送るかどうかは次の起動で本人が決める。**
//   押すと GitHub の issue が**中身入りで開く**ので、送る前に全部読める。
//   手で書き出して貼る作業が消えるだけで、決めるのは本人のまま。
//
// ## 入れない物
//
// プロジェクトの中身・素材の道・テロップの文字は入れない。
// 利用者名は main/crashLog の `scrubPath` で落としてある。
// **「念のため全部入れる」をやると、送るのが怖くなって結局送られない。**

export interface CrashInfo {
  crashed: boolean
  last?: { at?: string; version?: string; platform?: string }
  entries: { at: string; kind: string; detail: string }[]
}

/** 落ちた種類を、日本語の一言にする */
const KIND: Record<string, string> = {
  'render-process-gone': '画面が落ちた',
  'child-process-gone': '裏の処理が落ちた（ffmpeg など）',
  uncaughtException: '本体で握り損ねた例外',
  'renderer-error': '画面側で握り損ねた例外'
}

/**
 * 本人に見せる一言。**「落ちました」だけにしない**——
 * 何が起きたか分からないまま「報告しますか」と聞かれても、押しようがない。
 */
export function summarize(info: CrashInfo): string {
  if (!info.crashed) return ''
  const e = info.entries[0]
  const when = info.last?.at ? new Date(info.last.at).toLocaleString('ja-JP') : '前回'
  if (!e)
    // **記録が無いまま落ちる方が、むしろ重い**（書く暇も無かった＝強制終了・電源断・
    // メモリ枯渇）。「記録が無い＝軽い」と読ませない
    return `${when}の起動が、正常に終わっていません。記録が残っていないので、強制終了・電源断・メモリ不足のいずれかの可能性があります。`
  return `${when}の起動が、正常に終わっていません（${KIND[e.kind] ?? e.kind}）。`
}

/** GitHub の issue に入れる本文。**送る前に本人が読める形にする** */
export function buildBody(info: CrashInfo, appVersion: string): string {
  const lines = [
    '## 何をしていたときに落ちたか',
    '',
    '（覚えている範囲で書いてください。空のままでも送れます）',
    '',
    '## 自動で入った情報',
    '',
    `- 版: v${appVersion}`,
    `- OS: ${info.last?.platform ?? '不明'}`,
    `- 前回の起動: ${info.last?.at ?? '不明'}`,
    ''
  ]
  if (info.entries.length) {
    lines.push('### 記録', '', '```')
    for (const e of info.entries.slice(0, 5))
      lines.push(`[${e.at}] ${KIND[e.kind] ?? e.kind}`, e.detail.slice(0, 1200), '')
    lines.push('```', '')
  } else {
    lines.push('記録は残っていません（書く前に終わった可能性があります）。', '')
  }
  lines.push(
    '---',
    '',
    '※ プロジェクトの中身・素材の場所・テロップの文字は入っていません。',
    '※ 利用者名は伏せてあります。'
  )
  return lines.join('\n')
}

/**
 * issue を開く URL。**送信はしない**——ブラウザで開くだけなので、
 * 本人が読んで、消して、やめられる。
 *
 * ※ URL には長さの上限がある（実質 8,000 字前後）。超えると
 *   **開かないのではなく、途中で切れた本文で開く**ので、こちらで切っておく。
 */
export function issueUrl(info: CrashInfo, appVersion: string, repo: string): string {
  const title = `落ちました（v${appVersion}）`
  const body = buildBody(info, appVersion).slice(0, 6000)
  return (
    `https://github.com/${repo}/issues/new` +
    `?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`
  )
}
