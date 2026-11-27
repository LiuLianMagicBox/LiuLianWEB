const express = require('express');
const session = require('express-session');
const { rateLimit } = require('express-rate-limit');
const path = require('path');

const { requirePageAuth } = require('./middleware/auth');
const { buildTrustProxy } = require('./config/server');
const { MySqlRateLimitStore } = require('./rate_limit_store');
const { AUTH_RATE_LIMIT } = require('./middleware/auth_rate_limit');
const { createLoginThrottle, resolveLoginAccount, accountKey } = require('./middleware/login_throttle');
const { originCheck } = require('./middleware/origin_check');
const { requireAdmin } = require('./middleware/admin_auth');
const { requireRemotePageAccess } = require('./middleware/remote_auth');
const { requirePageVisibility } = require('./middleware/page_visibility');
const { requestContext } = require('./middleware/request_context');
const { errorHandler } = require('./middleware/error_handler');
const { securityHeaders } = require('./middleware/security_headers');
const { referrerConnectionSlug } = require('./proxy_helpers');
const { deviceLabel } = require('./services/session');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// Vite fingerprints `assets/` filenames, so those can be cached forever, while
// HTML entry points must be revalidated so a deploy is picked up immediately.
const ASSETS_DIR = `${path.sep}assets${path.sep}`;

function setStaticCacheHeaders(res, filePath) {
  if (filePath.includes(ASSETS_DIR)) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  } else {
    // HTML, CSS, images, the manifest and robots.txt are not fingerprinted, so
    // they must revalidate (ETag) instead of risking a stale deploy.
    res.setHeader('Cache-Control', 'no-cache');
  }
}

function homeRedirectPath(session) {
  return session?.user ? '/index.html' : '/login.html';
}

function sendPage(res, filename) {
  res.set('Cache-Control', 'no-cache');
  return res.sendFile(path.join(PUBLIC_DIR, filename));
}

function createApp({ sessionOptions, sessionMiddleware, routers, env = process.env }) {
  const app = express();

  // Security headers come first so even redirects and errors carry them.
  app.use(securityHeaders);
  app.set('trust proxy', buildTrustProxy(env, sessionOptions.cookie.secure));

  // Public scripts, styles and images need no session lookup or expiry update.
  // Mount each directory separately so HTML still passes through page guards.
  const publicAssets = express.Router();
  for (const directory of ['assets', 'css', 'img', 'vendor']) {
    publicAssets.use(`/${directory}`, express.static(path.join(PUBLIC_DIR, directory), {
      index: false,
      redirect: false,
      setHeaders: setStaticCacheHeaders,
    }));
  }
  app.use((req, res, next) => {
    // Upstream apps can request the same root-relative asset paths. Keep those
    // requests in the authenticated proxy redirect flow below.
    if (referrerConnectionSlug(req)) return next();
    return publicAssets(req, res, next);
  });

  app.use((req, _res, next) => {
    req.websiteSessionCookieName = sessionOptions.name || 'connect.sid';
    next();
  });
  app.use(sessionMiddleware || session(sessionOptions));
  app.use((req, _res, next) => {
    if (req.session?.user && req.session.deviceLabel === undefined) {
      const label = deviceLabel(req.headers['user-agent']);
      if (label) req.session.deviceLabel = label;
    }
    next();
  });
  if (routers.health) app.use('/healthz', routers.health);
  if (routers.connectionProxy.redirectRootRelativeRequest) {
    app.use(routers.connectionProxy.redirectRootRelativeRequest);
  }
  app.use('/api', requestContext);
  app.use('/api', originCheck);
  app.use('/api', express.json({ limit: '32kb' }));
  app.use('/api', express.urlencoded({ extended: false, limit: '16kb' }));
  app.use('/api/admin/connections', routers.adminConnections);
  const distributed = env.DISTRIBUTED_DEPLOYMENT === 'true';
  const authRateLimiter = rateLimit({
    ...AUTH_RATE_LIMIT,
    ...(distributed ? { store: new MySqlRateLimitStore('auth-ip') } : {}),
  });
  const loginThrottle = distributed ? rateLimit({
    ...AUTH_RATE_LIMIT,
    store: new MySqlRateLimitStore('auth-account'),
    keyGenerator: accountKey,
    skip: req => !accountKey(req),
    skipSuccessfulRequests: true,
    requestWasSuccessful: (req, res) => res.statusCode !== 401,
  }) : createLoginThrottle();
  app.use('/api/auth/login', authRateLimiter);
  app.use('/api/auth/login', resolveLoginAccount());
  app.use('/api/auth/login', loginThrottle);
  app.use('/api/auth/register', authRateLimiter);
  app.use('/api/auth', routers.auth);
  app.use('/api/roller', routers.roller);
  if (routers.files) app.use('/api/files', routers.files);
  if (routers.mail) app.use('/api/mail', routers.mail);
  if (routers.events) app.use('/api/events', routers.events);
  if (routers.guildManager) app.use('/api/guild-manager', routers.guildManager);
  if (routers.clashAdmin) app.use('/api/admin/clash', routers.clashAdmin);
  if (routers.netbird) app.use('/api/admin/netbird', routers.netbird);
  if (routers.clashSubscription) {
    app.use('/clash-sub-public', routers.clashSubscription);
    // Keep existing bearer URLs valid while new links use the public prefix.
    app.use('/clash-sub', routers.clashSubscription);
  }
  app.use('/api/admin', routers.admin);
  app.use('/api/connections', routers.connections);
  if (routers.pageVisibility) app.use('/api/page-visibility', routers.pageVisibility);
  if (routers.rdp) app.use('/api/rdp', routers.rdp);
  if (routers.remoteProfile) app.use('/api/remote-profile', routers.remoteProfile);
  if (routers.mobileConnections) app.use('/api/mobile', routers.mobileConnections);
  if (routers.vlessTunnel) app.use('/api/vless-tunnel', routers.vlessTunnel);

  app.get('/files.html', requirePageAuth, (req, res) => {
    sendPage(res, 'files.html');
  });
  app.get('/mail.html', requirePageAuth, requirePageVisibility('mail'), (req, res) => {
    sendPage(res, 'mail.html');
  });
  app.get('/share.html', (req, res) => {
    res.set('Referrer-Policy', 'no-referrer');
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(PUBLIC_DIR, 'share.html'));
  });

  app.get('/roller.html', requirePageVisibility('roller'), (req, res) => {
    sendPage(res, 'roller.html');
  });
  app.get('/index.html', requirePageAuth, (req, res) => {
    sendPage(res, 'index.html');
  });
  app.get('/account.html', requirePageAuth, requirePageVisibility('account'), (req, res) => {
    sendPage(res, 'account.html');
  });
  app.get('/guild-manager.html', requirePageAuth, (req, res) => {
    sendPage(res, 'guild-manager.html');
  });
  app.get('/events.html', requirePageAuth, requirePageVisibility('events'), (req, res) => {
    sendPage(res, 'events.html');
  });
  app.get('/remote.html', requireRemotePageAccess, requirePageVisibility('remote'), (req, res) => {
    sendPage(res, 'remote.html');
  });
  app.get('/chromium.html', requirePageAuth, requirePageVisibility('chromium'), (req, res) => {
    sendPage(res, 'chromium.html');
  });
  app.get('/vless-tunnel.html', requirePageAuth, requirePageVisibility('vless-tunnel'), (req, res) => {
    sendPage(res, 'vless-tunnel.html');
  });
  app.get('/terms.html', (req, res) => {
    sendPage(res, 'terms.html');
  });
  app.get('/admin.html', requirePageAuth, requireAdmin, (req, res) => {
    sendPage(res, 'admin.html');
  });

  app.use('/connect/:slug', routers.connectionProxy);
  app.use(express.static(PUBLIC_DIR, { index: false, setHeaders: setStaticCacheHeaders }));
  app.get('/', (req, res) => {
    res.redirect(homeRedirectPath(req.session));
  });
  app.use(errorHandler);
  app.use((req, res) => {
    sendPage(res.status(404), '404.html');
  });

  return app;
}

module.exports = { createApp, homeRedirectPath, setStaticCacheHeaders };
