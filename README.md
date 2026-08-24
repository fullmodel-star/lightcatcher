# 402 光影獵人 LightCatcher

自然光影捕捉管家：黃金時刻/藍調時刻倒數、火燒雲指數、雲海指數＋雲海高度估算、觀星指數。山脈家族（k2, `#A64B38`）第三支，PWA 架構仿 400 走稜步道（單檔 hash 路由）。

原始需求：React Native+Expo+Supabase PRD，討論後改走純PWA。**2026-08-24 產品方向大幅簡化**（老闆實測後回饋）：拿掉Email登入/訂閱熱點/推播通知/打卡回報整套機制，全站改成完全開放瀏覽不用帳號；改成「首頁景點快選＋分開呈現各指數＋因子拆解＋雲海高度估算＋預測方法說明頁」，強調專業感與簡單操作。現在只有3個畫面：首頁/地圖探索/預測說明。

## 現況：v0.5（產品方向大改版後）

**已上線 https://lightcatcher.pages.dev/**，3個畫面：首頁／地圖探索／預測說明。

### 目前有的功能
- 黃金/藍調時刻倒數（`suncalc`本機計算）
- 首頁景點快選：從Supabase `spots`表載入53個知名景點的快選按鈕，點了自動定位+抓氣象
- 機率預測**分開呈現**：選了特定景點只顯示該景點對應現象的指數卡（火燒雲/雲海/觀星擇一）；沒選景點(手動座標/GPS)則三張都顯示。每張卡都拆解出實際因子數值+子分數，不是單一黑箱數字
- **雲海高度估算**：用氣象學經典的LCL公式（`125×(氣溫-露點)`估算凝結高度），換算成海拔後跟景點高程比較，判斷機位在雲層之上/之中/之下
- 未來三日預測（會依選中景點類型只顯示相關指數）
- 地圖探索：Leaflet+OSM圖磚，**完全開放瀏覽不用帳號**，53個景點依機率變色，雲海類型景點popup會顯示雲海高度
- 「預測說明」頁：每個指數的計算邏輯、權重、資料來源，白紙黑字寫清楚建立可信度
- 稜線品牌footer + PWA安裝按鈕 + 正式icon(`sunset-2`)

### 準確度改善（2026-08-24，老闆點名「怎麼讓預測更準」後一次做4項）
1. **逆溫層厚度**：雲海指數原本只比較地面vs925hPa，現在加上850hPa判斷逆溫「蓋子」夠不夠厚（蓋子薄容易破碎消散）
2. **CWA即時觀測交叉驗證**：接中央氣象署O-A0003-001「現在天氣觀測報告」(363測站)，顯示最近測站(15km內)的實際觀測當對照，**金鑰走`_worker/`代理不落前端**（比照401 alpineplan-weather的作法），已部署`lightcatcher-cwa.fullmodel.workers.dev`
3. **時間窗平均**：所有評分改用`hourAtWindow()`取目標時刻前後1小時整點資料平均，不再只看單一整點
4. **模型信心區間**：用Open-Meteo ensemble API(icon_seamless，約40組模式成員)算80%信心區間，落差小顯示「信心高」，是不確定性的誠實揭露不是準確度保證

### 2026-08-24 拿掉的功能（老闆實測後回饋：越簡單越好，不要帳號門檻）
Email magic-link登入、訂閱熱點+推播通知(Web Push/VAPID/Edge Function `check-alerts`)、打卡回報+照片上傳+即時動態牆——**整套移除**，不是隱藏。Supabase的`profiles`/`subscriptions`/`push_subscriptions`/`reports`表還在（沒刪，怕未來要用），但前端完全不呼叫；Edge Function與相關GitHub Actions workflow已刪除。`spots`表繼續用（地圖與首頁快選都靠它），這是唯一還在用的後端功能，所以Supabase**還是需要**、免費保活排程(`keepalive.yml`)也還是需要。

### 待確認
- GPS定位互動、真人實際使用體驗——headless測試模擬不到
- 評分公式係數仍是方向性估計值，不是驗證過的氣象公式

## 評分公式現況（重要：目前是「方向正確、可運作」的推估係數，不是精雕過的權重）

PRD 只給了每個因子的方向（越低越好/40-70%最佳等），沒給精確的分段函數參數。`weatherMath.js` 裡的門檻值（例如低雲30%開始扣分、濕度75%分界）是照PRD方向自訂的線性/三角形插值，**之後要依老闆實際使用回饋校準**，不要當成已驗證過的氣象學公式。

## 保活提醒（Supabase免費專案）

Supabase 免費專案**連續7天無API活動會自動暫停**（資料不會丟，但App會連不上）。`.github\workflows\keepalive.yml` 每3天打一次輕量查詢，anon key設計上可公開所以直接寫在workflow裡，沒有另外設repo secret。**這支排程要repo實際push上GitHub、且Actions沒被停用才會生效**，遷移repo或改機構名稱時要記得確認它還在跑。

## 部署

**已上線**：https://lightcatcher.pages.dev/（2026-08-23，Cloudflare Pages，帳號fullmodel@gmail.com）

```
node _tools\build-staging.mjs
cd _staging
npx wrangler pages deploy . --project-name=lightcatcher --branch main --commit-dirty=true
```

`_tools\build-staging.mjs` 排除 `_*`／`.md`／`.sql`／`.py`／`.git`／`.github`／`supabase`／`brand.config.json`，自帶「sw.js ASSETS都在staging」與「無底線路徑外洩」兩道檢查，沒過會`exit 1`。**不要手打glob**。

### CWA代理Worker（`_worker/`）

```
cd _worker
npx wrangler deploy --config wrangler.toml
npx wrangler secret put CWA_KEY --config wrangler.toml   # 貼CWA_A7240...那組授權碼
```

已上線：`https://lightcatcher-cwa.fullmodel.workers.dev/observations`。CWA_KEY是老闆個人帳號的授權碼（opendata.cwa.gov.tw申請），**只存在Worker secret，不落任何前端檔案／git**。快取10分鐘（CWA自動測站約10分鐘更新一次）。

## 品牌 icon

Tabler `sunset-2`（地平線+半圓落日），家族色 `#A64B38`。已登記進 `05_品牌資源\03_App圖示_正式檔\02_安裝icon_其他家族\_README.md` 並產出正式檔（`icon-192.png`/`icon-512.png`），簽名帶檢測通過。

## 更新記錄

- 2026-08-24 v0.6：準確度改善4項——850hPa逆溫層厚度、CWA即時觀測交叉驗證(`_worker/`代理)、時間窗平均、ensemble模型信心區間。單元測試29項全過。
- 2026-08-24 v0.5：**產品方向大改版**——拿掉登入/訂閱/推播/打卡回報整套機制，全站開放瀏覽；機率預測改分開呈現+因子拆解，新增雲海高度估算(LCL公式)、觀星指數、首頁景點快選、預測說明頁；`seed.sql`從17個佔位景點換成53個老闆親自研究的景點（66筆，含多現象拆列），海拔以Open-Meteo API查詢為主、4個點依老闆給的明確數字覆蓋(API山區格點常低估)。
- 2026-08-23 v0.4：上線 https://lightcatcher.pages.dev/（wrangler Pages，Production/main實測確認）。新增`_tools\build-staging.mjs`。
- 2026-08-23 v0.3：完成 Phase 6。套用稜線品牌識別(footer+安裝按鈕)＋正式icon(sunset-2)，Phase 0-6全部完成。
- 2026-08-23 v0.2：完成 Phase 3。Supabase專案建好(4表+RLS+Storage bucket)，Email magic-link登入，GitHub repo `fullmodel-star/lightcatcher`公開建立並push，免費保活workflow實測手動觸發成功(HTTP 200)。⚠️首次push後GitHub Actions workflow清單一度顯示0筆（索引延遲），多推一次commit後才正常註冊，遇到同樣狀況不用懷疑YAML語法，先試著再push一次。
- 2026-08-23 v0.1：開案，完成 Phase 0-2（專案骨架、天文計算、氣象評分演算法），Open-Meteo API 欄位實測通過。
