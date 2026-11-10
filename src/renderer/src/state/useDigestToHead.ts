// 選んだ本編の**写しを先頭に並べる**（ダイジェスト）。本編の切片の右クリックから呼ぶ。
//
// ## 何をするか
//
// 選んだ切片の写しを、元の時刻が早い順に 0 秒から隙間なく並べ、**元の中身は全部
// その長さだけ後ろへ送る**。上に載っているテロップ・効果音・画像・映像レイヤーも
// 一緒に写す。どこへ置くか・何を写すかの決まりは shared/digest の頭にある。
//
// ## 囲いにも配線にも入れない（品書きが自分で呼ぶ葉）
//
// 状態を持たず、呼ばれたときに心臓を読んで書くだけ。`useNest` と同じ形
//（CLAUDE.md「フックを1本足すとき、useAppWiring には書かない」）。
//
// ## 後ろへ送るのは土台の `shiftAfter(0, 合計)` に任せる
//
// 「5種類まとめてしか触らない」は state/useContentShift に1つだけある。
// ここで種類ごとにずらすと、種類が増えたとき直す場所が2つになる。
// **写しは送ったあとで足す**（setState は呼んだ順に積まれるので、足した写しまで
// 送られることはない）。写す元の時刻は、送る前に ref から読んでおく。
//
// ## 中身
//
// - `useDigestToHead` … 下の2つを返す
// - `canCopyToHead` … いま押せるか（選んだ本編に、空きでない切片があるか・鍵）
// - `copyToHead` … 写して先頭に並べる
import { layoutSegs } from '../../../shared/timeline'
import { digestPieces, placeInDigest } from '../../../shared/digest'
import { nextGroupId, remapGroups } from '../../../shared/group'
import { useDoc } from './contentContext'
import { useSel } from './selectionContext'
import { useTracksCtx } from './tracksContext'
import { useTracksAdminCtx } from './tracksAdminContext'
import { useTrackGeomCtx } from './trackGeomContext'
import { useAppChromeCtx } from './appChromeContext'
import { usePlaybackEngineCtx } from './playbackEngineContext'
import { useContentShiftCtx } from './contentShiftContext'
import { useToastCtx } from './toastContext'

export function useDigestToHead() {
  const doc = useDoc()
  const {
    selectedVideoIds, selectedAudioIds, setSelectedVideoIds, setSelectedAudioIds,
    setSelectedIds, setSelectedSeIds, setSelectedImgIds, setSelectedVClipIds
  } = useSel()
  const { trackStates } = useTracksCtx()
  const { mainLocked } = useTracksAdminCtx()
  const { cueTrack, vcLen } = useTrackGeomCtx()
  const { idCounter } = useAppChromeCtx()
  const { stopPlayback } = usePlaybackEngineCtx()
  const { shiftAfter } = useContentShiftCtx()
  const { showToast } = useToastCtx()

  /** 写す切片。本編は映像側と音声側で選択が別なので、どちらで選んでいても拾う。空きは写さない */
  const pickedLayout = () => {
    const ids = new Set([...selectedVideoIds, ...selectedAudioIds])
    return layoutSegs(doc.segsRef.current).filter((L) => ids.has(L.seg.id) && !L.seg.gap && L.len > 0)
  }

  const canCopyToHead = !mainLocked() && pickedLayout().length > 0

  function copyToHead(): void {
    if (mainLocked()) return
    const lay = pickedLayout()
    if (!lay.length) return
    stopPlayback()
    const { pieces, total } = digestPieces(lay)
    const locked = (track: string) => !!trackStates[track]?.locked

    // ---- 送る前に、写す物を全部決める（ref はまだ元の時刻）----
    // 切片。区間の最後の切片だけ「次へのつなぎ（xfade）」を外す——並べた先の
    // 次は元とは別の切片なので、知らない相手と混ざる
    const lastOfPiece = new Set(
      pieces.map((p) => lay.filter((L) => L.tStart >= p.from - 1e-6 && L.tEnd <= p.to + 1e-6).at(-1)?.seg.id)
    )
    const segCopies = lay.map((L) => ({
      ...structuredClone(L.seg),
      id: doc.segIdCounter.current++,
      ...(lastOfPiece.has(L.seg.id) ? { xfade: undefined } : {})
    }))
    const cues = doc.cuesRef.current.flatMap((c) => {
      const p = !locked(cueTrack(c)) && placeInDigest(pieces, c.start, c.end)
      return p ? [{ c, p }] : []
    })
    const ses = doc.seClipsRef.current.flatMap((c) => {
      const p = !locked(c.track) && placeInDigest(pieces, c.tStart, c.tStart + c.duration)
      return p ? [{ c, p }] : []
    })
    const imgs = doc.imgClipsRef.current.flatMap((c) => {
      const p = !locked(c.track) && placeInDigest(pieces, c.tStart, c.tStart + c.duration)
      return p ? [{ c, p }] : []
    })
    const vcs = doc.vClipsRef.current.flatMap((c) => {
      const p = !locked(c.track) && placeInDigest(pieces, c.tStart, c.tStart + vcLen(c))
      return p ? [{ c, p }] : []
    })
    // 「組」は写しごとに新しい番号へ（元と同じ番号だと、写しを動かすと元まで動く。
    // 貼り付け＝state/useCopyPaste と同じ扱い）
    const gmap = remapGroups(
      [...cues, ...ses, ...imgs, ...vcs].map(({ c }) => c.group),
      nextGroupId({ cue: doc.cues, se: doc.seClips, img: doc.imgClips, vclip: doc.vClips })
    )
    const regroup = (g: number | undefined) => (g == null ? undefined : gmap.get(g))
    const cueCopies = cues.map(({ c, p }) => ({
      ...structuredClone(c), id: idCounter.current++, start: p.start, end: p.end, group: regroup(c.group)
    }))
    // 尻だけ切る（頭は切らない＝shared/digest の決まり）ので、効果音の srcOffset・
    // 画像と映像レイヤーの動きの印（クリップの頭からの秒）はそのままで合う
    const seCopies = ses.map(({ c, p }) => ({
      ...c, id: doc.seIdCounter.current++, tStart: p.start, duration: p.end - p.start, group: regroup(c.group)
    }))
    const imgCopies = imgs.map(({ c, p }) => ({
      ...structuredClone(c), id: doc.imgIdCounter.current++, tStart: p.start, duration: p.end - p.start, group: regroup(c.group)
    }))
    const vcCopies = vcs.map(({ c, p }) => ({
      ...structuredClone(c), id: doc.vClipIdCounter.current++, tStart: p.start,
      srcEnd: c.srcStart + (p.end - p.start), group: regroup(c.group)
    }))

    // ---- 元の中身を全部後ろへ送ってから、空いた先頭へ写しを置く ----
    shiftAfter(0, total)
    doc.setSegments((prev) => [...segCopies, ...prev])
    if (cueCopies.length) doc.setCues((prev) => [...cueCopies, ...prev].sort((a, b) => a.start - b.start))
    if (seCopies.length) doc.setSeClips((prev) => [...prev, ...seCopies])
    if (imgCopies.length) doc.setImgClips((prev) => [...prev, ...imgCopies])
    if (vcCopies.length) doc.setVClips((prev) => [...prev, ...vcCopies])

    // 写した物を選んでおく（どこまでが写しかを見て分かるように。戻すのは Ctrl+Z）
    setSelectedVideoIds(segCopies.map((s) => s.id))
    setSelectedAudioIds([])
    setSelectedIds(cueCopies.map((c) => c.id))
    setSelectedSeIds(seCopies.map((c) => c.id))
    setSelectedImgIds(imgCopies.map((c) => c.id))
    setSelectedVClipIds(vcCopies.map((c) => c.id))
    const rest = cueCopies.length + seCopies.length + imgCopies.length + vcCopies.length
    showToast(
      `${segCopies.length}個のカット（${total.toFixed(1)}秒）を先頭に並べました` +
        (rest ? `。載っていた${rest}個も一緒に写しました` : '')
    )
  }

  return { canCopyToHead, copyToHead }
}
