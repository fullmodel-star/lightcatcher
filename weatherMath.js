(function () {
  'use strict';

  function clampLerp(x, x0, y0, x1, y1) {
    if (x1 === x0) return y0;
    const t = (x - x0) / (x1 - x0);
    const c = Math.max(0, Math.min(1, t));
    return y0 + c * (y1 - y0);
  }

  // 三角形評分：v落在[lo,hi]拿滿分，往兩側到floorLo/floorHi線性歸零
  function triangleScore(v, floorLo, lo, hi, floorHi) {
    if (v <= floorLo || v >= floorHi) return 0;
    if (v < lo) return clampLerp(v, floorLo, 0, lo, 100);
    if (v > hi) return clampLerp(v, hi, 100, floorHi, 0);
    return 100;
  }

  // 2026-10-19 v0.19（老闆裁示）：藍調時刻改用攝影慣用定義——太陽在地平線下 4°～6°。
  // 舊版拿「天文曙暮光」（−18°～−12°）當藍調，那時天色幾乎全黑，比攝影師說的藍調早約 40 分鐘。
  // 黃金時刻跟著改成 −4°～+6°，讓兩段首尾相接、不重疊（舊版晨間黃金從 −12° 開始，會蓋住藍調）。
  // 觀星／琉璃光要「真正入夜」，另外回傳 night（天文昏影結束，−18°），不再借用藍調的結束時間。
  const BLUE_HOUR_DEG = { from: -6, to: -4 };
  const GOLDEN_HOUR_DEG = { from: -4, to: 6 };
  if (window.SunCalc && !window.SunCalc.times.some((r) => r[1] === 'blueHourDawnEnd')) {
    window.SunCalc.addTime(BLUE_HOUR_DEG.to, 'blueHourDawnEnd', 'blueHourDuskStart');
  }
  function getGoldenBlueHours(date, lat, lng) {
    const t = window.SunCalc.getTimes(date, lat, lng);
    return {
      dawnBlue: { start: t.dawn, end: t.blueHourDawnEnd },              // −6° → −4°
      dawnGolden: { start: t.blueHourDawnEnd, end: t.goldenHourEnd },   // −4° → +6°
      duskGolden: { start: t.goldenHour, end: t.blueHourDuskStart },    // +6° → −4°
      duskBlue: { start: t.blueHourDuskStart, end: t.dusk },            // −4° → −6°
      night: t.night,                                                   // −18°：天文昏影結束（觀星／琉璃光）
      sunrise: t.sunrise,
      sunset: t.sunset,
      solarNoon: t.solarNoon
    };
  }

  // 權重是估計值，之後依實測回饋校準，不是驗證過的氣象公式；
  // breakdown把每個因子的原始值跟子分數都吐出來，給UI做透明度說明用。
  //
  // 2026-08-27校準：老闆回報台北當天火燒雲大景，實測分數只有48分。查Open-Meteo
  // 回填資料發現當時低雲趨近0%（陽光無阻）、中高雲卻高達98-100%，中高雲子分數
  // 因為原本40-70%「甜蜜區間」在100%處硬性歸零(floorHi=100)被砍到只剩個位數，
  // 拖垮總分。低雲已經另外用lowScore卡過「貼地雲層擋光」這件事，中高雲滿天(甚至
  // 逼近100%)在低雲晴朗的前提下常常正是大景成因(整片天空都是染色畫布)，不該被當
  // 成跟「完全陰天」同一種壞天氣處理。把甜蜜區間上緣從70%鬆到80%、floorHi從100%
  // (滿天雲=直接砍到0分，明顯不合理)拉到140%，滿天高雲(100%)現在落在合理的
  // 「偏高但不歸零」區間；「低雲也一起滿天」(貼地陰天)的情境仍由lowScore單獨砍到0
  // 分主導總分，不受這次調整影響。目前仍是單一真實案例校準，非精雕公式。
  function fieryGlowScore(h) {
    const lowScore = h.cloudLow <= 10 ? 100
      : h.cloudLow >= 30 ? Math.max(0, 40 - (h.cloudLow - 30) * 2)
      : clampLerp(h.cloudLow, 10, 100, 30, 40);
    const midHigh = h.cloudMid + h.cloudHigh;
    const midHighScore = triangleScore(midHigh, 0, 40, 80, 140);
    const humidityScore = h.humidity <= 50 ? 100 : clampLerp(h.humidity, 50, 100, 100, 0);
    const visibilityScore = clampLerp(h.visibility, 5000, 0, 15000, 100);

    const score = lowScore * 0.35 + midHighScore * 0.35 + humidityScore * 0.15 + visibilityScore * 0.15;
    return {
      score: Math.round(score),
      alert: score > 75,
      breakdown: {
        lowCloud: { value: h.cloudLow, score: Math.round(lowScore), weight: 0.35 },
        midHighCloud: { value: midHigh, score: Math.round(midHighScore), weight: 0.35 },
        humidity: { value: h.humidity, score: Math.round(humidityScore), weight: 0.15 },
        visibility: { value: h.visibility, score: Math.round(visibilityScore), weight: 0.15 }
      }
    };
  }

  // 逆溫是主因子(50%，2026-08-24起改用925hPa+850hPa兩層判斷厚度)，
  // 邊界層濕度(25%)+地表風速(25%)輔助
  //
  // 2026-08-27校準：查證香港天文台官方教育頁+台灣本地山友深度部落格(OUTSiDERS/
  // enzowen)後微調兩個門檻。濕度：官方說法要「接近飽和」才凝結，社群操作門檻多
  // 引用90%，原本85%滿分偏寬鬆，改為90%。風速：查到的經驗法則是「2-3級風(約
  // 1.6-5.4m/s)都算有利」，原本只有≤2m/s給滿分偏窄，滿分窗放寬到≤3m/s(歸零門檻
  // 5m/s不變，跟2-3級風力上緣大致吻合)。仍是單篇文獻對照校準，非精雕公式。
  // ---- 逆溫要比較「地面」跟「機位上方」的氣壓層 ----
  // 2026-10-19 v0.19（老闆裁示）：舊版一律拿地面 2m 氣溫比 925hPa。925hPa 只在海拔約 800m，
  // 高山景點（武嶺 3275m）的 925hPa 其實在地底下，模式給的是外插值，算出「逆溫 23.9°C」是假訊號、雲海分數因此偏高。
  // 現在用氣壓層的實際高度（Open-Meteo geopotential_height）挑「第一個比地面高 100m 以上」的層當逆溫上緣，
  // 再往上一層判斷厚度；挑不到或缺資料就回傳 score:null（畫面顯示「無法判斷」），不再硬算。
  // 沒有 levels 資料的舊呼叫端（只有 925/850 溫度）用標準大氣高度，地面高於 925hPa 一樣判無法判斷。
  const PRESSURE_LEVELS = [925, 850, 700, 600, 500];
  const STD_LEVEL_HEIGHT = { 925: 760, 850: 1460, 700: 3010, 600: 4200, 500: 5570 };
  const LAYER_MARGIN_M = 100;
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

  // full=true（雲海）：要該層濕度＋再上一層溫度（判厚度）；full=false（琉璃光）：只看地面→該層溫差
  function pickInversionLayer(h, full = true) {
    const ground = isNum(h.surfaceElevation) ? h.surfaceElevation : 0;
    const lv = h.levels || {
      925: { t: h.upperTemp, rh: h.upperHumidity, z: STD_LEVEL_HEIGHT[925] },
      850: { t: h.upperTemp850, rh: null, z: STD_LEVEL_HEIGHT[850] }
    };
    for (let i = 0; i < PRESSURE_LEVELS.length - 1; i++) {
      const p = PRESSURE_LEVELS[i], q = PRESSURE_LEVELS[i + 1];
      const lo = lv[p];
      if (!lo) continue;
      const z = isNum(lo.z) ? lo.z : STD_LEVEL_HEIGHT[p];
      if (z < ground + LAYER_MARGIN_M) continue; // 這一層在地面以下（或貼地），不能拿來判逆溫
      const hi = lv[q];
      if (!isNum(lo.t) || (full && (!hi || !isNum(hi.t) || !isNum(lo.rh)))) {
        return { ok: false, reason: `機位上方的 ${p}hPa／${q}hPa 氣壓層缺資料`, ground };
      }
      return { ok: true, base: p, top: q, lo, hi, z, ground };
    }
    return { ok: false, reason: `地面（約 ${Math.round(ground)}m）以上沒有可用的氣壓層資料`, ground };
  }

  // ---- 雲海（腳下的雲）要看「機位下方」的逆溫 ----
  // 2026-10-20 v0.22（老闆裁示）：從山頂看到腳下雲海，物理上要的是機位「下方」有逆溫把雲壓在下面；
  // v0.19 改成「地面→機位上方第一個氣壓層」，比的是機位頭頂上的空氣，跟腳下那片雲無關。
  // 新判準：用 Open-Meteo 的實際高度（geopotential_height），挑出高度低於機位的氣壓層，至少要兩層，
  // 由下往上比相鄰兩層，「上層比下層暖」＝逆溫；取溫差最大的一對當雲海的逆溫依據（沒有任何一對變暖時
  // 取最接近持平的那一對，溫差為負→分數低）。雲被壓在逆溫底下，雲頂≈逆溫底的高度，要比機位低 100m 以上
  // 才算「腳下」（跟畫面雲層高度計「差 100m 以內＝置身雲霧中」同一個門檻）。
  // 機位下方的氣壓層不到兩層（平地景點、或舊資料沒有實際高度）→ 回傳 insufficient，呼叫端照 v0.19 判準不變。
  // 機位下方有層但缺溫度／濕度／高度 → 回傳缺資料（score:null，「無法判斷」），不當 0、不改用別的判準。
  function pickInversionBelow(h) {
    if (!h.levels || !isNum(h.surfaceElevation)) return { insufficient: true };
    const ground = h.surfaceElevation;
    const below = [];
    for (const p of PRESSURE_LEVELS) {
      const lv = h.levels[p];
      if (!lv) continue;
      if (!isNum(lv.z)) {
        // 不知道實際高度：標準大氣高度在機位以下的話，這一層理應在下方 → 缺資料，不能跳過它硬比
        if (STD_LEVEL_HEIGHT[p] < ground) return { ok: false, reason: `機位下方的 ${p}hPa 氣壓層缺高度資料`, ground };
        continue;
      }
      if (lv.z >= ground) continue;
      if (!isNum(lv.t)) return { ok: false, reason: `機位下方的 ${p}hPa 氣壓層缺溫度資料`, ground };
      below.push({ p, t: lv.t, rh: lv.rh, z: lv.z });
    }
    if (below.length < 2) return { insufficient: true };
    below.sort((a, b) => a.z - b.z);
    let best = null;
    for (let i = 0; i < below.length - 1; i++) {
      const lo = below[i], hi = below[i + 1];
      if (lo.z > ground - LAYER_MARGIN_M) continue; // 雲頂（逆溫底）離機位不到 100m，不算腳下
      const dT = hi.t - lo.t;
      if (!best || dT > best.dT) best = { lo, hi, next: below[i + 2] || null, dT };
    }
    if (!best) return { ok: false, reason: `機位下方的氣壓層都在機位 ${LAYER_MARGIN_M}m 以內，判斷不出腳下的雲`, ground };
    if (!isNum(best.lo.rh)) return { ok: false, reason: `機位下方的 ${best.lo.p}hPa 氣壓層缺濕度資料`, ground };
    return { ok: true, ...best, ground };
  }

  function seaOfCloudsScore(h) {
    const windOk = isNum(h.windSpeed);
    const windScore = !windOk ? null : h.windSpeed <= 3 ? 100
      : h.windSpeed >= 5 ? 0
      : clampLerp(h.windSpeed, 3, 100, 5, 0);
    const below = isNum(h.surfaceTemp) ? pickInversionBelow(h) : { insufficient: true };
    if (!below.insufficient) return seaOfCloudsBelow(h, below, windOk, windScore);
    const layer = isNum(h.surfaceTemp) ? pickInversionLayer(h) : { ok: false, reason: '缺地面氣溫資料' };
    if (!layer.ok || !windOk) {
      return {
        score: null,
        alert: false,
        unknown: true,
        reason: layer.ok ? '缺地表風速資料' : layer.reason,
        breakdown: {
          inversion: { value: null, score: null, weight: 0.5 * 0.7, from: '地面', to: null },
          inversionDepth: { value: null, score: null, weight: 0.5 * 0.3, from: null, to: null },
          upperHumidity: { value: null, score: null, weight: 0.25, level: null },
          windSpeed: { value: windOk ? h.windSpeed : null, score: windScore === null ? null : Math.round(windScore), weight: 0.25 }
        }
      };
    }
    // 第一層：地面→機位上方第一個氣壓層（平地＝925hPa，約海拔700-800m），逆溫存不存在的主訊號
    const inv1 = layer.lo.t - h.surfaceTemp;
    const inv1Score = inv1 > 0 ? clampLerp(inv1, 0, 50, 6, 100) : clampLerp(inv1, -6, 0, 0, 50);
    // 第二層：再往上一層(平地＝925hPa→850hPa，約海拔1500m)，逆溫層夠不夠「厚」——
    // 上層持平或續暖代表逆溫蓋子夠厚、雲海穩定；快速轉冷代表逆溫層很薄，容易破碎消散
    const inv2 = layer.hi.t - layer.lo.t;
    const inv2Score = inv2 >= -1 ? 100 : clampLerp(inv2, -6, 0, -1, 100);
    const inversionScore = inv1Score * 0.7 + inv2Score * 0.3;

    const upperHumidity = layer.lo.rh;
    const humidityScore = upperHumidity >= 90 ? 100 : clampLerp(upperHumidity, 50, 0, 90, 100);

    const score = inversionScore * 0.5 + humidityScore * 0.25 + windScore * 0.25;
    return {
      score: Math.round(score),
      alert: score > 75,
      layer: { base: layer.base, top: layer.top, baseHeightM: Math.round(layer.z), groundM: Math.round(layer.ground) },
      breakdown: {
        inversion: { value: inv1, score: Math.round(inv1Score), weight: 0.5 * 0.7, from: '地面', to: `${layer.base}hPa` },
        inversionDepth: { value: inv2, score: Math.round(inv2Score), weight: 0.5 * 0.3, from: `${layer.base}hPa`, to: `${layer.top}hPa` },
        upperHumidity: { value: upperHumidity, score: Math.round(humidityScore), weight: 0.25, level: `${layer.base}hPa` },
        windSpeed: { value: h.windSpeed, score: Math.round(windScore), weight: 0.25 }
      }
    };
  }
  seaOfCloudsScore.requires = ['surfaceTemp', 'windSpeed'];

  // 機位下方模式（見 pickInversionBelow）：權重、分數曲線全部沿用 v0.19，只換「拿哪兩個高度比」
  // 逆溫強度＝下方溫差最大那對（下層→上層）；厚度＝那對的上層→再上一個點（下一個下方氣壓層，沒有就用機位地面氣溫）；
  // 濕度＝逆溫底那一層（雲就是在那裡被壓住、凝結）。
  function seaOfCloudsBelow(h, b, windOk, windScore) {
    const nextName = b.next ? `${b.next.p}hPa` : '機位';
    const nextT = b.next ? b.next.t : h.surfaceTemp;
    if (!b.ok || !windOk) {
      return {
        score: null, alert: false, unknown: true,
        reason: b.ok ? '缺地表風速資料' : b.reason,
        breakdown: {
          inversion: { value: null, score: null, weight: 0.5 * 0.7, from: b.ok ? `${b.lo.p}hPa` : null, to: b.ok ? `${b.hi.p}hPa` : null },
          inversionDepth: { value: null, score: null, weight: 0.5 * 0.3, from: null, to: null },
          upperHumidity: { value: null, score: null, weight: 0.25, level: null },
          windSpeed: { value: windOk ? h.windSpeed : null, score: windScore === null ? null : Math.round(windScore), weight: 0.25 }
        }
      };
    }
    const inv1 = b.dT;
    const inv1Score = inv1 > 0 ? clampLerp(inv1, 0, 50, 6, 100) : clampLerp(inv1, -6, 0, 0, 50);
    const inv2 = nextT - b.hi.t;
    const inv2Score = inv2 >= -1 ? 100 : clampLerp(inv2, -6, 0, -1, 100);
    const inversionScore = inv1Score * 0.7 + inv2Score * 0.3;
    const upperHumidity = b.lo.rh;
    const humidityScore = upperHumidity >= 90 ? 100 : clampLerp(upperHumidity, 50, 0, 90, 100);
    const score = inversionScore * 0.5 + humidityScore * 0.25 + windScore * 0.25;
    return {
      score: Math.round(score),
      alert: score > 75,
      layer: {
        mode: 'below', base: b.lo.p, top: b.hi.p,
        baseHeightM: Math.round(b.lo.z), topHeightM: Math.round(b.hi.z), groundM: Math.round(b.ground),
        cloudTopM: Math.round(b.lo.z), hasInversion: inv1 > 0
      },
      breakdown: {
        inversion: { value: inv1, score: Math.round(inv1Score), weight: 0.5 * 0.7, from: `${b.lo.p}hPa`, to: `${b.hi.p}hPa` },
        inversionDepth: { value: inv2, score: Math.round(inv2Score), weight: 0.5 * 0.3, from: `${b.hi.p}hPa`, to: nextName },
        upperHumidity: { value: upperHumidity, score: Math.round(humidityScore), weight: 0.25, level: `${b.lo.p}hPa` },
        windSpeed: { value: h.windSpeed, score: Math.round(windScore), weight: 0.25 }
      }
    };
  }

  // 觀星：總雲量(55%)+月相光害(25%)+濕度代表的霾害程度(20%)。
  // 2026-08-27查證Clear Sky Chart(北美業餘天文界20年事實標準)+Bortle Scale：
  // 滿月可讓天頂極限星等損失3.5-4等，等同把一個原本Bortle 1-2級的暗空點，觀測體驗
  // 瞬間拉到市郊Bortle 6-7級水準——這是查到的5個指數校準項目裡效果最大、又最容易算
  // (SunCalc本來就有getMoonIllumination，不用額外接API)的因子，原本完全沒算。
  // h.moonIllumination缺省視為0(新月，不扣分)，向下相容沒有月相資料的呼叫端。
  // 地面濕度當「透明度」代理仍不夠精確(CSC官方定義透明度是整層大氣柱總水氣量，
  // 濕度另有獨立用途是提醒結露/鏡頭起霧)，但免費API目前沒有更好的替代資料源，暫留。
  function starsScore(h) {
    const totalCloud = (h.cloudLow + h.cloudMid + h.cloudHigh) / 3;
    const cloudScore = clampLerp(totalCloud, 0, 100, 60, 0);
    const humidityScore = h.humidity <= 60 ? 100 : clampLerp(h.humidity, 60, 100, 95, 0);
    const moonFraction = h.moonIllumination || 0;
    const moonScore = clampLerp(moonFraction, 0, 100, 1, 0);
    const score = cloudScore * 0.55 + moonScore * 0.25 + humidityScore * 0.2;
    return {
      score: Math.round(score),
      alert: score > 75,
      breakdown: {
        totalCloud: { value: Math.round(totalCloud), score: Math.round(cloudScore), weight: 0.55 },
        moonPhase: { value: Math.round(moonFraction * 100), score: Math.round(moonScore), weight: 0.25 },
        humidity: { value: h.humidity, score: Math.round(humidityScore), weight: 0.2 }
      }
    };
  }

  // 藍調時刻：太陽在地平線下、天空呈現深藍漸層的短暫時段，跟火燒雲不同——
  // 不需要雲被夕陽染紅，反而是雲太多會把整片藍天悶成灰蒙蒙，所以走「雲越少越好」，
  // 但門檻比觀星寬鬆(70%才歸零，不是60%)，因為藍調時刻本來就偏短暫、些微雲層還能接受。
  // 權重仍是方向性估計值，跟其他三個指數同一套自訂邏輯，非驗證過的氣象公式。
  function blueHourScore(h) {
    const totalCloud = (h.cloudLow + h.cloudMid + h.cloudHigh) / 3;
    const cloudScore = clampLerp(totalCloud, 0, 100, 70, 0);
    const visibilityScore = clampLerp(h.visibility, 5000, 0, 15000, 100);
    const humidityScore = h.humidity <= 60 ? 100 : clampLerp(h.humidity, 60, 100, 90, 0);
    const score = cloudScore * 0.5 + visibilityScore * 0.3 + humidityScore * 0.2;
    return {
      score: Math.round(score),
      alert: score > 75,
      breakdown: {
        totalCloud: { value: Math.round(totalCloud), score: Math.round(cloudScore), weight: 0.5 },
        visibility: { value: h.visibility, score: Math.round(visibilityScore), weight: 0.3 },
        humidity: { value: h.humidity, score: Math.round(humidityScore), weight: 0.2 }
      }
    };
  }

  // 琉璃光：夜間/清晨谷地被逆溫鎖住的霧，把下方城鎮燈光暈染成七彩朦朧光暈
  // （南投金龍山最出名，同一套「逆溫困住谷地水氣」機制其實跟雲海一樣，
  // 差別在雲海是白天看反光、琉璃光是夜間看谷地燈光透霧，且需要谷地本身有城鎮燈源）。
  // 跟雲海不同的地方是霧「濃度」要恰到好處：太稀薄看不出暈染感、太濃燈光整個被擋住，
  // 所以能見度用三角形評分抓一個甜蜜區間，不是越低越好。
  function liuliGuangScore(h) {
    // 2026-10-19：逆溫一樣要用「機位上方」的氣壓層（見 pickInversionLayer），地面高於 925hPa 不再硬比
    const layer = isNum(h.surfaceTemp) ? pickInversionLayer(h, false) : { ok: false, reason: '缺地面氣溫資料' };
    if (!layer.ok || !isNum(h.visibility) || !isNum(h.windSpeed)) {
      return {
        score: null, alert: false, unknown: true,
        reason: layer.ok ? '缺能見度或風速資料' : layer.reason,
        breakdown: {
          inversion: { value: null, score: null, weight: 0.5, from: '地面', to: null },
          visibility: { value: isNum(h.visibility) ? h.visibility : null, score: null, weight: 0.35 },
          windSpeed: { value: isNum(h.windSpeed) ? h.windSpeed : null, score: null, weight: 0.15 }
        }
      };
    }
    const inv1 = layer.lo.t - h.surfaceTemp;
    const inversionScore = inv1 > 0 ? clampLerp(inv1, 0, 50, 6, 100) : clampLerp(inv1, -6, 0, 0, 50);
    const visibilityScore = triangleScore(h.visibility, 100, 500, 3000, 6000);
    const windScore = h.windSpeed <= 2 ? 100 : h.windSpeed >= 5 ? 0 : clampLerp(h.windSpeed, 2, 100, 5, 0);
    // 逆溫、能見度都是「有沒有霧可言」的先決條件，不是可以互相彌補的加權平均——
    // 沒有逆溫就沒有困住的霧、能見度太差燈光整個被擋住，任一個是0整體就該掉到接近0，
    // 所以用乘法而非加權平均；風速則是輔助修正(乘法但保底0.6，強風也不會直接歸零)。
    const score = inversionScore * (visibilityScore / 100) * (0.6 + 0.4 * windScore / 100);
    return {
      score: Math.round(score),
      alert: score > 75,
      breakdown: {
        inversion: { value: inv1, score: Math.round(inversionScore), weight: 0.5, from: '地面', to: `${layer.base}hPa` },
        visibility: { value: h.visibility, score: Math.round(visibilityScore), weight: 0.35 },
        windSpeed: { value: h.windSpeed, score: Math.round(windScore), weight: 0.15 }
      }
    };
  }

  // 各指數「一定要有」的輸入欄位：ensemble 成員缺這些欄位(null)時不列入信心區間計算（見 ensembleConfidence）
  fieryGlowScore.requires = ['cloudLow', 'cloudMid', 'cloudHigh', 'humidity', 'visibility'];
  starsScore.requires = ['cloudLow', 'cloudMid', 'cloudHigh', 'humidity'];
  blueHourScore.requires = ['cloudLow', 'cloudMid', 'cloudHigh', 'humidity', 'visibility'];
  liuliGuangScore.requires = ['surfaceTemp', 'visibility', 'windSpeed'];
  const FIELD_LABEL = {
    cloudLow: '低雲量', cloudMid: '中雲量', cloudHigh: '高雲量', humidity: '地面濕度', visibility: '能見度',
    surfaceTemp: '地面氣溫', windSpeed: '地表風速', upperLevels: '高空氣壓層（925／850hPa 等）'
  };

  // 雲海高度估算：LCL(凝結高度) ≈ 125 × (地面氣溫 − 露點溫度)公尺，氣象學經典估算式(Espy's equation)。
  // 回傳離地高度(AGL)；要換算成海拔(AMSL)需再加地面高程，見cloudBaseAMSL。
  function lclHeightAGL(surfaceTemp, dewpoint) {
    return Math.max(0, 125 * (surfaceTemp - dewpoint));
  }

  // groundElevationM：查詢點的地面高程(公尺)。有熱點資料庫的min_elevation就優先用它，
  // 沒有的話退回Open-Meteo API回應本身的elevation欄位(格點高程，較粗略)。
  function cloudBaseAMSL(h, groundElevationM) {
    const agl = lclHeightAGL(h.surfaceTemp, h.dewpoint);
    return { aglM: Math.round(agl), amslM: Math.round(groundElevationM + agl) };
  }

  const OPEN_METEO_HOURLY = [
    'cloudcover_low', 'cloudcover_mid', 'cloudcover_high',
    'relativehumidity_2m', 'visibility', 'temperature_2m', 'dewpoint_2m',
    'temperature_850hPa', 'relativehumidity_850hPa',
    'temperature_925hPa', 'relativehumidity_925hPa',
    'windspeed_10m'
  ];
  // 2026-10-19：逆溫要知道各氣壓層的實際高度，才判斷得出「這一層在機位上方還是地底下」。
  // 只加在主預報（ensemble 的 icon_seamless 這些欄位全回 null，加了只是白傳）。
  const OPEN_METEO_LEVELS = [
    'temperature_700hPa', 'relativehumidity_700hPa',
    'temperature_600hPa', 'relativehumidity_600hPa', 'temperature_500hPa',
    'geopotential_height_925hPa', 'geopotential_height_850hPa', 'geopotential_height_700hPa',
    'geopotential_height_600hPa', 'geopotential_height_500hPa'
  ];
  const FORECAST_HOURLY = OPEN_METEO_HOURLY.concat(OPEN_METEO_LEVELS);
  // API 回應的 elevation＝temperature_2m 對應的地面高度（Open-Meteo 依 90m DEM 降尺度），
  // 掛到 hourly 上讓 buildH 拿得到（逆溫要比較的是「這個地面」上方的氣壓層）
  function tagElevation(data) {
    if (data && data.hourly && Number.isFinite(data.elevation)) data.hourly.surface_elevation = data.elevation;
    return data;
  }

  // 2026-10-12：同一次開啟內的預報快取（30 分鐘）。今日推薦／地圖原本每個景點各打一次
  // Open-Meteo（56 個同時送出），常被 429 限流→失敗請求＋console 錯誤；改成多點一次查
  // （Open-Meteo 支援 latitude=a,b,c 逗號清單，回傳同順序陣列），結果放進這個快取，
  // 之後點景點看預測直接命中，不再重打。
  const HOURLY_TTL_MS = 30 * 60 * 1000;
  const hourlyCache = new Map();
  const hourlyKey = (lat, lng, days) => `${Number(lat).toFixed(4)},${Number(lng).toFixed(4)},${days}`;
  function hourlyCached(lat, lng, days) {
    const hit = hourlyCache.get(hourlyKey(lat, lng, days));
    return hit && Date.now() - hit.t < HOURLY_TTL_MS ? hit.data : null;
  }

  async function fetchHourlyWeather(lat, lng, days = 4) {
    const cached = hourlyCached(lat, lng, days);
    if (cached) return cached;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&hourly=${FORECAST_HOURLY.join(',')}&forecast_days=${days}&timezone=auto`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Open-Meteo API 錯誤：${res.status}`);
    const data = tagElevation(await res.json());
    hourlyCache.set(hourlyKey(lat, lng, days), { t: Date.now(), data });
    return data;
  }

  // 多個地點一次查（每批最多 50 點，URL 長度與 Open-Meteo 建議都在範圍內）。
  // 回傳與 points 同順序的陣列；某一批失敗時該批位置為 null，不擋其他批。
  async function fetchHourlyWeatherBatch(points, days = 4) {
    const out = points.map((p) => hourlyCached(p.lat, p.lng, days));
    const todo = out.map((d, i) => (d ? -1 : i)).filter((i) => i >= 0);
    const BATCH = 50;
    for (let k = 0; k < todo.length; k += BATCH) {
      const idx = todo.slice(k, k + BATCH);
      const lats = idx.map((i) => points[i].lat).join(',');
      const lngs = idx.map((i) => points[i].lng).join(',');
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lngs}&hourly=${FORECAST_HOURLY.join(',')}&forecast_days=${days}&timezone=auto`;
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Open-Meteo API 錯誤：${res.status}`);
        let arr = await res.json();
        if (!Array.isArray(arr)) arr = [arr];
        idx.forEach((i, j) => {
          const data = arr[j];
          if (!data || !data.hourly) return;
          tagElevation(data);
          out[i] = data;
          hourlyCache.set(hourlyKey(points[i].lat, points[i].lng, days), { t: Date.now(), data });
        });
      } catch (e) {
        if (k === 0 && todo.length <= BATCH) throw e;
      }
    }
    return out;
  }

  // ---- Ensemble(多組模式成員)：估算預測信心區間，不是取代主要預測 ----
  // icon_seamless模式有40組成員，各自對雲量/氣溫等給不同數字，
  // 成員之間分歧越大代表這組天氣現象越不確定，分歧小代表模式間有共識。
  async function fetchEnsembleWeather(lat, lng, days = 2) {
    const url = `https://ensemble-api.open-meteo.com/v1/ensemble?latitude=${lat}&longitude=${lng}&hourly=${OPEN_METEO_HOURLY.join(',')}&forecast_days=${days}&models=icon_seamless`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Open-Meteo Ensemble API 錯誤：${res.status}`);
    return tagElevation(await res.json());
  }

  function ensembleMemberCount(hourly) {
    let n = 0;
    while (hourly[`cloudcover_low_member${String(n + 1).padStart(2, '0')}`]) n++;
    return n;
  }

  function hAtMember(hourly, index, member) {
    const suffix = member === 0 ? '' : `_member${String(member).padStart(2, '0')}`;
    // 2026-10-19：欄位不存在或值是 null 一律回 null（舊版 null 直接進公式：null<=10 為真→低雲滿分，信心區間是假的）
    const get = (name) => {
      const arr = hourly[name + suffix];
      const v = arr ? arr[index] : null;
      return isNum(v) ? v : null;
    };
    const wind = get('windspeed_10m');
    return {
      cloudLow: get('cloudcover_low'),
      cloudMid: get('cloudcover_mid'),
      cloudHigh: get('cloudcover_high'),
      humidity: get('relativehumidity_2m'),
      visibility: get('visibility'),
      surfaceTemp: get('temperature_2m'),
      dewpoint: get('dewpoint_2m'),
      upperTemp: get('temperature_925hPa'),
      upperTemp850: get('temperature_850hPa'),
      upperHumidity: get('relativehumidity_925hPa'),
      windSpeed: wind === null ? null : wind / 3.6,
      surfaceElevation: isNum(hourly.surface_elevation) ? hourly.surface_elevation : undefined,
      levels: levelsAt(hourly, [index], suffix),
      // 月相不受天氣模式影響，各成員共用同一個值，只是讓ensemble score計算跟
      // 真正顯示的分數(也含月相)口徑一致，不會系統性偏移confidence區間
      moonIllumination: window.SunCalc.getMoonIllumination(new Date(hourly.time[index])).fraction
    };
  }

  // scoreFn是fieryGlowScore/seaOfCloudsScore/starsScore其中一個，
  // 回傳80%成員落在的分數區間(p10~p90)，區間越窄代表模式間越有共識
  //
  // 2026-10-19 v0.19（老闆裁示）：缺資料的成員不列入。實測 icon_seamless 對雲量／能見度／925・850hPa
  // 全部回 null，舊版照算（null<=10 為真→低雲滿分、null 當 0），畫面上的「模型信心」其實是假的。
  // 現在：成員缺 scoreFn.requires 任一欄位、或公式本身判「無法判斷」(score:null) 就跳過；
  // 能用的成員不到一半（且至少 5 組）就回傳 { unavailable:true, missing:[缺哪些] }，畫面註明「無法計算」。
  const ENSEMBLE_MIN_MEMBERS = 5;
  function ensembleConfidence(hourly, index, scoreFn) {
    const n = ensembleMemberCount(hourly);
    if (!n) return null;
    const scores = [];
    const missing = new Set();
    for (let m = 1; m <= n; m++) {
      const h = hAtMember(hourly, index, m);
      const lack = (scoreFn.requires || []).filter((k) => !isNum(h[k]));
      if (lack.length) { lack.forEach((k) => missing.add(k)); continue; }
      const r = scoreFn(h);
      if (!isNum(r.score)) { missing.add('upperLevels'); continue; }
      scores.push(r.score);
    }
    if (scores.length < Math.max(ENSEMBLE_MIN_MEMBERS, Math.ceil(n / 2))) {
      return {
        unavailable: true,
        memberCount: n,
        used: scores.length,
        missing: [...missing],
        missingLabels: [...missing].map((k) => FIELD_LABEL[k] || k)
      };
    }
    scores.sort((a, b) => a - b);
    const p10 = scores[Math.floor(scores.length * 0.1)];
    const p90 = scores[Math.min(scores.length - 1, Math.ceil(scores.length * 0.9))];
    const spread = p90 - p10;
    const level = spread <= 20 ? '高' : spread <= 40 ? '中等' : '低';
    return { p10, p90, spread, level, memberCount: n, used: scores.length, skipped: n - scores.length };
  }

  function nearestHourIndex(hourly, date) {
    const target = date.getTime();
    let best = 0;
    let bestDiff = Infinity;
    hourly.time.forEach((t, i) => {
      const diff = Math.abs(new Date(t).getTime() - target);
      if (diff < bestDiff) { bestDiff = diff; best = i; }
    });
    return best;
  }

  // refDate：用來算月相(getMoonIllumination只吃日期，跟天氣資料無關)。
  // 沒傳refDate時moonIllumination給undefined，starsScore會當作0(新月)處理。
  // 各氣壓層在時間窗內的平均溫度／濕度／高度；該層欄位不存在就不放（舊資料、測試資料走標準大氣高度）
  function levelsAt(hourly, indices, suffix = '') {
    const mean = (name) => {
      const arr = hourly[name + suffix];
      if (!arr) return undefined;
      const vals = indices.map((i) => arr[i]);
      return vals.every(isNum) ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    };
    if (!hourly['geopotential_height_925hPa' + suffix] && !hourly['temperature_700hPa' + suffix]) return undefined;
    const out = {};
    PRESSURE_LEVELS.forEach((p) => {
      const t = mean(`temperature_${p}hPa`);
      if (t === undefined) return;
      out[p] = { t, rh: mean(`relativehumidity_${p}hPa`), z: mean(`geopotential_height_${p}hPa`) };
    });
    return out;
  }

  function buildH(hourly, indices, refDate) {
    const avg = (arr) => indices.reduce((s, i) => s + arr[i], 0) / indices.length;
    return {
      cloudLow: avg(hourly.cloudcover_low),
      cloudMid: avg(hourly.cloudcover_mid),
      cloudHigh: avg(hourly.cloudcover_high),
      humidity: avg(hourly.relativehumidity_2m),
      visibility: avg(hourly.visibility),
      surfaceTemp: avg(hourly.temperature_2m),
      dewpoint: avg(hourly.dewpoint_2m),
      upperTemp: avg(hourly.temperature_925hPa),
      upperTemp850: avg(hourly.temperature_850hPa),
      upperHumidity: avg(hourly.relativehumidity_925hPa),
      windSpeed: avg(hourly.windspeed_10m) / 3.6, // km/h -> m/s，PRD門檻(4m/s)用m/s
      surfaceElevation: isNum(hourly.surface_elevation) ? hourly.surface_elevation : undefined,
      levels: levelsAt(hourly, indices),
      moonIllumination: refDate ? window.SunCalc.getMoonIllumination(refDate).fraction : undefined
    };
  }

  function hourAt(hourly, index) {
    return buildH(hourly, [index], new Date(hourly.time[index]));
  }

  // 黃金時刻/藍調時刻有30-60分鐘區間，只抓最接近的單一小時容易被那一小時的
  // 雜訊誤導；改成抓時間窗內每個整點資料算平均，結果更穩定。
  // windowHours=1代表前後各抓1小時內的整點(Open-Meteo為逐小時資料)。
  function hourAtWindow(hourly, centerDate, windowHours = 1) {
    const center = centerDate.getTime();
    const ms = windowHours * 3600000;
    const indices = [];
    hourly.time.forEach((t, i) => {
      if (Math.abs(new Date(t).getTime() - center) <= ms) indices.push(i);
    });
    if (!indices.length) indices.push(nearestHourIndex(hourly, centerDate));
    return buildH(hourly, indices, centerDate);
  }

  // ---- 中央氣象署(CWA)即時觀測交叉驗證 ----
  // 金鑰不能放前端，走自己的Cloudflare Worker代理(_worker/worker.js)，
  // 這裡只呼叫代理網址。用途是「跟我們的預測互相對照」不是取代預測。
  const CWA_WORKER = 'https://lightcatcher-cwa.fullmodel.workers.dev';
  let _cwaStationsCache = null;

  async function fetchCwaObservations() {
    if (_cwaStationsCache) return _cwaStationsCache;
    const res = await fetch(`${CWA_WORKER}/observations`);
    if (!res.ok) throw new Error(`CWA代理錯誤：${res.status}`);
    const data = await res.json();
    _cwaStationsCache = data.stations;
    return _cwaStationsCache;
  }

  function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371, rad = Math.PI / 180;
    const dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  // 找最近的CWA測站，超過maxKm就視為沒有可比對的測站(回傳null)，
  // 不要拿太遠的測站資料冒充「這裡」的即時狀況
  async function nearestCwaStation(lat, lng, maxKm = 15) {
    const stations = await fetchCwaObservations();
    let best = null, bestDist = Infinity;
    stations.forEach((s) => {
      const d = haversineKm(lat, lng, s.lat, s.lng);
      if (d < bestDist) { bestDist = d; best = s; }
    });
    if (!best || bestDist > maxKm) return null;
    return Object.assign({}, best, { distanceKm: Math.round(bestDist * 10) / 10 });
  }

  window.WeatherMath = {
    getGoldenBlueHours,
    fieryGlowScore,
    seaOfCloudsScore,
    starsScore,
    blueHourScore,
    liuliGuangScore,
    lclHeightAGL,
    cloudBaseAMSL,
    fetchHourlyWeather,
    fetchHourlyWeatherBatch,
    fetchEnsembleWeather,
    ensembleConfidence,
    pickInversionLayer,
    pickInversionBelow,
    BLUE_HOUR_DEG,
    GOLDEN_HOUR_DEG,
    nearestHourIndex,
    hourAt,
    hourAtWindow,
    nearestCwaStation
  };
}());
