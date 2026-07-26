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
  /** 「完了」を押して確定したか。false/未設定＝下書き（書きかけ） */
  done?: boolean
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
  // 表示の状態も覚える。再起動ボタンで再読み込みしても、検査票だけは
  // まったく同じ見た目で戻ってくるようにするため（作業の続きを見失わない）。
  const [filter, setFilter] = useState<Filter>(() => {
    const v = localStorage.getItem(KEY + '.filter')
    return v === 'star' || v === 'ng' ? v : 'all'
  })
  const [prompt, setPrompt] = useState<string | null>(null)
  // OK を付けた直後だけ残しておく（流れて消えるアニメのため）
  const [leaving, setLeaving] = useState<string[]>([])
  const [doneOpen, setDoneOpen] = useState(
    () => localStorage.getItem(KEY + '.doneOpen') === '1'
  )
  const timers = useRef<number[]>([])
  const bodyRef = useRef<HTMLDivElement>(null)
  // 最後に「完了」を押した項目。誤って再起動しても、ここから続けられる。
  const [resumeId, setResumeId] = useState<string>(
    () => localStorage.getItem(KEY + '.resume') ?? ''
  )
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
  useEffect(() => {
    localStorage.setItem(KEY + '.filter', filter)
  }, [filter])
  useEffect(() => {
    localStorage.setItem(KEY + '.doneOpen', doneOpen ? '1' : '0')
  }, [doneOpen])
  // スクロール位置も戻す（長い一覧の途中で再起動しても続きから見られる）
  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    const y = Number(localStorage.getItem(KEY + '.scroll'))
    if (y > 0) el.scrollTop = y
    let raf = 0
    const onScroll = (): void => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        localStorage.setItem(KEY + '.scroll', String(el.scrollTop))
      })
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      if (raf) cancelAnimationFrame(raf)
      el.removeEventListener('scroll', onScroll)
    }
  }, [])

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

  const ANIM = 300
  /** 確定した瞬間に、続きから再開するのに要るものをまとめて書き出す */
  function saveResume(id: string): void {
    setResumeId(id)
    try {
      localStorage.setItem(KEY + '.resume', id)
      localStorage.setItem(KEY + '.at', new Date().toISOString())
      if (bodyRef.current)
        localStorage.setItem(KEY + '.scroll', String(bodyRef.current.scrollTop))
    } catch {
      /* 無視 */
    }
  }
  /** 流して消す（OK だけ。NG は対処が要るので一覧に残す） */
  function fadeOut(id: string): void {
    setLeaving((p) => (p.includes(id) ? p : [...p, id]))
    const t = window.setTimeout(() => {
      setLeaving((p) => p.filter((x) => x !== id))
      timers.current = timers.current.filter((x) => x !== t)
    }, ANIM)
    timers.current.push(t)
  }
  // OK は「見て問題なし」で終わりなので1クリックで確定する。
  // NG だけは症状を書いてもらう必要があるので下書きにして「完了」を待つ。
  function mark(id: string, kind: Mark): void {
    const r = rec(id)
    const next = r.s === kind ? '' : kind
    if (next !== 'ok') {
      setRec(id, { s: next, done: false })
      return
    }
    setRec(id, { s: 'ok', done: true })
    saveResume(id)
    fadeOut(id)
  }
  /** NG の「完了」＝症状を書き終えて確認を終える */
  function commit(id: string): void {
    if (!rec(id).s) return
    setRec(id, { done: true })
    saveResume(id)
  }

  // 進捗は「完了を押して確定したもの」だけ数える。書きかけを進捗に入れると、
  // 実際より進んで見えて確認漏れの元になる。
  const nOk = items.filter((i) => rec(i.id).s === 'ok' && rec(i.id).done).length
  const nNg = items.filter((i) => rec(i.id).s === 'ng' && rec(i.id).done).length
  const nRest = items.length - nOk - nNg

  // 完了したものは一覧から外して下の「完了」にしまう。
  // 退場アニメが終わるまでは残しておく（いきなり消えると見失うため）。
  const visible = items.filter((i) => {
    const s = rec(i.id).s
    // 下書きのうちは残す（書きかけが消えると何をしていたか分からなくなる）
    if (s === 'ok' && rec(i.id).done && !leaving.includes(i.id)) return false
    if (filter === 'star') return i.star
    if (filter === 'ng') return s === 'ng'
    return true
  })
  const doneItems = items.filter((i) => rec(i.id).s === 'ok' && rec(i.id).done)
  const draftCount = items.filter((i) => rec(i.id).s && !rec(i.id).done).length
  // 続きの位置＝最後に確定した項目の次にある、まだ確定していない項目
  const resumeIdx = resumeId ? items.findIndex((i) => i.id === resumeId) : -1
  const nextItem =
    resumeIdx >= 0 ? items.slice(resumeIdx + 1).find((i) => !rec(i.id).done) : undefined

  // 章ごとにまとめる（表示順は元の並びのまま）
  const groups: { name: string; list: Item[] }[] = []
  for (const it of visible) {
    const g = groups[groups.length - 1]
    if (g && g.name === it.section) g.list.push(it)
    else groups.push({ name: it.section, list: [it] })
  }

  function buildPrompt(): string {
    // 確定した NG だけを載せる（書きかけは症状が未記入のことが多いため）
    const ng = items.filter((i) => rec(i.id).s === 'ng' && rec(i.id).done)
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
          {(nextItem || draftCount > 0) && (
            <div className="qa-resume">
              {draftCount > 0 && <b>書きかけ {draftCount} 件</b>}
              {nextItem && (
                <button
                  onClick={() => {
                    const el = bodyRef.current?.querySelector(
                      `[data-qa-id="${CSS.escape(nextItem.id)}"]`
                    )
                    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
                  }}
                >
                  続きへ移動
                </button>
              )}
            </div>
          )}
          <div className="qa-actions">
            <button className="qa-btn primary" onClick={() => setPrompt(buildPrompt())}>
              修正を依頼するプロンプトを作る
            </button>
            <button
              className="qa-btn"
              title="アプリの画面を最初から読み込み直します（起動時の処理をやり直せます）。&#10;検査票の記録・メモ・幅・スクロール位置はそのまま残ります。"
              onClick={() => {
                // プロセスごと再起動すると開発サーバまで終了してしまうので、
                // 画面の読み込み直しにしてある。起動処理（自動保存からの復元など）は
                // 最初からやり直されるので、起動まわりの確認はこれで足りる。
                // 検査票の状態は localStorage にあるため、この操作では消えない。
                location.reload()
              }}
            >
              ↻ 再起動
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

        <div className="qa-body" ref={bodyRef}>
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
                        r.s && !r.done ? 'is-draft' : ''
                      } ${leaving.includes(it.id) ? 'leaving' : ''} ${
                        nextItem && nextItem.id === it.id ? 'is-next' : ''
                      }`}
                      data-qa-id={it.id}
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
                        {r.s && !r.done && (
                          <div className="qa-commit">
                            <span>症状・修正案を書いたら完了を押す</span>
                            <button onClick={() => commit(it.id)}>完了</button>
                          </div>
                        )}
                        {r.s === 'ng' && r.done && (
                          <div className="qa-commit is-done">
                            <span>記録しました</span>
                            <button onClick={() => setRec(it.id, { done: false })}>
                              書き直す
                            </button>
                          </div>
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
/* 下書き（✓✕を押したがまだ完了していない）。確定前だと分かるようにする。 */
.qa-row.is-draft{box-shadow:inset 3px 0 0 #e0a94a}
.qa-commit{display:flex;align-items:center;gap:9px;margin-top:7px}
.qa-commit span{font-size:11.5px;color:#737b8a;flex:1}
.qa-commit button{border:1px solid #e0a94a;background:#e0a94a;color:#0f1216;border-radius:5px;
  padding:3px 14px;font-size:12px;font-weight:600;cursor:pointer;flex:none}
.qa-commit button:hover{filter:brightness(1.08)}
.qa-commit.is-done button{background:none;color:#737b8a;border-color:#2a3038;font-weight:400}
.qa-commit.is-done button:hover{border-color:#7ea2ff;color:#7ea2ff;filter:none}
/* 続きの位置 */
.qa-row.is-next{box-shadow:inset 3px 0 0 #7ea2ff}
.qa-resume{display:flex;align-items:center;gap:8px}
.qa-resume b{font-size:11.5px;color:#e0a94a;font-weight:600}
.qa-resume button{margin-left:auto;border:1px solid #2a3038;background:none;color:#7ea2ff;
  border-radius:5px;padding:3px 11px;font-size:11.5px;cursor:pointer}
.qa-resume button:hover{border-color:#7ea2ff}
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
