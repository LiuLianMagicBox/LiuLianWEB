# LiuLianWEB

[English](README.md)

LiuLianWEB 係 LiuLianBot 嘅會員網站。會員可以連結 Discord 帳戶、報名參加《Rainbow Six Siege》活動，以及使用管理員開放嘅檔案、信箱同遠端工作區。

## 快速啟動

準備 Node.js 20+ 同 MySQL 8+。CI 同 Docker 映像使用 Node.js 22。先建立資料庫，以及有權執行資料表遷移嘅應用程式帳戶。全新安裝時，喺專案根目錄複製兩份範本。

```sh
cp shared/database/config.example.json shared/database/config.json
cp website-part/.env.example website-part/.env
```

喺 `shared/database/config.json` 填寫 MySQL 連線資料。用 `openssl rand -hex 32` 產生隨機值，填入 `website-part/.env` 嘅 `SESSION_SECRET`。兩份設定檔都要私下保存。

```sh
cd website-part
npm ci
npm start
```

用瀏覽器開啟 `http://127.0.0.1:3000`。範本已設定呢個監聽位址，倉庫亦已包含編譯好嘅前端。啟用 Discord 整合時，將 LiuLianBot 指向同一個資料庫。全新資料庫要先啟動網站，等網站建好 Bot 需要嘅資料表。

## 使用指南

| 想做嘅事 | 文件 |
| --- | --- |
| <a name="1-設定共用資料庫"></a><a name="2-安裝及執行網站"></a><a name="用-docker-cli-執行網站"></a>啟動及部署 | [PowerShell、PM2、Docker 同部署範例](docs/deployment.zh-HK.md) · [資料庫設定同遷移](shared/database/README.md) |
| <a name="網站環境變數"></a>設定主機 | [環境變數同安全設定](docs/configuration.zh-HK.md) |
| <a name="活動分隊登入裝置同管理紀錄"></a><a name="活動候補同公告送達"></a><a name="網站儀表板"></a><a name="網站語言"></a><a name="伺服器管理頁及分類記錄"></a><a name="r6-活動流程"></a><a name="網站頁面及路由"></a><a name="頁面可見度"></a><a name="fnos-檔案管理與分享"></a>使用網站 | [帳戶、活動、Discord 管理、檔案同分享](docs/member-guide.zh-HK.md) |
| <a name="會員信箱"></a><a name="clash-vpn-訂閱管理"></a><a name="netbird-管理"></a>接駁外部服務 | [Mailu 會員信箱](docs/integrations.zh-HK.md#會員信箱) · [Clash 訂閱](docs/integrations.zh-HK.md#clash-vpn-訂閱) · [NetBird](docs/integrations.zh-HK.md#netbird) |
| <a name="遠端用戶端設定"></a><a name="chromium-工作區"></a><a name="interim-vless-tunnel"></a><a name="rdp-客戶端重建"></a><a name="rdp-內網允許清單"></a><a name="每位使用者多組-rdp-設定"></a>使用遠端工作區 | [SSH、WebRDP、Chromium 同 VLESS](docs/remote-access.zh-HK.md) |
| 開發同測試 | [React 前端、Vite 同瀏覽器測試](docs/development.zh-HK.md) · [API 參考](docs/API.md) · [OpenAPI](docs/openapi.json) |

[更新紀錄](PATCH_NOTES.md) · [服務條款](TERMS_OF_SERVICE.md) · [私隱政策](PRIVACY_POLICY.md)

<a name="license"></a>

## 授權

本專案供個人同社群使用。保留所有權利。
