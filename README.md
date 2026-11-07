# 歐米票夾 OmniTrunk (`omnipass-trunk-app`)

> **以 OmniPass (`https://app.omnipass.tw/`) 為底，TaskTrunk (`task-trunk-app`) 功能為靈魂的本地優先票券與條碼連刷 PWA**

---

## 1. 專案定位與核心設計

本專案基於 [`morluto/rea` (`reverse-engineer-anything`)](https://github.com/morluto/rea) 對 `https://app.omnipass.tw/` 的靜態逆向工程分析報告（詳見 [`REA_OMNIPASS_ANALYSIS.md`](./REA_OMNIPASS_ANALYSIS.md)，主證據 ID：`ev_f21fe560030525a9a8258e4631c372b53e1c520af551f63d9a2124edf0e6cfc1`），將兩套系統的優勢深度融合：

### 基底層：OmniPass 基因 (`src/js/services/omniCoreService.js`、`src/css/main.css`)
- **深海靛藍視覺設計系統**：`#10172b -> #0b1020` 深色漸層畫布、`#536dfe -> #3656db` 靛藍行動按鈕、`#111827 -> #1d4ed8` 英雄統計卡 (`.omni-hero-card`)。
- **結帳連刷模式 (`#checkout` — `src/js/pages/checkoutPage.js`)**：支援設定前置條碼（手機條碼載具 `CODE_39`、常用會員卡 `CODE_128`），並勾選多張待使用票券排入結帳佇列，左右滑動高對比條碼/QR/原圖、一鍵「核銷此張並跳下一張」。
- **資產總覽儀表板 (`#summary` — `src/js/pages/summaryPage.js`)**：即時統計待使用、即將到期、已逾期、已核銷、置頂、原圖、重複序號組數與 `#標籤` 分佈。
- **PBKDF2-SHA256 (600,000 次迭代) + AES-256-GCM 加密備份 (`.opbackup`)**：完整相容 OmniPass 加密封裝規格，並可直接匯入原版 OmniPass 備份檔。
- **Web Audio API 五種合成掃碼音效 (`SCAN_SUCCESS_SOUNDS`)**：內建 `market`（超市清脆嗶聲）、`register`（收銀機雙音）、`digital`（電子短音）、`chime`（柔和提示音）、`classic`（經典單音）。
- **App 內建瀏覽器偵測橫幅 (`detectInAppBrowser`)**：自動偵測 LINE / Facebook / Instagram / Messenger / Threads / WeChat / TikTok / X WebView 並提醒切換至系統瀏覽器。
- **相機即時掃碼 (`#live-camera-scan-btn`) + 零外部依賴 Pure-JS `CODE128` / `CODE39` 條碼渲染器**。

### 靈魂層：TaskTrunk 完整功能 (`src/js/utils.js`、`src/js/pages/ticketsPage.js`、`src/js/pages/addPage.js`、`src/js/pages/settingsPage.js`)
- **三態生命週期與動態導覽列 (`getNavVisibility`)**：`active`（待使用）、`completed`（已使用）、`deleted`（回收桶），當「已使用」或「回收桶」為 0 張時自動隱藏導覽項目。
- **置頂正規化規則 (`normalizeTicket`)**：置頂 (`pinned`) 僅限未使用票券，一旦核銷或移入回收桶自動清除置頂。
- **智慧到期日輸入遮罩 (`formatExpiryMask` / `parseExpiryText`)**：數字鍵盤輸入 `20261231` 自動補斜線為 `2026/12/31`，並嚴格檢查閏年與真實日曆日期。
- **`85度C` 標題自動套用範本與動態 Canvas 電子票券合成 (`renderBatchTicketImage` / `deriveTicketDescription`)**：自動依品名金額推導商品描述（如 `50元飲品任選一`）並重繪專屬序號、QR Code 與期限。
- **9 區域截圖多條碼辨識 (`scanMultipleBarcodesFromImage`)** 與多結果選擇器。
- **三種核銷模式（原圖模式 / 標準條碼+QR / MOMO 電子票券明細）** + 全螢幕亮度提示 (`💡 建議將手機亮度調至最高`)。
- **左/右滑動手勢與長按批次管理**、**v1.6.2 真透明卡片 (`0.73` alpha，無毛玻璃模糊)**、**三視圖獨立多背景圖輪播**、**Telegram 到期與核銷通知**、**資料健康度與條碼一致性稽核**。

---

## 2. 快速啟動與測試

### 免安裝零依賴直接啟動（原生 ES Module 伺服器）
```bash
cd /Users/neochiu/task-trunk-app/omnipass-trunk-app
npm start
# 開啟 http://localhost:8088
```

### 執行完整單元測試（55 項測試）
```bash
cd /Users/neochiu/task-trunk-app/omnipass-trunk-app
npm test
```

### 使用 Vite 開發或打包生產環境 PWA
```bash
cd /Users/neochiu/task-trunk-app/omnipass-trunk-app
npm install
npm run dev
npm run build
```

