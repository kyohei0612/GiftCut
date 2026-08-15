// 見本帳のチップ（トランジション・動き）を、画面の座標へ「掴んで落とす」。
//
// **掴んで置く物は、これが無いと一切自動化できない**（クリックでは付かない）。
// Playwright のマウス操作では HTML5 の掴み落としは起きないので、
// その場で drag の一連（dragstart → dragenter → dragover → drop → dragend）を起こす。
//
// ## なぜ lib に出したか（2026-08-16）
//
// `09c-写して配る` の中にだけ在って、**つなぎ目の演出を測る確認は他の章にも要る**。
// 書き写すと、片方だけ直す形（このリポジトリで一番多い事故）になる。

/** @param page Playwright の Page。返り値は `dropChipAt(チップの文字, x, y)` */
export function makeDropChip(page) {
  return async (chipText, x, y) => {
    await page.evaluate(
      ({ chipText, x, y }) => {
        const chip = [...document.querySelectorAll('.fx-item')].find((el) =>
          (el.textContent ?? '').includes(chipText)
        )
        if (!chip) throw new Error(`見本帳に「${chipText}」が無い`)
        const dt = new DataTransfer()
        const ev = (t, el, more = {}) =>
          el.dispatchEvent(
            new DragEvent(t, { bubbles: true, cancelable: true, dataTransfer: dt, ...more })
          )
        ev('dragstart', chip)
        const target = document.elementFromPoint(x, y)
        if (!target) throw new Error('落とす先が見つからない')
        const at = { clientX: x, clientY: y }
        ev('dragenter', target, at)
        ev('dragover', target, at)
        ev('drop', target, at)
        ev('dragend', chip)
      },
      { chipText, x, y }
    )
    await page.waitForTimeout(500)
  }
}
