# Installation and deployment

[Project home](../README.md) · [繁體中文（香港）](deployment.zh-HK.md)

## Local installation

The [quick start](../README.md#quick-start) uses the example environment and the prebuilt frontend. On Windows, copy the same files from the repository root in PowerShell.

```powershell
Copy-Item shared\database\config.example.json shared\database\config.json
Copy-Item website-part\.env.example website-part\.env
```

Configure the database connection and set a random `SESSION_SECRET` of at least 32 characters before running `npm ci` and `npm start` in `website-part`. If OpenSSL is unavailable, Node can generate the value locally.

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

For Discord integration, point `DISCORD_CONFIG_PATH` at the separate bot's `discord-part/config.json`. Guild language changes use an atomic rename, so the designated writer needs write access to the **containing directory**. Mount that directory read/write if the writer runs in Docker. When upgrading a bot that predates event waitlists, stop it, start the website to apply migration `029`, then start the compatible bot. [Database setup and migrations](../shared/database/README.md)

## PM2 on Linux and OpenWrt

Install PM2 and configure the production database, session secret and HTTPS reverse proxy. Run the helper from the repository root.

```sh
bash website-part/start.sh init
```

`init` installs the production dependencies, registers and starts `liulianbot-website`, then saves the PM2 process list. Run it again after dependency or process-definition changes. Use `bash website-part/start.sh restart` to apply an environment update, or `start` to resume a stopped process. For a custom process name, set the same `PM2_APP_NAME` for every invocation.

If a module is missing after an update, run `npm ls js-yaml socket.io @electerm/rdpjs --depth=0` from `website-part` and repeat `init` to restore the locked dependencies. Probe `/healthz` to check the application's database connection after a restart.

On OpenWrt or iStoreOS, initialise the process first, then install the boot hook as root.

```sh
bash website-part/start.sh startup
/etc/init.d/pm2-pm2 enabled
```

The hook requires `/usr/bin/pm2` and uses `/root/.pm2`. It backs up an existing init script under `/root/.pm2/startup-backups/`. Running `/etc/init.d/pm2-pm2 start` restores all of root's saved PM2 processes. Stopping the hook stops that daemon and its applications. Save the process list after changes and make sure the website filesystem and database are available at boot.

## Docker CLI

Build from the repository root. The [runtime Dockerfile](../website-part/Dockerfile) packages the committed frontend. The [root Dockerfile](../Dockerfile) rebuilds the frontend from source.

```bash
docker build --file website-part/Dockerfile --tag liulianbot-website:latest .
```

The example publishes the port on host loopback for a local HTTPS reverse proxy. Configure a database address reachable **from the container** in `shared/database/config.json`. The container mounts this file read-only and reads website settings from `website-part/.env`.

```bash
docker run --detach --name liulianbot-website \
  --restart unless-stopped \
  --publish 127.0.0.1:3000:3000 \
  --env-file website-part/.env \
  --env NODE_ENV=production \
  --env BIND_IP=0.0.0.0 \
  --volume "$(pwd)/shared/database/config.json:/app/shared/database/config.json:ro" \
  liulianbot-website:latest
```

Windows PowerShell

```powershell
docker run --detach --name liulianbot-website `
  --restart unless-stopped `
  --publish 127.0.0.1:3000:3000 `
  --env-file website-part/.env `
  --env NODE_ENV=production `
  --env BIND_IP=0.0.0.0 `
  --volume "${PWD}/shared/database/config.json:/app/shared/database/config.json:ro" `
  liulianbot-website:latest
```

Read the logs with `docker logs --follow liulianbot-website`. After a code or dependency update, rebuild the image and recreate the container with the same private configuration and mounts. The website's periodic session cleanup logs transient database errors for diagnosis.

## Deployment examples

| Installation | Guide |
| --- | --- |
| HTTPS reverse proxy or a private Suwayomi upstream | [Nginx Proxy Manager and OpenWrt firewall](../website-part/deploy/reverse-proxy/README.md) |
| Website and MySQL on one OpenWrt host | [Local SSD, backup and restore](../website-part/deploy/openwrt/README.md) |
| Router and one VPS | [HAProxy and a restricted SSH tunnel](../website-part/deploy/router-vps/README.md) |
| Multiple regional website nodes | [Nginx, shared sessions and rate limits](../website-part/deploy/multi-region/README.md) |
| Managed Clash VPN accounts | [SSH profiles and account expiry](../website-part/deploy/clash-vps/README.md) |
