// ============================================================================
// 検査票（開発中だけ出る動作確認パネル）
//
// 自動テストで守れるのは「起動する・計算が合う・後片付けされる」まで。
// 操作の連鎖と目で見ないと分からないことは人が触るしかないので、その項目を
// アプリの中からいつでも開けるようにしてある。
//
// 配布ビルドには入らない:
//   App.tsx 側で import.meta.env.DEV の中でだけ動的 import しているため、
//   本番ビルドでは分岐ごと消えて、このファイルも読み込まれない。
//   （確認: npm run build して out/renderer に qa-checklist の文字列が無いこと）
//
// 項目の追加・修正は qa-checklist.md を編集するだけでよい。
// ============================================================================
import { useEffect, useMemo, useRef, useState } from 'react'
import rawChecklist from './qa-checklist.md?raw'

interface Item {
  id: string
  section: string
  text: string
  star: boolean
}
type Mark = '' | 'ok' | 'ng'
interface Rec {
  s: Mark
  note: string
}
type Store = Record<string, Rec>

const KEY = 'giftcut.qa'

/** 「## 見出し」で章、「- [ ] 内容」で項目。行頭 ★ は重点項目。 */
function parseChecklist(md: string): { title: string; items: Item[] } {
  const items: Item[] = []
  let section = 'その他'
  let title = ''
  for (const line of md.split(/\r?\n/)) {
    const mT = /^#\s+(.*)$/.exec(line)
    if (mT) {
      title = mT[1].trim()
      continue
    }
    const mS = /^##+\s+(.*)$/.exec(line)
    if (mS) {
      section = mS[1].trim()
      continue
    }
    const mI = /^\s*-\s*\[[ xX]?\]\s*(.*)$/.exec(line)
    if (!mI) continue
    let text = mI[1].trim()
    if (!text) continue
    let star = false
    if (text.startsWith('★')) {
      star = true
      text = text.replace(/^★\s*/, '')
    }
    // 見出しからの相対で一意になるので、文言を直しても章が同じなら記録は残る
    items.push({ id: section + '||' + text, section, text, star })
  }
  return { title, items }
}

function loadStore(): Store {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Store) : {}
  } catch {
    return {}
  }
}

type Filter = 'all' | 'star' | 'ng'

export default function QaPanel({ onClose }: { onClose: () => void }): JSX.Element {
  const { title, items } = useMemo(() => parseChecklist(rawChecklist), [])
  const [store, setStore] = useState<Store>(loadStore)
  const [filter, setFilter] = useState<Filter>('all')
  const [prompt, setPrompt] = useState<string | null>(null)
  // OK を付けた直後だけ残しておく（流れて消えるアニメのため）
  const [leaving, setLeaving] = useState<string[]>([])
  const [doneOpen, setDoneOpen] = useState(false)
  const timers = useRef<number[]>([])
  const [width, setWidth] = useState<number>(() => {
    const v = Number(localStorage.getItem(KEY + '.w'))
    return v >= 280 && v <= 720 ? v : 380
  })

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(store))
    } catch {
      /* 容量超過は無視 */
    }
  }, [store])

  // 閉じたらアプリ側の余白も戻し、退場アニメのタイマーも止める
  useEffect(() => {
    const t = timers
    return () => {
      document.documentElement.style.removeProperty('--qa-w')
      t.current.forEach((id) => window.clearTimeout(id))
      t.current = []
    }
  }, [])
  const rec = (id: string): Rec => store[id] ?? { s: '', note: '' }
  const setRec = (id: string, patch: Partial<Rec>): void =>
    setStore((prev) => {
      const next = { ...prev, [id]: { ...(prev[id] ?? { s: '', note: '' }), ...patch } }
      const r = next[id]
      if (!r.s && !r.note) delete next[id]
      return next
    })

  // OK にしたら少し見せてから消す。NG はそのまま残す（対処が要るため）。
  const ANIM = 300
  function mark(id: string, kind: Mark): void {
    const next = rec(id).s === kind ? '' : kind
    setRec(id, { s: next })
    if (next !== 'ok') return
    setLeaving((p) => (p.includes(id) ? p : [...p, id]))
    const t = window.setTimeout(() => {
      setLeaving((p) => p.filter((x) => x !== id))
      timers.current = timers.current.filter((x) => x !== t)
    }, ANIM)
    timers.current.push(t)
  }

  const nOk = items.filter((i) => rec(i.id).s === 'ok').length
  const nNg = items.filter((i) => rec(i.id).s === 'ng').length
  const nRest = items.length - nOk - nNg

  // 完了したものは一覧から外して下の「完了」にしまう。
  // 退場アニメが終わるまでは残しておく（いきなり消えると見失うため）。
  const visible = items.filter((i) => {
    const s = rec(i.id).s
    if (s === 'ok' && !leaving.includes(i.id)) return false
    if (filter === 'star') return i.star
    if (filter === 'ng') return s === 'ng'
    return true
  })
  const doneItems = items.filter((i) => rec(i.id).s === 'ok')

  // 章ごとにまとめる（表示順は元の並びのまま）
  const groups: { name: string; list: Item[] }[] = []
  for (const it of visible) {
    const g = groups[groups.length - 1]
    if (g && g.name === it.section) g.list.push(it)
    else groups.push({ name: it.section, list: [it] })
  }

  function buildPrompt(): string {
    const ng = items.filter((i) => rec(i.id).s === 'ng')
    const tail = `確認: ${items.length} 項目中 ${nOk} 件OK / ${nNg} 件NG / 未確認 ${nRest} 件`
    if (!ng.length) return `${title} をしました。NG はありません。\n\n${tail}`
    const out: string[] = [
      `${title} で、次の ${ng.length} 件が期待どおりに動きませんでした。`,
      '原因を調べて修正してください。修正したら、同じ問題を二度と通さないための検証も足してください。',
      ''
    ]
    let last = ''
    for (const it of ng) {
      if (it.section !== last) {
        out.push('## ' + it.section)
        last = it.section
      }
      out.push('- 期待: ' + it.text)
      const note = rec(it.id).note.trim()
      if (note) note.split(/\r?\n/).forEach((l, i) => out.push(`  ${i === 0 ? '実際: ' : '      '}${l}`))
      else out.push('  実際: （メモなし）')
    }
    out.push('', tail)
    return out.join('\n')
  }

  // 幅はドラッグで変えられる。アプリ本体は marginRight で縮むので、
  // パネルがアプリを覆い隠さない（検証しながらチェックを付けるため）。
  useEffect(() => {
    document.documentElement.style.setProperty('--qa-w', width + 'px')
    try {
      localStorage.setItem(KEY + '.w', String(width))
    } catch {
      /* 無視 */
    }
  }, [width])

  function startResize(e: React.PointerEvent): void {
    e.preventDefault()
    const startX = e.clientX
    const startW = width
    const onMove = (ev: PointerEvent): void => {
      // 左へドラッグすると広がる（パネルは右端に固定されているため）
      setWidth(Math.min(720, Math.max(280, startW + (startX - ev.clientX))))
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <>
      <style>{QA_CSS}</style>
      <aside className="qa" style={{ width }}>
        <div className="qa-grip" onPointerDown={startResize} title="ドラッグで幅を変える" />
        <header className="qa-head">
          <div>
            <div className="qa-eyebrow">開発中のみ表示 / 配布ビルドには入りません</div>
            <h2>{title || '動作確認'}</h2>
          </div>
          <button className="qa-x" onClick={onClose} title="閉じる">
            ✕
          </button>
        </header>

        <div className="qa-bar">
          <div className="qa-meter" aria-hidden="true">
            <span className="qa-m-ok" style={{ width: `${(nOk / (items.length || 1)) * 100}%` }} />
            <span className="qa-m-ng" style={{ width: `${(nNg / (items.length || 1)) * 100}%` }} />
          </div>
          <div className="qa-tally">
            <b className="ok">{nOk}</b>
            <small>OK</small>
            <b className="ng">{nNg}</b>
            <small>NG</small>
            <b className="rest">{nRest}</b>
            <small>未確認</small>
          </div>
          <div className="qa-filters">
            {(
              [
                ['all', '残り'],
                ['star', '★のみ'],
                ['ng', 'NG']
              ] as [Filter, string][]
            ).map(([f, label]) => (
              <button
                key={f}
                className={`qa-chip ${filter === f ? 'on' : ''}`}
                onClick={() => setFilter(f)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="qa-actions">
            <button className="qa-btn primary" onClick={() => setPrompt(buildPrompt())}>
              修正を依頼するプロンプトを作る
            </button>
            <button
              className="qa-btn"
              onClick={() => {
                if (!Object.keys(store).length) return
                if (window.confirm('この検査の記録を消します。項目そのものは残ります。')) setStore({})
              }}
            >
              記録を消す
            </button>
          </div>
        </div>

        <div className="qa-body">
          {!visible.length && (
            <p className="qa-empty">
              {filter === 'ng' ? 'NG の項目はありません。' : 'ぜんぶ確認しました。'}
            </p>
          )}
          {groups.map((g) => {
            const all = items.filter((x) => x.section === g.name)
            const ok = all.filter((x) => rec(x.id).s === 'ok').length
            const ng = all.filter((x) => rec(x.id).s === 'ng').length
            return (
              <div className="qa-sec" key={g.name}>
                <div className="qa-sec-head">
                  <h3>{g.name}</h3>
                  <span className={`qa-count ${ng ? 'has-ng' : ok === all.length ? 'done' : ''}`}>
                    {ok}
                    {ng ? `+${ng}NG` : ''} / {all.length}
                  </span>
                </div>
                {g.list.map((it) => {
                  const r = rec(it.id)
                  return (
                    <div
                      className={`qa-row ${r.s ? 'is-' + r.s : ''} ${
                        leaving.includes(it.id) ? 'leaving' : ''
                      }`}
                      key={it.id}
                    >
                      <div className="qa-mark">
                        <button
                          className={`qa-ok ${r.s === 'ok' ? 'on' : ''}`}
                          title="OK にする"
                          onClick={() => mark(it.id, 'ok')}
                        >
                          ✓
                        </button>
                        <button
                          className={`qa-ng ${r.s === 'ng' ? 'on' : ''}`}
                          title="NG にする"
                          onClick={() => mark(it.id, 'ng')}
                        >
                          ✕
                        </button>
                      </div>
                      <div>
                        <p className="qa-txt">
                          {it.star && <span className="qa-star">重点</span>}
                          {it.text}
                        </p>
                        {r.s === 'ng' && (
                          <textarea
                            className="qa-note"
                            placeholder="症状・修正案（そのままプロンプトに入ります）"
                            value={r.note}
                            onChange={(e) => setRec(it.id, { note: e.target.value })}
                          />
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })}

          {/* 消し込んだものはここにしまう。戻せば一覧に復帰する。 */}
          {doneItems.length > 0 && (
            <div className="qa-done">
              <button className="qa-done-head" onClick={() => setDoneOpen((o) => !o)}>
                <span className="qa-caret">{doneOpen ? '▼' : '▶'}</span>
                完了
                <b>{doneItems.length}</b>
              </button>
              {doneOpen && (
                <>
                  {doneItems.map((it) => (
                    <div className="qa-done-row" key={it.id}>
                      <span>
                        {it.star && <span className="qa-star">重点</span>}
                        {it.text}
                      </span>
                      <button onClick={() => setRec(it.id, { s: '' })}>戻す</button>
                    </div>
                  ))}
                  <div className="qa-done-foot">
                    <button
                      onClick={() => {
                        if (window.confirm(doneItems.length + ' 件を未確認に戻します。'))
                          doneItems.forEach((it) => setRec(it.id, { s: '' }))
                      }}
                    >
                      ぜんぶ戻す
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </aside>

      {/* 生成したプロンプトはパネル内に重ねて出す（アプリ本体は隠さない） */}
      {prompt !== null && (
        <div className="qa-veil qa-veil-2" onPointerDown={() => setPrompt(null)}>
          <section className="qa qa-sm" onPointerDown={(e) => e.stopPropagation()}>
            <header className="qa-head">
              <h2>このまま渡せます</h2>
              <button className="qa-x" onClick={() => setPrompt(null)}>
                ✕
              </button>
            </header>
            <div className="qa-body">
              <textarea className="qa-out" readOnly value={prompt} />
            </div>
            <div className="qa-foot">
              <button className="qa-btn" onClick={() => setPrompt(null)}>
                閉じる
              </button>
              <button
                className="qa-btn primary"
                onClick={() => {
                  void navigator.clipboard.writeText(prompt)
                  setPrompt(null)
                }}
              >
                コピー
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  )
}

// スタイルはこのファイルに閉じ込める（配布ビルドから丸ごと消えるように）
const QA_CSS = `
/* 右端にドッキングする。アプリ本体は marginRight で縮むので隠れない。 */
.qa{position:fixed;top:0;right:0;bottom:0;z-index:8500;display:flex;flex-direction:column;
  background:#171b21;color:#e6e9ef;border-left:1px solid #2a3038;font-size:14px;
  box-shadow:-8px 0 24px rgba(0,0,0,.35)}
.qa-grip{position:absolute;left:-3px;top:0;bottom:0;width:7px;cursor:ew-resize;z-index:1}
.qa-grip:hover{background:#7ea2ff}
.qa-head{display:flex;align-items:flex-start;gap:10px;padding:12px 14px 9px;border-bottom:1px solid #21262d}
.qa-head h2{margin:0;font-size:15px;flex:1}
.qa-eyebrow{font-size:10px;letter-spacing:.08em;color:#e0a94a;margin-bottom:3px}
.qa-x{background:none;border:0;color:#737b8a;font-size:15px;cursor:pointer;padding:2px 5px;line-height:1}
.qa-x:hover{color:#e6e9ef}
.qa-bar{padding:10px 14px;border-bottom:1px solid #21262d;display:flex;flex-direction:column;gap:9px}
.qa-meter{display:flex;height:7px;border-radius:99px;overflow:hidden;background:#21262d}
.qa-meter span{display:block;transition:width .2s}
.qa-m-ok{background:#5cc98e}.qa-m-ng{background:#ff8a7e}
.qa-tally{display:flex;align-items:baseline;gap:5px;font-variant-numeric:tabular-nums}
.qa-tally b{font-size:17px;font-weight:600}
.qa-tally b.ok{color:#5cc98e}.qa-tally b.ng{color:#ff8a7e}.qa-tally b.rest{color:#737b8a}
.qa-tally small{font-size:10.5px;color:#737b8a;margin-right:9px}
.qa-filters{display:flex;gap:5px;flex-wrap:wrap}
.qa-chip{border:1px solid #2a3038;background:none;color:#a7aebc;border-radius:99px;
  padding:2px 10px;font-size:12px;cursor:pointer}
.qa-chip:hover{border-color:#7ea2ff;color:#7ea2ff}
.qa-chip.on{background:#1c2740;border-color:#7ea2ff;color:#7ea2ff;font-weight:600}
.qa-actions{display:flex;gap:6px;flex-wrap:wrap}
.qa-btn{border:1px solid #2a3038;background:none;color:#e6e9ef;border-radius:6px;
  padding:6px 12px;font-size:12.5px;cursor:pointer}
.qa-btn:hover{border-color:#7ea2ff;color:#7ea2ff}
.qa-btn.primary{background:#7ea2ff;border-color:#7ea2ff;color:#0f1216;font-weight:600}
.qa-btn.primary:hover{filter:brightness(1.08);color:#0f1216}
.qa-body{overflow:auto;flex:1;min-height:0;padding:12px 14px}
.qa-foot{display:flex;justify-content:flex-end;gap:8px;padding:10px 14px;border-top:1px solid #21262d}
.qa-empty{color:#737b8a;text-align:center;padding:26px 0}
.qa-sec{border:1px solid #2a3038;border-radius:8px;margin-bottom:10px;overflow:hidden}
.qa-sec-head{display:flex;align-items:baseline;gap:8px;padding:8px 11px;background:#1b2027;
  border-bottom:1px solid #21262d;position:sticky;top:0;z-index:1}
.qa-sec-head h3{margin:0;font-size:13px;flex:1}
.qa-count{font-size:11px;color:#737b8a;font-variant-numeric:tabular-nums}
.qa-count.done{color:#5cc98e;font-weight:600}.qa-count.has-ng{color:#ff8a7e;font-weight:600}
.qa-row{display:grid;grid-template-columns:auto minmax(0,1fr);gap:9px;padding:7px 11px;
  border-bottom:1px solid #21262d;align-items:start}
.qa-row:last-child{border-bottom:0}
.qa-row.is-ok{background:rgba(92,201,142,.07)}
.qa-row.is-ng{background:rgba(255,138,126,.09)}
.qa-mark{display:flex;gap:3px}
.qa-mark button{width:26px;height:23px;border:1px solid #2a3038;background:none;border-radius:5px;
  color:#737b8a;cursor:pointer;font-size:11.5px;line-height:1}
.qa-ok:hover,.qa-ok.on{border-color:#5cc98e;color:#5cc98e}
.qa-ok.on{background:#5cc98e;color:#0f1216}
.qa-ng:hover,.qa-ng.on{border-color:#ff8a7e;color:#ff8a7e}
.qa-ng.on{background:#ff8a7e;color:#0f1216}
.qa-txt{margin:0;line-height:1.55;font-size:13px}
.qa-row.is-ok .qa-txt{color:#a7aebc}
.qa-star{display:inline-block;font-size:9.5px;font-weight:700;color:#e0a94a;background:#322611;
  border-radius:4px;padding:1px 4px;margin-right:5px;vertical-align:1px}
/* 消し込みの退場アニメ。高さも詰めるので、下の項目がすっと繰り上がる。 */
@keyframes qa-leave{
  0%{opacity:1;transform:translateX(0)}
  100%{opacity:0;transform:translateX(26px)}
}
.qa-row.leaving{animation:qa-leave .3s ease forwards;
  transition:max-height .3s ease,padding .3s ease;max-height:0;padding-top:0;padding-bottom:0;
  overflow:hidden;pointer-events:none}
@media (prefers-reduced-motion:reduce){.qa-row.leaving{animation:none;opacity:0}}
/* 完了リスト */
.qa-done{border:1px solid #2a3038;border-radius:8px;overflow:hidden;margin-top:4px}
.qa-done-head{width:100%;display:flex;align-items:center;gap:7px;background:#1b2027;border:0;
  color:#a7aebc;padding:8px 11px;font:inherit;font-size:12.5px;cursor:pointer;text-align:left}
.qa-done-head:hover{color:#e6e9ef}
.qa-done-head b{margin-left:auto;color:#5cc98e;font-variant-numeric:tabular-nums}
.qa-caret{font-size:9px;color:#737b8a}
.qa-done-row{display:flex;align-items:flex-start;gap:9px;padding:6px 11px;
  border-top:1px solid #21262d;font-size:12.5px;color:#737b8a}
.qa-done-row span{flex:1;line-height:1.5}
.qa-done-row button{border:1px solid #2a3038;background:none;color:#a7aebc;border-radius:5px;
  padding:2px 9px;font-size:11.5px;cursor:pointer;flex:none}
.qa-done-row button:hover{border-color:#7ea2ff;color:#7ea2ff}
.qa-done-foot{padding:7px 11px;border-top:1px solid #21262d;text-align:right}
.qa-done-foot button{border:1px solid #2a3038;background:none;color:#737b8a;border-radius:5px;
  padding:3px 11px;font-size:11.5px;cursor:pointer}
.qa-done-foot button:hover{border-color:#ff8a7e;color:#ff8a7e}
.qa-note{width:100%;margin-top:6px;border:1px solid #ff8a7e;border-radius:6px;background:#0f1216;
  color:#e6e9ef;padding:6px 8px;font:inherit;font-size:12.5px;min-height:54px;resize:vertical}
/* 生成したプロンプトはパネルの中だけを覆う（アプリ本体は操作できたまま） */
.qa-veil-2{position:absolute;inset:0;background:rgba(8,10,14,.7);display:flex;
  flex-direction:column;padding:12px;z-index:2}
.qa-sm{position:static;box-shadow:none;border:1px solid #2a3038;border-radius:8px;width:auto;flex:1;min-height:0}
.qa-out{width:100%;height:100%;min-height:180px;background:#0f1216;color:#e6e9ef;
  border:1px solid #2a3038;border-radius:6px;padding:10px;
  font-family:ui-monospace,Consolas,monospace;font-size:12px;line-height:1.6;resize:none}
`
