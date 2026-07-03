import pkg from "circular-natal-horoscope-js/dist/index.js";
const { Origin, Horoscope } = pkg;

const SIGN_JA = {
  Aries: "牡羊座", Taurus: "牡牛座", Gemini: "双子座", Cancer: "蟹座",
  Leo: "獅子座", Virgo: "乙女座", Libra: "天秤座", Scorpio: "蠍座",
  Sagittarius: "射手座", Capricorn: "山羊座", Aquarius: "水瓶座", Pisces: "魚座",
};
const BODY_JA = {
  sun: "太陽", moon: "月", mercury: "水星", venus: "金星", mars: "火星",
  jupiter: "木星", saturn: "土星", uranus: "天王星", neptune: "海王星", pluto: "冥王星",
};

// 指定日時(Date)のホロスコープを返す
function chartAt(date, lat = 35.68, lon = 139.69) {
  const o = new Origin({
    year: date.getFullYear(), month: date.getMonth(), date: date.getDate(),
    hour: date.getHours(), minute: date.getMinutes(), latitude: lat, longitude: lon,
  });
  return new Horoscope({ origin: o, houseSystem: "placidus", zodiac: "tropical", language: "en" });
}

const lonOf = (h, key) => h.CelestialBodies[key].ChartPosition.Ecliptic.DecimalDegrees;
const norm = (d) => ((d % 360) + 360) % 360;

// ── 月相 ────────────────────────────────────────────────
// 太陽と月の黄経差から月齢フェーズを求める(0=新月, 180=満月)
export function moonPhase(date = new Date()) {
  const h = chartAt(date);
  const diff = norm(lonOf(h, "moon") - lonOf(h, "sun")); // 0〜360
  const names = [
    [0, "新月", "🌑", "種まき・新しい意図"],
    [45, "三日月", "🌒", "始動・小さな一歩"],
    [90, "上弦の月", "🌓", "行動・調整"],
    [135, "十三夜", "🌔", "育成・前進"],
    [180, "満月", "🌕", "結実・手放し"],
    [225, "十六夜", "🌖", "感謝・共有"],
    [270, "下弦の月", "🌗", "整理・見直し"],
    [315, "有明の月", "🌘", "休息・浄化"],
  ];
  let best = names[0];
  for (const n of names) {
    const dd = Math.min(norm(diff - n[0]), norm(n[0] - diff));
    const bd = Math.min(norm(diff - best[0]), norm(best[0] - diff));
    if (dd < bd) best = n;
  }
  const moonSign = SIGN_JA[h.CelestialBodies.moon.Sign.label];
  return { angle: diff, name: best[1], emoji: best[2], theme: best[3], moonSign };
}

// 次の新月・満月の日付を探す(前方スキャン)
export function nextMoonEvents(from = new Date(), days = 40) {
  const results = { newMoon: null, fullMoon: null };
  let prev = norm(lonOf(chartAt(from), "moon") - lonOf(chartAt(from), "sun"));
  for (let i = 1; i <= days; i++) {
    const d = new Date(from); d.setDate(d.getDate() + i);
    const cur = norm(lonOf(chartAt(d), "moon") - lonOf(chartAt(d), "sun"));
    // 0(新月)通過
    if (!results.newMoon && prev > 300 && cur < 60) results.newMoon = new Date(d);
    // 180(満月)通過
    if (!results.fullMoon && prev < 180 && cur >= 180) results.fullMoon = new Date(d);
    prev = cur;
  }
  return results;
}

// ── 二至二分(太陽黄経 0/90/180/270)──────────────────────
const SOLAR_POINTS = [
  { deg: 0, name: "春分", theme: "始まり・芽吹き" },
  { deg: 90, name: "夏至", theme: "極まり・充溢" },
  { deg: 180, name: "秋分", theme: "収穫・均衡" },
  { deg: 270, name: "冬至", theme: "内省・再生" },
];
export function nextSolarEvent(from = new Date(), days = 200) {
  let prev = lonOf(chartAt(from), "sun");
  for (let i = 1; i <= days; i++) {
    const d = new Date(from); d.setDate(d.getDate() + i);
    const cur = lonOf(chartAt(d), "sun");
    for (const p of SOLAR_POINTS) {
      const crossed = prev < p.deg && cur >= p.deg || (p.deg === 0 && prev > 300 && cur < 60);
      if (crossed) return { date: new Date(d), name: p.name, theme: p.theme };
    }
    prev = cur;
  }
  return null;
}

// ── 水星逆行 ────────────────────────────────────────────
export function mercuryRetrograde(date = new Date()) {
  return !!chartAt(date).CelestialBodies.mercury.isRetrograde;
}

// ── 象徴日(固定日付。天文的裏付けは弱い＝“そう言われている”扱い)──
const SYMBOLIC = [
  { m: 8, d: 8, name: "ライオンズゲート", theme: "覚醒・飛躍の門が開くとされる日" },
  { m: 1, d: 1, name: "元旦のリセット", theme: "一年の意図を定める" },
  { m: 11, d: 11, name: "11:11 ゲート", theme: "気づき・シンクロニシティ" },
  { m: 12, d: 12, name: "12:12 ゲート", theme: "統合・完成へ向かう" },
];
export function nextSymbolic(from = new Date(), days = 200) {
  for (let i = 0; i <= days; i++) {
    const d = new Date(from); d.setDate(d.getDate() + i);
    for (const s of SYMBOLIC) {
      if (d.getMonth() + 1 === s.m && d.getDate() === s.d) {
        return { date: new Date(d.getFullYear(), s.m - 1, s.d), name: s.name, theme: s.theme };
      }
    }
  }
  return null;
}

// ── 次の宇宙イベント(月相・二至二分・象徴日の中で最も近いもの)──
export function nextCosmicEvent(from = new Date()) {
  const cands = [];
  const mm = nextMoonEvents(from);
  if (mm.newMoon) cands.push({ date: mm.newMoon, name: "新月", emoji: "🌑", theme: "種まき・新しい意図" });
  if (mm.fullMoon) cands.push({ date: mm.fullMoon, name: "満月", emoji: "🌕", theme: "結実・手放し" });
  const solar = nextSolarEvent(from);
  if (solar) cands.push({ date: solar.date, name: solar.name, emoji: "☀", theme: solar.theme });
  const sym = nextSymbolic(from);
  if (sym) cands.push({ date: sym.date, name: sym.name, emoji: "✨", theme: sym.theme, symbolic: true });

  cands.sort((a, b) => a.date - b.date);
  const next = cands[0];
  if (!next) return null;
  const today = new Date(from); today.setHours(0, 0, 0, 0);
  const nd = new Date(next.date); nd.setHours(0, 0, 0, 0);
  next.daysUntil = Math.round((nd - today) / 86400000);
  return next;
}

// ── トランジット(今日の天体 × 出生図)────────────────────
// birthDate:"YYYY-MM-DD" / birthTime:"HH:MM"(任意) / natalCoords:[lat,lon](任意)
// 出生天体と現在天体が同じサインに重なる=響き合いとして抽出
export function computeTransits(birthDate, birthTime, natalCoords) {
  if (!birthDate) return null;
  const [y, mo, d] = birthDate.split("-").map(Number);
  const [hh, mm] = birthTime ? birthTime.split(":").map(Number) : [12, 0];
  const [lat, lon] = natalCoords || [35.68, 139.69];
  const natalH = new Horoscope({
    origin: new Origin({ year: y, month: mo - 1, date: d, hour: hh, minute: mm, latitude: lat, longitude: lon }),
    houseSystem: "placidus", zodiac: "tropical", language: "en",
  });
  const nowH = chartAt(new Date(), lat, lon);

  const wanted = ["sun", "moon", "mercury", "venus", "mars", "jupiter", "saturn", "uranus", "neptune", "pluto"];
  const natalSign = {}, natalLon = {};
  for (const k of wanted) {
    natalSign[k] = natalH.CelestialBodies[k].Sign.label;
    natalLon[k] = natalH.CelestialBodies[k].ChartPosition.Ecliptic.DecimalDegrees;
  }
  const hits = [];
  // 動きの遅い天体(火星以遠)のトランジットを、出生天体との合(オーブ6度)で拾う
  const movers = ["jupiter", "saturn", "uranus", "neptune", "pluto", "mars"];
  for (const t of movers) {
    const tl = nowH.CelestialBodies[t].ChartPosition.Ecliptic.DecimalDegrees;
    for (const n of ["sun", "moon", "mercury", "venus", "mars", "jupiter", "saturn"]) {
      let diff = Math.abs(tl - natalLon[n]);
      if (diff > 180) diff = 360 - diff;
      if (diff <= 6) {
        hits.push(`${BODY_JA[t]}が あなたの出生の${BODY_JA[n]}(${SIGN_JA[natalSign[n]]})に重なっています`);
      }
    }
  }
  const mercuryR = !!nowH.CelestialBodies.mercury.isRetrograde;

  let summary = "現在の主要トランジット:\n";
  summary += hits.length ? hits.map((h) => "・" + h).join("\n") : "・出生天体との強い重なりは今はありません";
  if (mercuryR) summary += "\n・現在は水星逆行中(見直し・再確認に向く時期)";
  return { hits, mercuryRetrograde: mercuryR, summary };
}
