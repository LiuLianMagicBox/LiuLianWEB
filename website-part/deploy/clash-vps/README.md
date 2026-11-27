# SSH VPN 帳戶管理與自動撤銷

[部署指南](../../../docs/deployment.zh-HK.md#部署範例) · [Clash 訂閱管理](../../../docs/integrations.zh-HK.md#clash-vpn-訂閱)

網站會每 30 秒啟動一次同步：為每位授權用戶建立獨立憑證，並撤銷到期、停用、失去節點授權或已刪除用戶的帳戶。VPS 端每分鐘檢查到期時間，所以網站停止運作時，已同步的帳戶仍會到期撤銷。同步可能因 SSH／服務故障延遲；失敗會重試，後台可查看狀態及手動同步。

支援混合節點：獨立 Hysteria2 使用 `auth.type: userpass`；sing-box 管理 VLESS、VMess、Trojan、Hysteria2 與 SS2022 AES 多用戶入站；Xray 管理 VLESS、VMess 與 Trojan；Mihomo 管理 Hysteria2 與 VLESS（包括 Reality）。單一共用密碼／UUID 無法個別撤銷；啟用管理前，請自行輪替或移除曾經分發的共用憑證。工具保留不屬於 `llb-s<節點ID>-` 命名空間的帳戶。

格式依據：[Hysteria2 userpass](https://v2.hysteria.network/docs/advanced/Full-Server-Config/)、[sing-box Hysteria2](https://sing-box.sagernet.org/configuration/inbound/hysteria2/)、[sing-box SS2022 多用戶](https://sing-box.sagernet.org/configuration/inbound/shadowsocks/)、[Xray VLESS clients](https://xtls.github.io/en/config/inbounds/vless.html)。此版本不直接管理 shadowsocks-rust／libev；該類節點可繼續作未管理節點。

VPN 用戶使用獨立資料表，不需建立網站帳號。Migration `022` 保留現有 ID、訂閱網址、授權與憑證；網站帳號刪除不再影響 VPN 訂閱。

## 1. 網站主機設定

將 [ssh-profiles.example.json](ssh-profiles.example.json) 複製到網站使用者可讀取、repository 外的 `/etc/liulianbot/clash-ssh-profiles.json`，填入真實 SSH host、username、私鑰路徑、host key SHA256 **64 位十六進位**雜湊，以及 VPS target 名稱。`credential_style` 對獨立 Hysteria2 必須為 `hysteria2-userpass`；sing-box／Xray／Mihomo 使用 `standard`。每個節點使用不同 target，且 target 只對應一個入站。

私鑰可加上 SSH forced command 與 `restrict` 限制；若使用密碼，改填 `password_env`（例如 `CLASH_VPS_PASSWORD`），將實際密碼放在網站環境變數。不要把 SSH 私鑰、密碼、實際設定檔或加密金鑰提交到 Git。

網站 `.env` 設定：

```dotenv
CLASH_SSH_PROFILES_FILE=/etc/liulianbot/clash-ssh-profiles.json
CLASH_CREDENTIAL_ENCRYPTION_KEY=
```

喺私人環境檔填入用 `openssl rand -base64 32` 產生嘅金鑰，並做好備份；更換金鑰會使既有帳戶憑證無法解密。網站啟動自動執行 migration `021`／`022`。SSH 設定內容只在伺服器端讀取，後台只顯示 profile 名稱。帳戶憑證在資料庫使用 AES-256-GCM 加密。

## 2. VPS 安裝工具

將工具同 [target 範本](targets.example.json)放到每部 VPN 主機，再按主機使用嘅服務管理器啟用到期清理。完成後，返到本頁喺網站後台測試同步。

<a name="openwrtprocd-vpn-主機"></a><a name="mihomo-listener"></a>

[共用安裝及 SSH 權限](vpn-host.md#安裝工具同設定-target) · [systemd](vpn-host.md#systemd) · [OpenWrt／procd](vpn-host.md#openwrtprocd) · [Mihomo listener](vpn-host.md#mihomo-listener)

## 3. 後台啟用與驗證

1. 先建立 VPN 節點，取得 ID；設定 VPS target 的 `owner_prefix`。
2. 在節點的「SSH 管理設定」選擇對應 profile，儲存後按「立即同步」。
3. 在 VPN 用戶列表按「新增」，輸入獨立 VPN 用戶名稱、到期時間與可用節點；同步成功前，不會在訂閱中提供新的個別憑證。
4. 在「SSH 同步」確認 `ready`、上次同步時間。失敗顯示 `error` 並自動重試，不會回退到共用憑證。
5. 用測試用戶驗證訂閱及 VPN 連線，設定短期到期時間，再確認下載停止、該帳戶從 VPS 移除；也可暫停網站，確認 VPS timer 仍能清理。

管理 profile、協定、主密碼及監聽埠在啟用後不能修改，避免遺失舊伺服器上的撤銷目標；改用新節點。刪除節點會保留撤銷紀錄，直到 SSH 已移除該節點管理的帳戶。SSH 同步紀錄只顯示固定錯誤訊息，不含密碼或私鑰。

修改帳戶清單時會驗證 sing-box／Xray／Mihomo 設定，再以同目錄原子寫入套用，重新啟動對應服務並確認服務仍運作；啟動失敗會還原原設定及嘗試啟動。獨立 Hysteria2 做結構驗證及啟動回滾，不假設它提供 config-check 指令。重新啟動會斷開同服務的既有連線，其他帳戶可以重新連線。

VPS 的待套用請求與最後成功帳戶／到期時間均以 `600` 權限保存；即使工具中途停止，下次 timer 仍會重試。新設定失敗時仍會嘗試清理最後成功設定的到期帳戶。設定備份位於原檔案旁的 `.llb-backup`，同樣包含機密資料。

systemd 主機可用 `journalctl -u liulian-vpn-expire.service` 查看清理結果。以短期測試帳戶確認實際同步同撤銷，並核對其他帳戶可重新連線。
