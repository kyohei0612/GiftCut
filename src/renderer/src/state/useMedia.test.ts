// @vitest-environment jsdom
// 元動画の一覧（sources）と、その**写し**（sourcesRef）がずれないこと。
//
// ## なぜこれを見張るか
//
// `useMedia` の `srcOfSeg` は「**いまこの瞬間**の一覧を引く。掴んでいる最中も
// 読むので state ではなく写しを見る」と自分で宣言している。ところが写しの更新は
// 長らく `useAppWiring` の effect 任せで、**effect は次の描き直しまで走らない**
// ——宣言と実体が食い違っていた。
//
// ## 実際に起きた（2026-08-03）
//
// **素材をまとめて選んで落とすと、1本しか入らなかった。**
//
// `placeVideoAtDrop` は「まだ1本も無いか」を写しで見て、無ければ `loadVideo`
//（＝切片を全部捨てて番号を1へ戻す）を通る。束は `placeDropped` の for が
// **同じ一拍で回す**ので、2本目もまだ空の写しを見て「最初の1本」として入り、
// **1本目を捨てていた**。
//
// e2e の「まとめて選んだ素材は、その順に続けて並ぶ」は**ずっと緑だった**——
// あちらは動画を読み込んだ状態から始めるので、この枝を通らない。
// **症状そのものを押さえるのはこの単体試験の役目。**
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { useMedia, type Media } from './useMedia'
import type { Source } from '../lib/projectTypes'

const src = (id: number): Source => ({
  id,
  path: `C:/x/${id}.mp4`,
  name: `${id}.mp4`,
  origUrl: `gcfile://x/${id}.mp4`,
  duration: 10,
  fps: 30,
  waveform: null
})

/**
 * フックを1つだけ動かして、その戻り値を外から触れるようにする。
 *
 * このリポジトリに `@testing-library` は入っていないので、
 * `PaneWindow.test.tsx` と同じ流儀（`createRoot` ＋ `act`）で自前で持つ。
 */
let cleanup: (() => void) | null = null
function mountMedia(): () => Media {
  let latest: Media | null = null
  function Probe(): null {
    latest = useMedia()
    return null
  }
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => {
    root.render(React.createElement(Probe))
  })
  cleanup = () => {
    act(() => root.unmount())
    host.remove()
  }
  return () => latest as Media
}

afterEach(() => {
  cleanup?.()
  cleanup = null
})

describe('元動画の一覧と、その写し', () => {
  it('**描き直しを待たずに写しが読める**（effect 任せに戻すと落ちる）', () => {
    const api = mountMedia()
    act(() => {
      api().setSources([src(1)])
      // ここを描き直しの外で読むのが肝。effect で追随する形だと、この時点では
      // まだ空で、同じ一拍のうちに続けて置く処理が「まだ1本も無い」と誤解する
      expect(api().sourcesRef.current).toHaveLength(1)
    })
    expect(api().sources).toHaveLength(1)
  })

  it('**同じ一拍で2本置いても、2本とも残る**（まとめて落としたときの形）', () => {
    const api = mountMedia()
    act(() => {
      api().setSources([src(1)])
      // 2本目は「いまの一覧に足す」形。写しが古いと1本目が消える
      api().setSources((prev) => [...prev, src(2)])
      expect(api().sourcesRef.current.map((s) => s.id)).toEqual([1, 2])
    })
    expect(api().sources.map((s) => s.id)).toEqual([1, 2])
  })

  it('空にしたときも写しが揃う（プロジェクトを閉じる／開き直す道）', () => {
    const api = mountMedia()
    act(() => {
      api().setSources([src(1), src(2)])
      api().setSources([])
      expect(api().sourcesRef.current).toEqual([])
    })
    expect(api().sources).toEqual([])
  })

  it('切片から元動画を引ける（srcId 未指定は先頭＝差し替え前の形と同じ）', () => {
    const api = mountMedia()
    act(() => {
      api().setSources([src(1), src(2)])
    })
    expect(api().srcOfSeg({ srcId: 2 } as never)?.id).toBe(2)
    expect(api().srcOfSeg({} as never)?.id).toBe(1)
    // 知らない id は先頭へ倒す（消えた元動画を指していても、絵を出せる方を選ぶ）
    expect(api().srcOfSeg({ srcId: 99 } as never)?.id).toBe(1)
  })
})
