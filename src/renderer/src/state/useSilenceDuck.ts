// 「静かな所を切る」と「声の間だけ BGM を下げる」。
//
// ## なぜ同じ場所に居るか
//
// **同じ1つの解析結果を使う。** 音の大きさから「静かな所」を探し、
// その裏返しが「声のある所」。片方だけ動かすと、切った後にダッキングが
// 元の位置のまま残る、といったズレが出る。
//
// 判定は音の大きさだけで、文字起こしは使わない。どこまでを無音とするか・
// 前後にどれだけ余白を残すかは人によって違うので、「バツっと切りたい人」
// 「少し余白がほしい人」の両方を設定で受ける。
import { useMemo, useState } from 'react'
import { cutsFromSilences } from '../../../shared/silenceCut'
import { totalSegLen } from '../../../shared/timeline'
import {
  DEFAULT_DUCK,
  duckEnvelope,
  gainAt,
  voiceRegions,
  type DuckOpts
} from '../../../shared/ducking'
import type { SEClip, VSeg } from '../lib/projectTypes'
import type { SilenceCutState } from '../components/dialogs/AudioDialogs'

export function useSilenceDuck(segments: VSeg[]) {
  const [silenceCut, setSilenceCut] = useState<SilenceCutState>({
    busy: false,
    found: null,
    noiseDb: -35,
    minSec: 0.35,
    pad: 0.15,
    minLen: 0.4
  })
  const [silenceOpen, setSilenceOpen] = useState(false)

  const [duckOpts, setDuckOpts] = useState<DuckOpts>(DEFAULT_DUCK)
  const [duckOpen, setDuckOpen] = useState(false)

  /**
   * 声に合わせた音量の折れ線。
   * **プレビューと書き出しで同じものを使う**（別々に作ると、聴いた音と
   * 書き出した音が違うという一番たちの悪いズレになる）。
   */
  const duckEnv = useMemo(() => {
    if (!silenceCut.found?.length) return []
    const dur = totalSegLen(segments) || 0
    if (dur <= 0) return []
    return duckEnvelope(voiceRegions(silenceCut.found, dur), duckOpts)
  }, [silenceCut.found, segments, duckOpts])

  /** この効果音/BGMクリップに、いまダッキングが効いているか */
  const duckGainAt = (clip: SEClip, t: number): number =>
    clip.duck && duckEnv.length ? gainAt(duckEnv, t) : 1

  /** いまの設定で「どこを切るか」。設定を動かすたびに出し直す（実行前に見せる） */
  const silenceCuts = useMemo(() => {
    if (!silenceCut.found) return []
    return cutsFromSilences(segments, silenceCut.found, {
      pad: silenceCut.pad,
      minLen: silenceCut.minLen
    })
  }, [segments, silenceCut.found, silenceCut.pad, silenceCut.minLen])

  return {
    silenceCut,
    setSilenceCut,
    silenceOpen,
    setSilenceOpen,
    duckOpts,
    setDuckOpts,
    duckOpen,
    setDuckOpen,
    duckEnv,
    duckGainAt,
    silenceCuts
  }
}
