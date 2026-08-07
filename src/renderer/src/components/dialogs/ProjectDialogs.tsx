// プロジェクトの出入りに関わるダイアログ 4種。
//
//   ExportSettingsDialog … 書き出しの設定（解像度・fps・画質）
//   ExportProgressBox    … 書き出し中の進み具合とキャンセル
//   RestorePrompt        … 前回の作業が残っているときの復帰
//   TemplatePicker       … テンプレートを選ぶ
//
// どれも状態は App が持ち、ここは形だけを受け持つ。
// （例外は「消す？」の2段階だけ。押し間違い防止の一時的な状態で、外に出す意味が無い）

import { useState } from 'react'
import { useEscClose } from '../../lib/useEscClose'

/**
 * 長い道は**尻を残して、頭を … にする**。
 *
 * 素直に `text-overflow: ellipsis` に任せると頭から出て尻が切れるが、
 * 道で知りたいのは**どのフォルダに入るか**（尻）で、頭は
 * `C:\Users\...` のようにどれも同じ。切る側を逆にする。
 * 全部は `title` で出るので、消えるわけではない。
 */
function tailEllipsis(s: string, max = 42): string {
  return s.length <= max ? s : '…' + s.slice(-(max - 1))
}

export interface ExportOpts {
  resP: 2160 | 1080 | 720 | 480
  fps: 'source' | 24 | 30 | 60
  quality: 'high' | 'med' | 'low'
}

/**
 * 書き出しの窓。**決めるのは「どこへ・どの名前で」だけ。**
 *
 * 絵の設定（解像度・fps・画質）は素材から自動で決める。理由:
 *
 * - 書き出しは「取り込んだ物と同じ物が出る」が当たり前で、そこを毎回選ばせるのは
 *   **選び間違える機会を毎回作っている**のと同じ。4K を読み込んだのに既定の
 *   1080p のまま出して、**出来上がってから気づく**（やり直しに何分もかかる）
 * - 画質を落として得なのはファイルの大きさだけで、**速さはほとんど変わらない**
 *   （実測: 焼く物を GPU→CPU に変えても 1080p60秒で 1〜2秒。遅さの原因は別）
 *
 * 素材から決めた中身は、いじれなくても**見えてはいる**ようにする
 * （何が出るか分からないまま押させない）。
 */
export function ExportSettingsDialog({
  /** 素材から決まった中身（表示だけ。いじらせない） */
  opts,
  /** 「素材と同じ」で実際に使われる fps（表示用） */
  sourceFpsLabel,
  dir,
  name,
  ext,
  onName,
  onExt,
  onPickDir,
  onExport,
  onClose
}: {
  opts: ExportOpts
  sourceFpsLabel: string
  dir: string
  name: string
  ext: 'mp4' | 'mov' | 'mp3'
  onName: (v: string) => void
  onExt: (v: 'mp4' | 'mov' | 'mp3') => void
  onPickDir: () => void
  onExport: () => void
  onClose: () => void
}): React.JSX.Element {
  const resLabel =
    opts.resP === 2160 ? '4K（2160p）' : opts.resP === 720 ? 'HD（720p）' : opts.resP === 480 ? 'SD（480p）' : 'フルHD（1080p）'
  // 名前が空でも押させない（名前の無いファイルは作れない）
  const ready = !!dir && !!name.trim()
  // Escape でも閉じる（覆いの作法。理由は lib/useEscClose）
  useEscClose(onClose)
  return (
    <div className="export-overlay" onPointerDown={onClose}>
      <div className="restore-box" onPointerDown={(e) => e.stopPropagation()}>
        <div className="restore-title">書き出し</div>
        <div className="sp-row">
          <span className="sp-label">タイトル</span>
          <input
            className="pq-select"
            style={{ flex: 1, minWidth: 0 }}
            value={name}
            placeholder="ファイル名"
            onChange={(e) => onName(e.target.value)}
          />
          <select
            className="pq-select"
            style={{ width: 84 }}
            value={ext}
            onChange={(e) => onExt(e.target.value as 'mp4' | 'mov' | 'mp3')}
          >
            <option value="mp4">.mp4</option>
            <option value="mov">.mov</option>
            <option value="mp3">.mp3（音だけ）</option>
          </select>
        </div>
        <div className="sp-row">
          <span className="sp-label">書き出し先</span>
          <span
            className="pq-select"
            style={{ flex: 1, minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap' }}
            title={dir || undefined}
          >
            {dir ? tailEllipsis(dir) : '（未選択）'}
          </span>
          <button className="btn small" onClick={onPickDir}>
            参照…
          </button>
        </div>
        {/* **押せない理由は、押せない物のそばに書く。**
            ボタンだけ灰色にして理由が無いと、壊れているのか自分のせいなのか分からない */}
        {!dir && (
          <div className="restore-warn">※ 保存先を選んでください（「参照…」から）。</div>
        )}
        <div className="tpl-hint" style={{ marginTop: 4 }}>
          {ext === 'mp3'
            ? '音だけを書き出します: MP3・192kbps・48kHz（映像とテロップは焼きません）'
            : `素材と同じ設定で書き出します: ${resLabel} / ${sourceFpsLabel}fps / H.264・AAC`}
        </div>
        <div className="restore-btns">
          <button className="btn small" onClick={onClose}>
            キャンセル
          </button>
          <button className="btn small primary" disabled={!ready} onClick={onExport}>
            この設定で書き出す
          </button>
        </div>
      </div>
    </div>
  )
}

export function ExportProgressBox({
  status,
  percent,
  onCancel
}: {
  status: string
  percent: number | null
  onCancel: () => void
}): React.JSX.Element {
  return (
    <div className="export-overlay">
      <div className="export-box">
        <div className="export-spinner" />
        <div className="export-msg">
          {status}
          {percent != null && <span className="export-pct">　{percent}%</span>}
        </div>
        {percent != null && (
          <div className="export-bar">
            <div className="export-bar-fill" style={{ width: `${percent}%` }} />
          </div>
        )}
        <button className="export-cancel" onClick={onCancel}>
          キャンセル
        </button>
      </div>
    </div>
  )
}

export interface RestoreState {
  data: unknown
  videoExists: boolean
  savedAt?: string
  /** 最新の下書きが読めず、1つ前だけが読めた */
  onlyPrev?: boolean
  prev?: { data: unknown; videoExists: boolean; savedAt?: string }
}

export function RestorePrompt({
  state,
  onDiscard,
  onRestore
}: {
  state: RestoreState
  onDiscard: () => void
  onRestore: (data: unknown, videoExists: boolean) => void
}): React.JSX.Element {
  return (
    <div className="export-overlay">
      <div className="restore-box">
        <div className="restore-title">前回の作業が残っています</div>
        <div className="restore-msg">
          {state.onlyPrev
            ? '最後の自動保存が読めませんでした。その1つ前なら残っています。'
            : '自動保存された編集内容が見つかりました。復元しますか？'}
          {state.savedAt && <div className="restore-when">最後に自動保存: {state.savedAt}</div>}
          {!state.videoExists && (
            <div className="restore-warn">
              ※ 元の動画ファイルが見つからないため、テロップ/カット情報のみ復元されます。
            </div>
          )}
        </div>
        <div className="restore-btns">
          <button className="btn" onClick={onDiscard}>
            破棄して新規
          </button>
          {/* 落ちる原因になった操作ごと戻ってきてしまうと逃げ場が無い。
              1世代前も選べるようにしておく。 */}
          {state.prev && (
            <button
              className="btn"
              title={state.prev.savedAt ? `${state.prev.savedAt} の内容に戻します` : undefined}
              onClick={() => onRestore(state.prev!.data, state.prev!.videoExists)}
            >
              1つ前の状態で復元
            </button>
          )}
          <button
            className="btn btn-primary"
            onClick={() => onRestore(state.data, state.videoExists)}
          >
            復元する
          </button>
        </div>
      </div>
    </div>
  )
}

export function TemplatePicker({
  items,
  startup,
  onPick,
  onDelete,
  onOpenFolder,
  onClose
}: {
  items: { name: string; path: string }[]
  /** 起動時に出したものか（文言が変わる） */
  startup?: boolean
  onPick: (path: string) => void
  /** 消す（渡さなければ消すボタンを出さない。同梱の物しか無い場面など） */
  onDelete?: (t: { name: string; path: string }) => void
  /** テンプレートの置き場を開く */
  onOpenFolder?: () => void
  onClose: () => void
}): React.JSX.Element {
  // どれを「消す？」の状態にしているか。**押し間違いで消えないように2段階にする**
  const [confirming, setConfirming] = useState<string | null>(null)
  // Escape でも閉じる。**「空で始める」と同じ意味**にしておく
  //（起動直後の一枚目なので、閉じられないと何も触れない）
  useEscClose(onClose)
  return (
    <div className="export-overlay">
      <div className="restore-box">
        <div className="restore-title">
          {startup ? 'テンプレートから始める' : 'テンプレートを開く'}
        </div>
        <div className="restore-msg">
          {startup
            ? '保存済みのテンプレートを選ぶか、空で開始できます。'
            : 'テンプレートフォルダ内のテンプレートを選んで開きます（新規プロジェクト扱い）。'}
        </div>
        <div className="tpl-picker-list">
          {items.map((t) => (
            <div key={t.path} className="tpl-picker-row">
              <button className="tpl-picker-item" onClick={() => onPick(t.path)}>
                📄 {t.name}
              </button>
              {onDelete && (
                // **一発では消さない。** 押し間違いで消えると、作り直すしかない。
                // 1回目で「消す？」に変わり、2回目で消える（外を押せば戻る）。
                <button
                  className={`tpl-picker-del ${confirming === t.path ? 'on' : ''}`}
                  title={confirming === t.path ? 'もう一度押すと消えます' : 'このテンプレートを消す'}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (confirming === t.path) {
                      setConfirming(null)
                      onDelete(t)
                    } else setConfirming(t.path)
                  }}
                >
                  {confirming === t.path ? '消す？' : '✕'}
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="restore-btns">
          {/* **置き場へ辿れる道をここにも置く。**
              一覧に無い物を足したい・中身を見たいと思ったときに、
              メニューまで戻らせると、そこで手が止まる */}
          {onOpenFolder && (
            <button className="btn" onClick={onOpenFolder} title="テンプレートの置き場を開く">
              📂 フォルダを開く
            </button>
          )}
          <button className="btn" onClick={onClose}>
            {startup ? '空で始める' : '閉じる'}
          </button>
        </div>
      </div>
    </div>
  )
}
