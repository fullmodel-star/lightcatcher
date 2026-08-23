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

// [3] 雲海指數：逆溫+高濕+微風應該高分；無逆溫+強風應該低分
{
  const good = WM.seaOfCloudsScore({ surfaceTemp: 15, upperTemp: 20, upperHumidity: 90, windSpeed: 1.5 });
  const bad = WM.seaOfCloudsScore({ surfaceTemp: 20, upperTemp: 15, upperHumidity: 30, windSpeed: 8 });
  check('[3] 逆溫微風高分', good.score > 70);
  check('[3] 無逆溫強風低分', bad.score < 20);
  check('[3] good.score 落在0-100', good.score >= 0 && good.score <= 100);
  check('[3] bad.score 落在0-100', bad.score >= 0 && bad.score <= 100);
}

// [4] 反向斷言：分數函式不可回傳 NaN（邊界值0/100全都要能算）
{
  const edge1 = WM.fieryGlowScore({ cloudLow: 0, cloudMid: 0, cloudHigh: 0, humidity: 0, visibility: 0 });
  const edge2 = WM.seaOfCloudsScore({ surfaceTemp: 0, upperTemp: 0, upperHumidity: 0, windSpeed: 0 });
  check('[4] fieryGlow邊界值非NaN', !Number.isNaN(edge1.score));
  check('[4] seaOfClouds邊界值非NaN', !Number.isNaN(edge2.score));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
