// 効果音（SE）を鳴らすための隠し <audio> 要素。**再生位置を毎コマ見る、覆いの中で唯一の部品。**
//
// ## なぜ AppDialogs から出したか（2026-11-08）
//
// 全クリップぶん常設すると Chromium のメディア要素上限に触れて新しい要素が読み込めず
// 無音になるので、再生ヘッド近傍だけを置く。そのために `currentTime` を読む必要があるが、
// AppDialogs で読むと**覆い全部・トースト・右クリックの品書きが毎コマ描き直る**
// （再生中に 120回/秒）。要るのはこの一覧だけなので、ここが自分で見に行く。
//
// 後ろ側（1秒）に余裕を持たせて、区間を出た瞬間に音がぶつ切りになるのを防ぐ。
import type { JSX } from 'react'
import { toGcUrl } from '../../lib/gcUrl'
import { useDoc } from '../../state/contentContext'
import { usePlaybackCtx } from '../../state/playbackContext'
import { useSeAudioCtx } from '../../state/seAudioContext'

export function SeAudioElements(): JSX.Element {
  const { seClips } = useDoc()
  const { currentTime } = usePlaybackCtx()
  const { seRefCb } = useSeAudioCtx()
  return (
    <>
      {seClips
        .filter(
          (clip) =>
            currentTime >= clip.tStart - 3 && currentTime < clip.tStart + clip.duration + 1
        )
        .map((clip) => (
          <audio key={clip.id} src={toGcUrl(clip.path)} preload="auto" ref={seRefCb(clip.id)} />
        ))}
    </>
  )
}
