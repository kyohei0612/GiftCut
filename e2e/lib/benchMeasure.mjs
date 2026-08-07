// 触っている間のコマ落ちを記録する仕掛け。
//
// ## なぜ本体から出したか（2026-08-07）
//
// `bench.mjs` が 600行を超えた。ここは**話題が1つ**（どう測るか）で、
// 本体が持つ「何を測るか・素材づくり・まとめ」とは別。
//
// 作り方は `makeReporter` / `makeViewTools` と同じ——**要る物は束で受け取り、
// 関数を1つ返す**。閉じ込めている名前は7つだけだった。
//
// ## 中身
//
// - `makeMeasure` … `measure(name, fn, broken, setup)` を作って返す
//
// ※ **割った拍子に `frameStats` を持ってき忘れて、実際に落とした**（2026-08-07）。
//   型検査は `.mjs` を見ないので、**走らせるまで分からない**。
//   割ったら必ず1回通すこと（CLAUDE.md の「割った拍子に検査が黙って死ぬ」と同じ型）。
import { frameStats } from './measure.mjs'
export function makeMeasure({ page, say, done, cpu, fmt, nowSec, SELFCHECK }) {
  /** 操作している間の描画のコマ落ちを記録する */
  /**
   * 操作しながら重さを測る。
   *
   * fn は「操作が成立しなかったら throw する」こと。成立の確認が無い項目は、
   * 何も起きていないのに「軽い」という数字を出してしまう。
   *
   * broken を渡すと --selfcheck でそれを実行し、**落ちることを確かめる**。
   * 落ちなければ、その項目は何も見ていないということ。
   */
  /**
   * @param setup 記録を始める**前**に走らせる手（入口づくり）。
   *   ここに置いた分は数字に入らない。**測りたい操作だけを `fn` に残すこと。**
   */
  return async function measure(name, fn, broken, setup) {
    if (SELFCHECK) {
      if (!broken) {
        await done('自己点検', name, 'わざと間違える手順が用意されていない', 'warn')
        return
      }
      await say('自己点検', name, 'わざと間違えて、ちゃんと落ちるかを見る')
      let threw = false
      try {
        await broken()
      } catch {
        threw = true
      }
      await done(
        '自己点検',
        name,
        threw ? 'わざと間違えると、ちゃんと落ちる' : '間違えても合格してしまう（何も見ていない）',
        threw ? 'ok' : 'ng'
      )
      return
    }
    await say('動作', name, '触っている間のコマ落ちを記録中')
    // **入口を作る手は、記録に入れない**（2026-08-07）。
    //
    // 記録は `fn` の中を丸ごと拾うので、入口づくり（全体表示へ戻す等）の重さも
    // 混ざる。**入口の重さは「どこから戻るか」で変わる**ので、アプリを1行も
    // 変えていないのに数字が動く——`拡大・縮小` は同じコードで
    // **95% が 16.6ms と 54.1ms（3倍）／引っかかりが 1回と 24回**に割れた。
    //
    // 「項目が自分で入口を決める」（2026-08-04 に4か所直した）だけでは足りない。
    // **決めた入口へ行く動作そのものを測ってしまう**からで、そこを外に出す。
    if (setup) await setup()
    await page.evaluate(() => {
      window.__frames = []
      window.__sampling = true
      let last = performance.now()
      const tick = (t) => {
        window.__frames.push(t - last)
        last = t
        if (window.__sampling) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    const t0 = nowSec()
    let failed = null
    if (cpu) await cpu.start()
    try {
      await fn()
    } catch (e) {
      failed = e?.message ?? String(e) // 操作そのものが成立しなかった
    }
    const elapsed = nowSec() - t0
    const frames = await page.evaluate(() => {
      window.__sampling = false
      return window.__frames
    })
    const s = frameStats(frames)
    // **成立しなかったときも出す。** 何をしていて成立しなかったのかが、
    // そのまま原因になっていることがある
    if (cpu) await cpu.stop(name)
    if (failed) return done('動作', name, `操作が成立しなかった: ${failed}`, 'ng')
    if (!s) return done('動作', name, '（描画が記録できなかった）', 'warn')
    // **窓が裏に回ったら、それは測定不成立。アプリのせいにしない。**
    //
    // 前に出たら Chromium は rAF を**1秒に1回**へ絞る。すると中央値が
    // ぴったり 1000ms 付近になり、所要時間も 26秒 → 98.8秒 に膨らむ。
    // これを黙って通すと「アプリが致命的に重い」という顔の赤が6件並ぶ
    // （2026-08-04、別のセッションが Electron を起動して前面を奪ったとき実際にそうなった。
    //   数字だけ見て「描画が重い」と読み違えるところだった）。
    if (s.median > 500)
      return done(
        '動作',
        name,
        `測れていない: 1コマが ${fmt(s.median)}ms（＝毎秒1コマ）。**窓が裏に回されている**。` +
          '他のアプリや別の e2e が前面を取っていないか確かめて、測り直すこと',
        'ng'
      )
    const detail =
      `中央値 ${fmt(s.median)}ms / 95% ${fmt(s.p95)}ms / 最悪 ${fmt(s.worst)}ms` +
      ` / 引っかかり ${s.janky}回（${fmt(elapsed)}秒間）`
    // 60fps=16.7ms。33ms(30fps)までは普通に触れる。50ms超が続くともたつきを感じる。
    await done('動作', name, detail, s.p95 <= 33 ? 'ok' : s.p95 <= 60 ? 'warn' : 'ng')
  }

}
