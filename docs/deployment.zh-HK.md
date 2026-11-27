# 安裝同部署

[返回首頁](../README_HK.md) · [English](deployment.md)

## 本機安裝

[快速啟動](../README_HK.md#快速啟動)會使用環境範本同已編譯嘅前端。Windows 用戶可以喺專案根目錄用 PowerShell 複製同一組檔案。

```powershell
Copy-Item shared\database\config.example.json shared\database\config.json
Copy-Item website-part\.env.example website-part\.env
```

填好資料庫連線資料，並設定至少 32 個字元嘅隨機 `SESSION_SECRET`，再喺 `website-part` 執行 `npm ci` 同 `npm start`。如果未安裝 OpenSSL，亦可以喺本機用 Node 產生隨機值。

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

啟用 Discord 整合時，將 `DISCORD_CONFIG_PATH` 指向獨立 Bot 嘅 `discord-part/config.json`。公會語言設定會透過重新命名暫存檔更新，所以指定寫入節點需要對**整個設定檔目錄**有寫入權限。Docker 寫入節點亦要以可寫方式掛載呢個目錄。從未支援活動候補嘅舊版 Bot 升級時，先停止舊 Bot，啟動網站執行遷移 `029`，然後啟動相容版本嘅 Bot。[資料庫設定同遷移](../shared/database/README.md)

## Linux 同 OpenWrt 上使用 PM2

安裝 PM2，設定正式環境嘅資料庫、Session secret 同 HTTPS 反向代理，再喺專案根目錄執行啟動腳本。

```sh
bash website-part/start.sh init
```

`init` 會安裝正式依賴、註冊並啟動 `liulianbot-website`，然後儲存 PM2 程序清單。更新依賴或程序定義後要再執行一次。更改環境設定可以用 `bash website-part/start.sh restart`，已停止嘅程序可以用 `start` 啟動。如果自訂程序名稱，每次執行都要用同一個 `PM2_APP_NAME`。

如果更新後出現 `MODULE_NOT_FOUND`，喺 `website-part` 執行 `npm ls js-yaml socket.io @electerm/rdpjs --depth=0`，再用 `init` 重新安裝鎖定版本。重啟後可以用 `/healthz` 核對應用程式嘅資料庫連線。

OpenWrt 或 iStoreOS 先完成初始化，再以 root 安裝開機服務。

```sh
bash website-part/start.sh startup
/etc/init.d/pm2-pm2 enabled
```

開機服務需要 `/usr/bin/pm2`，會讀取 `/root/.pm2`，並將既有啟動腳本備份到 `/root/.pm2/startup-backups/`。執行 `/etc/init.d/pm2-pm2 start` 會恢復 root 已儲存嘅全部 PM2 程序。停止服務會一併停止該 PM2 daemon 同其程序。更改程序清單後要再儲存，並確保開機時網站檔案系統同資料庫已就緒。

## Docker CLI

喺專案根目錄建置映像。[網站 Dockerfile](../website-part/Dockerfile)會打包倉庫內已編譯嘅前端。[根目錄 Dockerfile](../Dockerfile)會由原始碼重新建置前端。

```bash
docker build --file website-part/Dockerfile --tag liulianbot-website:latest .
```

以下範例將主機連接埠綁定喺 loopback，供本機 HTTPS 反向代理使用。喺 `shared/database/config.json` 設定**容器內可以連到**嘅資料庫位址。容器會以唯讀方式掛載呢個檔案，網站設定由 `website-part/.env` 載入。

```bash
docker run --detach --name liulianbot-website \
  --restart unless-stopped \
  --publish 127.0.0.1:3000:3000 \
  --env-file website-part/.env \
  --env NODE_ENV=production \
  --env BIND_IP=0.0.0.0 \
  --volume "$(pwd)/shared/database/config.json:/app/shared/database/config.json:ro" \
  liulianbot-website:latest
```

Windows PowerShell

```powershell
docker run --detach --name liulianbot-website `
  --restart unless-stopped `
  --publish 127.0.0.1:3000:3000 `
  --env-file website-part/.env `
  --env NODE_ENV=production `
  --env BIND_IP=0.0.0.0 `
  --volume "${PWD}/shared/database/config.json:/app/shared/database/config.json:ro" `
  liulianbot-website:latest
```

用 `docker logs --follow liulianbot-website` 查看日誌。更新程式或依賴後，重新建置映像，用相同嘅私人設定同掛載重新建立容器。定期清理 Session 時遇到暫時性資料庫錯誤，網站亦會寫入日誌。

## 部署範例

| 安裝方式 | 指南 |
| --- | --- |
| HTTPS 反向代理或 Suwayomi 私網上游 | [Nginx Proxy Manager 同 OpenWrt 防火牆](../website-part/deploy/reverse-proxy/README.md) |
| 一部 OpenWrt 主機運行網站同 MySQL | [本機 SSD、備份同還原](../website-part/deploy/openwrt/README.md) |
| Router 配一部 VPS | [HAProxy 同受限 SSH 隧道](../website-part/deploy/router-vps/README.md) |
| 多地區網站節點 | [Nginx、共用 Session 同登入限流](../website-part/deploy/multi-region/README.md) |
| 集中管理 Clash VPN 帳戶 | [SSH 設定同到期撤銷](../website-part/deploy/clash-vps/README.md) |
