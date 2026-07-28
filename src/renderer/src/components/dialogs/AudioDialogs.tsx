// 音まわりの2つのダイアログ。
//
//   SilenceCutDialog … 喋っていない所をまとめて切る
//   DuckingDialog    … 声に合わせて BGM を下げる
//
// どちらも「実行前に結果を見せる」という同じ作法で作ってある。
// 無音カットは切る前に「何か所・合計何秒」を、ダッキングは「声のある所が何か所」を出す。
// 数字をいじった結果がその場で分かるので、やってみるまで分からない、が無い。
//
// 計算そのものは shared/silenceCut・shared/ducking にあり、単体で確かめてある。
// ここは形（並べ方と文言）だけを受け持つ。

// 下げ方の設定は、書き出し側と同じ物を使う（別に定義すると必ずズレる）
import type { DuckOpts } from '../../../../shared/ducking'

export interface SilenceCutState {
  /** これより静かなら無音とみなす（dB） */
  noiseDb: number
  /** この長さ以上を無音とみなす（秒） */
  minSec: number
  /** 前後に残す余白（秒） */
  pad: number
  /** これより短い所は切らない（秒） */
  minLen: number
  /** 探した結果。null=まだ探していない */
  found: { start: number; dur: number }[] | null
  busy: boolean
}

export function SilenceCutDialog({
  state,
  onChange,
  cuts,
  totalSec,
  onFind,
  onApply,
  onClose
}: {
  state: SilenceCutState
  onChange: (patch: Partial<SilenceCutState>) => void
  /** 今の設定で実際に切られる区間 */
  cuts: { start: number; end: number }[]
  /** cuts の合計秒数 */
  totalSec: number
  onFind: () => void
  onApply: () => void
  onClose: () => void
}): React.JSX.Element {
  return (
    <div className="export-overlay" onClick={onClose}>
      <div className="restore-box sil-box" onClick={(e) => e.stopPropagation()}>
        <div className="restore-title">喋っていない所をまとめて切る</div>
        <div className="restore-msg">
          音の大きさだけで判断します。切る前に「どこを・何秒切るか」を出すので、
          数字を動かして納得してから実行してください。
        </div>
        <div className="sil-rows">
          <label className="sil-row">
            <span>これより静かなら無音</span>
            <input
              type="range"
              min={-60}
              max={-15}
              step={1}
              value={state.noiseDb}
              // 静かさ・長さを変えたら、探し直すまで結果は無効（found: null）
              onChange={(e) => onChange({ noiseDb: Number(e.target.value), found: null })}
            />
            <b>{state.noiseDb} dB</b>
          </label>
          <label className="sil-row">
            <span>この長さ以上を無音とみなす</span>
            <input
              type="range"
              min={0.1}
              max={2}
              step={0.05}
              value={state.minSec}
              onChange={(e) => onChange({ minSec: Number(e.target.value), found: null })}
            />
            <b>{state.minSec.toFixed(2)} 秒</b>
          </label>
          {/* バツっと切りたい人と、少し余白がほしい人の両方がいる */}
          <label className="sil-row">
            <span>前後に残す余白</span>
            <input
              type="range"
              min={0}
              max={0.6}
              step={0.01}
              value={state.pad}
              onChange={(e) => onChange({ pad: Number(e.target.value) })}
            />
            <b>{state.pad === 0 ? 'なし（バツっと切る）' : `${state.pad.toFixed(2)} 秒`}</b>
          </label>
          <label className="sil-row">
            <span>これより短い所は切らない</span>
            <input
              type="range"
              min={0}
              max={2}
              step={0.05}
              value={state.minLen}
              onChange={(e) => onChange({ minLen: Number(e.target.value) })}
            />
            <b>{state.minLen.toFixed(2)} 秒</b>
          </label>
        </div>
        <div className="sil-result">
          {/* 「見つからない」と「見つけたが条件で外れた」を分けて出す。
              一緒にすると、どの数字をゆるめればいいのか分からない */}
          {state.busy
            ? '調べています…'
            : state.found === null
              ? '「調べる」を押すと、どこが無音かを探します。'
              : state.found.length === 0
                ? '無音が1か所も見つかりませんでした。上の2つ（静かさ・長さ）をゆるめてください。'
                : cuts.length === 0
                  ? `無音は ${state.found.length} か所ありましたが、下の2つ（余白・最短）で全部外れました。`
                  : `${cuts.length} か所 / 合計 ${totalSec.toFixed(1)} 秒 短くなります（無音は ${state.found.length} か所）`}
        </div>
        <div className="restore-btns">
          <button className="btn" onClick={onFind} disabled={state.busy}>
            {state.found === null ? '調べる' : 'もう一度調べる'}
          </button>
          <button className="btn btn-primary" onClick={onApply} disabled={!cuts.length || state.busy}>
            切って詰める
          </button>
          <button className="btn" onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  )
}

export function DuckingDialog({
  opts,
  onChange,
  busy,
  found,
  voiceCount,
  hasEnvelope,
  onFind,
  onClose
}: {
  opts: DuckOpts
  onChange: (patch: Partial<DuckOpts>) => void
  /** 声のある所を調べている最中か */
  busy: boolean
  /** 無音を探した結果があるか（無音カットと同じ判定を裏返して使う） */
  found: boolean
  /** 声のある所の数 */
  voiceCount: number
  /** 音量の折れ線が作れているか */
  hasEnvelope: boolean
  onFind: () => void
  onClose: () => void
}): React.JSX.Element {
  return (
    <div className="export-overlay" onClick={onClose}>
      <div className="restore-box sil-box" onClick={(e) => e.stopPropagation()}>
        <div className="restore-title">声に合わせて BGM を下げる</div>
        <div className="restore-msg">
          喋っている間だけ下げます。判定は無音カットと同じ「静かな所」の裏返しなので、
          声を拾えていないときは、下の「調べ直す」で静かさのしきい値を変えてください。
        </div>
        <div className="sil-rows">
          <label className="sil-row">
            <span>どれだけ下げるか</span>
            <input
              type="range"
              min={-24}
              max={0}
              step={1}
              value={opts.amountDb}
              onChange={(e) => onChange({ amountDb: Number(e.target.value) })}
            />
            <b>{opts.amountDb === 0 ? '下げない' : `${opts.amountDb} dB`}</b>
          </label>
          <label className="sil-row">
            <span>下がりきるまで</span>
            <input
              type="range"
              min={0.02}
              max={1}
              step={0.01}
              value={opts.attack}
              onChange={(e) => onChange({ attack: Number(e.target.value) })}
            />
            <b>{opts.attack.toFixed(2)} 秒</b>
          </label>
          <label className="sil-row">
            <span>戻りきるまで</span>
            <input
              type="range"
              min={0.05}
              max={2}
              step={0.05}
              value={opts.release}
              onChange={(e) => onChange({ release: Number(e.target.value) })}
            />
            <b>{opts.release.toFixed(2)} 秒</b>
          </label>
        </div>
        <div className="sil-result">
          {busy
            ? '声のある所を調べています…'
            : !found
              ? '声のある所がまだ分かりません。「調べ直す」を押してください。'
              : !hasEnvelope
                ? '声が見つかりませんでした（無音カットの設定で静かさを変えて調べ直してください）。'
                : `声のある所 ${voiceCount} か所に合わせて下げます。再生すると、そのまま聴けます。`}
        </div>
        <div className="restore-btns">
          <button className="btn" onClick={onFind} disabled={busy}>
            調べ直す
          </button>
          <button className="btn btn-primary" onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  )
}
