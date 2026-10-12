// 段見出しの**境目を掴んで**高さを変える（プレミアと同じ操作）。
//
// ## なぜ「段の面倒」から出したか
//
// 元は `state/useTracksAdmin` に居たが、あちらの頭のコメントは
// 足す位置・対で確保・消せない理由・鍵の判定の4つを説明していて、
// **高さの話が1行も無かった**。使う名前も他と重ならず、
// `trackHOf` / `videoTrackHRef` / `audioTrackHRef` / `setVideoTrackH` /
// `setAudioTrackH` / `setLaneH` の6個は**この関数専用**だった。
// 出したことで `UseTracksAdminDeps` が 11 → 5 に減っている
// ＝渡し物が減る方向の切り出し（2026-08-03。中身は変えていない）。
//
// なお `useLaneHeights` がこの6個のうち5個の持ち主だが、そちらへ合流はできない。
// `trackHOf` の持ち主 `useTrackGeom` が `useLaneHeights` の後ろに居るので輪になる。
// 両方の後ろに置く新しいファイルが正解。
//
// ## 掴むのは「その段の上端」。上へ引くと太る（2026-10-12・本人の指定）
//
// 前は段の**下端**を掴んで、下へ引くとその段が太った。本人の体感は逆で、
// 「大きくしたい段の上の線を掴む」。段は上から順に積んであるので、上の線を
// 上へ引いても線そのものは動かず、段は下へ伸びる——そのままだとカーソルが
// 線から離れていく。だから**線がカーソルの下に来るまで縦に送る**
// （`scrollRef`）。送る余地が無いときだけ、今までどおり下へ太る。

import { clamp } from '../../../shared/timeline'
import { TRACK_H_MAX, TRACK_H_MIN } from './useLaneHeights'

export interface UseLaneResizeDeps {
  /** その段のいまの高さ（px） */
  trackHOf: (idOrKind: string) => number
  videoTrackHRef: React.MutableRefObject<number>
  audioTrackHRef: React.MutableRefObject<number>
  setVideoTrackH: React.Dispatch<React.SetStateAction<number>>
  setAudioTrackH: React.Dispatch<React.SetStateAction<number>>
  setLaneH: React.Dispatch<React.SetStateAction<Record<string, number>>>
  /** 縦に送る入れ物（.track-scroll）。掴んだ線をカーソルに追従させるのに送る */
  scrollRef: React.RefObject<HTMLDivElement | null>
}

export function useLaneResize(deps: UseLaneResizeDeps) {
  const {
    trackHOf, videoTrackHRef, audioTrackHRef, setVideoTrackH, setAudioTrackH, setLaneH, scrollRef
  } = deps

  /**
   * 掴んだ線（段の上端）がカーソルの下に来るまで縦に送る。
   * 段の高さは React が描き直してから決まるので、次のコマで測って送る。
   * 送る余地が無ければブラウザが止める＝その分は段が下へ伸びるだけ。
   */
  const follow = (divider: HTMLElement, clientY: number): void => {
    requestAnimationFrame(() => {
      const sc = scrollRef.current
      if (!sc || !divider.isConnected) return
      const diff = divider.getBoundingClientRect().top - clientY
      if (Math.abs(diff) >= 1) sc.scrollTop += diff
    })
  }

  /**
   * 映像の境目なら映像レーン全体、音声なら音声レーン全体がまとめて変わる（Shift）。
   * 既定は掴んだ段だけ。どちらも**上へ引くと太る**。
   */
  function startGroupResize(kind: 'video' | 'audio', e: React.PointerEvent, trackId?: string): void {
    e.preventDefault()
    e.stopPropagation()
    const startY = e.clientY
    const divider = e.currentTarget as HTMLElement
    const prevCursor = document.body.style.cursor
    document.body.style.cursor = 'row-resize'
    const end = (onMove: (ev: PointerEvent) => void): (() => void) => {
      const up = (): void => {
        document.body.style.cursor = prevCursor
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', up)
        window.removeEventListener('pointercancel', up)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', up)
      window.addEventListener('pointercancel', up)
      return up
    }
    // **掴んだ段だけ動かす。**
    // まとめて変える作りだと、波形を1本だけ見たいときにも他の段まで太り、
    // 画面が足りなくなる。
    if (trackId) {
      const startOwn = trackHOf(trackId)
      end((ev) => {
        const h = clamp(startOwn - (ev.clientY - startY), TRACK_H_MIN, TRACK_H_MAX)
        setLaneH((p) => ({ ...p, [trackId]: h }))
        follow(divider, ev.clientY)
      })
      return
    }
    const startH = kind === 'video' ? videoTrackHRef.current : audioTrackHRef.current
    const setter = kind === 'video' ? setVideoTrackH : setAudioTrackH
    // **まとめて変えるなら、個別の指定は捨てる**（2026-08-06）。
    //
    // 段の高さは「種類ごとの既定」と「段ごとの指定」の2段構えで、
    // 指定がある段は既定を見ない。**だから Shift で「まとめて」変えても、
    // 指定を持っている段だけ動かない。**
    //
    // 実際に起きた形（本人の画面を測った）:
    //
    //   音声の既定 96.5 ／ 段ごと {A1:44, A2:26}
    //   → A1 44・A2 26・**A3 だけ 97**
    //
    // 「A3 からまた大きい」に見えるが、A3 が特別なのではなく
    // **A3 だけが既定を見ている**。どの段に指定が残っているかは画面から
    // 読めないので、原因に辿り着けない。
    // → まとめて変えると宣言したときは、その種類の指定を消して**本当に揃える**。
    setLaneH((p) => {
      const next: Record<string, number> = {}
      for (const [id, h] of Object.entries(p)) {
        // 種類は id の頭で決まる（V…=映像 / A…=音声）
        const isVideo = id.startsWith('V')
        if ((kind === 'video') !== isVideo) next[id] = h
      }
      return next
    })
    end((ev) => {
      setter(clamp(startH - (ev.clientY - startY), TRACK_H_MIN, TRACK_H_MAX))
      follow(divider, ev.clientY)
    })
  }

  return { startGroupResize }
}
