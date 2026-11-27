# 共用 MySQL 設定

<a name="shared-database-config"></a>

[網站快速啟動](../../README_HK.md#快速啟動) · [環境變數](../../docs/configuration.zh-HK.md#資料庫同公會設定)

此資料夾提供網站 MySQL 設定。Discord Bot 位於獨立 LiuLianBot 倉庫；兩邊設定需指向相同 database。

## 建立設定

喺專案根目錄複製[設定範本](config.example.json)。Linux 或 macOS 可用以下指令。

```bash
cp shared/database/config.example.json shared/database/config.json
```

Windows PowerShell：

```powershell
Copy-Item shared\database\config.example.json shared\database\config.json
```

編輯 `config.json` 入面嘅 `mysql` 或 `mysql_config` 物件。`config.json` 包含真實密碼，唔應該
提交到 Git；`config.example.json` 只放安全範例值。

## Python (`discord-part`)

Discord 程式碼透過現有 wrapper 取得連線：

```python
from utils.database import get_db_conn

connection = get_db_conn()
```

## Node.js (`website-part`)

網站由 [MySQL pool](../../website-part/src/db/pool.js) 讀取 `shared/database/config.json`，並喺開始監聽 HTTP 前執行網站遷移。設有 `DB_HOST` 時會改用 `DB_*` 環境變數，須同時填寫 `DB_USER` 同 `DB_NAME`。

## Schema 同 migration 邊界

兩個 runtime 共用同一個 database，但使用不同 migration ledger：

- Discord Bot 使用 `schema_migrations`，啟動時建立 Bot 功能所需嘅 guild log、roller、
  private voice、self-role、活動統計、guild metadata 同 channel metadata，並將
  `website_announcements` 的 status 欄位擴充至可由 dispatcher claim。
- Website 使用 `website_schema_migrations`，啟動時建立 website users、roles、sessions、
  connections、events、Discord link、公告、remote profile 同 page visibility 表。
- `guild_activity_stats`、`discord_guild_metadata`、`discord_guild_channels` 同
  `website_events` 係跨 runtime 共用資料；Bot 寫入 Discord 狀態，Website 讀取及管理
  對應網站功能。

網站遷移 `030` 為 `website_sessions` 新增可留空嘅 `last_active_at`，舊登入會喺下次使用時更新。`website_admin_audit` 保留管理操作嘅操作者、對象、時間同結果。`website_guild_config_pending` 以 guild ID 保存最新待同步語言，寫入節點成功更新 Bot 設定檔後會清除對應記錄。

首次部署時，先建立目標資料庫，並授權網站帳戶建立資料表、加欄位及建立外鍵。全新 database 必須先啟動 Website 一次，再啟動 Bot，因為 Bot 嘅公告
migration 會更新由 Website migration 建立嘅 `website_announcements`。已有兩套
migration ledger 嘅資料庫就可以按任意次序啟動。兩邊 migration 都係 idempotent；
唔需要手動執行 SQL 或共用同一個 migration version table。

Migration `027` 修復使用者外鍵：擴欄前先保存完整定義到
`website_migration_foreign_keys`，中斷重跑可恢復定義；亦會修復舊版中斷後缺少嘅
網站標準外鍵。舊事故如果冇 journal，自訂外鍵嘅原定義無法推回，需按備份人工恢復。
`028` 新增 `website_users.session_version`；改密碼原子更新版本，Session store
會檢查版本，寫入時鎖住帳戶，避免並行請求重新保存舊登入。原有冇版本嘅 Session
只喺帳戶版本仍為 0 時相容。

Clash VPN 使用獨立 `website_clash_users`（migration `022`），同 `website_users` 登入帳號分開。遷移保留舊 ID／訂閱／授權／憑證，將訂閱外鍵改指 VPN 用戶；網站帳號刪除不影響 VPN。VPN 用戶刪除會清除訂閱及授權，但保留 `website_clash_accounts` 供背景 SSH 撤銷。

## 設定格式

loader 接受 `mysql` 或 `mysql_config` 作頂層 key。以下係倉庫採用嘅範本格式。

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

網站 Node.js pool 會將日期序列化同 MySQL Session `time_zone` 固定為 UTC；每條新
連線完成 `SET SESSION time_zone = '+00:00'` 後先會提供畀查詢。網站活動及公告嘅時間輸入由前端轉成
ISO timestamp 後儲存。Discord ID 使用 MySQL `BIGINT`，Node.js 以字串處理大數字，
避免 JavaScript number 精度問題。

## 驗證

資料庫 repository 測試唔需要 live MySQL；可由專案根目錄執行：

```bash
cd website-part
npm run check
```

`config.json` 只可以喺本機或部署環境建立，唔好提交；Bot token、Website
`SESSION_SECRET` 同 database password 都應該使用獨立嘅秘密管理方式保存。
