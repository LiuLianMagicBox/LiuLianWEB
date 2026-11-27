# HTTPS 反向代理同私網上游

以 Nginx Proxy Manager 作入口時，先設定網站網域、有效嘅來源 HTTPS 憑證同應用程式嘅私有監聽位址。代理要支援 WebSocket，傳送上傳同下載時要關閉 buffering。使用 Cloudflare 或其他外層代理時，只信任已設定嘅入口傳入嘅轉發標頭。存取日誌應避免記錄私人分享同訂閱網址。

## 驗證網站入口

將 `WEBSITE_ORIGIN` 設為自己網站嘅 HTTPS 網址，再檢查登入頁同應用程式健康狀態。

```sh
curl -fsS "$WEBSITE_ORIGIN/healthz"
curl -fsS "$WEBSITE_ORIGIN/login.html" -o /dev/null
```

如外層代理回應 525，檢查來源主機有冇監聽 HTTPS、憑證是否涵蓋網站網域，以及 SNI 是否正確。若網站代理回應 502，從運行網站嘅主機檢查上游服務嘅完整網址，包括設定好嘅子路徑。

## Suwayomi 私網代理

Suwayomi 如使用 `/connect/suwayomi` 作為 `server.webUISubpath`，網站連線目標亦要包含呢個子路徑。經 OpenWrt 同 NetBird 轉送時，防火牆需要允許網站節點經指定介面連到上游地址同 TCP 埠。

[OpenWrt 防火牆範例](openwrt-suwayomi.firewall)使用文件示例位址。將 `src_ip` 換成網站節點嘅私網地址，將 `dest_ip` 換成上游節點嘅私網地址，並核對介面同監聽埠。將該規則加入現有設定，先執行 `fw4 check`，通過後才重載。回退時只移除新增嘅規則。

從網站節點測試 `SUWAYOMI_ORIGIN` 指定嘅上游，再從瀏覽器核對網站登入、連線授權同頁面資源。

```sh
curl -fsS "$SUWAYOMI_ORIGIN/connect/suwayomi/" -o /dev/null
```
