// 書き出し先を、確認の側から指定する道具。
//
// ## なぜ要るか
//
// 書き出しの窓が「どこへ・どの名前で」を決める作りになったので、
// **保存の窓を差し替えるだけでは効かない**。置き場は本人が覚えさせる物
// （localStorage）なのでそこへ、名前と入れ物は窓の欄なので窓が開いてから入れる。
//
// ## 拡張子まで合わせること
//
// 入れ物（.mp4 / .mov / .mp3）は窓の選択で、**アプリが覚えたままになる**。
// 前の確認が .mp3 にしていると、次の確認は .mp4 を待っているのに .mp3 が
// 出来て「書き出しファイルができていない」と落ちる（実際に4件落ちた）。

import { rmSync } from 'node:fs'

/**
 * 書き出しの道具を作る。
 *
 * @param page Playwright のページ
 * @param setDialogFiles 保存の窓を差し替える（置き場か名前が決まらなかったときの逃げ道）
 */
export function makeExportTools(page, setDialogFiles) {
  /** 動画の書き出し先を指定する（窓を開ける前に呼ぶ） */
  const setExportTarget = async (out) => {
    // **先に消す。** アプリは同じ名前があると上書きせず `(1)` を付けて避けるので、
    // 前の確認が同じ名前で出していると、新しい方は `out(1).mp4` に行く。
    // それでも `existsSync(out)` は前のファイルで通ってしまい、
    // **中身は前の書き出しのまま**で合格する（実際に fps-same.mp4 と
    // audio-check.mp4 が同じ名前を使い回していた）。
    try {
      rmSync(out, { force: true })
    } catch {
      /* 無ければそれでよい */
    }
    await setDialogFiles(null, out)
    const dir = out.replace(/[\\/][^\\/]*$/, '')
    await page.evaluate((d) => localStorage.setItem('giftcut.exportDir', d), dir)
  }

  /** 書き出しの窓で、出すファイル名と入れ物（拡張子）を合わせる（窓が開いている前提） */
  const fillExportName = async (out) => {
    const file = out.split(/[\\/]/).pop() ?? out
    const name = file.replace(/\.[^.]+$/, '')
    const ext = (/\.([^.]+)$/.exec(file)?.[1] ?? 'mp4').toLowerCase()
    const f = page.locator('.restore-box input').first()
    if (await f.count()) await f.fill(name)
    const sel = page.locator('.restore-box select').first()
    if (await sel.count()) await sel.selectOption(ext).catch(() => {})
  }

  return { setExportTarget, fillExportName }
}
