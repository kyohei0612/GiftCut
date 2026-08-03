// コピーと貼り付け（クリップそのもの／設定だけ／動きだけ）。
//
// ## 3種類ある
//
//   クリップ   … 物ごと複製する（Ctrl+C → Ctrl+V）
//   設定だけ   … 見た目や音量を、別の物へ写す（プレミアの属性ペースト）
//   動きだけ   … 打った印を、別の物へ写す
//
// **同じキーで貼るので、最後にコピーした物で決める。** 覚えていないと、
// 動きをコピーしたつもりがクリップごと増える。
//
// ## 種類が違う物には貼らない
//
// テロップを全部選んで貼っても、動画クリップには入らない。持っていない設定を
// 無理に当てると壊れるので、**持っている物だけ**を写す。
import { useRef } from 'react'
import type { ClipMotion } from '../../../shared/clipMotion'
import { nextGroupId, remapGroups } from '../../../shared/group'
import type { Keys } from '../../../shared/keyframes'
import { sanitizeMotion, type Motion } from '../lib/telopStyle'
import type { MotionRow } from '../components/panels/MotionTab'
import { useDoc } from './contentContext'
import { useSel } from './selectionContext'
import { useTracksCtx } from './tracksContext'
import { useToastCtx } from './toastContext'
import { useClipboardCtx } from './clipboardContext'
import { usePlaybackCtx } from './playbackContext'

export interface UseCopyPasteDeps {
  cueTrack: (c: import('../lib/srt').Cue) => string
  fallbackTrack: (id: string, kind: 'video' | 'audio') => string
  telopLocked: (c: import('../lib/srt').Cue) => boolean
  selected: import('../lib/srt').Cue | null
  idCounter: React.MutableRefObject<number>
  /* eslint-disable @typescript-eslint/no-explicit-any */
  /** モーションのどの行を選んでいるか（貼るときの当て先） */
  motionSelRef: any
  /** いま出ているモーションの行。**印の無い項目の値**はここからしか取れない */
  motionRowsRef: any
  /** プレビューの枠で今つまんでいる相手 */
  reframeTargetRef: any
  leftTab: string
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

export function useCopyPaste(deps: UseCopyPasteDeps) {
  const { cueTrack, fallbackTrack, telopLocked, selected, idCounter, motionSelRef, motionRowsRef, reframeTargetRef, leftTab } = deps
  /**
   * 写し取った動きの控え。**貼り付けは種類を跨がない**ので、
   * どちらから写したか（テロップ／映像）も一緒に覚えておく。
   */
  const motionClipRef = useRef<{
    kind: 'telop' | 'clip'
    data: Record<string, Keys | undefined>
    /** 印が無い項目の「いまの値」。貼るときは行の onValue で流し込む */
    values: Record<string, number>
  } | null>(null)
  const { cues, setCues, setSegments, seClips, setSeClips, imgClips, setImgClips, vClips, setVClips, seIdCounter, imgIdCounter, vClipIdCounter } = useDoc()
  const { selectedIds, setSelectedIds, selectedSeIds, setSelectedSeIds, selectedImgIds, setSelectedImgIds, selectedVClipIds, setSelectedVClipIds, selectedVideoIds,  isSelected } = useSel()
  const { trackStates } = useTracksCtx()
  const { showToast } = useToastCtx()
  const {
    clipboardRef, clipboardSeRef, clipboardImgRef, clipboardVcRef, lastCopyRef
  } = useClipboardCtx()
  const { currentTimeRef } = usePlaybackCtx()

  // ※ 「設定だけ」（属性のコピー・貼り付け）は state/useAttrCopy へ出した。
  //    3種類のうち、あれだけが完全な葉で、`lastCopyRef` にも触れていなかった。
  //    残る2つ（クリップ／動きだけ）は copySelected → copyMotionRows と
  //    一方向に呼び合っていて、**順番の決まりが割れると壊れる**ので1つのまま。

  function copyMotionRows(): boolean {
    if (leftTab !== 'motion') return false
    const keys = motionSelRef.current
    if (!keys.length) return false
    const pick = (src: Record<string, unknown> | undefined): Record<string, Keys | undefined> => {
      const out: Record<string, Keys | undefined> = {}
      for (const k of keys) {
        const v = src?.[k]
        if (v !== undefined) out[k] = structuredClone(v) as Keys
      }
      return out
    }
    const src = selected
      ? { kind: 'telop' as const, motion: selected.motion as Record<string, unknown> | undefined }
      : reframeTargetRef.current
        ? {
            kind: 'clip' as const,
            motion: reframeTargetRef.current.motion as Record<string, unknown> | undefined
          }
        : null
    if (!src) return false
    const data = pick(src.motion)
    // **印が付いていない項目も写す。**
    //
    // 以前は印（キーフレーム）のある項目しか写せず、「ちょっと拡大しただけ」の
    // 見た目を別のクリップへ配れなかった。**先に印を打たせるのは順番が逆。**
    //
    // 印が無い行の値は、テロップなら pos/scale、クリップなら zoom… と
    // 持ち主がばらばらで、ここからは辿れない。**行そのものが読み書きを
    // 持っている**ので、行から値をもらって「値だけ」として覚える。
    const values: Record<string, number> = {}
    for (const k of keys) {
      if (data[k] !== undefined) continue // 印がある方が強い
      const row = motionRowsRef.current.find((r: MotionRow) => r.key === k)
      if (row) values[k] = row.value
    }
    const n = Object.keys(data).length + Object.keys(values).length
    if (!n) {
      // **写す物が無いのに「写した」ことにしない。**
      // 空のまま覚えると、次の貼り付けが素通りしてクリップの貼り付けに流れ、
      // テロップが増える＝黙って別の事が起きる。
      showToast('選んだ項目に写せる物がありません。')
      return true
    }
    motionClipRef.current = { kind: src.kind, data, values }
    lastCopyRef.current = 'motion'
    showToast(
      `動きを${n}項目コピーしました（${src.kind === 'telop' ? '別のテロップ' : '別のクリップ'}を選んで貼り付け）`
    )
    return true
  }

  function pasteMotionRows(): boolean {
    // 見ているタブではなく、**最後に写した物**で決める（上の lastCopyRef 参照）
    if (lastCopyRef.current !== 'motion') return false
    const clip = motionClipRef.current
    if (!clip) return false
    const nKeys = Object.keys(clip.data).length
    const nVals = Object.keys(clip.values).length
    if (!nKeys && !nVals) return false
    /**
     * 印が無かった項目は「値だけ」で写す。
     *
     * **貼る先の行に流し込む。** 行は自分の書き込み先（テロップなら pos/scale、
     * クリップなら zoom…）を知っているので、こちらが持ち主を知らなくてよい。
     * 行が見つからない＝貼る先にその項目が無い（テロップ↔クリップで並びが違う）
     * ときは黙って飛ばす。
     */
    const applyValues = (): number => {
      let n = 0
      for (const [k, v] of Object.entries(clip.values)) {
        const row = motionRowsRef.current.find((r: MotionRow) => r.key === k)
        if (!row) continue
        row.onValue(v)
        n++
      }
      return n
    }
    if (!nKeys) {
      const n = applyValues()
      showToast(n ? `動きを${n}項目 貼り付けました。` : '貼り付ける先にその項目がありません。')
      return true
    }
    const merge = (m: ClipMotion | Motion | undefined): Record<string, unknown> =>
      structuredClone({ ...(m ?? {}), ...clip.data })
    if (clip.kind === 'telop') {
      // **テロップの動きは、テロップにしか入らない。**
      // 全部選んでいても、動画や画像は素通りする
      const ids = selectedIds
      if (!ids.length) {
        showToast('貼り付ける先のテロップが選ばれていません。')
        return true
      }
      setCues((prev) =>
        prev.map((c) =>
          ids.includes(c.id) && !telopLocked(c)
            ? { ...c, motion: sanitizeMotion(merge(c.motion)) }
            : c
        )
      )
      const nv = applyValues()
      showToast(`${ids.length}個のテロップに貼り付けました。` + (nv ? `（うち${nv}項目は値だけ）` : ''))
      return true
    }
    const tgt = reframeTargetRef.current
    const vids = selectedVideoIds.length ? selectedVideoIds : tgt?.kind === 'video' ? [tgt.id] : []
    const imgs = selectedImgIds.length ? selectedImgIds : tgt?.kind === 'img' ? [tgt.id] : []
    const vcs = selectedVClipIds.length ? selectedVClipIds : tgt?.kind === 'vclip' ? [tgt.id] : []
    if (!vids.length && !imgs.length && !vcs.length) {
      showToast('貼り付ける先のクリップが選ばれていません。')
      return true
    }
    const put = <T extends { motion?: ClipMotion }>(c: T): T =>
      ({ ...c, motion: merge(c.motion) as ClipMotion }) as T
    if (vids.length && !trackStates['V1']?.locked)
      setSegments((prev) => prev.map((s) => (vids.includes(s.id) ? put(s) : s)))
    if (imgs.length)
      setImgClips((prev) =>
        prev.map((c) => (imgs.includes(c.id) && !trackStates[c.track]?.locked ? put(c) : c))
      )
    if (vcs.length)
      setVClips((prev) =>
        prev.map((c) => (vcs.includes(c.id) && !trackStates[c.track]?.locked ? put(c) : c))
      )
    const nv2 = applyValues()
    showToast(
      `${vids.length + imgs.length + vcs.length}個のクリップに貼り付けました。` +
        (nv2 ? `（うち${nv2}項目は値だけ）` : '')
    )
    return true
  }

  function copySelected(): void {
    if (copyMotionRows()) return
    lastCopyRef.current = 'clip'
    const cueSel = cues.filter((c) => isSelected(c.id)).map((c) => structuredClone(c))
    const seSel = seClips.filter((c) => selectedSeIds.includes(c.id)).map((c) => ({ ...c }))
    const imgSel = imgClips.filter((c) => selectedImgIds.includes(c.id)).map((c) => ({ ...c }))
    const vcSel = vClips.filter((c) => selectedVClipIds.includes(c.id)).map((c) => ({ ...c }))
    if (!cueSel.length && !seSel.length && !imgSel.length && !vcSel.length) return
    clipboardRef.current = cueSel
    clipboardSeRef.current = seSel
    clipboardImgRef.current = imgSel
    clipboardVcRef.current = vcSel
  }

  function pasteClipboard(): void {
    if (pasteMotionRows()) return
    const clip = clipboardRef.current
    const clipSe = clipboardSeRef.current
    const clipImg = clipboardImgRef.current
    const clipVc = clipboardVcRef.current
    if (!clip.length && !clipSe.length && !clipImg.length && !clipVc.length) return
    if (clip.some((c) => trackStates[cueTrack(c)]?.locked)) return // 貼り付け先トラックがロック中
    // 3種まとめての相対位置を保つため、全体の最小開始時刻を基準にする
    const starts = [
      ...clip.map((c) => c.start),
      ...clipSe.map((c) => c.tStart),
      ...clipImg.map((c) => c.tStart),
      ...clipVc.map((c) => c.tStart)
    ]
    const offset = currentTimeRef.current - Math.min(...starts) // 貼り付けは再生ヘッド位置基準
    // 「組」は**写しごとに新しい番号を振る。** 元の番号のまま貼ると、
    // 貼った物と元が同じ組になり、貼った方を動かしたつもりで元まで動く。
    // 元が2つの組に分かれていたら、貼った側でも2つのまま保つ（shared/group）
    const gmap = remapGroups(
      [...clip, ...clipSe, ...clipImg, ...clipVc].map((c) => c.group),
      nextGroupId({ cue: cues, se: seClips, img: imgClips, vclip: vClips })
    )
    const regroup = (g: number | undefined): number | undefined =>
      g == null ? undefined : gmap.get(g)
    if (clip.length) {
      const pasted = clip.map((c) => ({
        ...structuredClone(c),
        id: idCounter.current++,
        start: Math.max(0, c.start + offset),
        end: Math.max(0, c.end + offset),
        group: regroup(c.group)
      }))
      setCues((prev) => [...prev, ...pasted].sort((a, b) => a.start - b.start))
      setSelectedIds(pasted.map((p) => p.id))
    }
    if (clipSe.length) {
      const pasted = clipSe
        .filter((c) => !trackStates[c.track]?.locked)
        .map((c) => ({
          ...c,
          id: seIdCounter.current++,
          tStart: Math.max(0, c.tStart + offset),
          track: fallbackTrack(c.track, 'audio'),
          group: regroup(c.group)
        }))
      setSeClips((prev) => [...prev, ...pasted])
      setSelectedSeIds(pasted.map((p) => p.id))
    }
    if (clipImg.length) {
      const pasted = clipImg
        .filter((c) => !trackStates[c.track]?.locked)
        .map((c) => ({
          ...c,
          id: imgIdCounter.current++,
          tStart: Math.max(0, c.tStart + offset),
          track: fallbackTrack(c.track, 'video'),
          group: regroup(c.group)
        }))
      setImgClips((prev) => [...prev, ...pasted])
      setSelectedImgIds(pasted.map((p) => p.id))
    }
    if (clipVc.length) {
      const pasted = clipVc
        .filter((c) => !trackStates[c.track]?.locked)
        .map((c) => ({
          ...c,
          id: vClipIdCounter.current++,
          tStart: Math.max(0, c.tStart + offset),
          track: fallbackTrack(c.track, 'video'),
          group: regroup(c.group)
        }))
      setVClips((prev) => [...prev, ...pasted])
      setSelectedVClipIds(pasted.map((p) => p.id))
    }
  }

  // `copyMotionRows` / `pasteMotionRows` は返さない。**必ず copySelected /
  // pasteClipboard 越しに呼ぶ**（先に動きを試して、駄目ならクリップ）。
  // 前は返していたが受け取る所が無かった（return の中は noUnusedLocals が見ない）
  return { copySelected, pasteClipboard }
}
