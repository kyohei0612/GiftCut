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

  // ---- 追いかけの時計まわり ----
  //
  // 再生ヘッドは**壁時計で一定速度に進み、映像がそれを追う**。
  // 映像を主にすると、重い所で再生ヘッドまで遅れて「音だけ先に行く」になる。
  /** 再生を始めた時の performance.now()/1000（秒） */
  clockStartWallRef: React.MutableRefObject<number>
  /** 再生を始めた時のタイムライン位置（秒） */
  clockStartPosRef: React.MutableRefObject<number>
  lastTsRef: React.MutableRefObject<number>
  /**
   * 次にシークを頼んでよい時刻（performance.now）。
   * **シークが重い相手を追いかけ続けないための間。** 直前のシークにかかった時間から決める。
   */
  seekCooldownRef: React.MutableRefObject<number>
  /** カットで音を重ねている間（この時刻まで）は、音量を書き換えない */
  xfadeUntilRef: React.MutableRefObject<number>
  /**
   * いまズレを詰めている最中か。
   *
   * **入り口と出口をずらす（履歴）。** 同じしきい値で出入りさせると、
   * 境目で速さが 1.00 と 1.02 の間を行ったり来たりする。速さを変えるたびに
   * 音は伸縮処理を通るので、**カットでもない普通の所で音が荒れる**。
   * 大きくズレた時だけ入り、ほぼ0まで詰めてから出る。
   */
  fixingDriftRef: React.MutableRefObject<boolean>
  /** 次のカットへ向けて温めてある面（用意できていれば入れ替えるだけで済む） */
  preparedRef: React.MutableRefObject<{ segIdx: number; srcId: number; half: 0 | 1 } | null>
  /** 再生中に追いかけている切片の番号 */
  currentSegRef: React.MutableRefObject<number>
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
  const clockStartWallRef = useRef(0)
  const clockStartPosRef = useRef(0)
  const lastTsRef = useRef(0)
  const seekCooldownRef = useRef(0)
  const xfadeUntilRef = useRef(0)
  const fixingDriftRef = useRef(false)
  const preparedRef = useRef<{ segIdx: number; srcId: number; half: 0 | 1 } | null>(null)
  const currentSegRef = useRef(0)

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
    fpsRef,
    clockStartWallRef,
    clockStartPosRef,
    lastTsRef,
    seekCooldownRef,
    xfadeUntilRef,
    fixingDriftRef,
    preparedRef,
    currentSegRef
  }
}
