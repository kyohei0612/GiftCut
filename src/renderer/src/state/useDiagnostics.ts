// 動きの計測と、不具合の記録。**作っている物ではなく、作っている最中を見るための仕掛け。**
//
// ## 数字だけでは原因に辿り着けない
//
// 「何ms かかった」だけ分かっても、どの操作のときに詰まったのかが分からない。
// いま何をしているか（掴んでいる・再生している・書き出している）を計測へ流し込む。
//
// ## 掴んでいる最中は、掴んだ物の形が答えになる
//
// 何を掴んだかを別に覚えておく必要はない。押した先の見た目で分かる。
//
// ## 裏に回っている間は時計を進めない
//
// 画面が見えていない間もブラウザは時間を進めるが、絵は描かれない。
// 戻ってきたときに「裏で勝手に再生が進んでいた」ことにしないよう、
// 見えた時点から測り直す。
//
// ## 出た不具合は画面にも記録にも残す
//
// その場で知らせるだけだと、後から「何時何分に何が出たか」を辿れない。
//
// ## 配布した物でも開ける
//
// 使っている人の所でしか出ない症状があるので、Ctrl+Shift+P で小窓を出せるようにしてある。
// 書き出す間隔は5分（毎回書くとディスクを触りすぎる）。

import { useEffect } from 'react'
import { tToSource } from '../../../shared/timeline'
import { perf } from '../lib/perfMonitor'
import { useDoc } from './contentContext'
import { useDragPreviewCtx } from './dragPreviewContext'
import { usePlaybackCtx } from './playbackContext'
import { useToastCtx } from './toastContext'
import type { Marquee } from './useDragPreview'
import type { SegLayout } from '../lib/projectTypes'
import type { PreviewRes } from '../components/panels/PreviewBars'
import { useAppChromeCtx } from './appChromeContext'
import { useProxyCtx } from './proxyContext'
import { useSegLayoutCtx } from './segLayoutContext'
import { useTracksCtx } from './tracksContext'
import { useVideoElsCtx } from './videoElsContext'

export interface UseDiagnosticsDeps {
  /** 計測の小窓を開いているか */
  setPerfOpen: React.Dispatch<React.SetStateAction<boolean>>
  /** 掴んでいる最中に出す物（何を掴んでいるかの手掛かりになる） */
  dragTip: { x: number; y: number; text: string } | null
  marquee: Marquee | null
  segLayoutRef: React.MutableRefObject<SegLayout[]>
  previewResRef: React.MutableRefObject<PreviewRes>
  videoRef: React.MutableRefObject<HTMLVideoElement | null>
}

export function useDiagnostics(): void {
  // **要る物は心臓から自分で取る**（2026-08-04。配線はただの素通しだった）
  const { setPerfOpen, appVersion } = useAppChromeCtx()
  const { segLayoutRef } = useSegLayoutCtx()
  const { previewResRef } = useProxyCtx()
  const { videoRef } = useVideoElsCtx()
  const { cuesRef, segsRef, seClipsRef, imgClipsRef, vClipsRef } = useDoc()
  const { tracksRef } = useTracksCtx()
  const { setSnapLineX } = useDragPreviewCtx()
  const {
    playRateRef, currentTimeRef, 
    // 裏から戻ったら測り直すための起点（心臓が持っている）
    clockStartPosRef, clockStartWallRef, lastTsRef
  } = usePlaybackCtx()
  const { showToast } = useToastCtx()

  // 計測に「いま何をしているか」を教える。数字だけ見ても、
  // どの操作のときに詰まったのかが分からないと原因に辿り着けない。
  useEffect(() => {
    perf.noteOf = (): string =>
      [
        playRateRef.current !== 0 ? '再生中' : '停止',
        // **設定の数字だけでは足りない。** 焼き直しがまだなら原本を再生しており、
        // 原本はシークが重いのでカクつく。実際に何を再生しているかを必ず出す
        // （「画質1080 なのにカクつく」の正体がこれだった）
        `画質${previewResRef.current}${
          (videoRef.current?.currentSrc ?? '').includes('giftcut-proxies') ? '(焼直)' : '(原本)'
        }`,
        `切片${segsRef.current.length}`,
        `テロップ${cuesRef.current.length}`
      ].join(' / ')
    perf.videoOf = (): HTMLVideoElement | null => videoRef.current
    // **版と素材の規模を報告の頭に出す。**
    //
    // 自動更新は黙って入れ替わるので、「直したはずが直っていない」の大半は
    // 新旧の取り違えだった。数字より先に、まずここを見る。
    // 素材の規模も要る——同じ操作でも、素材が10倍あれば重さは別物になる。
    perf.envOf = (): string[] => [
      `版: ${appVersion || '不明'}`,
      `画面: ${window.innerWidth}x${window.innerHeight} / 倍率 ${window.devicePixelRatio}`,
      `素材: 切片${segsRef.current.length} / テロップ${cuesRef.current.length} / ` +
        `効果音${seClipsRef.current.length} / 画像${imgClipsRef.current.length} / ` +
        `映像レイヤー${vClipsRef.current.length} / 段${tracksRef.current.length}`
    ]
  })

  /**
   * 掴んでいる間、カーソルを**掴んだ瞬間の形のまま**にする。
   *
   * ドラッグ中はマウスが色々な物の上を通る。素のままだと通った先の形に
   * 次々と変わり、**掴んでいるのに形だけ別物**という状態でちらつく。
   *
   * 掴む所は10か所以上あるので、1つずつ直すと必ず漏れる。押した瞬間に
   * 「その要素の形」を読み取って全体に固定し、離したら外す——ここ1か所で済ませる。
   * 何を掴んだかを覚える必要も無い（掴んだ物の形がそのまま答えになっている）。
   */
  useEffect(() => {
    let locked = false
    const root = document.documentElement
    const onDown = (e: PointerEvent): void => {
      if (e.button !== 0) return
      const el = e.target as HTMLElement | null
      if (!el) return
      const cur = getComputedStyle(el).cursor
      if (!cur || cur === 'auto') return
      root.style.setProperty('--drag-cursor', cur)
      root.classList.add('dragging-cursor')
      locked = true
    }
    const onUp = (): void => {
      // 磁石の点線は「掴んでいる間だけ」。離したら必ず消す
      // （消し忘れると、置いたあとも線が残って何の線か分からなくなる）
      setSnapLineX(null)
      if (!locked) return
      locked = false
      root.classList.remove('dragging-cursor')
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('pointerup', onUp, true)
    window.addEventListener('pointercancel', onUp, true)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('pointerup', onUp, true)
      window.removeEventListener('pointercancel', onUp, true)
      root.classList.remove('dragging-cursor')
    }
  }, [])

  /**
   * 別のアプリへ行って戻ってきたときの手当て。
   *
   * 裏に回ると Chromium は rAF を止める。一方こちらの再生位置は**壁時計**で
   * 出しているので、戻った瞬間に「止まっていた秒数ぶん」を一気に進めようとして、
   * 巨大なシークが走る。実測で **戻った直後の1コマに 1820ms** かかっていた
   * （36.9秒 裏へ → 38.7秒 戻る、で最悪コマがそこに立っていた）。
   *
   * 戻ったら壁時計を**いまの位置に貼り直す**。止まっていた間は進めない
   * ＝裏で勝手に再生が進んでいた事にしない、が正しい振る舞いでもある。
   */
  useEffect(() => {
    const onVis = (): void => {
      if (document.hidden) return
      if (playRateRef.current === 0) return
      clockStartPosRef.current = currentTimeRef.current
      clockStartWallRef.current = performance.now() / 1000
      lastTsRef.current = performance.now()
      // 動画側も現在位置へ合わせ直す（放っておくと次のコマで大きなシークが走る）
      const src = tToSource(segLayoutRef.current, currentTimeRef.current)
      const v = videoRef.current
      if (v && src && Math.abs(v.currentTime - src.srcTime) > 0.25) v.currentTime = src.srcTime
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  /**
   * 画面で起きた例外を**必ず表に出す**。
   *
   * React は描画の途中で例外が出ると、その枝ごと黙って消す。すると
   * 「V1 が効かない」「ショートカットが効かない」のように、**別々の不具合に見えて
   * 実は1つの例外**という形になり、探しても見つからない。
   *
   * 出たら画面に出し、動きの記録にも残す（あとから何時何分に何が出たか辿れる）。
   */
  useEffect(() => {
    const onErr = (e: ErrorEvent): void => {
      const msg = `${e.message}（${(e.filename ?? '').split('/').pop()}:${e.lineno}）`
      perf.mark(`画面の例外: ${msg}`)
      showToast(`不具合が起きました: ${msg}`, 'error')
    }
    const onRej = (e: PromiseRejectionEvent): void => {
      const msg = String(e.reason).slice(0, 200)
      perf.mark(`受け止め損ねた失敗: ${msg}`)
      showToast(`不具合が起きました: ${msg}`, 'error')
    }
    window.addEventListener('error', onErr)
    window.addEventListener('unhandledrejection', onRej)
    return () => {
      window.removeEventListener('error', onErr)
      window.removeEventListener('unhandledrejection', onRej)
    }
  }, [])

  // Ctrl+Shift+P で計測の小窓。**配布ビルドでも開ける**
  useEffect(() => {
    const h = (e: KeyboardEvent): void => {
      if (e.ctrlKey && e.shiftKey && (e.key === 'P' || e.key === 'p')) {
        e.preventDefault()
        // 小窓は「見せる／隠す」だけ。**閉じても測り続ける**（配布ビルドも同じ）。
        // 止めてしまうと、不具合に気づいて書き出した時に肝心の前後が残らない。
        setPerfOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  /**
   * 開発中は、起動した瞬間から**ずっと測り続ける**。
   *
   * カクついた瞬間に「いま測り始めます」では遅い。**気づいたときには終わっている**
   * ので、あとから「さっきの所」を見られないと原因に辿り着けない。
   * 走らせっぱなしにして、一定間隔で userData/perf へ書く。
   * 「止めて」と言われたら、そこまでに書かれた物を読めばよい。
   *
   * **配布ビルドでも走らせる。**
   * 不具合に気づくのは使っている人で、その場で測り始めてもらうのは無理がある。
   * 「おかしいな」と思った時に書き出しボタンを押せば、その前の分がそのまま残っている、
   * という形にする。書き出す間隔は5分（毎回書くとディスクを触りすぎる）。
   */
  useEffect(() => {
    perf.start()
    const id = window.setInterval(
      () => {
        void window.giftcut?.savePerfReport?.(perf.report())
      },
      import.meta.env.DEV ? 30_000 : 300_000
    )
    return () => {
      window.clearInterval(id)
      perf.stop()
    }
  }, [])
}
