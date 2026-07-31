// 右下に出て自動で消えるお知らせ。
//
// ## 積み上げない
//
// 以前は4秒×無制限だったので、続けて操作すると3つ4つと積み上がって
// タイムラインの右側が隠れ、**肝心の失敗の知らせも埋もれていた**。
// 出しっぱなしにせず、最新の2つだけ残す。

import { useRef, useState } from 'react'

export interface Toast {
  id: number
  msg: string
  type: 'success' | 'error' | 'info'
}

/** 同時に出す上限 */
const TOAST_MAX = 2

export interface Toaster {
  toasts: Toast[]
  setToasts: React.Dispatch<React.SetStateAction<Toast[]>>
  showToast: (msg: string, type?: Toast['type']) => void
}

export function useToast(): Toaster {
  const [toasts, setToasts] = useState<Toast[]>([])
  const idRef = useRef(1)
  const showToast: Toaster['showToast'] = (msg, type = 'info') => {
    const id = idRef.current++
    setToasts((t) => [...t, { id, msg, type }].slice(-TOAST_MAX))
    // 失敗は読む時間が要るので少し長く出す
    window.setTimeout(
      () => setToasts((t) => t.filter((x) => x.id !== id)),
      type === 'error' ? 5000 : 3000
    )
  }
  return { toasts, setToasts, showToast }
}
