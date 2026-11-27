# Shared Database Config

此資料夾提供網站 MySQL 設定。Discord Bot 位於獨立 LiuLianBot 倉庫；兩邊設定需指向相同 database。

## 建立設定

Linux/macOS：

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

網站由 `src/db/pool.js` 載入同一份 `shared/database/config.json`，並喺
server listen 前執行 website schema migrations。毋須喺 `.env` 重複設定 MySQL。

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

首次部署時，先確保 MySQL 帳戶有建立 database、建立表、加欄位及建立 foreign key
所需權限。全新 database 必須先啟動 Website 一次，再啟動 Bot，因為 Bot 嘅公告
migration 會更新由 Website migration 建立嘅 `website_announcements`。已有兩套
migration ledger 嘅資料庫就可以按任意次序啟動。兩邊 migration 都係 idempotent；
唔需要手動執行 SQL 或共用同一個 migration version table。

## 設定格式

loader 同時接受以下兩種 root key，現有範本使用 `mysql_config`：

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

Migration `027` 修復使用者外鍵：擴欄前先保存完整定義到
`website_migration_foreign_keys`，中斷重跑可恢復定義；亦會修復舊版中斷後缺少嘅
網站標準外鍵。舊事故如果冇 journal，自訂外鍵嘅原定義無法推回，需按備份人工恢復。
`028` 新增 `website_users.session_version`；改密碼原子更新版本，Session store
會檢查版本，寫入時鎖住帳戶，避免並行請求重新保存舊登入。原有冇版本嘅 Session
只喺帳戶版本仍為 0 時相容。

## 驗證

資料庫 repository 測試唔需要 live MySQL；可由專案根目錄執行：

```bash
cd website-part
npm run check
```

`config.json` 只可以喺本機或部署環境建立，唔好提交；Bot token、Website
`SESSION_SECRET` 同 database password 都應該使用獨立嘅秘密管理方式保存。

Clash VPN 使用獨立 `website_clash_users`（migration `022`），同 `website_users` 登入帳號分開。遷移保留舊 ID／訂閱／授權／憑證，將訂閱外鍵改指 VPN 用戶；網站帳號刪除不影響 VPN。VPN 用戶刪除會清除訂閱及授權，但保留 `website_clash_accounts` 供背景 SSH 撤銷。
