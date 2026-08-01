// プレビュー用に映像を焼き直す（プロキシ）。画質の選択もここ。
//
// ## なぜ焼き直すか
//
// 原本のまま再生すると、カットで飛ぶたびに復号が追いつかず引っかかる。
// **書き出しは常に原本のフル画質**なので、ここを下げても完成品の画質は落ちない。
//
// ## 画質は PC ごとの好み
//
// プロジェクトの中身ではないので localStorage に置く。別のPCで開いたら
// そのPCの設定で見る、が正しい。
import { useEffect, useRef, useState } from 'react'
import { toGcUrl } from '../lib/gcUrl'
import type { PreviewRes } from '../components/panels/PreviewBars'

export interface UseProxyDeps {
  loadLS: <T>(key: string, def: T) => T
  saveLS: (key: string, v: unknown) => void
  /** 再生中かどうかを「いまこの瞬間」で見る（0 = 止まっている） */
  playRateRef: { current: number }
  sources: { path?: string }[]
  vClips: { path?: string }[]
  /** いま「プレビュー最適化中」を出している原本のパス */
  proxyForPathRef: { current: string | null }
  setProxyPct: (v: number | null) => void
}

export function useProxy(deps: UseProxyDeps) {
  const { loadLS, saveLS, playRateRef, sources, vClips, proxyForPathRef, setProxyPct } = deps

  const [previewRes, setPreviewRes] = useState<PreviewRes>(() => {
    const v = loadLS<unknown>('giftcut.previewRes', 1080)
    // 前の版の 'orig'（原本）/'full'（原寸・軽い）は、どちらも 1080 にあたる。
    // **黙って 360 に落とさない**（次に開いたら低画質だった、が一番困る）
    if (v === 720 || v === '720') return 720
    if (v === 360 || v === '360') return 360
    return 1080
  })
  const previewResRef = useRef<PreviewRes>(previewRes)
  /** 直前に反映した画質。**自分で変えたのか、焼き上がりが届いただけなのか**を分ける */
  const lastPreviewResRef = useRef<PreviewRes>(previewRes)
  useEffect(() => {
    previewResRef.current = previewRes
    saveLS('giftcut.previewRes', previewRes)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewRes])

  // 焼き上がった物（原本パス → URL と画質）。重ねる動画も同じ映像を使うので、
  // ソース単位ではなく**パス単位**で持つ（1本の動画に対して1つ）。
  const [proxyMap, setProxyMap] = useState<Record<string, { url: string; res: number }>>({})
  const proxyReqRef = useRef<Set<string>>(new Set()) // 変換中。同じ物を二重に走らせない
  const proxyFailRef = useRef<Set<string>>(new Set()) // 失敗した物。無限に作り直さない
  const [proxyTick, setProxyTick] = useState(0) // 1本終わるたび、次を取りに行く合図

  /**
   * いま <video> に入れる URL。焼き上がっていればそれ、無ければ原本。
   *
   * **流している最中は差し替えない。**
   * src を書き換えると要素が読み込み直しになり、そこで**音が切れる**。
   * 焼き直しは再生中にも終わるので、何もしないと「流していたら急にプツッと鳴る」。
   * 実測（npm run stutter --fresh）で、抜けはいつも変換の完了時に出ていた。
   *
   * 止めた瞬間に入れ替わる。見ている間は原本のままだが、画質が少し眠いだけで、
   * 音が切れるより遥かにまし。**自分で画質を変えたときは、その場で入れ替える**
   * （待たされると「効いていない」と見えるため）。
   */
  const shownSrcRef = useRef<Map<string, string>>(new Map())
  const srcResRef = useRef<PreviewRes>(previewRes)
  const previewUrl = (path: string, orig: string): string => {
    const want = proxyMap[path]?.url ?? orig
    const shown = shownSrcRef.current.get(path)
    const byHand = srcResRef.current !== previewRes // 画質を自分で変えた回
    if (playRateRef.current !== 0 && !byHand && shown && shown !== want) return shown
    shownSrcRef.current.set(path, want)
    srcResRef.current = previewRes
    return want
  }

  // 焼き直しを始める唯一の入口。素材が増えたときや画質を変えたときに走り、
  // 足りない物だけ変換する。**同時に2本まで**（重ねる動画が多いと
  // ffmpeg が一斉に立ち上がって、編集そのものが重くなる）。
  useEffect(() => {
    const res: number = previewRes
    const paths = new Set<string>()
    for (const s of sources) if (s.path) paths.add(s.path)
    for (const c of vClips) if (c.path) paths.add(c.path)
    paths.forEach((p) => {
      if (proxyReqRef.current.size >= 2) return // 空きが出たら次の合図で続きを取る
      if (proxyMap[p]?.res === res) return
      const k = res + '|' + p
      if (proxyReqRef.current.has(k) || proxyFailRef.current.has(k)) return
      proxyReqRef.current.add(k)
      // 「プレビュー最適化中」の表示は主素材ぶんだけ（進捗の知らせも主素材で絞っている）
      if (p === proxyForPathRef.current) setProxyPct(0)
      void window.giftcut.generateProxy(p, res).then((r) => {
        // 終わったら必ず外す。残したままだと画質を素早く往復させたときに
        // 「変換中だから作らない」と判定され、**選んだ画質に戻れなくなる**。
        proxyReqRef.current.delete(k)
        const rp = r?.ok ? r.path : undefined
        if (rp) setProxyMap((m) => ({ ...m, [p]: { url: toGcUrl(rp), res } }))
        else {
          proxyFailRef.current.add(k)
          if (r?.error) console.warn('プロキシ生成失敗:', r.error) // 失敗しても原本で映る
        }
        if (p === proxyForPathRef.current) setProxyPct(null)
        setProxyTick((t) => t + 1)
      })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewRes, sources, vClips, proxyMap, proxyTick])

  return { previewRes, setPreviewRes, previewResRef, lastPreviewResRef, proxyMap, previewUrl }
}
