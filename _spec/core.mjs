// 守門測試：weatherMath.js 純函式。node _spec/core.mjs 執行。
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

// [5] 觀星指數：晴空高分、滿天雲低分，且都落在0-100
{
  const good = WM.starsScore({ cloudLow: 0, cloudMid: 0, cloudHigh: 0, humidity: 40 });
  const bad = WM.starsScore({ cloudLow: 100, cloudMid: 100, cloudHigh: 100, humidity: 95 });
  check('[5] 晴空高分', good.score > 70);
  check('[5] 滿天雲低分', bad.score < 20);
  check('[5] good.score 落在0-100', good.score >= 0 && good.score <= 100);
  check('[5] bad.score 落在0-100', bad.score >= 0 && bad.score <= 100);
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
