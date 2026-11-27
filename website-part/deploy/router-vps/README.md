# Router 同 VPS 雙節點部署範例

[部署指南](../../../docs/deployment.zh-HK.md#部署範例) · [多地區 VPS 部署](../multi-region/README.md)

呢套範例由 HAProxy 接收本機 HTTPS 入口代理轉送嘅請求。一般網站流量可分配到 router 同 VPS，內網 API、網站代理同 WebSocket 會送到 router。兩個網站節點需要共用 MySQL、Cookie 名稱同 Session secret。公會設定由單一節點寫入。

## 準備節點

1. 在 router 部署網站同 [HAProxy 設定](haproxy.cfg)。範例入口監聽 `127.0.0.1:30011`，router 網站監聽 `127.0.0.1:30012`。HAProxy 使用 `CF-Connecting-IP`，只應讓受信任嘅本機 Cloudflare connector 連入。使用其他入口時要調整來源 IP 處理。
2. 在 VPS 將網站安裝到 `/opt/liulianweb/website-part`，建立 `liulianweb` 服務帳戶，並在 `/etc/liulianweb/website.env` 設定 `NODE_ENV=production`、`BIND_IP=127.0.0.1`、`PORT=30011` 同 `DISTRIBUTED_DEPLOYMENT=true`。兩個節點都要啟用分散式模式。VPS 用 `DB_HOST=127.0.0.1` 同 `DB_PORT=13307` 連到轉送埠，並按[網站環境範本](../../.env.example)填寫其餘設定。
3. 在 VPS 建立 `/etc/liulianweb/router-tunnel.env`，參照下方填寫 SSH 連線同資料庫位置。`FORWARD_DB_HOST` 係從 router 連去 MySQL 嘅位址。將專用 SSH 私鑰存為 `/etc/liulianweb/tunnel_key`，經可信渠道核對 router 嘅 SSH host key，並將佢加入 `/etc/liulianweb/known_hosts`。私鑰同環境檔只供對應服務讀取。
4. 按實際安裝位置核對兩份 systemd unit，安裝 [SSH 隧道](liulian-router-tunnel.service)同[網站服務](liulian-website.service)。隧道會由 router 嘅 `127.0.0.1:30013` 轉送至 VPS 網站，並由 VPS 嘅 `127.0.0.1:13307` 轉送至指定資料庫。

```dotenv
ROUTER_SSH_HOST=router.example.org
ROUTER_SSH_PORT=22
ROUTER_SSH_USER=web-tunnel
FORWARD_DB_HOST=db.example.org
FORWARD_DB_PORT=3306
```

## 驗證同回退

先喺 VPS 檢查兩個 unit 同本機網站。

```sh
systemctl status liulian-router-tunnel liulian-website
curl -i http://127.0.0.1:30011/healthz
```

再喺 router 經 HAProxy 多次請求 `http://127.0.0.1:30011/healthz`，查看 `X-LiuLian-Node` 回應標頭。重載 HAProxy 前，用 `haproxy -c -f` 配合實際設定檔路徑驗證。

共用 Session、限流同資料庫並行行為可用[雙節點驗證腳本](verify.js)測試。在測試環境嘅 router 上，從 `website-part` 執行 `node deploy/router-vps/verify.js`。返回單節點時，先讓入口只轉送到健康嘅 router 網站，再停止 VPS 網站同隧道。資料庫恢復步驟見 [OpenWrt 部署指南](../openwrt/README.md)。
