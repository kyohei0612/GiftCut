// 段（トラック）の数え方と、太さの決め方。
//
// ## なぜ1か所にまとまるか
//
// 「段が何本あるか」「この段は何pxか」「この物はどの段に居るか」は、
// タイムラインの縦の配置を出すのに**必ず3つ揃って要る**。別々の場所に置くと、
// 片方だけ段の探し方が違って、当たり判定と見た目がずれる。
//
// ## 太さの既定は「一番細く」
//
// 段が7本あると、太いままでは枠に収まらず、初めて開いた人がいきなり縦に
// 送る羽目になる。細ければ全部が一度に見えるので、**太らせたい人だけが
// 太らせればいい**（太さは保存されるので次から続く）。
import { useMemo } from 'react'
import type { Cue } from '../lib/srt'
import type { Track, TrackState } from '../lib/projectTypes'
import { laneHeightOf } from '../lib/laneHeight'
// 重ねる動画の長さ。**正典は shared/timeline**（画面と書き出しで同じ物を通す）
import { vcLen } from '../../../shared/timeline'

export interface UseTrackGeomDeps {
  tracks: Track[]
  trackStates: Record<string, TrackState>
  /** 段ごとに個別指定された太さ（無ければ種類の太さを使う） */
  laneH: Record<string, number>
  videoTrackH: number
  audioTrackH: number
}

export function useTrackGeom(deps: UseTrackGeomDeps) {
  const { tracks, trackStates, laneH, videoTrackH, audioTrackH } = deps

  const nVideoTracks = useMemo(() => tracks.filter((t) => t.kind === 'video').length, [tracks])
  const nAudioTracks = useMemo(() => tracks.filter((t) => t.kind === 'audio').length, [tracks])
  const v1Index = useMemo(() => tracks.findIndex((t) => t.id === 'V1'), [tracks])
  const a1Index = useMemo(() => tracks.findIndex((t) => t.id === 'A1'), [tracks])

  /**
   * 段の太さ。id を渡せばその段の値、種類だけなら種類の値。
   *
   * **決め方は `lib/laneHeight` に出した**（2026-08-06）。
   * 「A3 だけ大きいのはなぜか」に答えるのに、前はアプリを起動して
   * 実寸を測るしかなかった。外に出したので機械で押さえられる
   * ——「A3 と V3 は既定で同じ高さ」を試験が見張っている。
   */
  const trackHOf = (idOrKind: string): number =>
    laneHeightOf(
      {
        laneH,
        videoTrackH,
        audioTrackH,
        kindOf: (id: string) => tracks.find((x) => x.id === id)?.kind
      },
      idOrKind
    )

  /** 段IDの番号（V3→3）。対になる音声の段は同じ番号（V3→A3） */
  const trackNum = (id: string): number => Number(id.slice(1)) || 0
  const pairedAudioOf = (vTrack: string): string => 'A' + trackNum(vTrack)

  /** テロップが居る段（決めていなければ V2） */
  const cueTrack = (c: Cue): string => c.track ?? 'V2'

  /** 音の段のどれかがソロか（ソロが1つでもあれば、他は鳴らさない） */
  const anyAudioSolo = tracks.some((t) => t.kind === 'audio' && trackStates[t.id]?.solo)

  return {
    nVideoTracks,
    nAudioTracks,
    v1Index,
    a1Index,
    trackHOf,
    trackNum,
    pairedAudioOf,
    cueTrack,
    vcLen,
    anyAudioSolo
  }
}
