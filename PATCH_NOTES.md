# Patch notes

## 重整 README 同部署指南（2026-11-28）

- 中英文首頁保留快速啟動步驟，詳細設定、會員操作、整合、遠端工作區、部署同開發測試各有指南。
- Clash VPN 主機安裝獨立成篇，移除實機驗收紀錄；其餘部署說明加入設定範本、相關指南同驗證步驟。

## 清理敏感資料（2026-11-28）

- 部署指南同設定範本改用示例網域，由部署者自行填寫主機、帳戶同憑證。
- 檔案授權畫面以「檔案擁有者」稱呼 `FILES_OWNER_USER_ID` 指定嘅帳戶。移除紀錄入面嘅私人信箱對應同正式環境資料。

## 反向代理同私網連線（2026-11-23 至 2026-11-25）

- 補充來源 HTTPS 憑證、WebSocket 轉送同健康檢查嘅設定，並記錄 OpenWrt 防火牆按來源同目的地限制 Suwayomi 流量嘅做法。

## NetBird 管理整合（2026-11-23）

- 管理員後台新增 NetBird 分頁：節點狀態及設定、網絡 CRUD、資源及 routing peers 管理，支援 Cloud 同自架 HTTPS API。
- API 令牌只存伺服器環境設定；沿用管理員及跨站請求檢查，驗證輸入、限制上游回應大小及等候時間，阻擋重新導向並隱藏上游敏感錯誤。變更寫入管理操作紀錄，刪除須確認。
- 加入中英介面、環境範例、README、API／OpenAPI 合約及後端／介面回歸測試。

- 驗證：語法及正式前端建置通過；558 項測試中 556 項通過，2 項既有 Chromium 整合測試因未安裝瀏覽器跳過。NetBird 12 項後端／介面測試全數通過；未使用正式 NetBird 帳戶或令牌作連線驗收。

## 活動分隊、上傳佇列同帳戶管理（2026-11-22）

- R6 活動可展開最新正選名單、隨機平均分兩隊，再複製名單到 Discord。FnOS 支援逐檔上傳進度、保留上傳目的地同重試失敗項目。
- 會員可查看登入裝置同上次活動時間，單獨登出其他裝置。撤銷登入或重設密碼會關閉各節點上相應嘅 SSH、WebRDP、Chromium 同網站代理連線。
- 管理操作紀錄可按管理員、會員或目標識別碼搜尋，涵蓋密碼重設、群組、會員群組同頁面可見度。
- 遷移 `030` 加入裝置活動時間、管理操作紀錄同待同步公會語言。頻道設定同待同步語言一併提交，寫入節點會重試未完成項目。Docker 寫入節點須可寫入 Bot 設定檔所在目錄。
- 網站代理串流傳送 SSE、檔案同分段下載。網站 Dockerfile 補回 R6 幹員及地圖資料，CI 會喺建置完成嘅映像內檢查三個抽選端點。

## 活動候補同公告核對（2026-11-22）

- 活動額滿時顯示候補人數同個人位置。正選退出會按入隊次序補位，網站、Android 同 Discord 共用同一筆報名紀錄。
- 排程公告同補位私訊使用有憑據嘅發送記錄。管理員可喺 Discord 核對送達結果，再確認送達或重新排程。
- 升級時先停止舊 Bot，啟動網站完成資料庫遷移 `029`，然後啟動配套新版 Bot。

## 管理員重設會員密碼（2026-11-20）

- 管理面板嘅用戶列表支援重設其他會員嘅網站密碼。密碼更新同撤銷該會員所有網站登入會喺同一個資料庫交易完成。

## N100 本機部署及 FnOS 維護提示（2026-11-20）

- 新增 OpenWrt 單機 Compose 配置同共用 MySQL 還原指南，網站與登入資料可放喺 N100 本機 SSD。
- 登入、會員首頁、檔案及分享頁顯示 FnOS 狀態。瀏覽器下載遇到儲存中斷會顯示維護頁。CI 會核對實際建置目錄同新增資源。
- 跨平台測試使用系統原生路徑核對靜態檔案快取，並按作業系統驗證檔案權限。前端文字檔統一使用 LF 換行，令 Windows 同 Linux 嘅建置產物一致。
- 隔離演練已驗證 MySQL 8.4 備份還原、SFTP 離線冷啟動、舊 Session、全新瀏覽器登入及原有分享恢復下載。Node.js 22 配合完整 Chrome 通過全部 526 項測試。

## 程式碼審查修正（2026-10-14）

- 修正兩輪審查共 32 項問題：涵蓋登入與 Session、資料庫遷移、代理 Cookie／子路徑、ZIP 取消、VLESS YAML、SSH/RDP、Chromium 隔離及前端非同步操作。
- ZIP 在掃描、標頭 backpressure 及串流期間取消會關閉 SFTP 並釋放名額；提早或延遲的 SFTP 讀取錯誤均會處理。YAML 拒絕 anchors/aliases，限制節點及合併輸出大小。
- 代理排除實際網站 Session Cookie；衝突名稱按 connection 改名，HTTP 及 WebSocket 101 回應均正確改寫。保留其他 Cookie 名稱以維持上游 JavaScript 相容，修正實際回應的導向與快取標頭。
- Chromium 使用獨立 BrowserContext、專屬 HTTP/CONNECT 出口代理及可取消的開啟流程；HTTP(S)、WebSocket、各類 worker 與新視窗均檢查並固定目的地 IP。Page CDP 自行處理協定限制，避免 Puppeteer 對 worker 發送不支援的 Fetch 指令而卡住。remote CDP 須明確設定代理回連與來源 IP，並驗證禁用非代理 UDP 的 WebRTC policy。停機會先關閉所有遠端及代理連線。
- SSH/RDP 正規化地址、拒絕非規範數字 IP，使用已驗證 IP 連線並核對實際 IP/CIDR 授權；支援明確允許的內網，修正前導零／八進位解析歧義。
- 子路徑代理保留原始 target base，連續／相對導向及跨出 base 的相對 HTML 資源正確路由；Cookie 對應 mounted／upstream-root 路徑，HTTP／WebSocket 登入及登出均保持一致。額外補上非 101 拒絕握手的 Cookie／Location 改寫，避免上游覆寫主站登入。
- Migration 027 保存／恢復完整外鍵定義並補回網站標準外鍵；028 新增 Session 版本。密碼變更保留目前登入、拒絕舊版本讀取／儲存／touch；每條新 DB 連線先完成 UTC 設定，登入限流使用資料庫的帳號 ID。
- 新密碼最多 72 UTF-8 bytes，舊 bcrypt 登入仍相容。前端修正 RDP 設定串寫、SSH 回呼及驗證方式、伺服器設定還原、Chromium 快捷鍵／留白座標、活動錯誤及管理視窗延遲回應；同步中英密碼說明。
- 第二輪前端修正：重新命名綁定來源目錄；分享碼與列表、公會選取與表單原子更新並隔離延遲回應；Chromium 舊 socket／影格回呼不能覆蓋新工作階段，取消的開啟流程會正常結束。
- 更新 README、環境範例、API／資料庫／檔案／remote CDP 部署文件及前端建置產物。瀏覽器主機仍需限制代理協定以外的網路流量；舊事故若無 journal，自訂外鍵須依備份恢復。
- 驗證：522 項測試全數通過、無跳過；語法、前端建置、網站與 RDP 瀏覽器 smoke 均通過。真實 Chromium 驗證 Cookie 隔離、各類 worker／新視窗／WS／WSS 的允許與阻擋、並行 worker 完成及 WebRTC UDP 阻擋；另獨立驗證 TURN TCP 政策與 WebSocket 拒絕握手後主站登入保留。資料庫／SFTP 使用隔離 fixture，未連接正式服務。

## 會員自助建立 Mailu 信箱（2026-10-10）

- 新增網站「郵件」頁面、選單及首頁入口；現有會員可建立一個部署網域嘅信箱，使用獨立密碼登入 Roundcube。
- 後端整合 Mailu API，強制普通帳號、1 GiB 預設配額、會員／條款／頁面權限、CSRF 與跨節點限流；網站不儲存信箱密碼。
- Migration 026 保存固定會員 ID 與唯一信箱對應；MySQL 鎖及隨機建立標記防止重複建立或接管既有帳號，支援逾時重試。
- 更新中英介面、環境範例、README、API 文件與部署指引。私人 API 令牌只存於伺服器環境檔。
- 驗證：JavaScript 檢查、前端建置、419 項測試通過；API 文件更新後相關測試通過。實際跨節點併發建立僅產生一個普通信箱，成功登入 Mailu SSO／Roundcube；測試帳號已清除，未寄出郵件。

## Website repository split (2026-10-06)

- Extract the website, runtime JSON data, API documentation, deployment examples and Node CI into LiuLianWEB.
- Remove website code and Node CI from LiuLianBot; retain Discord/Android and shared contracts. Update both READMEs and Android documentation links.
- Configure external Bot settings using DISCORD_CONFIG_PATH; ignore local integration config and Vite caches. Exclude secrets and installed dependencies; exclude integration credentials from Docker context.
- Validation: standalone JavaScript checks, production build and all 406 tests pass (402 existing plus 4 integration-path tests). Generated frontend/API contents match the extracted source. Bot code is unchanged; Python checks and live MySQL/Discord deployment were not run.
