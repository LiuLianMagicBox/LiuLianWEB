# VPN 主機安裝同到期清理

[網站主機設定同後台驗證](README.md)

## 安裝工具同設定 target

VPN 主機需要 Node.js 18 或更新版本、npm、`flock` 同對應嘅 VPN 程式。將 `website-part/deploy/clash-vps/` 複製到 VPN 主機嘅 `/opt/liulian-vpn`，以 root 身分完成共用步驟，再選擇適用嘅 systemd 或 procd 設定。網站同步程序喺網站主機運行。

```sh
cd /opt/liulian-vpn
npm ci --omit=dev
install -d -m 700 /etc/liulian-vpn /var/lib/liulian-vpn
install -d /usr/local/libexec
install -m 755 liulian-vpn-sync /usr/local/libexec/liulian-vpn-sync
```

確保 `/opt/liulian-vpn`、工具、依賴、`/etc/liulian-vpn` 及狀態目錄均由 root 擁有，SSH 帳戶沒有寫入權限。wrapper 預設 Node 路徑是 `/usr/bin/node`；若不同，請按 VPS 實際路徑調整。wrapper 透過 `flock` 序列化 SSH 與本機到期清理，避免同時修改設定。

把 [targets.example.json](targets.example.json) 複製到 `/etc/liulian-vpn/targets.json`（root 擁有、權限 `600`）。填入真實引擎、設定檔、binary、systemd service 及 inbound tag。`owner_prefix` 必須對應後台節點 ID，例如 ID 12 就是 `llb-s12-`。範例路徑及服務名稱須按實際安裝修改；工具不會猜測或搜尋設定檔。

VPN 設定檔須是 root 擁有的普通檔案，禁止符號連結及群組／其他人寫入。sing-box／Xray 設定須是單一 JSON 檔，入站 tag 必須唯一；不支援由管理面板或目錄合併生成的設定。

sing-box 入站須已有 `users` 陣列。SS2022 須使用 `2022-blake3-aes-128-gcm` 或 `2022-blake3-aes-256-gcm`，不使用 SSM API／relay，且後台代理 YAML 的 cipher 與伺服器主密碼必須吻合；用戶訂閱會自動使用 `伺服器主密碼:個別用戶密碼`。

獨立 Hysteria2 須先改為多用戶驗證，例如：

```yaml
auth:
  type: userpass
  userpass:
    admin: <保留的管理者密碼>
```

工具不會自動把單密碼模式轉為多用戶，也不會改 TLS、Reality、路由、監聽埠等設定。若沒有其他帳戶，會保留一個無法取得憑證的停用帳戶，避免空帳戶清單觸發共用密碼回退。

SSH 帳戶需能免密碼 sudo 執行指定工具。可用 `visudo` 加入僅允許**不帶參數**的規則（替換帳戶名稱）：

```sudoers
vpn-manager ALL=(root) NOPASSWD: /usr/local/libexec/liulian-vpn-sync ""
```

## Mihomo listener

使用 `engine: "mihomo"`，設定檔為單一 YAML；`inbound_tag` 對應 listener 的唯一 `name`。Hysteria2 使用 `users` 對照表，VLESS 使用含 `username`／`uuid`／可選 `flow` 的 `users` 陣列。Hysteria2 的用戶名不參與認證，profile 使用 `standard`，訂閱只提供個別密碼。工具會先以 `mihomo -t -d <設定目錄> -f <候選設定>` 驗證，再套用；TLS／Reality／路由及其他命名空間帳戶保留。

Mihomo v1.19.32 的 Shadowsocks listener 僅接受共享 `password`，不支援本工具需要的獨立 `users`；不得把此 SS2022 listener 標為已支援個別撤銷。若需要 SS2022 個別帳戶，須另行遷移到支援多用戶的引擎與新節點；此工具不自動遷移或輪替現有共享憑證。參考 [Mihomo Hysteria2](https://wiki.metacubex.one/config/inbound/listeners/hysteria2/)、[VLESS](https://wiki.metacubex.one/config/inbound/listeners/vless/)、[v1.19.32 Shadowsocks 原始碼](https://github.com/MetaCubeX/mihomo/blob/v1.19.32/listener/inbound/shadowsocks.go)。

## systemd

```sh
cd /opt/liulian-vpn
install -m 644 liulian-vpn-expire.service liulian-vpn-expire.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now liulian-vpn-expire.timer
systemctl status liulian-vpn-expire.timer
```

## OpenWrt／procd

完成共用安裝後，使用 procd 啟用本機到期清理。

```sh
install -m 755 /opt/liulian-vpn/liulian-vpn-expire.procd /etc/init.d/liulian-vpn-expire
/etc/init.d/liulian-vpn-expire enable
/etc/init.d/liulian-vpn-expire start
/etc/init.d/liulian-vpn-expire running
```

VPN target 設定 `service_manager: "procd"`、`service: "mihomo"`（對應 `/etc/init.d/mihomo`）。VPN init script 必須由 procd 管理並支援 `running`；工具會在 restart 後檢查狀態，失敗則還原設定並使用同一服務管理器重新啟動。到期服務立即清理一次，之後每 60 秒執行，前一次未完成時不重疊。相關服務與檔案必須由 root 擁有且不可由其他帳戶寫入。參考 [OpenWrt procd init scripts](https://openwrt.org/docs/guide-developer/procd-init-scripts)。

工具只在 systemd timer 或 OpenWrt 到期清理服務運作時接受網站的同步請求。`targets.json` 為空時，清理成功只代表沒有待處理目標，不能證明用戶帳戶已啟用或能撤銷。請讓 VPS 與網站使用 NTP 校時；撤銷是週期性執行，不保證精確到秒。

完成後，按[後台啟用與驗證](README.md#3-後台啟用與驗證)檢查短期帳戶嘅建立同到期撤銷。
