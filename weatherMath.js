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

  // PRD §2B：權重是估計值，之後依實測回饋校準，不是驗證過的氣象公式
  function fieryGlowScore(h) {
    const lowScore = h.cloudLow <= 10 ? 100
      : h.cloudLow >= 30 ? Math.max(0, 40 - (h.cloudLow - 30) * 2)
      : clampLerp(h.cloudLow, 10, 100, 30, 40);
    const midHigh = h.cloudMid + h.cloudHigh;
    const midHighScore = triangleScore(midHigh, 0, 40, 70, 100);
    const humidityScore = h.humidity <= 50 ? 100 : clampLerp(h.humidity, 50, 100, 100, 0);
    const visibilityScore = clampLerp(h.visibility, 5000, 0, 15000, 100);

    const score = lowScore * 0.35 + midHighScore * 0.35 + humidityScore * 0.15 + visibilityScore * 0.15;
    return { score: Math.round(score), alert: score > 75 };
  }

  // PRD §2C：逆溫是主因子(50%)，邊界層濕度(25%)+地表風速(25%)輔助
  function seaOfCloudsScore(h) {
    const inversion = h.upperTemp - h.surfaceTemp;
    const inversionScore = inversion > 0 ? clampLerp(inversion, 0, 50, 6, 100) : clampLerp(inversion, -6, 0, 0, 50);
    const humidityScore = h.upperHumidity >= 85 ? 100 : clampLerp(h.upperHumidity, 50, 0, 85, 100);
    const windScore = h.windSpeed <= 2 ? 100
      : h.windSpeed >= 5 ? 0
      : clampLerp(h.windSpeed, 2, 100, 5, 0);

    const score = inversionScore * 0.5 + humidityScore * 0.25 + windScore * 0.25;
    return { score: Math.round(score), alert: score > 75 };
  }

  const OPEN_METEO_HOURLY = [
    'cloudcover_low', 'cloudcover_mid', 'cloudcover_high',
    'relativehumidity_2m', 'visibility', 'temperature_2m',
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

  function hourAt(hourly, index) {
    return {
      cloudLow: hourly.cloudcover_low[index],
      cloudMid: hourly.cloudcover_mid[index],
      cloudHigh: hourly.cloudcover_high[index],
      humidity: hourly.relativehumidity_2m[index],
      visibility: hourly.visibility[index],
      surfaceTemp: hourly.temperature_2m[index],
      upperTemp: hourly.temperature_925hPa[index],
      upperHumidity: hourly.relativehumidity_925hPa[index],
      windSpeed: hourly.windspeed_10m[index] / 3.6 // km/h -> m/s，PRD門檻(4m/s)用m/s
    };
  }

  window.WeatherMath = {
    getGoldenBlueHours,
    fieryGlowScore,
    seaOfCloudsScore,
    fetchHourlyWeather,
    nearestHourIndex,
    hourAt
  };
}());
