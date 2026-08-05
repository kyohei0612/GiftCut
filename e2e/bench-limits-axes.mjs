// 限界さがしの**19軸**（何を1軸ずつ増やして測るか）。
//
// ## なぜ出したか（2026-08-05）
//
// `bench-limits.mjs` が 637行あった（決まり: 600超は500以下に割る）。
// あちらは**測る仕掛け**（1軸ずつ増やして 95%・引っかかり・メモリを取る）で、
// ここは**何を増やすかの表**。話題が別なので切れる。
//
// ## 借りるのは素材だけ（4つ）
//
// 表そのものは名前・値・ラベルの並びで、測り方は知らない。
// 画像や動画は作るのに時間がかかるので、**作った物を受け取る**。

export function makeSweeps({ imgsByPx, imgs1920, vids3s, makeDistinctMedia }) {
  return [
    {
      name: 'テロップの枚数',
      key: 'telops',
      values: [200, 500, 1000, 2000, 4000],
      label: (v) => `${v}枚`,
      base: { clips: 12 }
    },
    {
      name: 'テロップ1枚の文字数',
      key: 'chars',
      values: [12, 40, 120, 400, 1000],
      label: (v) => `1枚 ${v}字`,
      base: { telops: 300, clips: 12 }
    },
    {
      name: 'クリップの数',
      key: 'clips',
      values: [50, 200, 500, 1000, 2000],
      label: (v) => `${v}個`,
      base: { telops: 100 },
      grab: 'clip'
    },
    {
      name: '効果音の数',
      key: 'se',
      values: [50, 200, 500, 1000],
      label: (v) => `${v}個`,
      base: { telops: 50, clips: 12 },
      grab: 'se'
    },
    {
      name: '画像の数',
      key: 'imgs',
      values: [50, 200, 500, 1000],
      label: (v) => `${v}枚`,
      base: { telops: 50, clips: 12 },
      grab: 'img'
    },
    {
      name: 'めじるしの数',
      key: 'marks',
      values: [200, 1000, 3000, 8000],
      label: (v) => `${v}個`,
      base: { telops: 50, clips: 12 },
      grab: 'clip'
    },
    {
      name: 'テロップの縁取りの枚数',
      key: 'strokes',
      values: [1, 3, 6, 10],
      label: (v) => `${v}枚`,
      base: { telops: 200, clips: 12, shadows: 1 },
      grab: 'scrub'
    },
    {
      name: 'テロップの影の枚数',
      key: 'shadows',
      values: [1, 3, 6, 12],
      label: (v) => `${v}枚`,
      base: { telops: 200, clips: 12, strokes: 2 },
      grab: 'scrub'
    },
    {
      name: 'テロップのスタイルの種類数',
      key: 'kinds',
      values: [1, 10, 50, 200],
      label: (v) => `${v}種`,
      base: { telops: 200, clips: 12, strokes: 2, shadows: 2 },
      grab: 'scrub'
    },
    {
      name: '素材ビンの数（同じファイル）',
      key: 'media',
      values: [10, 100, 500, 2000],
      label: (v) => `${v}件`,
      base: { telops: 50, clips: 12 },
      grab: 'clip'
    },
    {
      // フォルダを丸ごと読み込む使い方は、全部が別ファイルになる。
      // 同じファイルを並べた測定より重いはずで、そこが実際の上限になる。
      name: '素材ビンの数（全部が別ファイル）',
      key: 'media',
      values: [100, 500, 2000],
      label: (v) => `${v}件`,
      base: { telops: 50, clips: 12, mediaFiles: makeDistinctMedia(2000) },
      grab: 'clip'
    },

    // -----------------------------------------------------------------------
    // ここから 2026-08-04 に足した軸。**画像と動画は実物を読ませる。**
    //
    // それまでの「画像の数」は path に元動画を指していて、**帯が並ぶ重さしか
    // 測っていなかった**（デコードもサムネもメモリも0回）。動画クリップに
    // 至っては fixture が1本も作っていなかった＝軸そのものが無かった。
    // -----------------------------------------------------------------------
    {
      name: '画像の数（本物のPNG・1920px）',
      key: 'imgs',
      values: [50, 200, 500, 1000],
      label: (v) => `${v}枚`,
      base: { telops: 50, clips: 12, imgFiles: imgs1920 },
      grab: 'img'
    },
    {
      // **枚数と解像度を分ける。** 混ぜると「重いのは枚数か大きさか」が出ない。
      name: '画像1枚の大きさ（100枚で固定）',
      key: 'imgPx',
      values: [512, 1920, 4096],
      label: (v) => `${v}px 幅`,
      base: { telops: 50, clips: 12, imgs: 100 },
      // 解像度は buildProject の引数ではないので、値ごとに別のファイル一覧を渡す
      makeBase: (v) => ({ imgFiles: imgsByPx[v] }),
      grab: 'img'
    },
    {
      name: '動画クリップの数',
      key: 'vids',
      values: [20, 80, 200, 500],
      label: (v) => `${v}個`,
      base: { telops: 50, clips: 12, vidFiles: vids3s },
      grab: 'vid'
    },
    {
      // 同じファイルを並べるとデコーダが使い回されて実際より軽く出る。
      // 素材ビンの軸で踏んだのと同じ穴なので、別ファイル版を必ず持つ。
      name: '動画クリップの元ファイル数（全部が別）',
      key: 'vids',
      values: [20, 80, 200],
      label: (v) => `${v}個`,
      base: { telops: 50, clips: 12, vidFiles: null },
      grab: 'vid'
    },
    {
      name: '動き（キーフレーム）を持つ数',
      key: 'motions',
      values: [50, 200, 500, 1000],
      label: (v) => `${v}本`,
      base: { telops: 50, clips: 1000, motionKeys: 4 },
      grab: 'clip'
    },
    {
      // 印の数は書き出しの式の長さに直に効く（`keysToExpr`）。
      // 画面が軽くても書き出しが死ぬ形があるので、別の軸にしてある。
      name: '動き1本あたりの印の数（200本で固定）',
      key: 'motionKeys',
      values: [2, 8, 30, 100],
      label: (v) => `1本 ${v}印`,
      base: { telops: 50, clips: 500, motions: 200 },
      grab: 'clip'
    },
    {
      name: '切り替え効果（エフェクト）の数',
      key: 'trans',
      values: [50, 200, 500, 1000],
      label: (v) => `${v}個`,
      base: { telops: 50, clips: 1000 },
      grab: 'clip'
    },
    {
      /**
       * **同じ時刻に重ねる。**
       *
       * 他の軸は素材を尺全体へばらけさせるので、再生ヘッドの位置には常に
       * 1〜2個しか居ない。**「200枚置いた」と「200枚同時に見えている」は
       * 別物**で、描画の重さが出るのは後者。ここだけ 0〜10秒へ寄せる。
       */
      name: '同時に見えている数（テロップ＋画像を重ねる）',
      key: 'telops',
      values: [50, 200, 500, 1000],
      label: (v) => `${v}枚が同時`,
      base: { clips: 12, imgs: 100, imgFiles: imgs1920, overlap: true },
      grab: 'scrub'
    }
  ]
}
