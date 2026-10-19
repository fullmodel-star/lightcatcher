// 守門測試：weatherMath.js 純函式。node _spec/core.mjs 執行。
// 2026-10-19：fixture 的 Open-Meteo 時間是台北當地時間（timezone=auto），固定時區讓測試在任何機器上結果一致
process.env.TZ = 'Asia/Taipei';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const ctx = { console };
ctx.window = ctx;
ctx.fetch = () => { throw new Error('fetch not stubbed in this test'); };
vm.createContext(ctx);

vm.runInContext(fs.readFileSync(path.join(root, 'vendor', 'suncalc.js'), 'utf8'), ctx, { filename: 'suncalc.js' });
vm.runInContext(fs.readFileSync(path.join(root, 'weatherMath.js'), 'utf8'), ctx, { filename: 'weatherMath.js' });

const WM = ctx.WeatherMath;
let pass = 0, fail = 0;

function check(name, cond) {
  if (cond) { pass++; }
  else { fail++; console.error(`FAIL: ${name}`); }
}

// [1] 黃金/藍調時刻順序（台北，夏季，正常晝夜，應該四個時刻依序遞增）
{
  const times = WM.getGoldenBlueHours(new Date('2026-06-21T00:00:00Z'), 25.03, 121.56);
  check('[1] dawnBlue < dawnGolden', times.dawnBlue.start < times.dawnGolden.start);
  check('[1] dawnGolden < duskGolden', times.dawnGolden.start < times.duskGolden.start);
  check('[1] duskGolden < duskBlue', times.duskGolden.start < times.duskBlue.start);
}

// [2] 火燒雲指數：理想條件應該高分，惡劣條件應該低分，且都要落在0-100
{
  const good = WM.fieryGlowScore({ cloudLow: 5, cloudMid: 30, cloudHigh: 25, humidity: 40, visibility: 20000 });
  const bad = WM.fieryGlowScore({ cloudLow: 100, cloudMid: 100, cloudHigh: 100, humidity: 100, visibility: 0 });
  check('[2] 理想條件高分', good.score > 70);
  check('[2] 惡劣條件低分', bad.score < 30);
  check('[2] good.score 落在0-100', good.score >= 0 && good.score <= 100);
  check('[2] bad.score 落在0-100', bad.score >= 0 && bad.score <= 100);
  check('[2] 理想條件觸發alert', good.alert === true);
}

// [3] 雲海指數：逆溫(兩層都暖)+高濕+微風應該高分；無逆溫+強風應該低分
{
  const good = WM.seaOfCloudsScore({ surfaceTemp: 15, upperTemp: 20, upperTemp850: 20.5, upperHumidity: 90, windSpeed: 1.5 });
  const bad = WM.seaOfCloudsScore({ surfaceTemp: 20, upperTemp: 15, upperTemp850: 9, upperHumidity: 30, windSpeed: 8 });
  check('[3] 逆溫微風高分', good.score > 70);
  check('[3] 無逆溫強風低分', bad.score < 20);
  check('[3] good.score 落在0-100', good.score >= 0 && good.score <= 100);
  check('[3] bad.score 落在0-100', bad.score >= 0 && bad.score <= 100);
}

// [3b] 雲海濕度/風速門檻校準(2026-08-27，查證香港天文台+台灣山友部落格後調整)：
// 90%濕度+3m/s風速應給滿分；85%濕度、3.5m/s風速不應再是滿分(舊門檻是85%/2m/s)
{
  const atNewThreshold = WM.seaOfCloudsScore({ surfaceTemp: 15, upperTemp: 20, upperTemp850: 20.5, upperHumidity: 90, windSpeed: 3 });
  const belowNewThreshold = WM.seaOfCloudsScore({ surfaceTemp: 15, upperTemp: 20, upperTemp850: 20.5, upperHumidity: 85, windSpeed: 3.5 });
  check('[3b] 90%濕度給滿分', atNewThreshold.breakdown.upperHumidity.score === 100);
  check('[3b] 3m/s風速給滿分', atNewThreshold.breakdown.windSpeed.score === 100);
  check('[3b] 85%濕度不再是滿分', belowNewThreshold.breakdown.upperHumidity.score < 100);
  check('[3b] 3.5m/s風速不再是滿分', belowNewThreshold.breakdown.windSpeed.score < 100);
}

// [4] 反向斷言：分數函式不可回傳 NaN（邊界值0/100全都要能算）
{
  const edge1 = WM.fieryGlowScore({ cloudLow: 0, cloudMid: 0, cloudHigh: 0, humidity: 0, visibility: 0 });
  const edge2 = WM.seaOfCloudsScore({ surfaceTemp: 0, upperTemp: 0, upperTemp850: 0, upperHumidity: 0, windSpeed: 0 });
  check('[4] fieryGlow邊界值非NaN', !Number.isNaN(edge1.score));
  check('[4] seaOfClouds邊界值非NaN', !Number.isNaN(edge2.score));
}

// [7] 逆溫層厚度：850hPa續暖(厚逆溫)應該比850hPa快速轉冷(薄逆溫)分數高，
// 即使兩者在925hPa的逆溫強度(inv1)完全一樣
{
  const thick = WM.seaOfCloudsScore({ surfaceTemp: 15, upperTemp: 20, upperTemp850: 21, upperHumidity: 70, windSpeed: 3 });
  const thin = WM.seaOfCloudsScore({ surfaceTemp: 15, upperTemp: 20, upperTemp850: 12, upperHumidity: 70, windSpeed: 3 });
  check('[7] 厚逆溫分數高於薄逆溫', thick.score > thin.score);
  check('[7] breakdown有inversionDepth欄位', typeof thick.breakdown.inversionDepth.score === 'number');
}

// [8] hourAtWindow：時間窗內取平均，窗外的資料不應該被算進去
{
  const hourly = {
    time: ['2026-08-24T06:00', '2026-08-24T07:00', '2026-08-24T08:00', '2026-08-24T09:00'],
    cloudcover_low: [0, 20, 40, 100],
    cloudcover_mid: [0, 0, 0, 0],
    cloudcover_high: [0, 0, 0, 0],
    relativehumidity_2m: [50, 50, 50, 50],
    visibility: [10000, 10000, 10000, 10000],
    temperature_2m: [20, 20, 20, 20],
    dewpoint_2m: [10, 10, 10, 10],
    temperature_925hPa: [20, 20, 20, 20],
    temperature_850hPa: [20, 20, 20, 20],
    relativehumidity_925hPa: [50, 50, 50, 50],
    windspeed_10m: [7.2, 7.2, 7.2, 7.2] // 2 m/s
  };
  // 中心點08:00，±1小時應該只平均07:00/08:00/09:00 = (20+40+100)/3 = 53.33
  const h = WM.hourAtWindow(hourly, new Date('2026-08-24T08:00'), 1);
  check('[8] 時間窗平均排除窗外的06:00', Math.abs(h.cloudLow - 53.333) < 0.01);
  const hSingle = WM.hourAt(hourly, 2);
  check('[8] hourAt單點取值不變(仍為08:00的40)', hSingle.cloudLow === 40);
}

// [5] 觀星指數：晴空+新月高分、滿天雲+滿月低分，且都落在0-100
{
  const good = WM.starsScore({ cloudLow: 0, cloudMid: 0, cloudHigh: 0, humidity: 40, moonIllumination: 0 });
  const bad = WM.starsScore({ cloudLow: 100, cloudMid: 100, cloudHigh: 100, humidity: 95, moonIllumination: 1 });
  check('[5] 晴空高分', good.score > 70);
  check('[5] 滿天雲低分', bad.score < 20);
  check('[5] good.score 落在0-100', good.score >= 0 && good.score <= 100);
  check('[5] bad.score 落在0-100', bad.score >= 0 && bad.score <= 100);
}

// [5e] 月相因子(2026-08-27新增，查證Clear Sky Chart+Bortle Scale後加入)：
// 其他因子相同時，滿月應該比新月低分；沒給moonIllumination時應視為新月(不扣分)
{
  const newMoon = WM.starsScore({ cloudLow: 0, cloudMid: 0, cloudHigh: 0, humidity: 40, moonIllumination: 0 });
  const fullMoon = WM.starsScore({ cloudLow: 0, cloudMid: 0, cloudHigh: 0, humidity: 40, moonIllumination: 1 });
  const noMoonData = WM.starsScore({ cloudLow: 0, cloudMid: 0, cloudHigh: 0, humidity: 40 });
  check('[5e] 新月分數高於滿月', newMoon.score > fullMoon.score);
  check('[5e] 缺月相資料時視為新月', noMoonData.score === newMoon.score);
}

// [5b] 藍調時刻指數：晴空高分、滿天雲低分，且都落在0-100
{
  const good = WM.blueHourScore({ cloudLow: 0, cloudMid: 0, cloudHigh: 0, humidity: 40, visibility: 15000 });
  const bad = WM.blueHourScore({ cloudLow: 100, cloudMid: 100, cloudHigh: 100, humidity: 95, visibility: 2000 });
  check('[5b] 晴空高分', good.score > 70);
  check('[5b] 滿天雲低分', bad.score < 20);
  check('[5b] good.score 落在0-100', good.score >= 0 && good.score <= 100);
  check('[5b] bad.score 落在0-100', bad.score >= 0 && bad.score <= 100);
}

// [5c] 琉璃光指數：有逆溫+能見度落在甜蜜區間(500-3000m)+無風應該高分；
// 完全無逆溫(晴空)或能見度太差(濃到看不見)都應該低分，且都落在0-100
{
  const good = WM.liuliGuangScore({ upperTemp: 20, surfaceTemp: 10, visibility: 1500, windSpeed: 1 });
  const noInversion = WM.liuliGuangScore({ upperTemp: 10, surfaceTemp: 20, visibility: 1500, windSpeed: 1 });
  const tooFoggy = WM.liuliGuangScore({ upperTemp: 20, surfaceTemp: 10, visibility: 50, windSpeed: 1 });
  check('[5c] 逆溫+適中霧況高分', good.score > 70);
  check('[5c] 沒有逆溫(晴空)低分', noInversion.score < 40);
  check('[5c] 霧太濃(能見度太差)低分', tooFoggy.score < 20);
  check('[5c] good.score 落在0-100', good.score >= 0 && good.score <= 100);
}

// [6] 雲海高度估算(LCL)：氣溫露點差越大，雲底越高；差為0時應為0(飽和/貼地霧)
{
  const dry = WM.lclHeightAGL(25, 10); // 差15度
  const saturated = WM.lclHeightAGL(20, 20); // 差0度
  check('[6] 乾燥時雲底高於飽和時', dry > saturated);
  check('[6] 飽和時雲底為0', saturated === 0);
  check('[6] 125倍公式正確', dry === 125 * 15);

  const amsl = WM.cloudBaseAMSL({ surfaceTemp: 25, dewpoint: 15 }, 500);
  check('[6] AMSL = 地面高程 + AGL', amsl.amslM === 500 + amsl.aglM);
}

// [9] ensembleConfidence：成員分歧大應該給寬的信心區間、低信心；
// 成員全部一致應該給窄區間、高信心
{
  function fakeEnsembleHourly(cloudLowByMember) {
    const n = cloudLowByMember.length;
    const hourly = { time: ['2026-08-24T12:00'] };
    const fields = ['cloudcover_mid', 'cloudcover_high', 'relativehumidity_2m', 'visibility',
      'temperature_2m', 'dewpoint_2m', 'temperature_925hPa', 'temperature_850hPa',
      'relativehumidity_925hPa', 'windspeed_10m'];
    for (let m = 1; m <= n; m++) {
      const suffix = `_member${String(m).padStart(2, '0')}`;
      hourly['cloudcover_low' + suffix] = [cloudLowByMember[m - 1]];
      fields.forEach((f) => { hourly[f + suffix] = [f === 'temperature_925hPa' ? 20 : f === 'temperature_2m' ? 15 : 50]; });
    }
    return hourly;
  }
  const diverse = fakeEnsembleHourly([0, 20, 40, 60, 100]);
  const uniform = fakeEnsembleHourly([50, 50, 50, 50, 50]);
  const confDiverse = WM.ensembleConfidence(diverse, 0, WM.starsScore);
  const confUniform = WM.ensembleConfidence(uniform, 0, WM.starsScore);
  check('[9] 成員分歧時區間較寬', confDiverse.spread > confUniform.spread);
  check('[9] 成員一致時信心為高', confUniform.level === '高');
  check('[9] memberCount正確', confDiverse.memberCount === 5);
}

// [10] 火燒雲中高雲甜蜜區間：UI 因子標籤要跟公式實際滿分區間一致（2026-10-12：標籤曾停在舊的 40-70%）
{
  const sub = (mh) => WM.fieryGlowScore({ cloudLow: 0, cloudMid: mh, cloudHigh: 0, humidity: 40, visibility: 20000 }).breakdown.midHighCloud.score;
  const lo = 40, hi = 80;
  check('[10] 下緣 40% 滿分', sub(lo) === 100);
  check('[10] 上緣 80% 滿分', sub(hi) === 100);
  check('[10] 低於下緣不滿分', sub(lo - 5) < 100);
  check('[10] 高於上緣不滿分', sub(hi + 5) < 100);
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  check('[10] UI 標籤寫 40-80%最佳', html.includes(`中高雲量(${lo}-${hi}%最佳)`));
  check('[10] UI 沒殘留舊的 40-70%', !html.includes('中高雲量(40-70%'));
}

// ===== 2026-10-19 v0.19 三個計算修正（老闆裁示）＋ 天色時鐘 UI 守門 =====
const fx = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));
const html19 = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// [11] ensemble 空值不可當滿分：缺資料的成員不列入信心區間，全缺就回 unavailable
{
  // 11a 合成資料：10 組成員，3 組雲量是 null、7 組有值 → 只用 7 組算區間
  const n = 10;
  const hourly = { time: ['2026-10-20T19:00'] };
  const lows = [0, 10, 20, 30, 40, 50, 60, null, null, null];
  for (let m = 1; m <= n; m++) {
    const sfx = `_member${String(m).padStart(2, '0')}`;
    hourly['cloudcover_low' + sfx] = [lows[m - 1]];
    hourly['cloudcover_mid' + sfx] = [lows[m - 1] === null ? null : 0];
    hourly['cloudcover_high' + sfx] = [lows[m - 1] === null ? null : 0];
    hourly['relativehumidity_2m' + sfx] = [50];
  }
  const conf = WM.ensembleConfidence(hourly, 0, WM.starsScore);
  // 用 App 自己的 starsScore 重算 7 組有效成員，p10/p90 照 ensembleConfidence 的取法
  const moon = ctx.SunCalc.getMoonIllumination(new Date(hourly.time[0])).fraction;
  const valid = lows.filter((v) => v !== null)
    .map((v) => WM.starsScore({ cloudLow: v, cloudMid: 0, cloudHigh: 0, humidity: 50, moonIllumination: moon }).score)
    .sort((a, b) => a - b);
  const p10 = valid[Math.floor(valid.length * 0.1)];
  const p90 = valid[Math.min(valid.length - 1, Math.ceil(valid.length * 0.9))];
  console.log(`[11a] 有效 ${conf.used}/${conf.memberCount} 組，區間 ${conf.p10}~${conf.p90}（重算 ${p10}~${p90}，樣本 ${valid.join(',')}）`);
  check('[11a] 只用有值的 7 組', conf.used === 7 && conf.skipped === 3 && conf.memberCount === 10);
  check('[11a] p10/p90 與重算一致', conf.p10 === p10 && conf.p90 === p90);
  check('[11a] 樣本數非 0（防空集合假通過）', valid.length === 7);

  // 11b 合成資料：全部成員雲量 null → 不可算出「信心高」，要回 unavailable 並列出缺的欄位
  const allNull = { time: ['2026-10-20T19:00'] };
  for (let m = 1; m <= 8; m++) {
    const sfx = `_member${String(m).padStart(2, '0')}`;
    ['cloudcover_low', 'cloudcover_mid', 'cloudcover_high', 'visibility'].forEach((f) => { allNull[f + sfx] = [null]; });
    allNull['relativehumidity_2m' + sfx] = [40];
  }
  const c2 = WM.ensembleConfidence(allNull, 0, WM.fieryGlowScore);
  check('[11b] 全缺雲量 → unavailable', c2 && c2.unavailable === true && c2.used === 0);
  check('[11b] 不會再給 level（舊版會給「高」）', c2 && c2.level === undefined);
  check('[11b] 缺的欄位有列出低雲量與能見度', c2 && c2.missingLabels.includes('低雲量') && c2.missingLabels.includes('能見度'));

  // 11c 真實資料：武嶺 2026-10-19 抓的 icon_seamless ensemble（雲量／能見度／氣壓層全是 null）
  const ens = fx('ens_wuling_2026-10-19.json');
  ens.hourly.surface_elevation = ens.elevation;
  const memberKeys = Object.keys(ens.hourly).filter((k) => /^cloudcover_low_member/.test(k));
  const nullCount = memberKeys.reduce((s, k) => s + ens.hourly[k].filter((v) => v === null).length, 0);
  console.log(`[11c] 武嶺 ensemble：${memberKeys.length} 組成員、低雲 null ${nullCount} 筆`);
  check('[11c] fixture 真的有成員（防空集合）', memberKeys.length > 30 && nullCount > 0);
  ['fieryGlowScore', 'starsScore', 'seaOfCloudsScore', 'blueHourScore'].forEach((fn) => {
    const c = WM.ensembleConfidence(ens.hourly, 10, WM[fn]);
    check(`[11c] 武嶺真實 ensemble ${fn} → 無法計算`, c && c.unavailable === true && c.memberCount === memberKeys.length && c.used === 0);
  });
  check('[11c] 畫面有「無法計算」的說明句', html19.includes('模型信心：無法計算'));
}

// [12] 機位高於 925hPa 不可判逆溫：改用機位上方的氣壓層，挑不到就「無法判斷」
{
  // 12a 武嶺（API 地面 3275m）：925/850/700hPa 都在地面以下 → 應改用 600hPa（高度約 4475m）→ 500hPa
  const om = fx('om_wuling_2026-10-19.json');
  om.hourly.surface_elevation = om.elevation;
  const target = new Date('2026-10-20T05:41:32+08:00'); // 武嶺 10/20 晨間黃金（−4°）＝雲海目標時刻
  const h = WM.hourAtWindow(om.hourly, target);
  const sea = WM.seaOfCloudsScore(h);
  // 手算：時間窗 05:00、06:00 兩筆平均
  const idx = om.hourly.time.map((t, i) => [t, i]).filter(([t]) => Math.abs(new Date(t) - target) <= 3600000).map(([, i]) => i);
  const avg = (k) => idx.reduce((s, i) => s + om.hourly[k][i], 0) / idx.length;
  const t2m = avg('temperature_2m'), t600 = avg('temperature_600hPa'), t500 = avg('temperature_500hPa'), rh600 = avg('relativehumidity_600hPa');
  const wind = avg('windspeed_10m') / 3.6;
  const inv1 = t600 - t2m, inv2 = t500 - t600;
  const lerp = (x, x0, y0, x1, y1) => y0 + Math.max(0, Math.min(1, (x - x0) / (x1 - x0))) * (y1 - y0);
  const s1 = inv1 > 0 ? lerp(inv1, 0, 50, 6, 100) : lerp(inv1, -6, 0, 0, 50);
  const s2 = inv2 >= -1 ? 100 : lerp(inv2, -6, 0, -1, 100);
  const sh = rh600 >= 90 ? 100 : lerp(rh600, 50, 0, 90, 100);
  const sw = wind <= 3 ? 100 : wind >= 5 ? 0 : lerp(wind, 3, 100, 5, 0);
  const manual = Math.round((s1 * 0.7 + s2 * 0.3) * 0.5 + sh * 0.25 + sw * 0.25);
  const old925 = avg('temperature_925hPa') - t2m;
  console.log(`[12a] 武嶺 窗口 ${idx.length} 筆：地面 ${t2m.toFixed(2)}°C、600hPa ${t600.toFixed(2)}°C（${Math.round(avg('geopotential_height_600hPa'))}m）→ 逆溫 ${inv1.toFixed(2)}；舊算法 925hPa 差 ${old925.toFixed(1)}°C；分數 ${sea.score}（手算 ${manual}）`);
  check('[12a] 窗口有 2 筆資料', idx.length === 2);
  check('[12a] 925／700hPa 在地面以下', avg('geopotential_height_925hPa') < om.elevation && avg('geopotential_height_700hPa') < om.elevation);
  check('[12a] 改用 600hPa 當逆溫上緣', sea.breakdown.inversion.to === '600hPa' && sea.breakdown.inversionDepth.to === '500hPa');
  check('[12a] 逆溫值＝600hPa−地面（不是 925hPa 的假 23.9）', near(sea.breakdown.inversion.value, inv1, 1e-9) && !near(sea.breakdown.inversion.value, old925, 1));
  check('[12a] 分數與手算一致', sea.score === manual);

  // 12b 平地（API 地面 15m）：925hPa 在上方 → 結果必須跟舊公式完全相同（不影響平地景點）
  const lo = fx('om_lowland_2026-10-19.json');
  lo.hourly.surface_elevation = lo.elevation;
  const hl = WM.hourAtWindow(lo.hourly, target);
  const newS = WM.seaOfCloudsScore(hl);
  const legacyS = WM.seaOfCloudsScore(Object.assign({}, hl, { levels: undefined, surfaceElevation: undefined }));
  console.log(`[12b] 平地 ${lo.elevation}m：新 ${newS.score}／舊 ${legacyS.score}，上緣 ${newS.breakdown.inversion.to}`);
  check('[12b] 平地仍用 925hPa', newS.breakdown.inversion.to === '925hPa');
  check('[12b] 平地分數與舊公式相同', newS.score === legacyS.score && Number.isFinite(newS.score));

  // 12c 沒有氣壓層高度的舊資料＋地面 2000m（高於標準大氣 925/850hPa）→ 無法判斷，不再硬算
  const legacyHigh = WM.seaOfCloudsScore({ surfaceTemp: 10, upperTemp: 20, upperTemp850: 20, upperHumidity: 95, windSpeed: 1, surfaceElevation: 2000 });
  check('[12c] 高山＋只有 925/850 → score null', legacyHigh.score === null && legacyHigh.unknown === true && legacyHigh.alert === false);
  check('[12c] 有說明原因', typeof legacyHigh.reason === 'string' && legacyHigh.reason.length > 0);

  // 12d 機位上方那層缺資料（null）→ 無法判斷
  const holes = WM.seaOfCloudsScore({ surfaceTemp: 5, windSpeed: 1, surfaceElevation: 2000,
    levels: { 925: { t: 20, rh: 90, z: 800 }, 850: { t: 18, rh: 90, z: 1500 }, 700: { t: null, rh: 80, z: 3100 }, 600: { t: 2, rh: 50, z: 4400 } } });
  check('[12d] 上方層缺溫度 → 無法判斷', holes.score === null);
  // 12e 琉璃光同一套挑層邏輯
  const liuliHigh = WM.liuliGuangScore({ surfaceTemp: 10, upperTemp: 20, visibility: 1500, windSpeed: 1, surfaceElevation: 2000 });
  check('[12e] 琉璃光高山＋只有 925 → 無法判斷', liuliHigh.score === null);
  check('[12f] UI 不再寫死「925hPa較地面暖」', !html19.includes('逆溫強度(925hPa較地面暖越好)'));
}

// [13] 藍調時刻＝太陽在地平線下 4°～6°（攝影慣用），黃金時刻 −4°～+6° 首尾相接
{
  const lat = 24.1371, lng = 121.2757; // 武嶺
  const t = WM.getGoldenBlueHours(new Date('2026-10-20T12:00:00+08:00'), lat, lng);
  const alt = (d) => ctx.SunCalc.getPosition(d, lat, lng).altitude * 180 / Math.PI;
  const hm = (d) => d.toTimeString().slice(0, 5);
  console.log(`[13] 武嶺 10/20 晨間藍調 ${hm(t.dawnBlue.start)}–${hm(t.dawnBlue.end)}（${alt(t.dawnBlue.start).toFixed(2)}°→${alt(t.dawnBlue.end).toFixed(2)}°）、傍晚藍調 ${hm(t.duskBlue.start)}–${hm(t.duskBlue.end)}、入夜 ${hm(t.night)}`);
  // SunCalc getTimes 與 getPosition 的折射處理不同，容許 0.3°
  check('[13] 晨間藍調起點約 −6°', near(alt(t.dawnBlue.start), -6, 0.3));
  check('[13] 晨間藍調終點約 −4°', near(alt(t.dawnBlue.end), -4, 0.3));
  check('[13] 傍晚藍調起點約 −4°', near(alt(t.duskBlue.start), -4, 0.3));
  check('[13] 傍晚藍調終點約 −6°', near(alt(t.duskBlue.end), -6, 0.3));
  check('[13] 晨間黃金緊接藍調', t.dawnGolden.start.getTime() === t.dawnBlue.end.getTime());
  check('[13] 傍晚黃金緊接藍調', t.duskGolden.end.getTime() === t.duskBlue.start.getTime());
  const mins = (a, b) => (b - a) / 60000;
  check('[13] 藍調長度 5–20 分鐘（台灣緯度）', mins(t.dawnBlue.start, t.dawnBlue.end) > 5 && mins(t.dawnBlue.start, t.dawnBlue.end) < 20);
  check('[13] 晨間藍調在日出前、傍晚藍調在日落後', t.dawnBlue.end < t.sunrise && t.duskBlue.start > t.sunset);
  check('[13] 觀星用的入夜（−18°）晚於藍調結束', t.night > t.duskBlue.end && near(alt(t.night), -18, 0.5));
  check('[13] 武嶺 10/20 晨間藍調 05:32、傍晚藍調 17:40（手算核對）', hm(t.dawnBlue.start) === '05:32' && hm(t.duskBlue.start) === '17:40');
  check('[13] 說明頁寫出藍調定義', html19.includes('太陽在地平線下 4°～6°'));
  check('[13] 觀星目標改用 night（今日推薦／倒數）', html19.includes('candidates = [today.night, tomorrow.night]') && !html19.includes('candidates = [today.duskBlue.end'));
  check('[13] 三日預測入夜改用 night', html19.includes('const nightTarget = times.night;') && !html19.includes('const nightTarget = times.duskBlue.end'));
}

// [14] 天色時鐘 UI 守門：錶盤、四時段、三種主題、自帶等寬字、Tabler 授權
{
  check('[14] 有天色時鐘 SVG 容器', html19.includes('id="skyDial"'));
  check('[14] 四時段格', html19.includes('id="dialCells"'));
  check('[14] 主題四選項（自動／淺色／深色／夜拍）', ['data-theme-opt="auto"', 'data-theme-opt="light"', 'data-theme-opt="dark"', 'data-theme-opt="night"'].every((x) => html19.includes(x)));
  check('[14] 深色與夜拍主題 token 都有定義', html19.includes('[data-theme="dark"]') && html19.includes('[data-theme="night"]'));
  check('[14] 不走 Google Fonts CDN', !/fonts\.(googleapis|gstatic)\.com/.test(html19));
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  check('[14] 等寬字有自帶且進 sw 預快取', fs.existsSync(path.join(root, 'vendor', 'jetbrains-mono', 'JetBrainsMono-latin.woff2')) && sw.includes('./vendor/jetbrains-mono/JetBrainsMono-latin.woff2'));
  check('[14] 字型授權檔隨 App', fs.existsSync(path.join(root, 'vendor', 'jetbrains-mono', 'LICENSE.txt')));
  check('[14] Tabler 授權檔隨 App', fs.existsSync(path.join(root, 'vendor', 'tabler-icons.LICENSE.txt')));
  check('[14] 今日推薦快取升版（舊分數含假逆溫）', html19.includes("'lc_daily_picks_v2'"));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
