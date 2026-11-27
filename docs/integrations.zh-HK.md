# 會員信箱、Clash 同 NetBird

[返回首頁](../README_HK.md) · [English](integrations.md)

## 會員信箱

已接受網站條款嘅會員可喺「郵件」（`/mail.html`）揀一個可用名稱，設定 12 至 128 個字元嘅獨立信箱密碼。建立後可用完整電郵地址同該密碼登入 Roundcube。每位會員限開一個信箱，預設配額為 1 GiB，已存在嘅信箱、別名同保留名稱不可申領。

每個網站節點都要使用同一組伺服器設定。請喺私人設定檔填寫 API 令牌，並將範例網域換成自己嘅網域。

```dotenv
MAILU_API_URL=https://mail.example.org/api/v1
MAILU_API_TOKEN=
MAILU_DOMAIN=example.org
MAILU_WEBMAIL_URL=https://mail.example.org/webmail/
MAILU_QUOTA_BYTES=1073741824
```

喺 Mailu 嘅 `mailu.env` 啟用 `API=true` 及設定 `API_TOKEN`，再重建相關容器。API 同網上郵件入口均須使用 HTTPS。會員由網站建立普通信箱，Mailu 公開註冊可保持關閉。令牌只供伺服器使用。

遷移 `026` 會建立 `website_mailboxes` 同郵件頁權限。建立信箱每位會員每小時最多試十次。分散式部署會共用限額，資料庫鎖同名稱預留會處理同時送出嘅申請。如果上游結果未明，使用同一名稱同原先密碼重試。網站會保存信箱地址、建立狀態同核對標記，密碼同郵件內容由 Mailu 管理。

更改網站名稱或密碼唔會同步更改信箱。刪除網站用戶後，信箱管理員仍須按保留安排停用或處理信箱。備份時要包含網站嘅信箱對應表同 Mailu 持久資料。[會員信箱 API](API.md#member-mailboxes)

## Clash VPN 訂閱

喺「管理員後台 → Clash 訂閱管理」用單一 Clash/Mihomo proxy YAML 物件新增節點，毋須填 `name`。傳輸同 TLS 設定要符合 VPN 伺服器。支援 SS、VMess、VLESS、Trojan、Hysteria2、TUIC、SOCKS5 同 HTTP。

1. 建立獨立 VPN 用戶，指定獲授權嘅節點同到期時間（UTC+8）。移除 VPN 用戶會即時停用訂閱、清除授權，並排隊撤銷受管理帳戶。
2. 規則集可選全部走 VPN、區域網絡直連、中國直連、中國直連加廣告封鎖，或者自訂路由 YAML。用戶端下次重新整理時會套用變更，網址同節點授權會保留。LAN 規則直接包含喺設定，相容用戶端每 24 小時下載中國同廣告規則。[規則來源](https://github.com/Loyalsoldier/clash-rules)
3. 自訂規則可編輯 `rules` 同選填嘅 HTTPS `rule-providers`，策略可用 `VPN`、`DIRECT` 同 `REJECT`。未有最後匹配規則時會加入 `MATCH,VPN`。快取路徑由系統產生，切換預設會保留自訂草稿。[支援語法](API.md#clash-vpn-subscriptions)

以 HTTPS 轉送 `/clash-sub-public/<token>.yaml`，停用代理快取，並避免記錄完整網址。網站從 MySQL 即時產生 YAML，原有 `/clash-sub/<token>.yaml` 連結亦可使用。未知、已停用或到期嘅網址會回傳 404，冇可用授權節點則回傳 403。管理員可喺後台停用訂閱或重設網址。

SSH 管理節點會建立個別憑證。網站負責背景同步同重試，VPN 主機嘅 timer 會喺網站停機期間按期撤銷帳戶。設定變更可能重啟 VPN 服務並中斷現有連線。未受管理嘅節點只限制下載訂閱。曾分發嘅共用憑證要喺 VPN 主機另行輪替。[SSH 設定、支援引擎同撤銷流程](../website-part/deploy/clash-vps/README.md)

遷移 `020` 至 `024` 會建立節點、訂閱、授權同加密帳戶，分開 VPN 用戶同網站帳戶，並加入規則設定。原有 ID、連結同授權會保留，刪除網站會員亦唔會刪除獨立 VPN 帳戶。

## NetBird

喺 **管理員後台 → NetBird** 可查看節點在線狀態、IP、版本及上次連線，修改節點名稱、NetBird SSH、登入／閒置有效期及 Cloud 核准狀態，或移除節點。網絡支援新增、編輯、刪除，以及管理網絡資源（IP、CIDR 或網域）同 routing peers（單一節點或 NetBird 群組、metric、masquerade 及啟用狀態）。刪除前會確認；操作結果會記入管理操作紀錄。

喺 `website-part/.env` 填入管理 API 位址同私人令牌。

```dotenv
NETBIRD_API_URL=https://api.netbird.io/api
NETBIRD_API_TOKEN=
```

自架 NetBird 請改用管理伺服器嘅 HTTPS API URL，須以 `/api` 結尾。使用具備節點及網絡管理權限嘅 service user Personal Access Token（唔係 setup key），設定後重新啟動網站；多節點部署需每個網站節點都設定。留空令牌會停用整合，其他網站功能照常運作。令牌只留喺伺服器環境檔，唔好加入 `VITE_*`、前端或 Git。

新 peer 仍需透過 NetBird 客戶端加入；NetBird 群組及存取政策請先喺 NetBird Dashboard 設定，再於此後台選取現有群組。此功能使用 Networks API，自架版本須提供 `/api/networks`。網站只管理 NetBird 設定；要經私人網絡連接服務，網站主機仍須有相應網絡路由。API 逾時時請先重新整理核對結果，避免重複新增。

詳見 [NetBird API 合約](API.md#netbird-administration)、官方 [驗證方式](https://docs.netbird.io/api/guides/authentication)、[Peers](https://docs.netbird.io/api/resources/peers) 同 [Networks](https://docs.netbird.io/api/resources/networks)。
