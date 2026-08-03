// アイコン（テロップに添える小さな画像）の置き場と、割り当て。
//
// ## 割り当てには2つの軸がある
//
// **段ごと**（この段のテロップには常にこの絵）と**色ごと**（このラベル色にはこの絵）。
// 話し手が段で分かれている作りと、色で分かれている作りの両方があるので、どちらも要る。
//
// ## 自動で揃えるかを切り替えたら、いま出ている物にも効かせる
//
// 切り替えたのに画面が変わらないと、効いていないように見える。
// 切り替えの前後で本文の位置がずれるので、ずれたぶんだけ微調整の値を戻す
// （そうしないと、揃えるだけのつもりが文字ごと動く）。
//
// ## 取り込んだ絵は、その場で切り抜く
//
// 元の大きさのまま持つと、テロップに添えたとき余白だらけになる。
// 取り込む時点で切り抜いておけば、後から全部やり直さずに済む。

import { clamp } from '../../../shared/timeline'
import { fileToDataUrl } from '../lib/iconLibrary'
import { saveIconAssign, saveIconLibrary, type IconItem } from '../lib/iconLibrary'
import { useIconsCtx } from './iconsContext'
import { useDoc } from './contentContext'
import { useSel } from './selectionContext'
import { useToastCtx } from './toastContext'
import { usePlaybackCtx } from './playbackContext'

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface UseIconLibraryDeps {
  /** 取り込んである絵の一覧。App が持っている */
  iconLibrary: IconItem[]
  setIconLibrary: React.Dispatch<React.SetStateAction<IconItem[]>>
  /** 取り込んだ絵を切り抜く画面を開く */
  setCropSrc: (v: { src: string; onDone: (img: string) => void } | null) => void
  /** 段ごと・色ごとの割り当ての置き場 */
  setIconAssignState: React.Dispatch<React.SetStateAction<Record<string, string>>>
  setLaneIconAssign: React.Dispatch<React.SetStateAction<Record<string, string>>>
  setIconOv: React.Dispatch<React.SetStateAction<Record<string, string>>>
  setIconFavs: React.Dispatch<React.SetStateAction<string[]>>
  /** 揃える軸を測り直す（自動を入れたときに要る） */
  applyIconAutoLeft: any
  /** どの畳みを開いているか */
  setOpenAccSec: React.Dispatch<React.SetStateAction<Record<string, string[]>>>
  /** localStorage へ書く */
  saveLS: any
  screenRef: React.RefObject<HTMLDivElement>
  seekTo: (t: number) => void
  stopPlayback: () => void
  /** いま選んでいるテロップ（1つめ） */
  selected: any
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function useIconLibrary(deps: UseIconLibraryDeps) {
  const {
    iconLibrary, setIconLibrary, setCropSrc, setIconAssignState, setLaneIconAssign,
    setIconOv, setIconFavs, applyIconAutoLeft, setOpenAccSec, saveLS, screenRef,
    seekTo, stopPlayback, selected
  } = deps
  const { cues, setCues } = useDoc()
  const { selectedIds, isSelected } = useSel()
  const { showToast } = useToastCtx()
  const { currentTimeRef } = usePlaybackCtx()
  const { setIconAuto, setIconAnchorPos, setIconOffset, setIconScale } = useIconsCtx()
  /** 選んでいるうちの1つめ */
  const primaryId = selectedIds[0] ?? null

  // レーン（テロップトラック）→画像。色と別軸でレーン単位でもアイコンを割当できる
  function setIconForLane(lane: string, image: string | null): void {
    setLaneIconAssign((prev) => {
      const n = { ...prev }
      if (image) n[lane] = image
      else delete n[lane]
      saveLS('giftcut.laneIconAssign', n)
      return n
    })
  }

  // 自動調整のON/OFF切替時は、サイズ倍率とXYオフセットを既定(100%,0)に戻す。
  // ＝前モードの調整が乗ったまま「+」で効いてズレるのを防ぐ（常にクリーンな基準から調整）。
  function changeIconAuto(on: boolean): void {
    // 切替前の本文位置を記録（アイコンを含まない telop-textmain 基準）
    const el = screenRef.current
    const before = el?.querySelector('.telop-box-sel .telop-textmain')?.getBoundingClientRect()
    setIconAuto(on)
    setIconScale(1)
    setIconOffset({ x: 0, y: 0 })
    // ONにしたら「左詰め」を適用（選択テロップ）。ただし固定枠は作らず内容ぴったり＝枠が常に本体一致。
    if (on && selectedIds.length) applyIconAutoLeft()
    // 差分補正: モード切替で本文が動いたぶんを打ち消し、テロップは今の位置のまま＝アイコンだけ付け外し。
    // （旧実装は縦を常に中央基準で再計算しており、縦アンカー下のテロップがONのたびに上へズレていた）
    if (before && el && primaryId != null) {
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const after = el.querySelector('.telop-box-sel .telop-textmain')?.getBoundingClientRect()
          if (!after) return
          const S = el.getBoundingClientRect()
          const dx = (after.left - before.left) / S.width
          const dy = (after.top - before.top) / S.height
          if (Math.abs(dx) < 0.0005 && Math.abs(dy) < 0.0005) return
          // アイコン軸整列後は全テロップが同じ点を共有するので、補正も全テロップ＋軸に適用
          setCues((prev) =>
            prev.map((c) => ({
              ...c,
              pos: {
                x: clamp((c.pos?.x ?? 0.5) - dx, 0, 1),
                y: clamp((c.pos?.y ?? 0.85) - dy, 0, 1)
              }
            }))
          )
          setIconAnchorPos((p) =>
            p ? { x: clamp(p.x - dx, 0, 1), y: clamp(p.y - dy, 0, 1) } : p
          )
        })
      )
    }
  }
  // 色 → 画像 の割当（「アイコン設定」で設定。null で解除）
  function setIconForColor(color: string, image: string | null): void {
    setIconAssignState((prev) => {
      const next = { ...prev }
      if (image) next[color] = image
      else delete next[color]
      saveIconAssign(next)
      return next
    })
  }

  function appendIconImage(name: string, image: string): void {
    // 保存は updater の外で行う（副作用を updater に入れない＋失敗を検知して通知するため）
    const prev = iconLibrary
    const id = Math.max(0, ...prev.map((i) => i.id)) + 1
    const next = [...prev, { id, name, image }]
    setIconLibrary(next)
    if (!saveIconLibrary(next))
      showToast(
        'アイコンを保存できませんでした（保存容量の上限）。\n不要なアイコンを削除してください。',
        'error'
      )
    setOpenAccSec((p) => ({ ...p, icon: ['lib'] })) // 追加したら開いて見せる（各タブ共通の動作）
  }

  /**
   * 画像を1枚ずつ切り抜いて足す。
   *
   * **複数まとめて受け取る。** 1枚だけしか受け付けないと、
   * 何枚も足したい人は同じ操作を繰り返すことになる。
   * 切り抜きは1枚ずつなので、終わったら次の1枚へ送る。
   */
  function addIconFiles(files: File[]): void {
    const rest = files.filter((f) => f.type.startsWith('image/'))
    if (!rest.length) return
    const next = async (): Promise<void> => {
      const f = rest.shift()
      if (!f) return
      try {
        const src = await fileToDataUrl(f)
        const name = f.name.replace(/\.[^.]+$/, '')
        setCropSrc({
          src,
          onDone: (img) => {
            appendIconImage(name, img)
            void next()
          }
        })
      } catch {
        void next() // 読めない1枚で止めない
      }
    }
    void next()
  }
  async function addIconImages(): Promise<void> {
    const inp = document.createElement('input')
    inp.type = 'file'
    inp.accept = 'image/*'
    inp.multiple = true
    inp.onchange = (): void => addIconFiles([...(inp.files ?? [])])
    inp.click()
  }
  function removeIconImage(id: number): void {
    setIconLibrary((prev) => {
      const next = prev.filter((it) => it.id !== id)
      saveIconLibrary(next)
      return next
    })
    // ★/フォルダ振り分けも掃除
    setIconFavs((prev) => {
      const n = prev.filter((x) => x !== String(id))
      saveLS('giftcut.iconFavorites', n)
      return n
    })
    setIconOv((prev) => {
      if (!(String(id) in prev)) return prev
      const n = { ...prev }
      delete n[String(id)]
      saveLS('giftcut.iconOverrides', n)
      return n
    })
  }
  // アイコン表示ON/OFF。チェックは「選択テロップと同じ色(ラベル)のテロップ全部」に反映。
  // ON=undefined(色割当があれば自動表示)、OFF=false(その色を隠す)。単体付与はドラッグ&ドロップで行う。
  function setPersonIconForSelected(on: boolean): void {
    if (!selectedIds.length) return
    const labels = new Set(cues.filter((c) => isSelected(c.id)).map((c) => c.label))
    setCues((prev) =>
      prev.map((c) => (labels.has(c.label) ? { ...c, personIcon: on ? undefined : false } : c))
    )
    if (
      on &&
      selected &&
      (currentTimeRef.current < selected.start || currentTimeRef.current >= selected.end)
    ) {
      stopPlayback()
      seekTo(selected.start)
    }
  }

  return {
    setIconForLane, changeIconAuto, setIconForColor, appendIconImage,
    addIconFiles, addIconImages, removeIconImage, setPersonIconForSelected
  }
}
