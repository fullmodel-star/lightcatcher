/* RL_FRESH_START — 2026-10-19 全家族「離線要有，但不能擋更新」（母版：04_管理工具\PWA新鮮度\rl_fresh_sw.js，用 apply.py 重新套用，不要在這裡手改）
   問題：原本 fetch 對網頁本身也是 cache-first → 重整先畫舊畫面、發新版要開兩次才看得到。
   做法：這段排在 sw.js 最前面、最先註冊 fetch：網頁／程式／樣式／資料（.html .js .mjs .css .json 與導覽）一律先拿線上最新的，
   4 秒沒回應或離線才用快取；成功時存一份到 rl-fresh 快取，離線也有最新版可用。
   圖片、字型、地圖圖磚等其他檔案不攔，交給原本的 handler（照舊 cache-first）。
   攔下的請求呼叫 stopImmediatePropagation()，原本的 fetch handler 不會再處理同一個請求。 */
(function(){
  var FRESH = 'rl-fresh';
  var CODE = /\.(?:html?|m?js|css|json|webmanifest)$/i;
  function fromCache(req){
    return caches.match(req).then(function(r){
      if (r) return r;
      return caches.match(req, { ignoreSearch: true }).then(function(r2){
        if (r2 || req.mode !== 'navigate') return r2;
        return caches.match('./').then(function(r3){ return r3 || caches.match('./index.html') || caches.match('index.html'); });
      });
    });
  }
  function fresh(e, req){
    var net = fetch(req).then(function(res){
      if (res && res.ok && res.type === 'basic'){
        var copy = res.clone();
        e.waitUntil(caches.open(FRESH).then(function(c){ return c.put(req, copy); }).catch(function(){}));
      }
      return res;
    });
    var timer = new Promise(function(resolve){ setTimeout(function(){ resolve(null); }, 4000); });
    return Promise.race([net.catch(function(){ return null; }), timer]).then(function(res){
      if (res && (res.ok || res.status === 304 || res.type === 'opaqueredirect')) return res;
      return fromCache(req).then(function(c){
        if (c) return c;
        return net.catch(function(){ return Response.error(); });   /* 快取也沒有：再等網路（可能只是慢） */
      });
    });
  }
  self.addEventListener('fetch', function(e){
    var req = e.request;
    if (req.method !== 'GET') return;
    var url; try { url = new URL(req.url); } catch (x) { return; }
    if (url.origin !== self.location.origin) return;
    if (url.pathname.indexOf('/api/') === 0) return;          /* 有自己 API 的 App（Worker）交給原本邏輯 */
    var isDoc = req.mode === 'navigate' || url.pathname.slice(-1) === '/' || CODE.test(url.pathname);
    if (!isDoc) return;
    if (url.pathname.slice(-6) === '/sw.js' || url.pathname === '/sw.js') return;
    e.stopImmediatePropagation();
    e.respondWith(fresh(e, req));
  });
})();
/* RL_FRESH_END */
const CACHE = 'lightcatcher-v52';

// 鐵則16：預先快取清單不放任何 .html（含 index.html），避免 Cloudflare Pages
// 對 .html 的 308 轉址被存成 redirected:true 的 Response 後拿去 respondWith 導覽請求。
// index.html 由 fetch handler 在造訪時才動態快取。
const ASSETS = [
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-192.png',
  './icon-maskable-512.png',
  './icon-180.png',
  './apple-touch-icon.png',
  './favicon-32.png',
  './weatherMath.js',
  './vendor/suncalc.js',
  './data/spots.json',   // 2026-09-30：Supabase 連不上時的景點靜態備援
  './vendor/jetbrains-mono/JetBrainsMono-latin.woff2',   // 2026-10-19 v0.19：天色時鐘數字用的自帶等寬字
  './vendor/leaflet/leaflet.js',
  './vendor/leaflet/leaflet.css',
  './vendor/leaflet/images/marker-icon.png',
  './vendor/leaflet/images/marker-icon-2x.png',
  './vendor/leaflet/images/marker-shadow.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => Promise.allSettled(ASSETS.map((url) => cache.add(url))))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          caches.open(CACHE).then((cache) => cache.put('./', res.clone()));
          return res;
        })
        .catch(() => caches.match('./'))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req))
  );
});
