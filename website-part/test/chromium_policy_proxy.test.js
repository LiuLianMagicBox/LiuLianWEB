const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const { once } = require('node:events');
const { createChromiumPolicyProxy, proxySettings } = require('../src/services/chromium_policy_proxy');
const { assertSafeDestination } = require('../src/services/chromium');
const listen = async server => { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return server.address().port; };
const stop = server => new Promise(resolve => { server.close(resolve); server.closeAllConnections?.(); });
const request = (proxy, target, options = {}) => new Promise((resolve, reject) => {
  const url = new URL(proxy.proxyServer);
  const req = http.request({ hostname: url.hostname, port: url.port, path: target, ...options }, res => {
    const chunks = []; res.on('data', chunk => chunks.push(chunk));
    res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
  });
  req.on('error', reject); req.end(options.body);
});

test('HTTP policy proxy pins the approved DNS address and forwards allowed requests', async t => {
  let lookups = 0;
  t.mock.method(require('node:dns').promises, 'lookup', async hostname => {
    assert.equal(hostname, 'allowed.test'); lookups++;
    return [{ address: '127.0.0.1', family: 4 }];
  });
  let received;
  const upstream = http.createServer((req, res) => {
    received = { host: req.headers.host, cookie: req.headers.cookie, proxyAuthorization: req.headers['proxy-authorization'] };
    if (req.url === '/forbidden') { res.writeHead(403); res.end('upstream forbidden'); return; }
    req.pipe(res);
  });
  const port = await listen(upstream);
  const proxy = await createChromiumPolicyProxy({ env: { CHROMIUM_ALLOWED_HOSTS: 'allowed.test' }, assertDestination: assertSafeDestination });
  try {
    const result = await request(proxy, `http://allowed.test:${port}/upload`, { method: 'POST', body: 'allowed data', headers: { Cookie: 'session=value', 'Proxy-Authorization': 'proxy-secret' } });
    assert.deepEqual(result, { status: 200, body: 'allowed data' });
    assert.deepEqual(received, { host: `allowed.test:${port}`, cookie: 'session=value', proxyAuthorization: undefined });
    assert.equal(lookups, 1, 'the network connection uses the validated DNS snapshot');
    await assert.rejects(request(proxy, `http://127.0.0.1:${port}/private`), /socket hang up|ECONNRESET/);
    assert.deepEqual(await request(proxy, `http://allowed.test:${port}/forbidden`), { status: 403, body: 'upstream forbidden' });
  } finally { await proxy.close(); await stop(upstream); }
});

test('CONNECT tunnels obey the same destination policy and are closed with their session', async () => {
  let accepted = 0;
  const upstream = net.createServer(socket => { accepted++; socket.pipe(socket); });
  const port = await listen(upstream);
  const proxy = await createChromiumPolicyProxy({ assertDestination: async url => {
    if (new URL(url).hostname !== 'allowed.test') throw new Error('blocked');
    return ['127.0.0.1'];
  } });
  const endpoint = new URL(proxy.proxyServer);
  const socket = net.connect(Number(endpoint.port), endpoint.hostname); socket.on('error', () => {});
  try {
    await once(socket, 'connect');
    socket.write(`CONNECT allowed.test:${port} HTTP/1.1\r\nHost: allowed.test:${port}\r\n\r\n`);
    const [headers] = await once(socket, 'data'); assert.match(headers.toString(), /200 Connection Established/);
    socket.write('tunnel data'); const [echo] = await once(socket, 'data'); assert.equal(echo.toString(), 'tunnel data');
    assert.equal(accepted, 1);
    const closed = once(socket, 'close'); await proxy.close(); await closed;
    assert.equal(socket.destroyed, true);
  } finally { socket.destroy(); await proxy.close(); await stop(upstream); }
});

test('plain WebSocket upgrades preserve the handshake and stream bytes through the pinned upstream', async () => {
  let receivedPath;
  const upstream = http.createServer();
  upstream.on('upgrade', (req, socket) => {
    receivedPath = req.url;
    socket.on('error', () => {});
    socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n');
    socket.pipe(socket);
  });
  const port = await listen(upstream);
  const proxy = await createChromiumPolicyProxy({ assertDestination: async url => {
    assert.equal(new URL(url).hostname, 'allowed.test'); return ['127.0.0.1'];
  } });
  const endpoint = new URL(proxy.proxyServer);
  const socket = net.connect(Number(endpoint.port), endpoint.hostname); socket.on('error', () => {});
  try {
    await once(socket, 'connect');
    socket.write(`GET http://allowed.test:${port}/socket HTTP/1.1\r\nHost: allowed.test:${port}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`);
    const [headers] = await once(socket, 'data'); assert.match(headers.toString(), /101 Switching Protocols/);
    socket.write('websocket bytes'); const [echo] = await once(socket, 'data'); assert.equal(echo.toString(), 'websocket bytes');
    assert.equal(receivedPath, '/socket');
  } finally { socket.destroy(); await proxy.close(); await stop(upstream); }
});

test('proxy client ACL rejects unauthorized peers before performing a destination lookup', async () => {
  let lookups = 0;
  const proxy = await createChromiumPolicyProxy({ env: { CHROMIUM_PROXY_ALLOWED_CLIENT_IPS: '192.0.2.20' },
    assertDestination: async () => { lookups++; return ['127.0.0.1']; } });
  try {
    await assert.rejects(request(proxy, 'http://allowed.test/'));
    assert.equal(lookups, 0);
  } finally { await proxy.close(); }
});

test('remote proxy settings require explicit endpoint and client IP restrictions', () => {
  assert.throws(() => proxySettings({}, 'http://remote.test:9222'), /Remote Chromium requires/);
  assert.throws(() => proxySettings({ CHROMIUM_PROXY_ALLOWED_CLIENT_IPS: 'browser.test' }), /must contain IP addresses/);
  const settings = proxySettings({ CHROMIUM_PROXY_BIND_HOST: '0.0.0.0', CHROMIUM_PROXY_ADVERTISED_HOST: 'proxy.internal',
    CHROMIUM_PROXY_ALLOWED_CLIENT_IPS: '192.168.0.20,::ffff:192.168.0.21' }, 'http://remote.test:9222');
  assert.equal(settings.advertisedHost, 'proxy.internal');
  assert.deepEqual([...settings.allowed], ['192.168.0.20', '192.168.0.21']);
});

for (const method of ['GET', 'CONNECT']) {
  test(`closing the proxy cancels ${method} clients awaiting DNS without opening a late upstream socket`, async () => {
    let resolveLookup;
    let started;
    const checking = new Promise(resolve => { started = resolve; });
    let upstreamConnections = 0;
    const upstream = net.createServer(socket => { upstreamConnections++; socket.destroy(); });
    const port = await listen(upstream);
    const proxy = await createChromiumPolicyProxy({ assertDestination: () => {
      started(); return new Promise(resolve => { resolveLookup = resolve; });
    } });
    const endpoint = new URL(proxy.proxyServer);
    const socket = net.connect(Number(endpoint.port), endpoint.hostname); socket.on('error', () => {});
    try {
      await once(socket, 'connect');
      const target = method === 'CONNECT' ? `allowed.test:${port}` : `http://allowed.test:${port}/`;
      socket.write(`${method} ${target} HTTP/1.1\r\nHost: allowed.test:${port}\r\n\r\n`);
      await checking;
      const closed = once(socket, 'close');
      await proxy.close(); await closed;
      resolveLookup(['127.0.0.1']);
      await new Promise(resolve => setTimeout(resolve, 20));
      assert.equal(upstreamConnections, 0);
    } finally { socket.destroy(); await proxy.close(); await stop(upstream); }
  });
}
