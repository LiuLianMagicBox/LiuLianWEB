# LiuLianWEB

[繁體中文（香港）](README_HK.md)

LiuLianWEB is the member website for LiuLianBot. Members can link a Discord account, join Rainbow Six Siege events, and use the files, mailboxes and remote workspaces their administrators enable.

## Quick start

Use Node.js 20+ and MySQL 8+. CI and the Docker images use Node.js 22. Create the database and an application account with permission to run schema migrations. From the repository root, copy the two templates for a new installation.

```sh
cp shared/database/config.example.json shared/database/config.json
cp website-part/.env.example website-part/.env
```

Enter the MySQL connection details in `shared/database/config.json`. Generate a session secret with `openssl rand -hex 32` and set `SESSION_SECRET` in `website-part/.env`. Keep both files private.

```sh
cd website-part
npm ci
npm start
```

Open `http://127.0.0.1:3000`. The template selects that address, and the compiled frontend is included in the repository. For Discord integration, run LiuLianBot against the same database. On a new database, start the website first so it can create the tables the bot needs.

## Guides

| Task | Documentation |
| --- | --- |
| <a name="1-configure-the-shared-database"></a><a name="2-install-and-run-the-website"></a><a name="run-the-website-with-docker-cli"></a><a name="多地區-vps-部署"></a>Run the website | [PowerShell, PM2, Docker and deployment examples](docs/deployment.md) · [Database setup and migrations](shared/database/README.md) |
| <a name="website-environment-variables"></a><a name="security-notes"></a>Configure a host | [Environment variables and security settings](docs/configuration.md) |
| <a name="match-rosters-sign-in-devices-and-administration"></a><a name="活動候補同公告送達"></a><a name="website-dashboard"></a><a name="website-language"></a><a name="server-manager-and-categorized-logs"></a><a name="r6-events"></a><a name="website-pages-and-routes"></a><a name="page-visibility"></a><a name="fnos-file-browser-and-sharing"></a>Use the website | [Accounts, events, Discord administration, files and sharing](docs/member-guide.md) |
| <a name="member-mailboxes"></a><a name="clash-vpn-subscription-management"></a>Connect services | [Mailu mailboxes](docs/integrations.md#member-mailboxes) · [Clash subscriptions](docs/integrations.md#clash-vpn-subscriptions) · [NetBird](docs/integrations.md#netbird) |
| <a name="remote-client-configuration"></a><a name="chromium-workspace"></a><a name="interim-vless-tunnel"></a><a name="rdp-client-lifecycle-and-verification"></a><a name="private-network-rdp-destinations"></a><a name="multiple-rdp-profiles-per-user"></a>Open a remote workspace | [SSH, WebRDP, Chromium and VLESS](docs/remote-access.md) |
| <a name="website-frontend-react"></a><a name="design-system"></a><a name="app-frame"></a>Develop and test | [React frontend, Vite and browser tests](docs/development.md) · [API reference](docs/API.md) · [OpenAPI](docs/openapi.json) |

[Release notes](PATCH_NOTES.md) · [Terms of service](TERMS_OF_SERVICE.md) · [Privacy policy](PRIVACY_POLICY.md)

## License

This project is for personal and community use. All rights reserved.
