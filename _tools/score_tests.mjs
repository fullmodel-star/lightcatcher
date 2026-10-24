// 402 光影獵人：評分公式／日月計算／景點資料／首頁與詳細頁一致性 測試
// 執行：node _tools/score_tests.mjs            （全部，含瀏覽器）
//       node _tools/score_tests.mjs --no-browser（只跑純函式＋資料）
// 規則來源只認：weatherMath.js 註解、更新記錄.md、README.md。文件沒寫清楚的不在這裡發明規則。
// 外部天氣 API（Open-Meteo 主預報／ensemble、CWA 代理）一律攔截改餵 _spec/fixtures 的固定資料；
// 瀏覽器裡任何非 127.0.0.1 的請求都會被擋下並記錄，最後斷言「對外連線 0 次」。
// 日出日落比對來源：中央氣象署每日天文資料 2026（_tools/fixtures/cwa_astronomy_2026.json，2026-10-24 下載後離線保存），
// 另以 NOAA 太陽位置演算法（本檔自寫，不靠 SunCalc）交叉核對高山景點。
// 已知（疑似）bug 用 bug() 記錄：會印 KNOWN-BUG，不讓整體失敗；哪天修好了會印 XPASS 提醒把它改成一般斷言。
process.env.TZ = 'Asia/Taipei';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const NO_BROWSER = process.argv.includes('--no-browser');

let pass = 0, fail = 0, knownBug = 0, xpass = 0;
const fails = [], bugs = [];
function check(name, cond, info = '') {
  if (cond) { pass++; console.log(`  ok   ${name}${info ? '  ' + info : ''}`); }
  else { fail++; fails.push(name); console.log(`  FAIL ${name}${info ? '  ' + info : ''}`); }
}
// 預期正確行為寫成 cond；目前程式不符合＝KNOWN-BUG（不計失敗）
function bug(name, cond, info = '') {
  if (cond) { xpass++; console.log(`  XPASS ${name}（已不再重現，請改成一般斷言）${info ? '  ' + info : ''}`); }
  else { knownBug++; bugs.push(name); console.log(`  KNOWN-BUG ${name}${info ? '  ' + info : ''}`); }
}
const section = (t) => console.log(`\n== ${t}`);

// ---------- 載入 App 的純函式（與 _spec/core.mjs 同一種載法） ----------
const ctx = { console };
ctx.window = ctx;
ctx.fetch = () => { throw new Error('測試不得對外連線（fetch 未攔截）'); };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'vendor', 'suncalc.js'), 'utf8'), ctx, { filename: 'suncalc.js' });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'weatherMath.js'), 'utf8'), ctx, { filename: 'weatherMath.js' });
const WM = ctx.WeatherMath;
const SC = ctx.SunCalc;
const fx = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const isInt0to100 = (v) => Number.isInteger(v) && v >= 0 && v <= 100;
const lerp = (x, x0, y0, x1, y1) => y0 + Math.max(0, Math.min(1, (x - x0) / (x1 - x0))) * (y1 - y0);

// 基準輸入（每個測試只動一個因子，其他固定）
const BASE_GLOW = { cloudLow: 5, cloudMid: 30, cloudHigh: 30, humidity: 45, visibility: 20000 };
const BASE_STARS = { cloudLow: 0, cloudMid: 0, cloudHigh: 0, humidity: 50 };
const BASE_BLUE = { cloudLow: 0, cloudMid: 0, cloudHigh: 0, humidity: 50, visibility: 20000 };
// 平地舊呼叫端（無 levels）：走 v0.19 判準，925hPa＝逆溫上緣、850hPa＝厚度
const BASE_SEA = { surfaceTemp: 15, upperTemp: 20, upperTemp850: 20.5, upperHumidity: 92, windSpeed: 1.5 };
const BASE_LIULI = { surfaceTemp: 10, upperTemp: 16, upperHumidity: 90, visibility: 1500, windSpeed: 1 };

// =====================================================================
section('[1] 火燒雲 fieryGlowScore（規則：weatherMath.js 註解＋2026-08-27 v0.9 校準）');
{
  const g = (o) => WM.fieryGlowScore(Object.assign({}, BASE_GLOW, o));
  // 低雲：≤10% 滿分、30% 剩 40、之後每 1% 扣 2 → 50% 歸零；整段不增
  const lows = [0, 10, 20, 30, 40, 50, 80, 100];
  const lowS = lows.map((v) => g({ cloudLow: v }).breakdown.lowCloud.score);
  console.log(`  樣本 低雲 ${lows.join('/')} → 子分 ${lowS.join('/')}（n=${lows.length}）`);
  check('[1a] 低雲 ≤10% 子分 100', lowS[0] === 100 && lowS[1] === 100);
  check('[1a] 低雲 30% 子分 40、50% 歸零', lowS[3] === 40 && lowS[5] === 0);
  check('[1a] 低雲越多子分不增（單調）', lowS.every((v, i) => i === 0 || v <= lowS[i - 1]));
  // 中高雲：triangleScore(midHigh, 0, 40, 80, 140)——40~80 滿分，0 與 ≥140 歸零，滿天高雲 100% 不歸零（08-27 案例）
  const mh = [[0, 0], [20, 20], [40, 0], [40, 40], [80, 60], [100, 100], [140, 0]];
  const mhS = mh.map(([m, h]) => g({ cloudMid: m, cloudHigh: h }).breakdown.midHighCloud.score);
  console.log(`  樣本 中+高雲 ${mh.map(([m, h]) => m + h).join('/')} → 子分 ${mhS.join('/')}（n=${mh.length}）`);
  check('[1b] 中高雲 0% 子分 0', mhS[0] === 0);
  check('[1b] 中高雲 40% 與 80% 都滿分（v0.16 標籤 40-80%）', mhS[2] === 100 && mhS[3] === 100);
  check('[1b] 中高雲 140% 歸零', mhS[6] === 0);
  check('[1b] 中高雲 200%（滿天）不歸零（08-27：floorHi 100→140）', mhS[5] === 0 && g({ cloudMid: 50, cloudHigh: 50 }).breakdown.midHighCloud.score === 67,
    `100%→${g({ cloudMid: 50, cloudHigh: 50 }).breakdown.midHighCloud.score}`);
  // 08-27 真實案例的方向：低雲趨近 0、中高雲 97~100%，應達大景預警（原本只有 48 分）
  const case827 = g({ cloudLow: 0, cloudMid: 50, cloudHigh: 49 });
  check('[1c] 08-27 型態（低雲 0＋中高雲 99%）觸發大景預警', case827.alert === true && case827.score > 75, `score=${case827.score}`);
  // 「完全陰天應低分」仍由低雲主導
  const overcast = g({ cloudLow: 100, cloudMid: 50, cloudHigh: 50 });
  check('[1c] 低雲也滿天（貼地陰天）低雲子分 0、不觸發預警（陰天由 lowScore 主導）', overcast.alert === false && overcast.breakdown.lowCloud.score === 0 && overcast.score < case827.score, `score=${overcast.score}`);
  // 濕度 ≤50 滿分、100 歸零；能見度 5km 歸零、15km 滿分
  check('[1d] 濕度 50% 滿分、100% 歸零、75% 一半', g({ humidity: 50 }).breakdown.humidity.score === 100 && g({ humidity: 100 }).breakdown.humidity.score === 0 && g({ humidity: 75 }).breakdown.humidity.score === 50);
  check('[1d] 能見度 5km 歸零、15km 滿分、10km 一半', g({ visibility: 5000 }).breakdown.visibility.score === 0 && g({ visibility: 15000 }).breakdown.visibility.score === 100 && g({ visibility: 10000 }).breakdown.visibility.score === 50);
  // 權重 0.35/0.35/0.15/0.15；alert 門檻 >75
  const r = g({ cloudLow: 20, cloudMid: 10, cloudHigh: 10, humidity: 80, visibility: 8000 });
  const b = r.breakdown;
  const manual = Math.round(70 * 0.35 + 50 * 0.35 + 40 * 0.15 + 30 * 0.15);
  check('[1e] 總分＝0.35低雲＋0.35中高雲＋0.15濕度＋0.15能見度（手算）', r.score === manual && b.lowCloud.weight === 0.35 && b.visibility.weight === 0.15, `score=${r.score} 手算=${manual}`);
}

// =====================================================================
section('[2] 雲海 seaOfCloudsScore（規則：註解＋2026-08-27 門檻＋v0.19／v0.22 逆溫判準）');
{
  const s = (o) => WM.seaOfCloudsScore(Object.assign({}, BASE_SEA, o));
  // 08-27：濕度滿分門檻 85→90；風速滿分窗 ≤3 m/s、≥5 歸零
  const hum = [50, 70, 85, 89, 90, 95];
  const humS = hum.map((v) => s({ upperHumidity: v }).breakdown.upperHumidity.score);
  console.log(`  樣本 925hPa濕度 ${hum.join('/')} → 子分 ${humS.join('/')}（n=${hum.length}）`);
  check('[2a] 濕度 90% 滿分、85% 不滿分（08-27 門檻）', humS[4] === 100 && humS[2] < 100 && humS[5] === 100);
  check('[2a] 濕度 50% 子分 0、越濕越高（單調）', humS[0] === 0 && humS.every((v, i) => i === 0 || v >= humS[i - 1]));
  check('[2a] 濕度跨過 90% 門檻時總分上升', s({ upperHumidity: 90 }).score > s({ upperHumidity: 85 }).score,
    `${s({ upperHumidity: 85 }).score}→${s({ upperHumidity: 90 }).score}`);
  const wind = [0, 3, 3.5, 4, 5, 10];
  const windS = wind.map((v) => s({ windSpeed: v }).breakdown.windSpeed.score);
  console.log(`  樣本 風速 ${wind.join('/')} m/s → 子分 ${windS.join('/')}（n=${wind.length}）`);
  check('[2b] 風速 ≤3 m/s 滿分、3.5 不滿分、≥5 歸零', windS[0] === 100 && windS[1] === 100 && windS[2] < 100 && windS[4] === 0 && windS[5] === 0);
  // 逆溫：地面→925hPa 溫差越大越好；>0 由 50 往 100（6°C 滿），≤0 由 50 往 0（−6°C 歸零）
  const inv = [-8, -6, -3, 0, 3, 6, 9];
  const invS = inv.map((d) => s({ upperTemp: BASE_SEA.surfaceTemp + d, upperTemp850: BASE_SEA.surfaceTemp + d + 0.5 }).breakdown.inversion.score);
  console.log(`  樣本 逆溫 ${inv.join('/')}°C → 子分 ${invS.join('/')}（n=${inv.length}）`);
  check('[2c] 逆溫 0°C 子分 50、+6°C 滿分、−6°C 歸零', invS[3] === 50 && invS[5] === 100 && invS[1] === 0);
  check('[2c] 逆溫越強子分越高（單調）', invS.every((v, i) => i === 0 || v >= invS[i - 1]));
  // 厚度：925→850 持平或續暖（≥−1°C）滿分、−6°C 歸零
  const dep = (d) => s({ upperTemp850: BASE_SEA.upperTemp + d }).breakdown.inversionDepth.score;
  check('[2d] 厚度 −1°C 以上滿分、−6°C 歸零', dep(-1) === 100 && dep(2) === 100 && dep(-6) === 0 && dep(-3.5) === 50);
  // 權重：逆溫 0.5（強度 0.7＋厚度 0.3）、濕度 0.25、風 0.25
  const r = s({ upperTemp: 18, upperTemp850: 15.5, upperHumidity: 70, windSpeed: 4 });
  const manual = Math.round((lerp(3, 0, 50, 6, 100) * 0.7 + lerp(-2.5, -6, 0, -1, 100) * 0.3) * 0.5 + 50 * 0.25 + 50 * 0.25);
  check('[2e] 總分手算一致', r.score === manual, `score=${r.score} 手算=${manual}`);
  // v0.22：高山機位下方有逆溫 → 比沒逆溫高分
  const lv = (t925, t850) => ({ surfaceTemp: 5, windSpeed: 1, surfaceElevation: 2500,
    levels: { 925: { t: t925, rh: 92, z: 800 }, 850: { t: t850, rh: 80, z: 1500 }, 700: { t: 6, rh: 60, z: 3100 }, 600: { t: 0, rh: 40, z: 4400 }, 500: { t: -8, rh: 30, z: 5800 } } });
  const withInv = WM.seaOfCloudsScore(lv(12, 16));
  const noInv = WM.seaOfCloudsScore(lv(16, 12));
  check('[2f] 機位下方有逆溫 > 沒有逆溫（v0.22）', withInv.layer.mode === 'below' && withInv.score > noInv.score && withInv.layer.hasInversion && !noInv.layer.hasInversion,
    `有=${withInv.score} 無=${noInv.score}`);
  // 缺資料 → score null＋unknown＋reason，不當 0
  const miss = [s({ windSpeed: null }), s({ surfaceTemp: null }), WM.seaOfCloudsScore({ surfaceTemp: 10, windSpeed: 1 })];
  check('[2g] 缺風速／地面氣溫／高空層 → 無法判斷（n=3）', miss.every((m) => m.score === null && m.unknown === true && m.alert === false && typeof m.reason === 'string' && m.reason.length > 0),
    miss.map((m) => m.reason).join('｜'));
}

// =====================================================================
section('[3] 觀星 starsScore（規則：註解＋2026-08-27 v0.10 加月相 25%）');
{
  const st = (o) => WM.starsScore(Object.assign({}, BASE_STARS, o));
  const moons = [0, 0.25, 0.5, 0.75, 1];
  const ms = moons.map((m) => st({ moonIllumination: m }).score);
  console.log(`  樣本 月光 ${moons.join('/')} → 觀星 ${ms.join('/')}（n=${moons.length}）`);
  check('[3a] 滿月觀星分數低於新月', ms[4] < ms[0]);
  check('[3a] 月光越亮分數越低（單調）', ms.every((v, i) => i === 0 || v <= ms[i - 1]));
  check('[3a] 新月→滿月剛好扣 25 分（月相權重 25%）', ms[0] - ms[4] === 25, `${ms[0]}→${ms[4]}`);
  check('[3a] 月光缺省視為新月（向下相容）', st({}).score === st({ moonIllumination: 0 }).score);
  check('[3a] 晴空＋滿月不觸發大景預警、晴空＋新月觸發', st({ moonIllumination: 1 }).alert === false && st({ moonIllumination: 0 }).alert === true);
  // 雲量：三層平均，0 滿分、60% 歸零；濕度 ≤60 滿分、95 歸零
  check('[3b] 平均雲量 60% 雲量子分歸零、30% 一半', st({ cloudLow: 60, cloudMid: 60, cloudHigh: 60 }).breakdown.totalCloud.score === 0 && st({ cloudLow: 30, cloudMid: 30, cloudHigh: 30 }).breakdown.totalCloud.score === 50);
  check('[3b] 濕度 60% 滿分、95% 歸零', st({ humidity: 60 }).breakdown.humidity.score === 100 && st({ humidity: 95 }).breakdown.humidity.score === 0);
  const r = st({ cloudLow: 30, cloudMid: 30, cloudHigh: 30, humidity: 77.5, moonIllumination: 0.4 });
  const manual = Math.round(50 * 0.55 + 60 * 0.25 + 50 * 0.2);
  check('[3c] 總分＝0.55雲量＋0.25月相＋0.2濕度（手算）', r.score === manual, `score=${r.score} 手算=${manual}`);
  // 與 App 串接：hourAtWindow 會依目標日期帶入 SunCalc 月相 → 同一組天氣，滿月夜分數低於新月夜
  const mk = (iso) => ({ time: [iso], cloudcover_low: [0], cloudcover_mid: [0], cloudcover_high: [0], relativehumidity_2m: [50], visibility: [20000], temperature_2m: [10], dewpoint_2m: [5], temperature_925hPa: [12], temperature_850hPa: [10], relativehumidity_925hPa: [80], windspeed_10m: [5] });
  const fullH = WM.hourAtWindow(mk('2026-10-26T20:00'), new Date('2026-10-26T20:00:00+08:00'));
  const newH = WM.hourAtWindow(mk('2026-10-10T20:00'), new Date('2026-10-10T20:00:00+08:00'));
  check('[3d] hourAtWindow 自動帶月相：10/26（氣象署「望」）分數低於 10/10（「朔」）', WM.starsScore(fullH).score < WM.starsScore(newH).score && fullH.moonIllumination > 0.95 && newH.moonIllumination < 0.05,
    `滿月 ${WM.starsScore(fullH).score}（月光 ${(fullH.moonIllumination * 100).toFixed(1)}%）／新月 ${WM.starsScore(newH).score}（${(newH.moonIllumination * 100).toFixed(1)}%）`);
}

// =====================================================================
section('[4] 藍調時刻 blueHourScore 與 琉璃光 liuliGuangScore（規則：README 2026-08 兩段＋註解）');
{
  const bl = (o) => WM.blueHourScore(Object.assign({}, BASE_BLUE, o));
  check('[4a] 平均雲量 70% 雲量子分歸零（比觀星 60% 寬鬆）', bl({ cloudLow: 70, cloudMid: 70, cloudHigh: 70 }).breakdown.totalCloud.score === 0 && WM.starsScore({ cloudLow: 65, cloudMid: 65, cloudHigh: 65, humidity: 50 }).breakdown.totalCloud.score === 0 && bl({ cloudLow: 65, cloudMid: 65, cloudHigh: 65 }).breakdown.totalCloud.score > 0);
  check('[4a] 濕度 60% 滿分、90% 歸零', bl({ humidity: 60 }).breakdown.humidity.score === 100 && bl({ humidity: 90 }).breakdown.humidity.score === 0);
  const r = bl({ cloudLow: 35, cloudMid: 35, cloudHigh: 35, visibility: 10000, humidity: 75 });
  check('[4a] 總分＝0.5雲量＋0.3能見度＋0.2濕度（手算）', r.score === Math.round(50 * 0.5 + 50 * 0.3 + 50 * 0.2), `score=${r.score}`);
  const li = (o) => WM.liuliGuangScore(Object.assign({}, BASE_LIULI, o));
  const vis = [100, 300, 500, 1500, 3000, 4500, 6000, 20000];
  const visS = vis.map((v) => li({ visibility: v }).breakdown.visibility.score);
  console.log(`  樣本 琉璃光能見度 ${vis.join('/')} m → 子分 ${visS.join('/')}（n=${vis.length}）`);
  check('[4b] 琉璃光能見度 500~3000m 滿分、≤100 與 ≥6000 歸零（三角形，非越低越好）', visS[2] === 100 && visS[3] === 100 && visS[4] === 100 && visS[0] === 0 && visS[6] === 0 && visS[7] === 0);
  check('[4b] 乘法：能見度 0 分 → 總分 0（不被逆溫平均掉）', li({ visibility: 20000 }).score === 0 && li({}).score > 50);
  check('[4b] 乘法：沒有逆溫（−6°C）→ 總分 0', li({ upperTemp: BASE_LIULI.surfaceTemp - 6 }).score === 0);
  const strong = li({ windSpeed: 10 }), calm = li({ windSpeed: 1 });
  check('[4b] 強風保底 0.6 倍、不歸零', strong.score === Math.round(calm.score * 0.6) && strong.score > 0, `靜風 ${calm.score}／強風 ${strong.score}`);
  check('[4c] 琉璃光缺能見度／風速 → 無法判斷', li({ visibility: null }).score === null && li({ windSpeed: undefined }).score === null);
  check('[4d] LCL＝125×(氣溫−露點)，負值歸 0', WM.lclHeightAGL(20, 12) === 1000 && WM.lclHeightAGL(10, 12) === 0 && WM.cloudBaseAMSL({ surfaceTemp: 20, dewpoint: 12 }, 2000).amslM === 3000);
}

// =====================================================================
section('[5] 分數範圍與缺資料（隨機輸入 → 0~100 整數或 null，不得 NaN／Infinity）');
{
  let seed = 20261024;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const R = (a, b) => a + (b - a) * rnd();
  const N = 3000;
  const bad = {};
  const fns = ['fieryGlowScore', 'seaOfCloudsScore', 'starsScore', 'blueHourScore', 'liuliGuangScore'];
  fns.forEach((f) => { bad[f] = 0; });
  let nullCount = 0, total = 0;
  for (let i = 0; i < N; i++) {
    const ground = rnd() < 0.5 ? R(0, 300) : R(500, 3900);
    const t0 = R(-15, 35);
    const levels = rnd() < 0.3 ? undefined : {
      925: { t: t0 + R(-8, 8), rh: R(0, 100), z: R(600, 900) }, 850: { t: t0 + R(-12, 6), rh: R(0, 100), z: R(1350, 1600) },
      700: { t: t0 + R(-20, 2), rh: R(0, 100), z: R(2900, 3200) }, 600: { t: t0 + R(-28, 0), rh: R(0, 100), z: R(4100, 4500) },
      500: { t: t0 + R(-35, -5), rh: R(0, 100), z: R(5500, 5900) } };
    const h = { cloudLow: R(0, 100), cloudMid: R(0, 100), cloudHigh: R(0, 100), humidity: R(0, 100), visibility: R(0, 80000),
      surfaceTemp: t0, dewpoint: t0 - R(0, 20), upperTemp: t0 + R(-8, 8), upperTemp850: t0 + R(-12, 6), upperHumidity: R(0, 100),
      windSpeed: R(0, 30), surfaceElevation: levels ? ground : undefined, levels, moonIllumination: rnd() };
    fns.forEach((f) => {
      const r = WM[f](h);
      total++;
      if (r.score === null) { nullCount++; if (r.alert !== false || !r.reason) bad[f]++; return; }
      const subs = Object.values(r.breakdown).map((x) => x.score);
      // alert＝原始分數 >75：四捨五入後 ≥76 一定要亮、≤74 一定不亮（75 兩者皆可能）
      const alertBad = (r.score >= 76 && r.alert !== true) || (r.score <= 74 && r.alert !== false);
      if (!isInt0to100(r.score) || alertBad ||
        subs.some((v) => v !== null && !(Number.isFinite(v) && v >= 0 && v <= 100))) bad[f]++;
    });
  }
  console.log(`  樣本 ${N} 組隨機輸入 × ${fns.length} 個公式 = ${total} 次（其中 null＝無法判斷 ${nullCount} 次）`);
  fns.forEach((f) => check(`[5a] ${f} 分數皆為 0~100 整數或 null、子分數有限且在 0~100`, bad[f] === 0, `違規 ${bad[f]}/${N}`));
  // 極端值
  const ext = [
    WM.fieryGlowScore({ cloudLow: 0, cloudMid: 0, cloudHigh: 0, humidity: 0, visibility: 1e9 }),
    WM.fieryGlowScore({ cloudLow: 100, cloudMid: 100, cloudHigh: 100, humidity: 100, visibility: 0 }),
    WM.starsScore({ cloudLow: 100, cloudMid: 100, cloudHigh: 100, humidity: 100, moonIllumination: 1 }),
    WM.blueHourScore({ cloudLow: 100, cloudMid: 100, cloudHigh: 100, humidity: 100, visibility: 0 }),
    WM.seaOfCloudsScore({ surfaceTemp: 40, upperTemp: -40, upperTemp850: -60, upperHumidity: 0, windSpeed: 60 }),
    WM.liuliGuangScore({ surfaceTemp: -30, upperTemp: 30, upperHumidity: 100, visibility: 1500, windSpeed: 0 })
  ];
  check('[5b] 極端輸入仍在 0~100（n=6）', ext.every((r) => isInt0to100(r.score)), ext.map((r) => r.score).join('/'));

  // 缺資料：雲海／琉璃光有「無法判斷」設計（v0.19 起：缺資料不當 0）；火燒雲／觀星／藍調沒有
  const allNull = { cloudLow: null, cloudMid: null, cloudHigh: null, humidity: null, visibility: null, surfaceTemp: null, dewpoint: null, windSpeed: null };
  check('[5c] 全部欄位 null：雲海、琉璃光 → score null（無法判斷）', WM.seaOfCloudsScore(allNull).score === null && WM.liuliGuangScore(allNull).score === null);
  const nullScores = ['fieryGlowScore', 'starsScore', 'blueHourScore'].map((f) => [f, WM[f](allNull)]);
  console.log(`  缺資料時：${nullScores.map(([f, r]) => `${f}=${r.score}${r.alert ? '（大景預警）' : ''}`).join('、')}`);
  bug('[5d] 全部欄位 null：火燒雲／觀星／藍調不應給出看似正常的分數（應比照雲海回「無法判斷」）', nullScores.every(([, r]) => r.score === null));
  bug('[5d] 全部欄位 null：觀星不應亮「大景預警」', !WM.starsScore(allNull).alert, `starsScore(null)=${WM.starsScore(allNull).score}, alert=${WM.starsScore(allNull).alert}`);
  const undef = ['fieryGlowScore', 'starsScore', 'blueHourScore'].map((f) => WM[f]({}).score);
  bug('[5e] 欄位不存在（undefined）時分數不應是 NaN', undef.every((v) => !Number.isNaN(v)), `得到 ${undef.map(String).join('/')}`);
  // 資料層：Open-Meteo 的逐時欄位是 null（API 回空值）時，hourAtWindow 會把 null 當 0
  const om = fx('_spec/fixtures/om_lowland_2026-10-19.json');
  const hh = JSON.parse(JSON.stringify(om.hourly));
  Object.keys(hh).forEach((k) => { if (k !== 'time') hh[k] = hh[k].map(() => null); });
  const hn = WM.hourAtWindow(hh, new Date('2026-10-20T17:00:00+08:00'));
  bug('[5f] API 逐時值全是 null 時，hourAtWindow 不應把 null 平均成 0（雲量 0%＝萬里無雲的假象）', hn.cloudLow === null || Number.isNaN(hn.cloudLow),
    `cloudLow=${hn.cloudLow} humidity=${hn.humidity} → 觀星 ${WM.starsScore(hn).score}／火燒雲 ${WM.fieryGlowScore(hn).score}／藍調 ${WM.blueHourScore(hn).score}`);
  check('[5f] 同一份 null 資料：雲海仍判無法判斷', WM.seaOfCloudsScore(hn).score === null);
}

// =====================================================================
section('[6] 黃金／藍調時刻定義（v0.19：藍調 −6°~−4°、黃金 −4°~+6°、night −18°）用 SunCalc 太陽高度角回驗');
{
  const deg = (r) => r * 180 / Math.PI;
  const places = [['台北', 25.0375, 121.5637], ['武嶺', 24.1371, 121.2757], ['墾丁龍磐', 21.9216, 120.8547]];
  const dates = ['2026-01-15', '2026-03-20', '2026-06-21', '2026-09-23', '2026-12-21'];
  let n = 0, worst = 0, chained = 0;
  const expect = { dawnBlueStart: -6, dawnBlueEnd: -4, dawnGoldenEnd: 6, duskGoldenStart: 6, duskBlueStart: -4, duskBlueEnd: -6, night: -18 };
  places.forEach(([, lat, lng]) => dates.forEach((d) => {
    const t = WM.getGoldenBlueHours(new Date(d + 'T12:00:00+08:00'), lat, lng);
    const got = { dawnBlueStart: t.dawnBlue.start, dawnBlueEnd: t.dawnBlue.end, dawnGoldenEnd: t.dawnGolden.end, duskGoldenStart: t.duskGolden.start, duskBlueStart: t.duskBlue.start, duskBlueEnd: t.duskBlue.end, night: t.night };
    Object.entries(expect).forEach(([k, a]) => {
      const alt = deg(SC.getPosition(got[k], lat, lng).altitude);
      worst = Math.max(worst, Math.abs(alt - a)); n++;
    });
    if (t.dawnBlue.end.getTime() === t.dawnGolden.start.getTime() && t.duskGolden.end.getTime() === t.duskBlue.start.getTime()) chained++;
  }));
  // SunCalc.getTimes 本身與 getPosition 有約 0.2°（≈1 分鐘）的內部近似誤差，容許 0.35°
  check('[6a] 各時段邊界的太陽高度角與定義相差 ≤0.35°', worst <= 0.35, `n=${n}，最大偏差 ${worst.toFixed(3)}°`);
  check('[6b] 藍調與黃金時刻首尾相接、不重疊', chained === places.length * dates.length, `${chained}/${places.length * dates.length}`);
}

// =====================================================================
section('[7] 日出日落／曙暮光 vs 中央氣象署 2026 天文資料（全年逐日）');
const CWA = fx('_tools/fixtures/cwa_astronomy_2026.json');
{
  // 氣象署沒公開各縣市用的代表點；用縣市政府座標（台北市政府、南投縣政府、屏東縣政府）。
  const AREAS = { TaipeiCity: [25.0375, 121.5637], NantouCounty: [23.9029, 120.6906], PingtungCounty: [22.6830, 120.4880] };
  const toMin = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  const localMin = (d) => { const p = new Date(d.getTime() + 8 * 3600000); return p.getUTCHours() * 60 + p.getUTCMinutes() + p.getUTCSeconds() / 60; };
  Object.entries(AREAS).forEach(([area, [lat, lng]]) => {
    const days = CWA.areas[area].days;
    const stats = { sr: [], ss: [], lCr: [], lCs: [], lAs: [] };
    Object.entries(days).forEach(([date, rec]) => {
      const t = WM.getGoldenBlueHours(new Date(date + 'T12:00:00+08:00'), lat, lng);
      const app = { sr: t.sunrise, ss: t.sunset, lCr: t.dawnBlue.start, lCs: t.duskBlue.end, lAs: t.night };
      Object.keys(stats).forEach((k) => { if (rec[k] && /^\d\d:\d\d$/.test(rec[k])) stats[k].push(localMin(app[k]) - toMin(rec[k])); });
    });
    const desc = Object.entries(stats).map(([k, arr]) => {
      const max = Math.max(...arr.map(Math.abs)), mean = arr.reduce((a, b) => a + b, 0) / arr.length;
      return { k, n: arr.length, max, mean };
    });
    console.log(`  ${CWA.areas[area].label}：` + desc.map((d) => `${d.k} n=${d.n} 平均${d.mean >= 0 ? '+' : ''}${d.mean.toFixed(2)}分 最大|差|${d.max.toFixed(2)}分`).join('；'));
    // 氣象署表格到分（捨入方式未說明）＋代表點座標不明＋SunCalc 本身系統性晚約 1 分鐘 → 容許 3 分鐘；
    // 南投縣幅員大（縣府在西緣，氣象署代表點不明），容許 4 分鐘。另要求全年差值的變動幅度 ≤3 分鐘（表格到分捨入本身就占 1 分鐘幅度；確認是固定偏移、不會隨季節亂跳）。
    const tol = area === 'NantouCounty' ? 4 : 3;
    check(`[7] ${CWA.areas[area].label} 日出日落全年 |差| ≤${tol} 分鐘`, desc[0].n >= 360 && desc[1].n >= 360 && desc[0].max <= tol && desc[1].max <= tol);
    check(`[7] ${CWA.areas[area].label} 民用曙暮光（App 藍調起訖 −6°）與天文暮光終（App 觀星 night −18°）|差| ≤${tol} 分鐘`, desc.slice(2).every((d) => d.n >= 360 && d.max <= tol));
    const spread = Math.max(...Object.values(stats).map((arr) => Math.max(...arr) - Math.min(...arr)));
    check(`[7] ${CWA.areas[area].label} 全年差值變動幅度 ≤3 分鐘（固定偏移）`, spread <= 3, `幅度 ${spread.toFixed(2)} 分`);
  });
}

section('[8] 高山景點（武嶺）SunCalc vs 自寫 NOAA 演算法；海拔效應');
{
  const rad = Math.PI / 180;
  // NOAA（Meeus）日出日落：zenith 90.833°（含大氣折射＋日面半徑），回傳 UTC 分鐘（距該 UTC 日 00:00）
  function noaa(dateUTC0, lat, lng, zenith, rising) {
    let t = 720 - 4 * lng; // 第一次猜：太陽正午
    for (let it = 0; it < 3; it++) {
      const jd = dateUTC0 / 86400000 + 2440587.5 + t / 1440;
      const jc = (jd - 2451545) / 36525;
      const L0 = (280.46646 + jc * (36000.76983 + jc * 0.0003032)) % 360;
      const M = 357.52911 + jc * (35999.05029 - 0.0001537 * jc);
      const e = 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc);
      const C = Math.sin(M * rad) * (1.914602 - jc * (0.004817 + 0.000014 * jc)) + Math.sin(2 * M * rad) * (0.019993 - 0.000101 * jc) + Math.sin(3 * M * rad) * 0.000289;
      const om = 125.04 - 1934.136 * jc;
      const lam = L0 + C - 0.00569 - 0.00478 * Math.sin(om * rad);
      const eps0 = 23 + (26 + (21.448 - jc * (46.815 + jc * (0.00059 - jc * 0.001813))) / 60) / 60;
      const eps = eps0 + 0.00256 * Math.cos(om * rad);
      const dec = Math.asin(Math.sin(eps * rad) * Math.sin(lam * rad));
      const y = Math.tan(eps * rad / 2) ** 2;
      const eqt = 4 / rad * (y * Math.sin(2 * L0 * rad) - 2 * e * Math.sin(M * rad) + 4 * e * y * Math.sin(M * rad) * Math.cos(2 * L0 * rad) - 0.5 * y * y * Math.sin(4 * L0 * rad) - 1.25 * e * e * Math.sin(2 * M * rad));
      const ha = Math.acos(Math.cos(zenith * rad) / (Math.cos(lat * rad) * Math.cos(dec)) - Math.tan(lat * rad) * Math.tan(dec)) / rad;
      t = 720 - 4 * lng - eqt + (rising ? -4 * ha : 4 * ha);
    }
    return dateUTC0 + t * 60000;
  }
  const lat = 24.1371, lng = 121.2757;
  let n = 0, worst = 0;
  const diffs = [];
  for (let m = 0; m < 12; m++) {
    const d = `2026-${String(m + 1).padStart(2, '0')}-15`;
    const t = WM.getGoldenBlueHours(new Date(d + 'T12:00:00+08:00'), lat, lng);
    const u0 = Date.parse(d + 'T00:00:00Z');
    const sr = noaa(u0 - 86400000, lat, lng, 90.833, true); // 台灣日出在前一個 UTC 日 21~22 時
    const srFix = Math.abs(sr - t.sunrise) > 12 * 3600000 ? noaa(u0, lat, lng, 90.833, true) : sr;
    const ss = noaa(u0, lat, lng, 90.833, false);
    const a = (t.sunrise - srFix) / 60000, b = (t.sunset - ss) / 60000;
    diffs.push(a.toFixed(2), b.toFixed(2));
    worst = Math.max(worst, Math.abs(a), Math.abs(b)); n += 2;
  }
  check('[8a] 武嶺每月 15 日日出日落：SunCalc 與 NOAA 演算法相差 ≤2.5 分鐘', worst <= 2.5, `n=${n}，最大 ${worst.toFixed(2)} 分（差值 ${diffs.slice(0, 6).join(',')}…）`);
  // 海拔：App 呼叫 SunCalc.getTimes 沒帶 height，3275m 機位實際地平線下沉 ~2°，日出會更早
  const d = new Date('2026-10-20T12:00:00+08:00');
  const flat = SC.getTimes(d, lat, lng), high = SC.getTimes(d, lat, lng, 3275);
  const app = WM.getGoldenBlueHours(d, lat, lng);
  const early = (flat.sunrise - high.sunrise) / 60000;
  console.log(`  武嶺 10/20 日出：App ${app.sunrise.toISOString()}；SunCalc 帶 3275m 會早 ${early.toFixed(1)} 分鐘（App 未帶海拔，屬「規則不明」，不判對錯）`);
  check('[8b] App 日出＝SunCalc 海平面日出（確認目前不考慮海拔）', app.sunrise.getTime() === flat.sunrise.getTime() && early > 5);
}

section('[9] 月相 vs 中央氣象署 2026「望／朔」日期');
{
  const full = CWA.moon.full, nw = CWA.moon.new;
  const fr = full.map((d) => SC.getMoonIllumination(new Date(d + 'T12:00:00+08:00')).fraction);
  const nr = nw.map((d) => SC.getMoonIllumination(new Date(d + 'T12:00:00+08:00')).fraction);
  console.log(`  望 n=${full.length}，SunCalc 照亮比例最低 ${(Math.min(...fr) * 100).toFixed(1)}%；朔 n=${nw.length}，最高 ${(Math.max(...nr) * 100).toFixed(1)}%`);
  check('[9a] 氣象署「望」那天中午照亮比例 ≥95%', full.length >= 12 && fr.every((f) => f >= 0.95));
  check('[9a] 氣象署「朔」那天中午照亮比例 ≤5%', nw.length >= 12 && nr.every((f) => f <= 0.05));
  // 望日附近 ±3 天，望日（或前後一天）是最大值
  let peakOk = 0;
  full.forEach((d) => {
    const base = Date.parse(d + 'T12:00:00+08:00');
    const vals = [-3, -2, -1, 0, 1, 2, 3].map((k) => SC.getMoonIllumination(new Date(base + k * 86400000)).fraction);
    const iMax = vals.indexOf(Math.max(...vals));
    if (Math.abs(iMax - 3) <= 1) peakOk++;
  });
  check('[9b] 望日 ±1 天內是照亮比例的極大值', peakOk === full.length, `${peakOk}/${full.length}`);
}

// =====================================================================
section('[10] data/spots.json 景點資料');
const SPOTS = fx('data/spots.json').spots;
{
  console.log(`  景點筆數 ${SPOTS.length}（一個地點多種現象各一筆），不同地點 ${new Set(SPOTS.map((s) => `${s.name}|${s.lat}|${s.lng}`)).size} 處`);
  const TYPES = new Set(['sunrise', 'sunset', 'sea_of_clouds', 'stars', 'liuli_guang']);
  const badField = SPOTS.filter((s) => !(typeof s.name === 'string' && s.name.trim() && Number.isFinite(s.lat) && Number.isFinite(s.lng) && TYPES.has(s.type) && Number.isFinite(s.min_elevation)));
  check('[10a] 每筆都有 name／lat／lng／type（五種之一）／min_elevation', SPOTS.length > 0 && badField.length === 0, `缺欄位 ${badField.length}/${SPOTS.length}`);
  // 台灣本島＋澎湖＋綠島蘭嶼＋金門馬祖：緯 21.85~26.40、經 118.10~122.10；本島外的點另外列出供人工確認
  const out = SPOTS.filter((s) => !(s.lat >= 21.85 && s.lat <= 26.4 && s.lng >= 118.1 && s.lng <= 122.1));
  check('[10b] 座標都在台灣（含金馬澎）範圍', out.length === 0, out.map((s) => `${s.name}(${s.lat},${s.lng})`).join('、') || `n=${SPOTS.length}`);
  const offMain = SPOTS.filter((s) => !(s.lat >= 21.85 && s.lat <= 25.35 && s.lng >= 119.95 && s.lng <= 122.05));
  console.log(`  本島外景點 ${offMain.length} 筆：${[...new Set(offMain.map((s) => s.name))].join('、')}`);
  check('[10c] 海拔 0~3952m（玉山）且為整數公尺', SPOTS.every((s) => s.min_elevation >= 0 && s.min_elevation <= 3952), `範圍 ${Math.min(...SPOTS.map((s) => s.min_elevation))}~${Math.max(...SPOTS.map((s) => s.min_elevation))}`);
  // 沒有 id 欄位：App 以 name|lat|lng 分組、以 type 區分現象 → 用 (name,type) 當唯一鍵
  const hasId = SPOTS.some((s) => 'id' in s);
  const keys = SPOTS.map((s) => `${s.name}|${s.type}`);
  const dup = keys.filter((k, i) => keys.indexOf(k) !== i);
  console.log(`  備註：spots.json 沒有 id 欄位（hasId=${hasId}），以「名稱＋現象」當唯一鍵`);
  check('[10d] 「名稱＋現象」不重複', dup.length === 0, dup.join('、') || `n=${keys.length}`);
  const byName = {};
  SPOTS.forEach((s) => { (byName[s.name] = byName[s.name] || new Set()).add(`${s.lat},${s.lng},${s.min_elevation}`); });
  const split = Object.entries(byName).filter(([, v]) => v.size > 1).map(([k]) => k);
  check('[10e] 同名景點的座標與海拔一致（否則首頁會拆成兩個地點）', split.length === 0, split.join('、') || `地點 ${Object.keys(byName).length}`);
  const seedRows = (fs.readFileSync(path.join(ROOT, 'seed.sql'), 'utf8').match(/^\s*\(\s*'/gm) || []).length;
  check('[10f] 筆數與 seed.sql 資料列一致（spots.json 由 seed.sql 產生）', seedRows === SPOTS.length, `seed.sql ${seedRows} 列`);
}

// =====================================================================
async function browserTests() {
  section('[11] 瀏覽器：首頁「今日推薦」vs 詳細頁「大景機率」同景點同時刻分數一致（v0.11 修過的 bug）＋缺資料畫面');
  const require = createRequire(import.meta.url);
  const puppeteer = require('C:/Users/c0787/Desktop/App專案/02_其他App/700_學習計畫日曆/node_modules/puppeteer-core');
  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
  const server = http.createServer((req, res) => {
    const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let f = path.join(ROOT, u === '/' ? 'index.html' : u);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  console.log(`  本機伺服器 127.0.0.1:${port}`);

  const OM_HIGH = fx('_spec/fixtures/om_wuling_2026-10-19.json');
  const OM_LOW = fx('_spec/fixtures/om_lowland_2026-10-19.json');
  const ENS = fx('_spec/fixtures/ens_wuling_2026-10-19.json');
  const elevOf = (lat, lng) => { const s = SPOTS.find((x) => Math.abs(x.lat - lat) < 1e-4 && Math.abs(x.lng - lng) < 1e-4); return s ? s.min_elevation : 0; };
  // 情境：real＝原始 fixture（高山用武嶺、其餘用平地）；good＝把雲量／濕度改成依座標變化的好天氣（讓推薦有多個景點）；
  // null＝所有逐時數值改成 null（API 回空值）；e500＝API 回 500
  function forecastFor(scenario, lat, lng) {
    const base = JSON.parse(JSON.stringify(elevOf(lat, lng) >= 1500 ? OM_HIGH : OM_LOW));
    base.latitude = lat; base.longitude = lng;
    const H = base.hourly;
    if (scenario === 'good') {
      const k = Math.abs(Math.round(lat * 1000 + lng * 100)) % 7;
      H.cloudcover_low = H.time.map(() => k);
      H.cloudcover_mid = H.time.map(() => 10 + k * 4);
      H.cloudcover_high = H.time.map(() => 15 + k * 3);
      H.relativehumidity_2m = H.time.map(() => 35 + k * 5);
      H.visibility = H.time.map(() => 24000);
    } else if (scenario === 'night') {
      // 萬里無雲但能見度只有 3km：藍調能見度子分 0、火燒雲中高雲 0 → 觀星勝出（讓推薦涵蓋觀星）
      ['cloudcover_low', 'cloudcover_mid', 'cloudcover_high'].forEach((key) => { H[key] = H.time.map(() => 0); });
      H.relativehumidity_2m = H.time.map(() => 40);
      H.visibility = H.time.map(() => 3000);
    } else if (scenario === 'null') {
      Object.keys(H).forEach((key) => { if (key !== 'time') H[key] = H[key].map(() => null); });
    }
    return base;
  }
  const external = [];
  let omCalls = 0;

  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-first-run', '--no-default-browser-check'] });
  const FIXED_NOW = Date.parse('2026-10-19T14:00:00+08:00'); // fixture 範圍 10/19 00:00 ~ 10/22 23:00（台北）

  async function openPage(scenario) {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    await page.emulateTimezone('Asia/Taipei');
    await page.setBypassServiceWorker(true);
    await page.setViewport({ width: 412, height: 900 });
    await page.evaluateOnNewDocument((fixed) => {
      const RealDate = Date;
      const offset = fixed - RealDate.now();
      class FakeDate extends RealDate {
        constructor(...a) { if (a.length === 0) super(RealDate.now() + offset); else super(...a); }
        static now() { return RealDate.now() + offset; }
      }
      FakeDate.parse = RealDate.parse; FakeDate.UTC = RealDate.UTC;
      window.Date = FakeDate;
    }, FIXED_NOW);
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const u = new URL(req.url());
      if (u.hostname === '127.0.0.1') return req.continue();
      if (u.hostname === 'api.open-meteo.com') {
        omCalls++;
        if (scenario === 'e500') return req.respond({ status: 500, contentType: 'application/json', body: '{"error":true}', headers: { 'Access-Control-Allow-Origin': '*' } });
        const lats = u.searchParams.get('latitude').split(',').map(Number), lngs = u.searchParams.get('longitude').split(',').map(Number);
        const arr = lats.map((la, i) => forecastFor(scenario, la, lngs[i]));
        return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(arr.length === 1 ? arr[0] : arr), headers: { 'Access-Control-Allow-Origin': '*' } });
      }
      if (u.hostname === 'ensemble-api.open-meteo.com') return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(ENS), headers: { 'Access-Control-Allow-Origin': '*' } });
      if (u.hostname === 'lightcatcher-cwa.fullmodel.workers.dev') return req.respond({ status: 200, contentType: 'application/json', body: '{"stations":[]}', headers: { 'Access-Control-Allow-Origin': '*' } });
      if (u.protocol === 'data:' || u.protocol === 'blob:') return req.continue();
      external.push(req.url());
      return req.abort();
    });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${port}/?nosplash`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => { const b = document.getElementById('dailyPicksBody'); return b && !/掃描全台景點中/.test(b.textContent); }, { timeout: 20000 });
    return { context, page, errors };
  }

  // 等詳細頁畫完：weatherStatus 變「已更新」或錯誤訊息，且 #blueHourScoreLine 有儀表
  async function waitDetail(page) {
    await page.waitForFunction(() => {
      const s = document.getElementById('weatherStatus').textContent;
      return /已更新|⚠️/.test(s) && (document.querySelector('#blueHourScoreLine .gbox') || /⚠️/.test(s));
    }, { timeout: 20000 });
    await new Promise((r) => setTimeout(r, 300));
  }
  const readGauges = (page) => page.evaluate(() => [...document.querySelectorAll('#blueHourScoreLine .gbox')].map((b) => ({
    label: b.querySelector('.gl').textContent.trim(), sc: b.querySelector('.sc').textContent.trim(), st: (b.querySelector('.st') || {}).textContent || '' })));

  // 獨立第三方：用 window.WeatherMath 直接算（14:00 的「下一次」＝今天傍晚黃金／今晚入夜／今天傍晚藍調／明天清晨黃金）
  const independent = (page, p) => page.evaluate(async (p) => {
    const WM = window.WeatherMath;
    const now = new Date();
    const tmr = new Date(now); tmr.setDate(tmr.getDate() + 1);
    const T = WM.getGoldenBlueHours(now, p.lat, p.lng), T1 = WM.getGoldenBlueHours(tmr, p.lat, p.lng);
    const target = { glow: T.duskGolden.start, stars: T.night, liuli: T.night, blue: T.duskBlue.start, sea: T1.dawnGolden.start }[p.kind];
    const fn = { glow: WM.fieryGlowScore, stars: WM.starsScore, liuli: WM.liuliGuangScore, blue: WM.blueHourScore, sea: WM.seaOfCloudsScore }[p.kind];
    const data = await WM.fetchHourlyWeather(p.lat, p.lng);
    return fn(WM.hourAtWindow(data.hourly, target)).score;
  }, p);

  const LABEL = { glow: '火燒雲', sea: '雲海', stars: '觀星', blue: '藍調時刻', liuli: '琉璃光' };
  const KIND_BY_LABEL = Object.fromEntries(Object.entries(LABEL).map(([k, v]) => [v, k]));

  const kindsSeen = new Set();
  for (const scenario of ['real', 'good', 'night']) {
    const { context, page, errors } = await openPage(scenario);
    const picks = await page.evaluate(() => [...document.querySelectorAll('#dailyPicksBody .pick')].map((el) => ({
      name: el.querySelector('.pick-name').textContent.trim(), chip: el.querySelector('.sc-chip').textContent.trim() })));
    const parsed = picks.map((p) => { const m = /^(.+?) (\d+) 分$/.exec(p.chip); return { name: p.name, label: m && m[1], kind: m && KIND_BY_LABEL[m[1]], score: m ? Number(m[2]) : NaN }; });
    const stat = await page.evaluate(() => ({ spots: document.getElementById('statSpots').textContent, alerts: document.getElementById('statAlerts').textContent, body: document.getElementById('dailyPicksBody').textContent.trim().slice(0, 60) }));
    console.log(`  情境 ${scenario}：掃描 ${stat.spots} 處、達預警 ${stat.alerts} 處；推薦 ${parsed.map((p) => `${p.name} ${p.label} ${p.score}`).join('、') || '（無）— ' + stat.body}`);
    let compared = 0, same = 0;
    const detailLog = [];
    for (let i = 0; i < parsed.length; i++) {
      const p = parsed[i];
      const spot = SPOTS.find((s) => s.name === p.name);
      await page.evaluate(() => { document.getElementById('blueHourScoreLine').innerHTML = ''; document.getElementById('weatherStatus').textContent = ''; });
      await page.evaluate((i) => document.querySelector(`#dailyPicksBody button[data-pick="${i}"]`).click(), i);
      await waitDetail(page);
      let detail = null;
      if (p.kind === 'blue') {
        // 藍調不在大景機率儀表裡，畫在天色時鐘四格的「傍晚藍調」（14:00 的下一段藍調＝今天傍晚）
        detail = await page.evaluate(() => {
          const cell = [...document.querySelectorAll('#dialCells .cell')].find((c) => c.textContent.includes('傍晚藍調'));
          const b = cell && cell.querySelector('.sc-chip b'); return b ? Number(b.textContent) : null;
        });
      } else if (p.kind === 'stars') {
        const g = (await readGauges(page)).find((x) => x.label.includes(LABEL[p.kind]));
        const track = await page.evaluate(() => { const el = [...document.querySelectorAll('#trackFacts div')].find((d) => d.textContent.includes('觀星')); const b = el && el.querySelector('b'); return b ? Number(b.textContent) : null; });
        detail = g ? Number(g.sc) : null;
        check(`[11b] ${scenario} ${p.name} 觀星：日月軌跡「觀星」格＝儀表分數`, track === detail, `軌跡 ${track}／儀表 ${detail}`);
      } else {
        const g = (await readGauges(page)).find((x) => x.label.includes(LABEL[p.kind]));
        detail = g ? Number(g.sc) : null;
      }
      const ind = await independent(page, { lat: spot.lat, lng: spot.lng, kind: p.kind });
      compared++; kindsSeen.add(p.kind);
      if (detail === p.score && ind === p.score) same++;
      detailLog.push(`${p.name}/${p.label} 首頁 ${p.score}｜詳細頁 ${detail}｜直接重算 ${ind}`);
      check(`[11a] ${scenario} ${p.name} ${p.label}：首頁推薦分數＝詳細頁分數＝直接重算`, detail === p.score && ind === p.score, `首頁 ${p.score}／詳細頁 ${detail}／重算 ${ind}`);
    }
    console.log(`  情境 ${scenario} 比對樣本 n=${compared}（一致 ${same}）`);
    if (scenario === 'good') check('[11a] good 情境至少比對 3 個推薦（防空集合假通過）', compared >= 3, `n=${compared}`);
    const heading = await page.evaluate(() => [...document.querySelectorAll('h2')].some((h) => h.textContent.includes('機率預測（現在此刻）')));
    check(`[11c] ${scenario} 「現在此刻」卡片標題仍標明（v0.11 說明）`, heading);
    const txt = await page.evaluate(() => document.getElementById('mainEl').innerText);
    check(`[11d] ${scenario} 畫面沒有 NaN／Infinity／undefined`, !/NaN|Infinity|undefined/.test(txt));
    check(`[11e] ${scenario} 沒有頁面 JS 錯誤`, errors.length === 0, errors.slice(0, 2).join(' | '));
    await context.close();
  }

  console.log(`  推薦比對涵蓋的現象：${[...kindsSeen].map((k) => LABEL[k]).join('、')}`);
  check('[11a] 推薦比對至少涵蓋 3 種現象', kindsSeen.size >= 3, [...kindsSeen].join(','));

  // ---- 詳細頁每個儀表 vs 直接重算（涵蓋推薦沒出現的雲海、琉璃光）----
  {
    const { context, page } = await openPage('real');
    let n = 0, ok = 0;
    const log = [];
    for (const name of ['武嶺', '金龍山', '小笠原山']) {
      await page.evaluate(() => { document.getElementById('blueHourScoreLine').innerHTML = ''; document.getElementById('weatherStatus').textContent = ''; });
      await page.evaluate((name) => { const b = [...document.querySelectorAll('#spotChips .chip')].find((c) => c.textContent.trim().endsWith(name)); b.click(); }, name);
      await waitDetail(page);
      const spot = SPOTS.find((s) => s.name === name);
      for (const g of await readGauges(page)) {
        const kind = Object.keys(LABEL).find((k) => g.label.includes(LABEL[k]));
        const ind = await independent(page, { lat: spot.lat, lng: spot.lng, kind });
        const shown = g.sc === '?' ? null : Number(g.sc);
        n++; if (shown === ind) ok++;
        log.push(`${name}/${LABEL[kind]} 儀表 ${g.sc}｜重算 ${ind}`);
      }
    }
    console.log('  ' + log.join('；'));
    check('[11o] 詳細頁「大景機率」每個儀表＝直接重算（含雲海、琉璃光）', n >= 7 && ok === n, `${ok}/${n}`);
    await context.close();
  }

  // ---- 缺資料：API 逐時值全是 null ----
  {
    const { context, page, errors } = await openPage('null');
    const pickText = await page.evaluate(() => document.getElementById('dailyPicksBody').textContent.trim());
    const picks = await page.evaluate(() => [...document.querySelectorAll('#dailyPicksBody .pick')].map((el) => el.textContent.replace(/\s+/g, ' ').trim()));
    bug('[11f] API 回空值時，今日推薦不應列出「大景預警」景點', picks.length === 0, `推薦 ${picks.length} 筆：${picks.slice(0, 3).join('｜') || pickText.slice(0, 40)}`);
    // 選武嶺（雲海＋日落＋星空）
    await page.evaluate(() => { const b = [...document.querySelectorAll('#spotChips .chip')].find((c) => c.textContent.includes('武嶺')); b.click(); });
    await waitDetail(page);
    const g = await readGauges(page);
    console.log(`  null 情境 武嶺儀表：${g.map((x) => `${x.label}=${x.sc}${x.st ? '(' + x.st + ')' : ''}`).join('、')}（n=${g.length}）`);
    const sea = g.find((x) => x.label.includes('雲海'));
    check('[11g] 缺資料時雲海儀表顯示「?／無法判斷」（不是假分數）', g.length >= 3 && sea && sea.sc === '?' && /無法判斷/.test(sea.st));
    const others = g.filter((x) => !x.label.includes('雲海'));
    bug('[11h] 缺資料時火燒雲／觀星儀表也應顯示「無法判斷」而不是分數', others.length > 0 && others.every((x) => x.sc === '?' || x.sc === '—'), others.map((x) => `${x.label}=${x.sc}`).join('、'));
    const txt = await page.evaluate(() => document.getElementById('mainEl').innerText);
    check('[11i] 缺資料時畫面沒有 NaN／Infinity／undefined', !/NaN|Infinity|undefined/.test(txt));
    const alt = await page.evaluate(() => { const a = document.querySelector('#blueHourScoreLine .alt'); return a ? a.innerText.replace(/\s+/g, ' ') : ''; });
    bug('[11j] 缺氣溫／露點時不應畫出「雲層高度＝地面高度」的估算', !/雲層高度（估）/.test(alt), alt.slice(0, 80));
    check('[11k] null 情境沒有頁面 JS 錯誤', errors.length === 0, errors.slice(0, 2).join(' | '));
    await context.close();
  }

  // ---- API 失敗（HTTP 500）----
  {
    const { context, page, errors } = await openPage('e500');
    const pickText = await page.evaluate(() => document.getElementById('dailyPicksBody').textContent.trim());
    check('[11l] API 500：今日推薦顯示「推薦計算失敗」而非分數', /推薦計算失敗/.test(pickText) && !/\d+ 分/.test(pickText), pickText.slice(0, 40));
    await page.evaluate(() => { const b = [...document.querySelectorAll('#spotChips .chip')].find((c) => c.textContent.includes('武嶺')); b.click(); });
    await waitDetail(page);
    const st = await page.evaluate(() => ({ s: document.getElementById('weatherStatus').textContent, gauges: document.querySelectorAll('#blueHourScoreLine .gbox').length, cards: document.querySelectorAll('#scoreCards .score-card').length }));
    check('[11m] API 500：詳細頁顯示忙碌訊息、沒有畫出任何分數儀表或卡片', /氣象服務暫時忙碌/.test(st.s) && st.gauges === 0 && st.cards === 0, `${st.s.slice(0, 30)}… 儀表 ${st.gauges} 卡片 ${st.cards}`);
    check('[11n] e500 情境沒有頁面 JS 錯誤', errors.length === 0, errors.slice(0, 2).join(' | '));
    await context.close();
  }

  await browser.close();
  await new Promise((r) => server.close(r));
  console.log(`  攔截的 Open-Meteo 主預報請求 ${omCalls} 次（全部餵 fixture）`);
  check('[11z] 測試期間對外連線 0 次（非 127.0.0.1 一律攔下）', external.length === 0, external.slice(0, 5).join(' , ') || '0');
}

if (!NO_BROWSER) {
  try { await browserTests(); }
  catch (e) { fail++; fails.push('[11] 瀏覽器測試執行失敗'); console.log('  FAIL [11] 瀏覽器測試執行失敗：' + (e && e.stack || e)); }
}

console.log(`\n結果：${pass} 通過、${fail} 失敗、${knownBug} 個已知疑似 bug（KNOWN-BUG，不計失敗）${xpass ? `、${xpass} 個 XPASS` : ''}`);
if (fails.length) console.log('失敗：\n  ' + fails.join('\n  '));
if (bugs.length) console.log('已知疑似 bug：\n  ' + bugs.join('\n  '));
process.exit(fail ? 1 : 0);
