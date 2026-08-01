// 人に聞く（文字を入れてもらう・はい/いいえを選んでもらう）。
//
// ## OS のダイアログを使わない
//
// 見た目も文言の作法もアプリと揃わないうえ、`window.confirm` は**画面を丸ごと止める**。
// 再生も書き出しも巻き添えで止まるので、自前の覆いに置き換えてある。
//
// ## 開いたまま握りつぶさない
//
// 「はい/いいえ」は約束（Promise）で返す。閉じる経路を1つに絞って、
// **必ず答えを返してから**閉じる。返さずに閉じると、待っている側が永久に待つ。

import { useState } from 'react'
import type { ConfirmState, PromptState } from '../components/Overlays'

export interface Ask {
  promptState: PromptState | null
  setPromptState: React.Dispatch<React.SetStateAction<PromptState | null>>
  confirmState: ConfirmState | null
  /** 文字を入れてもらう（OS 標準 prompt の置き換え） */
  askText: (title: string, defaultValue: string, onOk: (v: string) => void) => void
  /** はい/いいえを選んでもらう。答えが返るまで待てる */
  askConfirm: (o: {
    title: string
    body: string
    okLabel?: string
    cancelLabel?: string
    danger?: boolean
  }) => Promise<boolean>
  /** 閉じる経路はここ1つだけ（答えを返してから閉じる） */
  closeConfirm: (ok: boolean) => void
}

export function useAsk(): Ask {
  const [promptState, setPromptState] = useState<PromptState | null>(null)
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null)

  function askText(title: string, defaultValue: string, onOk: (v: string) => void): void {
    setPromptState({ title, value: defaultValue, onOk })
  }
  function askConfirm(o: {
    title: string
    body: string
    okLabel?: string
    cancelLabel?: string
    danger?: boolean
  }): Promise<boolean> {
    return new Promise((resolve) =>
      setConfirmState({
        title: o.title,
        body: o.body,
        okLabel: o.okLabel ?? '続ける',
        cancelLabel: o.cancelLabel ?? 'キャンセル',
        danger: !!o.danger,
        resolve
      })
    )
  }
  function closeConfirm(ok: boolean): void {
    setConfirmState((s) => {
      s?.resolve(ok)
      return null
    })
  }

  return { promptState, setPromptState, confirmState, askText, askConfirm, closeConfirm }
}
