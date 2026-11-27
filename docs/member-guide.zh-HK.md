# 會員同管理員指南

[返回首頁](../README_HK.md) · [English](member-guide.md)

## 帳戶同導覽

喺 `/login.html` 註冊帳戶。登入後，首頁會顯示即將舉行嘅活動、你嘅報名、已連結網站同可用工具。「帳戶設定 → 我的登入裝置」會列出每次登入嘅瀏覽器、作業系統同上次活動時間。你可以認出目前裝置，亦可以登出其他裝置。各網站節點每兩秒核對已開啟嘅 SSH、WebRDP、Chromium 同網站代理連線。

管理員可喺後台設定用戶、群組同網站連線授權，每個會員可以加入多個群組。「用戶 → 重設密碼」可為其他會員設定新密碼，並登出該會員所有裝置。更改自己嘅密碼請用「帳戶設定」。「管理操作紀錄」會記錄重設密碼、群組同頁面可見度變更，可按完整用戶名稱、操作者或對象 ID、群組 ID 或頁面識別碼搜尋時間同結果。

| 存取對象 | 頁面 |
| --- | --- |
| 公開入口 | `login.html`、`terms.html`、`share.html`、`404.html`。`roller.html` 會套用抽選頁嘅可見度設定。 |
| 會員 | `index.html`、`account.html`、`events.html`、`mail.html`、`files.html`、`guild-manager.html` |
| 工作區 | `remote.html`、`chromium.html`、`vless-tunnel.html`。遠端存取亦需要相應群組權限。 |
| 管理員 | `admin.html` |

「管理員後台 → 頁面可見度」控制可設定頁面嘅對象，以及側欄同首頁嘅連結。各功能亦會核對本身嘅權限。獲授權嘅用戶可以經 `/connect/<slug>/` 直接開啟已隱藏嘅網站連線。代理支援 HTTP、WebSocket、即時事件、檔案同分段下載。[API 同 WebSocket 參考](API.md)

## Discord 帳戶、活動同公會

1. 喺「帳戶」產生連結碼，再喺 Discord 執行 `>link <code>`。每個代碼只可以用一次，十分鐘後失效。
2. 已連結 Discord 嘅管理員可喺「活動」填入伺服器 ID、開始時間同人數上限建立活動。會員可喺網站報名，或喺 Discord 使用 `>events`、`>eventjoin <event_id>` 同 `>eventleave <event_id>`。兩邊共用同一份名單。
3. 活動額滿後會顯示候補位置，有空缺時按次序補位。已連結嘅會員可收到 Bot 私訊。「正選名單 → 隨機分成兩隊」會讀取最新正選名單，分隊後可將兩份名單複製到 Discord。Bot 亦支援 `>eventteams <event_id>`。

「管理 → Discord 伺服器」只列出該 Discord 帳戶擁有或獲授權管理嘅公會，包括已設定嘅 Bot 管理員。可在此更改 Bot 語言、臨時私人語音觸發頻道、預設記錄頻道同分類頻道。語言未能即時寫入時，指定節點每 30 秒重試。

Discord 指令 `/setlogchannel <分類> <頻道>` 支援 `all`、`useraction`、`voiceaction`、`groupaction`、`messageaction`、`channelaction` 同 `roleaction`。未指定分類頻道嘅事件會送到 `all`。會員可用 `>roles` 同 `>role <role_id>` 選擇開放嘅身分組。管理員可喺「公告」核對送達狀態未明嘅項目，再確認或重新排程。[Bot 同網站功能運作導覽](FEATURE_WALKTHROUGH.zh-TW.md)

## FnOS 檔案同分享

`FILES_OWNER_USER_ID` 指定嘅帳戶係檔案擁有者。其他會員可喺 `/files.html` 申請存取，由擁有者授予讀取權限，再按需要加入寫入或分享權限。一般網站管理員亦需要獲授權，帳戶改名會保留原有擁有權。

- 瀏覽 `/vol*/1000` 下嘅 FnOS 磁碟。每列顯示磁碟、類型同可用時間資料。未有建立時間會顯示橫線。
- 可以一次排隊上傳多個檔案，逐個睇進度。切換資料夾會保留每個檔案嘅目的地。「重試上傳失敗嘅檔案」只會重試失敗項目。每個檔案上限係 1 GiB，檔名要同現有檔案不同。
- 分享碼可喺 `/share.html` 提供 1 至 168 小時嘅免登入唯讀存取。分享碼只顯示一次，資料庫保存 SHA-256 雜湊，網址透過 fragment 傳遞分享碼。資料夾之後新增嘅檔案都會包含在內，直至到期或撤銷。
- 可將所選項目或整個分享資料夾串流成 ZIP。上限係 50 個選取項目、2,000 個項目同 4 GiB 未壓縮資料。下載只可存取授權路徑，符號連結同裝置檔案會被拒絕。

SFTP 停機期間，只要 MySQL 正常，會員仍可登入。檔案同分享頁會顯示儲存服務狀態。[檔案操作、遷移同 SFTP 設定](file-browser.md) · [OpenWrt 還原指南](../website-part/deploy/openwrt/README.md)

## 網站語言

喺頂部列、登入頁或分享頁選擇 English、繁體中文（香港）或简体中文。首次開啟會按瀏覽器偏好選擇語言。`zh-CN`、`zh-SG` 同 `zh-Hans` 會用簡體中文，其他中文偏好會用香港繁體，未有支援嘅語言會回落至英文。手動選擇會以 `liulianbot.locale` 儲存喺 localStorage。瀏覽器阻擋儲存時，選擇仍會喺目前頁面生效。

介面文字、讀屏器標籤、通知同活動日期格式會跟隨選擇。用戶內容同法律文件保留原文。Bot 語言由各公會自行設定。[信箱同管理員整合](integrations.zh-HK.md) · [遠端工作區](remote-access.zh-HK.md)
