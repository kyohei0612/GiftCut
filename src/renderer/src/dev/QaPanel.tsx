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
import { useEffect, useMemo, useState } from 'react'
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

type Filter = 'all' | 'star' | 'rest' | 'ng'

export default function QaPanel({ onClose }: { onClose: () => void }): JSX.Element {
  const { title, items } = useMemo(() => parseChecklist(rawChecklist), [])
  const [store, setStore] = useState<Store>(loadStore)
  const [filter, setFilter] = useState<Filter>('all')
  const [prompt, setPrompt] = useState<string | null>(null)

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(store))
    } catch {
      /* 容量超過は無視 */
    }
  }, [store])

  const rec = (id: string): Rec => store[id] ?? { s: '', note: '' }
  const setRec = (id: string, patch: Partial<Rec>): void =>
    setStore((prev) => {
      const next = { ...prev, [id]: { ...(prev[id] ?? { s: '', note: '' }), ...patch } }
      const r = next[id]
      if (!r.s && !r.note) delete next[id]
      return next
    })

  const nOk = items.filter((i) => rec(i.id).s === 'ok').length
  const nNg = items.filter((i) => rec(i.id).s === 'ng').length
  const nRest = items.length - nOk - nNg

  const visible = items.filter((i) => {
    const s = rec(i.id).s
    if (filter === 'star') return i.star
    if (filter === 'rest') return !s
    if (filter === 'ng') return s === 'ng'
    return true
  })

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

  return (
    <div className="qa-veil" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <style>{QA_CSS}</style>
      <section className="qa" onPointerDown={(e) => e.stopPropagation()}>
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
                ['all', 'すべて'],
                ['star', '★のみ'],
                ['rest', '未確認'],
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
              {filter === 'ng'
                ? 'NG の項目はありません。'
                : filter === 'rest'
                  ? 'すべて確認しました。'
                  : '項目がありません。'}
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
                    <div className={`qa-row ${r.s ? 'is-' + r.s : ''}`} key={it.id}>
                      <div className="qa-mark">
                        <button
                          className={`qa-ok ${r.s === 'ok' ? 'on' : ''}`}
                          title="OK にする"
                          onClick={() => setRec(it.id, { s: r.s === 'ok' ? '' : 'ok' })}
                        >
                          ✓
                        </button>
                        <button
                          className={`qa-ng ${r.s === 'ng' ? 'on' : ''}`}
                          title="NG にする"
                          onClick={() => setRec(it.id, { s: r.s === 'ng' ? '' : 'ng' })}
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
        </div>
      </section>

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
    </div>
  )
}

// スタイルはこのファイルに閉じ込める（配布ビルドから丸ごと消えるように）
const QA_CSS = `
.qa-veil{position:fixed;inset:0;background:rgba(8,10,14,.62);display:grid;place-items:center;z-index:9000;padding:24px}
.qa-veil-2{z-index:9010;background:rgba(8,10,14,.5)}
.qa{background:#171b21;color:#e6e9ef;border:1px solid #2a3038;border-radius:10px;
  width:min(880px,100%);max-height:88vh;display:flex;flex-direction:column;
  box-shadow:0 24px 60px rgba(0,0,0,.5);font-size:14px}
.qa-sm{width:min(700px,100%)}
.qa-head{display:flex;align-items:flex-start;gap:12px;padding:14px 18px 10px;border-bottom:1px solid #21262d}
.qa-head h2{margin:0;font-size:16px;flex:1}
.qa-eyebrow{font-size:10.5px;letter-spacing:.1em;color:#e0a94a;margin-bottom:3px}
.qa-x{background:none;border:0;color:#737b8a;font-size:16px;cursor:pointer;padding:2px 6px;line-height:1}
.qa-x:hover{color:#e6e9ef}
.qa-bar{padding:12px 18px;border-bottom:1px solid #21262d;display:flex;flex-direction:column;gap:10px}
.qa-meter{display:flex;height:8px;border-radius:99px;overflow:hidden;background:#21262d}
.qa-meter span{display:block;transition:width .2s}
.qa-m-ok{background:#5cc98e}.qa-m-ng{background:#ff8a7e}
.qa-tally{display:flex;align-items:baseline;gap:6px;font-variant-numeric:tabular-nums}
.qa-tally b{font-size:18px;font-weight:600}
.qa-tally b.ok{color:#5cc98e}.qa-tally b.ng{color:#ff8a7e}.qa-tally b.rest{color:#737b8a}
.qa-tally small{font-size:11px;color:#737b8a;margin-right:10px}
.qa-filters{display:flex;gap:6px;flex-wrap:wrap}
.qa-chip{border:1px solid #2a3038;background:none;color:#a7aebc;border-radius:99px;
  padding:3px 11px;font-size:12.5px;cursor:pointer}
.qa-chip:hover{border-color:#7ea2ff;color:#7ea2ff}
.qa-chip.on{background:#1c2740;border-color:#7ea2ff;color:#7ea2ff;font-weight:600}
.qa-actions{display:flex;gap:8px;flex-wrap:wrap}
.qa-btn{border:1px solid #2a3038;background:none;color:#e6e9ef;border-radius:6px;
  padding:7px 14px;font-size:13px;cursor:pointer}
.qa-btn:hover{border-color:#7ea2ff;color:#7ea2ff}
.qa-btn.primary{background:#7ea2ff;border-color:#7ea2ff;color:#0f1216;font-weight:600}
.qa-btn.primary:hover{filter:brightness(1.08);color:#0f1216}
.qa-body{overflow:auto;flex:1;min-height:0;padding:14px 18px}
.qa-foot{display:flex;justify-content:flex-end;gap:8px;padding:12px 18px;border-top:1px solid #21262d}
.qa-empty{color:#737b8a;text-align:center;padding:30px 0}
.qa-sec{border:1px solid #2a3038;border-radius:8px;margin-bottom:12px;overflow:hidden}
.qa-sec-head{display:flex;align-items:baseline;gap:10px;padding:9px 13px;background:#1b2027;
  border-bottom:1px solid #21262d;position:sticky;top:0}
.qa-sec-head h3{margin:0;font-size:13.5px;flex:1}
.qa-count{font-size:11.5px;color:#737b8a;font-variant-numeric:tabular-nums}
.qa-count.done{color:#5cc98e;font-weight:600}.qa-count.has-ng{color:#ff8a7e;font-weight:600}
.qa-row{display:grid;grid-template-columns:auto minmax(0,1fr);gap:11px;padding:8px 13px;
  border-bottom:1px solid #21262d;align-items:start}
.qa-row:last-child{border-bottom:0}
.qa-row.is-ok{background:rgba(92,201,142,.07)}
.qa-row.is-ng{background:rgba(255,138,126,.09)}
.qa-mark{display:flex;gap:4px}
.qa-mark button{width:28px;height:24px;border:1px solid #2a3038;background:none;border-radius:5px;
  color:#737b8a;cursor:pointer;font-size:12px;line-height:1}
.qa-ok:hover,.qa-ok.on{border-color:#5cc98e;color:#5cc98e}
.qa-ok.on{background:#5cc98e;color:#0f1216}
.qa-ng:hover,.qa-ng.on{border-color:#ff8a7e;color:#ff8a7e}
.qa-ng.on{background:#ff8a7e;color:#0f1216}
.qa-txt{margin:0;line-height:1.6;font-size:13.5px}
.qa-row.is-ok .qa-txt{color:#a7aebc}
.qa-star{display:inline-block;font-size:10px;font-weight:700;color:#e0a94a;background:#322611;
  border-radius:4px;padding:1px 5px;margin-right:6px;vertical-align:1px}
.qa-note{width:100%;margin-top:7px;border:1px solid #ff8a7e;border-radius:6px;background:#0f1216;
  color:#e6e9ef;padding:7px 9px;font:inherit;font-size:13px;min-height:58px;resize:vertical}
.qa-out{width:100%;min-height:320px;background:#0f1216;color:#e6e9ef;border:1px solid #2a3038;
  border-radius:6px;padding:12px;font-family:ui-monospace,Consolas,monospace;font-size:12.5px;
  line-height:1.65;resize:vertical}
`
