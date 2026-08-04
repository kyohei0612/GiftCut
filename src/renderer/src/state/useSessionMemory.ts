// 作業位置を覚えておく。閉じても・落ちても、見ていた場所から始められるようにする。
//
// 覚えるのは**いま見ている場所**（選択・タブ・拡大率・再生位置・横スクロール）。
// localStorage に置く。軽いので頻繁に書いてよい。
//
// ## 空で上書きしない
//
// 起動直後は「選択なし・タブは素材・拡大率は既定」の状態から始まる。
// そのまま書くと、**前回覚えた物を空で潰す**。読み終わるまで書かない。
//
// ## 再生位置は2秒ごと
//
// 毎フレーム書くと、再生しているだけで localStorage を秒60回叩くことになる。
// 続きから始めるのに1秒2秒の差は問題にならない。
//
// ## 2026-08-03 に2つ出した
//
// 頭のコメントが「覚える物は2種類ある（セッション／下書き）」と宣言していたが、
// 実体は4つあった。**宣言に無かった2つ**を出して、ここは1つの話題にした:
//
//   ./useHistoryCoalesce … 編集が落ち着いたら履歴を1つ積む（undo の話）
//   ./useAutosaveDraft   … 下書きをファイルに書く／起動と ✕ のときに聞く
//
// **呼ぶ順は変えないこと。** `useAppWiring` で
// 「ここ → useHistoryCoalesce → useAutosaveDraft」の順に呼ぶ。
// ここの保存は「1つ前の描画の ref」を見て中身があるか判断しているので、
// 写し取り（useHistoryCoalesce）を先に呼ぶと**起動直後に空で上書きしうる**。

import { useEffect, useRef } from 'react'
import { useDoc } from './contentContext'
import { useSel } from './selectionContext'
import { useViewCtx } from './viewContext'
import { clampZoom } from './useView'
import { usePlaybackCtx } from './playbackContext'
import { useAppChromeCtx } from './appChromeContext'
import { useHistoryCtx } from './historyContext'
import { useLibraryCtx } from './libraryContext'
import { useTemplateShelfCtx } from './templateShelfContext'
import { useTimelineBoxCtx } from './timelineBoxContext'
import type { RightTab } from './useAppLayout'
import type { TelopTemplate } from '../lib/telopTemplates'

export interface UseSessionMemoryDeps {
  setTime: (t: number) => void
  /** 横スクロールと、右パネルの中身 */
  scrollRef: React.RefObject<HTMLDivElement>
  rightBodyRef: React.RefObject<HTMLDivElement>
  rightTab: string
  setRightTab: React.Dispatch<React.SetStateAction<RightTab>>
  /** 右パネルの一覧の件数（増えてから位置を戻す） */
  localTemplates: TelopTemplate[]
}

/**
 * この起動で「見ていた場所」（拡大率・横位置）を戻したか。
 *
 * **戻したなら、素材を読んだ直後の「全体表示」をやってはいけない。**
 * 全体表示は拡大率を書き換えて横位置を0へ戻すので、戻したばかりの場所が消える。
 * 一方で**再生ヘッドは別口で戻る**ので、
 * 「再生ヘッドは32秒、タイムラインは先頭」という食い違いだけが残る。
 * その状態だと、32秒に置いた画像はプレビューに出るのにタイムラインには
 * 帯が出ない（見えている範囲の帯しか作らないため）＝本人から上がった
 * 「タイムラインから消えている画像が、プレビューには出る」の正体。
 */
let restoredView = false

/**
 * 1回だけ答える（聞いたら降ろす）。
 *
 * **降ろさないと、あとから別の動画を開いたときも全体表示にならない。**
 * 抑えたいのは「戻した直後の1回」だけで、全体表示そのものは要る機能
 *（既定の拡大率のままだと15秒の素材が左端の小さな塊に見える）。
 */
export function takeRestoredView(): boolean {
  const v = restoredView
  restoredView = false
  return v
}

export function useSessionMemory(): void {
  // **要る6個は心臓から自分で取る**（2026-08-04。配線はただの素通しだった）
  const { setTime } = useHistoryCtx()
  const { scrollRef } = useTimelineBoxCtx()
  const { rightBodyRef } = useTemplateShelfCtx()
  const { rightTab, setRightTab } = useAppChromeCtx()
  const { localTemplates } = useLibraryCtx()
  // 読み終わるまで待たせてある「前回の続き」。**読み終わるまで書かない**ための札で、
  // 外からは触らないのでここで持つ（App に置くと、渡すだけの行が増える）
  const pendingSelRef = useRef<number[] | null>(null)
  const pendingTimeRef = useRef<number | null>(null)
  const pendingEditRef = useRef<number | null>(null)
  /** 右パネルの縦スクロール。一覧が伸びて届く高さになってから戻す */
  const pendingRsxRef = useRef<number | null>(null)
  /**
   * タイムラインの横スクロール。**中身が伸びて届く幅になってから戻す。**
   *
   * 前は起動直後に1回だけ `scrollLeft = sx` と書いていた。その時点では
   * 動画もクリップもまだ読めておらず中身の幅がほぼ0なので、**ブラウザが
   * 黙って0へ丸める**（例外も出ない）。一方で再生ヘッドは読み終わってから
   * 戻すので、**「再生ヘッドは32秒、タイムラインは先頭」**という食い違いが残った。
   *
   * この状態だと、32秒に置いた画像はプレビューには出るのに、
   * タイムラインには帯が出ない（見えている範囲の帯しか作らないため）＝
   * **「タイムラインから消えている画像が、プレビューには出る」**の正体。
   *
   * 右パネルの縦スクロール（pendingRsx）で既に同じ穴を踏んで、
   * 「届く高さになってから」に直してある。横も同じ扱いにする。
   */
  const pendingSxRef = useRef<number | null>(null)
  const { cues, cuesRef, segsRef, seClipsRef } = useDoc()
  const { selectedIds, setSelectedIds, editingId, setEditingId } = useSel()
  const { zoom, setZoom } = useViewCtx()
  const { currentTimeRef } = usePlaybackCtx()

  // ===== セッション状態の保存/復元（再起動・リロードしても作業位置を維持）=====
  // 選択テロップ・タイムラインのスクロール/ズーム・再生ヘッド・開いてる右タブを覚える。
  // プロジェクト(cues)未読込のマウント/StrictMode二重マウント時は保存しない。
  // ＝既定値(選択なし・tab=project・zoom既定)で保存済みセッションを上書きするのを防ぐ。
  useEffect(() => {
    // テロップが無いプロジェクト（カット編集だけ）でも記憶する
    if (!cuesRef.current.length && !segsRef.current.length && !seClipsRef.current.length) return
    try {
      localStorage.setItem(
        'giftcut.session',
        JSON.stringify({
          // タイムライン
          zoom,
          t: currentTimeRef.current,
          sx: scrollRef.current?.scrollLeft ?? 0,
          // 左プロパティ（選択テロップ・編集中テロップ）
          sel: selectedIds,
          edit: editingId,
          // 右タブ＋そのスクロール位置
          tab: rightTab,
          rsx: rightBodyRef.current?.scrollTop ?? 0
        })
      )
    } catch {
      /* localStorage不可なら無視 */
    }
    // ※currentTime は依存に入れない（再生中に毎フレーム同期書き込みが走りジャンクの原因になる）。
    //   再生位置 t は下の2秒間隔タイマーで保存する。
  }, [zoom, selectedIds, rightTab, editingId])

  // 再生位置 t は2秒ごとに保存（再生中の毎フレーム localStorage 書き込みを避ける）
  useEffect(() => {
    const iv = window.setInterval(() => {
      if (!cuesRef.current.length && !segsRef.current.length) return
      try {
        const cur = JSON.parse(localStorage.getItem('giftcut.session') || '{}')
        if (Math.abs((cur.t ?? -1) - currentTimeRef.current) < 0.5) return
        cur.t = currentTimeRef.current
        localStorage.setItem('giftcut.session', JSON.stringify(cur))
      } catch {
        /* 無視 */
      }
    }, 2000)
    return () => window.clearInterval(iv)
  }, [])

  // スクロールだけの変化も sx を保存（他フィールドは維持）
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    let raf = 0
    const onScroll = (): void => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        try {
          const cur = JSON.parse(localStorage.getItem('giftcut.session') || '{}')
          cur.sx = el.scrollLeft
          localStorage.setItem('giftcut.session', JSON.stringify(cur))
        } catch {
          /* 無視 */
        }
      })
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  // cues が読み込まれたら保留していた 選択/編集中/再生位置 を適用（プロジェクト復元後に効かせる）
  useEffect(() => {
    if (!cues.length) return
    if (pendingSelRef.current) {
      const ids = pendingSelRef.current.filter((id: number) => cues.some((c) => c.id === id))
      pendingSelRef.current = null
      if (ids.length) setSelectedIds(ids)
    }
    if (pendingEditRef.current != null) {
      const id = pendingEditRef.current
      pendingEditRef.current = null
      if (cues.some((c) => c.id === id)) setEditingId(id)
    }
    if (pendingTimeRef.current != null) {
      const t = pendingTimeRef.current
      pendingTimeRef.current = null
      setTime(t)
    }
  }, [cues])

  useEffect(() => {
    try {
      const raw = localStorage.getItem('giftcut.session')
      if (!raw) return
      const s = JSON.parse(raw)
      // 保存してある拡大率は範囲へ収めてから使う（0 や NaN で中身が消えるのを防ぐ）
      if (s.zoom != null) setZoom(clampZoom(s.zoom))
      if (typeof s.t === 'number') pendingTimeRef.current = s.t
      if (Array.isArray(s.sel)) pendingSelRef.current = s.sel
      if (typeof s.edit === 'number') pendingEditRef.current = s.edit
      if (typeof s.rsx === 'number') pendingRsxRef.current = s.rsx
      if (typeof s.tab === 'string') setRightTab(s.tab)
      // **ここでは書かない。** まだ中身の幅が無いので0へ丸められる（上の説明）。
      // 届く幅になるのを見張って、なってから戻す。
      //
      // **この見張りは、保留に入れたあとで始めること。** 別の効果に分けて上に
      // 置いていたら、効果は宣言順に走るので**保留がまだ空のうちに1回見て終わって**
      // いた（e2e が `7613 → 0` で捕まえた）。
      if (typeof s.zoom === 'number' || typeof s.sx === 'number') restoredView = true
      if (typeof s.sx === 'number') {
        pendingSxRef.current = s.sx
        // 幅が育つのはクリップを読み終えてから。それが何コマ後かは素材次第で、
        // 読み終わりを知らせてくれる物が無いので見張る。届いたら即やめる。
        // 5秒経っても届かないなら諦める——前より短いタイムライン（クリップを
        // 消して保存した）だと永遠に届かないので、張り付かせたままにしない。
        let left = Math.round(5000 / 16)
        const tick = (): void => {
          const el = scrollRef.current
          const sx = pendingSxRef.current
          if (sx == null) return
          if (el && el.scrollWidth - el.clientWidth >= sx - 1) {
            el.scrollLeft = sx
            pendingSxRef.current = null
            return
          }
          if (left-- <= 0) {
            pendingSxRef.current = null
            return
          }
          requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      }
    } catch {
      /* 無視 */
    }
  }, [])

  // 右パネル（テロップ一覧等）の縦スクロール位置を保存/復元。タブ切替やリスト読込で panel-body が
  // 変わるので rightTab/一覧件数で張り直す。内容が伸びてスクロール可能になってから復元を適用。
  useEffect(() => {
    const el = rightBodyRef.current
    if (!el) return
    // 目標スクロール位置まで届く高さになってから適用（一覧が読込中だと届かないので pending を保持）。
    const applyPending = (): void => {
      if (pendingRsxRef.current == null) return
      if (el.scrollHeight - el.clientHeight >= pendingRsxRef.current - 1) {
        el.scrollTop = pendingRsxRef.current
        pendingRsxRef.current = null
      }
    }
    applyPending()
    requestAnimationFrame(applyPending) // レイアウト確定後にもう一度
    let raf = 0
    const onScroll = (): void => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        try {
          const cur = JSON.parse(localStorage.getItem('giftcut.session') || '{}')
          cur.rsx = el.scrollTop
          localStorage.setItem('giftcut.session', JSON.stringify(cur))
        } catch {
          /* 無視 */
        }
      })
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [rightTab, localTemplates.length])
}
