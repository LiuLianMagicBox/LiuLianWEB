# 前端開發同測試

[返回首頁](../README_HK.md) · [English](development.md)

## 啟動開發伺服器

喺 `website-part` 執行 `npm ci`，並按[快速啟動](../README_HK.md#快速啟動)設定資料庫同 Session secret。用 `npm run dev` 啟動 Express API，再喺另一個終端機進入同一個目錄，執行 `npm run dev:frontend` 啟動 Vite 熱更新。Vite 使用 5173 埠，會將 `/api` 同 `/connect`（包括呢兩個路徑下嘅 WebSocket 請求）轉送到 `http://127.0.0.1:3000`。如後端喺其他位址，設定 `WEBSITE_DEV_PROXY`。

## 建置同測試

喺 `website-part` 執行以下指令，依次做語法檢查、正式前端建置同測試。

```sh
npm run check
```

要獨立執行其中一步，可用 `npm run check:js`、`npm run build` 或 `npm test`。前端有改動時，將重新建置嘅 `public/` 一併提交。CI 會喺 Linux 同 Windows 核對建置結果，並用 Linux runtime 映像測試 R6 抽選端點。更改 API 合約後，執行 `npm run docs:api` 重新產生 [OpenAPI](openapi.json)，並更新 [API 參考](API.md)。

## 前端目錄

- `frontend/*.html` 為每個頁面保留獨立入口。Express 先核對權限，各入口再透過 `frontend/src/main.jsx` 掛載 React `App`。
- 頁面放喺 `frontend/src/pages/`，共用導覽、分頁、對話框同通知放喺 `frontend/src/components/`，共用 hooks 放喺 `frontend/src/hooks/`。API、登入、Chromium 同 RDP 邏輯放喺 `frontend/src/lib/`。
- `frontend/static/` 提供 CSS、圖示、manifest 同 Socket.IO／WebRDP 資源。Vite 將呢啲檔案複製到 `public/`，並將 React 程式打包到 `public/assets/`。
- `App.jsx` 嘅 `PAGE_LOADERS` 用動態 import 載入較大頁面；登入、條款同 404 保留喺主 bundle。`ErrorBoundary` 會喺個別頁面出錯時提供重試。
- `vite-plugins/html-head.mjs` 會加入共用 metadata 同私人頁面嘅 `noindex` 標記。翻譯放喺 `frontend/src/locales/zh-HK.mjs` 同 `zh-CN.mjs`。介面文字用 `t()`，帶參數並保存在狀態嘅通知用 `message()`。

### 共用樣式同導覽

`frontend/static/css/style.css` 集中管理色彩、間距、焦點樣式同共用元件。`files.css` 補充檔案及分享頁樣式。更新 CSS 時同步更新頁面引用嘅版本參數。`App.jsx` 提供頂部列同標題，`NavBar.jsx` 處理側欄、工作區、已連結網站同管理選單。畫面窄過 1080 px 時，側欄會變成可用鍵盤操作嘅抽屜。

首頁顯示活動、報名、連線同工具四張摘要卡，並提供活動篩選、排序同分頁。前端測試由 `test/support/dom-env.mjs` 建立 jsdom，`test/support/jsx-loader.mjs` 負責編譯 JSX。

## 瀏覽器測試

完成前端建置後，喺 `website-part` 使用本機 Chrome 或 Chromium 執行。

```sh
WEBSITE_BROWSER_PATH=/path/to/chrome npm run test:website-browser
RDP_BROWSER_PATH=/path/to/chrome npm run test:rdp-browser
CHROMIUM_TEST_BROWSER_PATH=/path/to/chrome node --test test/chromium_browser.test.js
```

網站測試使用本機 API 測試資料同正式 CSP，涵蓋桌面及手機操作、導覽、重試、登入同上傳。可設定 `WEBSITE_SCREENSHOT_DIR` 將截圖存到倉庫以外。RDP 測試以模擬 Socket.IO 伺服器檢查解碼器啟動、RLE 畫面、焦點、縮放座標、密碼清除、取消同重新連線。需要桌面截圖時設定 `RDP_SCREENSHOT_PATH`。

Chromium 測試會核對瀏覽器工作階段隔離同各自嘅代理。測試容器未能提供瀏覽器 sandbox 時，網站測試同 Chromium 測試分別支援 `WEBSITE_BROWSER_NO_SANDBOX=1` 同 `CHROMIUM_TEST_NO_SANDBOX=1`。Windows 登入同實際桌面連線要喺部署環境另行驗證。
