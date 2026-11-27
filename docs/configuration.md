# Website configuration

[Project home](../README.md) · [繁體中文（香港）](configuration.zh-HK.md)

Copy the [website environment template](../website-part/.env.example) to `website-part/.env` on the host. The tables show template values or feature defaults. MySQL can also be configured with the [JSON template](../shared/database/config.example.json).

## Website and sessions

| Variable | Template / default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | `development` | Set to `production` for deployment; production requires `SESSION_SECRET` and secure cookies. |
| `PORT` | `3000` | HTTP listen port. |
| `BIND_IP` | `127.0.0.1` | The template binds to loopback. Without a bind address, Node listens on available interfaces. |
| `TRUST_PROXY` | `1` | Trusted proxy hops or IP/CIDR list. Match the path to the app. A value of `0` disables proxy trust. |
| `SESSION_COOKIE_NAME` | `connect.sid` | Session cookie name. |
| `SESSION_SECRET` | Required | Random secret of at least 32 characters used to sign sessions in every environment. |
| `TERMS_OF_SERVICE_REQUIRED` | `true` | Set to `false` only when the hoster does not require explicit Terms of Service and data-storage consent. |
| `PROXY_ALLOW_SELF_SIGNED` | `false` | Set to `true` only when an upstream website intentionally uses a self-signed certificate. |

## Database and guild settings

| Variable | Template / default | Purpose |
| --- | --- | --- |
| `DB_HOST` | Empty | Setting this selects environment-based database configuration in place of the JSON file. |
| `DB_PORT` | `3306` | MySQL port when using `DB_HOST`. |
| `DB_USER` | Empty | Required when `DB_HOST` is set. |
| `DB_PASSWORD` | Empty | Password for the database account. |
| `DB_NAME` | Empty | Required when `DB_HOST` is set. |
| `DB_SSL_CA_FILE` | Empty | Readable CA certificate file for verified MySQL TLS. |
| `DISTRIBUTED_DEPLOYMENT` | `false` | Set to `true` on each regional node to share login rate limits in MySQL. |
| `DISCORD_CONFIG_PATH` | Empty | Path to the bot configuration. The fallback is `shared/discord/config.json`. Guild management needs the bot settings. |
| `GUILD_CONFIG_WRITER` | `false` | In distributed mode, set `true` on the single node that can write the bot configuration directory. |

## SSH and WebRDP

| Variable | Template / default | Purpose |
| --- | --- | --- |
| `REMOTE_ALLOWED_GROUPS` | `admin` | Website groups allowed to use the SSH/RDP page and APIs. |
| `REMOTE_SSH_ENABLED` | `true` | Set to `false` to disable SSH for all users, including administrators. |
| `REMOTE_RDP_ENABLED` | `true` | Set to `false` to disable RDP for all users, including administrators. |
| `SSH_ALLOWED_HOSTS` | Empty | Comma-separated SSH hosts or IPv4 CIDRs. An empty list permits public destinations; private destinations require an explicit match. Numeric IPv4 must use canonical dotted decimal notation; the actual connection IP is checked against IP/CIDR grants. |
| `RDP_ALLOWED_HOSTS` | Empty | Comma-separated hostnames, IPs or IPv4 CIDRs. Empty permits public targets only. A configured list restricts all destinations to matching entries. |
| `REMOTE_CREDENTIAL_ENCRYPTION_KEY` | Empty | Base64-encoded 32-byte AES-256-GCM key for server-side SSH/RDP profile storage. |

## Chromium

| Variable | Template / default | Purpose |
| --- | --- | --- |
| `CHROME_EXECUTABLE_PATH` | Empty | Optional path to the Chrome/Chromium executable when it is not available on `PATH`. |
| `CHROME_CDP_URL` | Empty | Optional remote Chrome DevTools endpoint, such as `http://browser.example.org:9222`; when set, the website connects to that Chrome instead of launching one locally. |
| `CHROMIUM_ALLOWED_HOSTS` | Empty | Comma-separated hostnames or IPs explicitly permitted to reach private destinations in Chromium. The session proxy checks and pins destinations for HTTP(S) and WebSocket traffic, including workers and popups. |
| `CHROMIUM_PROXY_BIND_HOST` | `127.0.0.1` | Session proxy listener address; set explicitly for a remote CDP host. |
| `CHROMIUM_PROXY_ADVERTISED_HOST` | `127.0.0.1` | Proxy hostname/IP reachable from Chrome; required explicitly for a non-loopback CDP endpoint. |
| `CHROMIUM_PROXY_ALLOWED_CLIENT_IPS` | Loopback | Comma-separated exact Chrome source IPs permitted to use the proxy; required explicitly for a non-loopback CDP endpoint. |
| `CHROMIUM_SESSION_TIMEOUT_MS` | `1800000` | Maximum lifetime of one Chromium WebSocket session in milliseconds. |

## VLESS

| Variable | Template / default | Purpose |
| --- | --- | --- |
| `VLESS_TUNNEL_ADDRESS` | empty | Public host/address of the interim VLESS listener; generation is unavailable when empty. |
| `VLESS_TUNNEL_PORT` | `443` | Interim VLESS listener port. |
| `VLESS_TUNNEL_UUID` | empty | UUID configured on the Xray/V2Ray listener. |
| `VLESS_TUNNEL_NETWORK` | `tcp` | Transport: `tcp`, `ws`, or `grpc`. |
| `VLESS_TUNNEL_SECURITY` | `tls` | Security: `tls`, `reality`, or `none`. |
| `VLESS_TUNNEL_REALITY_PUBLIC_KEY` | empty | Reality public key; required when security is `reality`. |
| `VLESS_TUNNEL_REALITY_SHORT_ID` | empty | Reality short ID; required when security is `reality`. |
| `VLESS_TUNNEL_CLIENT_FINGERPRINT` | `chrome` | Reality client fingerprint. |
| `VLESS_TUNNEL_SNI` | `VLESS_TUNNEL_ADDRESS` | TLS SNI/server name. |
| `VLESS_TUNNEL_PATH` | `/` | WebSocket path or gRPC service name. |
| `VLESS_TUNNEL_HOST` | empty | Optional WebSocket Host header. |
| `VLESS_TUNNEL_FLOW` | empty | Optional VLESS flow, such as `xtls-rprx-vision`. |
| `VLESS_TUNNEL_REMARK` | `LiuLianBot interim internal tunnel` | Node name shown in generated output. |
| `VLESS_TUNNEL_INTERNAL_TARGET` | `web server internal network` | Target description shown on the page; routing is performed by the VLESS listener. |
| `VLESS_TUNNEL_TTL_SECONDS` | `3600` | Lifetime shown for generated output, clamped to 60 seconds-24 hours. |
| `VLESS_TUNNEL_ALLOW_INSECURE` | `false` | Whether generated clients skip TLS certificate verification. |

## FnOS files

| Variable | Template / default | Purpose |
| --- | --- | --- |
| `FILES_OWNER_USER_ID` | empty | Website user ID (not username) of the FnOS file owner; the browser is unavailable when empty. |
| `FILES_SFTP_HOST` | empty | FnOS host reachable from the website server over SFTP. |
| `FILES_SFTP_PORT` | `22` | FnOS SFTP port. |
| `FILES_SFTP_USER` | empty | SFTP account used to read and write `/vol*/1000`. |
| `FILES_SFTP_PASSWORD` | empty | Password for that SFTP account; kept in `website-part/.env` only. |
| `FILES_SFTP_HOST_SHA256` | empty | Expected SSH host key as 64 hexadecimal SHA-256 characters; connections fail closed when it does not match. |

## Mailu, Clash and NetBird

| Variable | Template / default | Purpose |
| --- | --- | --- |
| `CLASH_SYNC_ENABLED` | `true` | Set `false` on nodes where the VPN account synchronizer should stay off. |
| `CLASH_SSH_PROFILES_FILE` | Empty | Path to the private SSH profile JSON used for managed VPN nodes. |
| `CLASH_CREDENTIAL_ENCRYPTION_KEY` | Empty | Base64-encoded 32-byte key for managed VPN account credentials. Keep it stable across nodes and restarts. |
| `MAILU_API_URL` | Empty | HTTPS Mailu API endpoint, including the API version path. |
| `MAILU_API_TOKEN` | Empty | Server-side Mailu admin API token. |
| `MAILU_DOMAIN` | Empty | Domain where members can create mailboxes. |
| `MAILU_WEBMAIL_URL` | Empty | HTTPS URL for members to open webmail. |
| `MAILU_QUOTA_BYTES` | `1073741824` | Default mailbox quota of 1 GiB, in bytes. |
| `NETBIRD_API_URL` | `https://api.netbird.io/api` | NetBird Cloud or self-hosted HTTPS management endpoint ending in `/api`. |
| `NETBIRD_API_TOKEN` | Empty | Service-user personal access token. Supplying it enables the integration. |

## Access and security

- Keep bot settings, database credentials, session secrets, tokens and encryption keys on the server. Give the website's MySQL account the permissions needed for its schema.
- Use HTTPS and secure cookies for production. Match `TRUST_PROXY` to the actual proxy path. Monitoring can probe `/healthz` for database availability.
- New passwords require at least 8 characters, at most 72 UTF-8 bytes, and pass a common-password check. Existing bcrypt logins are supported. State-changing API requests check the request origin, and repeated login failures are throttled by the database account identity.
- Only configure trusted targets for `/connect/<slug>/`. The proxy removes the website session cookie and renames conflicting upstream cookies per connection. Subpath routing preserves the configured base and matching cookie paths, and logout expires both aliases. If an old cookie conflicts after an upgrade, clear it for that connection and sign in again.
- First-party responses carry CSP and other [security headers](../website-part/src/middleware/security_headers.js). Proxied third-party sites retain their upstream policy. Protected pages have a `noindex` policy and are listed in [robots.txt](../website-part/frontend/static/robots.txt). Remote workspaces have separate group, destination and credential-storage settings. [Remote access guide](remote-access.md)
