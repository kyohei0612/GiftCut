// 動き（モーション＝キーフレーム）を付ける・消す・配る。
//
// ## テロップと映像クリップで項目が違う
//
// テロップは位置・拡大・回転・不透明度・波など、映像クリップは拡大と位置だけ。
// **項目が違うので、貼り付けは種類を跨がない。** 跨ぐと「貼ったのに何も起きない」か、
// 意図しない項目だけが入る。
//
// ## 配るのは「値」ではなく「変えた量」
//
// 数値を変えたとき、選んである他の物にも同じだけ配る。ただし配るのは差分。
// 値そのものを配ると、ばらばらに置いてあった物が1か所に揃い、
// 別々に拡大していた物が全部同じ倍率になる。
//
// ## 消すときだけ確認する
//
// 付けるのは印を1つ置くだけで見た目も変わらないが、消すと打った分が失われる。
// 数が多いときは聞く（確認なしで全部消えると、何を失ったのかも分からない）。

import { clamp } from '../../../shared/timeline'
import { hasKeys, putKey, removeKey, valueAt, type Keys } from '../../../shared/keyframes'
import { hasClipMotion, type ClipMotion } from '../../../shared/clipMotion'
import { hasMotion, sanitizeMotion, type Motion, type TelopAnim } from '../lib/telopStyle'
import { DEFAULT_ZOOM, isNeutralZoom } from '../lib/clipLook'
import type { MotionPresetFile } from '../../../shared/telopMotion'
import { useDoc } from './contentContext'
import { useTracksCtx } from './tracksContext'
import { useSel } from './selectionContext'
import { usePlaybackCtx } from './playbackContext'

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface UseMotionDeps {
  reframeTargetRef: any
  askConfirm: any
  showToast: any
  segLayout: any
  patchClipMotion: any
  setSegZoom: any
  setImgZoom: any
  setVClipZoom: any
  vcLen: any
  seekTo: (t: number) => void
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function useMotion(deps: UseMotionDeps) {
  const { reframeTargetRef, askConfirm, showToast, segLayout, patchClipMotion, setSegZoom, setImgZoom, setVClipZoom, vcLen, seekTo } = deps
  const { cues, setCues,  setSegments, imgClips, setImgClips, vClips, setVClips } = useDoc()
  const { selectedIds, selectedVideoIds, selectedImgIds, selectedVClipIds, selectedTelopTrans } = useSel()
  const { currentTimeRef } = usePlaybackCtx()
  const { trackStates } = useTracksCtx()

  /**
   * テロップの動きを丸ごと入れ替える（見本帳から選んだとき・消すとき）。
   *
   * **足すのではなく置き換える。** 見本帳の動きは1つで完結した演出なので、
   * 前の動きの上に重ねると位置が二重にずれて、何が起きたか分からなくなる。
   */
  function setMotion(cueId: number, motion: Motion | undefined): void {
    setCues((prev) =>
      prev.map((c) => (c.id === cueId ? { ...c, motion: hasMotion(motion) ? motion : undefined } : c))
    )
  }

  /**
   * タイムラインの◆を1つ消す。
   *
   * **消す手段が無かった。** 打つのは ⏱ と値の打ち込みでできるのに、
   * 消すのは「その項目ごと捨てる」しか無く、1つだけ打ち間違えたときに
   * 全部やり直しになっていた。
   *
   * ◆は**その時刻に印がある項目を1つにまとめて**出しているので、
   * 消すときも同じ時刻の印を全項目から外す（見えている◆と一致させる）。
   * 印が1つも残らなくなった項目は、動き自体を外す（空の入れ物を残さない）。
   */
  function removeKeyAtTime(
    target: { kind: 'telop'; id: number } | { kind: 'video' | 'img' | 'vclip'; id: number },
    t: number
  ): void {
    if (target.kind === 'telop') {
      setCues((prev) =>
        prev.map((c) => {
          if (c.id !== target.id || !c.motion) return c
          const next: Record<string, unknown> = { ...c.motion }
          for (const k of Object.keys(next)) next[k] = removeKey(next[k] as Keys, t)
          const m = sanitizeMotion(next as Motion)
          return { ...c, motion: hasMotion(m) ? m : undefined }
        })
      )
      return
    }
    const strip = <T extends { motion?: ClipMotion }>(c: T): T => {
      if (!c.motion) return c
      const next: ClipMotion = {
        sc: removeKey(c.motion.sc, t),
        x: removeKey(c.motion.x, t),
        y: removeKey(c.motion.y, t)
      }
      return { ...c, motion: hasClipMotion(next) ? next : undefined }
    }
    if (target.kind === 'video')
      setSegments((prev) => prev.map((s) => (s.id === target.id ? strip(s) : s)))
    else if (target.kind === 'img')
      setImgClips((prev) => prev.map((c) => (c.id === target.id ? strip(c) : c)))
    else setVClips((prev) => prev.map((c) => (c.id === target.id ? strip(c) : c)))
  }

  /** 選んでいる映像全部から、その項目の印を捨てる（固定値も既定へ戻す） */
  function resetClipChannel(key: keyof ClipMotion): void {
    const tgt = reframeTargetRef.current
    const vids = selectedVideoIds.length ? selectedVideoIds : tgt?.kind === 'video' ? [tgt.id] : []
    const imgs = selectedImgIds.length ? selectedImgIds : tgt?.kind === 'img' ? [tgt.id] : []
    const vcs = selectedVClipIds.length ? selectedVClipIds : tgt?.kind === 'vclip' ? [tgt.id] : []
    // 印を消すだけだと、固定値で拡大している物は見た目が変わらず「効かない」と見える
    const zoomOf = (z: { scale: number; x: number; y: number } | undefined): typeof z => {
      const base = z ?? DEFAULT_ZOOM
      const next = { ...base }
      if (key === 'sc') next.scale = 1
      else if (key === 'x') next.x = 0
      else if (key === 'y') next.y = 0
      return isNeutralZoom(next) ? undefined : next
    }
    const strip = <T extends { motion?: ClipMotion }>(c: T): T => {
      if (!c.motion) return c
      const next = { ...c.motion, [key]: undefined }
      return { ...c, motion: hasClipMotion(next) ? next : undefined }
    }
    if (vids.length && !trackStates['V1']?.locked)
      setSegments((prev) =>
        prev.map((s) => (vids.includes(s.id) ? { ...strip(s), zoom: zoomOf(s.zoom) } : s))
      )
    if (imgs.length)
      setImgClips((prev) =>
        prev.map((c) =>
          imgs.includes(c.id) && !trackStates[c.track]?.locked
            ? { ...strip(c), zoom: zoomOf(c.zoom) }
            : c
        )
      )
    if (vcs.length)
      setVClips((prev) =>
        prev.map((c) =>
          vcs.includes(c.id) && !trackStates[c.track]?.locked
            ? { ...strip(c), zoom: zoomOf(c.zoom) }
            : c
        )
      )
  }
  /** 選んでいる映像（動画切片・画像・映像レイヤー）全部の動きを捨てる */
  function clearClipMotions(): void {
    const tgt = reframeTargetRef.current
    const vids = selectedVideoIds.length
      ? selectedVideoIds
      : tgt?.kind === 'video'
        ? [tgt.id]
        : []
    const imgs = selectedImgIds.length ? selectedImgIds : tgt?.kind === 'img' ? [tgt.id] : []
    const vcs = selectedVClipIds.length ? selectedVClipIds : tgt?.kind === 'vclip' ? [tgt.id] : []
    if (vids.length && !trackStates['V1']?.locked)
      setSegments((prev) =>
        prev.map((s) => (vids.includes(s.id) ? { ...s, motion: undefined } : s))
      )
    if (imgs.length)
      setImgClips((prev) =>
        prev.map((c) =>
          imgs.includes(c.id) && !trackStates[c.track]?.locked ? { ...c, motion: undefined } : c
        )
      )
    if (vcs.length)
      setVClips((prev) =>
        prev.map((c) =>
          vcs.includes(c.id) && !trackStates[c.track]?.locked ? { ...c, motion: undefined } : c
        )
      )
  }

  /**
   * ⏱ の入り切り。テロップもクリップも同じ動きにする（2か所に書くとどちらかだけ直る）。
   *
   * 付けるときは、いまの時刻に印を1つ置くだけ（見た目は変わらない）。
   * **消すときは、打った数が多いと確認する**。確認なしで全部消えると、
   * 何を失ったのかも分からない。
   */
  function toggleKeys(
    label: string,
    cur: Keys | undefined,
    initial: number,
    at: number,
    patch: (fn: (keys: Keys | undefined) => Keys | undefined) => void
  ): void {
    if (!hasKeys(cur)) {
      patch(() => putKey(undefined, at, initial))
      return
    }
    if (cur!.length < 2) {
      patch(() => undefined)
      return
    }
    void askConfirm({
      title: `${label}の動きをやめますか`,
      body: `打った印 ${cur!.length} 個が消えます。（Ctrl+Z で戻せます）`,
      okLabel: 'やめる',
      danger: true
    }).then((ok: boolean) => {
      if (ok) patch(() => undefined)
    })
  }

  /**
   * 動画切片・画像・映像レイヤーの数値を変えたとき、
   * **選んである他のクリップにも同じだけ配る。**
   *
   * プレミアと同じで、再生ヘッドがどこにあっても「いま選んでいる物」が変わる。
   * 配るのは差分（値そのものではない）。値を配ると、別々に拡大していた物が
   * 全部同じ倍率に揃ってしまう。
   *
   * @param delta 中に入れる値での差分（倍率やフレーム比。表示単位ではない）
   */
  function nudgeClips(
    from: { kind: 'video' | 'img' | 'vclip'; id: number },
    key: keyof ClipMotion,
    delta: number
  ): void {
    if (!delta) return
    // 素のままの値。拡大だけ 1、位置は 0
    // （印の名前は sc / x / y。固定値側の名前 scale とは別なので取り違えないこと）
    const neutral = key === 'sc' ? 1 : 0
    const each = (
      kind: 'video' | 'img' | 'vclip',
      id: number,
      motion: ClipMotion | undefined,
      zoom: { scale: number; x: number; y: number } | undefined,
      tStart: number,
      len: number,
      setZoom: (z: { scale: number; x: number; y: number }) => void
    ): void => {
      if (kind === from.kind && id === from.id) return
      const t = clamp(currentTimeRef.current - tStart, 0, Math.max(0, len))
      const keys = motion?.[key]
      if (hasKeys(keys)) {
        patchClipMotion(kind, id, key, (ks: Keys | undefined) => putKey(ks, t, valueAt(ks, t, neutral) + delta))
        return
      }
      // 印が無ければ固定値を動かす
      const base = zoom ?? DEFAULT_ZOOM
      const next = { ...base }
      if (key === 'sc') next.scale = Math.max(0.05, base.scale + delta)
      else if (key === 'x') next.x = base.x + delta
      else if (key === 'y') next.y = base.y + delta
      else return // 回転など、固定値の置き場が別の物はここでは触らない
      setZoom(next)
    }
    for (const L of segLayout) {
      if (!selectedVideoIds.includes(L.seg.id)) continue
      if (trackStates['V1']?.locked) continue
      each('video', L.seg.id, L.seg.motion, L.seg.zoom, L.tStart, L.len, (z) =>
        setSegZoom(L.seg.id, z)
      )
    }
    for (const c of imgClips) {
      if (!selectedImgIds.includes(c.id) || trackStates[c.track]?.locked) continue
      each('img', c.id, c.motion, c.zoom, c.tStart, c.duration, (z) => setImgZoom(c.id, z))
    }
    for (const c of vClips) {
      if (!selectedVClipIds.includes(c.id) || trackStates[c.track]?.locked) continue
      each('vclip', c.id, c.motion, c.zoom, c.tStart, vcLen(c), (z) => setVClipZoom(c.id, z))
    }
  }

  /**
   * 見本帳の動きを、選んでいるテロップに付ける。
   *
   * **相手は必ずテロップ。** setMotion は cues しか触らないので、映像クリップに
   * 当たることは構造上ありえない（写し取った演出はテロップ用の項目でできていて、
   * 映像側は拡大と位置しか焼けないため、当たると効かないか書き出せない値になる）。
   * 強調（揺れ・脈動）と同じで、選んでいなければ何もせず、そう言う。
   */
  function applyMotionPreset(p: MotionPresetFile): void {
    // 動きが1つも取れていない物も一覧には並んでいる（人が中身を見て決めるため）。
    // **押しても何も起きないのは罠**なので、要る物の名前を言って終わる。
    if (!hasMotion(p.motion)) {
      showToast(
        `「${p.name}」はまだ付けられません` +
          (p.partial?.length ? `（${p.partial.join(' / ')} がこちらに無いため）` : '')
      )
      return
    }
    const ids = selectedIds.length ? selectedIds : selectedTelopTrans ? [selectedTelopTrans.cueId] : []
    if (!ids.length) {
      showToast('先にテロップを選択してください。')
      return
    }
    ids.forEach((id) => setMotion(id, p.motion))
    // 演出は頭から見せる（付けた直後に途中の絵が出ると、効いたか分からない）
    const head = cues.find((c) => c.id === ids[0])
    if (head) seekTo(head.start)
    showToast(
      `「${p.name}」を付けました` +
        (ids.length > 1 ? `（${ids.length}件）` : '') +
        // 終わりで消える物は、押した直後に言う（言わないと「壊れた」と思われる）
        (p.endsHidden ? '。**2枚重ねの上側用**なので、終わりで文字が消えます' : '') +
        (p.partial?.length ? `。${p.partial.join(' / ')} はこちらに無いので、一部だけです` : '')
    )
  }

  // アニメの「変化する区間」の分割点（ローカル秒）を返す。中間の静止区間は1枚で済ませる。
  function animBreakpoints(
    anim: TelopAnim | undefined,
    motion: Motion | undefined,
    dur: number,
    fps: number
  ): number[] {
    const step = 1 / fps
    const set = new Set<number>([0])
    const addRange = (a: number, b: number): void => {
      for (let t = a; t < b - 1e-4; t += step) set.add(Math.round(t / step) * step)
    }
    // 自分で打った動き（モーション）が付いていたら、全区間を刻む。
    // どこで値が変わるか決め打ちできないので、通しで並べるしかない。
    if (hasMotion(motion) || anim?.emphasis === 'shake' || anim?.emphasis === 'pulse') {
      addRange(0, dur)
    } else if (anim) {
      if (anim.in !== 'none') addRange(0, Math.min(anim.inDur, dur))
      if (anim.out !== 'none') addRange(Math.max(0, dur - anim.outDur), dur)
    }
    return [...set].filter((t) => t < dur - 1e-4).sort((a, b) => a - b)
  }

  return { setMotion, removeKeyAtTime, resetClipChannel, clearClipMotions, toggleKeys, nudgeClips, applyMotionPreset, animBreakpoints }
}
