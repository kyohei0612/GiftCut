// 段（トラック）の高さを、どう決めるか。
//
// ## なぜ切り出したか（2026-08-06）
//
// 「**A3 だけ大きい。なんで A3 だけ既定を見てるの**」と言われて、
// 答えるのに**アプリを起動して実寸を測る**しかなかった。
// 決め方はフックの中にあり、外から呼べなかったため。
//
// 高さは2段構えで決まる:
//
//   1  段ごとの指定（`laneH['A1'] = 44` のような物。掴んで変えると付く）
//   2  無ければ**種類ごとの既定**（映像／音声で1つずつ。Shift で掴むと変わる）
//
// この形そのものは正しいが、**どの段に 1 が付いているかは画面から読めない**。
// だから「A3 だけ既定を見ている」状態が起きても、原因に辿り着けない。
//
// 実際に起きた形（本人の画面を測った値）:
//
//   音声の既定 96.5 ／ 段ごと {A1: 44, A2: 26}
//   → A1 44・A2 26・**A3 だけ 97**
//
// **A3 が特別なのではない。A3 だけが 2 を見ている。**
// V3 も同じく 2 を見ているが、映像の既定は 26 のままだったので揃って見えた。
//
// ここを外へ出したので、**「A3 と V3 は既定で同じ」を機械で押さえられる**
// （`laneHeight.test.ts`）。人が起動して測らなくてよくなった。

/** 段の種類 */
export type LaneKind = 'video' | 'audio'

export interface LaneHeightSource {
  /** 段ごとの指定。付いている段だけ入っている */
  laneH: Record<string, number>
  /** 種類ごとの既定 */
  videoTrackH: number
  audioTrackH: number
  /** 段の一覧（id から種類を引くのに使う） */
  kindOf: (id: string) => LaneKind | undefined
}

/**
 * 段の高さを決める。`idOrKind` には段の id（`A3`）か種類（`audio`）を渡す。
 *
 * **指定 → 種類の既定 → 映像の既定**、の順に落ちる。
 * 最後が映像なのは、知らない id を渡されたときに 0 にしないため
 * （0 にすると段が消えて、掴む所も無くなる）。
 */
export function laneHeightOf(src: LaneHeightSource, idOrKind: string): number {
  const own = src.laneH[idOrKind]
  if (own != null) return own
  if (idOrKind === 'video' || idOrKind === 'audio')
    return idOrKind === 'video' ? src.videoTrackH : src.audioTrackH
  return src.kindOf(idOrKind) === 'audio' ? src.audioTrackH : src.videoTrackH
}
