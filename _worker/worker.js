/* ============================================================
   光影獵人 · 中央氣象署(CWA)即時觀測代理

   為什麼需要這支Worker：CWA的個人授權碼不能寫進前端原始碼（這支
   repo是公開的），任何人開View Source都看得到、拿去用會佔用老闆
   的個人額度。做法比照401登山管理平台的alpineplan-weather Worker：
   金鑰放wrangler secret（不進git、不進任何前端檔案），前端只呼叫
   這支Worker。

   用途：O-A0003-001「現在天氣觀測報告」(~363個測站，含合歡山/
   阿里山/玉山/日月潭/恆春/蘭嶼等貼近本App景點的測站)，讓使用者
   在看到我們自己算出來的預測分數之外，也能對照氣象署測站的即時
   實測天氣(現象/能見度/溫濕度)，是交叉驗證用途不是取代預測。

   路由：GET /observations → 全部測站的即時觀測(精簡過的欄位)
   ============================================================ */

const CACHE_TTL_SECONDS = 600; // 自動測站約每10分鐘更新一次

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return withCors(new Response(null, { status: 204 }));
    const url = new URL(request.url);
    try {
      if (url.pathname === '/observations') return withCors(await handleObservations(env, ctx));
      return withCors(jsonRes({ error: '找不到這個路徑，支援 /observations' }, 404));
    } catch (err) {
      return withCors(jsonRes({ error: '資料源目前無法取得：' + err.message }, 502));
    }
  }
};

async function handleObservations(env, ctx) {
  const cache = caches.default;
  const cacheKey = new Request('https://lightcatcher-cwa-cache.internal/observations');
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  if (!env.CWA_KEY) throw new Error('Worker未設定CWA_KEY（wrangler secret未設或設錯名字）');

  const upstream = `https://opendata.cwa.gov.tw/api/v1/rest/datastore/O-A0003-001` +
    `?Authorization=${encodeURIComponent(env.CWA_KEY)}`;
  const r = await fetch(upstream);
  if (!r.ok) throw new Error(`上游回應HTTP ${r.status}（授權碼可能失效，或氣象署服務暫時異常）`);

  const data = await r.json();
  const stations = (data.records && data.records.Station) || [];
  const slim = stations.map((s) => {
    const wgs84 = s.GeoInfo.Coordinates.find((c) => c.CoordinateName === 'WGS84') || s.GeoInfo.Coordinates[0];
    const we = s.WeatherElement || {};
    return {
      name: s.StationName,
      lat: Number(wgs84.StationLatitude),
      lng: Number(wgs84.StationLongitude),
      elevation: Number(s.GeoInfo.StationAltitude),
      weather: we.Weather,
      visibility: we.VisibilityDescription,
      temperature: Number(we.AirTemperature),
      humidity: Number(we.RelativeHumidity),
      obsTime: s.ObsTime && s.ObsTime.DateTime
    };
  }).filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng));

  const body = jsonRes({ stations: slim, fetchedAt: new Date().toISOString() }, 200, {
    'cache-control': `public, max-age=${CACHE_TTL_SECONDS}`
  });
  ctx.waitUntil(cache.put(cacheKey, body.clone()));
  return body;
}

function jsonRes(obj, status = 200, extraHeaders) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: Object.assign({ 'content-type': 'application/json; charset=utf-8' }, extraHeaders || {})
  });
}
function withCors(res) {
  const h = new Headers(res.headers);
  h.set('Access-Control-Allow-Origin', '*'); // 唯讀公開氣象資料代理，開放存取不是安全風險
  h.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  h.set('Access-Control-Allow-Headers', 'Content-Type');
  return new Response(res.body, { status: res.status, headers: h });
}
