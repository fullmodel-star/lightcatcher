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

  function getGoldenBlueHours(date, lat, lng) {
    const t = window.SunCalc.getTimes(date, lat, lng);
    return {
      dawnBlue: { start: t.nightEnd, end: t.nauticalDawn },
      dawnGolden: { start: t.nauticalDawn, end: t.goldenHourEnd },
      duskGolden: { start: t.goldenHour, end: t.sunset },
      duskBlue: { start: t.nauticalDusk, end: t.night },
      sunrise: t.sunrise,
      sunset: t.sunset
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
  function seaOfCloudsScore(h) {
    // 第一層：地面→925hPa(約海拔700-800m)，逆溫存不存在的主訊號
    const inv1 = h.upperTemp - h.surfaceTemp;
    const inv1Score = inv1 > 0 ? clampLerp(inv1, 0, 50, 6, 100) : clampLerp(inv1, -6, 0, 0, 50);
    // 第二層：925hPa→850hPa(約海拔1500m)，逆溫層夠不夠「厚」——
    // 850hPa持平或續暖代表逆溫蓋子夠厚、雲海穩定；快速轉冷代表逆溫層很薄，容易破碎消散
    const inv2 = h.upperTemp850 - h.upperTemp;
    const inv2Score = inv2 >= -1 ? 100 : clampLerp(inv2, -6, 0, -1, 100);
    const inversionScore = inv1Score * 0.7 + inv2Score * 0.3;

    const humidityScore = h.upperHumidity >= 90 ? 100 : clampLerp(h.upperHumidity, 50, 0, 90, 100);
    const windScore = h.windSpeed <= 3 ? 100
      : h.windSpeed >= 5 ? 0
      : clampLerp(h.windSpeed, 3, 100, 5, 0);

    const score = inversionScore * 0.5 + humidityScore * 0.25 + windScore * 0.25;
    return {
      score: Math.round(score),
      alert: score > 75,
      breakdown: {
        inversion: { value: inv1, score: Math.round(inv1Score), weight: 0.5 * 0.7 },
        inversionDepth: { value: inv2, score: Math.round(inv2Score), weight: 0.5 * 0.3 },
        upperHumidity: { value: h.upperHumidity, score: Math.round(humidityScore), weight: 0.25 },
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
    const inv1 = h.upperTemp - h.surfaceTemp;
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
        inversion: { value: inv1, score: Math.round(inversionScore), weight: 0.5 },
        visibility: { value: h.visibility, score: Math.round(visibilityScore), weight: 0.35 },
        windSpeed: { value: h.windSpeed, score: Math.round(windScore), weight: 0.15 }
      }
    };
  }

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

  async function fetchHourlyWeather(lat, lng, days = 4) {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&hourly=${OPEN_METEO_HOURLY.join(',')}&forecast_days=${days}&timezone=auto`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Open-Meteo API 錯誤：${res.status}`);
    return res.json();
  }

  // ---- Ensemble(多組模式成員)：估算預測信心區間，不是取代主要預測 ----
  // icon_seamless模式有40組成員，各自對雲量/氣溫等給不同數字，
  // 成員之間分歧越大代表這組天氣現象越不確定，分歧小代表模式間有共識。
  async function fetchEnsembleWeather(lat, lng, days = 2) {
    const url = `https://ensemble-api.open-meteo.com/v1/ensemble?latitude=${lat}&longitude=${lng}&hourly=${OPEN_METEO_HOURLY.join(',')}&forecast_days=${days}&models=icon_seamless`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Open-Meteo Ensemble API 錯誤：${res.status}`);
    return res.json();
  }

  function ensembleMemberCount(hourly) {
    let n = 0;
    while (hourly[`cloudcover_low_member${String(n + 1).padStart(2, '0')}`]) n++;
    return n;
  }

  function hAtMember(hourly, index, member) {
    const suffix = member === 0 ? '' : `_member${String(member).padStart(2, '0')}`;
    const get = (name) => hourly[name + suffix][index];
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
      windSpeed: get('windspeed_10m') / 3.6,
      // 月相不受天氣模式影響，各成員共用同一個值，只是讓ensemble score計算跟
      // 真正顯示的分數(也含月相)口徑一致，不會系統性偏移confidence區間
      moonIllumination: window.SunCalc.getMoonIllumination(new Date(hourly.time[index])).fraction
    };
  }

  // scoreFn是fieryGlowScore/seaOfCloudsScore/starsScore其中一個，
  // 回傳80%成員落在的分數區間(p10~p90)，區間越窄代表模式間越有共識
  function ensembleConfidence(hourly, index, scoreFn) {
    const n = ensembleMemberCount(hourly);
    if (!n) return null;
    const scores = [];
    for (let m = 1; m <= n; m++) {
      scores.push(scoreFn(hAtMember(hourly, index, m)).score);
    }
    scores.sort((a, b) => a - b);
    const p10 = scores[Math.floor(scores.length * 0.1)];
    const p90 = scores[Math.min(scores.length - 1, Math.ceil(scores.length * 0.9))];
    const spread = p90 - p10;
    const level = spread <= 20 ? '高' : spread <= 40 ? '中等' : '低';
    return { p10, p90, spread, level, memberCount: n };
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
    fetchEnsembleWeather,
    ensembleConfidence,
    nearestHourIndex,
    hourAt,
    hourAtWindow,
    nearestCwaStation
  };
}());
