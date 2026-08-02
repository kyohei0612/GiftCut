// 控え（キャッシュ）に上限を付ける。**古い物から捨てる。**
//
// ## なぜ要るか（実際に起きていたこと）
//
// 測った結果を控えておく Map の鍵に、**文字の中身**が入っていた
// （`lib/telopStyle.ts` の inkCache）。1文字打つたびに新しい鍵ができ、
// 古い物は一度も捨てられない。＝**編集した分だけ増え続ける。**
// 本人から出ていた「編集すればするほど重くなる」と形が合う。
//
// ## なぜ「入れた順」で足りるのか
//
// JavaScript の Map は**入れた順を覚えている**ので、あふれたときは
// `keys().next()` で一番古い鍵が1つで取れる。専用の作りは要らない。
//
// ## 取り出したときに入れ直す（LRU）
//
// 入れた順のまま捨てると、**ずっと使っている物が、通りすがりの物に押し出される**
// （1つのテロップを直し続けている間に、他の2000件が流れていくと消える）。
// 取り出すたびに入れ直せば、使っている物が最後尾へ回って生き残る。

export interface Lru<V> {
  get: (key: string) => V | undefined
  set: (key: string, v: V) => void
  /** いま何件持っているか（確認用） */
  readonly size: number
}

/** @param max 何件まで持つか。超えたぶんは古い方から捨てる */
export function makeLru<V>(max: number): Lru<V> {
  const m = new Map<string, V>()
  return {
    get(key) {
      const hit = m.get(key)
      if (hit === undefined) return undefined
      // 使った物を最後尾へ回す（次に捨てられるのは、しばらく使っていない方）
      m.delete(key)
      m.set(key, hit)
      return hit
    },
    set(key, v) {
      m.delete(key)
      m.set(key, v)
      while (m.size > max) {
        const oldest = m.keys().next()
        if (oldest.done) break
        m.delete(oldest.value)
      }
    },
    get size() {
      return m.size
    }
  }
}
