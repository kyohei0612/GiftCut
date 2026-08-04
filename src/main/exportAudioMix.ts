// ベース音声に**効果音と映像レイヤーの音を混ぜて**、最後にラウドネスを揃える側。
//
// ## 効果音が1本も無くても通す
//
// 「無ければ何もしない」にすると、ラウドネス正規化まで飛ばしてしまい、
// **効果音の有無で本編の音量が変わる**（書き出してから気づく型）。
//
// ## ベース音声はいったん目印で置く
//
// フィルタで使うか `-map` で直結かが後段の分岐で決まるため、先に入力ラベルを
// 払い出すと「使わないのに asplit の出力を作った」でエラーになる。
// 詳しくは `RAW_BASE_A` の真上。
//
// ## 中身
//
// - `RAW_BASE_A` … ベース音声の目印（組み終わってから実ラベルへ置換する）
// - `AudioMixCtx` / `AudioMixInput` … 受け渡しの形
// - `buildAudioMix` … 混ぜて、ラウドネスを揃えて、`-map` を返す
// 重ねた動画の長さは shared/timeline が正典。**ここで書き起こさない**
import { vcLen } from '../shared/timeline'
import type { ExportSEClip, ExportVClip } from './exportTypes'

// ---- 音のミックス（ベース音声＋効果音＋映像レイヤーの音 → ラウドネス正規化）----

/**
 * ベース音声の目印。
 *
 * カット無しのベース音声（元動画の音声そのまま）は、**フィルタで使うか
 * `-map` で直結かが後段の分岐で決まる**。使わないのに asplit の出力を作ると
 * エラーになるので、いったんこの目印を置き、**全部組み終わってから**
 * 「目印が残っていたら」入力ラベルを払い出して置換する。
 */
export const RAW_BASE_A = '@BASEA@'

/** 音のミックスが要る道具 */
export interface AudioMixCtx {
  useA: (idx: number) => string
  ssOffsetOf: (idx: number, wantSec: number, audioUsed: boolean) => number
}

export interface AudioMixInput {
  /** 切片があるか。あれば `[acat]`、無ければ元動画の音（＝目印）から始める */
  hasSegs: boolean
  audioPresent: boolean
  /** A1(ベース音声)トラック音量×マスター */
  baseVol: number
  ses: ExportSEClip[] | null
  seInput: number[]
  vcs: ExportVClip[] | null
  vcInput: number[]
  vcHasAudio: boolean[]
  /** 目標LUFS（YouTube最適 -14 等）。null なら正規化しない */
  loudnormLUFS: number | null
  /** ここまでで決まっている -map（切片が作った物、または元動画への直結） */
  audioMap: string[]
}

/**
 * 効果音と映像レイヤーの音をベース音声に混ぜ、最後にラウドネスを揃える。
 *
 * ※ **ses が無くても通す。** 以前は `if (ses)` の内側にあり、効果音を1本も
 *   置いていないプロジェクトでは**映像レイヤーの音が丸ごと書き出されなかった**。
 */
export function buildAudioMix(
  ctx: AudioMixCtx,
  o: AudioMixInput
): { filter: string; audioMap: string[] } {
  const { useA, ssOffsetOf } = ctx
  const { ses, seInput, vcs, vcInput, vcHasAudio } = o
  let filter = ''
  let audioMap = o.audioMap
  // A1(ベース音声)トラック音量×マスターを適用
  let baseAudioLbl = o.audioPresent ? (o.hasSegs ? '[acat]' : RAW_BASE_A) : null
  if (baseAudioLbl && Math.abs(o.baseVol - 1) > 1e-3) {
    filter += `${baseAudioLbl}volume=${o.baseVol.toFixed(3)}[abase];`
    baseAudioLbl = '[abase]'
    audioMap = ['-map', '[abase]']
  }

  if (ses || vcs) {
    const baseLbl = baseAudioLbl
    const mixParts: string[] = []
    if (baseLbl) mixParts.push(baseLbl)
    ses?.forEach((se, k) => {
      const ms = Math.max(0, Math.round(se.tStart * 1000))
      const durN = Math.max(0.05, se.duration)
      const vol = (se.volume ?? 1).toFixed(2)
      // フェードイン/アウト（afade）を volume と adelay の間に挟む
      const fi = Math.max(0, Math.min(se.fadeIn ?? 0, durN))
      const fo = Math.max(0, Math.min(se.fadeOut ?? 0, durN))
      let fade = ''
      if (fi > 0) fade += `,afade=t=in:st=0:d=${fi.toFixed(3)}`
      if (fo > 0) fade += `,afade=t=out:st=${(durN - fo).toFixed(3)}:d=${fo.toFixed(3)}`
      // 音源内オフセット（左端トリム/分割）ぶん頭を送って、そこから duration 秒を切り出す。
      // ベース音声と同じ 48k/stereo に揃えてから amix に入れる（サンプルレート差で崩れないように）。
      const so = Math.max(0, se.srcOffset ?? 0)
      // 声に合わせて下げる（ダッキング）。**adelay の後**に掛ける。
      // 前に掛けると、式の t がクリップ内の時間になって、声の位置とずれる。
      const duck = se.duckExpr
        ? `,volume=eval=frame:volume='${se.duckExpr.replace(/'/g, '')}'`
        : ''
      filter += `${useA(seInput[k])}atrim=${so.toFixed(3)}:${(so + durN).toFixed(3)},asetpts=PTS-STARTPTS,aformat=sample_rates=48000:channel_layouts=stereo,volume=${vol}${fade},adelay=${ms}|${ms}${duck}[se${k}];`
      mixParts.push(`[se${k}]`)
    })
    // 映像レイヤーの音声もミックスへ（映像と同じ位置・同じ長さ）
    if (vcs) {
      vcs.forEach((vc, k) => {
        const vol = vc.volume ?? 1
        if (vol <= 0) return // 消音クリップはミックスに入れない
        // 音声ストリームが無い動画（画面録画など）は [N:a] が存在せず、参照すると
        // 書き出し全体が "Stream specifier ':a' matches no streams" で失敗する。
        if (!vcHasAudio[k]) return
        const durN = vcLen(vc)
        const ms = Math.max(0, Math.round(vc.tStart * 1000))
        const fi = Math.max(0, Math.min(vc.fadeIn ?? 0, durN))
        const fo = Math.max(0, Math.min(vc.fadeOut ?? 0, durN))
        let fade = ''
        if (fi > 0) fade += `,afade=t=in:st=0:d=${fi.toFixed(3)}`
        if (fo > 0) fade += `,afade=t=out:st=${(durN - fo).toFixed(3)}:d=${fo.toFixed(3)}`
        const off = ssOffsetOf(vcInput[k], vc.srcStart, true) // 音声を使う入力に -ss は付けない（常に0）
        filter += `${useA(vcInput[k])}atrim=${(vc.srcStart - off).toFixed(3)}:${(vc.srcEnd - off).toFixed(3)},asetpts=PTS-STARTPTS,aformat=sample_rates=48000:channel_layouts=stereo,volume=${vol.toFixed(2)}${fade},adelay=${ms}|${ms}[vca${k}];`
        mixParts.push(`[vca${k}]`)
      })
    }
    if (mixParts.length >= 2 || (mixParts.length === 1 && !baseLbl)) {
      filter += `${mixParts.join('')}amix=inputs=${mixParts.length}:normalize=0:dropout_transition=0[amixout];`
      audioMap = ['-map', '[amixout]']
    }
  }

  // ラウドネス正規化（loudnorm）: 最終音声を目標LUFSへそろえる（YouTube最適 -14 等）。
  // audioPresent は「元動画に音声があるか」なので条件に入れない
  // （元動画が無音でも SE/BGM だけで音声を作る構成があり、そこでも正規化を効かせる）。
  // loudnorm は内部で192kHzに上げるため、aresample で48kHzへ戻す（AACが96kHzになるのを防ぐ）。
  if (o.loudnormLUFS !== null && audioMap.length === 2) {
    const cur = audioMap[1]
    const inLbl = cur.startsWith('[') ? cur : RAW_BASE_A
    filter += `${inLbl}loudnorm=I=${o.loudnormLUFS}:TP=-1.5:LRA=11,aresample=48000[aout];`
    audioMap = ['-map', '[aout]']
  }
  return { filter, audioMap }
}
