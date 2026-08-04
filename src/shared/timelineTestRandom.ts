// テスト用の**決定論的な乱数**と、そこから作るランダムな切片列。
//
// ## なぜ別ファイルにしてあるか（2026-08-05）
//
// `timeline.test.ts` が 755行あり、決まり（600超は500以下に割る）に当たった。
// 話題で3つに割ったが、**この2つはどの話題からも使う**ので、
// 割った先へそれぞれ写すと**同じ物が3か所**になる。
//
// 写した瞬間から片方が古くなる型で、しかも「乱数の作り方が違う」は
// **落ちたときに再現できない**という一番たちの悪い形で出る。
//
// ## 決定論であること自体が要件
//
// 失敗を再現できないと直せない。`Math.random()` を使うと、
// 落ちたときに「その並び」が二度と作れない。

/** 決定論的な擬似乱数（同じ種なら必ず同じ並び） */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** ランダムな切片列を作る。速度・尺・トランジションを混ぜる。 */
export function randomSegs(rnd: () => number, n: number): { srcStart: number; srcEnd: number; speed?: number; xfade?: { dur: number } }[] {
  const segs: { srcStart: number; srcEnd: number; speed?: number; xfade?: { dur: number } }[] = []
  for (let i = 0; i < n; i++) {
    const srcStart = rnd() * 20
    const srcEnd = srcStart + 0.1 + rnd() * 10
    const speedRoll = rnd()
    segs.push({
      srcStart,
      srcEnd,
      // 等速を多めに、倍速/スローも混ぜる
      speed: speedRoll < 0.5 ? undefined : 0.25 + rnd() * 3.75,
      xfade: rnd() < 0.3 ? { dur: rnd() * 2 } : undefined
    })
  }
  return segs
}
