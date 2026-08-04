// 映像を焼くのに使うもの（CPU か、GPU か）の一覧。
//
// **本体(index.ts)から切り出してある。** ここは Electron を一切使わない純粋な表なので、
// 切り出しておけばテストから読める。設定の取り違えは**配布先でだけ**表に出る類で
// （同梱 ffmpeg に x264 が無く、プロキシが作れなかった件が実際にあった）、
// 目で見て気づける物ではない。

// ---- 映像を焼くのに使うもの（CPU か、GPU か）----
//
// GPU で焼けると、画質を落とさずに書き出しが速くなる（1080p の実測で 12.9秒 → 9.9秒）。
// ただし **ffmpeg の一覧に載っている＝使える、ではない**。ドライバが無ければ
// 実行して初めて落ちる。なので「1枚だけ焼いてみて、通ったものを使う」。
//
// 速さの割合はマシンによる。CPU が強いほど差は小さい（この開発機では 1.3倍）。
// args … 書き出し用（画質優先。crf は利用者が選んだ画質）。
// fast … プロキシ用（速さ優先。画質は捨ててよい）。引数は作るプロキシの高さ。
//
// fast を分けているのは、プロキシが「編集中に見るだけ」の物だから。
// 画質より**速く作れること・シークが速いこと**が要る。
// 目安は今まで使っていた x264 crf30 と同じくらいの大きさ（60秒・360p で 7MB 前後）。
type Enc = {
  v: string
  /** 書き出し用。crf は利用者が選んだ画質（18=きれい / 23=標準 / 28=軽い） */
  args: (crf: number, size: { w: number; h: number; fps: number }) => string[]
  fast: (h: number) => string[]
  /**
   * 「最高画質のまま軽くする」用。**原寸のまま全コマキーフレームで焼く。**
   *
   * fast と分ける理由: fast は縮小して見る前提なので画質を捨ててよいが、
   * こちらは**原寸で見る物**。同じ設定で焼くと、見た目が原本と違ってしまい
   * 「最高画質を選んだのに汚い」になる。速さより画質を採る。
   */
  full: () => string[]
  label: string
}

/**
 * 画質の数字（crf）を**ビットレート**に読み替える。
 *
 * **OpenH264 は crf も -qp も理解しない。** 実際に -qp を 18 / 30 / 45 と変えても
 * 出来上がりは 4.73MB のまま1バイトも動かなかった（既定の 2Mbps 固定）。
 * ＝ GPU も x264 も無い PC では、画質の設定が何も効いていなかった。
 * 効くのはビットレートだけなので、ここで読み替える。
 *
 * 1画素1コマあたり何ビット使うか（bpp）で考える。crf が 6 下がるごとに倍。
 * 1080p30 でおおよそ: 18→11Mbps / 23→6Mbps / 28→3.5Mbps。
 * OpenH264 は x264 より効率が悪いので、やや多めに渡す。
 */
function crfToBitrateK(crf: number, size: { w: number; h: number; fps: number }): number {
  const bpp = 0.1 * Math.pow(2, (23 - crf) / 6)
  const kbps = (size.w * size.h * size.fps * bpp) / 1000
  return Math.max(500, Math.min(60000, Math.round(kbps)))
}
const ENCODERS: Enc[] = [
  {
    v: 'h264_nvenc',
    label: 'GPU（NVIDIA）',
    // -cq は libx264 の -crf に相当。同じ数字だと軽めに出るので少しだけ寄せる
    //
    // **preset は p4。p5 から下げた（2026-08-04）。1.8倍速く、絵もファイルも変わらない。**
    //
    // 書き出しの遅さを分解したら、支配しているのは preset だった
    //（1080p60・30秒ぶん、同じ素材・同じ cq18 で実測）:
    //
    //   p1 1.9秒 2.9MB / p2 2.0秒 2.9MB / p3 2.5秒 2.8MB
    //   p4 3.5秒 2.1MB   ← ここ
    //   p5 6.2秒 2.1MB   ← 前の設定
    //   p6 6.7秒 2.8MB / p7 6.7秒 2.8MB
    //
    // **p4 と p5 はファイルの大きさが同じ（2.1MB）で、絵も PSNR 66dB**
    //（40dB を超えたら目では区別が付かない）。つまり画質は落ちていない。
    // p3 以下は速いが**ファイルが 1.4倍に太る**——同じ cq を出すのに
    // 余分にビットが要る＝圧縮効率が落ちるので、そこは採らない。
    //
    // ついでに分かったこと（どれも**効かなかった**ので入れていない）:
    //   ・`-hwaccel cuda` … 6.2秒のまま。読む側は詰まっていない
    //   ・`scale/pad/fps` を外す … 6.2秒のまま。解像度合わせはタダ
    //   ・テロップの重ね … 100段足して +0.4秒。段の数はほぼ効かない
    args: (crf) => ['-c:v', 'h264_nvenc', '-preset', 'p4', '-rc', 'vbr', '-cq', String(crf)],
    // p1 = 一番速い。cq は 30 だと x264 crf30 より太るので 34（実測 9.7MB → 6.7MB）
    fast: () => ['-c:v', 'h264_nvenc', '-preset', 'p1', '-rc', 'vbr', '-cq', '34'],
    // 原寸で見る物なので画質側へ寄せる（cq19＝ほぼ原本）。
    // **preset は p1 でなければならない。** p4 以降は B フレームを必ず使う作りで、
    // 全コマキーフレーム（-g 1）と両立せず、
    // 「Gop Length should be greater than number of B frames + 1」で開けない。
    // -bf 0 を渡しても効かない（実際に p4・-bf 0・forced-idr の3通りとも失敗した）。
    // p1 でも画質は cq が決めるので、太るだけで見た目は落ちない
    // （実測: 1080p 10秒で 20.6MB＝4分42秒なら約580MB、変換は1秒）
    full: () => ['-c:v', 'h264_nvenc', '-preset', 'p1', '-rc', 'vbr', '-cq', '19']
  },
  {
    v: 'h264_qsv',
    label: 'GPU（Intel）',
    args: (crf) => ['-c:v', 'h264_qsv', '-global_quality', String(crf)],
    fast: () => ['-c:v', 'h264_qsv', '-preset', 'veryfast', '-global_quality', '32'],
    // -bf 0 は「B フレームを使わない」。全コマキーフレームと両立させるため
    // （NVIDIA では B フレームが残っていると開けなかった。他社も同じ作りの可能性が高い）。
    // ここで失敗しても CPU でやり直す道があるので、安全側に倒しておく
    full: () => ['-c:v', 'h264_qsv', '-preset', 'veryfast', '-global_quality', '19', '-bf', '0']
  },
  {
    v: 'h264_amf',
    label: 'GPU（AMD）',
    args: (crf) => ['-c:v', 'h264_amf', '-rc', 'cqp', '-qp_i', String(crf), '-qp_p', String(crf)],
    fast: () => [
      '-c:v', 'h264_amf', '-quality', 'speed', '-rc', 'cqp', '-qp_i', '32', '-qp_p', '32'
    ],
    full: () => [
      '-c:v', 'h264_amf', '-quality', 'speed', '-rc', 'cqp', '-qp_i', '19', '-qp_p', '19',
      '-bf', '0' // 全コマキーフレームと両立させる（NVIDIA では必須だった）
    ]
  },
  {
    // 開発機など、x264 入り（GPL）の ffmpeg があるときはこちらが一番きれい。
    // 配布物には入っていないので、実際に使われるのは開発中だけ。
    v: 'libx264',
    label: 'CPU',
    args: (crf) => ['-c:v', 'libx264', '-crf', String(crf), '-preset', 'medium'],
    // fastdecode = 再生側を軽くする作り方。編集中のプレビューはここが効く
    fast: () => [
      '-c:v', 'libx264', '-crf', '30',
      '-preset', 'veryfast', '-tune', 'fastdecode', '-sc_threshold', '0'
    ],
    full: () => [
      '-c:v', 'libx264', '-crf', '16',
      '-preset', 'veryfast', '-tune', 'fastdecode', '-sc_threshold', '0'
    ]
  },
  {
    // GPU が1つも使えず、x264 も無い機械のための最後の砦。
    // 画質は x264 に劣るが、**買わずに H.264 を出せる**（Cisco が特許料を
    // 肩代わりしている OpenH264）。これが無いと、GPU の無い PC で
    // 「書き出せないアプリ」になる。
    v: 'libopenh264',
    label: 'CPU（OpenH264）',
    // -crf は使えないので、品質の指定を量子化パラメータに読み替える
    // **-qp は効かない**（渡しても黙って無視される）。ビットレートで渡す
    args: (crf, size) => {
      const k = crfToBitrateK(crf, size)
      return ['-c:v', 'libopenh264', '-b:v', `${k}k`, '-maxrate', `${Math.round(k * 1.5)}k`]
    },
    // **OpenH264 に -qp は無い**（渡しても黙って無視される。実際に -qp を
    // 30/34/38 と変えても大きさが 15.2MB のまま動かなかった）。
    // 効くのはビットレートだけなので、作る高さから決める
    fast: (h) => ['-c:v', 'libopenh264', '-b:v', h >= 720 ? '2000k' : '800k'],
    // 原寸・全コマキーフレームは、どうしてもビットレートを食う。
    // OpenH264 は効くのがビットレートだけなので、太めに渡す（1080p想定 25Mbps）
    full: () => ['-c:v', 'libopenh264', '-b:v', '25000k', '-maxrate', '30000k']
  }
]

export { ENCODERS, crfToBitrateK }
export type { Enc }
