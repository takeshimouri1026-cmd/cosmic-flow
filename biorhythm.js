// バイオリズム計算ユーティリティ
// 身体(23日) / 感情(28日) / 知性(33日) の正弦波サイクル

const CYCLES = {
  physical: { period: 23, label: "身体", color: "#E8A87C" },
  emotional: { period: 28, label: "感情", color: "#C38D9E" },
  intellectual: { period: 33, label: "知性", color: "#85C7DE" },
};

// 直感サイクル(38日)も「覚醒状態」の補助指標として使う
const INTUITION = { period: 38, label: "直感", color: "#D4AF6A" };

function daysBetween(a, b) {
  const ms = b.setHours(0, 0, 0, 0) - new Date(a).setHours(0, 0, 0, 0);
  return Math.round(ms / 86400000);
}

// ある日付における各サイクルの値(-1.0 〜 1.0)を返す
export function biorhythmAt(birthDate, targetDate) {
  const days = daysBetween(birthDate, new Date(targetDate));
  const v = (period) => Math.sin((2 * Math.PI * days) / period);
  return {
    physical: v(CYCLES.physical.period),
    emotional: v(CYCLES.emotional.period),
    intellectual: v(CYCLES.intellectual.period),
    intuition: v(INTUITION.period),
  };
}

// 今週(月曜〜日曜)のデータ配列を生成
export function weekData(birthDate, centerDate = new Date()) {
  const out = [];
  const day = centerDate.getDay(); // 0=日, 1=月, ..., 6=土
  const diffToMonday = day === 0 ? -6 : 1 - day;
  for (let offset = 0; offset <= 6; offset++) {
    const d = new Date(centerDate);
    d.setDate(d.getDate() + diffToMonday + offset);
    const b = biorhythmAt(birthDate, d);
    out.push({
      offset: diffToMonday + offset,
      date: d,
      label: `${d.getMonth() + 1}/${d.getDate()}`,
      weekday: ["日", "月", "火", "水", "木", "金", "土"][d.getDay()],
      physical: Math.round(b.physical * 100),
      emotional: Math.round(b.emotional * 100),
      intellectual: Math.round(b.intellectual * 100),
      intuition: Math.round(b.intuition * 100),
    });
  }
  return out;
}

// 「総合エネルギー」= 3サイクルの平均(運気の流れの可視化用)
export function overallEnergy(b) {
  return (b.physical + b.emotional + b.intellectual) / 3;
}

// 「覚醒スコア」= 直感と知性が高く揃っているほど高い(0〜100)
export function awakeningScore(b) {
  const aligned = (b.intuition + b.intellectual) / 2;
  return Math.round(((aligned + 1) / 2) * 100);
}

export { CYCLES, INTUITION };
