# OmniPass (`https://app.omnipass.tw/`) REA 逆向工程分析報告

> **分析工具與技能**：[`morluto/rea` (`reverse-engineer-anything`)](https://github.com/morluto/rea) — `rea-javascript-application` analyzer v1  
> **分析操作 (`operation`)**：`analyze_javascript_application` (`predicate_type: "rea.javascript-application-analysis"`)  
> **主證據 ID (`evidence_id`)**：`ev_f21fe560030525a9a8258e4631c372b53e1c520af551f63d9a2124edf0e6cfc1`  
> **語意圖 ID (`semantic_graph.graph_id`)**：`jsrg_6e1517654eaf9e313714f7ec9cec3bcefdcc20e5d4c9d0fef2ca903b199704ef`  
> **路由盤點 ID (`route_inventory.inventory_id`)**：`jsri:dc1cb1ff157ce82940dcbc0e39868932fe9e762aca88ae469e659eae74537afb`

---

## 1. 證據與構件盤點 (Artifact Inventory & Digests)

根據 REA 證據規範，以下為透過 `artifact-bytes` 與 `ast-static-analysis` 直接觀測到的構件雜湊與統計數據（`state: "observed"`, `confidence: "exact"`）：

| 構件項目 | 觀測識別碼 / 路徑 | SHA-256 雜湊值 | 大小 / 統計 | 證據節點 (`node_id`) |
| :--- | :--- | :--- | :--- | :--- |
| **Root 目標容器** | `omnipass_target` (`directory`) | `0e7f0eafa49535b027de105ff1a78fa8dea3da2c51f02a7bbd11594e980c9e51` | 2 個關聯檔案 (`453,889` bytes) | `jag_node_04e67c3c9eee230510015191e4e2c9d732385d04be1bdda6c997968c12561b4f` |
| **主 HTML 文件** | `index.html` (自 `https://app.omnipass.tw/` 擷取，共 5,223 行) | `a0591a322add03975cc3a6516fdd603585265ab0a56f8e644fb423d89565eb09` | `264,827` bytes | `jag_node_caaa56e870683256c4ad97eaa9e3856dcadf760e496a803e7a92e4e94cbc7f20` |
| **內嵌 ES Module 腳本** | `app.js` (擷取自 `index.html` 第 1232–5221 行 `<script type="module">`) | `9590d0f1acc67504179ffbe9561d4f0b385297d80d5e893dc35cba0c4aecd92f` | `189,062` bytes (3,989 行) | `jag_node_7b28c14be9210c012df8bc6d305a6cf33ddb9bced536ac44ae8ef7ade414e5eb` |
| **清單與圖譜摘要** | `agm_08df5a5198f1db1435774e3d84220f3965d4a82ff8b4977e7c23322f15fdfe21` | `48b60c5eaf9f15577d3ee09e77f4ae5f66e2eef20f16814934d358759b7d1c10` | 24 個應用圖節點、26 條邊 | `ev_f21fe560030525a9a8258e4631c372b53e1c520af551f63d9a2124edf0e6cfc1` |
| **AST 與語意圖規模** | `jsrg_6e1517654eaf9e313714f7ec9cec3bcefdcc20e5d4c9d0fef2ca903b199704ef` | — | `23,081` AST 節點、`16,019` 語意節點、`493` 函式、`1,855` 呼叫點、`941` 綁定 | `normalized_result.semantic_graph` |

---

## 2. 直接觀測事實 (`state: "observed"`, `confidence: "exact"`)

以下結論直接來自靜態 AST 解析 (`authority: "ast-static-analysis"`)、構件位元組 (`authority: "artifact-bytes"`) 及 HTTP 回應標頭觀測，**未執行任何目標環境程式碼**：

### 2.1 部署與單檔 PWA 架構
- **HTTP 伺服端標頭**：由 Cloudflare (`server: cloudflare`) 提供服務，啟用嚴格快取驗證 (`cache-control: public, max-age=0, must-revalidate`)、COOP (`Cross-Origin-Opener-Policy: same-origin`) 及 `X-Content-Type-Options: nosniff`。
- **應用版本標識**：於 DOM `#appVersion` 靜態觀測到版本字串 `v0.15.17-alpha(26100401)`（`index.html` 第 1161 行）。
- **單檔內聯結構**：`index.html` 將完整 CSS 樣式表（第 52–695 行）、DOM 視圖骨架（第 697–1231 行）與核心商業邏輯 `<script type="module">`（第 1232–5221 行，對應 `app.js` 第 1–3989 行）封裝於單一 HTML 文件中，無外部打包器（Webpack/Vite）產生的雜湊 chunk。

### 2.2 靜態觀測到的儲存層與網路端點
1. **IndexedDB 本地資料庫 (`jag_node_9c4e9a32ba2e2b4264e00629b9fa0ad466969c0e40019266c6a6470b0998b01c`)**：
   - 於 `app.js:1385:24-59` 觀測到 `indexedDB.open('CardWalletDB', 4)`。
   - 升級邏輯 (`onupgradeneeded`) 建立兩個 Object Store：
     - `cards`（`keyPath: 'id', autoIncrement: true`，索引包含 `type`、`store`、`customType`、`createdAt`、`usageStatus`）。
     - `settings`（`keyPath: 'key'`，儲存掃描成功音效、條碼排序、載具/結帳偏好等設定）。
2. **SessionStorage (`jag_node_4bad3c7a498a8d090d08ae3f383563c441633cfedf50a8bac9a7d80ee2cee30d`)**：
   - 於 `app.js:166:12-65` (`sessionStorage.getItem`) 與 `app.js:181:12-70` (`sessionStorage.setItem`) 觀測到鍵名 `'inAppBrowserBannerDismissed'`，用於記錄使用者是否已關閉「App 內建瀏覽器（LINE / FB / IG 等 WebView）限制提醒橫幅」。
3. **LocalStorage (`jag_node_b7f5c7d4236b49faba7b3cbb551b34a815a9538d4563c8fb70d004dffa02408e` / `jag_node_d280c61eededeb2418ae2212d573012018a5849a64692aeb3127f61760e9d49e`)**：
   - 於 `app.js:55:6-55`、`app.js:69:12-53`、`app.js:100:33-74` 觀測到 `localStorage.setItem` / `localStorage.getItem`，用於儲存匿名裝置識別碼與遙測佇列緩存。
4. **網路端點 (`jag_node_25ea7e0e30e8ee3198a1de9f5a04e4a3dba76300ded30b43eed30b43eedcd8bcdaa3dd7c`)**：
   - 於 `app.js:709:31-71` 觀測到 `fetch(versionUrl, { cache: 'no-store' })`（其中 `versionUrl` 為 `/version.json?t=${Date.now()}`），用於檢查線上是否有新版本並顯示更新橫幅 (`#updateBanner`)。

### 2.3 視覺設計系統與 UI 結構 (OmniPass Base Tokens)
於 `index.html` 第 52–695 行直接觀測到以下設計系統：
- **深海靛藍畫布 (Deep Midnight-Indigo Canvas)**：
  - `html { background-color: #0b1020; }`
  - `body` 背景：`radial-gradient(circle at 5% 0%, rgba(91, 125, 255, 0.24), transparent 30%), linear-gradient(180deg, #10172b 0%, #0b1020 100%)`
  - 畫布文字：`color: #eef2ff`，副標題 `color: #aeb8d4`，最大寬度 `max-width: 560px` 置中行動優先容器。
- **高對比白色浮動卡片 (`.card`)**：
  - `background: rgba(255, 255, 255, 0.96)`、`border-radius: 20px`、`padding: 18px`、`box-shadow: 0 16px 36px rgba(0, 0, 0, 0.22)`、`border: 1px solid rgba(255, 255, 255, 0.2)`。
- **品牌色與按鈕系統**：
  - 主按鈕 (`.btn`)：`background: linear-gradient(135deg, #536dfe, #3656db)`，`box-shadow: 0 10px 20px rgba(54, 86, 219, 0.28)`。
  - 次要成功按鈕 (`.btn-secondary`)：`background: linear-gradient(135deg, #16b889, #0b956e)`。
  - 選中晶片/篩選器：`background: #e8edff`、`border-color: #536dfe`、`color: #3656db`。
- **錢包統計英雄區 (`.wallet-summary-hero` & `.wallet-summary-grid`)**：
  - 英雄卡片採用 `background: linear-gradient(135deg, #111827, #1d4ed8)`，字體使用 `font-variant-numeric: tabular-nums` 呈現等寬大數字統計，下方搭配雙欄 `.wallet-summary-card` 網格。
- **底部毛玻璃五分頁導覽列 (`.bottom-nav`)**：
  - `position: fixed; bottom: 0; max-width: 560px; background: rgba(248, 250, 255, 0.94); backdrop-filter: blur(18px);`
  - 五個分頁：`scan`（掃描）、`wallet`（卡包）、`checkout`（結帳）、`summary`（總覽）、`settings`（設定）。
- **全螢幕高對比刷卡層 (`.fullscreen-overlay`)**：
  - 固定於全畫面的深色遮罩 (`rgba(7, 10, 20, 0.92)`) 與純白卡片載體，內含 `💡 建議將手機亮度調至最高` 提示與左右滑動切換卡片功能。

### 2.4 密碼學備份與音效合成機制 (AST 靜態觀測)
1. **加密備份規格 (`.opbackup`)**：
   - 於 `app.js:906-1190` 觀測到使用 Web Crypto API (`crypto.subtle`) 實作：
     - 格式標頭：`BACKUP_FORMAT = 'omnipass-encrypted-backup'`、`BACKUP_VERSION = 1`、副檔名 `.opbackup`。
     - 金鑰派生：`PBKDF2`，雜湊 `SHA-256`，迭代次數 `600,000` (`BACKUP_PBKDF2_ITERATIONS = 600000`)，隨機 16-byte salt。
     - 對稱加密：`AES-GCM`，256-bit 金鑰，隨機 12-byte IV。
2. **Web Audio API 掃描成功音效合成器 (`SCAN_SUCCESS_SOUNDS`)**：
   - 於 `app.js:354-465` 觀測到 5 組無外部音檔依賴的合成音效：`market`（超市清脆嗶聲）、`register`（收銀機雙音）、`digital`（電子短音）、`chime`（柔和提示音）、`classic`（經典單音）。

---

## 3. 靜態推論 (`state: "inferred"`)

以下關係由 REA 靜態關係推論器 (`authority: "static-relationship-inference"`) 建立，代表語法上存在的模組/資源引用，但靜態語法本身不單獨證明執行期必定觸發：

1. **Service Worker 註冊 (`jag_node_0c13f2334e6a4f2e1248a31b12bcc5d814ca406c944bf3ce8214834abedb6888`, `confidence: "high"`)**：
   - `app.js:676:6-48` 呼叫 `navigator.serviceWorker.register('/sw.js')` 以提供離線快取與版本更新控制。
2. **外部條碼繪製腳本引用 (`jag_node_5ada47517df4a11cebe95f7751ed6f8d389da49aa2446ce040a0192cab56cbcc`, `confidence: "high"`)**：
   - `index.html:707:2-45` 引用 `<script src="/vendor/JsBarcode.all.min.js"></script>`，推論用於在瀏覽器端將卡號渲染為 `CODE128` / `CODE39` SVG 條碼。
3. **動態載入 ZBar WASM 掃描引擎 (`jag_node_f3883c0abd43b864ffb65a3a53054f7547399f29c461b5ac2ffe82bf5a249024`, `confidence: "low"`)**：
   - `app.js:2731:27-57` 透過 `import('/vendor/zbar-main.js')` 動態載入 ZBar WebAssembly 模組，推論用於相機串流 ROI 截圖與相簿圖片的條碼/QR 解碼。

---

## 4. 明確未知項與分析限制 (Explicit Unknowns & Limitations)

依據 REA 方法論，靜態分析未觀測到的項目必須明確標示為 `unknown` 或保留分析限制，不得將「未觀測到」視為「不存在」：

1. **未包含於本地構件的遠端 Vendor 與後端資源 (`resolution_status: "not-found"` / `"unavailable"`)**：
   - `/vendor/JsBarcode.all.min.js`、`/vendor/zbar-main.js` 與 `/sw.js` 為外部絕對路徑資源，未包含在單頁 HTML 構件中，其實際位元組雜湊屬於 `unknown`。
2. **動態導航目標 (`route_inventory.unknowns`)**：
   - `app.js:686:32-52` 與 `app.js:693:32-52` (`jsg:f09a0c9fc14421ac1ce6d59299930c91`、`jsg:353c85dd41ea1511ae3d9eef6c07f8e4`) 使用動態計算的 URL 進行重整導航，非靜態字面量路由。
3. **跨函式動態屬性與未執行限制 (`limitations`)**：
   - REA 將 HTML 與 JavaScript 視為惰性文本 (inert syntax) 解析，未執行任何腳本；語意圖中保留了 `1,589` 條呼叫流關係與 `98` 個邊界節點，動態屬性存取與執行期狀態變異標記為 `partial` / `unknown`。

---

## 5. 「以 OmniPass 為底，TaskTrunk 功能為靈魂」融合架構對照表

我們在本地新專案 `omnipass-trunk-app` 中，完整保留了 **OmniPass 的視覺骨架與底層能力（底）**，並注入 **TaskTrunk 的全部票券管理核心功能（靈魂）**：

| 架構層面 | OmniPass 基底 (`app.omnipass.tw`) | TaskTrunk 靈魂 (`task-trunk-app`) | 新專案 `omnipass-trunk-app` 融合實作 |
| :--- | :--- | :--- | :--- |
| **視覺畫布與外殼** | `#10172b -> #0b1020` 深海靛藍畫布、560px 置中容器、`20px` 圓角浮動卡片、`#536dfe -> #3656db` 靛藍漸層按鈕 | 支援自訂多張背景圖輪播、背景不透明度、v1.6.2 **真透明卡片 (`0.73` alpha，無毛玻璃模糊)** | 預設採用 OmniPass 深海靛藍畫布與英雄統計卡，同時支援三視圖獨立自訂背景圖輪播與 `0.73` 真透明卡片 |
| **導覽與資訊架構** | 底部毛玻璃導覽列（卡包、結帳連刷、掃描、總覽、設定）+ 頂部狀態分段切換 | 依資料量動態顯示/隱藏「已使用」與「回收桶」(`getNavVisibility`) | 融合 OmniPass 頂部英雄區/分段切換 + 底部毛玻璃導覽列，且完整遵守 `getNavVisibility` 動態隱藏空分類規則 |
| **條碼與兌換體驗** | 全螢幕高對比刷卡層 (`💡 建議將手機亮度調至最高`) + **結帳連刷模式 (`#checkout`)** + 5 種 Web Audio 合成嗶聲 | 三種核銷版型（**原圖模式**、**標準條碼+QR**、**MOMO 電子票券明細**）+ 13 種條碼格式 + 兌換連結跳轉 | 核銷視窗兼具 OmniPass 高對比全螢幕左右滑動、亮度提醒與三種核銷版型切換；新增專屬 **「結帳連刷」分頁** 支援多張票券與載具/會員卡同場連刷 |
| **票券輸入與智慧範本** | 即時相機 ROI 掃描器 + 後鏡頭切換 + 相簿圖片辨識 | `YYYY/MM/DD` 自動補斜線遮罩 (`formatExpiryMask`)、`D-N` 倒數標籤、多區域截圖多條碼選擇器、`85度C` 自動套用範本與 Canvas 電子票券合成 (`renderBatchTicketImage`)、JSON 批量匯入 | 整合相機即時掃描 + 合成嗶聲 + 9 區域圖片多條碼偵測，並完整內建 `85度C` 智慧範本、自動金額推導 (`deriveTicketDescription`) 與 Canvas 票券圖生成 |
| **手勢與批次管理** | 卡片左/右滑動封存與全螢幕手勢 | 卡片左滑核銷、右滑移至回收桶（可調觸發距離 `40–120px`）、長按 `430ms` 進入批次多選（置頂、標籤、套用範本、兌換網址、鎖定連選） | 完整支援左/右滑動手勢回饋与長按批次工具列，並遵守「僅未使用票券可置頂 (`pinned`)」正規化規則 |
| **資料安全與通知** | **PBKDF2 (600,000 次) + AES-256-GCM 加密備份 (`.opbackup`)** + App 內建瀏覽器偵測橫幅 | IndexedDB `WalletFreshDB`、JSON 附加/覆蓋匯入（簽章去重）、Telegram 到期與核銷通知、資料健康檢查、條碼一致性稽核、殘留資料清理 | 同時支援 **OmniPass `.opbackup` AES-256-GCM 加密備份還原** 與 **TaskTrunk JSON 備份匯入/匯出**、Telegram 通知、資料健康度與條碼稽核 |

