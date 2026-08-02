// 「組」（ネスト）を、選ぶ・作る・解く・一緒に動かす。
//
// ## 何を組にするか
//
// **自由に置ける4種類だけ**——テロップ・効果音／BGM・画像・映像レイヤー。
// 本編の切片（V1）は入れない。切片は常に隙間なく連続する（リップル前提）ので
// 単独では動かせず、組でまとめて動かす意味が無い。決めた経緯は `shared/group.ts` の頭。
//
// ## 入口を1か所に寄せてある
//
// **選ぶ所を種類ごとに書いてはいけない。** クリップごとに「掴んだら仲間も選ぶ」を
// 書くと、必ずどれか1つ書き忘れて「片方だけ組が効かない」状態が残る
//（吸着で実際に起きた型）。ここでは効果1つで**選択そのものを組ごとに広げる**:
//
//   選び方（クリック・Ctrl+クリック・囲み選択・全選択）が何通りあっても、
//   最後は選択の配列に落ちる → そこを1回広げれば全部に効く
//
// 広げる計算（`expandSelectionByGroup`）は**同じ物を2回入れず、変わらなければ
// 同じ配列を返す**ので、この効果が自分を呼び戻して回り続けることはない。
//
// ## 掴んで動かすのは別口
//
// 掴んだ瞬間に動かす相手を決めるので、効果（描き直しの後）では間に合わない。
// また**動かす仕掛けは種類ごとに別々**（テロップ／効果音・画像・映像レイヤー）で、
// どれも「自分の種類の選択」しか動かさない。そこで、掴んだときに
// `partnersOf` で**別の種類の相手**を控えておき、動いた分だけ `shiftPartners` で
// 一緒にずらす。控える／ずらすの計算はここ1か所にある。

import { useEffect } from 'react'
import {
  applyGroup,
  canGroup,
  canUngroup,
  expandSelectionByGroup,
  makeGroup,
  membersOfGroups,
  sanitizeGroupId,
  ungroup,
  type GroupPool
} from '../../../shared/group'
import { useDoc } from './contentContext'
import { useSel } from './selectionContext'

/** 組に入れられる種類。**切片（seg）は入らない** */
export type NestKind = 'cue' | 'se' | 'img' | 'vclip'

/** 掴んだときに控える「組の相手」と、そのときの位置 */
export interface NestPartners {
  cue: { id: number; start: number; end: number }[]
  se: { id: number; tStart: number }[]
  img: { id: number; tStart: number }[]
  vclip: { id: number; tStart: number }[]
  /** 1人も居なければ true（毎回の pointermove で何もしないで済む） */
  empty: boolean
}

export const NO_PARTNERS: NestPartners = { cue: [], se: [], img: [], vclip: [], empty: true }

export interface Nest {
  /** 選んでいる物を1つの組にできるか（2つ以上あるか） */
  canNest: boolean
  /** 選んでいる物のどれかが組に入っているか */
  canUnnest: boolean
  nest: () => void
  unnest: () => void
  /**
   * 掴んだ物の「組の相手」を控える。
   *
   * @param kind 掴んだ物の種類
   * @param dragIds その種類で、**掴む仕掛けが自分で動かす** id
   *   （ここから外す。外さないと同じ物に2回ずれが掛かる）
   */
  partnersOf: (kind: NestKind, dragIds: readonly number[]) => NestPartners
  /** 控えた相手を、掴んだ物と同じだけ横へずらす */
  shiftPartners: (p: NestPartners, delta: number) => void
}

export function useNest(): Nest {
  const { cues, setCues, seClips, setSeClips, imgClips, setImgClips, vClips, setVClips } = useDoc()
  // 選択そのものは広げない（それは useNestSelectSync の仕事）。ここは読むだけ
  const { selectedIds, selectedSeIds, selectedImgIds, selectedVClipIds } = useSel()

  const pool: GroupPool<NestKind> = { cue: cues, se: seClips, img: imgClips, vclip: vClips }
  const sel = { cue: selectedIds, se: selectedSeIds, img: selectedImgIds, vclip: selectedVClipIds }

  /** 4種類ぶんの印を一度に付け替える。**1つでも抜けると組が半分だけ残る** */
  const stamp = (ids: Record<NestKind, readonly number[]>, group: number | undefined): void => {
    setCues((prev) => applyGroup(prev, ids.cue, group) as typeof prev)
    setSeClips((prev) => applyGroup(prev, ids.se, group) as typeof prev)
    setImgClips((prev) => applyGroup(prev, ids.img, group) as typeof prev)
    setVClips((prev) => applyGroup(prev, ids.vclip, group) as typeof prev)
  }

  return {
    canNest: canGroup(pool, sel),
    canUnnest: canUngroup(pool, sel),
    nest: () => {
      const made = makeGroup(pool, sel)
      if (made) stamp(made.ids, made.group)
    },
    unnest: () => {
      const gone = ungroup(pool, sel)
      if (gone) stamp(gone, undefined)
    },
    partnersOf: (kind, dragIds) => {
      const own = new Set(dragIds)
      const groups = new Set<number>()
      for (const it of pool[kind]) {
        if (!own.has(it.id)) continue
        const g = sanitizeGroupId(it.group)
        if (g != null) groups.add(g)
      }
      if (groups.size === 0) return NO_PARTNERS
      const mem = membersOfGroups(pool, [...groups])
      // 掴む仕掛けが自分で動かす分は外す（2回ずれる）
      const idsOf = (k: NestKind): Set<number> =>
        new Set(k === kind ? mem[k].filter((id) => !own.has(id)) : mem[k])
      const cueIds = idsOf('cue')
      const seIds = idsOf('se')
      const imgIds = idsOf('img')
      const vcIds = idsOf('vclip')
      const p: NestPartners = {
        cue: cues.filter((c) => cueIds.has(c.id)).map((c) => ({ id: c.id, start: c.start, end: c.end })),
        se: seClips.filter((c) => seIds.has(c.id)).map((c) => ({ id: c.id, tStart: c.tStart })),
        img: imgClips.filter((c) => imgIds.has(c.id)).map((c) => ({ id: c.id, tStart: c.tStart })),
        vclip: vClips.filter((c) => vcIds.has(c.id)).map((c) => ({ id: c.id, tStart: c.tStart })),
        empty: false
      }
      p.empty = !p.cue.length && !p.se.length && !p.img.length && !p.vclip.length
      return p
    },
    shiftPartners: (p, delta) => {
      if (p.empty) return
      // **控えた位置からの絶対値で置く。** 前の位置に足していくと、
      // 吸い付きで delta が丸められた分だけ毎回ずれが積もる。
      //
      // 0 より前へは出さない（出すと画面から消えて掴めなくなる）。
      // まとめて動かしているときは、ここで相手同士の間隔が縮むことがある——
      // 掴んでいる方は自分で 0 止めするので、束の形は左端で潰れる。
      const at = (base: number): number => Math.max(0, base + delta)
      if (p.cue.length) {
        const m = new Map(p.cue.map((x) => [x.id, x]))
        setCues((prev) =>
          prev.map((c) => {
            const b = m.get(c.id)
            if (!b) return c
            const s = at(b.start)
            return { ...c, start: s, end: s + (b.end - b.start) }
          })
        )
      }
      if (p.se.length) {
        const m = new Map(p.se.map((x) => [x.id, x.tStart]))
        setSeClips((prev) => prev.map((c) => (m.has(c.id) ? { ...c, tStart: at(m.get(c.id)!) } : c)))
      }
      if (p.img.length) {
        const m = new Map(p.img.map((x) => [x.id, x.tStart]))
        setImgClips((prev) => prev.map((c) => (m.has(c.id) ? { ...c, tStart: at(m.get(c.id)!) } : c)))
      }
      if (p.vclip.length) {
        const m = new Map(p.vclip.map((x) => [x.id, x.tStart]))
        setVClips((prev) => prev.map((c) => (m.has(c.id) ? { ...c, tStart: at(m.get(c.id)!) } : c)))
      }
    }
  }
}

/**
 * **組ごとに選ぶ、唯一の入口。**
 *
 * 選び方が何通りあっても最後は選択の配列に落ちるので、そこを1回広げる。
 * 種類ごとに書くと必ず書き忘れが出る（このファイルの頭を見ること）。
 *
 * ※ 呼ぶのは1か所だけ（state/useAppWiring）。2か所で呼んでも壊れはしないが、
 *   同じ計算を2回することになる。
 */
export function useNestSelectSync(): void {
  const { cues, seClips, imgClips, vClips } = useDoc()
  const {
    selectedIds, setSelectedIds, selectedSeIds, setSelectedSeIds,
    selectedImgIds, setSelectedImgIds, selectedVClipIds, setSelectedVClipIds
  } = useSel()
  useEffect(() => {
    const next = expandSelectionByGroup<NestKind>(
      { cue: cues, se: seClips, img: imgClips, vclip: vClips },
      { cue: selectedIds, se: selectedSeIds, img: selectedImgIds, vclip: selectedVClipIds }
    )
    // 変わっていない種類は同じ配列が返るので、ここで止まる（＝回り続けない）
    if (next.cue !== selectedIds) setSelectedIds(next.cue as number[])
    if (next.se !== selectedSeIds) setSelectedSeIds(next.se as number[])
    if (next.img !== selectedImgIds) setSelectedImgIds(next.img as number[])
    if (next.vclip !== selectedVClipIds) setSelectedVClipIds(next.vclip as number[])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cues, seClips, imgClips, vClips, selectedIds, selectedSeIds, selectedImgIds, selectedVClipIds])
}
