// **切片をまたぐときの時計。** ここがこのアプリで一番むずかしい所。
//
// ## なぜ2本の <video> が要るか
//
// タイムラインは切片（カット）の列で、切片ごとに元動画の別の場所を指す。
// 素直に1本の <video> で追うと、切片の境目で毎回シークが入り、**そこで数百ms 止まる**。
// 見ている側には「カットのたびにつっかえる」に見える。
//
// そこで **A面/B面の2本**を使う。いま流している裏で、次の切片の頭へもう1本を
// 先に合わせておき、境目では表示を入れ替えるだけにする。
//
// ## 「合わせておいた面」は、飛んだ瞬間に当てにならなくなる
//
// 先に合わせた面（`preparedRef`）は、位置が飛べば別の場所を指している。
// **使う前に必ず確かめること**——確かめずに入れ替えると、1コマだけ違う絵が出る。
//
// ## 再生ヘッドは壁時計で進める
//
// 動画の時刻に合わせて進めると、動画が一瞬もたついたときに**再生ヘッドまで止まる**。
// 実時間で一定速度に進め、動画がそれを追いかける形にしてある。
//
// ## なぜ ./usePlaybackEngine から出したか（2026-08-04）
//
// あちらは521行で、頭が丸ごと1節をこの話に割いていた。記号解決で測ったら
// **受け取る4・返す2**——受け取る4つは全部 import で、返す2つ（`getPlayEnd` /
// `stopPlayback`）は「すべての再生はここを通す」という一元管理の物なので、
// あちらに残して**借りた**（`引き継ぎ-心臓の分け直し.md`）。
//
// ## 中身
//
// - `useSegClock` … 下の2つを返す唯一の入口
// - `startVideoSegClock` … 壁時計マスターで進めながら、A面/B面を入れ替える
// - `xfBStyle` … つなぎ目の B面の見た目（fade/slide/wipe）を進捗から作る
import { clamp, tToSource } from '../../../shared/timeline'
import { isNeutralZoom } from '../lib/clipLook'
import { perf } from '../lib/perfMonitor'
import { usePlaybackCtx } from './playbackContext'
import type { UsePlaybackEngineDeps } from './usePlaybackEngine'

// **deps の型は手で書かない。** 呼ぶ側の定義から引く（引数の数を間違えても
// 通ってしまうのを防ぐ。2026-08-04 に別の所で実際に3か所ズレた）
export type UseSegClockDeps = Pick<
  UsePlaybackEngineDeps,
  | 'videoRef' | 'videoBRef' | 'videoElsRef' | 'setActiveHalf' | 'halfOf' | 'elKey'
  | 'segLayoutRef' | 'srcOfSeg' | 'videoTLenRef' | 'paintTime' | 'setTime'
> & {
  /** 再生を止める終わりの時刻。**一元管理は ./usePlaybackEngine** */
  getPlayEnd: () => number
  /** 止める。**すべての再生は ./usePlaybackEngine の startPlayback / stopPlayback を通す** */
  stopPlayback: () => void
}

export function useSegClock(deps: UseSegClockDeps) {
  const {
    videoRef, videoElsRef, setActiveHalf, halfOf, elKey, segLayoutRef,
    srcOfSeg, videoTLenRef, paintTime, setTime, getPlayEnd, stopPlayback
  } = deps
  const {
    playRateRef, rafRef,
    // 追いかけの時計まわりは心臓（usePlayback）が持っている
    clockStartWallRef, clockStartPosRef, seekCooldownRef, xfadeUntilRef,
    fixingDriftRef, preparedRef, currentSegRef
  } = usePlaybackCtx()

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
            // 型は書かない。**手で書いた注釈が実体とズレていた**——
            // 面は `0 | 1` なのに `Record<number, string>` と書いてあり、
            // `setActiveHalf` が `any` だったので誰も気づけなかった
            setActiveHalf((h) => ({ ...h, [prep.srcId]: prep.half }))
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

  return { startVideoSegClock, xfBStyle }
}
