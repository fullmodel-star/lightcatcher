// 402 光影獵人：定期檢查訂閱門檻，超過就發Web Push推播
// 排程：GitHub Actions每3小時打一次這個function的URL（見.github/workflows/push-alerts.yml）
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 由Supabase自動注入，不用手動設secret
// VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT 是手動設的secret

import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

webpush.setVapidDetails(
  Deno.env.get('VAPID_SUBJECT')!,
  Deno.env.get('VAPID_PUBLIC_KEY')!,
  Deno.env.get('VAPID_PRIVATE_KEY')!
);

// ---- 以下三個評分函式跟前端 weatherMath.js 邏輯一致，Deno環境沒辦法
// 直接載入瀏覽器版那支檔案，只能複製一份。改評分公式時兩邊都要改。----
function clampLerp(x: number, x0: number, y0: number, x1: number, y1: number) {
  if (x1 === x0) return y0;
  const t = (x - x0) / (x1 - x0);
  const c = Math.max(0, Math.min(1, t));
  return y0 + c * (y1 - y0);
}

function triangleScore(v: number, floorLo: number, lo: number, hi: number, floorHi: number) {
  if (v <= floorLo || v >= floorHi) return 0;
  if (v < lo) return clampLerp(v, floorLo, 0, lo, 100);
  if (v > hi) return clampLerp(v, hi, 100, floorHi, 0);
  return 100;
}

function fieryGlowScore(h: any) {
  const lowScore = h.cloudLow <= 10 ? 100
    : h.cloudLow >= 30 ? Math.max(0, 40 - (h.cloudLow - 30) * 2)
    : clampLerp(h.cloudLow, 10, 100, 30, 40);
  const midHigh = h.cloudMid + h.cloudHigh;
  const midHighScore = triangleScore(midHigh, 0, 40, 70, 100);
  const humidityScore = h.humidity <= 50 ? 100 : clampLerp(h.humidity, 50, 100, 100, 0);
  const visibilityScore = clampLerp(h.visibility, 5000, 0, 15000, 100);
  return Math.round(lowScore * 0.35 + midHighScore * 0.35 + humidityScore * 0.15 + visibilityScore * 0.15);
}

function seaOfCloudsScore(h: any) {
  const inversion = h.upperTemp - h.surfaceTemp;
  const inversionScore = inversion > 0 ? clampLerp(inversion, 0, 50, 6, 100) : clampLerp(inversion, -6, 0, 0, 50);
  const humidityScore = h.upperHumidity >= 85 ? 100 : clampLerp(h.upperHumidity, 50, 0, 85, 100);
  const windScore = h.windSpeed <= 2 ? 100 : h.windSpeed >= 5 ? 0 : clampLerp(h.windSpeed, 2, 100, 5, 0);
  return Math.round(inversionScore * 0.5 + humidityScore * 0.25 + windScore * 0.25);
}

function scoreForType(type: string, h: any) {
  if (type === 'sea_of_clouds') return seaOfCloudsScore(h);
  if (type === 'sunset' || type === 'sunrise') return fieryGlowScore(h);
  return Math.round(100 - h.cloudLow); // 'stars'：低雲量代理指標
}

const OPEN_METEO_HOURLY = [
  'cloudcover_low', 'cloudcover_mid', 'cloudcover_high',
  'relativehumidity_2m', 'visibility', 'temperature_2m',
  'temperature_925hPa', 'relativehumidity_925hPa', 'windspeed_10m'
];

async function scoreForSpot(spot: { lat: number; lng: number; type: string }) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${spot.lat}&longitude=${spot.lng}&hourly=${OPEN_METEO_HOURLY.join(',')}&forecast_days=1&timezone=auto`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`open-meteo ${res.status}`);
  const data = await res.json();
  const now = Date.now();
  let idx = 0, best = Infinity;
  data.hourly.time.forEach((t: string, i: number) => {
    const diff = Math.abs(new Date(t).getTime() - now);
    if (diff < best) { best = diff; idx = i; }
  });
  const h = {
    cloudLow: data.hourly.cloudcover_low[idx],
    cloudMid: data.hourly.cloudcover_mid[idx],
    cloudHigh: data.hourly.cloudcover_high[idx],
    humidity: data.hourly.relativehumidity_2m[idx],
    visibility: data.hourly.visibility[idx],
    surfaceTemp: data.hourly.temperature_2m[idx],
    upperTemp: data.hourly.temperature_925hPa[idx],
    upperHumidity: data.hourly.relativehumidity_925hPa[idx],
    windSpeed: data.hourly.windspeed_10m[idx] / 3.6
  };
  return scoreForType(spot.type, h);
}

Deno.serve(async () => {
  const { data: subs, error } = await supabase
    .from('subscriptions')
    .select('id, user_id, notify_threshold, last_notified_at, spots(id,name,lat,lng,type)');

  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

  let checked = 0, sent = 0;
  for (const sub of subs ?? []) {
    checked++;
    const spot = (sub as any).spots;
    if (!spot) continue;

    // 6小時內通知過同一個訂閱就先跳過，避免同一個大景反覆轟炸
    if (sub.last_notified_at && Date.now() - new Date(sub.last_notified_at).getTime() < 6 * 3600 * 1000) continue;

    let score: number;
    try {
      score = await scoreForSpot(spot);
    } catch (_e) {
      continue; // 單一熱點氣象抓取失敗不擋其他訂閱
    }
    if (score <= sub.notify_threshold) continue;

    const { data: pushSubs } = await supabase
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth')
      .eq('user_id', sub.user_id);
    if (!pushSubs || !pushSubs.length) continue;

    const payload = JSON.stringify({
      title: `${spot.name} 機率 ${score} 分！`,
      body: '光影獵人偵測到大景機會，快去看看吧'
    });

    for (const ps of pushSubs) {
      try {
        await webpush.sendNotification(
          { endpoint: ps.endpoint, keys: { p256dh: ps.p256dh, auth: ps.auth } },
          payload
        );
        sent++;
      } catch (_e) {
        // 端點失效(使用者移除訂閱/瀏覽器過期)，靜默略過不擋其他使用者
      }
    }
    await supabase.from('subscriptions').update({ last_notified_at: new Date().toISOString() }).eq('id', sub.id);
  }

  return new Response(JSON.stringify({ checked, sent }), { headers: { 'Content-Type': 'application/json' } });
});
