// 確認の窓を、いま使っていない方のディスプレイへ寄せる。
//
// e2e は本物のウィンドウを開いて本物のマウスで触るので、作業中の画面に出ると
// 数分間そこを占領する。**横で眺めていられるのが利点**なので隠すのではなく、
// 別の画面へ寄せる。画面が1枚しか無いときは何もしない（寄せる先が無い）。

/**
 * **窓を一度も出さずに起動する**ための、アプリへ渡す環境（2026-11-11）。
 *
 * 前の既定は「出してから別のモニターへ寄せる」、OFFSCREEN は「出してから画面の外へ」で、
 * どちらも起動のたびに一瞬見えた（本人「立ち上げなくて裏で起動して」）。
 * GIFTCUT_E2E_HIDDEN=1 を受けたアプリは、窓を**最初から画面の外に**作り、前に出さず
 * タスクバーにも出さない（src/main/index.ts の e2eHidden）。`show()` を呼ばない形は
 * 描き直しが毎秒1回になって絵の確認が3件赤になったので取らない（理由はあちら）。
 *
 * 眺めたいときは GIFTCUT_E2E_VISIBLE=1 で、今まで通り出して寄せる。
 */
export function launchEnv() {
  return process.env.GIFTCUT_E2E_VISIBLE
    ? { ...process.env }
    : { ...process.env, GIFTCUT_E2E_HIDDEN: '1' }
}

/** @param app Playwright の Electron アプリ */
export async function placeOnOtherDisplay(app) {
  try {
    // **GIFTCUT_E2E_OFFSCREEN=1 なら画面の外へ出す**（出してから動かすので一瞬見える。
    // 一度も見せない道は上の launchEnv）。2026-11-08 にここへ「画面の外は描画が毎秒1コマ」と
    // 書いていたが、11-11 に測ったら**毎秒241回で絞られていなかった**（絞られるのは
    // show() していない窓と、他の窓の後ろに隠れた窓）
    if (process.env.GIFTCUT_E2E_OFFSCREEN) {
      await app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0]
        if (win) win.setPosition(-20000, -20000)
      })
      console.log('\x1b[36m確認の窓は画面の外に出します（時間は測れません）\x1b[0m')
      return
    }
    const id = await app.evaluate(({ screen, BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      if (!win) return null
      const all = screen.getAllDisplays()
      if (all.length < 2) return null
      // 「使っていない方」＝**いまマウスのカーソルが無い方**。前は「窓が最初に開いた側と
      // 違う方」で決めていたので、本人が作業しているのが副モニターのときは
      // そこへ出てしまった（2026-11-08・本人から「今表示してるモニターじゃない方に」）
      const cur = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
      const other = all.find((d) => d.id !== cur.id)
      if (!other) return null
      const wa = other.workArea
      // 端いっぱいではなく少し内側へ。端に貼り付くと、掴んで動かす確認が
      // 画面の外へ出て当たり判定がずれる
      win.setBounds({
        x: wa.x + 20,
        y: wa.y + 20,
        width: Math.min(1600, wa.width - 40),
        height: Math.min(1000, wa.height - 40)
      })
      // ※ 寄せた先で他の窓の後ろに隠れると、Chromium は描画を毎秒1コマに絞る（bench の
      //   触る系8項目が全部「測れていない」になった・2026-11-08）。最前面固定も試したが
      //   本人の画面に出てしまい取り下げた。時間を測るときは、寄せた先が見えているかを
      //   測る側が確かめること（e2e/play-probe.mjs は currentTime の更新回数で見ている）
      return other.id
    })
    if (id != null) console.log('\x1b[36m確認の窓は、もう1枚のディスプレイへ出します\x1b[0m')
  } catch {
    /* 寄せられなくても確認そのものは通る */
  }
}
