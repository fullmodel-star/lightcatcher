# 402 光影獵人 LightCatcher

自然光影捕捉管家：黃金時刻/藍調時刻倒數、火燒雲爆發指數、雲海機率指數，攝影社群即時回報。山脈家族（k2, `#A64B38`）第三支，PWA 架構仿 400 走稜步道（單檔 hash 路由），非 401 登山管理平台的多頁+view模組架構——這支只有4個畫面（Dashboard/Explore Map/Live Radar/Profile），沒有401那種11頁規模才需要的中繼複雜度。

原始需求：React Native+Expo+Supabase PRD，討論後改走純PWA（跟山脈家族其他App技術棧一致、Windows不用裝Xcode/Android Studio）。規劃全文見 `_docs\_開案規劃_20260823.md`。

## 現況：v0.1（開案，Phase 0-2 進行中）

- ✅ Phase 0 專案骨架：`index.html`/`manifest.json`/`sw.js`/`weatherMath.js`
- ✅ Phase 1 天文計算：`suncalc`（vendor 本機化，MIT/BSD授權）算黃金時刻/藍調時刻，Dashboard 倒數計時器
- ✅ Phase 2 氣象評分：Open-Meteo API（免key）串接，火燒雲指數/雲海指數兩個評分函式；**已實測確認** `temperature_850hPa`／`relativehumidity_850hPa`／`temperature_925hPa`／`relativehumidity_925hPa` 等氣壓層欄位在預設 model 下都存在，PRD 原始欄位名稱可直接使用，不用挑特定 model
- ⏳ Phase 3 待做：Supabase 後端（老闆需自行申請免費帳號）+ 免費保活排程（GitHub Actions 每3天ping一次，防閒置7天自動暫停）
- ⏳ Phase 4-6 待做：地圖探索、即時回報+推播、品牌套用

## 評分公式現況（重要：目前是「方向正確、可運作」的推估係數，不是精雕過的權重）

PRD 只給了每個因子的方向（越低越好/40-70%最佳等），沒給精確的分段函數參數。`weatherMath.js` 裡的門檻值（例如低雲30%開始扣分、濕度75%分界）是照PRD方向自訂的線性/三角形插值，**之後要依老闆實際使用回饋校準**，不要當成已驗證過的氣象學公式。

## 保活提醒（Supabase免費專案）

Supabase 免費專案**連續7天無API活動會自動暫停**（資料不會丟，但App會連不上）。Phase 3 建好後端後要記得補上 GitHub Actions 排程（`.github\workflows\keepalive.yml`，每3天打一次輕量查詢），忘記補這支排程，上線初期使用者少時很容易撞到。

## 部署（Phase 4+ 才會用到，目前僅本機開發）

```
node _tools\build-staging.mjs   # 尚未建立，比照401做法：乾淨staging排除_docs/_spec/.md
cd _staging
npx wrangler pages deploy . --project-name=lightcatcher --branch main --commit-dirty=true
```

## 品牌 icon（待Phase 6產出）

老闆已選定 Tabler `sunset-2`（地平線+半圓落日），家族色 `#A64B38`。**產圖前務必先登記進** `05_品牌資源\03_App圖示_正式檔\02_安裝icon_其他家族\_README.md`，避免撞圖。

## 更新記錄

- 2026-08-23 v0.1：開案，完成 Phase 0-2（專案骨架、天文計算、氣象評分演算法），Open-Meteo API 欄位實測通過。
