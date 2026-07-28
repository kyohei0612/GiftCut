// 画面の上に重ねて出す小物 3種。
//
//   Toasts       … 右下のお知らせ
//   PromptModal  … 文字を1つ聞く（ブラウザの prompt の置き換え）
//   ConfirmModal … はい／いいえを聞く（OS のダイアログの置き換え）
//
// OS のダイアログを使わないのは、見た目も文言の作法もアプリと揃わず
// 「Windows のダイアログが出てきた」という見え方になるため。
//
// どれも「渡された物を出すだけ」で、自分では何も決めない。
// 状態は App が持ち、ここは形だけを受け持つ。

export interface Toast {
  id: number
  msg: string
  type: 'success' | 'error' | 'info'
}

export function Toasts({ items }: { items: Toast[] }): React.JSX.Element {
  return (
    <div className="toast-wrap">
      {items.map((t) => (
        <div key={t.id} className={`toast toast-${t.type}`}>
          <span className="toast-ico">
            {t.type === 'success' ? '✓' : t.type === 'error' ? '!' : 'i'}
          </span>
          <span className="toast-msg">{t.msg}</span>
        </div>
      ))}
    </div>
  )
}

export interface PromptState {
  title: string
  value: string
  onOk: (v: string) => void
}

export function PromptModal({
  state,
  onChange,
  onClose
}: {
  state: PromptState
  onChange: (v: string) => void
  onClose: () => void
}): React.JSX.Element {
  const ok = (): void => {
    state.onOk(state.value)
    onClose()
  }
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">{state.title}</div>
        <input
          className="modal-input"
          autoFocus
          value={state.value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') ok()
            else if (e.key === 'Escape') onClose()
          }}
        />
        <div className="modal-actions">
          <button className="modal-btn ghost" onClick={onClose}>
            キャンセル
          </button>
          <button className="modal-btn primary" onClick={ok}>
            OK
          </button>
        </div>
      </div>
    </div>
  )
}

export interface ConfirmState {
  title: string
  body: string
  okLabel: string
  cancelLabel: string
  danger: boolean
  resolve: (ok: boolean) => void
}

export function ConfirmModal({
  state,
  onClose
}: {
  state: ConfirmState
  onClose: (ok: boolean) => void
}): React.JSX.Element {
  return (
    <div className="modal-overlay" onClick={() => onClose(false)}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">{state.title}</div>
        <div className="modal-body">{state.body}</div>
        <div className="modal-actions">
          <button className="modal-btn ghost" onClick={() => onClose(false)}>
            {state.cancelLabel}
          </button>
          <button
            className={`modal-btn ${state.danger ? 'danger' : 'primary'}`}
            autoFocus
            onClick={() => onClose(true)}
            // Enter=実行 / Escape=中止。ボタンにフォーカスがあるので
            // キーだけで閉じられる（OS ダイアログと同じ操作感）。
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation() // 裏のタイムラインの Esc 処理まで走らせない
                onClose(false)
              }
            }}
          >
            {state.okLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
