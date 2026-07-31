// 再生の「今」を持つ。
//
// ## ここに置くのは持ち物だけ
//
// **追いかけの仕組み（毎フレームの輪・頭出し・2枚組の切り替え）は動かしていない。**
// あそこは絵の止まりと音の途切れを何度も測って詰めた所で、少し触るだけで
// カクつきや「プツッ」が戻る。持ち場を移すのと作りを変えるのは別の話なので、
// ここでは**入れ物だけ**を外に出す。
//
// ## state と ref を組で持つ理由
//
// 時刻は「描くとき」と「毎フレーム進めるとき」の両方から読む。
// 毎フレーム側は描き直しを待てないので ref から読む。
// 別々の場所に置くと**片方だけ古いまま**になり、絵と音がずれる。

import { useRef, useState } from 'react'

export interface Playback {
  /** いまの再生位置（秒）。描くために使う */
  currentTime: number
  setCurrentTime: React.Dispatch<React.SetStateAction<number>>
  /** いまの再生位置（秒）。毎フレーム進めるために使う（描き直しを待たない） */
  currentTimeRef: React.MutableRefObject<number>
  /** 全体の長さ（秒）。毎フレーム側から読む用 */
  durationRef: React.MutableRefObject<number>
  /** 流しているか */
  playing: boolean
  setPlaying: React.Dispatch<React.SetStateAction<boolean>>
  /** 画面に出す再生速度（0=停止） */
  playRateUI: number
  setPlayRateUI: React.Dispatch<React.SetStateAction<number>>
  /** 実際の速さ。0=停止 / 正=順送り / 負=逆送り */
  playRateRef: React.MutableRefObject<number>
  /** 追いかけの輪の番号（止めるときに使う） */
  rafRef: React.MutableRefObject<number | null>
  /** 素材の実フレームレート（未取得なら既定） */
  fps: number
  setFps: React.Dispatch<React.SetStateAction<number>>
  fpsRef: React.MutableRefObject<number>
}

export function usePlayback(defaultFps: number): Playback {
  const [currentTime, setCurrentTime] = useState(0)
  const currentTimeRef = useRef(0)
  const durationRef = useRef(60)
  const [playing, setPlaying] = useState(false)
  const [playRateUI, setPlayRateUI] = useState(0)
  const playRateRef = useRef(0)
  const rafRef = useRef<number | null>(null)
  const [fps, setFps] = useState(defaultFps)
  const fpsRef = useRef(defaultFps)

  return {
    currentTime,
    setCurrentTime,
    currentTimeRef,
    durationRef,
    playing,
    setPlaying,
    playRateUI,
    setPlayRateUI,
    playRateRef,
    rafRef,
    fps,
    setFps,
    fpsRef
  }
}
