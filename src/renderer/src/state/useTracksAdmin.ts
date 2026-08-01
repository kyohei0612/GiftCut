// 段（トラック）そのものの面倒。足す・消す・選ぶ・鍵・音量、それと「どの段か」の判定。
//
// ## 足す位置には順番がある
//
// 映像は上へ、音声は下へ積む。順番を無視して足すと、段の名前（V2/A2）と
// 画面の並びが食い違い、どこに置いたのか分からなくなる。
//
// ## 映像と音は対で確保する
//
// 動画を置くと映像段と音声段の両方を使う。片方だけ空いていても置けないので、
// **対で空いている所**を探してから確保する。
//
// ## 中身が入っている段は消せない。ただし理由を言う
//
// 黙って何も起きないと、壊れているのか操作を間違えたのかが分からない。
//
// ## 鍵の判定はここに集める
//
// 本編（mainLocked）とテロップ（telopLocked）で見る場所が違うが、
// 「鍵が掛かっていたら触らない」は全部の操作で同じ。散らすと、
// キーでは消えるのにボタンでは消えない、のような食い違いが出る。

import { TRACK_PAD_ROWS } from '../lib/appConst'
import { clamp } from '../../../shared/timeline'
import { newTrackState } from '../lib/trackState'
import { TRACK_H_MAX, TRACK_H_MIN } from './useLaneHeights'
import type { Cue } from '../lib/srt'
import type { Track, TrackState } from '../lib/projectTypes'
import { useDoc } from './contentContext'
import { useExportCtx } from './exportContext'
import { useSel } from './selectionContext'
import { useTracksCtx } from './tracksContext'
import { useToastCtx } from './toastContext'

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface UseTracksAdminDeps {
  /** 段の上下に置く余白（映像の段の高さ × これ） */
  /** どれか1本でもソロなら、それ以外は鳴らさない */
  anyAudioSolo: boolean
  cueTrack: (c: Cue) => string
  /** 段の名前から番号を取る（V2 → 2） */
  trackNum: (id: string) => number
  /** その段のいまの高さ（px） */
  trackHOf: (idOrKind: string) => number
  nVideoTracks: number
  nAudioTracks: number
  videoTrackHRef: React.MutableRefObject<number>
  audioTrackHRef: React.MutableRefObject<number>
  setVideoTrackH: React.Dispatch<React.SetStateAction<number>>
  setAudioTrackH: React.Dispatch<React.SetStateAction<number>>
  setLaneH: React.Dispatch<React.SetStateAction<Record<string, number>>>
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function useTracksAdmin(deps: UseTracksAdminDeps) {
  const {
    anyAudioSolo, cueTrack, trackNum, trackHOf, nVideoTracks, nAudioTracks,
    videoTrackHRef, audioTrackHRef, setVideoTrackH, setAudioTrackH, setLaneH
  } = deps
  const {
    cues, setCues, cuesRef, setSegments, segsRef, seClips, setSeClips, seClipsRef,
    imgClips, setImgClips, imgClipsRef, vClips, setVClips, vClipsRef
  } = useDoc()
  const { setSelectedIds, setSelectedTrackId, clearSegSel } = useSel()
  const { tracks, setTracks, trackStates, setTrackStates } = useTracksCtx()
  const { showToast } = useToastCtx()
  const { masterVolume } = useExportCtx()

  // 今このまま離すと「丸ごと」上書きされてしまうクリップ。赤く縁取って警告する。
  // タイムラインへ画像配置中のゴースト（V2/V3等の映像トラック）
  // ドラッグ中のポインタ直下のトラックidを返す（kind指定でフィルタ）。無ければnull。
  function trackFromEvent(e: { target: EventTarget | null }, kind?: 'video' | 'audio'): string | null {
    const el = (e.target as HTMLElement | null)?.closest?.('[data-tid]')
    const id = el?.getAttribute('data-tid') ?? null
    if (!id) return null
    const tr = tracks.find((t) => t.id === id)
    if (!tr) return null
    if (kind && tr.kind !== kind) return null
    return id
  }
  // 実在するトラックIDへ寄せる（削除済みトラックを指すクリップは既定レーンへ）。
  // 指したままだとタイムラインに出ず選択も削除もできないのに、プレビュー/書き出しには出てしまう。
  // 本編（V1/A1）は同じ切片を共有するリンク済みクリップなので、どちらかが
  // ロックされていれば編集不可にする。以前は V1 しか見ておらず、A1 をロック
  // しても A1 の波形をレザーで切れて Delete で消せた（逆に V1 だけロックすると
  // 音量調整は通るのに削除は止まる、という説明できない状態だった）。
  function mainLocked(): boolean {
    return !!trackStates['V1']?.locked || !!trackStates['A1']?.locked
  }
  function fallbackTrack(id: string, kind: 'video' | 'audio'): string {
    if (tracks.some((t) => t.id === id && t.kind === kind)) return id
    const cands = tracks.filter((t) => t.kind === kind && t.id !== (kind === 'video' ? 'V1' : 'A1'))
    return cands.length ? cands[cands.length - 1].id : kind === 'video' ? 'V2' : 'A2'
  }
  // ドラッグ中のポインタ直下の音声トラックidを返す（SE=A2 / BGM=A3 等に振り分け）。無ければnull。
  function audioTrackFromEvent(e: { target: EventTarget | null }): string | null {
    const el = (e.target as HTMLElement | null)?.closest?.('[data-tid]')
    const id = el?.getAttribute('data-tid') ?? null
    return id && tracks.some((t) => t.id === id && t.kind === 'audio') ? id : null
  }

  // 映像レイヤーに動画を置く前に、V{n} と A{n} を「その動画専用」に空ける。
  // 既にテロップ/画像/SEが載っていたら1段追加してそちらへ退避させる（リンクを崩さないため）。
  // トラックを番号順の正しい位置へ挿入する。
  // 配列の並び＝タイムラインの縦位置＝重なり順（前にあるほど前面）なので、
  // 番号を無視して挿入すると「番号が大きいほど前面」という前提が壊れる。
  // 映像は番号の降順（V3,V2,V1）、音声は昇順（A1,A2,A3）で並べる。
  function insertTrackOrdered(list: Track[], tr: Track): Track[] {
    const n = trackNum(tr.id)
    const next = [...list]
    if (tr.kind === 'video') {
      const at = next.findIndex((t) => t.kind === 'video' && trackNum(t.id) < n)
      next.splice(at >= 0 ? at : next.findIndex((t) => t.kind === 'audio'), 0, tr)
    } else {
      let at = -1
      next.forEach((t, i) => {
        if (t.kind === 'audio' && trackNum(t.id) < n) at = i
      })
      next.splice(at >= 0 ? at + 1 : next.length, 0, tr)
    }
    return next
  }
  /**
   * 動画を置くレーンを空ける。
   *
   * そのレーンに何か（テロップ/画像/映像レイヤー）が載っていたら、そのレーン以上を
   * まとめて1つ上へずらす。V2 に置くなら V2 の中身は V3 へ、V3 に何かあれば V4 へ、
   * という形で全部そのまま繰り上がる。番号と縦位置の対応（大きいほど前面）も保たれる。
   *
   * 音声側も同じ番号だけずらす。V{n} と A{n} は対で扱う決まりなので、映像だけ
   * ずらすと対応が崩れて、映像レイヤーの音が別のトラックに残ってしまう。
   *
   * 戻り値は動画を置くレーン（＝引数のまま。空けたので番号は変わらない）。
   */
  function reserveTrackPairForVideo(vTrack: string): string {
    const n = trackNum(vTrack)
    const aTrack = 'A' + n
    const occupied =
      cuesRef.current.some((c) => cueTrack(c) === vTrack) ||
      imgClipsRef.current.some((c) => c.track === vTrack) ||
      vClipsRef.current.some((c) => c.track === vTrack)
    const seOccupied = seClipsRef.current.some((c) => c.track === aTrack)

    if (occupied || seOccupied) {
      // n 以上のレーンを1つ上へ。上から順に動かさないと番号がぶつかる。
      const bump = (id: string): string => {
        const k = trackNum(id)
        return k >= n ? id[0] + (k + 1) : id
      }
      setCues((prev) => prev.map((c) => ({ ...c, track: bump(cueTrack(c)) })))
      setImgClips((prev) => prev.map((c) => ({ ...c, track: bump(c.track) })))
      setVClips((prev) => prev.map((c) => ({ ...c, track: bump(c.track) })))
      setSeClips((prev) => prev.map((c) => ({ ...c, track: bump(c.track) })))
      // 受け皿のトラックを1本ずつ足す（映像・音声とも）
      setTracks((prev) => {
        let next = [...prev]
        const vMax = Math.max(
          0,
          ...next.filter((t) => t.kind === 'video').map((t) => trackNum(t.id))
        )
        const aMax = Math.max(
          0,
          ...next.filter((t) => t.kind === 'audio').map((t) => trackNum(t.id))
        )
        const vNew = 'V' + (vMax + 1)
        const aNew = 'A' + (aMax + 1)
        if (!next.some((t) => t.id === vNew))
          next = insertTrackOrdered(next, { id: vNew, name: vNew, kind: 'video' })
        if (!next.some((t) => t.id === aNew))
          next = insertTrackOrdered(next, { id: aNew, name: aNew, kind: 'audio' })
        return next
      })
      // トラックの状態（ロック等）も一緒にずらす
      setTrackStates((prev) => {
        const next: Record<string, TrackState> = {}
        for (const [id, st] of Object.entries(prev)) next[bump(id)] = st
        return next
      })
      // ずらしたあと、状態が抜けたトラックを埋める。作り忘れると
      // トラックヘッダーの描画で落ちて画面全体が真っ黒になる。
      // 直後は tracks の state がまだ古いので、番号から作り直して補う。
      setTrackStates((prev) => {
        const next = { ...prev }
        const vMax = Math.max(0, ...Object.keys(next).filter((k) => k[0] === 'V').map(trackNum))
        const aMax = Math.max(0, ...Object.keys(next).filter((k) => k[0] === 'A').map(trackNum))
        for (let k = 1; k <= vMax + 1; k++)
          if (!next['V' + k]) next['V' + k] = newTrackState('V' + k)
        for (let k = 1; k <= aMax + 1; k++)
          if (!next['A' + k]) next['A' + k] = newTrackState('A' + k)
        return next
      })
      showToast(vTrack + ' に置くため、上のレーンを1つずつ繰り上げました。')
    }

    // 映像側のレーンが無ければ作る。無いとクリップがどこにも描かれず、選択も削除も
    // できないのにプレビューと書き出しには出る（置いたのに消えたように見える）。
    setTracks((prev) =>
      prev.some((t) => t.id === vTrack)
        ? prev
        : insertTrackOrdered(prev, { id: vTrack, name: vTrack, kind: 'video' })
    )
    setTrackStates((prev) => (prev[vTrack] ? prev : { ...prev, [vTrack]: newTrackState(vTrack) }))
    // 対の音声トラックが無ければ作る（無いと映像レイヤーの音が鳴らない）
    setTracks((prev) =>
      prev.some((t) => t.id === aTrack)
        ? prev
        : insertTrackOrdered(prev, { id: aTrack, name: aTrack, kind: 'audio' })
    )
    setTrackStates((prev) => (prev[aTrack] ? prev : { ...prev, [aTrack]: newTrackState(aTrack) }))
    return vTrack
  }

  // ---- 動画セグメント（切片編集）----
  // 動画と音声の選択は独立（クリックは片方、ドラッグは両方に掛かれば両方）
  // どのクリップにもラベルカラーを付けられる（以前はテロップだけの機能だった）。
  // 素材が増えると見分けが付かなくなるため、色で分類できるようにする。
  function setClipLabel(kind: string, id: number, color?: string): void {
    if (kind === 'seg')
      setSegments((prev) => prev.map((c) => (c.id === id ? { ...c, label: color } : c)))
    else if (kind === 'img')
      setImgClips((prev) => prev.map((c) => (c.id === id ? { ...c, label: color } : c)))
    else if (kind === 'se')
      setSeClips((prev) => prev.map((c) => (c.id === id ? { ...c, label: color } : c)))
    else if (kind === 'vclip')
      setVClips((prev) => prev.map((c) => (c.id === id ? { ...c, label: color } : c)))
  }

  // 映像トラックを1本追加（新しい番号を最上段へ）
  function addVideoTrack(): void {
    const nums = tracks.filter((t) => t.kind === 'video').map((t) => Number(t.id.slice(1)) || 0)
    const id = 'V' + (Math.max(0, ...nums) + 1)
    setTracks((prev) => [{ id, name: id, kind: 'video' }, ...prev])
    setTrackStates((s) => ({ ...s, [id]: newTrackState(id) }))
  }
  // 音声トラックを1本追加（新しい番号を最下段へ）
  function addAudioTrack(): void {
    const nums = tracks.filter((t) => t.kind === 'audio').map((t) => Number(t.id.slice(1)) || 0)
    const id = 'A' + (Math.max(0, ...nums) + 1)
    setTracks((prev) => [...prev, { id, name: id, kind: 'audio' }])
    setTrackStates((s) => ({ ...s, [id]: newTrackState(id) }))
  }
  // 選択中のトラック（ヘッダークリックで選択。Deleteショートカットで削除）
  // そのトラックに中身があるか（動画=切片, 音声=SE, テロップ=そのトラックのcue）
  function trackHasContent(id: string): boolean {
    if (id === 'V1' || id === 'A1') return segsRef.current.length > 0 // メイン動画/音声
    return trackHasContentInner(id)
  }
  // テロップの載っているトラックがロック中か（V2決め打ちではなく実トラックで判定。V3ロックも効く）
  function telopLocked(cue: Cue): boolean {
    return !!trackStates[cueTrack(cue)]?.locked
  }
  function trackHasContentInner(id: string): boolean {
    const tr = tracks.find((t) => t.id === id)
    // 音声行: SE/BGM か、映像レイヤーの音声（対の映像トラックにクリップがある）
    if (tr?.kind === 'audio')
      return (
        seClips.some((c) => c.track === id) ||
        vClips.some((c) => 'A' + trackNum(c.track) === id)
      )
    // 映像行: テロップ or 画像クリップが載っていれば中身あり
    return (
      cues.some((c) => cueTrack(c) === id) ||
      imgClips.some((c) => c.track === id) ||
      vClips.some((c) => c.track === id)
    )
  }
  // 削除可能か（メイン動画/音声は不可、各種別で最低1本は残す、中身のある行は不可）
  function canDeleteTrack(id: string): boolean {
    // V1/A1(本体)に加えて V2/A2 も残す。これらは新規テロップ・SEの既定の置き場所なので、
    // 消えると `cueTrack` の既定 'V2' / `placeSE` の既定 'A2' が存在しないトラックを指し、
    // タイムラインに出ないのに書き出しには焼かれる「孤児クリップ」が生まれる。
    if (id === 'V1' || id === 'A1' || id === 'V2' || id === 'A2') return false
    const tr = tracks.find((t) => t.id === id)
    if (!tr) return false
    if (tr.kind === 'video' && nVideoTracks <= 1) return false
    if (tr.kind === 'audio' && nAudioTracks <= 1) return false
    return !trackHasContent(id)
  }
  function deleteTrack(id: string): void {
    if (!canDeleteTrack(id)) {
      if (id === 'V1' || id === 'A1' || id === 'V2' || id === 'A2')
        showToast('このトラックは既定の置き場所なので削除できません。')
      else if (trackHasContent(id))
        showToast('中身のあるトラックは削除できません。先にクリップを消してください。')
      return
    }
    setTracks((prev) => prev.filter((t) => t.id !== id))
    setTrackStates((s) => {
      const n = { ...s }
      delete n[id]
      return n
    })
    setSelectedTrackId(null)
  }
  function selectTrack(id: string): void {
    setSelectedTrackId(id)
    setSelectedIds([]) // クリップ選択は解除（削除対象をトラックに一本化）
    clearSegSel()
  }

  function audioTrackGain(id: string): number {
    const st = trackStates[id]
    // **状態が無い＝「既定」であって「消音」ではない。**
    // 無い物を消音として扱っていたため、復元したプロジェクトで
    // そのトラックの状態が入っていないと SE が1つも鳴らなかった。
    // 音は「鳴らない」方に倒すと気づきにくいので、無ければ普通に鳴らす。
    if (st?.muted) return 0
    if (anyAudioSolo && !st?.solo) return 0
    return clamp((st?.volume ?? 1) * masterVolume, 0, 1)
  }
  function setTrackVolume(id: string, v: number): void {
    const vol = clamp(v, 0, 1)
    setTrackStates((s) => ({ ...s, [id]: { ...s[id], volume: vol } }))
  }
  // 縦フェーダーのドラッグ（上=1.0 / 下=0）。apply には 0..1 の値が渡る
  function startFader(e: React.PointerEvent, apply: (f: number) => void): void {
    e.preventDefault()
    e.stopPropagation()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const set = (cy: number): void => apply(clamp(1 - (cy - rect.top) / rect.height, 0, 1))
    set(e.clientY)
    const mv = (ev: PointerEvent): void => set(ev.clientY)
    const up = (): void => {
      window.removeEventListener('pointermove', mv)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
    window.addEventListener('pointermove', mv)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }
  /**
   * 段見出しの**境目を掴んで**高さを変える（プレミアと同じ操作）。
   * 映像の境目なら映像レーン全体、音声なら音声レーン全体がまとめて変わる。
   *
   * @param above 掴んだ境目より上に、同じ種類の段がいくつあるか（1から数える）
   *
   * 掴んだ線をカーソルに追従させるには、**その線より上にある段の数**で割る。
   * 線の位置は「上にある段の高さの合計」で決まるので、1px 動かしたければ
   * 1段あたり 1/n px 変える必要がある。
   * 映像側は上の余白（TRACK_PAD_ROWS 段ぶん）も段の高さで伸び縮みするため、
   * その分も数に入れる。ここを間違えると、掴んだ場所から線がじわじわ離れていく。
   */
  function startGroupResize(
    kind: 'video' | 'audio',
    above: number,
    e: React.PointerEvent,
    trackId?: string
  ): void {
    e.preventDefault()
    e.stopPropagation()
    const startY = e.clientY
    // **掴んだ段だけ動かす。**
    // まとめて変える作りだと、波形を1本だけ見たいときにも他の段まで太り、
    // 画面が足りなくなる。掴んだ線の下にある段はそのまま押し下がる。
    if (trackId) {
      const startOwn = trackHOf(trackId)
      const prevCur = document.body.style.cursor
      document.body.style.cursor = 'row-resize'
      const mv = (ev: PointerEvent): void => {
        const h = clamp(startOwn + (ev.clientY - startY), TRACK_H_MIN, TRACK_H_MAX)
        setLaneH((p) => ({ ...p, [trackId]: h }))
      }
      const up = (): void => {
        document.body.style.cursor = prevCur
        window.removeEventListener('pointermove', mv)
        window.removeEventListener('pointerup', up)
        window.removeEventListener('pointercancel', up)
      }
      window.addEventListener('pointermove', mv)
      window.addEventListener('pointerup', up)
      window.addEventListener('pointercancel', up)
      return
    }
    const startH = kind === 'video' ? videoTrackHRef.current : audioTrackHRef.current
    const rows = Math.max(1, kind === 'video' ? above + TRACK_PAD_ROWS : above)
    const setter = kind === 'video' ? setVideoTrackH : setAudioTrackH
    // 掴んでいる間は、どこへ動かしても行を変える手のままにする
    // （途中で別のカーソルに化けると「外れた」ように見える）
    const prevCursor = document.body.style.cursor
    document.body.style.cursor = 'row-resize'
    const onMove = (ev: PointerEvent): void => {
      setter(clamp(startH + (ev.clientY - startY) / rows, TRACK_H_MIN, TRACK_H_MAX))
    }
    const onUp = (): void => {
      document.body.style.cursor = prevCursor
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  return {
    trackFromEvent, mainLocked, fallbackTrack, audioTrackFromEvent, insertTrackOrdered,
    reserveTrackPairForVideo, setClipLabel, addVideoTrack, addAudioTrack, trackHasContent,
    telopLocked, trackHasContentInner, canDeleteTrack, deleteTrack, selectTrack,
    audioTrackGain, setTrackVolume, startFader, startGroupResize
  }
}
