# OpenWrt N100 網站及 MySQL

呢個範例將網站同共用 MySQL 放喺一部 OpenWrt 主機，並經 SFTP 連到 FnOS。儲存服務停機期間，使用者仍可登入網站，檔案同分享頁會提示稍後重試。

## 準備本機 SSD

用 `df -hT /mnt/ssd` 核對實際掛載同可用空間，將路徑換成 N100 嘅 SSD。可喺來源 MySQL 用以下唯讀查詢估算共用資料庫連索引嘅大小。另預留增長、binary log、暫存檔同映像更新空間。

```sql
SELECT table_schema, ROUND(SUM(data_length + index_length) / 1024 / 1024) AS size_mib
FROM information_schema.tables
WHERE table_schema = DATABASE()
GROUP BY table_schema;
```

Docker 資料目錄亦應設喺本機 SSD。建置機可從 repository 根目錄建立 amd64 映像，按提交版本加 tag，再經現有 registry 或 `docker save`／`docker load` 送到 N100。

```sh
docker build --platform linux/amd64 -t "liulianweb:$(git rev-parse --short HEAD)" .
```

喺 N100 本機保存本目錄嘅 `compose.yaml` 同設定。

1. 複製 `.env.example` 為 `.env`，指定實際映像 tag、與來源相容並已測試嘅 MySQL 版本，以及 SSD 上預先建立嘅獨立資料目錄。全新主庫應使用空目錄。原有資料以備份還原。
2. 設定 `DB_NAME`、專用 `DB_USER`、`DB_PASSWORD` 同獨立嘅 `MYSQL_ROOT_PASSWORD`。沿用現有網站設定建立 `website.env`，新環境可參考 `../../.env.example`。兩個檔案權限設為 `600`。沿用原有 Session secret、Cookie 名稱同應用加密金鑰。共用主庫連線由 Compose 指向本機容器。
3. 喺 `website.env` 設定 FnOS 嘅 SFTP 連線及 host key 指紋。公會設定寫入或其他整合如需額外設定檔，按現有部署以 Compose override 掛載到對應路徑，並維持單一寫入節點。網站啟動所需設定要喺 N100 本地可讀。
4. `docker compose config --quiet` 驗證設定。先用 `docker compose up -d mysql` 啟動目標資料庫。資料庫初次建立後，修改環境檔內密碼亦須同步更新 MySQL 帳戶。

## 還原同切換

先喺隔離資料庫試還原網站同 Bot 共用嘅完整 schema，包括兩套 migration 紀錄。可用 MySQL 邏輯備份工具，以權限受限嘅設定檔提供連線資料。對使用 InnoDB 嘅資料庫可用一致性快照，包含 triggers、routines 同 events。隔離副本應停用外部同步、排程同真實 Bot 連線。

例如將 `SOURCE_CLIENT_CNF` 指向來源 MySQL 嘅用戶端設定檔，`PROJECT_DB` 設為該專案嘅資料庫名稱，`BACKUP_FILE` 設為新備份檔案路徑。備份成功後，以下第二個步驟只喺已啟動嘅空白演練目標執行。

```sh
umask 077
mysqldump --defaults-extra-file="$SOURCE_CLIENT_CNF" --single-transaction --hex-blob \
  --routines --events --triggers --set-gtid-purged=OFF --no-tablespaces \
  "$PROJECT_DB" > "$BACKUP_FILE"
```

```sh
docker compose exec -T mysql sh -c \
  'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -u root "$MYSQL_DATABASE"' < "$BACKUP_FILE"
```

正式切換時暫停舊網站、Bot 同其餘寫入者，完成最後同步或重新備份還原，核對資料表、會員數及遷移版本。將網站同 Bot 指向同一個新主庫。舊庫維持停止寫入，直至驗收完成。回退前如新庫已有新資料，先同步返舊庫。

用 `docker compose up -d app` 啟動網站。將現有 HTTPS 入口指向 `127.0.0.1:30012`，由代理覆寫轉發來源 IP 同協定，並支援 WebSocket。更新舊 HAProxy 嘅一般、內網及 WebSocket 路由去現用網站。若舊服務仍佔用該埠，可先用另一個 `WEBSITE_PORT` 作驗收。Bot 在 N100 主機上可連 loopback 嘅 `BOT_DB_PORT`。如 Bot 喺另一部機，以私網介面設定 `BOT_DB_BIND_IP`，防火牆只允許 Bot 來源。定期將資料庫備份送至在線嘅 FnOS，並於獨立目錄驗證還原。

## FnOS 離線驗收

喺隔離環境建立測試會員及未到期分享。停用測試 SFTP，重新啟動網站，用全新瀏覽器登入同開啟會員首頁。確認 `/healthz` 仍回應 200，登入頁同檔案頁顯示暫停提示，原生下載顯示維護頁。恢復 SFTP 後，原有分享應可再次下載。每個程序會共用一次最多三秒嘅 SFTP 狀態查詢，結果快取三十秒，頁面約每三十秒更新。登入及主站健康檢查只依賴本機網站同資料庫。
