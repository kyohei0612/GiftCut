// 再生の「今」を、どの区画からでも触れるようにする。
//
// 置き場所の考え方は state/layoutContext.tsx と同じ。
//
// ## **中身はここで作る**（2026-08-08 に App から移した）
//
// 前は「入口（App）で作って渡す」と書いてあり、そうしていた。**それが
// アプリ全体を毎秒60回作り直していた。**
//
// `currentTime` は再生中 60回/秒 変わる。持ち主が App だったので、
// **変わるたびに App 自身が作り直され**、下にある物が全部巻き添えになる
//（タイムラインの帯には `memo` が無い）。**切れば切るほど1回が重くなるので、
// 編集を続けるほど悪化する。**
//
// 実測（本人のプレテスト）。作り直しが増えるほど、絵の遅れがそのまま増えた:
//
//   作り直し 18回/秒 → 遅れ   0ms
//   　　　　 61回/秒 → 遅れ  56ms
//   　　　　 79回/秒 → 遅れ 339ms
//
// **囲いの中で作れば、作り直されるのは囲いだけ。** 子は同じ物が渡るので
// React が飛ばす（見に行っている所だけが作り直される）。
// このリポジトリの他の囲い（`ContentProvider` `IconsProvider` `ExportProvider` …）は
// 元からこの形で、**`playback` が数少ない例外だった。**
//
// ※ 「囲いの中で作ると描き直しのたびに作り直される」と書いてあったが、
//   **囲いは自分の state が変わった時しか描き直さない**ので、持っていた値は消えない。
//   `value` を渡す形の方が、渡す側（App）を巻き込むぶん危ない。
//
// ## `currentTime` が要らない所は `currentTimeRef` を見ること
//
// **context は「どの項目を読んだか」では分けられない。** 分割代入から外しても、
// 同じ囲いを見に行っていれば作り直される（2026-08-08 にそれで一度失敗した）。
// 毎コマの値が要らないなら、**囲いではなく ref を見る**。

// ## 毎コマの値が要らない所は、**`usePlaybackStableCtx` を見る**（2026-10-12）
//
// 「ref を見ろ」と書いてあっても、`currentTimeRef` を取り出すのに **同じ囲いを
// 見に行っていた**（28本）。それでは毎コマ作り直る。本人のサブPCの記録で、
// 再生中に右パネル（素材ビンの一覧）まで毎コマ作り直り、一覧が毎コマ画面全体の
// レイアウトを強制して 1コマ 100ms 超＝音がカクつく、が出た。
// `currentTime` だけを外した囲いを**もう1つ**用意して、そちらを見させる。
// 中身（ref・setter・fps・再生中か）は変わったときしか新しい物にならないので、
// 見に行っている側は再生中に作り直されない。

import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { FPS } from '../lib/appConst'
import { usePlayback, type Playback } from './usePlayback'

const Ctx = createContext<Playback | null>(null)
/** `currentTime`（毎コマ変わる）を**除いた**再生の持ち物 */
export type PlaybackStable = Omit<Playback, 'currentTime'>
const StableCtx = createContext<PlaybackStable | null>(null)

export function PlaybackProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const v = usePlayback(FPS)
  // 毎コマ変わる currentTime を抜いた物。残りは ref・setter・たまに変わる値だけなので、
  // どれかが変わったときにだけ新しい物にする（＝見ている側は再生中に作り直されない）
  const stable = useMemo<PlaybackStable>(
    () => {
      const { currentTime: _ct, ...rest } = v
      void _ct
      return rest
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      v.setCurrentTime, v.currentTimeRef, v.durationRef, v.playing, v.setPlaying, v.playRateUI,
      v.setPlayRateUI, v.playRateRef, v.rafRef, v.fps, v.setFps, v.fpsRef, v.clockStartWallRef,
      v.clockStartPosRef, v.lastTsRef, v.seekCooldownRef, v.xfadeUntilRef, v.fixingDriftRef,
      v.preparedRef, v.currentSegRef
    ]
  )
  return (
    <StableCtx.Provider value={stable}>
      <Ctx.Provider value={v}>{children}</Ctx.Provider>
    </StableCtx.Provider>
  )
}

/** 再生の持ち物のうち、毎コマ変わらない物だけを見に行く（再生中に作り直されない） */
export function usePlaybackStableCtx(): PlaybackStable {
  const v = useContext(StableCtx)
  if (!v) throw new Error('usePlaybackStableCtx は PlaybackProvider の中でしか使えません')
  return v
}

/** 再生の「今」を見に行く。囲いの外で呼んだら、その場で落とす */
export function usePlaybackCtx(): Playback {
  const v = useContext(Ctx)
  if (!v) throw new Error('usePlaybackCtx は PlaybackProvider の中でしか使えません')
  return v
}
