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

// ## 出す物は「数字」ではなく「見立て」
//
// 数字と読み方を並べても、**読む人が自分で当てはめないと原因に辿り着けない**。
// 送ってもらう相手は困っている本人なので、そこを人にやらせない。
// `verdicts()` が測った値から**疑わしい順に**言い当てて、報告の頭に出す。

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
  /**
   * 絵が再生ヘッドから遅れている量（ms、その1秒での最大）。
   *
   * **テロップは再生ヘッドの時刻で動き、動画はそれを追いかける。**
   * だから絵が遅れると、テロップの動きだけが**先に走って見える**。
   * 「かけてある所より早く動く」の正体がこれなのか、動きの置き場所の話なのかは、
   * この数字を見ないと切り分けられない。
   */
  videoLagMs: number
  /** そのとき何をしていたか（再生中・画質など。あとで読むための手がかり） */
  note: string
}

export interface PerfEvent {
  t: number
  /** 何が起きたか（裏に回った・戻った・シークした など） */
  what: string
}

const MAX_SAMPLES = 600 // 10分ぶん

/**
 * 見立ての規則。**出どころはここ1つ**。
 *
 * ## なぜ表にしてあるか（2026-08-04 に踏んだ）
 *
 * 同じ規則が**文章（報告の「読み方」）とコード（判定）に二重**にあった。
 * 知識は同じなのに形が全く似ていないので、**`noDuplicate` では原理的に拾えない**
 * （あれが見ているのは「同じ形の物」）。そして**似ていないことがこの型の危なさ**で、
 * 片方だけ直しても誰も違和感を持たない。
 *
 * 起きた理由もはっきりしている——**足しただけで、元を消さなかった**。
 * 足すのは安全・消すのは怖い、という非対称がそのまま重複になる。
 * このリポジトリが2回踏んだ大事故（`App.tsx` 11,404行／`useAppWiring` 1,229行）と
 * **同じ機構**。1回ずつは無害で、誰も消さないので積み上がる。
 *
 * → 表にして、**判定も読み方もここから作る**。規則を1つ足す＝1か所を足す。
 *
 * ## しきい値の根拠
 *
 *   塞いだ時間 100ms/秒 … 1秒のうち1割を1つの処理が占有する。**音が切れ始める線**
 *   落ちたコマ 30       … 30コマ＝約1秒ぶん。これ未満は目で気づかない
 *   作り直し 45回/秒    … 60fps に対して4分の3。間引きが効いていない印
 *   絵の遅れ 100ms      … 3コマぶん。テロップだけ先に動いて見え始める
 */
const RULES: {
  /** 測った値から、この規則が見る数字を取り出す */
  valueOf: (s: PerfSample[]) => number
  over: number
  /** 当てはまったときに言うこと。**症状の言葉で書く**（利用者が口にするのはこちら） */
  say: (v: number) => string
  /** 当てはまらなかったときのための一行（報告の「読み方」に並ぶ） */
  hint: string
}[] = [
  {
    valueOf: (s) => avgOf(s, (x) => x.longTaskMs),
    over: 100,
    say: (v) =>
      `**計算が重い**（1秒あたり ${Math.round(v)}ms を1つの処理が占有）。` +
      '音がぶちぶち切れるのはこれ。絵のカクつきとは原因が違う',
    hint: '**主スレッドを塞いだ処理が多い** → 計算が重い（音のぶちぶちはこれ）'
  },
  {
    valueOf: (s) => s.reduce((a, x) => a + x.droppedFrames, 0),
    over: 30,
    say: (v) =>
      `**デコードが重い**（落としたコマ 合計 ${v}）。画質を下げるか、焼き直し（プロキシ）を待てば直る類`,
    hint: '**落としたコマだけ多い** → デコードが重い（画質を下げれば直る類）'
  },
  {
    valueOf: (s) => avgOf(s, (x) => x.renders),
    over: 45,
    say: (v) => `**画面の作りが重い**（作り直しが毎秒 ${Math.round(v)} 回）。間引きが効いていない`,
    hint: '**作り直しが毎秒60回近い** → 画面の作りが重い（間引きが効いていない）'
  },
  {
    valueOf: (s) => avgOf(s, (x) => x.videoLagMs),
    over: 100,
    say: (v) => `**絵が再生ヘッドから遅れている**（平均 ${Math.round(v)}ms）。テロップだけ先に走って見える`,
    hint:
      '**絵の遅れが大きい** → テロップだけ先に動いて見える' +
      '（文字は再生ヘッドの時刻、動画は追従のため）'
  }
]

/** 読み方の一行たち。**規則の表から作る**（並べ直すと必ず片方が古くなる） */
export const READING = RULES.map((r) => r.hint)

const avgOf = (s: PerfSample[], f: (x: PerfSample) => number): number =>
  s.reduce((a, x) => a + f(x), 0) / s.length

/**
 * 測った値から「いちばん疑わしいもの」を疑わしい順に言い当てる。
 *
 * **純関数にしてある**（`perfMonitor.test.ts` が境目を固定している）。
 * しきい値を勘で動かすと、報告の言うことが日によって変わって信用されなくなる。
 *
 * @returns 疑わしい順の文。**何も引っかからなければ空**（それ自体が答え＝
 *   「測っている間は問題が出ていない」なので、無理に何か言わない）
 */
export function verdicts(s: PerfSample[]): string[] {
  if (!s.length) return []
  const hit = RULES.map((r) => ({ r, v: r.valueOf(s) })).filter((x) => x.v > x.r.over)
  hit.sort((a, b) => b.v - a.v)
  const lines = hit.map((x) => x.r.say(x.v))
  // **どれにも当てはまらないのに遅い**、が一番厄介なので、そこを黙らせない。
  // 2026-08-04、まさにこの形だった（重かったのは合成レイヤーの組み直しで、
  // JS でもデコードでも作り直しでもなかった。JS は28秒中2.8秒しか使っていない）。
  // ※ ここだけ表の外にある。**「どれにも当てはまらない」は規則の形にならない**
  //   （他の全部が外れたときにだけ意味を持つので、1行の条件では書けない）
  const fps = avgOf(s, (x) => x.fps)
  if (!lines.length && fps < 30)
    lines.push(
      `**どれにも当てはまらないのに ${Math.round(fps)}fps しか出ていない。**` +
        'JS でもデコードでも作り直しでもない＝描画側（合成レイヤーの組み直しなど）を疑う。' +
        '調べ方は `npm run bench -- --cpu-deep`'
    )
  return lines
}

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
  private lagWorst = 0
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
  /**
   * 版・OS・素材の規模を返してもらう（報告の頭に出す）。
   *
   * **これが無いと、送られてきた報告から「どの版か」すら分からない。**
   * 自動更新で黙って入れ替わるので、「直したはずが直っていない」の大半は
   * 新旧の取り違えだった。数字より先に、まずここを見る。
   */
  envOf: () => string[] = () => []
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

  /**
   * 再生中、毎コマ「絵がどれだけ遅れているか」を渡してもらう（秒）。
   * その1秒でいちばん大きかった値を記録に残す。
   */
  reportLag(sec: number): void {
    if (!this.running) return
    const ms = Math.abs(sec) * 1000
    if (ms > this.lagWorst) this.lagWorst = ms
  }

  mark(what: string): void {
    if (!this.running) return
    this.events.push({ t: this.now(), what })
    if (this.events.length > MAX_SAMPLES) this.events.shift()
  }

  /**
   * いま溜まっている印（出来事）の名前。**試験と切り分け用。**
   *
   * `report()` は1秒ごとの標本が1つも無いと「まだ何も測っていません」で
   * 終わるので、印だけを確かめたいときに読めない。
   */
  marks(): string[] {
    return this.events.map((e) => e.what)
  }

  /**
   * 定期の重い処理を測って、**塞いだときだけ名前で残す**。
   *
   * ## なぜ要るか（2026-08-16）
   *
   * 「プレビューがかくつく」の記録に、**塞いだ回数と時間しか無かった**。
   * 再生中の58%の秒に 100〜190ms 止まっていることまでは分かるのに、
   * **誰が止めたのかが1行も出ない**ので、何度録っても犯人へ辿り着けない。
   *
   * `longtask` の `attribution` は同じ枠内の JS では「不明」しか返さないので、
   * **こちらから名札を付けて回る**しかない。包む相手は「定期的に走る重い物」
   *（設定の写し・下書き・波形…）。1回の呼び出しに 30ms 以上かかった時だけ残す
   *（60fps の2コマぶん。それ未満は絵に出ない）。
   *
   * 走っていない時（記録を取っていない時）は**素通し**なので、負担はゼロ。
   */
  measure<T>(what: string, fn: () => T): T {
    if (!this.running) return fn()
    const t0 = performance.now()
    try {
      return fn()
    } finally {
      const ms = Math.round(performance.now() - t0)
      if (ms >= 30) this.mark(`⏱ ${what} ${ms}ms`)
    }
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
      videoLagMs: Math.round(this.lagWorst),
      note: this.noteOf()
    }
    this.samples.push(s)
    if (this.samples.length > MAX_SAMPLES) this.samples.shift()
    this.frames = this.worst = this.longCount = this.longMs = this.renders = 0
    this.lagWorst = 0
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
    const found = verdicts(s)
    return [
      '# 動きの記録',
      '',
      // **見立てを頭に出す。** 数字と読み方だけ並べても、読む人が自分で
      // 当てはめないと原因に辿り着けない。送ってくるのは困っている本人なので、
      // そこを人にやらせない
      '## いちばん疑わしいもの',
      '',
      ...(found.length
        ? found.map((v, i) => `${i + 1}. ${v}`)
        : ['- 測っている間、引っかかる所は出ていません（下の数字は参考）']),
      '',
      ...(this.envOf().length ? ['## 環境', '', ...this.envOf().map((e) => `- ${e}`), ''] : []),
      `- 測った時間: ${s.length} 秒`,
      `- コマ送り: 平均 ${avg((x) => x.fps)} fps（1コマの最悪 ${worstRow.worstFrameMs}ms ＠${worstRow.t}秒 ${worstRow.note}）`,
      `- 主スレッドを塞いだ処理: 平均 ${avg((x) => x.longTasks)} 回/秒・${avg((x) => x.longTaskMs)}ms/秒`,
      `- 画面の作り直し: 平均 ${avg((x) => x.renders)} 回/秒`,
      `- 動画が落としたコマ: 合計 ${s.reduce((a, x) => a + x.droppedFrames, 0)}`,
      `- 絵の遅れ: 平均 ${avg((x) => x.videoLagMs)}ms（最大 ${Math.max(...s.map((x) => x.videoLagMs))}ms）`,
      '',
      // **書き写さない。** 上の「いちばん疑わしいもの」と同じ規則なので、
      // 表（`RULES`）から作る。並べ直すと、しきい値を変えた日に片方だけ古くなる
      '## 読み方',
      '',
      ...READING.map((r) => `- ${r}`),
      '',
      '## 出来事',
      '',
      ...this.events.map((e) => `- ${e.t}秒: ${e.what}`),
      '',
      '## 1秒ごと',
      '',
      '| 秒 | fps | 最悪コマ(ms) | 塞いだ回数 | 塞いだ時間(ms) | 作り直し | 落コマ | 絵の遅れ(ms) | 状況 |',
      '|---|---|---|---|---|---|---|---|---|',
      ...s.map(
        (x) =>
          `| ${x.t} | ${x.fps} | ${x.worstFrameMs} | ${x.longTasks} | ${x.longTaskMs} | ${x.renders} | ${x.droppedFrames} | ${x.videoLagMs} | ${x.note} |`
      ),
      ''
    ].join('\n')
  }
}

/** アプリ全体で1つ。どこからでも印を付けられるようにする */
export const perf = new PerfMonitor()
