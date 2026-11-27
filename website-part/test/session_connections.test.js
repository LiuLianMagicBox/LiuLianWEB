const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter, once } = require('node:events');
const http = require('node:http');
const { generateKeyPairSync } = require('node:crypto');
const { Server } = require('ssh2');
const WebSocket = require('ws');
const { createSessionConnections } = require('../src/services/session_connections');
const { MySqlSessionStore } = require('../src/session_store');

test('revoking a session on another node closes its established SSH shell', { timeout: 15000 }, async t => {
  const auth = require('../src/middleware/remote_auth');
  t.mock.method(auth, 'userHasRemoteAccess', async id => id === 'member');
  const { attachSshServer } = require('../src/ssh_server');
  const old = process.env.SSH_ALLOWED_HOSTS;
  process.env.SSH_ALLOWED_HOSTS = '127.0.0.1';
  t.after(() => { if (old === undefined) delete process.env.SSH_ALLOWED_HOSTS; else process.env.SSH_ALLOWED_HOSTS = old; });

  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs1', format: 'pem' } });
  const connections = new Set();
  const sshd = new Server({ hostKeys: [privateKey] }, client => {
    connections.add(client);
    client.on('error', () => {});
    client.on('close', () => connections.delete(client));
    client.on('authentication', context => context.method === 'password' && context.password === 'fixture' ? context.accept() : context.reject());
    client.on('ready', () => client.on('session', accept => {
      const session = accept();
      session.on('pty', permit => permit());
      session.on('shell', permit => permit());
    }));
  });
  sshd.listen(0, '127.0.0.1');
  await once(sshd, 'listening');

  const db = new Set(['device']);
  const store = new EventEmitter();
  store.get = (id, cb) => cb(null, db.has(id) ? { user: { id: 'member' } } : null);
  store.activeSessionIds = async ids => new Set(ids.filter(id => db.has(id)));
  const monitor = createSessionConnections(store);
  const server = http.createServer();
  const secret = 'test-session-secret';
  const ssh = attachSshServer(server, { sessionCookieName: 'sid', sessionSecret: secret, sessionStore: store, sessionConnections: monitor });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const signed = require('cookie-signature').sign('device', secret);
  const socket = new WebSocket('ws://127.0.0.1:' + server.address().port + '/api/ssh', { headers: { cookie: 'sid=s:' + signed } });
  t.after(async () => {
    monitor.stop(); ssh.closeAll(); socket.terminate();
    for (const client of connections) client.end();
    await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => sshd.close(resolve))]);
  });
  await once(socket, 'open');
  const ready = once(socket, 'message');
  socket.send(JSON.stringify({ type: 'connect', host: '127.0.0.1', port: sshd.address().port, username: 'local', password: 'fixture' }));
  assert.equal(JSON.parse((await ready)[0]).type, 'connected');
  const clientClosed = new Promise(resolve => [...connections][0].once('close', resolve));
  const browserClosed = once(socket, 'close');
  db.delete('device');
  await monitor.check();
  await Promise.all([clientClosed, browserClosed]);
});

test('monitor forgets finished transports and closes idle transports if the database stalls', async t => {
  const store = new EventEmitter();
  let finish;
  store.activeSessionIds = () => new Promise(resolve => { finish = resolve; });
  const monitor = createSessionConnections(store, 5000, 15);
  t.after(() => monitor.stop());
  const finished = new EventEmitter();
  monitor.track('finished', finished, 'end', () => assert.fail('already closed'));
  finished.emit('end');
  const closed = [];
  monitor.track('live', new EventEmitter(), 'end', () => closed.push('live'));
  const check = monitor.check();
  await new Promise(resolve => setTimeout(resolve, 50));
  monitor.track('new', new EventEmitter(), 'end', () => closed.push('new'));
  assert.deepEqual(closed, ['live', 'new']);
  finish(new Set()); await check;
});

test('device listing handles MySQL integer strings and hides raw session identifiers', async () => {
  const store = new MySqlSessionStore({ getPool: async () => ({ execute: async (sql, args) => {
    assert.match(sql, /SHA2\(s.sid,256\)/);
    assert.deepEqual(args.slice(0,2), ['current-session', 'owner']);
    return [[{ id: 'hash1', current: '1' }, { id: 'hash2', current: '0' }]];
  } }) });
  const devices = await store.listDevices('owner','current-session');
  assert.deepEqual(devices.map(d => d.current), [true,false]);
  assert.ok(devices.every(d => !Object.hasOwn(d, 'sid')));
});
