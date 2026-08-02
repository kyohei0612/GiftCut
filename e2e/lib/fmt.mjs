// 数の見せ方。**測定の結果は人が読むので、桁を揃える。**
//
// 前回と見比べるのが目的なので、桁が揺れると比べられない。

/** 小数 d 桁。数でなければ「—」（0 と「測れなかった」を混ぜない） */
export const fmt = (n, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : '—')
/** バイトを MB 表示に */
export const mb = (bytes) => fmt(bytes / 1024 / 1024, 1) + ' MB'
