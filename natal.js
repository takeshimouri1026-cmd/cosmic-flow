import pkg from "circular-natal-horoscope-js/dist/index.js";
const { Origin, Horoscope } = pkg;

// 都道府県 → 県庁所在地のおおよその緯度経度(占星術は数十kmの誤差で十分)
export const PREFECTURES = {
  "北海道": [43.0642, 141.3469], "青森県": [40.8244, 140.7400], "岩手県": [39.7036, 141.1527],
  "宮城県": [38.2688, 140.8721], "秋田県": [39.7186, 140.1024], "山形県": [38.2404, 140.3633],
  "福島県": [37.7503, 140.4676], "茨城県": [36.3418, 140.4468], "栃木県": [36.5657, 139.8836],
  "群馬県": [36.3911, 139.0608], "埼玉県": [35.8569, 139.6489], "千葉県": [35.6051, 140.1233],
  "東京都": [35.6895, 139.6917], "神奈川県": [35.4478, 139.6425], "新潟県": [37.9026, 139.0236],
  "富山県": [36.6953, 137.2114], "石川県": [36.5947, 136.6256], "福井県": [36.0652, 136.2216],
  "山梨県": [35.6642, 138.5684], "長野県": [36.6513, 138.1810], "岐阜県": [35.3912, 136.7223],
  "静岡県": [34.9769, 138.3831], "愛知県": [35.1802, 136.9066], "三重県": [34.7303, 136.5086],
  "滋賀県": [35.0045, 135.8686], "京都府": [35.0214, 135.7556], "大阪府": [34.6863, 135.5200],
  "兵庫県": [34.6913, 135.1830], "奈良県": [34.6851, 135.8329], "和歌山県": [34.2261, 135.1675],
  "鳥取県": [35.5036, 134.2383], "島根県": [35.4723, 133.0505], "岡山県": [34.6618, 133.9344],
  "広島県": [34.3966, 132.4596], "山口県": [34.1859, 131.4706], "徳島県": [34.0658, 134.5593],
  "香川県": [34.3401, 134.0434], "愛媛県": [33.8417, 132.7657], "高知県": [33.5597, 133.5311],
  "福岡県": [33.6064, 130.4181], "佐賀県": [33.2494, 130.2989], "長崎県": [32.7448, 129.8737],
  "熊本県": [32.7898, 130.7417], "大分県": [33.2382, 131.6126], "宮崎県": [31.9111, 131.4239],
  "鹿児島県": [31.5602, 130.5581], "沖縄県": [26.2124, 127.6809],
};

const SIGN_JA = {
  Aries: "牡羊座", Taurus: "牡牛座", Gemini: "双子座", Cancer: "蟹座",
  Leo: "獅子座", Virgo: "乙女座", Libra: "天秤座", Scorpio: "蠍座",
  Sagittarius: "射手座", Capricorn: "山羊座", Aquarius: "水瓶座", Pisces: "魚座",
};

const BODY_JA = {
  sun: "太陽", moon: "月", mercury: "水星", venus: "金星", mars: "火星",
  jupiter: "木星", saturn: "土星", uranus: "天王星", neptune: "海王星", pluto: "冥王星",
};

// birthDate: "YYYY-MM-DD" / birthTime: "HH:MM"(任意) / prefecture: 都道府県名(任意)
// 戻り値: { hasTime, hasPlace, sun, moon, ascendant, bodies:[{name,sign}], summary }
export function computeNatal(birthDate, birthTime, prefecture) {
  if (!birthDate) return null;
  const [y, mo, d] = birthDate.split("-").map(Number);
  const hasTime = !!birthTime;
  const hasPlace = !!(prefecture && PREFECTURES[prefecture]);
  const [hh, mm] = hasTime ? birthTime.split(":").map(Number) : [12, 0];
  const [lat, lon] = hasPlace ? PREFECTURES[prefecture] : [35.6895, 139.6917]; // 既定は東京

  const origin = new Origin({
    year: y, month: mo - 1, date: d, hour: hh, minute: mm,
    latitude: lat, longitude: lon,
  });
  const h = new Horoscope({ origin, houseSystem: "placidus", zodiac: "tropical", language: "en" });

  const ja = (label) => SIGN_JA[label] || label;
  const wanted = ["sun", "moon", "mercury", "venus", "mars", "jupiter", "saturn", "uranus", "neptune", "pluto"];
  const bodies = h.CelestialBodies.all
    .filter((b) => wanted.includes(b.key))
    .map((b) => ({ name: BODY_JA[b.key] || b.label, sign: ja(b.Sign.label) }));

  const sun = ja(h.CelestialBodies.sun.Sign.label);
  const moon = ja(h.CelestialBodies.moon.Sign.label);
  const ascendant = hasTime ? ja(h.Ascendant.Sign.label) : null;

  // モデルへ渡す要約文
  let summary = `太陽星座: ${sun}座 / 月星座: ${moon}座`;
  if (ascendant) summary += ` / アセンダント(上昇宮): ${ascendant}座`;
  summary += "\n天体配置: " + bodies.map((b) => `${b.name}=${b.sign}`).join("、");
  if (!hasTime) summary += "\n(出生時刻が未入力のため、月星座は前後する可能性・アセンダント/ハウスは未算出)";
  if (!hasPlace) summary += "\n(出生地が未入力のため、東京を仮定して算出)";

  return { hasTime, hasPlace, sun, moon, ascendant, bodies, summary };
}
