const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const { once } = require('node:events');
const WebSocket = require('ws');
const signature = require('cookie-signature');
const { Server: SocketIOServer } = require('socket.io');

let poolsClosed = 0;
for (const [modulePath, exports] of [
  ['../src/db', { getPool: async () => {}, closePool: async () => { poolsClosed++; } }],
  ['../src/middleware/remote_auth', { userHasRemoteAccess: async () => true }],
]) {
  const filename = require.resolve(modulePath);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}
const { attachSshServer } = require('../src/ssh_server');
const { stopServer } = require('../src/server');
const cookie = 'connect.sid=' + encodeURIComponent('s:' + signature.sign('test-session', 'test-secret'));
const options = store => ({ sessionCookieName: 'connect.sid', sessionSecret: 'test-secret', sessionStore: store });

test('shutdown closes authenticated SSH upgrades before Socket.IO closes the shared HTTP server', { timeout: 2000 }, async t => {
  const server = http.createServer();
  server.sshServer = attachSshServer(server, options({ get: (id, callback) => callback(null, { user: { id: 'user' } }) }));
  server.rdpServer = new SocketIOServer(server, { transports: ['websocket'], serveClient: false });
  let proxyClosed = false;
  server.connectionProxyServer = { closeAll: () => { proxyClosed = true; } };
  server.chromiumServer = { closeAll: async () => {} };
  server.clashSync = { stop: async () => {} };
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.sshServer.closeAll(); server.rdpServer.engine.close(); server.close(); });
  const socket = new WebSocket(`ws://127.0.0.1:${server.address().port}/api/ssh`, { headers: { cookie } });
  await once(socket, 'open');
  const closed = once(socket, 'close');
  await stopServer(server);
  await closed;
  assert.equal(proxyClosed, true);
  assert.equal(server.listening, false);
  assert.equal(poolsClosed, 1);
});

test('SSH shutdown also destroys upgrades waiting for Session authorization', { timeout: 2000 }, async t => {
  const server = http.createServer();
  let releaseSession;
  let started;
  const authorizing = new Promise(resolve => { started = resolve; });
  const ssh = attachSshServer(server, options({ get: (id, callback) => { releaseSession = callback; started(); } }));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { ssh.closeAll(); server.close(); });
  const socket = net.connect(server.address().port, '127.0.0.1');
  await once(socket, 'connect');
  socket.write(`GET /api/ssh HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nCookie: ${cookie}\r\n\r\n`);
  await authorizing;
  const disconnected = once(socket, 'close');
  ssh.closeAll();
  await disconnected;
  releaseSession(null, { user: { id: 'user' } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ssh.clients.size, 0);
  await new Promise(resolve => server.close(resolve));
});
