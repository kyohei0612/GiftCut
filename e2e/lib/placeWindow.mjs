// 確認の窓を、いま使っていない方のディスプレイへ寄せる。
//
// e2e は本物のウィンドウを開いて本物のマウスで触るので、作業中の画面に出ると
// 数分間そこを占領する。**横で眺めていられるのが利点**なので隠すのではなく、
// 別の画面へ寄せる。画面が1枚しか無いときは何もしない（寄せる先が無い）。

/** @param app Playwright の Electron アプリ */
export async function placeOnOtherDisplay(app) {
  try {
    const id = await app.evaluate(({ screen, BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      if (!win) return null
      const all = screen.getAllDisplays()
      if (all.length < 2) return null
      const cur = screen.getDisplayMatching(win.getBounds())
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
      return other.id
    })
    if (id != null) console.log('\x1b[36m確認の窓は、もう1枚のディスプレイへ出します\x1b[0m')
  } catch {
    /* 寄せられなくても確認そのものは通る */
  }
}
