// 「一度にやりすぎない」ための2つの道具。
//
// どちらも**動くようにする**ためではなく、**重くしない**ために要る。
// App.tsx の中に置いておくと、画面の話と混ざって見つけにくい。

/**
 * 重い下準備（サムネ・波形・尺）を、同時に走る数を絞って順に流す。
 *
 * 素材ビンに並んだぶんだけ一斉に ffmpeg を起こしていたため、
 * 2000件のプロジェクトを開くのに69秒かかっていた（実測）。
 * 数を絞れば、先頭から順に出そろい、その間も操作できる。
 */
export function makeJobQueue(limit: number): (job: () => Promise<unknown>) => void {
  const waiting: (() => Promise<unknown>)[] = []
  let running = 0
  const pump = (): void => {
    while (running < limit && waiting.length) {
      const job = waiting.shift() as () => Promise<unknown>
      running++
      void job().finally(() => {
        running--
        pump()
      })
    }
  }
  return (job) => {
    waiting.push(job)
    pump()
  }
}
// 同時に4本まで。増やすと出そろうのは速いが、その間アプリ全体が重くなる。
export const mediaQueue = makeJobQueue(4)

/**
 * マウスの動きを「1フレームに1回」へまとめる。
 *
 * マウスは1秒に100回以上動くが、画面は60回しか描き替わらない。
 * まとめないと、描いても見えない絵のために毎回タイムライン全体を作り直すことになる。
 * クリップが増えるほどこれが効いてくる（1000個で1操作75ms かかっていた）。
 *
 * 使うときの約束:
 *   - 離した時に flush() を呼ぶ（最後の位置を取りこぼさない）
 *   - その後に cancel() を呼ぶ（フレーム待ちのまま残さない）
 */
export function rafThrottle<T>(fn: (arg: T) => void): {
  run: (arg: T) => void
  flush: () => void
  cancel: () => void
} {
  let id = 0
  let last: T | null = null
  const fire = (): void => {
    const a = last
    last = null
    if (a !== null) fn(a)
  }
  return {
    run: (arg: T) => {
      last = arg
      if (id) return
      id = requestAnimationFrame(() => {
        id = 0
        fire()
      })
    },
    flush: () => {
      if (last !== null) fire()
    },
    cancel: () => {
      if (id) cancelAnimationFrame(id)
      id = 0
      last = null
    }
  }
}
