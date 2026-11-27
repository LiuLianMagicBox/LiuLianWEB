# Mailboxes, Clash and NetBird

[Project home](../README.md) · [繁體中文（香港）](integrations.zh-HK.md)

## Member mailboxes

The **Mail** navigation item opens `/mail.html`. Existing website members who
have accepted the website terms can choose an available name at `MAILU_DOMAIN`
and a separate 12–128 character mailbox password. After creation the page shows
their full address and an **Open webmail** link. Mailbox login uses that full
address and the mailbox password; website login is not Mailu single sign-on.
The default quota is 1 GiB. Existing Mailu accounts, aliases and reserved names
cannot be claimed through this page, including mail administrators.

Set these server-only values on every website node. Fill in the API token locally and replace the example domain with yours.

```dotenv
MAILU_API_URL=https://mail.example.org/api/v1
MAILU_API_TOKEN=
MAILU_DOMAIN=example.org
MAILU_WEBMAIL_URL=https://mail.example.org/webmail/
MAILU_QUOTA_BYTES=1073741824
```

Enable `API=true` and set a strong `API_TOKEN` in Mailu's `mailu.env`, then
recreate its affected containers. HTTPS is required. Never use a `VITE_` prefix
for the API token or commit live environment files. If configuration is missing,
the page explains registration is unavailable. Normal public Mailu signup stays
disabled; the website backend alone creates unprivileged mailboxes.

Migration `026` creates `website_mailboxes` and the member-only `mail` page grant.
Administrators can restrict the page through existing page-visibility settings;
the API always requires a current website member, even if guest visibility is
enabled. Creation is limited to ten attempts per member per hour, shared across
nodes when distributed deployment is enabled. MySQL locks and unique ownership
reservations enforce one mailbox per member. The website stores the email,
creation status and a random reconciliation marker, never mailbox passwords or
mail contents. After an uncertain upstream result, retry the reserved name with
the original password; retries never reset an existing mailbox's password.

Website renames/password changes do not rename/change mailbox credentials.
Deleting a website member does not automatically delete their mailbox or release
its ownership reservation: mail administrators must manage retention/disablement
in Mailu separately. Mailbox password changes are available in Mailu settings.
Back up both the website ownership table and Mailu's persistent data.

## Clash VPN subscriptions

Under **Admin Panel → Clash subscriptions**, add a node using a single Clash/Mihomo proxy YAML object without a `name`. Its transport and TLS settings must match the VPN server. Supported types are SS, VMess, VLESS, Trojan, Hysteria2, TUIC, SOCKS5 and HTTP.

1. Add a VPN user, grant access to the required nodes and set the expiry time (UTC+8). VPN users have their own identities. Removing one invalidates the subscription, clears its grants and queues managed-account revocation.
2. Choose all traffic via VPN, LAN direct, China direct, China direct with ad blocking, or custom routing YAML. Changes take effect on the next client refresh and preserve the URL and node grants. LAN rules are embedded. Compatible clients download the China and advertising providers every 24 hours. [Rule source](https://github.com/Loyalsoldier/clash-rules)
3. For a custom rule set, edit `rules` and optional HTTPS `rule-providers` with `VPN`, `DIRECT` or `REJECT` policies. A missing final match becomes `MATCH,VPN`. Cache paths are generated and switching presets preserves the custom draft. [Supported custom syntax](API.md#clash-vpn-subscriptions)

Proxy `/clash-sub-public/<token>.yaml` over HTTPS without caching or logging the full URL. The website generates the YAML from MySQL. Existing `/clash-sub/<token>.yaml` links also work. Disabled, expired or unknown links return 404. A subscription without an enabled, granted node returns 403. Administrators can disable subscriptions and rotate URLs in the panel.

SSH-managed nodes provision individual credentials. The website retries synchronization in the background and the VPN host's timer enforces expiry during website outages. Changes can restart the VPN service and disconnect existing sessions. Unmanaged nodes restrict subscription downloads only. Rotate any previously distributed shared credentials on the VPN host. [SSH profiles, supported engines and revocation](../website-part/deploy/clash-vps/README.md)

Migrations `020`–`024` create nodes, subscriptions, grants and encrypted accounts, separate VPN users from website accounts and add rule preferences. Existing IDs, links and grants survive the transition. Deleting a website member does not delete their independent VPN identity.

## NetBird

**Admin Panel → NetBird** shows peer status, IP, version and last connection. Administrators can rename peers, manage SSH, login and inactivity expiry, update Cloud approval, remove peers and manage networks, resources and routing peers. Changes appear in the admin audit log.

```dotenv
NETBIRD_API_URL=https://api.netbird.io/api
NETBIRD_API_TOKEN=
```

Set the token privately on every website node and restart the service. Use a service-user personal access token with permission to manage peers and networks. A self-hosted endpoint must use HTTPS, end in `/api` and support `/api/networks`. Leaving the token empty disables this integration.

New peers enrol through the NetBird client. Set up groups and access policies in the NetBird dashboard and select the existing groups in the website. The website host needs a network route to reach private resources. After an API timeout, refresh the current state before repeating a change. [Website API contract](API.md#netbird-administration) · [NetBird authentication](https://docs.netbird.io/api/guides/authentication) · [Peers](https://docs.netbird.io/api/resources/peers) · [Networks](https://docs.netbird.io/api/resources/networks)
