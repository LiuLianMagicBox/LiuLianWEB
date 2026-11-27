require('dotenv').config();
const session = require('express-session');

const { createApp } = require('./app');
const { buildListenOptions } = require('./config/server');
const { buildSessionOptions } = require('./config/session');
const { getPool, closePool } = require('./db');
const { MySqlSessionStore } = require('./session_store');
const { createSessionConnections } = require('./services/session_connections');
const { startGuildConfigSync } = require('./services/guild_config_sync');
const { attachSshServer } = require('./ssh_server');
const { attachRdpServer } = require('./rdp_socket');
const { attachChromiumServer } = require('./chromium_server');

async function startServer() {
  await getPool();
  const auth = require('./routes/auth');
  const files = require('./routes/files').createRouter();
  const mail = require('./routes/mail').createRouter();
  const netbird = require('./routes/netbird').createRouter();
  const roller = require('./routes/roller');
  const admin = require('./routes/admin');
  const clashSync = require('./services/clash_sync').createSyncWorker();
  const clash = require('./routes/clash').createRouters({ syncWorker: clashSync });
  const adminConnections = require('./routes/admin_connections');
  const connections = require('./routes/connections');
  const mobileConnections = require('./routes/mobile_connections');
  const events = require('./routes/events');
  const rdp = require('./routes/rdp');
  const remoteProfile = require('./routes/remote_profile');
  const connectionProxy = require('./routes/connection_proxy');
  const pageVisibility = require('./routes/page_visibility');
  const guildManager = require('./routes/guild_manager');
  const vlessTunnel = require('./routes/vless_tunnel');
  const health = require('./routes/health').createRouter({ getPool });
  const sessionStore = new MySqlSessionStore();
  const sessionOptions = buildSessionOptions(process.env, sessionStore);
  const sessionMiddleware = session(sessionOptions);
  const app = createApp({
    sessionOptions,
    sessionMiddleware,
    routers: {
      auth,
      files,
      mail,
      netbird,
      roller,
      admin,
      clashAdmin: clash.admin,
      clashSubscription: clash.subscription,
      adminConnections,
      connections,
      mobileConnections,
      events,
      rdp,
      remoteProfile,
      connectionProxy,
      pageVisibility,
      guildManager,
      vlessTunnel,
      health,
    },
  });
  const listenOptions = buildListenOptions(process.env);
  const server = app.listen(listenOptions);
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  console.log(
    `LiuLianBot Website listening on ${listenOptions.host || 'all interfaces'}:${listenOptions.port}`,
  );

  const sessionConnections = createSessionConnections(sessionStore);
  app.locals.sessionConnections = sessionConnections;
  const realtime = {
    sessionStore,
    sessionConnections,
    sessionCookieName: sessionOptions.name,
    sessionSecret: sessionOptions.secret,
  };
  server.connectionProxyServer = connectionProxy.attachWebSocketServer(server, realtime);
  server.sshServer = attachSshServer(server, realtime);
  server.rdpServer = attachRdpServer(server, { sessionMiddleware, sessionConnections });
  const chromiumServer = attachChromiumServer(server, realtime);
  server.sessionConnections = sessionConnections;
  server.chromiumServer = chromiumServer;
  sessionStore.startCleanup();
  server.guildConfigSync = startGuildConfigSync(require('./db/guild_manager').syncGuildConfig);
  clashSync.start();
  server.clashSync = clashSync;
  const closeResources = () => {
    sessionConnections.stop();
    server.guildConfigSync.stop().catch(() => {});
    sessionStore.stopCleanup();
    clashSync.stop().catch(() => {});
    chromiumServer.closeAll().catch(() => {});
    server.sshServer.closeAll();
    server.connectionProxyServer.closeAll();
  };
  server.once('close', closeResources);
  server.once('error', err => {
    closeResources();
    closePool().catch(closeErr => {
      console.error('[Server] Database pool shutdown failed:', closeErr);
    });
    console.error('[Server] HTTP server error:', err);
  });

  return server;
}

async function stopServer(server) {
  // Socket.IO also closes the shared HTTP server. Terminate unrelated upgraded
  // transports first so that its close callback cannot wait on them forever.
  server?.sessionConnections?.stop();
  server?.sshServer?.closeAll();
  server?.connectionProxyServer?.closeAll();
  const chromiumCleanup = server?.chromiumServer?.closeAll();
  await Promise.all([server?.clashSync?.stop(), server?.guildConfigSync?.stop(), chromiumCleanup]);
  if (server?.rdpServer) {
    await new Promise(resolve => server.rdpServer.close(resolve));
  }
  if (server?.listening) {
    await new Promise((resolve, reject) => {
      server.close(err => (err ? reject(err) : resolve()));
    });
  }
  await closePool();
}

if (require.main === module) {
  let server = null;
  let shuttingDown = false;
  const shutdown = signal => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[Server] Received ${signal}; shutting down`);
    stopServer(server).catch(err => {
      console.error('[Server] Shutdown failed:', err);
      process.exitCode = 1;
    });
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  startServer()
    .then(startedServer => { server = startedServer; })
    .catch(err => {
      console.error('[Server] Startup failed:', err);
      process.exitCode = 1;
    });
}

module.exports = { startServer, stopServer };
