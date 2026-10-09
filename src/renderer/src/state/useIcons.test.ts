// @vitest-environment jsdom
// アイコンを出す決まり。**全体のスイッチ（iconEnabled）は既定で切**。
//
// ## なぜ見張るか
//
// 色（ラベル）や段への割り当ては利用者の設定として残るので、一度でも割り当てると
// 新しいプロジェクトでテロップを足した瞬間から顔が付いていた（「何も設定していないのに
// アイコンが付く」・編集者の指摘、2026-10-09）。既定が「入」へ戻ると同じ事が起きる。
// 直に落とした1枚はスイッチに関係なく出る（落としたのに出ないと壊れて見える）。
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { useIcons, type Icons } from './useIcons'
import type { Cue } from '../lib/srt'
import { defaultTelopStyle } from '../lib/telopStyle'

const cue = (extra: Partial<Cue> = {}): Cue => ({
  id: 1,
  start: 0,
  end: 1,
  text: 'あ',
  style: defaultTelopStyle(),
  label: '#ff0000',
  pos: { x: 0.5, y: 0.9 },
  ...extra
})
const assign = { '#ff0000': 'data:label' }
const lane = { V2: 'data:lane' }
const trackOf = (): string => 'V2'

/** フックを1つだけ動かす（useMedia.test と同じ流儀。testing-library は入っていない） */
let cleanup: (() => void) | null = null
function mount(): () => Icons {
  let latest: Icons | null = null
  function Probe(): null {
    latest = useIcons()
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
  return () => latest as Icons
}
afterEach(() => {
  cleanup?.()
  cleanup = null
})

describe('アイコンを出す決まり', () => {
  it('既定は切。割り当てがあっても出さない（新しいプロジェクトで顔が付かない）', () => {
    const api = mount()
    expect(api().iconEnabled).toBe(false)
    expect(api().iconForCue(cue(), assign, lane, trackOf)).toBeUndefined()
  })
  it('入にすると、色 → 段 の順で割り当てが効く', () => {
    const api = mount()
    act(() => api().setIconEnabled(true))
    expect(api().iconForCue(cue(), assign, lane, trackOf)).toBe('data:label')
    expect(api().iconForCue(cue({ label: '#000000' }), assign, lane, trackOf)).toBe('data:lane')
  })
  it('直に落とした1枚は、切でも出る', () => {
    const api = mount()
    expect(api().iconForCue(cue({ iconImage: 'data:own' }), assign, lane, trackOf)).toBe('data:own')
  })
  it('その1枚だけ消してあれば、入でも出ない', () => {
    const api = mount()
    act(() => api().setIconEnabled(true))
    expect(api().iconForCue(cue({ personIcon: false }), assign, lane, trackOf)).toBeUndefined()
  })
})
