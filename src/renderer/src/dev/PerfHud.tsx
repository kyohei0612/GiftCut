// 「いま何が起きているか」を出しっぱなしにする小窓（Ctrl+Shift+P）。
//
// カクついた**その瞬間の数字**が見えないと、何が詰まったのか分からない。
// あとから読み返せるように、記録をファイルに落とせるようにもしてある。

import { useEffect, useState, type JSX } from 'react'
import { perf, type PerfSample } from '../lib/perfMonitor'

export default function PerfHud({ onClose }: { onClose: () => void }): JSX.Element {
  const [s, setS] = useState<PerfSample | null>(null)
  const [n, setN] = useState(0)

  useEffect(() => {
    perf.onSample = (x): void => {
      setS(x)
      setN(perf.samples.length)
    }
    if (!perf.isRunning) perf.start()
    return () => {
      perf.onSample = null
    }
  }, [])

  // 詰まり具合で色を変える。数字だけだと、見ていて気づけない
  const bad = (s?.longTaskMs ?? 0) > 200 || (s?.worstFrameMs ?? 0) > 100
  const warn = (s?.longTaskMs ?? 0) > 50 || (s?.worstFrameMs ?? 0) > 50

  const [saved, setSaved] = useState('')
  // **blob のダウンロードは Electron では落ちる**（何も起きないまま「保存した」と
  // 思い込むのが一番まずい）。本体に書かせて、どこへ書いたかを画面に出す。
  const save = (): void => {
    const text = perf.report()
    void navigator.clipboard?.writeText(text).catch(() => {}) // 貼り付けでも渡せるように
    void window.giftcut
      ?.savePerfReport?.(text)
      .then((r) => setSaved(r?.ok ? `保存: ${r.path}` : `保存できません: ${r?.error ?? ''}`))
      .catch((e) => setSaved(`保存できません: ${String(e)}`))
  }

  return (
    <div className={`perf-hud ${bad ? 'perf-bad' : warn ? 'perf-warn' : ''}`}>
      <div className="perf-head">
        <span>動きの計測</span>
        <span className="perf-sec">{n}秒</span>
        <button className="perf-x" onClick={onClose} title="閉じる（Ctrl+Shift+P）">
          ✕
        </button>
      </div>
      {s ? (
        <table className="perf-tbl">
          <tbody>
            <tr>
              <td>コマ送り</td>
              <td>
                <b>{s.fps}</b> fps
              </td>
            </tr>
            <tr>
              <td>最悪の1コマ</td>
              <td>
                <b>{s.worstFrameMs}</b> ms
              </td>
            </tr>
            <tr title="50ms以上、主スレッドを占有した処理。音が切れる直接の原因">
              <td>塞いだ処理</td>
              <td>
                <b>{s.longTasks}</b> 回 / <b>{s.longTaskMs}</b> ms
              </td>
            </tr>
            <tr title="React が画面を作り直した回数。毎秒60回に近いなら作りが重い">
              <td>作り直し</td>
              <td>
                <b>{s.renders}</b> 回
              </td>
            </tr>
            <tr title="動画のデコードが間に合わず捨てたコマ。ここだけ多いなら画質の問題">
              <td>落としたコマ</td>
              <td>
                <b>{s.droppedFrames}</b>
              </td>
            </tr>
            <tr>
              <td>状況</td>
              <td className="perf-note">{s.note}</td>
            </tr>
          </tbody>
        </table>
      ) : (
        <div className="perf-note">測っています…</div>
      )}
      {saved && <div className="perf-note perf-saved">{saved}</div>}
      <div className="perf-btns">
        <button onClick={save} title="userData/perf に書き、同じ内容をコピーもします">
          記録を保存
        </button>
        <button onClick={() => perf.start()} title="いまから測り直す">
          測り直す
        </button>
      </div>
    </div>
  )
}
