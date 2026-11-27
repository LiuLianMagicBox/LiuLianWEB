# 網站環境設定

[返回首頁](../README_HK.md) · [English](configuration.md)

喺本機複製[網站環境範本](../website-part/.env.example)為 `website-part/.env`。以下列出範本值或功能預設值。MySQL 連線亦可透過 [JSON 設定範本](../shared/database/config.example.json)提供。

## 網站同 Session

| 變數 | 範本／預設 | 用途 |
| --- | --- | --- |
| `NODE_ENV` | `development` | 生產環境設為 `production`；此模式要求 `SESSION_SECRET` 並啟用安全 Cookie。 |
| `PORT` | `3000` | HTTP 監聽連接埠。 |
| `BIND_IP` | `127.0.0.1` | 範本會綁定 loopback。未指定監聽位址時，Node 會喺可用網絡介面監聽。 |
| `TRUST_PROXY` | `1` | 受信任嘅代理層數或 IP/CIDR 清單，要配合實際入口路徑。設為 `0` 可停用代理信任。 |
| `SESSION_COOKIE_NAME` | `connect.sid` | Session Cookie 名稱。 |
| `SESSION_SECRET` | 必須設定 | 所有環境都需要至少 32 字元嘅隨機密碼，用來簽署 Session。 |
| `TERMS_OF_SERVICE_REQUIRED` | `true` | 只有主機管理者毋須強制明確同意服務條款及資料儲存時先設為 `false`。 |
| `PROXY_ALLOW_SELF_SIGNED` | `false` | 只有上游網站刻意使用自簽憑證時先設為 `true`。 |

## 資料庫同公會設定

| 變數 | 範本／預設 | 用途 |
| --- | --- | --- |
| `DB_HOST` | 留空 | 填寫後，網站會改由環境變數讀取資料庫設定。 |
| `DB_PORT` | `3306` | 使用 `DB_HOST` 時嘅 MySQL 連接埠。 |
| `DB_USER` | 留空 | 設定 `DB_HOST` 時必須填寫嘅資料庫帳戶。 |
| `DB_PASSWORD` | 留空 | 資料庫帳戶密碼。 |
| `DB_NAME` | 留空 | 設定 `DB_HOST` 時必須填寫嘅資料庫名稱。 |
| `DB_SSL_CA_FILE` | 留空 | 驗證 MySQL TLS 用嘅 CA 憑證檔，網站程序需要讀取權限。 |
| `DISTRIBUTED_DEPLOYMENT` | `false` | 多節點部署時，每個節點均設為 `true`，透過 MySQL 共用登入限流。 |
| `DISCORD_CONFIG_PATH` | 留空 | Bot 設定檔嘅路徑。預設位置係 `shared/discord/config.json`。公會管理需要讀取 Bot 設定。 |
| `GUILD_CONFIG_WRITER` | `false` | 分散式部署時，只喺可寫入 Bot 設定目錄嘅指定節點設為 `true`。 |

## SSH 同 WebRDP

| 變數 | 範本／預設 | 用途 |
| --- | --- | --- |
| `REMOTE_ALLOWED_GROUPS` | `admin` | 可使用 SSH/RDP 頁面及 API 嘅網站用戶群組。 |
| `REMOTE_SSH_ENABLED` | `true` | 設為 `false` 即對所有用戶停用 SSH，包括管理員。 |
| `REMOTE_RDP_ENABLED` | `true` | 設為 `false` 即對所有用戶停用 RDP，包括管理員。 |
| `SSH_ALLOWED_HOSTS` | 空白 | SSH hostname/IP 或 IPv4 CIDR；私人目的地要明確命中清單，數字 IPv4 必須用標準點分十進位，實際連線 IP 亦會核對 IP/CIDR 授權。空白只容許公開目的地。 |
| `RDP_ALLOWED_HOSTS` | 留空 | 用逗號分隔主機名稱、IP 或 IPv4 CIDR。留空只容許公網。設定清單後，所有目的地都要符合清單。 |
| `REMOTE_CREDENTIAL_ENCRYPTION_KEY` | 空白 | 用於伺服器端加密保存 SSH/RDP 設定嘅 Base64 32-byte AES-256-GCM 金鑰。 |

## Chromium

| 變數 | 範本／預設 | 用途 |
| --- | --- | --- |
| `CHROME_EXECUTABLE_PATH` | 空白 | 如果 Chrome/Chromium 唔喺 `PATH`，請填入執行檔路徑。 |
| `CHROME_CDP_URL` | 空白 | 可選嘅遠端 Chrome DevTools endpoint，例如 `http://browser.example.org:9222`；設定後網站會連去遠端 Chrome，而唔會喺本機啟動。 |
| `CHROMIUM_ALLOWED_HOSTS` | 空白 | 明確容許 Chromium 存取私人目的地嘅 hostname/IP 清單；工作階段代理會檢查及固定 HTTP(S)、WebSocket、worker 同新視窗嘅連線 IP。 |
| `CHROMIUM_PROXY_BIND_HOST` | `127.0.0.1` | 工作階段代理監聽地址；remote CDP 需要明確設定。 |
| `CHROMIUM_PROXY_ADVERTISED_HOST` | `127.0.0.1` | Chrome 可連到嘅代理 hostname/IP；非 loopback CDP 必須明確設定。 |
| `CHROMIUM_PROXY_ALLOWED_CLIENT_IPS` | Loopback | 可以使用代理嘅 Chrome 來源 IP 清單；非 loopback CDP 必須明確設定，只接受精確 IP。 |
| `CHROMIUM_SESSION_TIMEOUT_MS` | `1800000` | 每個 Chromium WebSocket 工作階段最長存活時間，單位係毫秒。 |

## VLESS

| 變數 | 範本／預設 | 用途 |
| --- | --- | --- |
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

## FnOS 檔案

| 變數 | 範本／預設 | 用途 |
| --- | --- | --- |
| `FILES_OWNER_USER_ID` | 空白 | FnOS 檔案擁有者嘅網站用戶 ID（唔係用戶名稱）；留空即停用檔案頁。 |
| `FILES_SFTP_HOST` | 空白 | 網站伺服器可經 SFTP 連線嘅 FnOS 主機。 |
| `FILES_SFTP_PORT` | `22` | FnOS SFTP 連接埠。 |
| `FILES_SFTP_USER` | 空白 | 用嚟讀寫 `/vol*/1000` 嘅 SFTP 帳號。 |
| `FILES_SFTP_PASSWORD` | 空白 | 該 SFTP 帳號密碼；只保存喺 `website-part/.env`。 |
| `FILES_SFTP_HOST_SHA256` | 空白 | SSH 主機金鑰指紋，格式為 64 個十六進位 SHA-256 字元；不符時拒絕連線。 |

## Mailu、Clash 同 NetBird

| 變數 | 範本／預設 | 用途 |
| --- | --- | --- |
| `CLASH_SYNC_ENABLED` | `true` | 如由其他節點負責同步 VPN 帳戶，喺本節點設為 `false`。 |
| `CLASH_SSH_PROFILES_FILE` | 留空 | 受管理 VPN 節點使用嘅私人 SSH profile JSON 路徑。 |
| `CLASH_CREDENTIAL_ENCRYPTION_KEY` | 留空 | 管理 VPN 帳戶憑證用嘅 Base64 編碼 32-byte 金鑰。所有節點同重啟後都要用同一把金鑰。 |
| `MAILU_API_URL` | 留空 | Mailu HTTPS API 位址，要包含 API 版本路徑。 |
| `MAILU_API_TOKEN` | 留空 | 伺服器端使用嘅 Mailu 管理 API 令牌。 |
| `MAILU_DOMAIN` | 留空 | 供會員建立信箱嘅網域。 |
| `MAILU_WEBMAIL_URL` | 留空 | 會員開啟網上郵件嘅 HTTPS 網址。 |
| `MAILU_QUOTA_BYTES` | `1073741824` | 以 bytes 表示嘅信箱配額，預設為 1 GiB。 |
| `NETBIRD_API_URL` | `https://api.netbird.io/api` | NetBird Cloud 或自架管理服務嘅 HTTPS 位址，以 `/api` 結尾。 |
| `NETBIRD_API_TOKEN` | 留空 | 服務帳戶嘅個人存取令牌，填入後會啟用整合。 |

## 存取同安全

- 將 Bot 設定、資料庫密碼、Session secret、令牌同加密金鑰保存在伺服器。網站用嘅 MySQL 帳戶只需要該資料庫嘅相關權限。
- 正式部署使用 HTTPS 同 secure Cookie，並按實際代理路徑設定 `TRUST_PROXY`。`/healthz` 可供監察系統查詢資料庫狀態。
- 新密碼最少 8 個字元、最多 72 個 UTF-8 bytes，並會檢查常見弱密碼。登入沿用既有 bcrypt 記錄。變更狀態嘅 API 會核對來源，重複登入失敗會按資料庫帳戶身分限流。
- `/connect/<slug>/` 只應指向受信任嘅服務。網站會排除主站 Session Cookie，並按連線重新命名衝突嘅上游 Cookie。代理保留已設定嘅子路徑及相關 Cookie 路徑。升級後如有舊 Cookie 衝突，可清除該連線嘅 Cookie 並重新登入。
- 主站會傳送 CSP 同其他[安全標頭](../website-part/src/middleware/security_headers.js)。第三方代理頁面保留上游策略。受保護頁面會加上 `noindex` 標記，並列入 [robots.txt](../website-part/frontend/static/robots.txt)。遠端工作區另有群組、目的地同憑證儲存設定。[遠端工作區指南](remote-access.zh-HK.md)
