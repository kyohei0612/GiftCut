// 未保存の「＊」と、クラッシュ用の下書きの土台。
//
// ## 「＊」は何と比べて決めるか
//
// **最後に保存した中身と、いまの中身を直接比べる。**
// 以前は Undo 履歴の基準（isDirty）を見ていたが、あれは編集の 450ms 後に
// false へ戻る。つまり未保存でも「＊」が消えていた。
// 「＊が無い＝保存済み」と思って閉じると編集が飛ぶ、という一番まずい形になる。
//
// ## なぜ「変わったときだけ」見直すか
//
// 以前は 0.8 秒ごとに総当たりで比べていた。それだと何も編集していない間も、
// 再生しているだけの間も、**プロジェクト全体を文字列にし続ける**（長い素材ほど効く）。
// いまは中身が変わったときだけ、編集が止まってから 300ms 後に1回。
//
// 見張る値は projectJson が読んでいる物ぜんぶ。**足し忘れると「＊」が出ない。**
// 人が気づけないので App.behavior.test.tsx に見張りを置いてある。
// 万一書き漏らしても、閉じるときの確認はその場で比べ直すので編集が黙って消える
// ことはない（「＊」が遅れるだけ）。
import { useEffect, useRef, useState } from 'react'
import { useDoc } from './contentContext'
import { useTracksCtx } from './tracksContext'
import { useMediaCtx } from './mediaContext'
import { useExportCtx } from './exportContext'
import { useIconsCtx } from './iconsContext'
import { useProjectStateCtx } from './projectStateContext'
import type { RestoreState } from '../components/dialogs/ProjectDialogs'

export interface UseAutosaveMarkDeps {
  /** 置いてある物が1つでもあるか（空なら「＊」は出さない） */
  hasProjectContent: () => boolean
  setUnsaved: (v: boolean) => void
  /** 画面の配置も保存の中身。変わったら「＊」が出る */
  layout: unknown[]
}

export function useAutosaveMark(deps: UseAutosaveMarkDeps) {
  const { hasProjectContent, setUnsaved, layout } = deps
  const { cues, segments, seClips, imgClips, vClips, markers } = useDoc()
  const { tracks, trackStates } = useTracksCtx()
  const { videoPath, sources, mediaItems } = useMediaCtx()
  const { ratio, exportOpts, loudnormLUFS, masterVolume } = useExportCtx()
  const { iconSide, iconOffset, iconScale, iconAuto, iconAnchorPos } = useIconsCtx()
  const {
    projectPath, srtPath, missingMedia, newTelopStyle, transDur, iconAssign, laneIconAssign
  } = useProjectStateCtx()

  /** 前回 下書きに書いた中身（変わったときだけ書き込む） */
  const lastAutosaveRef = useRef('')
  /** 最後に「保存済み」となった中身。閉じるときの確認はこれと比べる */
  const savedJsonRef = useRef<string | null>(null)
  const [restorePrompt, setRestorePrompt] = useState<RestoreState | null>(null)

  /**
   * プロジェクトを文字列にする関数の置き場。
   *
   * **中身を作る側（useProjectFile）より先に、器だけ作る。**
   * 器を後から作ると、器を欲しがる側と作る側が互いを待つ形になって組み立てられない。
   */
  const projectJsonRef = useRef<(p?: string | null) => string>(() => '')
  const hasContentRef = useRef(hasProjectContent)
  hasContentRef.current = hasProjectContent

  /**
   * いまの中身の文字列。**1回の描き直しにつき1回だけ作る。**
   *
   * 全体を文字列にするのは重い（クリップ・テロップが増えるほど）。
   * 「保存済みと同じか」と「下書きに書くか」は同じ文字列を使うので使い回す。
   *
   * 使い回してよい根拠: 中身はすべて React の state なので、変われば必ず
   * 描き直され、作る関数そのものが作り直される。**関数が同じなら中身も同じ。**
   */
  const jsonCacheRef = useRef<{ fn: (p?: string | null) => string; json: string } | null>(null)
  const currentJson = (): string => {
    const fn = projectJsonRef.current
    const hit = jsonCacheRef.current
    if (hit && hit.fn === fn) return hit.json
    const json = fn()
    jsonCacheRef.current = { fn, json }
    return json
  }
  const currentJsonRef = useRef(currentJson)
  currentJsonRef.current = currentJson

  /**
   * 未保存かどうかを見直す。画面のタイトルの「＊」と、閉じるときの確認に使う。
   *
   * @param nowJson 保存直後など「いまの中身」が手元にあるときに渡す。渡さないと
   *   まだ描き直される前の古い中身と比べてしまい、「＊」が一瞬ちらつく。
   */
  const lastDirtySentRef = useRef<boolean | null>(null)
  const markUnsaved = (nowJson?: string): void => {
    try {
      const cur = nowJson ?? currentJsonRef.current()
      const dirty = hasContentRef.current() ? savedJsonRef.current !== cur : false
      setUnsaved(dirty)
      // 同じ値を送り続けない（以前は0.8秒ごとに毎回 IPC を投げていた）
      if (dirty !== lastDirtySentRef.current) {
        lastDirtySentRef.current = dirty
        window.giftcut?.setDirty?.(dirty)
      }
    } catch {
      /* 見直せなくても編集は続けられる */
    }
  }
  const markUnsavedRef = useRef(markUnsaved)
  markUnsavedRef.current = markUnsaved

  const projectRevRef = useRef(0)
  useEffect(() => {
    projectRevRef.current += 1
    const id = window.setTimeout(() => markUnsavedRef.current(), 300)
    return () => window.clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    videoPath,
    missingMedia,
    srtPath,
    sources,
    ratio,
    tracks,
    cues,
    segments,
    seClips,
    markers,
    imgClips,
    vClips,
    trackStates,
    mediaItems,
    iconSide,
    iconOffset,
    iconScale,
    iconAuto,
    iconAnchorPos,
    iconAssign,
    laneIconAssign,
    exportOpts,
    loudnormLUFS,
    masterVolume,
    transDur,
    newTelopStyle,
    projectPath,
    // 画面の配置（どのパネルを出しているか・幅・高さ・タブの並び）も保存の中身
    ...layout
  ])

  // 下書き（落ちたときの備え）。実際に書くのは state/useProjectIO の writeAutosave。
  // 中身が変わっていなければ文字列にすらしない＝待機中・再生中はゼロ。
  const autosavedRevRef = useRef(-1)
  const autosaveNgRef = useRef(false)
  const [autosaveNg, setAutosaveNg] = useState(false)

  return {
    lastAutosaveRef,
    hasContentRef,
    savedJsonRef,
    restorePrompt,
    setRestorePrompt,
    projectJsonRef,
    currentJson,
    currentJsonRef,
    markUnsaved,
    markUnsavedRef,
    projectRevRef,
    autosavedRevRef,
    autosaveNgRef,
    autosaveNg,
    setAutosaveNg
  }
}
