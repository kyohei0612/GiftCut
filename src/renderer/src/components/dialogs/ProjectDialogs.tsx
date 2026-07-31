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

export interface ExportOpts {
  resP: 2160 | 1080 | 720 | 480
  fps: 'source' | 24 | 30 | 60
  quality: 'high' | 'med' | 'low'
}

export function ExportSettingsDialog({
  opts,
  onChange,
  /** 「素材と同じ」を選んだときに実際に使われる fps（表示用） */
  sourceFpsLabel,
  onExport,
  onClose
}: {
  opts: ExportOpts
  onChange: (patch: Partial<ExportOpts>) => void
  sourceFpsLabel: string
  onExport: () => void
  onClose: () => void
}): React.JSX.Element {
  return (
    <div className="export-overlay" onPointerDown={onClose}>
      <div className="restore-box" onPointerDown={(e) => e.stopPropagation()}>
        <div className="restore-title">書き出し設定</div>
        <div className="sp-row">
          <span className="sp-label">📤 書き出す解像度</span>
          <select
            className="pq-select pq-export"
            value={opts.resP}
            onChange={(e) => onChange({ resP: Number(e.target.value) as ExportOpts['resP'] })}
          >
            <option value={2160}>4K（2160p）</option>
            <option value={1080}>フルHD（1080p）</option>
            <option value={720}>HD（720p）</option>
            <option value={480}>SD（480p）</option>
          </select>
        </div>
        <div className="sp-row">
          <span className="sp-label">フレームレート</span>
          <select
            className="pq-select"
            value={String(opts.fps)}
            onChange={(e) => {
              const v = e.target.value
              onChange({ fps: v === 'source' ? 'source' : (Number(v) as 24 | 30 | 60) })
            }}
            title="「素材と同じ」なら素材のフレームレートをそのまま保つ（60fps素材が30fpsに落ちない）"
          >
            <option value="source">素材と同じ（{sourceFpsLabel}fps）</option>
            <option value="24">24fps</option>
            <option value="30">30fps</option>
            <option value="60">60fps</option>
          </select>
        </div>
        <div className="sp-row">
          <span className="sp-label">画質</span>
          <select
            className="pq-select"
            value={opts.quality}
            onChange={(e) => onChange({ quality: e.target.value as ExportOpts['quality'] })}
          >
            <option value="high">高画質（ファイル大）</option>
            <option value="med">標準</option>
            <option value="low">軽量（ファイル小）</option>
          </select>
        </div>
        <div className="tpl-hint" style={{ marginTop: 4 }}>
          形式は保存ダイアログの拡張子（.mp4 / .mov）で選べます。H.264 / AAC。
        </div>
        <div className="restore-btns">
          <button className="btn small" onClick={onClose}>
            キャンセル
          </button>
          <button className="btn small primary" onClick={onExport}>
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
