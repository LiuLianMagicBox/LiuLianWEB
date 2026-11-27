# 多地區 VPS 部署

[部署指南](../../../docs/deployment.zh-HK.md#部署範例) · [節點環境範本](node.env.example) · [Compose](compose.yaml) · [Nginx 設定](nginx.conf)

架構：同一個公開 HTTPS 網域 → 具健康檢查的地理 DNS／全域負載平衡 → 各地 VPS 的 Nginx + Node.js → 同一個 MySQL 主庫及 SFTP 儲存。

這是網站多節點部署；資料庫採單一寫入端點，不提供多主資料庫、離線寫入或跨區資料庫容錯。MySQL 不可用時，登入與依賴資料庫的功能也不可用。跨區資料庫延遲仍會影響 API。各節點必須使用同一版程式與靜態資源。

## 每台 VPS

1. 安裝 Docker Engine 與 Compose plugin，將相同版本的 repo 放到每台 VPS。
2. 在 `website-part/deploy/multi-region/` 執行 `cp node.env.example node.env`，填入同一個主資料庫的連線資料。既有部署的 Session secret、Cookie name、遠端憑證及 Clash 加密金鑰必須沿用且所有節點相同。新 secret 可用 `openssl rand -hex 32` 產生。
3. 建立 `config/`、`tls/` 目錄。將公開網域的有效憑證與私鑰分別放入 `tls/fullchain.pem` 和 `tls/privkey.pem`，設定檔案權限。由現有憑證管理工具或 DNS challenge 取得並續期，續期後執行 `docker compose exec gateway nginx -s reload`。範例不負責自動簽發憑證。
4. MySQL、SFTP、SSH/RDP 目標與 Chromium CDP 使用私有網路／VPN；DB 也可透過 `DB_SSL_CA_FILE` 指定 CA 驗證 TLS。所有節點需可連到相同的服務目標。MySQL 使用現有專案資料庫及必要的 Discord schema；網站遷移不會建立整套 Bot 資料。
5. 執行 `docker compose up -d --build`，用 `docker compose ps` 與 `docker compose logs app` 查看啟動結果。首次部署會新增限流表；遷移有資料庫鎖，其他節點最多等候 120 秒，超時會重啟重試。
6. 防火牆只開放網站 443 與必要的管理入口。app 的 3000 port 不對主機公開。設定全域 DNS／流量管理服務，以 HTTPS `/healthz` 探測各 VPS，移除失效節點；普通 DNS 多筆 A 記錄本身沒有健康檢查。DNS 切換仍受快取 TTL 影響。

範例預設公開流量直接到各 VPS 的 Nginx。若另加 CDN／HTTP 負載平衡，必須在 Nginx 設定受信任的來源 IP 範圍與真實客戶端 IP header；否則登入限流會把 CDN 視為單一客戶端。不要直接信任使用者送來的 X-Forwarded-For。保留公開 Host、HTTPS 協定及 WebSocket Upgrade headers。

## 狀態與功能設定

### 共用登入同長連線

- `DISTRIBUTED_DEPLOYMENT=true` 將 IP 與帳號限流存入 MySQL，切換節點不能重設計數。帳號限流保留 15 分鐘內的失敗次數，成功登入只扣除這次請求，不清除先前失敗；進行中的請求暫時計入。資料庫錯誤不會退回無限制登入。
- Session 已存入 MySQL。保持同一公開網域及 secret，即可在節點間共用登入。不要以不同地區子網域作為日常入口，Cookie 不會自動跨網域共用。
- RDP 使用 WebSocket-only；SSH、遠端瀏覽器也是長連線。入口必須支援 WebSocket。連線建立後留在該節點，節點故障或更新時需要使用者重新連線，不會自動搬移遠端工作階段。
- 檔案資料透過相同 SFTP 服務共用。每程序最多 8 個 SFTP 操作，因此總連線數會隨 VPS 數量增加。

### 遠端工作區同 Clash

- 映像沒有內建 Chromium。需要瀏覽器功能時設定每個節點可存取的 `CHROME_CDP_URL`；CDP 不可暴露於公開網路。非 loopback CDP 亦須填入 `CHROMIUM_PROXY_BIND_HOST`、`CHROMIUM_PROXY_ADVERTISED_HOST` 及 `CHROMIUM_PROXY_ALLOWED_CLIENT_IPS`，讓 Chrome 可回連各節點的工作階段代理及動態 TCP port；防火牆只容許列出的 Chrome 來源 IP。容器應使用可路由的私人網路或其他可達代理監聽 port 的部署，單靠 gateway 轉發 3000 不足以支援此回連。remote Chrome 須加 `--enable-automation` 及 `--webrtc-ip-handling-policy=disable_non_proxied_udp`；缺少設定或無法驗證政策會拒絕啟動。
- Clash 同步已有 MySQL 鎖，避免多節點同時同步。所有執行同步的節點需有相同的 `CLASH_SSH_PROFILES_FILE`、金鑰及 SSH 存取權限。若 profile 引用私鑰檔，亦需掛載到一致路徑。

### 公會設定寫入節點

Discord 公會管理會讀寫 Bot 嘅 JSON 設定檔。喺入口將整個 `/api/guild-manager/` 固定轉送到管理節點。喺該節點以可寫 volume 掛載 Bot 設定目錄，例如 `/srv/discord-settings:/run/discord-settings:rw`，並將 `DISCORD_CONFIG_PATH` 指向入面嘅 `config.json`。網站程序須能夠喺同一個目錄建立檔案同重新命名。

只喺呢個節點設定 `GUILD_CONFIG_WRITER=true`。語言等候同步時，寫入節點每 30 秒重試。範例嘅一般節點以唯讀方式掛載設定，收到更新請求會喺寫入資料庫前回應 503。公會權限查詢亦要經指定節點。其他節點如需提供後台公會總覽，應同步唯讀副本。

### 滾動更新

- 滾動更新前先把節點從入口移除，等待既有長連線結束，再更新並探測 `/healthz`，最後重新加入。若 Compose 重建 app 容器，請 `docker compose restart gateway`，讓 Nginx 重新解析 app 容器 IP。健康檢查目前驗證 MySQL，並不保證 SSH/SFTP/CDP 目標健康。

## 驗收

先用兩台測試 VPS 及測試資料庫驗證，再接上正式網域：

1. 在節點 A 登入，用同一 Cookie 存取節點 B 的 `/api/auth/me`，確認仍登入。可用 `curl --resolve 網域:443:節點IP` 指定各節點，維持相同 Host/TLS 網域。
2. 交替向 A、B 發送失敗登入，確認同一 IP／帳號累積達門檻後回傳 429。
3. 同時啟動兩節點，確認 migration 025 只被記錄一次，無重複 DDL 錯誤。
4. 實測 SSH、RDP、Chromium 和檔案下載；移除 A 後新請求能進 B，既有遠端連線需手動重連。
5. 確認限流用的是客戶端真實 IP，公會 API 全部進指定管理節點，且加密憑證在兩台均能解密。

參考：[Socket.IO 多節點部署](https://socket.io/docs/v4/using-multiple-nodes/)；[express-rate-limit 自訂 Store](https://github.com/express-rate-limit/express-rate-limit/wiki/Creating-Your-Own-Store)。
