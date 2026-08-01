// プレビューの下に付く3つ。
//
//   AudioMixer   … 音声トラックの音量・ミュート・ソロ（オーディオミキサータブ）
//   PreviewScrub … 全体のどこを見ているかのバー
//   TransportBar … 再生などの操作
//
// ## 操作バーは1段。ただし「詰め込んだ」わけではない
//
// 以前は2段で、1段目＝状態（いま何秒か・画質・fps・尺）／2段目＝操作だった。
// **プレビューの縦を 26px 損していた**ので1段にまとめたが、素直に詰めると
// 一番よく押す再生ボタンが端へ寄って毎回探すことになる（前に実際そうだった）。
//
// そこで、状態のうち**押さない物（画質・fps・尺＝`TransportInfo`）は
// パネルの見出し行へ出した**。残った時刻とボタンだけなら、左右を同じ幅で
// 挟んだまま1段に収まる＝再生ボタンは中央のまま。
//
// 一度「見出しへ出さずに1段化」を試して**逆に 71→73px 増えた**。
// 右側が 534px 要るのに 505px しかなく、ボタンが折り返したため。
// 左右対称をやめれば入るが、それは再生ボタンの中央維持を捨てることになる。

import type { JSX } from 'react'
import { formatTime } from '../../lib/srt'

/** 再生して見るときの映像の高さ。**書き出しの画質とは別物** */
export type PreviewRes = 1080 | 720 | 360

export interface MixerTrack {
  id: string
  name: string
  muted?: boolean
  solo?: boolean
  volume: number
}

export function AudioMixer({
  tracks,
  master,
  onToggleMute,
  onToggleSolo,
  onVolume,
  onMaster,
  startFader,
  gainToDb
}: {
  tracks: MixerTrack[]
  master: number
  onToggleMute: (id: string) => void
  onToggleSolo: (id: string) => void
  onVolume: (id: string, v: number) => void
  onMaster: (v: number) => void
  /** つまみを掴んで動かす処理（0..1 を返す） */
  startFader: (e: React.PointerEvent, set: (v: number) => void) => void
  gainToDb: (g: number) => string
}): JSX.Element {
  const fader = (value: number, set: (v: number) => void): JSX.Element => (
    <div className="mix-fader" onPointerDown={(e) => startFader(e, set)}>
      <div className="mix-fill" style={{ height: `${value * 100}%` }} />
      <div className="mix-knob" style={{ bottom: `${value * 100}%` }} />
    </div>
  )
  return (
    <div className="mixer-stage">
      <div className="mixer">
        {tracks.map((tr) => (
          <div className="mix-ch" key={tr.id}>
            <div className="mix-ms">
              <button
                className={`mix-msbtn ${tr.muted ? 'mix-mute' : ''}`}
                title="ミュート"
                onClick={() => onToggleMute(tr.id)}
              >
                M
              </button>
              <button
                className={`mix-msbtn ${tr.solo ? 'mix-solo' : ''}`}
                title="ソロ"
                onClick={() => onToggleSolo(tr.id)}
              >
                S
              </button>
            </div>
            {fader(tr.volume, (v) => onVolume(tr.id, v))}
            <div className="mix-db">{gainToDb(tr.volume)} dB</div>
            <div className="mix-name">{tr.name}</div>
          </div>
        ))}
        <div className="mix-ch mix-master">
          <div className="mix-ms" />
          {fader(master, onMaster)}
          <div className="mix-db">{gainToDb(master)} dB</div>
          <div className="mix-name">マスター</div>
        </div>
      </div>
    </div>
  )
}

/**
 * 全体のどこを見ているかを示すバー（プレミアと同じ役割）。
 * タイムラインを見に行かなくても位置が分かり、押した所へ飛べる。
 */
export function PreviewScrub({
  currentTime,
  duration,
  onSeek,
  onScrubStart
}: {
  currentTime: number
  duration: number
  onSeek: (t: number) => void
  /** 掴んだ瞬間にやること（再生を止める） */
  onScrubStart: () => void
}): JSX.Element {
  const total = Math.max(0.001, duration)
  const pct = Math.min(100, Math.max(0, (currentTime / total) * 100))
  return (
    <div
      className="preview-scrub"
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.preventDefault()
        // 位置は「バー本体」で測る。外枠には左右の余白があるので、
        // 外枠で測るとつまみが余白ぶん右へずれる（押した所と合わなくなる）。
        const track = e.currentTarget.querySelector('.preview-scrub-track')
        const rect = (track ?? e.currentTarget).getBoundingClientRect()
        const seekAt = (cx: number): void => {
          const t = ((cx - rect.left) / rect.width) * total
          onSeek(Math.min(total, Math.max(0, t)))
        }
        onScrubStart()
        seekAt(e.clientX)
        const mv = (ev: PointerEvent): void => seekAt(ev.clientX)
        const up = (): void => {
          window.removeEventListener('pointermove', mv)
          window.removeEventListener('pointerup', up)
        }
        window.addEventListener('pointermove', mv)
        window.addEventListener('pointerup', up)
      }}
      title="押した所へ飛びます（掴んだまま動かすと早送り・巻き戻し）"
    >
      <div className="preview-scrub-track">
        {/* 頭と尻は長めの印にする。どこが始まりでどこが終わりか一目で分かる */}
        <span className="preview-scrub-edge preview-scrub-edge-l" />
        <span className="preview-scrub-edge preview-scrub-edge-r" />
        {/* だいたいの位置をつかむための目盛り */}
        {Array.from({ length: 9 }, (_, i) => (
          <span key={i} className="preview-scrub-tick" style={{ left: `${(i + 1) * 10}%` }} />
        ))}
        {/* 再生位置。塗りつぶしはせず、つまみだけ出す */}
        <div className="preview-scrub-head" style={{ left: `${pct}%` }} />
      </div>
    </div>
  )
}

/**
 * 操作バーの右側に出る「いまどう見えているか」。画質・素材のfps・再生速度・尺。
 *
 * **書き出しの設定と取り違えやすい。** 書き出し設定にも同じ見た目の解像度選択が
 * あり、実際に取り違えが起きた。「👁 プレビュー」の札と、選択肢そのものにも
 * 「プレビュー」を書いて、見るときの話だと分かるようにしてある。
 */
export function TransportInfo({
  previewRes,
  onPreviewRes,
  hasVideo,
  fps,
  playRate,
  duration
}: {
  previewRes: PreviewRes
  onPreviewRes: (v: PreviewRes) => void
  /** 素材が入っているか。無いときは fps を出さない（出すと嘘になる） */
  hasVideo: boolean
  fps: number
  /** 早送り・巻き戻しの倍率。0 と ±1 のときは出さない（等速は言わなくても分かる） */
  playRate: number
  duration: number
}): JSX.Element {
  return (
    <>
      <span className="pq-tag" title="再生して見るときの画質（書き出しには影響しません）">
        👁 プレビュー
      </span>
      <select
        className="pq-select pq-preview"
        value={String(previewRes)}
        onChange={(e) => {
          const v = e.target.value
          onPreviewRes(v === '1080' ? 1080 : v === '720' ? 720 : 360)
        }}
        title={
          'プレビューの解像度\n' +
          '**どれも編集用に焼き直した映像で再生します**（全コマがキーフレームなので、\n' +
          'カットで飛んでも引っかかりません）。素材がその高さより小さければそのままです。\n' +
          '・1080p＝見た目はほぼ原本。容量は一番使う\n' +
          '・720p ＝標準。作るのも速い\n' +
          '・360p ＝最軽量。再描画も間引く\n' +
          '書き出しは常に原本のフル画質です（この設定は完成品の画質に影響しません）'
        }
      >
        <option value="1080">プレビュー 1080p（高画質）</option>
        <option value="720">プレビュー 720p（標準）</option>
        <option value="360">プレビュー 360p（最軽量）</option>
      </select>
      {hasVideo && (
        <span className="tc tc-fps" title="素材の実フレームレート（フレーム送り・タイムコードに反映）">
          {Number.isInteger(fps) ? fps : fps.toFixed(2)}fps
        </span>
      )}
      <span className="tc">
        {playRate !== 0 && Math.abs(playRate) !== 1
          ? `${playRate > 0 ? '' : '-'}${Math.abs(playRate)}x / `
          : ''}
        {formatTime(duration)}
      </span>
    </>
  )
}

export function TransportBar({
  timecode,
  playing,
  onSkip,
  onStep,
  onTogglePlay,
  onScreenshot,
  onJumpMarker,
  onAddMarker,
  keyHint
}: {
  timecode: string
  playing: boolean
  onSkip: (sec: number) => void
  onStep: (frames: number) => void
  onTogglePlay: () => void
  onScreenshot: () => void
  onJumpMarker: (dir: -1 | 1) => void
  onAddMarker: () => void
  /** 操作ごとのキーの表示（無ければ空文字） */
  keyHint: { back: string; play: string; fwd: string; marker: string }
}): JSX.Element {
  return (
    <div className="transport">
      {/* **再生ボタンを行のど真ん中に置く。**
          並べただけだと、左右のボタンの数で中心がずれる（前は左寄りだった）。
          左右を同じ幅の入れ物で挟み、真ん中に再生だけを置けば、
          ボタンが増えても中心は動かない。一番よく押す物の位置を毎回探さずに済む。 */}
      <div className="transport-btns">
        <div className="tb-side tb-side-l">
        {/* いま何秒か。左端へ寄せる（ボタンは右詰めのまま＝中心は動かない） */}
        <span className="tc tc-cur">{timecode}</span>
        <button className="tbtn" onClick={() => onSkip(-10)} title="10秒戻る">
          «10
        </button>
        <button className="tbtn" onClick={() => onSkip(-5)} title="5秒戻る">
          «5
        </button>
        <button className="tbtn" onClick={() => onStep(-1)} title={`1フレーム戻る (${keyHint.back})`}>
          ◁ǀ
        </button>
        </div>
        <button
          className="tbtn tbtn-play"
          onClick={onTogglePlay}
          title={`再生 / 一時停止 (${keyHint.play})`}
        >
          {playing ? '⏸' : '▶'}
        </button>
        <div className="tb-side tb-side-r">
        <button className="tbtn" onClick={() => onStep(1)} title={`1フレーム進む (${keyHint.fwd})`}>
          ǀ▷
        </button>
        <button className="tbtn" onClick={() => onSkip(5)} title="5秒進む">
          5»
        </button>
        <button className="tbtn" onClick={() => onSkip(10)} title="10秒進む">
          10»
        </button>
        <button
          className="tbtn tbtn-shot"
          onClick={onScreenshot}
          title="今のプレビュー画面を画像で保存"
        >
          📷
        </button>
        <button className="tbtn" onClick={() => onJumpMarker(-1)} title="前のマーカーへ">
          ⟨🚩
        </button>
        <button
          className="tbtn tbtn-marker"
          onClick={onAddMarker}
          title={`再生ヘッド位置にマーカーを追加 (${keyHint.marker})`}
        >
          🚩＋
        </button>
        <button className="tbtn" onClick={() => onJumpMarker(1)} title="次のマーカーへ">
          🚩⟩
        </button>
        </div>
      </div>
    </div>
  )
}
