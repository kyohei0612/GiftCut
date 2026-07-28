// 更新をいつ当てるか。
//
// 「起動したら勝手に新しくなって、勝手に再起動する」のが望ましい形。
// ただし **編集中の内容を巻き添えにしてはいけない**。再起動は今やっている
// 作業を確実に中断するので、当てていい時と、待つべき時を分ける。
//
// 待つべき時:
//   - 書き出し中      … 途中で落とすと、数十分の変換がまるごと無駄になる
//   - 未保存の変更あり … 自動保存の下書きはあるが、復帰の手間を勝手に押し付けない
//
// どちらでもなければ、少しだけ間を置いて（気づけるように）再起動する。

export interface BusyState {
  /** 未保存の変更があるか */
  dirty: boolean
  /** 書き出し中か */
  exporting: boolean
}

export interface UpdatePlan {
  /** now = すぐ再起動して当てる / onQuit = 次にアプリを閉じたときに当てる */
  when: 'now' | 'onQuit'
  /** 画面に出す説明。何が起きるのかを、起きる前に伝える */
  message: string
  /** now のとき、再起動までの秒数（0 なら即） */
  countdownSec: number
}

/** 更新の準備ができたときに、どうするかを決める */
export function planUpdate(state: BusyState, version = ''): UpdatePlan {
  const v = version ? `${version} ` : ''
  if (state.exporting) {
    return {
      when: 'onQuit',
      message: `更新 ${v}を用意しました。書き出し中なので、次にアプリを閉じたときに新しくします。`,
      countdownSec: 0
    }
  }
  if (state.dirty) {
    return {
      when: 'onQuit',
      message: `更新 ${v}を用意しました。保存していない変更があるので、次にアプリを閉じたときに新しくします。`,
      countdownSec: 0
    }
  }
  return {
    when: 'now',
    message: `更新 ${v}を用意しました。5秒後に再起動します。`,
    countdownSec: 5
  }
}
