# 遠端工作區

[返回首頁](../README_HK.md) · [English](remote-access.md)

## SSH 同 WebRDP 存取權限

會員要先接受網站條款，並屬於獲授權群組，先可以使用遠端頁面。預設群組係 `admin`。`REMOTE_SSH_ENABLED` 同 `REMOTE_RDP_ENABLED` 可對所有人停用對應功能。SSH 使用 `/api/ssh` WebSocket，瀏覽器 RDP 會透過 Socket.IO 連線。頁面亦可以產生 RDP 檔案。

喺 `website-part/.env` 設定獲授權群組同目的地。請將示例主機同網段換成網站應該連接嘅目標。

```dotenv
REMOTE_ALLOWED_GROUPS=admin,server-operator
SSH_ALLOWED_HOSTS=server.example.com,192.0.2.0/24
RDP_ALLOWED_HOSTS=192.0.2.0/24
```

兩種協定都會核對解析後嘅實際位址，包括 IPv4-mapped IPv6。清單留空只容許公網目的地。填入清單後，目的地必須符合已允許嘅主機名稱、IP 或 IPv4 CIDR。更改環境設定後要重啟網站。

如果要喺伺服器加密保存 SSH 同 RDP 設定，用 `openssl rand -base64 32` 產生金鑰，私下填入 `REMOTE_CREDENTIAL_ENCRYPTION_KEY` 並備份。既有設定需要原來嘅金鑰先可以解密。未設定金鑰時仍可喺受信任裝置使用瀏覽器本機儲存，SSH 密碼唔會被保存。

## 使用 RDP 桌面

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

如果頁面提示 WebRDP 資源未能載入，檢查網站嘅 `/vendor/socket.io.min.js`、`/vendor/webrdp/rle.js` 同 `/css/style.css`，三項都應該回應 HTTP 200。用戶端本身打包喺 `/assets/`。[瀏覽器驗證](development.zh-HK.md#瀏覽器測試)

### 具名 RDP 設定

遠端頁面支援新增、選取、更新同刪除多組命名設定，每組包含主機、
連接埠、帳號、網域同可選密碼。按「新增」填資料後儲存；更新時密碼
留空會保留原密碼。刪除只影響所選嗰組。

網站啟動會執行 migration 016，建立 `website_rdp_profiles`。所有操作
按登入帳號 ID 分開處理，連線資料同密碼使用現有 AES-256-GCM 加密。
需設定穩定嘅 Base64 32-byte `REMOTE_CREDENTIAL_ENCRYPTION_KEY`；
未設定時會顯示提示並停用儲存。密碼唔會寫入 localStorage。
舊版單組設定仍保留，可從表單另存為命名設定。

## Chromium 工作區

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

## Interim VLESS Tunnel

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
