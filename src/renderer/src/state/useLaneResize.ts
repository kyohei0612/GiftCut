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

import { TRACK_PAD_ROWS } from '../lib/appConst'
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
}

export function useLaneResize(deps: UseLaneResizeDeps) {
  const { trackHOf, videoTrackHRef, audioTrackHRef, setVideoTrackH, setAudioTrackH, setLaneH } =
    deps

  /**
   * 映像の境目なら映像レーン全体、音声なら音声レーン全体がまとめて変わる。
   *
   * @param above 掴んだ境目より上に、同じ種類の段がいくつあるか（1から数える）
   *
   * 掴んだ線をカーソルに追従させるには、**その線より上にある段の数**で割る。
   * 線の位置は「上にある段の高さの合計」で決まるので、1px 動かしたければ
   * 1段あたり 1/n px 変える必要がある。
   * 映像側は上の余白（TRACK_PAD_ROWS 段ぶん）も段の高さで伸び縮みするため、
   * その分も数に入れる。ここを間違えると、掴んだ場所から線がじわじわ離れていく。
   */
  function startGroupResize(
    kind: 'video' | 'audio',
    above: number,
    e: React.PointerEvent,
    trackId?: string
  ): void {
    e.preventDefault()
    e.stopPropagation()
    const startY = e.clientY
    // **掴んだ段だけ動かす。**
    // まとめて変える作りだと、波形を1本だけ見たいときにも他の段まで太り、
    // 画面が足りなくなる。掴んだ線の下にある段はそのまま押し下がる。
    if (trackId) {
      const startOwn = trackHOf(trackId)
      const prevCur = document.body.style.cursor
      document.body.style.cursor = 'row-resize'
      const mv = (ev: PointerEvent): void => {
        const h = clamp(startOwn + (ev.clientY - startY), TRACK_H_MIN, TRACK_H_MAX)
        setLaneH((p) => ({ ...p, [trackId]: h }))
      }
      const up = (): void => {
        document.body.style.cursor = prevCur
        window.removeEventListener('pointermove', mv)
        window.removeEventListener('pointerup', up)
        window.removeEventListener('pointercancel', up)
      }
      window.addEventListener('pointermove', mv)
      window.addEventListener('pointerup', up)
      window.addEventListener('pointercancel', up)
      return
    }
    const startH = kind === 'video' ? videoTrackHRef.current : audioTrackHRef.current
    const rows = Math.max(1, kind === 'video' ? above + TRACK_PAD_ROWS : above)
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
    // 掴んでいる間は、どこへ動かしても行を変える手のままにする
    // （途中で別のカーソルに化けると「外れた」ように見える）
    const prevCursor = document.body.style.cursor
    document.body.style.cursor = 'row-resize'
    const onMove = (ev: PointerEvent): void => {
      setter(clamp(startH + (ev.clientY - startY) / rows, TRACK_H_MIN, TRACK_H_MAX))
    }
    const onUp = (): void => {
      document.body.style.cursor = prevCursor
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  return { startGroupResize }
}
