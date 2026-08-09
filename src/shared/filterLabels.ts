// ffmpeg のフィルタグラフで、**同じ入力を何本にも分ける**（split / asplit）。
//
// ## なぜ要るか
//
// 1つの入力を複数のクリップで使うとき、**同じ入力ラベルを2か所以上から直接
// 参照するとグラフが成立しない**（ffmpeg が「そのラベルは既に使われている」で落ちる）。
// 必要な本数だけ split してから、各 trim へ配る必要がある。
//
// ## 本数は最後まで分からない
//
// 何本要るかは、フィルタを組み終わるまで決まらない。なので組み立て中は
// `@V0_1@` のような**仮の札**を置いておき、最後にまとめて
// 「split の宣言を先頭に足しつつ、仮の札を実ラベルへ置き換える」。
//
// **1本しか使わないなら split しない**（`[0:v]` を直接使う＝今までと同じ形）。
// 余計な split を挟むと、それだけで1本ぶんの処理が増える。
//
// ## なぜ shared に置くか
//
// `main/exportRun.ts` の中にあったが、**やっているのは文字列の置き換えだけ**で、
// ffmpeg も electron も要らない。外から持ち込む名前が0個だった（数えた）ので、
// ここへ出して**アプリを起動せずに確かめられる**ようにした（2026-08-03）。

/** 入力ごとの「何本使ったか」。呼ぶ側が持ち回る */
export interface LabelUses {
  v: number[]
  a: number[]
  /**
   * 映像の使いどころの**窓**（source 時間の [start, end)）。`useVAt` が控える。
   * 窓が分かっている使い方どうしは、split（全コマを全枝へ**コピー**）ではなく
   * segment（各コマを**該当する枝へだけ**送る）で配れる——`resolveInputLabels` が選ぶ。
   */
  vw: Array<Array<{ s: number; e: number } | undefined>>
}

/** 空の数え台。書き出し1回につき1つ作る */
export function newLabelUses(): LabelUses {
  return { v: [], a: [], vw: [] }
}

/**
 * 映像の入力を1本使う。返るのは**仮の札**（あとで `resolveInputLabels` が実ラベルへ）。
 *
 * @param idx 何番目の入力か（`-i` の並び順）
 */
export function useV(uses: LabelUses, idx: number): string {
  const n = uses.v[idx] ?? 0
  uses.v[idx] = n + 1
  return `@V${idx}_${n}@`
}

/** 音の入力を1本使う（映像側と同じ決まり） */
export function useA(uses: LabelUses, idx: number): string {
  const n = uses.a[idx] ?? 0
  uses.a[idx] = n + 1
  return `@A${idx}_${n}@`
}

/**
 * 映像の入力を、**source 時間の窓 [start, end) だけ**使う（本編の切片が呼ぶ）。
 *
 * 窓を控えておくと、`resolveInputLabels` が split の代わりに **segment**
 * （各コマを該当する枝へだけ送る）で配れる。書き出しが実時間の1.74倍かかる件で、
 * **split=600 が「デコードした全コマ×600枝のコピー」**として効いていた
 * （2026-08-09。骨組みの実測 13.9 → 3.2秒）。
 *
 * ※ **音に同じ物は作らない。** 連続カット（分割）では境目の音フレームを
 *   前後の枝が**半分ずつ**使う（atrim がフレームの中を割る）。asegment は
 *   フレームを割れないので、どちらかの枝で音が欠ける。映像はコマ単位で
 *   綺麗に割れる（trim の end は排他・segment の境目も「次の枝へ」）ので安全。
 */
export function useVAt(uses: LabelUses, idx: number, start: number, end: number): string {
  const n = uses.v[idx] ?? 0
  ;(uses.vw[idx] ??= [])[n] = { s: start, e: end }
  return useV(uses, idx)
}

/**
 * 仮の札を実ラベルへ置き換え、必要な split 宣言を**先頭に**足す。
 *
 * **1本だけの入力は split しない。** 分ける必要が無いのに split を挟むと、
 * 本数ぶんの複製が走って書き出しが重くなる。
 */
export function resolveInputLabels(uses: LabelUses, filter: string): string {
  let f = filter
  let pre = ''
  /**
   * 窓付きの使い方から、segment で配れる並びを選ぶ。**全か無か。**
   *
   * 条件は「**その入力の使い方が全部、窓付きで・時間順で・重ならない**」——
   * segment は流れを境目で順に切るだけなので、並べ替え・複製・（xfade で頭を
   * 手前へ延ばした）食い込みは配れない。**1つでも配れない使い方が混ざったら、
   * その入力は丸ごと従来の split へ**（正しさが先、速さは後）。
   *
   * ## なぜ「混在」を許さないか（2026-08-09・デッドロックを踏んだ）
   *
   * 最初は `split=2` で「segment で配る流れ」と「従来の流れ」に分けた。**止まる。**
   *
   * ```
   * split は両方の出口が受け取れるまで次のコマを出さない
   * → 従来側の枝は自分の出番まで消費されず、キューが詰まる
   * → split ごと止まる → デコーダが止まる → segment 側の枝にコマが来ない
   * → その枝を待つ concat が永遠に待つ（実測: 60秒の照合が85分回りっぱなし）
   * ```
   *
   * 詰まりを逃がす `fifo` フィルタは **ffmpeg 7 で削除されていて同梱版に無い**。
   * 食い込み窓をスライス端の合成（前のスライスを局所 split して尻を継ぐ）で
   * 拾う設計はあり得るが、複雑さに見合うか測ってから（`やること.md`）。
   *
   * 境目の数字は trim と同じ `toFixed(3)` で出す。丸めが違うと、境目ちょうどの
   * コマがどちらの枝に入るかが trim と食い違う。
   */
  const pickRouted = (idx: number, n: number): number[] => {
    const wins = uses.vw[idx] ?? []
    const cand: number[] = []
    for (let i = 0; i < n; i++) {
      if (!wins[i]) return [] // 窓なしが1つでも居たら、丸ごと split（混ぜると止まる）
      cand.push(i)
    }
    if (cand.length < 2) return []
    cand.sort((a, b) => wins[a]!.s - wins[b]!.s)
    let prevSr = -Infinity // 丸めた後の直前の境目
    let prevE = -Infinity
    for (const i of cand) {
      const w = wins[i]!
      const sr = Number(w.s.toFixed(3))
      // 丸めた後でも境目が進むこと（同じ 3桁に丸まる2つは、2つ目が空の枝になる）
      if (!(sr > prevSr && w.s >= prevE - 1e-9)) return [] // 1つでも配れない＝丸ごと split
      prevSr = sr
      prevE = w.e
    }
    return cand
  }
  const fix = (list: number[], tag: 'V' | 'A', st: 'v' | 'a'): void => {
    list.forEach((n, idx) => {
      if (!n) return
      if (n === 1) {
        f = f.replace(`@${tag}${idx}_0@`, `[${idx}:${st}]`)
        return
      }
      const routed = st === 'v' ? pickRouted(idx, n) : []
      if (routed.length) {
        // segment で配る（全か無かなので、この入力の使い方は全部ここに居る）
        const wins = uses.vw[idx]!
        const bounds = routed.slice(1).map((i) => wins[i]!.s.toFixed(3))
        const outs = routed.map((i) => `[x${tag}${idx}_${i}]`)
        pre += `[${idx}:${st}]segment=timestamps=${bounds.join('|')}${outs.join('')};`
        routed.forEach((i) => {
          f = f.replace(`@${tag}${idx}_${i}@`, `[x${tag}${idx}_${i}]`)
        })
        return
      }
      const labels: string[] = []
      for (let i = 0; i < n; i++) labels.push(`[x${tag}${idx}_${i}]`)
      pre += `[${idx}:${st}]${st === 'v' ? 'split' : 'asplit'}=${n}${labels.join('')};`
      labels.forEach((l, i) => {
        f = f.replace(`@${tag}${idx}_${i}@`, l)
      })
    })
  }
  fix(uses.v, 'V', 'v')
  fix(uses.a, 'A', 'a')
  return pre + f
}
