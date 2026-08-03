// 下書き（自動保存）と、未保存のときに聞くこと。
//
// ## 落ちても・閉じても、続きから始められるように
//
// 中身そのものをファイルに書く。重いので落ち着いてから、一定の間隔で。
//
// ## 閉じる前に必ず流し込む
//
// 間隔タイマーだけだと、閉じた瞬間に**最大その間隔ぶんの編集が無警告で消える**。
// 閉じる直前には待たずに1回書く。
//
// ## ✕ を押したときは、こちらが聞く
//
// メイン側は閉じるのを止めてここへ聞きに来る。アプリ内で答えて、
// 了承なら `confirmClose` で閉じ直してもらう
// （Electron のまま止めると、無言で閉じられなくなる）。
//
// ## 呼ぶ順を変えない
//
// 元は `useSessionMemory` の中にあり、**セッション保存 → 履歴 → ここ**の順で
// 走っていた。`useAppWiring` ではこの順を保つこと（2026-08-03 に分けた）。
import { AUTOSAVE_MS } from '../lib/appConst'
import { useEffect } from 'react'
import { useToastCtx } from './toastContext'

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface UseAutosaveDraftDeps {
  /** 下書きを書く */
  writeAutosave: (json: string) => Promise<void>
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
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function useAutosaveDraft(deps: UseAutosaveDraftDeps): void {
  const {
    writeAutosave, currentJsonRef, projectRevRef, autosavedRevRef, lastAutosaveRef,
    hasContentRef, applyProjectData, askConfirm, setRestorePrompt, setTemplatePicker
  } = deps
  const { showToast } = useToastCtx()

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
}
