// クリップを「吸い付ける」ときの当て先を決める。
//
// ## なぜ画面から出すか
//
// **吸い付きは、ずれると誰も気づかないまま作業を狂わせる。**
// 1フレームぶん手前に付いた、隣の端ではなく再生位置に付いた——どれも
// 見た目では分からず、書き出してから気づく。
//
// 判定そのものは「どれが一番近いか」だけなので、画面が無くても確かめられる。
// 画面側に置いていると、掴んで動かして測る以外に確かめようが無くなる。

/** 吸い付いた結果。line は縦線を出す位置（付かなかったら null） */
export interface SnapResult {
  start: number
  line: number | null
}

/**
 * 頭と尻の**両方**を当て先に照らして、一番近い所へ寄せる。
 *
 * **尻も見るのが要点。** 頭だけで判定すると、後ろの端を隣に揃えたいときに
 * 寄ってくれず、手で合わせることになる（1フレームずれたまま気づかない）。
 *
 * @param tStart  いま置こうとしている位置（秒）
 * @param dur     クリップの長さ（秒）
 * @param targets 当て先の時刻（他のクリップの端・再生位置・目印など）
 * @param thr     この距離まで近づいたら吸い付く（秒）
 */
export function nearestSnap(
  tStart: number,
  dur: number,
  targets: readonly number[],
  thr: number
): SnapResult {
  let bestStart = tStart
  let bestD = thr
  let line: number | null = null
  for (const tg of targets) {
    // 頭を合わせる
    const dL = Math.abs(tg - tStart)
    if (dL < bestD) {
      bestD = dL
      bestStart = tg
      line = tg
    }
    // 尻を合わせる（置き位置は、その分だけ手前になる）
    const dR = Math.abs(tg - (tStart + dur))
    if (dR < bestD) {
      bestD = dR
      bestStart = tg - dur
      line = tg
    }
  }
  // **前へはみ出させない。** 0より前に置くと、以後の計算が全部ずれる
  return { start: Math.max(0, bestStart), line: line != null ? Math.max(0, line) : null }
}
