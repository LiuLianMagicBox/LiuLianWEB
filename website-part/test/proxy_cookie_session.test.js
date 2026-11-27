const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const session = require('express-session');
const { once } = require('node:events');
const WebSocket = require('ws');
const { CookieJar } = require('jsdom');

const dbPath = require.resolve('../src/db');
let upstreamUrl;
require.cache[dbPath] = {
  id: dbPath, filename: dbPath, loaded: true,
  exports: { getConnectionAccessBySlug: async () => ({
    allowed: true, connection: { target_url: upstreamUrl }, user: {},
  }) },
};
const connectionProxy = require('../src/routes/connection_proxy');
const listen = app => new Promise(resolve => {
  const server = app.listen(0, '127.0.0.1', () => resolve(server));
});
const stop = server => new Promise(resolve => {
  server.closeAllConnections();
  server.close(resolve);
});

test('proxy and website sessions coexist with default and customized website cookies', async () => {
  for (const cookieName of ['connect.sid', 'liulian.sid']) {
    let received;
    const upstream = express();
    upstream.use(session({ secret: 'upstream-test-secret', resave: false, saveUninitialized: false }));
    upstream.get('/login', (req, res) => { req.session.user = 'upstream-user'; res.json({ success: true }); });
    upstream.get('/me', (req, res) => {
      received = req.headers.cookie;
      res.json({ user: req.session.user || null });
    });
    upstream.get('/redirect', (_req, res) => res.redirect('/login'));
    upstream.get('/page', (_req, res) => res.set('Cache-Control', 'public, max-age=600').send('<a href="/login">Login</a>'));
    const upstreamServer = await listen(upstream);
    upstreamUrl = `http://127.0.0.1:${upstreamServer.address().port}/`;
    const app = express();
    app.use((req, _res, next) => { req.websiteSessionCookieName = cookieName; next(); });
    app.use(session({ name: cookieName, secret: 'website-test-secret', resave: false, saveUninitialized: false }));
    app.get('/seed', (req, res) => { req.session.user = { id: 'member' }; res.send('ready'); });
    app.use('/connect/:slug', connectionProxy);
    const server = await listen(app);
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const seed = await fetch(`${base}/seed`);
      await seed.text();
      const websiteCookie = seed.headers.get('set-cookie').split(';')[0];
      const login = await fetch(`${base}/connect/reports/login`, { headers: { cookie: websiteCookie } });
      assert.equal(login.status, 200);
      await login.json();
      const upstreamCookie = login.headers.get('set-cookie').split(';')[0];
      assert.match(upstreamCookie, /^llb_reports_connect\.sid=/);
      const response = await fetch(`${base}/connect/reports/me`, {
        headers: { cookie: `${upstreamCookie}; ${websiteCookie}` }, redirect: 'manual',
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { user: 'upstream-user' });
      assert.match(received, /^connect\.sid=/);
      assert.equal(received.includes(websiteCookie.split('=')[1]), false);
      const redirect = await fetch(`${base}/connect/reports/redirect`, {
        headers: { cookie: websiteCookie }, redirect: 'manual',
      });
      assert.equal(redirect.headers.get('location'), '/connect/reports/login');
      await redirect.text();
      const page = await fetch(`${base}/connect/reports/page`, { headers: { cookie: websiteCookie } });
      assert.equal(page.headers.get('cache-control'), 'no-store');
      assert.match(await page.text(), /\/connect\/reports\/__upstream_root__\/login/);
    } finally { await stop(server); await stop(upstreamServer); }
  }
});

test('WebSocket upgrade cookies are scoped and round-trip without forwarding the custom website session', async () => {
  const upstreamServer = await listen(express());
  upstreamUrl = `http://127.0.0.1:${upstreamServer.address().port}/`;
  const upstreamSockets = new WebSocket.Server({ server: upstreamServer });
  upstreamSockets.on('headers', headers => headers.push('Set-Cookie: connect.sid=ws-session; Path=/; HttpOnly'));
  upstreamSockets.on('connection', (socket, req) => socket.send(req.headers.cookie || ''));
  const store = new session.MemoryStore();
  const secret = 'website-websocket-test-secret';
  const app = express();
  app.use(session({ name: 'custom.sid', store, secret, resave: false, saveUninitialized: false }));
  app.get('/seed', (req, res) => { req.session.user = { id: 'member' }; res.send('ready'); });
  const server = await listen(app);
  const handle = connectionProxy.attachWebSocketServer(server, {
    sessionStore: store, sessionCookieName: 'custom.sid', sessionSecret: secret,
  });
  const roundTrip = async cookie => {
    const socket = new WebSocket(`ws://127.0.0.1:${server.address().port}/connect/reports/ws`, { headers: { cookie } });
    const upgraded = once(socket, 'upgrade');
    const message = once(socket, 'message');
    try {
      await once(socket, 'open');
      return { response: (await upgraded)[0], cookie: (await message)[0].toString() };
    } finally {
      const closed = once(socket, 'close');
      socket.close();
      await closed;
    }
  };
  try {
    const seed = await fetch(`http://127.0.0.1:${server.address().port}/seed`);
    await seed.text();
    const websiteCookie = seed.headers.get('set-cookie').split(';')[0];
    const first = await roundTrip(websiteCookie);
    assert.equal(first.cookie, '');
    const rewritten = first.response.headers['set-cookie'][0];
    assert.equal(rewritten, 'llb_reports_connect.sid=ws-session; Path=/connect/reports/; HttpOnly');
    const second = await roundTrip(`${rewritten.split(';')[0]}; ${websiteCookie}`);
    assert.equal(second.cookie, 'connect.sid=ws-session');
  } finally {
    handle.closeAll();
    for (const socket of upstreamSockets.clients) socket.terminate();
    await new Promise(resolve => upstreamSockets.close(resolve));
    await stop(server); await stop(upstreamServer);
  }
});

test('base-path proxies preserve login cookies, relative redirects and assets outside the mounted app', async () => {
  const paths = [];
  const upstream = express();
  upstream.use((req, _res, next) => { paths.push(req.url); next(); });
  upstream.get('/app/login', (_req, res) => res.set('Set-Cookie', 'auth=upstream; Path=/auth; HttpOnly').redirect('/auth/first'));
  upstream.get('/auth/first', (req, res) => {
    assert.equal(req.headers.cookie, 'auth=upstream');
    res.redirect('final');
  });
  upstream.get('/auth/final', (req, res) => {
    assert.equal(req.headers.cookie, 'auth=upstream');
    res.send('<script src="asset.js"></script>');
  });
  upstream.get('/auth/asset.js', (req, res) => {
    assert.equal(req.headers.cookie, 'auth=upstream');
    res.type('js').send('window.loaded = true;');
  });
  upstream.get('/app/page', (_req, res) => res.send('<script src="../asset.js"></script>'));
  upstream.get('/asset.js', (_req, res) => res.type('js').send('window.parentAsset = true;'));
  const upstreamServer = await listen(upstream);
  upstreamUrl = `http://127.0.0.1:${upstreamServer.address().port}/app/`;
  const app = express();
  app.use(session({ secret: 'website-base-path-test', resave: false, saveUninitialized: false }));
  app.get('/seed', (req, res) => { req.session.user = { id: 'member' }; res.send('ready'); });
  app.use('/connect/:slug', connectionProxy);
  const server = await listen(app);
  const base = `http://127.0.0.1:${server.address().port}`;
  const jar = new CookieJar();
  const request = async path => {
    const url = `${base}${path}`;
    const response = await fetch(url, { headers: { cookie: jar.getCookieStringSync(url) }, redirect: 'manual' });
    for (const cookie of response.headers.getSetCookie()) jar.setCookieSync(cookie, url);
    return response;
  };
  try {
    await (await request('/seed')).text();
    const login = await request('/connect/reports/login');
    assert.equal(login.status, 302);
    assert.match(login.headers.get('set-cookie'), /Path=\/connect\/reports\/__upstream_root__\/auth/);
    await login.text();
    const first = await request(login.headers.get('location'));
    assert.equal(first.status, 302);
    assert.equal(first.headers.get('location'), '/connect/reports/__upstream_root__/auth/final');
    await first.text();
    const final = await request(first.headers.get('location'));
    assert.equal(final.status, 200);
    const html = await final.text();
    const assetPath = html.match(/src="([^"]+)"/)[1];
    assert.equal(assetPath, '/connect/reports/__upstream_root__/auth/asset.js');
    const asset = await request(assetPath);
    assert.equal(asset.status, 200);
    await asset.text();
    assert.deepEqual(paths, ['/app/login', '/auth/first', '/auth/final', '/auth/asset.js']);
    const mounted = await request('/connect/reports/page');
    const parentAsset = (await mounted.text()).match(/src="([^"]+)"/)[1];
    assert.equal(parentAsset, '/connect/reports/__upstream_root__/asset.js');
    const parentResponse = await request(parentAsset);
    assert.equal(parentResponse.status, 200);
    await parentResponse.text();
    assert.deepEqual(paths.slice(-2), ['/app/page', '/asset.js']);
  } finally { await stop(server); await stop(upstreamServer); }
});

test('narrow login cookies work and expire on both proxy aliases', async () => {
  const upstream = express();
  upstream.get('/app/auth/login', (_req, res) => res.set('Set-Cookie', 'auth=value; Path=/app/auth; HttpOnly').send('ready'));
  upstream.get('/app/auth/me', (req, res) => res.status(req.headers.cookie === 'auth=value' ? 200 : 401).send('checked'));
  upstream.get('/app/auth/logout', (_req, res) => res.set('Set-Cookie', 'auth=; Path=/app/auth; Max-Age=0; HttpOnly').send('cleared'));
  const upstreamServer = await listen(upstream);
  upstreamUrl = `http://127.0.0.1:${upstreamServer.address().port}/app/`;
  const app = express();
  app.use(session({ secret: 'website-narrow-path-test', resave: false, saveUninitialized: false }));
  app.get('/seed', (req, res) => { req.session.user = { id: 'member' }; res.send('ready'); });
  app.use('/connect/:slug', connectionProxy);
  const server = await listen(app);
  const base = `http://127.0.0.1:${server.address().port}`;
  const jar = new CookieJar();
  const request = async path => {
    const url = `${base}${path}`;
    const response = await fetch(url, { headers: { cookie: jar.getCookieStringSync(url) }, redirect: 'manual' });
    for (const cookie of response.headers.getSetCookie()) jar.setCookieSync(cookie, url);
    await response.text();
    return response;
  };
  try {
    await request('/seed');
    const login = await request('/connect/reports/auth/login');
    assert.equal(login.headers.getSetCookie().length, 2);
    assert.equal((await request('/connect/reports/auth/me')).status, 200);
    assert.equal((await request('/connect/reports/__upstream_root__/app/auth/me')).status, 200);
    const logout = await request('/connect/reports/__upstream_root__/app/auth/logout');
    assert.equal(logout.headers.getSetCookie().length, 2);
    assert.equal((await request('/connect/reports/auth/me')).status, 401);
    assert.equal((await request('/connect/reports/__upstream_root__/app/auth/me')).status, 401);
  } finally { await stop(server); await stop(upstreamServer); }
});

test('upstream-root WebSocket cookies retain the configured base and round-trip on the right path', async () => {
  const upstreamServer = await listen(express());
  upstreamUrl = `http://127.0.0.1:${upstreamServer.address().port}/app/`;
  const upstreamSockets = new WebSocket.Server({ server: upstreamServer });
  upstreamSockets.on('headers', headers => headers.push('Set-Cookie: connect.sid=ws-auth; Path=/auth; HttpOnly'));
  upstreamSockets.on('connection', (socket, req) => socket.send(JSON.stringify({ url: req.url, cookie: req.headers.cookie || '' })));
  const store = new session.MemoryStore();
  const secret = 'website-ws-base-path-secret';
  const app = express();
  app.use(session({ name: 'custom.sid', store, secret, resave: false, saveUninitialized: false }));
  app.get('/seed', (req, res) => { req.session.user = { id: 'member' }; res.send('ready'); });
  const server = await listen(app);
  const handle = connectionProxy.attachWebSocketServer(server, {
    sessionStore: store, sessionCookieName: 'custom.sid', sessionSecret: secret,
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const path = '/connect/reports/__upstream_root__/auth/ws';
  const jar = new CookieJar();
  const roundTrip = async () => {
    const socket = new WebSocket(`${base.replace('http:', 'ws:')}${path}`, { headers: { cookie: jar.getCookieStringSync(`${base}${path}`) } });
    const upgraded = once(socket, 'upgrade');
    const message = once(socket, 'message');
    try {
      await once(socket, 'open');
      const response = (await upgraded)[0];
      for (const cookie of response.headers['set-cookie'] || []) jar.setCookieSync(cookie, `${base}${path}`);
      return { cookies: response.headers['set-cookie'], received: JSON.parse((await message)[0].toString()) };
    } finally {
      const closed = once(socket, 'close');
      socket.close();
      await closed;
    }
  };
  try {
    const seed = await fetch(`${base}/seed`);
    await seed.text();
    jar.setCookieSync(seed.headers.get('set-cookie'), `${base}/seed`);
    const first = await roundTrip();
    assert.deepEqual(first.received, { url: '/auth/ws', cookie: '' });
    assert.deepEqual(first.cookies, ['llb_reports_connect.sid=ws-auth; Path=/connect/reports/__upstream_root__/auth; HttpOnly']);
    const second = await roundTrip();
    assert.deepEqual(second.received, { url: '/auth/ws', cookie: 'connect.sid=ws-auth' });
  } finally {
    handle.closeAll();
    for (const socket of upstreamSockets.clients) socket.terminate();
    await new Promise(resolve => upstreamSockets.close(resolve));
    await stop(server); await stop(upstreamServer);
  }
});

test('rejected WebSocket handshakes cannot replace the website session cookie', async () => {
  for (const cookieName of ['connect.sid', 'custom.sid']) {
    const upstreamServer = await listen(express());
    upstreamUrl = `http://127.0.0.1:${upstreamServer.address().port}/app/`;
    upstreamServer.on('upgrade', (_req, socket) => socket.end(
      `HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nSet-Cookie: ${cookieName}=upstream-error; Path=/; HttpOnly\r\nLocation: /auth/login\r\nContent-Length: 0\r\n\r\n`));
    const store = new session.MemoryStore();
    const secret = 'website-rejected-ws-secret';
    const app = express();
    app.use(session({ name: cookieName, store, secret, resave: false, saveUninitialized: false }));
    app.get('/seed', (req, res) => { req.session.user = { id: 'member' }; res.send('ready'); });
    app.get('/me', (req, res) => res.json({ loggedIn: Boolean(req.session.user) }));
    const server = await listen(app);
    const handle = connectionProxy.attachWebSocketServer(server, { sessionStore: store, sessionCookieName: cookieName, sessionSecret: secret });
    const base = `http://127.0.0.1:${server.address().port}`;
    const path = '/connect/reports/__upstream_root__/auth/ws';
    const jar = new CookieJar();
    try {
      const seed = await fetch(`${base}/seed`);
      await seed.text();
      jar.setCookieSync(seed.headers.get('set-cookie'), `${base}/seed`);
      const rejection = await new Promise((resolve, reject) => {
        const socket = new WebSocket(`${base.replace('http:', 'ws:')}${path}`, { headers: { cookie: jar.getCookieStringSync(`${base}${path}`) } });
        let refused = false;
        socket.on('error', error => { if (!refused) reject(error); });
        socket.on('unexpected-response', (_request, response) => {
          refused = true;
          for (const cookie of response.headers['set-cookie'] || []) jar.setCookieSync(cookie, `${base}${path}`);
          response.on('error', reject);
          response.on('end', () => { socket.terminate(); resolve(response); });
          response.resume();
        });
        socket.on('open', () => { socket.terminate(); reject(new Error('The upstream should reject the handshake')); });
      });
      assert.equal(rejection.statusCode, 401);
      assert.equal(rejection.headers.location, '/connect/reports/__upstream_root__/auth/login');
      assert.deepEqual(rejection.headers['set-cookie'], [`llb_reports_${cookieName}=upstream-error; Path=/connect/reports/; HttpOnly`]);
      const me = await fetch(`${base}/me`, { headers: { cookie: jar.getCookieStringSync(`${base}/me`) } });
      assert.deepEqual(await me.json(), { loggedIn: true });
      assert.equal(jar.getCookieStringSync(`${base}/me`).includes('upstream-error'), false);
    } finally { handle.closeAll(); await stop(server); await stop(upstreamServer); }
  }
});

test('SSE delivers its first event before the upstream ends and releases the stream on cancellation', async () => {
  let releaseStream;
  const upstreamClosed = new Promise(resolve => { releaseStream = resolve; });
  const upstream = express().get('/feed', (_req, res) => {
    res.set('Content-Type', 'text/event-stream').write('data: ready\n\n');
    res.on('close', releaseStream);
  });
  const target = await listen(upstream);
  upstreamUrl = 'http://127.0.0.1:' + target.address().port;
  const site = express();
  site.use((req, _res, next) => { req.session = { user: { id: 'member' } }; next(); });
  site.use('/connect/:slug', connectionProxy);
  const server = await listen(site);
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch('http://127.0.0.1:' + server.address().port + '/connect/reports/feed', { signal: controller.signal });
    assert.equal(response.headers.get('x-accel-buffering'), 'no');
    const chunk = await response.body.getReader().read();
    assert.equal(new TextDecoder().decode(chunk.value), 'data: ready\n\n');
    controller.abort();
    await upstreamClosed;
  } finally { clearTimeout(deadline); await stop(server); await stop(target); }
});

test('proxy preserves binary ranges and compressed attachments while updating transformed HTML metadata', async () => {
  const { gzipSync } = require('node:zlib');
  const http = require('node:http');
  const markup = Buffer.from('<a href="/child">link</a>');
  const compressed = gzipSync(markup);
  const upstream = express();
  upstream.get('/range', (_req, res) => res.status(206).set({
    'Content-Type': 'application/octet-stream', 'Content-Range': 'bytes 1-3/8', ETag: '"slice"',
  }).end(Buffer.from([0,128,255])));
  upstream.get('/:page', (req, res) => {
    res.set({ 'Content-Type': 'text/html', 'Content-Encoding': 'gzip', ETag: '"upstream"' });
    if (req.params.page === 'file') res.set('Content-Disposition','attachment; filename="report.html"');
    res.end(compressed);
  });
  const target = await listen(upstream);
  upstreamUrl = 'http://127.0.0.1:' + target.address().port;
  const app = express();
  app.use((req, _res, next) => { req.session = { user: { id: 'member' } }; next(); });
  app.use('/connect/:slug', connectionProxy);
  const server = await listen(app);
  const read = path => new Promise((resolve,reject) => {
    http.get('http://127.0.0.1:' + server.address().port + '/connect/site/' + path, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.once('end', () => resolve({ status:res.statusCode, headers:res.headers, body:Buffer.concat(chunks) }));
      res.on('error', reject);
    }).on('error', reject);
  });
  try {
    const slice = await read('range');
    assert.equal(slice.status,206);
    assert.equal(slice.headers['content-range'],'bytes 1-3/8');
    assert.deepEqual(slice.body,Buffer.from([0,128,255]));
    const attachment = await read('file');
    assert.equal(attachment.headers['content-encoding'],'gzip');
    assert.deepEqual(attachment.body,compressed);
    const html = await read('page');
    assert.match(html.body.toString(),/href="\/connect\/site\/__upstream_root__\/child"/);
    assert.equal(Number(html.headers['content-length']),html.body.length);
    assert.equal(html.headers['content-encoding'],undefined);
    assert.equal(html.headers.etag,undefined);
  } finally { await stop(server); await stop(target); }
});
