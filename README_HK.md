# LiuLianWEB

LiuLianWEB 係 LiuLianBot 嘅會員網站，需要 Node.js 20+ 同 MySQL 8+。反向代理、OpenWrt 防火牆同健康檢查可參考[部署範例](website-part/deploy/reverse-proxy/README.md)。

複製設定範本後，喺本機填寫部署網域、連線資料同憑證。網站環境檔位於 `website-part/.env`，資料庫設定檔位於 `shared/database/config.json`。

Discord 整合需另外執行 LiuLianBot，並指向同一資料庫；新資料庫先啟動網站再啟動 Bot。在 website-part/.env 設定 DISCORD_CONFIG_PATH 為 Bot 的 discord-part/config.json 絕對路徑；修改伺服器語言需要寫入權限。未設定時 Bot 設定中繼資料為空；伺服器管理需完成此整合。Docker 寫入節點需要以可寫方式掛載設定檔所在目錄，讓網站可以在同一目錄建立暫存檔並原子取代 `config.json`。

### 活動分隊、登入裝置同管理紀錄

- 喺活動頁展開「正選名單」可以睇到已確認參加嘅玩家。「隨機分成兩隊」會先讀取最新名單，再按人數平均分隊，可以複製兩隊名單貼到 Discord。候補玩家補位後先會加入抽籤。
- 喺「帳戶設定 → 我的登入裝置」可以查看每次登入嘅瀏覽器、作業系統同上次活動時間，亦可以登出其他裝置。各節點每兩秒核對開住嘅 SSH、WebRDP、Chromium 同網站代理連線。
- 喺 FnOS 資料夾可以一次選取多個檔案，逐個睇上傳進度。切換資料夾會保留原本目的地，「重試上傳失敗嘅檔案」只會重傳失敗項目。
- 「管理 → 管理操作紀錄」會列出重設密碼、更改群組、會員群組同頁面可見度嘅操作。可按完整用戶名稱、會員或管理員 ID、群組 ID 或頁面識別碼搜尋，並查看操作者、對象、時間同結果。

網站啟動時會套用遷移 `030`。公會設定會一併儲存頻道選擇同待同步語言。語言未能即時寫入時，畫面會顯示等候同步，寫入節點每 30 秒重試。網站代理支援即時事件、檔案同分段下載，兩個 Docker 映像都包含 R6 抽選資料。

### 活動候補同公告送達

活動額滿後，會員可在活動頁加入候補並查看位置。有人退出正選時會依次補位，已連結 Discord 的會員會收到 Bot 私訊。管理員可在公告頁核對 `review` 項目，再確認送達或重新排程。

升級這個版本時，先停止舊 Discord Bot，啟動網站並等候共用資料庫遷移 `029` 完成，然後啟動新版 LiuLianBot。Android 活動頁亦使用同一組 API。

驗證：

```bash
cd website-part
npm ci
npm run check
```

API 文件：npm run docs:api。

啟動時會套用 migration `027`（可恢復嘅使用者外鍵遷移）同 `028`
（帳戶 Session 版本）。改密碼會保留目前登入並令其他 Session 失效，較早開始嘅
請求亦唔會重新建立舊 Session。帳戶版本仍然係 0 時，升級前嘅 Session 可以繼續用。
所有 MySQL 連線會先完成 UTC Session 時區設定先交畀查詢。

## NetBird 管理

喺 **管理員後台 → NetBird** 可查看節點在線狀態、IP、版本及上次連線，修改節點名稱、NetBird SSH、登入／閒置有效期及 Cloud 核准狀態，或移除節點。網絡支援新增、編輯、刪除，以及管理網絡資源（IP、CIDR 或網域）同 routing peers（單一節點或 NetBird 群組、metric、masquerade 及啟用狀態）。刪除前會確認；操作結果會記入管理操作紀錄。

喺 `website-part/.env` 設定：

```dotenv
NETBIRD_API_URL=https://api.netbird.io/api
NETBIRD_API_TOKEN=replace-with-a-personal-access-token
```

自架 NetBird 請改用管理伺服器嘅 HTTPS API URL，須以 `/api` 結尾。使用具備節點及網絡管理權限嘅 service user Personal Access Token（唔係 setup key），設定後重新啟動網站；多節點部署需每個網站節點都設定。留空令牌會停用整合，其他網站功能照常運作。令牌只留喺伺服器環境檔，唔好加入 `VITE_*`、前端或 Git。

新 peer 仍需透過 NetBird 客戶端加入；NetBird 群組及存取政策請先喺 NetBird Dashboard 設定，再於此後台選取現有群組。此功能使用 Networks API，自架版本須提供 `/api/networks`。網站只管理 NetBird 設定；要經私人網絡連接服務，網站主機仍須有相應網絡路由。API 逾時時請先重新整理核對結果，避免重複新增。

詳見 [NetBird API 合約](docs/API.md#netbird-administration)、官方 [驗證方式](https://docs.netbird.io/api/guides/authentication)、[Peers](https://docs.netbird.io/api/resources/peers) 同 [Networks](https://docs.netbird.io/api/resources/networks)。

## Clash VPN 訂閱管理

喺 **管理員後台 → Clash 訂閱管理**，管理員可以新增／編輯／刪除 VPN 節點、建立獨立 VPN 用戶、設定每位 VPN 用戶可以使用嘅節點、到期時間（UTC+8）、停用訂閱、重設訂閱網址、選擇 SSH 管理設定同查看／重試同步。節點輸入係單一 Clash/Mihomo 代理 YAML，唔使填 name；憑證、TLS 同傳輸設定須同現有 VPN 伺服器一致。支援 SS、VMess、VLESS、Trojan、Hysteria2、TUIC、SOCKS5 同 HTTP。

Clash 分頁上方顯示伺服器列表同同步狀態，下方顯示 VPN 用戶。按「新增」直接輸入 VPN 用戶名稱，每列提供「編輯／移除」。VPN 用戶資料獨立於網站帳號。移除 VPN 用戶會刪除訂閱同授權，立即停用網址，並由背景同步撤銷受管理帳戶；網站帳號會保留。

新增／編輯 VPN 用戶時可選規則集：全部走 VPN（預設）、區域網路直連、中國直連、中國直連＋廣告封鎖、或自訂路由 YAML。儲存後，客戶端下次更新訂閱就會取得規則；網址同授權節點保留。LAN 規則直接包含喺 YAML，中國／廣告規則由相容 Clash／Mihomo 客戶端每 24 小時下載 [Loyalsoldier 規則集](https://github.com/Loyalsoldier/clash-rules)。Migration `023` 保留既有全部走 VPN 行為。

選「自訂規則集」可編輯 `rules` 同可選 HTTP `rule-providers`。策略支援 `VPN`、`DIRECT`、`REJECT`；未填最後 MATCH 時自動補上 `MATCH,VPN`。規則來源須用 HTTPS，快取路徑自動產生；切換預設規則集會保留已儲存嘅自訂草稿。只接受路由設定，詳見 [自訂語法](docs/API.md#clash-vpn-subscriptions)。Migration `024` 新增自訂 YAML 儲存欄位。

Migration `022` 會將現有 VPN 用戶複製到獨立 `website_clash_users`，解除同網站用戶嘅外鍵關聯；保留 ID、網址、授權同憑證。之後刪除網站帳號唔會影響 VPN 用戶。VPN 用戶名稱作識別用途，客戶端使用訂閱代碼同各節點憑證認證。

新訂閱網址使用 `/clash-sub-public/<代碼>.yaml`；既有 `/clash-sub/<代碼>.yaml` 網址亦會套用相同到期／授權檢查。此路徑係動態 HTTP 端點，部署時須轉送 `/clash-sub-public/` 到網站服務。

儲存後會自動喺 `/clash-sub-public/<隨機代碼>.yaml` 提供最新用戶設定。呢個係從 MySQL 即時產生嘅 HTTP 端點，唔使建立靜態檔案或手動部署。網站啟動時會自動執行 migration `020`／`021`／`022`／`023`／`024` 建立節點、訂閱、授權及加密個別帳戶資料表。用戶下次更新訂閱就會取得變更；未知、停用或到期網址回傳 404，無可用授權節點回傳 403。

部署時用 HTTPS 將 `/clash-sub-public/` 轉送到 Node 網站服務，並停用代理快取。訂閱網址屬於憑證，請保密並避免記錄完整網址。未管理節點只限制訂閱下載；SSH 管理節點會建立個別用戶憑證，到期、停用或移除授權時自動撤銷。混合 Hysteria2、sing-box 同 Xray 的設定詳見 [SSH VPS 安裝文件](website-part/deploy/clash-vps/README.md)。網站定時同步，VPS 本機 timer 在網站離線時仍會清理到期帳戶；帳戶變更會重啟 VPN 服務並短暫中斷其他連線。舊共用憑證須另外喺 VPS 輪替。詳見 [Clash API 文件](docs/API.md#clash-vpn-subscriptions)。


另支援 Mihomo Hysteria2／VLESS 同 OpenWrt／procd VPN 主機；網站背景同步本身唔需要 systemd。VPS targets 為空時，帳戶撤銷仍未啟用。詳見 [SSH VPN 設定](website-part/deploy/clash-vps/README.md)。


### 網站儀表板

- 註冊、登入、登出、改帳戶名稱、改密碼同持久登入 Session
- 管理員可以管理用戶、群組、伺服器資訊同網站連線
- 喺管理面板嘅用戶列表，揀會員旁邊嘅「重設密碼」就可以設定新網站密碼。該會員之後要喺所有裝置重新登入。自己嘅密碼可以喺「帳戶設定」更改。
- 用戶群組同連線授權均支援多對多關係
- 已授權嘅 HTTP 及 WebSocket 代理連線
- 可隱藏連線：唔會出現喺導覽內，但已授權用戶仍可用直接網址存取
- 使用 MySQL 儲存 Session、限制登入嘗試，並會自動執行網站 migration
- R6 活動頁面：建立活動、查看報名人數、加入或退出活動
- 網站帳戶可產生一次性代碼，連結 Discord 身分後可共用活動報名資料
- 記錄網站資料儲存同意；SSH/RDP 遠端功能可限制畀指定用戶群組
- 提供 SSH 終端機及 RDP 連線檔，設定可選擇只保存喺瀏覽器或以 AES-256-GCM 加密保存喺伺服器
- 提供使用 Puppeteer 同 Chrome DevTools Protocol screencast 嘅內建 Chromium 工作區頁面
- Interim VLESS Tunnel 頁面：將短期 VLESS 連線加入現有 VLESS 位址或 Clash / Mihomo YAML
- FnOS 檔案管理頁：支援逐個帳號嘅讀取、寫入同分享授權，並可產生有效期內、可撤銷嘅免登入分享碼
- Admin 提供頁面可見度設定，可按未登入訪客、全部登入用戶、指定網站群組或指定用戶控制顯示
- 全站共用同一套深色設計系統：控制台式版面（左側導覽列＋頂列）、KPI 統計卡、帶篩選同分頁嘅列表／表格面板，以及一致嘅按鈕、表單、modal 同空狀態樣式
- 響應式導覽會記住桌面側欄收合狀態；手機會使用支援鍵盤操作嘅抽屜，訪客畫面亦會清楚提示登入後先可以查看活動同私有工具
- 重整首頁同手機登入版面，支援顯示／隱藏密碼、登入及同意條款後安全返回原頁、首頁讀取失敗重試，以及可關閉嘅堆疊通知
- 公開 JS、CSS、圖片同 vendor 資產唔再觸發 session 資料庫讀取／更新；受保護 HTML 仍保留登入授權檢查同快取重新驗證
- 每頁提供英文／香港繁體中文（`zh-HK`，兼容 `zh_hk`）／簡體中文（`zh-CN`，兼容 `zh_cn`）切換，會記住瀏覽器偏好，唔會重設表單或遠端連線

### 網站語言

喺頂列（登入／分享等獨立頁面則喺上方）嘅語言選單，選擇 **English**、
**繁體中文（香港）** 或 **简体中文**。首次開啟會跟隨瀏覽器首個支援嘅語言；
`zh-CN`、`zh-SG` 同 `zh-Hans` 使用簡體中文，其他中文偏好使用 `zh-HK`，
未支援語言預設使用英文。手動選擇會存入 localStorage 嘅
`liulianbot.locale`。即使瀏覽器封鎖儲存，當前頁面仍可切換語言。

介面標籤、讀屏器名稱、常見狀態訊息同活動日期格式會跟隨選擇。
用戶名稱、檔名、活動內容、遊戲資料、連線設定及原有法律文件保留原文；
未有翻譯嘅伺服器診斷亦保留原文。呢個設定只影響網站，唔會改變 Discord
伺服器嘅機械人語言。
翻譯放喺 `website-part/frontend/src/locales/zh-HK.mjs` 同 `zh-CN.mjs`；介面文字使用 `t()`，
存入元件狀態、帶變數嘅提示使用 `message()`，方便切換語言時同步更新現有提示。

### 1. 設定共用資料庫

Bot 同網站都會讀取 `shared/database/config.json` 入面嘅 MySQL 設定。由已追蹤嘅範本建立檔案，再換掉範例帳密。

```bash
cp shared/database/config.example.json shared/database/config.json
```

Windows PowerShell：

```powershell
Copy-Item shared\database\config.example.json shared\database\config.json
```

範本使用以下結構：

```json
{
  "mysql_config": {
    "host": "localhost",
    "port": 3306,
    "user": "website_app",
    "password": "",
    "database": "discordbot",
    "charset": "utf8mb4"
  }
}
```

只要 MySQL 帳戶有相關權限，Bot 會建立指定資料庫；網站首次連線時會建立並 migration 所需資料表。
如果係全新資料庫，請先啟動一次網站再啟動 Bot：Bot 嘅公告 migration 會更新
由網站 migration 建立嘅 `website_announcements`。已有兩套 migration ledger 嘅
資料庫就可以按任意次序啟動。

### 2. 安裝及執行網站

從範本建立網站環境檔。啟動網站前，用 `openssl rand -hex 32` 產生獨立嘅 `SESSION_SECRET`，填入本機嘅 `.env`。

```bash
cd website-part
cp .env.example .env
npm ci
npm run build
npm start
```

`npm run build` 會將 React 前端編譯到 `website-part/public`（已納入版本控制），
所以只跑網站嘅主機只需要 `npm ci` 加 `npm start`。

本機開發時，`npm run dev` 會使用同一個伺服器入口。要即時預覽 React 變更，
可同時啟動 API 伺服器同 Vite（`npm run dev:frontend`，會將 `/api`、`/connect`
同 WebSocket 代理到 `http://127.0.0.1:3000`，可用 `WEBSITE_DEV_PROXY` 覆寫）。
網站預設監聽 `127.0.0.1:3000`。

Linux 生產環境可以用 PM2 管理：

```bash
cd website-part
./start.sh init
./start.sh start
```

修改生產依賴或 PM2 設定後，需要再次執行 `./start.sh init`。正式部署時，請
喺網站前面配置反向代理並提供 HTTPS。
MySQL Session 背景清理遇到暫時性錯誤時只會記錄錯誤，唔會停用新登入
Session。部署 Session Store 修正後，請執行 `./start.sh restart` 重啟 PM2 程式。

**OpenWrt / iStoreOS 開機啟動**：`pm2 startup` 無法辨識呢個系統。初始化
網站後，請用 root 喺 repository 根目錄執行：

```bash
bash website-part/start.sh startup
/etc/init.d/pm2-pm2 enabled
```

指令會儲存 PM2 清單，安裝並啟用 `/etc/init.d/pm2-pm2`，固定
`HOME=/root`、`PM2_HOME=/root/.pm2`，避免開機讀取空白嘅 `/.pm2`。
需要 `/usr/bin/pm2`；原有服務會備份到 `/root/.pm2/startup-backups/`。
由 PM2 監管應用程式，OpenWrt 開機掛鉤只執行一次 `pm2 resurrect`。
安裝唔會重啟現有程序；可以用 `/etc/init.d/pm2-pm2 start` 測試還原。
服務會還原 root 用 `pm2 save` 儲存嘅所有程序，停止服務亦會停止該 PM2
daemon 同所有應用程式。更改程序清單後請再次 `pm2 save`。
開機時網站磁碟同資料庫必須可用；請同時確認 HTTP 回應，PM2 顯示 online
唔代表網站已成功連接資料庫或開始監聽。

如果更新咗網站依賴（例如 Interim VLESS Tunnel 新增嘅 `js-yaml`），要先喺
實際 PM2 使用嘅 website 目錄重新安裝 production dependencies，再重啟：

```bash
cd /opt/website/LiuLianWEB/website-part
npm ci --omit=dev
npm ls js-yaml socket.io @electerm/rdpjs --depth=0
pm2 restart liulianb --update-env
```

`npm ls` 應該列出以上三個套件；如果 `src/services/vless_tunnel.js` 出現
`MODULE_NOT_FOUND`，代表部署主機未完成依賴安裝，或者 PM2 指向另一個 website
目錄。

### 用 Docker CLI 執行網站

以下映像只包含 `website-part/` 同其 production Node.js 依賴，唔會建立或啟動
`discord-part/`。共用資料庫設定會喺容器啟動時用唯讀掛載提供。

先依照上方步驟建立 `website-part/.env` 同
`shared/database/config.json`，並喺 `.env` 設定夠長而且唯一嘅
`SESSION_SECRET`。喺 repository 根目錄建立映像：

```bash
docker build --file website-part/Dockerfile --tag liulianbot-website:latest .
```

執行網站容器。`BIND_IP=0.0.0.0` 會令 Docker port forwarding 可以連到網站；
正式環境請喺前面配置 HTTPS 反向代理。

```bash
docker run --detach --name liulianbot-website \
  --restart unless-stopped \
  --publish 3000:3000 \
  --env-file website-part/.env \
  --env BIND_IP=0.0.0.0 \
  --volume "$(pwd)/shared/database/config.json:/app/shared/database/config.json:ro" \
  liulianbot-website:latest
```

Windows PowerShell 請用 `${PWD}` 掛載資料庫設定：

```powershell
docker run --detach --name liulianbot-website `
  --restart unless-stopped `
  --publish 3000:3000 `
  --env-file website-part/.env `
  --env BIND_IP=0.0.0.0 `
  --volume "${PWD}/shared/database/config.json:/app/shared/database/config.json:ro" `
  liulianbot-website:latest
```

用 `docker logs --follow liulianbot-website` 查看容器日誌。網站程式碼或依賴更新後，
重新建立映像並取代容器：

```bash
docker build --file website-part/Dockerfile --tag liulianbot-website:latest .
docker rm --force liulianbot-website
# 再執行上面嘅 docker run 指令。
```

### 網站環境變數

網站由 `shared/database/config.json` 讀取 MySQL 設定，其餘運行設定由
`website-part/.env` 讀取。

| 變數 | 預設值 | 用途 |
|---|---|---|
| `NODE_ENV` | `development` | 生產環境設為 `production`；此模式要求 `SESSION_SECRET` 並啟用安全 Cookie。 |
| `PORT` | `3000` | HTTP 監聽連接埠。 |
| `BIND_IP` | `127.0.0.1` | 監聽地址；配合本機反向代理時保留預設值。 |
| `SESSION_COOKIE_NAME` | `connect.sid` | Session Cookie 名稱。 |
| `SESSION_SECRET` | 必須設定 | 所有環境都需要至少 32 字元嘅隨機密碼，用來簽署 Session。 |
| `TERMS_OF_SERVICE_REQUIRED` | `true` | 只有主機管理者毋須強制明確同意服務條款及資料儲存時先設為 `false`。 |
| `PROXY_ALLOW_SELF_SIGNED` | `false` | 只有上游網站刻意使用自簽憑證時先設為 `true`。 |
| `REMOTE_ALLOWED_GROUPS` | `admin` | 可使用 SSH/RDP 頁面及 API 嘅網站用戶群組。 |
| `REMOTE_SSH_ENABLED` | `true` | 設為 `false` 即對所有用戶停用 SSH，包括管理員。 |
| `REMOTE_RDP_ENABLED` | `true` | 設為 `false` 即對所有用戶停用 RDP，包括管理員。 |
| `SSH_ALLOWED_HOSTS` | 空白 | SSH hostname/IP 或 IPv4 CIDR；私人目的地要明確命中清單，數字 IPv4 必須用標準點分十進位，實際連線 IP 亦會核對 IP/CIDR 授權。空白只容許公開目的地。 |
| `REMOTE_CREDENTIAL_ENCRYPTION_KEY` | 空白 | 用於伺服器端加密保存 SSH/RDP 設定嘅 Base64 32-byte AES-256-GCM 金鑰。 |
| `CHROME_EXECUTABLE_PATH` | 空白 | 如果 Chrome/Chromium 唔喺 `PATH`，請填入執行檔路徑。 |
| `CHROME_CDP_URL` | 空白 | 可選嘅遠端 Chrome DevTools endpoint，例如 `http://browser.example.org:9222`；設定後網站會連去遠端 Chrome，而唔會喺本機啟動。 |
| `CHROMIUM_ALLOWED_HOSTS` | 空白 | 明確容許 Chromium 存取私人目的地嘅 hostname/IP 清單；工作階段代理會檢查及固定 HTTP(S)、WebSocket、worker 同新視窗嘅連線 IP。 |
| `CHROMIUM_PROXY_BIND_HOST` | `127.0.0.1` | 工作階段代理監聽地址；remote CDP 需要明確設定。 |
| `CHROMIUM_PROXY_ADVERTISED_HOST` | `127.0.0.1` | Chrome 可連到嘅代理 hostname/IP；非 loopback CDP 必須明確設定。 |
| `CHROMIUM_PROXY_ALLOWED_CLIENT_IPS` | Loopback | 可以使用代理嘅 Chrome 來源 IP 清單；非 loopback CDP 必須明確設定，只接受精確 IP。 |
| `CHROMIUM_SESSION_TIMEOUT_MS` | `1800000` | 每個 Chromium WebSocket 工作階段最長存活時間，單位係毫秒。 |
| `VLESS_TUNNEL_ADDRESS` | 空白 | Interim VLESS listener 對用戶端公開嘅主機名稱或地址；留空會停用產生功能。 |
| `VLESS_TUNNEL_PORT` | `443` | Interim VLESS listener 連接埠。 |
| `VLESS_TUNNEL_UUID` | 空白 | Xray / V2Ray listener 使用嘅 UUID。 |
| `VLESS_TUNNEL_NETWORK` | `tcp` | 傳輸方式：`tcp`、`ws` 或 `grpc`。 |
| `VLESS_TUNNEL_SECURITY` | `tls` | 安全方式：`tls`、`reality` 或 `none`。 |
| `VLESS_TUNNEL_REALITY_PUBLIC_KEY` | 空白 | Reality public key；使用 `reality` 時必須設定。 |
| `VLESS_TUNNEL_REALITY_SHORT_ID` | 空白 | Reality short ID；使用 `reality` 時必須設定。 |
| `VLESS_TUNNEL_CLIENT_FINGERPRINT` | `chrome` | Reality client fingerprint。 |
| `VLESS_TUNNEL_SNI` | `VLESS_TUNNEL_ADDRESS` | TLS SNI；WebSocket / gRPC 亦可用作 server name。 |
| `VLESS_TUNNEL_PATH` | `/` | WebSocket path 或 gRPC service name。 |
| `VLESS_TUNNEL_HOST` | 空白 | WebSocket Host header（選填）。 |
| `VLESS_TUNNEL_FLOW` | 空白 | VLESS flow（選填）。 |
| `VLESS_TUNNEL_REMARK` | `LiuLianBot interim internal tunnel` | 輸出設定中顯示嘅節點名稱。 |
| `VLESS_TUNNEL_INTERNAL_TARGET` | `web server internal network` | 頁面顯示嘅路由目標說明；實際路由由 VLESS listener 設定。 |
| `VLESS_TUNNEL_TTL_SECONDS` | `3600` | 輸出結果標示嘅有效時間，範圍 60 秒至 24 小時。 |
| `VLESS_TUNNEL_ALLOW_INSECURE` | `false` | 是否在輸出中略過 TLS 憑證驗證；除非使用受信任內網憑證，否則應保持 `false`。 |
| `FILES_OWNER_USER_ID` | 空白 | FnOS 檔案擁有者嘅網站用戶 ID（唔係用戶名稱）；留空即停用檔案頁。 |
| `FILES_SFTP_HOST` | 空白 | 網站伺服器可經 SFTP 連線嘅 FnOS 主機。 |
| `FILES_SFTP_PORT` | `22` | FnOS SFTP 連接埠。 |
| `FILES_SFTP_USER` | 空白 | 用嚟讀寫 `/vol*/1000` 嘅 SFTP 帳號。 |
| `FILES_SFTP_PASSWORD` | 空白 | 該 SFTP 帳號密碼；只保存喺 `website-part/.env`。 |
| `FILES_SFTP_HOST_SHA256` | 空白 | SSH 主機金鑰指紋，格式為 64 個十六進位 SHA-256 字元；不符時拒絕連線。 |

### 遠端用戶端設定

遠端頁面只開放畀 `REMOTE_ALLOWED_GROUPS` 內嘅網站用戶群組（預設係 `admin`）。請設定可用群組；喺非受信任網絡，亦應限制網站伺服器可連去嘅 SSH 主機：

```env
REMOTE_ALLOWED_GROUPS=admin,server-operator
SSH_ALLOWED_HOSTS=server.example.com,192.0.2.0/24
```

如要啟用伺服器端加密保存 SSH 主機資訊／私密金鑰及 RDP 連線資訊，請產生並安全保存一個 32-byte 金鑰。SSH 密碼絕不會被保存。

```bash
openssl rand -base64 32
```

將輸出填入 `website-part/.env`：

```env
REMOTE_CREDENTIAL_ENCRYPTION_KEY=<generated-base64-key>
```

加密設定仍存在時，唔好遺失或更換此金鑰，否則無法解密舊資料。未設定金鑰時，用戶仍可保存到瀏覽器，但伺服器端保存會被停用。

Windows PowerShell：

```powershell
Set-Location website-part
Copy-Item .env.example .env
npm ci
npm start
```

網站預設喺 `http://127.0.0.1:3000` 運行。執行自動化測試：

```bash
npm test
```

完整網站檢查用 `npm run check`（語法、建置及測試）。完成建置後，可以用本機 Chromium 驗證桌面／手機版面、導覽、篩選、失敗重試同登入控制項：

```bash
WEBSITE_BROWSER_PATH=/path/to/chromium npm run test:website-browser
```

瀏覽器測試使用本機 API 測試資料同正式 CSP，唔需要資料庫或真實帳密。
可用 `WEBSITE_SCREENSHOT_DIR` 指定 repository 以外嘅截圖目錄。
若容器唔支援 Chromium sandbox，可只為呢個測試設定 `WEBSITE_BROWSER_NO_SANDBOX=1`；一般啟動仍保留 sandbox。

### 伺服器管理頁及分類記錄

先在網站 **Account** 產生代碼並以 `>link <code>` 連結 Discord 身分，之後開啟 **Manage > Discord servers**（或直接開 `/guild-manager.html`）。只有已連結嘅伺服器擁有者、已設定嘅伺服器管理員或 Bot 管理員先會見到相應伺服器。頁面可以設定 Bot 語言、全域 `all` 記錄頻道同各個分類嘅覆寫頻道。

伺服器管理員亦可以喺 Discord 使用：
`/setlogchannel <all|useraction|voiceaction|groupaction|messageaction|channelaction|roleaction> <channel>`。
`all` 係所有事件嘅預設頻道；有設定分類頻道時，該分類會優先使用覆寫頻道。

### R6 活動流程

1. 登入網站，開啟 Account，按「Generate link code」。
2. 在 Discord 使用 `>link <code>`；代碼 10 分鐘後失效且只能使用一次。
3. 在網站 Events 建立活動，填入 Discord 伺服器 ID、開始時間及人數上限。
4. Discord 使用 `>events` 查看活動，再用 `>eventjoin <event_id>` 或 `>eventleave <event_id>` 報名。
5. 使用 `>eventteams <event_id>` 依報名順序產生人數平衡的兩隊。

建立活動前必須先連結 Discord 身分；網站與 Bot 會使用同一份 MySQL 報名資料。成員可用 `>roles` 及 `>role <role_id>` 選擇已開放身份組，管理員可在 Admin 的 Announcements 分頁建立排程公告。

## 網站頁面及路由

公開頁面包括 `login.html`、`terms.html`、`roller.html`、`share.html` 同
`404.html`。登入後可使用 `index.html`、`account.html`、`events.html`、
`remote.html`、`chromium.html`、`vless-tunnel.html`、`files.html` 同
`guild-manager.html`；管理員另外可以使用 `admin.html`。`share.html` 毋須登入，
因為分享碼本身就代表指定路徑嘅唯讀存取權。

網站喺 `/api` 提供登入、帳戶及 Discord 連結、R6 抽選、活動、網站連線、管理員、
遠端設定、VLESS tunnel 合併、RDP 檔案同 FnOS 檔案（含免登入分享碼 API）。
已授權嘅 HTTP/WebSocket 網站連線位於
`/connect/<slug>/`；SSH 使用 `/api/ssh` WebSocket endpoint。

完整 endpoint、請求欄位、權限、錯誤回應同 WebSocket/Socket.IO 訊息協定，請參考
[`docs/API.md`](docs/API.md)。

### 頁面可見度

管理員可以開啟 Admin > Page Visibility，控制網站子頁面會唔會出現喺導覽列及儀表板連結。每個頁面可以設定畀未登入訪客、全部登入用戶、指定網站群組或指定用戶顯示。頁面路由亦會檢查設定；Remote 等功能原有嘅專屬權限要求仍然有效。

導覽列將工作區頁面（`remote.html`、`chromium.html`、`vless-tunnel.html`）group
喺側邊欄 **Workspaces** 區塊，管理頁面（`guild-manager.html`、`admin.html`）就 group
喺 **Administration** 區塊。頁面可見度同帳戶嘅 Remote 權限一樣會過濾區塊內嘅項目，
隱藏咗嘅頁面兩個位置都唔會出現。

已登入頁面會套用控制台式框架：左側導覽列（闊螢幕可收成圖示列，窄過 1080px 就變成由
頂列打開嘅抽屜）加上顯示當前頁面名稱嘅頂列。儀表板就係首頁、四個 KPI 統計卡、
「Priority」事件清單同「Tools」清單兩欄，再加一個有搜尋／狀態／排序篩選、事件表格同
分頁嘅全寬面板。

### Chromium 工作區

Chromium 頁面使用 Puppeteer 同 Chrome DevTools Protocol（CDP）screencast。網站伺服器會啟動 headless Chrome/Chromium，經已驗證嘅 WebSocket 傳送 JPEG 畫面，再經 CDP 將用戶輸入事件傳返瀏覽器。請喺伺服器安裝 Chrome 或 Chromium；如果執行檔唔喺 `PATH`，就設定 `CHROME_EXECUTABLE_PATH`。OpenWrt 如果 feed 入面冇 Chromium，可以設定 `CHROME_CDP_URL` 連去另一部機嘅 Chrome DevTools endpoint。每個登入用戶會有自己嘅瀏覽器頁面，WebSocket 中斷或者逾時後會自動關閉。管理員仍然可以喺 Admin > Page Visibility 設定邊啲用戶或群組可以見到 Chromium 頁面。

每個工作階段會用獨立 BrowserContext，Cookie 同 localStorage 唔會同其他用戶
共用，關閉後亦唔會保留。每個 context 會用自己嘅 HTTP/CONNECT 代理，涵蓋
HTTP(S)、WebSocket、導向、frame、各類 worker 同新視窗。代理會檢查 DNS 結果，
再用已驗證 IP 連線，避免 Chrome 再次解析目的地。私人目的地需要喺
`CHROMIUM_ALLOWED_HOSTS` 明確列出 hostname/IP；關閉工作階段亦會關閉代理連線。

非 loopback `CHROME_CDP_URL` 必須明確設定三項 `CHROMIUM_PROXY_*`。
Chrome 要連到 advertised 地址及動態 TCP port，防火牆只容許清單內嘅 Chrome IP。
容器部署需要可路由嘅私人容器網絡或其他可達代理監聽 port 嘅安排，單靠轉發網站
HTTP port 並不足夠；缺少設定會拒絕啟動。
如果 loopback CDP tunnel 實際連去另一部機，嗰部機同樣要連到代理地址及 port。
remote Chrome 亦要加
`--enable-automation` 同 `--webrtc-ip-handling-policy=disable_non_proxied_udp`，
網站會驗證後者；本機啟動會自動設定。瀏覽器主機仍應限制對外網絡及防火牆，
保護 HTTP 代理協定範圍以外嘅流量。

### Interim VLESS Tunnel

管理員先要喺 `website-part/.env` 設定 `VLESS_TUNNEL_ADDRESS`、
`VLESS_TUNNEL_UUID` 及其他 listener 參數，並在該地址運行 Xray / V2Ray
VLESS listener，將流量路由到 `VLESS_TUNNEL_INTERNAL_TARGET` 所代表嘅內部網絡。
網站本身只負責產生用戶端設定，不會代替 Xray / V2Ray 運行協定或自動開啟
防火牆。登入用戶可以在 **VLESS Tunnel** 貼上原有 `vless://` 位址或 Clash /
Mihomo YAML；產生後會保留原有節點並加入 interim 節點，結果只顯示在畫面上。
如使用 Reality，將 `VLESS_TUNNEL_SECURITY` 設為 `reality`，再設定
`VLESS_TUNNEL_REALITY_PUBLIC_KEY`、`VLESS_TUNNEL_REALITY_SHORT_ID`，
並可選擇設定 `VLESS_TUNNEL_CLIENT_FINGERPRINT=chrome`。VLESS URI 會使用
`pbk`、`sid`、`fp` 參數；Clash / Mihomo 輸出會使用 `reality-opts` 同
`client-fingerprint`。原有設定只會以瀏覽器 `localStorage` 保存，唔會寫入網站資料庫。輸出標示嘅 TTL
係設定有效期限提示；如要在到期後真正拒絕連線，Xray / V2Ray listener 或外部
provisioner 必須同步執行憑證／UUID 到期控制。管理員可以使用 Page Visibility
限制頁面可見範圍。

Clash YAML 唔接受 anchors／aliases，最多 5000 個解析節點，合併輸出上限 256 KiB。
新網站密碼至少 8 個字元、最多 72 UTF-8 bytes；中文可能用多個 bytes。舊 bcrypt
密碼仍然可以登入。SSH/RDP 會正規化 IPv4-mapped IPv6，SSH 私人地址要明確命中
`SSH_ALLOWED_HOSTS`，並用已驗證 IP 連線。代理亦會排除自訂嘅網站 Session Cookie，
同名上游 Cookie 會按 connection 改名；升級後舊代理 Cookie 如有衝突需要清除並重新登入。

## RDP 客戶端重建

瀏覽器 RDP 改用獨立連線狀態、畫面解碼同輸入模組；已移除舊
`webrdp.js`，保留 RLE 解碼器同來源聲明。點選桌面先會將鍵盤輸入
送去遠端；切換去表單或其他視窗會釋放按住嘅鍵。縮放畫面會同步
換算滑鼠座標，原始大小模式只改顯示比例。

如果顯示「畫面解碼器尚未就緒」而瀏覽器 console 指出 `eval` 被封鎖，
請更新同重建網站，再部署 `public/vendor/webrdp/rle.js` 並重新載入遠端頁面。
新版 RLE 解碼器會直接初始化，支援現有 `script-src 'self'`，毋須放寬 CSP。

取消、連線錯誤、逾時同網站關機會清理 RDP socket。伺服器連線期限
為 30 秒，瀏覽器整體期限為 35 秒。斷線後需手動重連並重新輸入密碼；
密碼連線後會清空；命名資料庫設定可加密保存密碼，按「載入設定與密碼」可重新載入。

喺 `website-part/` 執行 `npm run test:rdp-browser`，可用本機模擬伺服器
套用正式環境 CSP 測試解碼器初始化、畫面、輸入同重連。若未能自動搵到
瀏覽器，設定 `RDP_BROWSER_PATH` 指向 Chrome／Edge／Chromium。此測試唔會連真實 RDP 主機；Windows
登入同實際桌面仍需喺部署環境驗證。

### RDP 內網允許清單

部署修正後，喺 `website-part/.env` 設定
`RDP_ALLOWED_HOSTS=192.0.2.0/24`，再重啟網站，即可允許連接
192.0.2.x 網段。請按實際需要填主機或網段；支援逗號分隔嘅
主機名稱、IP 同 IPv4 CIDR。空清單只允許公網；非空清單只允許
符合項目嘅目標，包括內網。此修正唔會改變 SSH 規則。

### 每位使用者多組 RDP 設定

遠端頁面支援新增、選取、更新同刪除多組命名設定，每組包含主機、
連接埠、帳號、網域同可選密碼。按「新增」填資料後儲存；更新時密碼
留空會保留原密碼。刪除只影響所選嗰組。

網站啟動會執行 migration 016，建立 `website_rdp_profiles`。所有操作
按登入帳號 ID 分開處理，連線資料同密碼使用現有 AES-256-GCM 加密。
需設定穩定嘅 Base64 32-byte `REMOTE_CREDENTIAL_ENCRYPTION_KEY`；
未設定時會顯示提示並停用儲存。密碼唔會寫入 localStorage。
舊版單組設定仍保留，可從表單另存為命名設定。

### FnOS 檔案管理與分享

網站同 Discord Bot 可共用一個 MySQL 主庫。FnOS 經 SFTP 提供檔案。FnOS 停機時，會員仍可登入同開啟首頁，檔案同分享頁會提示暫停。單機部署同資料庫還原步驟見 [OpenWrt Compose 指南](website-part/deploy/openwrt/README.md)。

Router 網站嘅 `/files.html` 透過 SFTP 存取 FnOS `/vol*/1000`，頁面同其他頁面一樣
由 React 建立：`frontend/files.html` 掛載共用 bundle，邏輯喺
`frontend/src/pages/FilesPage.jsx`，經 `frontend/src/lib/filesApi.mjs` 呼叫
`/api/files`。公開頁 `frontend/share.html` 就掛載 `SharePage`，分享碼只會出現喺
URL fragment。

`FILES_OWNER_USER_ID` 綁定一個網站帳號做檔案擁有者：佢可以讀寫、分享所有
`/vol*/1000` 目錄，並授權其他帳號讀取、寫入同分享；一般管理員唔會自動獲得檔案
權限，改名亦唔會轉移擁有權。未獲授權嘅登入用戶會見到申請面板，待擁有者核准。

擁有者或獲分享權限者可以建立 1 至 168 小時嘅分享碼；分享碼只以 SHA-256 雜湊
保存並只顯示一次。收到分享碼嘅人毋須登入，喺 `/share.html` 即可讀取分享嘅檔案或
資料夾；資料夾分享係即時路徑，之後新增嘅內容同樣可讀，直到分享碼過期或被撤銷。
上傳上限 1 GiB，同名檔案唔會被覆蓋。勾選多個項目（或者喺資料夾嘅「•••」選單揀
「打包下載」）會將選取內容串流成單一 ZIP，直接由 FnOS 經 Router 傳送；單次上限
50 個選取項目、2000 個壓縮項目同 4 GiB 未壓縮內容。收到資料夾分享嘅人喺
`/share.html` 亦有同樣嘅打包按鈕，但只限分享路徑之內。所有操作只限喺
`/vol*/1000` 之內，路徑跳脫、符號連結同特殊裝置檔案一律拒絕。

網站啟動時 migration `018` 會建立 `website_file_permissions` 同
`website_file_shares`；migration `019` 會再次檢查用戶 ID 欄位寬度，令早前將未發佈
檔案 migration 記為 `017` 嘅資料庫仍可完成 UUID 欄位加寬。完整部署步驟、權限設定同功能限制請參考
[`docs/file-browser.md`](docs/file-browser.md)。

## License

This project is for personal and community use. All rights reserved.
# 會員信箱

網站選單的「郵件」頁面（`/mail.html`）現已提供會員自行建立信箱。
每位已接受網站條款嘅會員可喺 `MAILU_DOMAIN` 設定嘅網域揀一個可用嘅信箱名稱，
設定獨立的信箱密碼，建立後即可開啟 Roundcube 收發郵件。
信箱預設容量 1 GiB；網站密碼與信箱密碼分開管理。
部署設定、重試流程及備份說明請參閱 [Member mailboxes](README.md#member-mailboxes)。
