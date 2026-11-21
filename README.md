# 環境門檻監測卡

Home Assistant Lovelace 自訂卡片：從現有的 `sensor.*` 實體讀取數值，不會觸發服務、不輪詢、不修改捲揚自動化。開發版，尚未在實機 HA 安裝驗證，未發佈 HACS 版本。

## 安裝開發版（測試用）

1. 複製 `environment-threshold-card.js` 到 HA 的 `<config>/www/`。
2. 在「設定 → 儀表板 → 資源」加入 `/local/environment-threshold-card.js`，類型為 JavaScript 模組。
3. 編輯儀表板，新增「環境門檻監測」卡片。依需求新增項目，從實體建議選擇或輸入 `sensor.*` ID，再選感測類型、名稱和上下限。按「套用項目」更新卡片預覽，最後由 HA 儲存儀表板。

也可在手動卡片設定加入：

```yaml
type: custom:environment-threshold-card
title: 北側溫室
items:
  - entity: sensor.north_temperature
    kind: temperature
    below: 18
    above: 32
    unit: '°C'
  - entity: sensor.roof_wind_speed
    kind: wind
    above: 8
    unit: 'm/s'
```

請替換範例的實體 ID 和門檻；不要直接把範例門檻當成控制設備的安全設定。

## 顯示規則

- 不要求湊滿四項。每列依**卡片本身**寬度與已設定的項目數決定，空間不足會換行，空間足夠可超過四項；若 HA 的儀表板欄位配置限制卡片外框寬度，內部也會依實際空間排列。
- `kind` 可用 `light`、`temperature`、`humidity`、`wind`、`custom`；省略則以實體 device class 推斷。可重複使用相同類型或實體。
- 只在嚴格大於 `above` 或小於 `below` 時超標；可只設一邊，兩邊皆空只讀值。上下限同時設定時，下限必須小於上限。
- 過高為紅色與向上動畫；過低為藍色與向下動畫。箭頭不是讀值趨勢。支援系統減少動態效果偏好。
- 缺少實體、`unknown`、`unavailable` 或非數字顯示「無讀值」。圖形編輯器儲存門檻時會記錄感測器單位（無單位則記錄空字串）。感測器尚未出現時，可先儲存不含門檻的項目，或沿用同一實體已記錄的單位。若之後單位改變，會顯示「單位已變更」並暫停該項比較，應重新換算、儲存門檻。手寫 YAML 若省略 `unit`，門檻直接與實體回報的原始數字比較，不會做單位轉換。
- 只在瀏覽器內顯示狀態；關閉儀表板後若需要通知或聯動，請另外用 HA 自動化實作。

## 開發測試

需要 Node.js 22 或更新版本。

```sh
npm ci --ignore-scripts
npx playwright install chromium
npm run check
npm test
```

Playwright 使用模擬 HA 實體資料，驗證同一視窗中改變卡片寬度、深淺主題、超標狀態與卡片編輯流程，測試期間不連線到 HA。
