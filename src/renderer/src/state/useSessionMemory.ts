// 作業位置と下書きを覚えておく。閉じても・落ちても、続きから始められるようにする。
//
// ## 覚える物は2種類ある
//
//   セッション … いま見ている場所（選択・タブ・拡大率・再生位置・横スクロール）。
//                localStorage に置く。軽いので頻繁に書いてよい
//   下書き    … 中身そのもの（自動保存）。ファイルに書く。重いので落ち着いてから
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
// ## 閉じる前に必ず流し込む
//
// 落ち着いてから書く作りなので、閉じる直前には**待たずに1回書く**。
// これが無いと「最後の数秒の操作だけ消える」になる。

import { AUTOSAVE_MS } from '../lib/appConst'
import { useEffect, useRef } from 'react'
import { useDoc } from './contentContext'
import { useSel } from './selectionContext'
import { useTracksCtx } from './tracksContext'
import { useToastCtx } from './toastContext'
import { useViewCtx } from './viewContext'
import { clampZoom } from './useView'
import { usePlaybackCtx } from './playbackContext'
import { useExportCtx } from './exportContext'

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface UseSessionMemoryDeps {
  /** 下書き（自動保存）を、変更が落ち着いてから何ms後に書くか */  writeAutosave: (json: string) => Promise<void>
  /** いまの中身を文字列にした物と、その版 */
  currentJsonRef: any
  projectRevRef: any
  autosavedRevRef: any
  lastAutosaveRef: any
  /** 中身が入っているか（空なら復元を聞かない） */
  hasContentRef: any
  /** 読み込んだ下書きをタイムラインへ流し込む */
  applyProjectData: any
  askConfirm: any
  setRestorePrompt: any
  setTemplatePicker: any
  /** 履歴（変更が落ち着いたら1つ積む） */
  isDirty: () => boolean
  snapNow: any
  pushUndo: any
  baselineRef: any
  pendingTimerRef: any
  suppressHistoryRef: any
  redoStackRef: any
  setHistTick: any
  setTime: (t: number) => void
  /** 横スクロールと、右パネルの中身 */
  scrollRef: React.RefObject<HTMLDivElement>
  rightBodyRef: any
  rightTab: string
  /** 画面比。履歴の写しに入れる */
  ratioRef: React.MutableRefObject<string>
  /** 右パネルの一覧の件数（増えてから位置を戻す） */
  localTemplates: any
  setRightTab: any
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function useSessionMemory(deps: UseSessionMemoryDeps): void {
  const {
    writeAutosave, currentJsonRef, projectRevRef, autosavedRevRef,
    lastAutosaveRef, hasContentRef, applyProjectData, askConfirm, setRestorePrompt,
    setTemplatePicker, isDirty, snapNow, pushUndo, baselineRef, pendingTimerRef,
    suppressHistoryRef, redoStackRef, setHistTick, setTime,
    scrollRef, rightBodyRef, rightTab, setRightTab, ratioRef, localTemplates
  } = deps
  // 読み終わるまで待たせてある「前回の続き」。**読み終わるまで書かない**ための札で、
  // 外からは触らないのでここで持つ（App に置くと、渡すだけの行が増える）
  const pendingSelRef = useRef<number[] | null>(null)
  const pendingTimeRef = useRef<number | null>(null)
  const pendingEditRef = useRef<number | null>(null)
  /** 右パネルの縦スクロール。一覧が伸びて届く高さになってから戻す */
  const pendingRsxRef = useRef<number | null>(null)
  const {
    cues, cuesRef, segments, segsRef, seClips, seClipsRef, imgClips, imgClipsRef,
    vClips, vClipsRef, markers, markersRef
  } = useDoc()
  const { selectedIds, setSelectedIds, editingId, setEditingId } = useSel()
  const { tracks, tracksRef, trackStates, trackStatesRef } = useTracksCtx()
  const { showToast } = useToastCtx()
  const { zoom, setZoom } = useViewCtx()
  const { currentTimeRef } = usePlaybackCtx()
  const { ratio } = useExportCtx()

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

  // cues / segments / seClips / markers / imgClips の変更を 450ms コアレスして1履歴にまとめる
  useEffect(() => {
    cuesRef.current = cues
    segsRef.current = segments
    seClipsRef.current = seClips
    markersRef.current = markers
    imgClipsRef.current = imgClips
    vClipsRef.current = vClips
    tracksRef.current = tracks
    trackStatesRef.current = trackStates
    ratioRef.current = ratio
    if (suppressHistoryRef.current) {
      suppressHistoryRef.current = false
      baselineRef.current = snapNow()
      return
    }
    if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current)
    pendingTimerRef.current = window.setTimeout(() => {
      pendingTimerRef.current = null
      if (isDirty()) {
        pushUndo(baselineRef.current)
        baselineRef.current = snapNow()
        redoStackRef.current = []
        setHistTick()
      }
    }, 450)
    return () => {
      if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current)
    }
  }, [cues, segments, seClips, markers, imgClips, vClips, tracks, trackStates, ratio])

  useEffect(() => {
    const id = window.setInterval(() => {
      if (!hasContentRef.current()) return
      if (projectRevRef.current === autosavedRevRef.current) return // 何も変わっていない
      autosavedRevRef.current = projectRevRef.current
      const json = currentJsonRef.current()
      if (json === lastAutosaveRef.current) return
      void writeAutosave(json)
    }, AUTOSAVE_MS)
    return () => window.clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 終了/リロード直前に、その時点の内容を自動保存へ流し込む。
  // （間隔タイマーだけだと、閉じた瞬間に最大その間隔ぶんの編集が無警告で消える）
  // ※ここでは閉じるのをキャンセルしない（Electronでは無言で閉じられなくなるため）。
  //   未保存の確認はメインプロセスのネイティブダイアログで行う（project:dirty を通知）。
  useEffect(() => {
    const onBeforeUnload = (): void => {
      if (!hasContentRef.current()) return
      const json = currentJsonRef.current()
      if (json !== lastAutosaveRef.current) {
        void writeAutosave(json) // 最後のフラッシュ
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  // 起動時: 自動保存があれば復元プロンプトを出す
  useEffect(() => {
    void window.giftcut?.autosaveCheck?.()?.then(async (r) => {
      if (r?.exists && r.data) {
        // 更新のために自分で落としたのなら、「復元しますか？」とは聞かない。
        // 勝手に閉じておいて開き直しを頼むのは筋が通らないので、黙って続きから開く。
        if (localStorage.getItem('giftcut.resumeAfterUpdate')) {
          localStorage.removeItem('giftcut.resumeAfterUpdate')
          await applyProjectData(r.data, !!r.videoExists, null)
          showToast('新しい GiftCut になりました。続きから開いています。')
          return
        }
        const when = (ms?: number): string | undefined =>
          ms ? new Date(ms).toLocaleString('ja-JP', { dateStyle: 'short', timeStyle: 'short' }) : undefined
        setRestorePrompt({
          data: r.data,
          videoExists: !!r.videoExists,
          savedAt: when(r.mtime),
          onlyPrev: !!r.onlyPrev,
          prev: r.prev
            ? { data: r.prev.data, videoExists: !!r.prev.videoExists, savedAt: when(r.prev.mtime) }
            : undefined
        })
        return
      }
      // 自動保存の復元が無い時だけ、テンプレート選択を出す（あれば）
      const t = await window.giftcut?.listTemplates?.()
      if (t?.ok && t.items.length) setTemplatePicker({ items: t.items, startup: true })
    })
  }, [])

  // ✕ で閉じようとしたときの確認。メイン側は閉じるのを止めてここへ聞きに来るので、
  // アプリ内のモーダルで答えて、了承なら confirmClose で閉じ直してもらう。
  useEffect(() => {
    if (!window.giftcut?.onCloseRequest) return
    return window.giftcut.onCloseRequest(() => {
      void askConfirm({
        title: '保存していない変更があります',
        body: '閉じると、最後の保存以降の変更は自動保存の下書きにだけ残ります。次回の起動時に復元できます。',
        okLabel: '保存せずに閉じる',
        cancelLabel: '閉じない',
        danger: true
      }).then((ok: boolean) => {
        if (ok) window.giftcut.confirmClose()
      })
    })
  }, [])
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
      if (typeof s.sx === 'number')
        requestAnimationFrame(() => {
          if (scrollRef.current) scrollRef.current.scrollLeft = s.sx
        })
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
