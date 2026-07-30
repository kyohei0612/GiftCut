// アプリの中で「いま何が起きているか」を測る。
//
// ## なぜ要るか
//
// カクつきは**見ればすぐ分かるが、見ても原因は分からない**。
// 「重い」と言えるだけで、
//
//   - 絵が間に合っていないのか（描画）
//   - 主スレッドが詰まっているのか（計算）
//   - 動画のデコードが落ちているのか（再生）
//
// のどれかが分からないと、直す場所を当てずっぽうで探すことになる。
// 音がぶちぶち鳴るのは**主スレッドが詰まっている**ときの症状で、
// 絵のカクつきとは原因が違うことが多い。ここを取り違えると、いくら直しても直らない。
//
// ## 測るもの
//
//   コマ送り     … 1コマにかかった時間。60fps なら 16.7ms。**詰まると跳ねる**
//   長い仕事     … 50ms 以上、主スレッドを占有した処理（音が切れる直接の原因）
//   作り直し     … React が画面を作り直した回数。毎秒60回なら作りが重い
//   落ちたコマ   … 動画のデコードが間に合わなかった数（絵だけの問題か切り分けられる）
//   裏に回った   … 別のアプリへ行って戻った回数と、その間の時間
//
// 記録は**輪っか**に貯める（際限なく貯めるとそれ自体が重くなる）。

/** 1秒ごとのまとめ1つぶん */
export interface PerfSample {
  /** 計測開始からの秒 */
  t: number
  /** 1秒間に描けたコマ数 */
  fps: number
  /** 1コマにかかった時間の最大（ms）。跳ねていればここに出る */
  worstFrameMs: number
  /** 50ms 以上かかった処理の数と、合計（ms） */
  longTasks: number
  longTaskMs: number
  /** React が画面を作り直した回数 */
  renders: number
  /** 動画のデコードが落としたコマ数（その1秒での増分） */
  droppedFrames: number
  /** そのとき何をしていたか（再生中・画質など。あとで読むための手がかり） */
  note: string
}

export interface PerfEvent {
  t: number
  /** 何が起きたか（裏に回った・戻った・シークした など） */
  what: string
}

const MAX_SAMPLES = 600 // 10分ぶん

export class PerfMonitor {
  private t0 = 0
  private running = false
  private rafId: number | null = null
  private lastTs = 0
  private frames = 0
  private worst = 0
  private longCount = 0
  private longMs = 0
  private renders = 0
  private lastDropped = 0
  private secStart = 0
  private obs: PerformanceObserver | null = null
  private onVis: (() => void) | null = null
  private hiddenAt = 0
  /** 戻った直後の1コマは測らない（裏に居た時間が混ざるため） */
  private skipNext = false

  readonly samples: PerfSample[] = []
  readonly events: PerfEvent[] = []
  /** いまの状況を一言で返してもらう（再生中か・画質など） */
  noteOf: () => string = () => ''
  /** 動画のデコード状況を取りに行く先 */
  videoOf: () => HTMLVideoElement | null = () => null
  /** 1秒ごとに呼ばれる（画面の表示を更新するため） */
  onSample: ((s: PerfSample) => void) | null = null

  get isRunning(): boolean {
    return this.running
  }

  /** React が画面を作り直すたびに呼ぶ */
  countRender(): void {
    this.renders++
  }

  mark(what: string): void {
    if (!this.running) return
    this.events.push({ t: this.now(), what })
    if (this.events.length > MAX_SAMPLES) this.events.shift()
  }

  private now(): number {
    return Math.round((performance.now() - this.t0) / 100) / 10
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.t0 = performance.now()
    this.lastTs = this.t0
    this.secStart = this.t0
    this.samples.length = 0
    this.events.length = 0
    this.frames = this.worst = this.longCount = this.longMs = this.renders = 0
    this.lastDropped = 0

    // 50ms 以上、主スレッドを占有した処理。**音が切れる直接の原因**
    try {
      this.obs = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          this.longCount++
          this.longMs += e.duration
        }
      })
      this.obs.observe({ entryTypes: ['longtask'] })
    } catch {
      /* 使えない環境ならコマ送りだけで見る */
    }

    // 裏に回った／戻ったを残す。**戻ったあとカクつく**の切り分けに要る
    this.onVis = (): void => {
      if (document.hidden) {
        this.hiddenAt = performance.now()
        this.mark('裏に回った')
      } else {
        const sec = this.hiddenAt ? (performance.now() - this.hiddenAt) / 1000 : 0
        this.mark(`戻ってきた（${sec.toFixed(1)}秒ぶり）`)
        // **裏に居た時間を1コマとして数えない。**
        // 裏では rAF ごと止まるので、そのまま測ると「最悪コマ 349秒」のような
        // 意味の無い数字になり、本物の詰まりが埋もれる。時計を貼り直す。
        this.lastTs = performance.now()
        this.skipNext = true
      }
    }
    document.addEventListener('visibilitychange', this.onVis)

    const tick = (ts: number): void => {
      if (!this.running) return
      const dt = ts - this.lastTs
      this.lastTs = ts
      this.frames++
      if (this.skipNext) this.skipNext = false
      else if (dt > this.worst) this.worst = dt
      if (ts - this.secStart >= 1000) {
        this.flush(ts)
        this.secStart = ts
      }
      this.rafId = requestAnimationFrame(tick)
    }
    this.rafId = requestAnimationFrame(tick)
  }

  private flush(ts: number): void {
    let dropped = 0
    const v = this.videoOf()
    try {
      const q = v?.getVideoPlaybackQuality?.()
      if (q) {
        dropped = Math.max(0, q.droppedVideoFrames - this.lastDropped)
        this.lastDropped = q.droppedVideoFrames
      }
    } catch {
      /* 取れなくてもよい */
    }
    const s: PerfSample = {
      t: Math.round((ts - this.t0) / 100) / 10,
      fps: this.frames,
      worstFrameMs: Math.round(this.worst),
      longTasks: this.longCount,
      longTaskMs: Math.round(this.longMs),
      renders: this.renders,
      droppedFrames: dropped,
      note: this.noteOf()
    }
    this.samples.push(s)
    if (this.samples.length > MAX_SAMPLES) this.samples.shift()
    this.frames = this.worst = this.longCount = this.longMs = this.renders = 0
    this.onSample?.(s)
  }

  stop(): void {
    this.running = false
    if (this.rafId) cancelAnimationFrame(this.rafId)
    this.rafId = null
    this.obs?.disconnect()
    this.obs = null
    if (this.onVis) document.removeEventListener('visibilitychange', this.onVis)
    this.onVis = null
  }

  /** 人が読んで原因を探せる形に落とす */
  report(): string {
    const s = this.samples
    if (!s.length) return '（まだ何も測っていません）'
    const avg = (f: (x: PerfSample) => number): number =>
      Math.round((s.reduce((a, x) => a + f(x), 0) / s.length) * 10) / 10
    const worstRow = s.reduce((a, x) => (x.worstFrameMs > a.worstFrameMs ? x : a), s[0])
    return [
      '# 動きの記録',
      '',
      `- 測った時間: ${s.length} 秒`,
      `- コマ送り: 平均 ${avg((x) => x.fps)} fps（1コマの最悪 ${worstRow.worstFrameMs}ms ＠${worstRow.t}秒 ${worstRow.note}）`,
      `- 主スレッドを塞いだ処理: 平均 ${avg((x) => x.longTasks)} 回/秒・${avg((x) => x.longTaskMs)}ms/秒`,
      `- 画面の作り直し: 平均 ${avg((x) => x.renders)} 回/秒`,
      `- 動画が落としたコマ: 合計 ${s.reduce((a, x) => a + x.droppedFrames, 0)}`,
      '',
      '## 読み方',
      '',
      '- **主スレッドを塞いだ処理が多い** → 計算が重い（音のぶちぶちはこれ）',
      '- **落としたコマだけ多い** → デコードが重い（画質を下げれば直る類）',
      '- **作り直しが毎秒60回近い** → 画面の作りが重い（間引きが効いていない）',
      '',
      '## 出来事',
      '',
      ...this.events.map((e) => `- ${e.t}秒: ${e.what}`),
      '',
      '## 1秒ごと',
      '',
      '| 秒 | fps | 最悪コマ(ms) | 塞いだ回数 | 塞いだ時間(ms) | 作り直し | 落コマ | 状況 |',
      '|---|---|---|---|---|---|---|---|',
      ...s.map(
        (x) =>
          `| ${x.t} | ${x.fps} | ${x.worstFrameMs} | ${x.longTasks} | ${x.longTaskMs} | ${x.renders} | ${x.droppedFrames} | ${x.note} |`
      ),
      ''
    ].join('\n')
  }
}

/** アプリ全体で1つ。どこからでも印を付けられるようにする */
export const perf = new PerfMonitor()
