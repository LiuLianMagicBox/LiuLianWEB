# Remote workspaces

[Project home](../README.md) · [繁體中文（香港）](remote-access.zh-HK.md)

## SSH and WebRDP access

Members need to accept the website terms and belong to an allowed group before using the Remote page. The default group is `admin`. Use `REMOTE_SSH_ENABLED` and `REMOTE_RDP_ENABLED` to disable a feature for everyone. SSH uses the `/api/ssh` WebSocket endpoint. The in-browser RDP client connects over Socket.IO and the page can also generate RDP files.

Set the allowed groups and destinations in `website-part/.env`. Replace the example hosts and networks with ones the website should reach.

```dotenv
REMOTE_ALLOWED_GROUPS=admin,server-operator
SSH_ALLOWED_HOSTS=server.example.com,192.0.2.0/24
RDP_ALLOWED_HOSTS=192.0.2.0/24
```

Both protocols validate the resolved address, including IPv4-mapped IPv6. An empty host list permits public destinations only. With entries configured, a destination must match an allowed hostname, IP or IPv4 CIDR. Restart the website after changing the environment.

For encrypted server-side SSH and RDP profiles, generate a key with `openssl rand -base64 32`. Save it privately as `REMOTE_CREDENTIAL_ENCRYPTION_KEY` and back it up. Existing profiles depend on the original key. Browser-local profiles are available without a server key and are suitable only on trusted devices. SSH passwords are never saved.

## Using the RDP desktop

The RDP page uses `frontend/src/lib/rdp/rdpClient.mjs` for connection state,
`rdpInput.mjs` for focused keyboard/pointer input, and `rdpBitmap.mjs` for
bitmap conversion. The old bundled `webrdp.js` client has been removed;
the RLE decoder and its attribution remain under
`frontend/static/vendor/webrdp/` and are copied to `public/vendor/webrdp/`.

Click the desktop to direct keyboard input to Windows. Moving focus to a
form or another window releases held keys. Fit-to-window mode rescales
pointer coordinates; switching to original size changes only the display
scale, not the remote desktop resolution. A dropped connection requires an
explicit reconnect and a new password entry. Passwords are cleared from the
form after connecting. Named database profiles may retain encrypted passwords;
use Load profile to restore one for another connection.

The bridge allows one RDP attempt per Socket.IO connection, reloads the login
session before connecting, and connects to the IP returned by destination
validation. Server connection attempts time out after 30 seconds; the browser
has a 35-second overall deadline. Cancelling, failing, or shutting down also
destroys pending RDP TCP sockets.

If the RDP page reports missing client assets, request `/vendor/socket.io.min.js`, `/vendor/webrdp/rle.js` and `/css/style.css` from the deployed site. All three should return HTTP 200. The client itself is in `/assets/`. If the browser reports that CSP blocked `eval`, deploy the rebuilt decoder from `public/vendor/webrdp/rle.js` and reload the page. [Browser verification](development.md#browser-tests)

### Named RDP profiles

The Remote page supports named RDP connections with host, port, username,
domain and an optional password. Select **New**, enter a name and connection
details, then **Save**. Select a saved entry or use **Load profile** to restore
its credentials. Saving an existing entry updates only that entry; a blank
password preserves its saved password. Deleting an entry removes only that
profile. Saving a password does not start a remote session.

Profiles are stored in `website_rdp_profiles`, with every operation scoped to
the signed-in user's ID. Migration `016` creates the table automatically on
website startup. Names are list metadata; connection details and passwords
are encrypted using the existing `REMOTE_CREDENTIAL_ENCRYPTION_KEY`.
Set this to a stable Base64-encoded 32-byte key before enabling storage,
keep it outside version control, and retain it across deployments.
Without the key, connection functionality remains available but profile
storage is disabled with a setup message. Existing remote-access permissions
continue to apply.

Legacy single profiles are not deleted. When present, the page loads their
details into a new entry named "舊版 RDP 設定" for explicit saving. Named
profiles are loaded on selection; their passwords are not exposed in the
profile list response or stored in localStorage.

## Chromium workspace

The Chromium page uses Puppeteer with Chrome DevTools Protocol (CDP) screencasting. The website server launches a headless Chrome/Chromium process, sends JPEG screencast frames over an authenticated WebSocket, and forwards browser input events back through CDP. Install Chrome or Chromium on the server; set `CHROME_EXECUTABLE_PATH` when the executable is not on `PATH`. On OpenWrt, where Chromium may not be available in the configured feed, set `CHROME_CDP_URL` to a Chrome DevTools endpoint on another machine instead. Each session owns an isolated BrowserContext, so cookies and localStorage are not shared with other users or retained after closing. The context and website CDP connection close when the WebSocket ends, expires or is replaced; an externally managed Chrome process keeps running. Administrators can still use Admin > Page Visibility to decide which users or groups can see the Chromium page.

Each BrowserContext uses its own HTTP/CONNECT proxy for HTTP(S) and WebSocket
traffic, including redirects, frames, dedicated/shared/service workers and popups.
The proxy validates DNS results and connects to the approved IP, so Chrome cannot
resolve the target again to bypass that decision. Private destinations require a
hostname/IP in `CHROMIUM_ALLOWED_HOSTS`. Closing the session closes its proxy and
all proxy connections too.

For a non-loopback `CHROME_CDP_URL`, explicitly set all three
`CHROMIUM_PROXY_*` settings. The advertised address and dynamically allocated TCP
port must be reachable from Chrome; permit inbound traffic only from the listed
Chrome IPs. In containers, use a routed private container network or another
deployment arrangement that exposes those listener ports to Chrome; forwarding
only the website HTTP port is insufficient. Missing configuration fails closed.
A loopback CDP tunnel to another machine also needs a proxy address and ports
reachable from that machine.
Launch remote Chrome with `--enable-automation` and
`--webrtc-ip-handling-policy=disable_non_proxied_udp`; the website verifies
the latter flag before opening a context. Local launches set this policy
automatically. Keep browser hosts on a restricted network with outbound firewall
rules as a boundary for traffic outside the supported proxy protocols.

## Interim VLESS Tunnel

Set `VLESS_TUNNEL_ADDRESS`, `VLESS_TUNNEL_UUID`, and the listener transport
settings in `website-part/.env`. An Xray/V2Ray VLESS listener must already be
running at that address and route traffic to the web server's internal network;
the website only generates client configuration and does not implement the
VLESS protocol or change firewall rules. Signed-in users can paste existing
`vless://` addresses or Clash/Mihomo YAML into **VLESS Tunnel**. Generation
preserves the original nodes and adds the interim node to the displayed output.
For Reality, set `VLESS_TUNNEL_SECURITY=reality`,
`VLESS_TUNNEL_REALITY_PUBLIC_KEY`, `VLESS_TUNNEL_REALITY_SHORT_ID`, and optionally
`VLESS_TUNNEL_CLIENT_FINGERPRINT=chrome`. The generated VLESS URI uses `pbk`,
`sid`, and `fp`; Clash/Mihomo output uses `reality-opts` and
`client-fingerprint`. Original configuration is saved only in browser `localStorage`, never in the
website database. The displayed TTL is an expiry hint; actual post-expiry
rejection requires the VLESS listener or an external provisioner to enforce
credential/UUID expiry. Page Visibility can restrict access to the page.

Clash YAML input rejects anchors and aliases, limits parsed nodes to 5000 and
limits merged output to 256 KiB. Plain YAML configurations remain supported.
