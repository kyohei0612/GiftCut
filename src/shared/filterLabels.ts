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
}

/** 空の数え台。書き出し1回につき1つ作る */
export function newLabelUses(): LabelUses {
  return { v: [], a: [] }
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
 * 仮の札を実ラベルへ置き換え、必要な split 宣言を**先頭に**足す。
 *
 * **1本だけの入力は split しない。** 分ける必要が無いのに split を挟むと、
 * 本数ぶんの複製が走って書き出しが重くなる。
 */
export function resolveInputLabels(uses: LabelUses, filter: string): string {
  let f = filter
  let pre = ''
  const fix = (list: number[], tag: 'V' | 'A', st: 'v' | 'a'): void => {
    list.forEach((n, idx) => {
      if (!n) return
      if (n === 1) {
        f = f.replace(`@${tag}${idx}_0@`, `[${idx}:${st}]`)
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
