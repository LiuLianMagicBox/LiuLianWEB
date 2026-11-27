# Member and administrator guide

[Project home](../README.md) · [繁體中文（香港）](member-guide.zh-HK.md)

## Accounts and navigation

Create an account at `/login.html`. After signing in, the dashboard shows upcoming events, your signups, connected websites and available tools. **Account settings → My sign-in devices** shows the browser, operating system and last activity for each login. You can identify the current device and sign out another. Each website node checks open SSH, WebRDP, Chromium and proxy connections against the shared sessions every two seconds.

Administrators manage users, groups and connection grants in **Admin Panel**. A user can belong to several groups. **Users → Reset password** sets another member's password and signs them out on all devices. Use **Account settings** for your own password. The **Admin audit log** records resets, group membership and page-visibility changes. Search by exact username, actor or target ID, group ID or page key to see the time and outcome.

| Access | Pages |
| --- | --- |
| Public entry points | `login.html`, `terms.html`, `share.html`, `404.html`. Roller access at `roller.html` follows its visibility settings. |
| Member pages | `index.html`, `account.html`, `events.html`, `mail.html`, `files.html`, `guild-manager.html` |
| Workspaces | `remote.html`, `chromium.html`, `vless-tunnel.html`. Remote access also requires the appropriate group. |
| Administrators | `admin.html` |

**Admin Panel → Page Visibility** controls the audience for configurable pages and their links in the sidebar and dashboard. Feature permissions still apply. An authorised user can open a hidden website connection directly at `/connect/<slug>/`. Connections support HTTP and WebSocket traffic, including streamed events, files and byte ranges. [API and WebSocket reference](API.md)

## Discord accounts, events and guilds

1. Generate a link code under **Account** and run `>link <code>` in Discord. The code is single-use and expires after ten minutes.
2. An administrator with a linked Discord account can create an event in **Events** with a guild ID, start time and capacity. Members can sign up on the website or use `>events`, `>eventjoin <event_id>` and `>eventleave <event_id>` in Discord. Both clients use the same roster.
3. A full event shows the waitlist and your position. When a place opens, the next member is promoted. Linked members can receive a bot DM. **Confirmed players → Shuffle into two teams** fetches the latest confirmed roster and provides two lists to copy into Discord. The bot also supports `>eventteams <event_id>`.

**Manage → Discord servers** shows guilds where the linked Discord user is the owner, a configured guild administrator or a bot administrator. Set the bot language, temporary private-voice trigger, default log channel and per-category overrides there. The writer retries pending language updates every 30 seconds.

In Discord, `/setlogchannel <category> <channel>` accepts `all`, `useraction`, `voiceaction`, `groupaction`, `messageaction`, `channelaction` and `roleaction`. The `all` channel receives events without an override. Members can use `>roles` and `>role <role_id>` for available roles. Administrators can review uncertain announcement deliveries under **Announcements**, then confirm delivery or reschedule. [Bot and website integration walkthrough (Traditional Chinese)](FEATURE_WALKTHROUGH.zh-TW.md)

## FnOS files and sharing

The file owner is the account identified by `FILES_OWNER_USER_ID`. Other members request access at `/files.html`. The owner assigns read access and can add write or share permissions to it. A general website administrator also needs a grant. Renaming an account preserves ownership.

- Browse FnOS volumes under `/vol*/1000`. Each row shows the volume, type and available timestamps. A missing creation time appears as a dash.
- Queue several uploads and track each file's progress. Each keeps its destination while you browse. **Retry failed files** retries failed items. Each upload is limited to 1 GiB and requires a new filename.
- A share code grants read-only access at `/share.html` for 1–168 hours. The website displays it once, stores its SHA-256 hash and passes the code in the URL fragment. A folder share includes files added later, until expiry or revocation.
- Download selected items or an entire shared folder as a streamed ZIP. The limits are 50 selections, 2,000 entries and 4 GiB of uncompressed content. Access stays inside the permitted path. Symbolic links and device files are rejected.

During an SFTP outage, members can still sign in when MySQL is available. File and share screens show the storage status. [File operations, migrations and SFTP setup](file-browser.md) · [OpenWrt recovery guide](../website-part/deploy/openwrt/README.md)

## Website language

Use the language selector in the top bar or on the login and share pages for English, Hong Kong Traditional Chinese or Simplified Chinese. The first visit follows the browser's language preferences. `zh-CN`, `zh-SG` and `zh-Hans` select Simplified Chinese, other Chinese preferences select Hong Kong Traditional Chinese, and English is the fallback. A manual choice is stored in `liulianbot.locale` in localStorage and takes effect for the current page even if storage is blocked.

The selection covers interface text, accessibility labels, notifications and event date formatting. User content and legal documents retain their original wording. The bot's language is managed per guild. [Mailboxes and administrator integrations](integrations.md) · [Remote workspaces](remote-access.md)
