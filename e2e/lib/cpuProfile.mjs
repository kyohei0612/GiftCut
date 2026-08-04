// **止まっている 0.3秒に、何をしているのか**を取る（`npm run bench -- --cpu`）。
//
// ## なぜ要るか（2026-08-04）
//
// bench は「どれくらい重いか」しか出さない。tv 基準で:
//
//   再生してみる      中央値 4.2ms / **95% 312.7ms** / 引っかかり 22回
//   クリップを掴む    中央値 4.2ms / **95% 174.9ms** / 引っかかり 167回
//
// **中央値は 60fps のまま**なので「毎コマ重い」ではなく、**時々どかっと止まる**型。
// 数を減らす話ではないので、次に要るのは「その1回で何をしているか」。
//
// ## **測る手順を自分で書き直さないこと**
//
// はじめ、別の入口（`bench-profile.mjs`）に同じ手順を書き写して測ろうとして、
// **3回とも操作が成立しなかった**（寄せられない・再生が始まらない）。
// 手順は bench 側にしか無い暗黙の前提を持っている。**測る物に後付けする**のが正しい。
//
// ## 読み方
//
// 出るのは**関数ごとの自分の時間**（子を含めない）。子込みにすると rAF の
// コールバックが必ず1位になって何も分からない。
//
//   (idle) が大半             … JS は無罪。描画・デコード側を疑う
//   (garbage collector) が上位 … 作っては捨てている物がある
//   (program) が上位           … JS の外（レイアウト・合成）

/**
 * 標本を関数ごとにまとめて、自分の時間が長い順に返す。
 *
 * **回数ではなく実時間で数える**（`timeDeltas`）。標本器は詰まっている間だけ
 * 刻みが伸びるので、回数で数えると重い所ほど軽く見える。
 */
export function topSelf(profile, limit = 15) {
  const byId = new Map(profile.nodes.map((n) => [n.id, n]))
  const hits = new Map()
  for (let i = 0; i < profile.samples.length; i++) {
    const dt = (profile.timeDeltas[i] ?? 0) / 1000 // μs → ms
    if (dt <= 0) continue
    const id = profile.samples[i]
    hits.set(id, (hits.get(id) ?? 0) + dt)
  }
  const rows = []
  for (const [id, ms] of hits) {
    const f = byId.get(id)?.callFrame
    if (!f) continue
    rows.push({
      name: f.functionName || '(名前なし)',
      where: f.url ? `${f.url.split('/').pop()}:${f.lineNumber + 1}` : '',
      ms
    })
  }
  rows.sort((a, b) => b.ms - a.ms)
  return rows.slice(0, limit)
}

/**
 * CDP の標本器を用意する。`--cpu` が無ければ null を返す（呼ぶ側は素通し）。
 *
 * 刻みは既定 1000μs では 0.3秒の詰まりの中身が粗すぎるので 200μs にする。
 */
/**
 * 記録（トレース）を出来事の名前ごとにまとめて、長い順に返す。
 *
 * ※ **入れ子ぶんは重複して数える**（`RunTask` の中に `Paint` が入る形）。
 *   合計を足しても意味は無い。**名前どうしの大小**を見るための物。
 */
export function topEvents(events, limit = 12) {
  const by = new Map()
  for (const e of events) {
    if (e.ph !== 'X' || !(e.dur > 0)) continue
    const cur = by.get(e.name) ?? { ms: 0, n: 0 }
    cur.ms += e.dur / 1000
    cur.n++
    by.set(e.name, cur)
  }
  return [...by]
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.ms - a.ms)
    .slice(0, limit)
}

/**
 * @param {boolean} deep 標本器（関数ごとの内訳）と記録（描画の内訳）まで取るか。
 *
 * **既定では取らない。** 200μs 刻みの標本器は主スレッドを自分で使うので、
 * 「レイアウトでもスタイルでも JS でもない時間」に**自分の分が混ざる**。
 * 内訳（Performance の累計）だけなら、その心配が無い。
 */
export async function makeCpuProfiler(app, page, deep = false) {
  const client = await app.context().newCDPSession(page)
  /** 記録（トレース）で拾った出来事。`--cpu-deep` のときだけ溜まる */
  let events = []
  if (deep) {
    await client.send('Profiler.enable')
    await client.send('Profiler.setSamplingInterval', { interval: 200 })
    // **「その他」の正体はここでしか分からない。**
    // 標本器は JS の外を全部 `(program)` にまとめてしまうので、
    // 「レイアウトでもスタイルでも JS でもない 85%」が何なのかを答えられない。
    // 記録なら Paint / Rasterize / Decode Image / Composite Layers と名前で出る。
    client.on('Tracing.dataCollected', ({ value }) => events.push(...value))
    // **合成レイヤーの枚数**。`Layerize` が重いとき、まず疑うのはここ。
    // 枚数が多いほど組み直しは高くつく（併合の判定が枚数ぶん要る）
    await client.send('LayerTree.enable')
    await client.send('DOM.enable')
    client.on('LayerTree.layerTreeDidChange', ({ layers }) => {
      layerCount = layers ? layers.length : 0
      if (layerCount > layerMax) layerMax = layerCount
      if (layers) lastLayers = layers
    })
  }
  let layerCount = 0
  let layerMax = 0
  let lastLayers = []

  /**
   * レイヤーの**正体**を種類ごとに数える。
   *
   * 枚数だけ分かっても「何を直せばいいか」に届かない。どの要素が
   * レイヤーになっているかを、class 名でまとめて出す。
   */
  const layerKinds = async () => {
    const by = new Map()
    for (const l of lastLayers) {
      if (!l.backendNodeId) continue
      let key = '（要素なし）'
      try {
        const { node } = await client.send('DOM.describeNode', { backendNodeId: l.backendNodeId })
        const cls = node.attributes?.[(node.attributes ?? []).indexOf('class') + 1]
        key = `${node.nodeName.toLowerCase()}${cls ? '.' + cls.split(/\s+/).slice(0, 2).join('.') : ''}`
      } catch {
        key = '（消えた要素）'
      }
      by.set(key, (by.get(key) ?? 0) + 1)
    }
    return [...by].sort((a, b) => b[1] - a[1]).slice(0, 8)
  }
  // **JS の外の内訳**。標本器は JS の外をまとめて `(program)` にしてしまうので、
  // それだけでは「レイアウトなのか描画なのか」が分からない。
  // 2026-08-04、掴んだときの 26秒のうち **20.8秒が (program)**（JS は 0.7秒）だった。
  await client.send('Performance.enable')
  /** いまの累計（ms）と節の数 */
  const metrics = async () => {
    const { metrics: m } = await client.send('Performance.getMetrics')
    const get = (k) => m.find((x) => x.name === k)?.value ?? 0
    return {
      レイアウト: get('LayoutDuration') * 1000,
      スタイル計算: get('RecalcStyleDuration') * 1000,
      JS: get('ScriptDuration') * 1000,
      仕事の合計: get('TaskDuration') * 1000,
      節の数: get('Nodes'),
      レイアウト回数: get('LayoutCount'),
      スタイル計算回数: get('RecalcStyleCount')
    }
  }
  /**
   * **canvas を何回描き直したか**を数える仕掛けを入れる（アプリは触らない）。
   *
   * 内訳で「レイアウトでもスタイルでも JS でもない」時間が大半になったとき、
   * 残るのは描画そのもの。波形（`components/WaveformCanvas`）は
   * **1画素ずつ `fillRect` を呼ぶ**ので、描き直しの回数がそのまま効く。
   * `canvas.width` への代入は**中身を全部消して描き直させる**ので、そこも数える。
   */
  const installCanvasCount = () =>
    page.evaluate(() => {
      const w = window
      if (w.__cvPatched) {
        w.__cvCount = { fillRect: 0, resize: 0 }
        return
      }
      w.__cvPatched = true
      w.__cvCount = { fillRect: 0, resize: 0 }
      const proto = CanvasRenderingContext2D.prototype
      const orig = proto.fillRect
      proto.fillRect = function (...a) {
        w.__cvCount.fillRect++
        return orig.apply(this, a)
      }
      const d = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'width')
      if (d?.set) {
        Object.defineProperty(HTMLCanvasElement.prototype, 'width', {
          ...d,
          set(v) {
            w.__cvCount.resize++
            d.set.call(this, v)
          }
        })
      }
    })

  let before = null
  return {
    start: async () => {
      before = await metrics()
      await installCanvasCount()
      if (deep) {
        events = []
        layerMax = 0
        await client.send('Tracing.start', {
          transferMode: 'ReportEvents',
          traceConfig: { includedCategories: ['disabled-by-default-devtools.timeline'] }
        })
        await client.send('Profiler.start')
      }
    },
    /** 止めて、内訳と「自分の時間が長い順」を出す */
    stop: async (label) => {
      const profile = deep ? (await client.send('Profiler.stop')).profile : null
      if (deep) {
        const done = new Promise((r) => client.once('Tracing.tracingComplete', r))
        await client.send('Tracing.end')
        await done
      }
      const after = await metrics()
      const cv = await page.evaluate(() => window.__cvCount ?? { fillRect: 0, resize: 0 })
      console.log(`\n  --- ${label} で何をしていたか`)
      console.log(`    canvas: 描き直し ${cv.resize}回 / fillRect ${cv.fillRect}回`)
      if (before) {
        const d = (k) => Math.round(after[k] - before[k])
        // **「その他」を自分で出す。** 合計から引き算した残りが、
        // レイアウトでもスタイルでも JS でもない時間＝描画・画像デコードなど。
        // 読む人に引き算させると、そこを読み飛ばして「JS が重い」と決めつける
        const other = d('仕事の合計') - d('レイアウト') - d('スタイル計算') - d('JS')
        console.log(
          `    内訳: レイアウト ${d('レイアウト')}ms（${d('レイアウト回数')}回）` +
            ` / スタイル計算 ${d('スタイル計算')}ms（${d('スタイル計算回数')}回）` +
            ` / JS ${d('JS')}ms / **その他 ${other}ms** / 合計 ${d('仕事の合計')}ms` +
            ` / 節の数 ${Math.round(after['節の数'])}`
        )
      }
      if (deep) {
        console.log(`    合成レイヤー: いま ${layerCount}枚 / 最大 ${layerMax}枚`)
        const kinds = await layerKinds()
        if (kinds.length)
          console.log(`      正体: ${kinds.map(([k, n]) => `${k} ×${n}`).join(' / ')}`)
        for (const r of topEvents(events)) {
          console.log(`    ${String(Math.round(r.ms)).padStart(6)}ms  ${r.name}（${r.n}回）`)
        }
      }
      if (!profile) return
      const rows = topSelf(profile)
      if (!rows.length) {
        console.log('    標本が1つも取れなかった（測れていない）')
        return
      }
      for (const r of rows) {
        console.log(`    ${String(Math.round(r.ms)).padStart(6)}ms  ${r.name}  ${r.where}`)
      }
    }
  }
}
