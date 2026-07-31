// プレビューの上でテロップを掴む・拡げる・枠内に寄せる。
//
// タイムラインで掴む話とは別物。こちらは**映っている絵の上での操作**なので、
// 位置は画面の実寸を測って割合（0〜1）で持つ。段や時刻は出てこない。
//
// ## 測ってから動かす物がある
//
// 「枠内に寄せる」「アイコン軸に揃える」は、**いま画面に出ている大きさを
// 測らないと決められない**。選んでいるテロップがその時刻に出ていなければ
// 測れず、押しても無反応になる。そこで一度その時刻へ飛んでから測り直す
// （ensureSelectedTelopVisible）。
//
// ## 動きが付いているときは、位置ではなく印を置く
//
// ⏱（キーフレーム）が入っているテロップを掴んで動かすと、元の位置ごと
// ずらすのではなく**その時刻に印を置く**。プレミアと同じで、これが動きを
// 付ける一番自然なやり方。位置そのものを動かすと、付けた動きが丸ごとずれる。

import { clamp } from '../../../shared/timeline'
import { hasKeys, putKey } from '../../../shared/keyframes'
import type { Motion } from '../../../shared/telopMotion'
import type { Cue } from '../lib/srt'
import { useDoc } from './contentContext'
import { useSel } from './selectionContext'
import { usePlaybackCtx } from './playbackContext'

export interface UseTelopBoxDeps {
  /** プレビューの映像面。位置はこの矩形を基準に測る */
  screenRef: React.RefObject<HTMLDivElement | null>
  /** 手作りのダブルタップ判定に使う（前回どのテロップをいつ叩いたか） */
  lastTelopTapRef: React.MutableRefObject<{ id: number; t: number }>
  telopLocked: (c: Cue) => boolean
  stopPlayback: () => void
  seekTo: (t: number) => void
  /** アイコンの自動配置が入っているか。入っていると四隅は箱ではなく文字を拡縮する */
  iconAuto: boolean
  setIconAnchorPos: (p: { x: number; y: number }) => void
}

export interface TelopBox {
  onTelopPointerDown: (cue: Cue, e: React.PointerEvent) => void
  onTelopResizeStart: (cue: Cue, e: React.PointerEvent, corner: number) => void
  setBoxAnchor: (hx: 'l' | 'c' | 'r', vy: 't' | 'm' | 'b', retried?: boolean) => void
  applyIconAutoLeft: (retried?: boolean) => void
}

export function useTelopBox(deps: UseTelopBoxDeps): TelopBox {
  const { screenRef, lastTelopTapRef, telopLocked, stopPlayback, seekTo, iconAuto, setIconAnchorPos } = deps
  const { cues, setCues } = useDoc()
  const {
    selectedIds, setSelectedIds, setVideoSelected, setSelectedTrans,
    setSelectedTelopTrans, setEditingId, isSelected
  } = useSel()
  const { currentTimeRef } = usePlaybackCtx()

  const primaryId = selectedIds[0] ?? null
  const selected = cues.find((c) => c.id === primaryId) ?? null

  /**
   * 選んでいるテロップが画面に出ていなければ、その時刻へ飛んでから retry。
   *
   * **出ていないと実寸が測れない。** 測る系のボタン（位置・枠内）が
   * 無反応になるのを防ぐ。描き直しを2回待ってから測り直す。
   */
  function ensureSelectedTelopVisible(retry: () => void): boolean {
    if (screenRef.current?.querySelector('.telop-box-sel')) return true
    if (!selected) return false
    stopPlayback()
    seekTo(clamp(currentTimeRef.current, selected.start, selected.end - 0.01))
    requestAnimationFrame(() => requestAnimationFrame(retry)) // 描画を待ってから再実行
    return false
  }

  function onTelopPointerDown(cue: Cue, e: React.PointerEvent): void {
    e.stopPropagation()
    if (e.button !== 0) return
    setVideoSelected(false) // テロップ操作時は動画リフレーム枠を隠す
    setSelectedTrans(null) // トランジション帯の選択を解除（Delete誤爆防止）
    setSelectedTelopTrans(null)
    if (telopLocked(cue)) return // ロック中はプレビューからの移動も不可
    const el = screenRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const sx = e.clientX
    const sy = e.clientY
    // 掴んだ点とテロップ中心のズレを保持（中心が掴んだ点へ飛ばず、そのまま動くように）
    const startPos = cue.pos ?? { x: 0.5, y: 0.85 }
    const grabDX = e.clientX - (rect.left + startPos.x * rect.width)
    const grabDY = e.clientY - (rect.top + startPos.y * rect.height)
    // **選んである物は一緒に動かす。**
    // 掴んだ物が選択に入っているなら、選択中の全員を同じだけずらす。
    // 「まとめて選んで、まとめて下げる」がプレビュー上でできないと、
    // 1つずつ動かして目分量で揃え直すことになる。
    // それぞれの**元の位置からのズレ**で動かす（同じ場所へ集めない）。
    const groupIds =
      selectedIds.includes(cue.id) && selectedIds.length > 1 ? selectedIds : [cue.id]
    const basePos = new Map(
      cues
        .filter((c) => groupIds.includes(c.id) && !telopLocked(c))
        .map((c) => [c.id, c.pos ?? { x: 0.5, y: 0.85 }])
    )
    let moved = false
    const onMove = (ev: PointerEvent): void => {
      // 3px のしきい値でクリックとドラッグを区別（微ジッタで選択が不発にならないように）
      if (!moved && Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < 3) return
      if (!moved) {
        moved = true
        // まとめて動かしているときは選択を壊さない（壊すと2回目から1つしか動かない）
        if (groupIds.length === 1) setSelectedIds([cue.id])
      }
      const x = clamp((ev.clientX - grabDX - rect.left) / rect.width, 0, 1)
      const y = clamp((ev.clientY - grabDY - rect.top) / rect.height, 0, 1)
      // 掴んだ物が動いたぶん。他の選択物にはこれを足す
      const shiftX = x - startPos.x
      const shiftY = y - startPos.y
      if (groupIds.length > 1) {
        setCues((prev) =>
          prev.map((c) => {
            const b = basePos.get(c.id)
            if (!b) return c
            return {
              ...c,
              pos: { x: clamp(b.x + shiftX, 0, 1), y: clamp(b.y + shiftY, 0, 1) }
            }
          })
        )
        return
      }
      // 動きが付いている（⏱ が入っている）なら、**掴んで動かした所に印を置く**。
      // プレミアと同じで、これが動きを付ける一番自然なやり方。
      // 付いていなければ、今までどおり元の位置そのものを動かす。
      const kf = hasKeys(cue.motion?.tx) || hasKeys(cue.motion?.ty)
      if (kf) {
        const t = clamp(currentTimeRef.current - cue.start, 0, cue.end - cue.start)
        // 元の位置からのズレを印にする（1080基準px）
        const dx = (x - (cue.pos?.x ?? 0.5)) * 1920
        const dy = (y - (cue.pos?.y ?? 0.85)) * 1080
        setCues((prev) =>
          prev.map((c) => {
            if (c.id !== cue.id) return c
            const m: Motion = { ...c.motion }
            if (hasKeys(m.tx)) m.tx = putKey(m.tx, t, dx)
            if (hasKeys(m.ty)) m.ty = putKey(m.ty, t, dy)
            return { ...c, motion: m }
          })
        )
        return
      }
      setCues((prev) => prev.map((c) => (c.id === cue.id ? { ...c, pos: { x, y } } : c)))
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      if (moved) {
        lastTelopTapRef.current = { id: -1, t: 0 } // ドラッグはダブルタップ判定をリセット
        return
      }
      setSelectedIds([cue.id])
      // ネイティブdblclick非依存の手動ダブルタップ＝編集へ（350ms以内・同一テロップ）
      const now = performance.now()
      const last = lastTelopTapRef.current
      if (last.id === cue.id && now - last.t < 350) {
        lastTelopTapRef.current = { id: -1, t: 0 }
        stopPlayback()
        setEditingId(cue.id)
      } else {
        lastTelopTapRef.current = { id: cue.id, t: now }
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  // プレビューの四隅ハンドル: 固定ボックスがあれば「箱リサイズ」、無ければ「文字サイズ拡縮」
  function onTelopResizeStart(cue: Cue, e: React.PointerEvent, corner: number): void {
    if (e.button !== 0) return
    if (telopLocked(cue)) return
    const el = screenRef.current
    if (!el) return
    setSelectedIds([cue.id])
    const rect = el.getBoundingClientRect()
    // iconAuto ON は箱があってもフォント拡縮側へ（箱だけ大きくなるのを防ぎ、文字/アイコン/枠を一緒に拡縮）
    if (cue.style.box && !iconAuto) {
      // 箱リサイズ（中心固定。corner 0=TL,1=TR,2=BL,3=BR）
      const sx = corner === 1 || corner === 3 ? 1 : -1
      const sy = corner === 2 || corner === 3 ? 1 : -1
      const startX = e.clientX
      const startY = e.clientY
      const startW = cue.style.box.w
      const startH = cue.style.box.h
      const px = rect.height / 1080 // 画面px / 1080基準px
      const onMove = (ev: PointerEvent): void => {
        const dw = ((ev.clientX - startX) / px) * sx * 2 // 中心固定なので両側→×2
        const dh = ((ev.clientY - startY) / px) * sy * 2
        const w = clamp(Math.round(startW + dw), 60, 3200)
        const h = clamp(Math.round(startH + dh), 40, 2000)
        setCues((prev) =>
          prev.map((c) => (c.id === cue.id ? { ...c, style: { ...c.style, box: { w, h } } } : c))
        )
      }
      const onUp = (): void => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
      return
    }
    // ★Premiere式拡縮: リサイズはテロップ全体の scale（変形倍率）だけを変える。
    // fontSize・縁・影・ベベルの「数値」は固定＝パネルの数字が大きさで変わらない（Premiere準拠）。
    const p = cue.pos ?? { x: 0.5, y: 0.85 }
    const cx = rect.left + p.x * rect.width
    const cy = rect.top + p.y * rect.height
    const startDist = Math.hypot(e.clientX - cx, e.clientY - cy)
    const startScale = cue.scale ?? 1
    const onMove = (ev: PointerEvent): void => {
      const d = Math.hypot(ev.clientX - cx, ev.clientY - cy)
      const factor = startDist > 4 ? d / startDist : 1
      const ns = Math.round(clamp(startScale * factor, 0.1, 8) * 1000) / 1000
      setCues((prev) => prev.map((c) => (c.id === cue.id ? { ...c, scale: ns } : c)))
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  // 枠内配置（3×3）: 固定ボックスが無ければ現在の見た目を測って作成し、中身をその方向へ寄せる
  function setBoxAnchor(hx: 'l' | 'c' | 'r', vy: 't' | 'm' | 'b', retried = false): void {
    if (!selectedIds.length) return
    if (!retried && !ensureSelectedTelopVisible(() => setBoxAnchor(hx, vy, true))) return
    const el = screenRef.current
    const boxEl = el?.querySelector('.telop-box-sel') as HTMLElement | null
    // 箱が無いテロップは、今の見た目そのまま（サイズ・位置を変えず）に箱化する
    let created: { w: number; h: number } | null = null
    let keepPos: { x: number; y: number } | null = null
    if (el && boxEl && !selected?.style.box) {
      const S = el.getBoundingClientRect()
      const B = boxEl.getBoundingClientRect()
      const px = S.height / 1080
      created = {
        w: clamp(Math.round(B.width / px), 40, 3200), // 膨らませない＝内容ぴったり
        h: clamp(Math.round(B.height / px), 30, 2000)
      }
      // 箱は中心配置なので、今の見た目の中心を pos にして位置ズレを防ぐ
      keepPos = {
        x: clamp((B.left + B.width / 2 - S.left) / S.width, 0, 1),
        y: clamp((B.top + B.height / 2 - S.top) / S.height, 0, 1)
      }
    }
    const align = hx === 'l' ? 'left' : hx === 'r' ? 'right' : 'center'
    setCues((prev) =>
      prev.map((c) =>
        isSelected(c.id)
          ? {
              ...c,
              // 位置ズレ防止は測った本人(primary)だけ適用
              pos: !c.style.box && keepPos && c.id === primaryId ? keepPos : c.pos,
              style: {
                ...c.style,
                anchor: { h: hx, v: vy },
                align,
                box: c.style.box ?? created ?? { w: 800, h: 240 }
              }
            }
          : c
      )
    )
  }

  // iconAuto用「アイコン軸」: 主選択テロップの現在位置を軸(左端・縦中央)として測り、
  // 全テロップをその1点に整列させる（anchor l/m・左詰め・固定枠なし）。
  // テロップごとに位置や行数が違ってもアイコンは軸に固定され、再生中に飛び回らない。
  function applyIconAutoLeft(retried = false): void {
    if (!selectedIds.length) return
    if (!retried && !ensureSelectedTelopVisible(() => applyIconAutoLeft(true))) return
    const el = screenRef.current
    const boxEl = el?.querySelector('.telop-box-sel') as HTMLElement | null
    let axis: { x: number; y: number } | null = null
    if (el && boxEl) {
      const S = el.getBoundingClientRect()
      // 外箱(boxEl)基準＝アンカーが効くのは外箱なので等冪（繰り返しても動かない）。
      // アイコン有無による本文のズレは changeIconAuto 側の差分補正が打ち消す。
      const B = boxEl.getBoundingClientRect()
      axis = {
        x: clamp((B.left - S.left) / S.width, 0, 1),
        y: clamp((B.top + B.height / 2 - S.top) / S.height, 0, 1)
      }
      setIconAnchorPos(axis)
    }
    setCues((prev) =>
      prev.map((c) => {
        const st = { ...c.style, anchor: { h: 'l' as const, v: 'm' as const }, align: 'left' as const }
        delete st.box // 内容ぴったり＝枠は常に本体一致
        return { ...c, style: st, pos: axis ?? c.pos }
      })
    )
  }

  return { onTelopPointerDown, onTelopResizeStart, setBoxAnchor, applyIconAutoLeft }
}
