// 再生の心臓。流す・止める・飛ぶ・コマ送り・早送り。
//
// ## 切片をまたぐときが一番むずかしい
//
// タイムラインは切片（カット）の列で、切片ごとに元動画の別の場所を指す。
// 素直に1本の <video> で追うと、切片の境目で毎回シークが入り、
// **そこで数百ms 止まる**。見ている側には「カットのたびにつっかえる」に見える。
//
// そこで **A面/B面の2本**を使う。いま流している裏で、次の切片の頭へ
// もう1本を先に合わせておき、境目では表示を入れ替えるだけにする。
//
// ## 「合わせておく」のは温めた面
//
// 先に合わせた面（preparedRef）は、位置が飛んだ時点で当てにならなくなる。
// 飛んだら必ず捨てること。捨て忘れると、**関係ない所の絵が一瞬出る**。
//
// ## 描き直しは頭打ちにする
//
// 再生位置を state に入れると App 全体が作り直される。240Hz のモニタでは
// 毎秒240回になり、細かい仕事で主スレッドが埋まって音がぶちぶち切れる。
// 再生ヘッドは秒60回動けば人の目には連続に見えるので、そこで止める。

import { clamp, qFrame, tToSource } from '../../../shared/timeline'
import { isNeutralZoom } from '../lib/clipLook'
import { perf } from '../lib/perfMonitor'
import { usePlaybackCtx } from './playbackContext'

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface UsePlaybackEngineDeps {
  /** 本編の <video>。A面/B面の2本と、その一覧 */
  videoRef: any
  videoBRef: any
  videoElsRef: any
  /** いま表に出している面（A か B）。境目で入れ替える */
  setActiveHalf: any
  halfOf: any
  elKey: any
  segLayoutRef: any
  srcOfSeg: any
  videoTLenRef: any
  videoDurationRef: React.MutableRefObject<number>
  contentEndRef: any
  /** 効果音の <audio> */
  seAudioRefs: any
  sePreviewRef: any
  /** 再生位置を進める（描き直しは頭打ち） */
  paintTime: any
  setTime: any
  /** 飛んで、そこを見せる。state/useViewNav の物 */
  seekAndReveal: (t: number) => void
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function usePlaybackEngine(deps: UsePlaybackEngineDeps) {
  const {
    videoRef, videoBRef, videoElsRef, setActiveHalf, halfOf, elKey, segLayoutRef,
    srcOfSeg, videoTLenRef, videoDurationRef, contentEndRef,
    seAudioRefs, sePreviewRef, paintTime, setTime, seekAndReveal
  } = deps
  const {
    currentTimeRef, durationRef, fpsRef, playRateRef, rafRef,
    setCurrentTime, setPlayRateUI, setPlaying,
    // 追いかけの時計まわりは心臓（usePlayback）が持っている
    clockStartWallRef, clockStartPosRef, lastTsRef, seekCooldownRef, xfadeUntilRef,
    fixingDriftRef, preparedRef, currentSegRef
  } = usePlaybackCtx()


  function getPlayEnd(): number {
    return contentEndRef.current > 0
      ? Math.min(contentEndRef.current, durationRef.current)
      : durationRef.current
  }

  // ================= 再生エンジン =================
  // すべての再生は startPlayback / stopPlayback を通す（状態の一元管理）
  function stopPlayback(): void {
    // SEライブラリの試聴音も止める（DOM外のAudioなので放置すると鳴り続ける）
    try {
      sePreviewRef.current?.pause()
    } catch {
      /* noop */
    }
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    // **2枚組なので、映していない面も必ず止める。**
    // 片方だけ止めると、裏の面が鳴り続けたり勝手に進んだりする
    videoElsRef.current.forEach((el: HTMLVideoElement) => {
      if (!el.paused) el.pause()
    })
    // 温めてあった面は、止めた時点で当てにできない（位置が変わるため）
    preparedRef.current = null
    const v = videoRef.current
    if (v && !v.paused) v.pause()
    const vb = videoBRef.current
    if (vb && !vb.paused) vb.pause()
    seAudioRefs.current.forEach((a: HTMLAudioElement) => {
      if (!a.paused) a.pause()
    })
    playRateRef.current = 0
    setPlaying(false)
    setPlayRateUI(0)
    // 画質スロットルで最終フレームを間引いた場合に備え、停止時は正確な位置へ確実に反映
    setCurrentTime(currentTimeRef.current)
  }

  function startRafClock(rate: number): void {
    lastTsRef.current = performance.now()
    const tick = (ts: number): void => {
      const dt = (ts - lastTsRef.current) / 1000
      lastTsRef.current = ts
      const nt = currentTimeRef.current + rate * dt
      if (rate > 0 && nt >= getPlayEnd()) {
        setTime(getPlayEnd())
        stopPlayback()
        return
      }
      if (rate < 0 && nt <= 0) {
        setTime(0)
        stopPlayback()
        return
      }
      paintTime(nt)
      const v = videoRef.current
      if (v && rate < 0) {
        // 逆再生は paused の動画をセグメント対応でフレームシーク
        const src = tToSource(segLayoutRef.current, nt)
        if (src) v.currentTime = src.srcTime
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }

  // 順再生（壁時計マスター）: 再生ヘッドは実時間で常に一定速度に進め、動画がそれを追いかける。
  // これで動画がカットでシークして一瞬もたついても、再生ヘッドは絶対に止まらない。
  function startVideoSegClock(): void {
    const tick = (): void => {
      const vv = videoRef.current
      if (!vv) {
        stopPlayback()
        return
      }
      const rate = playRateRef.current
      // 壁時計で再生ヘッド位置を算出（動画の状態に一切依存しない）
      const pos =
        clockStartPosRef.current + (performance.now() / 1000 - clockStartWallRef.current) * rate
      if (pos >= getPlayEnd()) {
        setTime(getPlayEnd())
        stopPlayback()
        return
      }
      paintTime(pos) // ← 再生ヘッドは絶対に止めない（画質モードで再描画のみ間引く）
      // 動画を再生ヘッド位置に追従させる（ミュート/不透明度は別の毎レンダー effect が反映）
      const src = tToSource(segLayoutRef.current, pos)
      if (src && pos < videoTLenRef.current - 1e-3) {
        // **切片が変わったか**で扱いを変える（下の追従を参照）。
        // 変わった＝カット（飛び先が違う）、変わらない＝ただのズレ。
        const segChanged = currentSegRef.current !== src.index
        currentSegRef.current = src.index
        // 大きくズレたら（＝不連続カットをまたいだ／ドリフト）シークで追いつく。プロキシなら一瞬。
        // ---- カットに来た: 温めてある面があれば「入れ替えるだけ」で済む ----
        const prep = preparedRef.current
        const curSrcId = srcOfSeg(src ? segLayoutRef.current[src.index]?.seg : undefined)?.id
        if (prep && prep.segIdx === src.index && curSrcId === prep.srcId) {
          const pre = videoElsRef.current.get(elKey(prep.srcId, prep.half))
          if (pre) {
            // **待ち時間ゼロの切り替え。** 飛び先はすでに復号済み
            perf.mark('カット: 温めてあった面へ入れ替え')
            // **音量は必ず引き継ぐ。**
            // 音量を決める effect は「いま表になっている要素」にしか書かない。
            // 温めてある面は触られていないので、既定の 1.0（最大）のまま。
            // そこへ入れ替えると、次の描画で直るまでの数十msだけ**全開で鳴る**。
            // 最初のカットで「ホワイトノイズが荒くなる」と言われたのがこれ。
            // 2回目以降が平気なのは、一度表に出た面が正しい音量を持ち越すため。
            //
            // 出ていく面の値をそのまま渡す。切片ごとの音量は次の描画で入るが、
            // **大きすぎる側へは絶対に振れない**ので、こちらの向きで間違える方が安全。
            // **muted は触らない。** 触ると時計が張り替わって250ms止まる
            //（生の推移で 7.882 のまま6コマ。詳しくは音量 effect の説明）
            // **音は一瞬で切り替えず、40msだけ重ねる。**
            // 別々の音の流れを継ぎ目でぶつ切りにすると、波形が飛んで「プツ」と鳴る。
            // 助走のおかげでカットの時点では両面とも走っているので、
            // 出ていく側を下げながら入ってくる側を上げれば、継ぎ目が消える。
            // 同じ素材の中のカットなので、短く重ねても音は濁らない。
            const XFADE_MS = 40
            const leaving = vv
            const target = vv.volume
            pre.volume = 0
            xfadeUntilRef.current = performance.now() + XFADE_MS // この間は音量 effect を黙らせる
            const t0 = performance.now()
            const ramp = (): void => {
              const k = Math.min(1, (performance.now() - t0) / XFADE_MS)
              pre.volume = clamp(target * k, 0, 1)
              leaving.volume = clamp(target * (1 - k), 0, 1)
              if (k < 1) requestAnimationFrame(ramp)
              else if (videoRef.current !== leaving && !leaving.paused) leaving.pause()
            }
            requestAnimationFrame(ramp)
            pre.playbackRate = vv.playbackRate
            videoRef.current = pre
            setActiveHalf((h: Record<number, string>) => ({ ...h, [prep.srcId]: prep.half }))
            preparedRef.current = null
            if (pre.paused && !pre.ended) void pre.play().catch(() => {})
            rafRef.current = requestAnimationFrame(tick)
            return // 入れ替えた面は次のコマから面倒を見る
          }
        }
        // ---- 追従: 「飛ぶ」のと「ズレを詰める」のは別物 ----
        //
        // **ズレを頭出しで直してはいけない。** currentTime を書くと復号がやり直しになり、
        // 絵が再び動き出すまで待たされる。1080p の実測で約230ms。閾値の0.25秒とほぼ同じ
        // なので、再開した直後にまた0.25秒ズレて、また頭出し——**永久に噛み合わない**。
        //
        // 実測（本物のプロジェクト・切片51・テロップ23、npm run stutter）:
        //   1080p  頭出し 38回/10秒  絵の止まり 6800/9750ms  速さ0.98倍
        //   生の推移 … 2.302 2.302 2.302 2.557 2.570 2.573 2.573 2.573 2.825
        //              ＝再生しているのに進まず、0.25秒ごとに階段状に飛んでいた
        // 720p は同じ作りでも頭出し1回・止まり0ms。違いは復号の重さだけで、
        // **重い素材ほど悪くなる**——直しようが「もっと軽い画質を選べ」しか無くなる。
        //
        // なので:
        //   カット（切片が変わった）… 飛び先が違うのだから頭出しするしかない
        //   ただのズレ（同じ切片）  … **速さを少しいじって詰める**。復号は途切れない
        //
        // 速さで詰めるのは動画プレイヤーが昔からやっている手で、±10%なら見ても
        // 聞いても分からない（音の高さは preservesPitch が既定で保たれる）。
        // 0.25秒のズレなら2.5秒で消える。その間ずっと絵は流れ続ける。
        const drift = src.srcTime - vv.currentTime // ＋なら動画が遅れている
        // **これが「テロップだけ先に動く」の正体になり得る。**
        // 文字は再生ヘッドの時刻で動き、動画はここで追いかけている。
        // 遅れが残っていれば、絵に対して文字が先行して見える。記録に残して数で見る。
        perf.reportLag(drift)
        const now = performance.now()
        // **シーク中は重ねて頼まない（vv.seeking）。**
        // ここは毎コマ（秒60回）通る。前のシークが着く前にもう一度 currentTime を
        // 書くと、前の依頼が取り消されて最初からやり直しになる。
        if (!vv.seeking && now >= seekCooldownRef.current && Math.abs(drift) > 0.25) {
          // 同じ切片のままの大ズレは、詰めきれないほど離れてしまった時だけ（頭出し直後など）。
          // ここを緩めると上のループが戻ってくるので、しきい値は大きく取る。
          const mustJump = segChanged || Math.abs(drift) > 1.5
          if (mustJump) {
            const t0 = now
            vv.addEventListener(
              'seeked',
              () => {
                const took = Math.round(performance.now() - t0)
                perf.mark(`カットでシーク ${took}ms`)
                // **着いた時間ではなく「また流れ出すまで」を待つ。**
                // 全コマがキーフレームだと着くのは数msだが、絵が動き出すのはその後。
                seekCooldownRef.current = performance.now() + Math.max(400, took * 3)
              },
              { once: true } // 着いたら自分で外れる（毎コマ足していた頃は積み上がっていた）
            )
            seekCooldownRef.current = now + 400
            vv.currentTime = src.srcTime
          }
        }

        // ---- 次のカットを先に温める ----
        //
        // 飛び先を**再生しながら裏で用意しておく**。カットに来たときには
        // すでに復号が済んでいるので、表示を入れ替えるだけで待ちが出ない。
        // 画質に関係なく効く（復号の速さに頼っていないため）。
        const AHEAD = 1.2 // 何秒前から用意するか。実測の待ち(最大235ms)に十分な余裕
        // 何秒前から裏で走らせておくか。立ち上げの実測(約300ms)より少し長く取る。
        // 長くすると2枚同時に復号する時間が延びるので、余裕は最小限にする。
        const PREROLL = 0.45
        // **狙うのは「次の切片」そのもの。**
        // 「1.2秒先の位置」を見るやり方だと、切片が1.2秒より短いときに
        // その次を飛び越して先の切片を温めてしまう。手前のカットは用意が無いので
        // シークになり、その直後に「1つ先ぶんの入れ替え」が起きる——
        // 実測の並び（シーク138ms → 0.2秒後に入れ替え）がまさにこれだった。
        const nextIdx = src.index + 1
        const nseg = segLayoutRef.current[nextIdx]
        if (nseg && nseg.tStart > pos && nseg.tStart - pos <= AHEAD * Math.max(1, rate)) {
          const nsrcId = srcOfSeg(nseg.seg)?.id
          // 別のソースへ移るカットは、元から専用の仕組みが用意してある（要素が別なので待ちが無い）。
          // ここで面倒を見るのは**同じファイルの中のカット**だけ。
          if (nsrcId != null && nsrcId === curSrcId) {
            const half = (halfOf(nsrcId) === 0 ? 1 : 0) as 0 | 1
            const pre = videoElsRef.current.get(elKey(nsrcId, half))
            const dt = (nseg.tStart - pos) / Math.max(0.01, rate) // カットまで何秒か
            if (pre && preparedRef.current?.segIdx !== nextIdx) {
              preparedRef.current = { segIdx: nextIdx, srcId: nsrcId, half }
              pre.volume = 0
              if (!pre.paused) pre.pause()
              // 飛び先＝次の切片の頭。ここを先に出しておく
              if (Math.abs(pre.currentTime - nseg.seg.srcStart) > 0.05)
                pre.currentTime = nseg.seg.srcStart
            } else if (pre && pre.paused && dt <= PREROLL && dt > 0.02 && !pre.seeking) {
              // ---- 助走 ----
              //
              // **止めてある面は、入れ替えた瞬間には流れ出せない。**
              // 絵（1コマ）は用意できていても、play() から実際に進み始めるまで
              // 復号の立ち上げが要る。1080p の実測で約300ms——カットのたびに
              // そこだけ止まって見えていた（生の推移で 7.929 → 8.026 と進まない）。
              //
              // 実測（本物のプロジェクト・1080p・15秒）:
              //   止まった所: 5.4秒に300ms / 8.8秒に300ms / 12.6秒に250ms ＝ちょうどカット3回
              //
              // なので**カットの少し前から、無音・裏で走らせておく**。
              // 入れ替えたときには既に流れているので、立ち上げを待たない。
              // 走らせ始める位置は「カットまでの残り時間ぶん手前」。こうすると
              // カットの瞬間にちょうど切片の頭へ着く。
              const sp = nseg.seg.speed ?? 1
              const want = Math.max(0, nseg.seg.srcStart - dt * sp)
              if (Math.abs(pre.currentTime - want) > 0.05) pre.currentTime = want
              pre.volume = 0 // 裏の音は絶対に出さない（muted は使わない＝時計を張り替えない）
              pre.playbackRate = Math.min(rate * sp, 16)
              void pre.play().catch(() => {})
            }
          }
        }
        // ended のまま play() すると先頭から再生し直してしまうため除外（シーク後は ended が解除される）
        if (vv.paused && !vv.ended) void vv.play().catch(() => {})
        // 再生ヘッドの進む速さ(rate) × 切片の速度。動画側はこの実効レートで追従。
        //
        // ここに**ズレを詰める補正**を上乗せする（上の説明の通り、頭出しの代わり）。
        // 遅れていれば少し速く、進みすぎていれば少し遅く。±10%まで。
        // 小さすぎるズレは触らない——毎コマ速さを書き換えると、かえって揺れる。
        // 入るのは大きくズレた時だけ。出るのはほぼ0に戻ってから（履歴＝上の ref 参照）。
        // 幅も小さく取る。カットで止まらなくなった今、ズレはそもそも溜まらない。
        if (fixingDriftRef.current) {
          if (Math.abs(drift) < 0.02) fixingDriftRef.current = false
        } else if (Math.abs(drift) > 0.1) {
          fixingDriftRef.current = true
        }
        const corr = fixingDriftRef.current
          ? Math.max(-0.03, Math.min(0.03, drift * 0.25))
          : 0
        const r = Math.min(rate * src.speed * (1 + corr), 16)
        if (Math.abs(vv.playbackRate - r) > 5e-3) vv.playbackRate = r
      } else if (!vv.paused) {
        // 動画尾部より先（テロップのみ区間）→ 動画は止めて再生ヘッドだけ進める
        vv.pause()
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }

  // 順再生（動画駆動）中も rAF で毎フレーム再生ヘッドを同期する
  // （video の timeupdate は約4Hzしか発火せず、テロップの出入りが最大250msズレるため）
  function startVideoClock(): void {
    let started = false // play() は非同期なので、実際に再生が始まるまでは paused を停止扱いしない
    const tick = (): void => {
      const v = videoRef.current
      if (!v) {
        stopPlayback()
        return
      }
      if (!v.paused) started = true
      else if (started && !v.ended) {
        // 再生開始後に予期せず止まった（デコードエラー等）→ 状態を破綻させない
        stopPlayback()
        return
      }
      setTime(v.currentTime)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }

  function startPlayback(rate: number): void {
    preparedRef.current = null // 前の再生で温めた面は、位置が変わっているので捨てる
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    const v = videoRef.current
    if (v && !v.paused) v.pause()
    let t = currentTimeRef.current
    if (rate > 0 && t >= getPlayEnd() - 0.01) {
      t = 0
      setTime(0)
    }
    // 壁時計の基準をセット（この時刻・位置から一定速度で再生ヘッドを進める）
    clockStartPosRef.current = t
    clockStartWallRef.current = performance.now() / 1000
    playRateRef.current = rate
    setPlaying(true)
    setPlayRateUI(rate)
    if (v && rate > 0) {
      const src = tToSource(segLayoutRef.current, t)
      if (src && videoDurationRef.current > 0 && t < videoTLenRef.current - 1e-3) {
        currentSegRef.current = src.index
        // すでにヘッド位置にいれば再シークしない（毎回の再生開始で一拍待たされるのを防ぐ）
        if (Math.abs(v.currentTime - src.srcTime) > 0.05) v.currentTime = src.srcTime
        v.playbackRate = Math.min(rate * src.speed, 16)
        v.play().catch(() => stopPlayback())
        startVideoSegClock() // 壁時計マスターで再生ヘッドを流す（動画は追従）
        return
      }
      if (segLayoutRef.current.length === 0 && videoDurationRef.current === 0) {
        // metadata 未取得 → 素直にネイティブ再生
        v.currentTime = t
        v.playbackRate = Math.min(rate, 8)
        v.play().catch(() => stopPlayback())
        startVideoClock()
        return
      }
    }
    // 逆再生 / 動画の先（テロップのみ区間）/ 動画なし → rAF クロック
    startRafClock(rate)
  }

  function togglePlay(): void {
    if (playRateRef.current !== 0) stopPlayback()
    else startPlayback(1)
  }

  // JKL シャトル（プレミア準拠: L 順方向を押すたび倍速、J 逆方向、K 停止）
  function shuttleForward(): void {
    startPlayback(playRateRef.current > 0 ? Math.min(playRateRef.current * 2, 8) : 1)
  }
  function shuttleReverse(): void {
    startPlayback(playRateRef.current < 0 ? Math.max(playRateRef.current * 2, -8) : -1)
  }

  // 動画のソース終端に達した場合の保険。
  // 壁時計マスター（切片あり）では tick が終端を管理するので何もしない
  // （ここでヘッドを動かすと再生ヘッドが末尾へテレポートするバグになる）。
  function handleVideoEnded(): void {
    if (segLayoutRef.current.length === 0) stopPlayback() // metadata未取得のネイティブ再生のみ
  }

  function seekTo(t: number): void {
    const nt = clamp(t, 0, durationRef.current)
    setTime(nt)
    const v = videoRef.current
    if (v && playRateRef.current <= 0) {
      const src = tToSource(segLayoutRef.current, nt)
      if (src) {
        v.currentTime = src.srcTime
        currentSegRef.current = src.index
      } else {
        currentSegRef.current = Math.max(0, segLayoutRef.current.length - 1)
      }
    }
  }
  // クロスディゾルブ/スライド/ワイプの videoB 見た目を type と進捗 p から作る。
  // fade=opacity、slide=translate、wipe=clip-path。ズーム変換と合成する。
  function xfBStyle(xf: {
    p: number
    type: string
    bZoom?: { scale: number; x: number; y: number }
  }): React.CSSProperties {
    const p = xf.p
    const off = ((1 - p) * 100).toFixed(2)
    // B側は「B切片自身のズーム」を使う（A側のズームを誤って適用しない）
    const bz =
      xf.bZoom && !isNeutralZoom(xf.bZoom)
        ? `translate(${(xf.bZoom.x * 100).toFixed(3)}%, ${(xf.bZoom.y * 100).toFixed(3)}%) scale(${xf.bZoom.scale.toFixed(4)})`
        : undefined
    const zoom = bz ? ` ${bz}` : ''
    switch (xf.type) {
      case 'slideleft':
        return { opacity: 1, transform: `translateX(${off}%)${zoom}` } // Bは右から入る
      case 'slideright':
        return { opacity: 1, transform: `translateX(-${off}%)${zoom}` } // 左から
      case 'slideup':
        return { opacity: 1, transform: `translateY(${off}%)${zoom}` } // 下から
      case 'slidedown':
        return { opacity: 1, transform: `translateY(-${off}%)${zoom}` } // 上から
      case 'wipeleft':
        return { opacity: 1, transform: bz, clipPath: `inset(0 0 0 ${off}%)` }
      case 'wiperight':
        return { opacity: 1, transform: bz, clipPath: `inset(0 ${off}% 0 0)` }
      default:
        return { opacity: p, transform: bz } // fade（クロスディゾルブ）
    }
  }
  // 再生ヘッド位置の切片IDを取得（リフレーム/ズームの編集対象）
  function curSegId(): number | null {
    const src = tToSource(segLayoutRef.current, currentTimeRef.current)
    return src ? (segLayoutRef.current[src.index]?.seg.id ?? null) : null
  }

  // 再生ヘッドを指定秒だけ移動（±5/±10 秒送り戻し）。再生中は止めてから。
  // ※飛ばす操作は**すべてタイムライン側も追従させる**。
  // バーだけ連動して、ボタンだと付いてこない、という食い違いが一番読みにくい。
  function skipSec(sec: number): void {
    stopPlayback()
    seekAndReveal(currentTimeRef.current + sec)
  }
  // 1フレーム単位で移動（フレームグリッドに量子化）。
  function stepFrame(frames: number): void {
    stopPlayback()
    seekAndReveal(qFrame(currentTimeRef.current, fpsRef.current) + frames / fpsRef.current)
  }

  return {
    getPlayEnd, stopPlayback, startRafClock, startVideoSegClock, startVideoClock,
    startPlayback, togglePlay, shuttleForward, shuttleReverse, handleVideoEnded,
    seekTo, xfBStyle, curSegId, skipSec, stepFrame
  }
}
