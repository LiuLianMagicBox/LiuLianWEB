const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { netbirdConfig, createNetbirdClient, validate, identifier } = require('../src/services/netbird');
const { errorHandler } = require('../src/middleware/error_handler');
const { originCheck } = require('../src/middleware/origin_check');
const { AppError } = require('../src/errors');

const config = { apiUrl: 'https://netbird.example/api', token: 'private-token' };
const peer = { name: 'server', ssh_enabled: false, login_expiration_enabled: true, inactivity_expiration_enabled: false };
const resource = { name: 'LAN', address: '192.168.0.0/24', groups: ['group1'], enabled: true };
const router = { peer: 'peer1', metric: 100, masquerade: true, enabled: true };

test('NetBird config stays disabled without a token and validates the fixed HTTPS API URL', () => {
  assert.equal(netbirdConfig({}), null);
  assert.deepEqual(netbirdConfig({ NETBIRD_API_TOKEN: ' abc ' }), { apiUrl: 'https://api.netbird.io/api', token: 'abc' });
  assert.equal(netbirdConfig({ NETBIRD_API_TOKEN: 'abc', NETBIRD_API_URL: 'https://host/prefix/api/' }).apiUrl, 'https://host/prefix/api');
  for (const url of ['http://host/api', 'https://a:b@host/api', 'https://host/api?x=1', 'https://host/api#x', 'https://host', 'broken']) {
    assert.throws(() => netbirdConfig({ NETBIRD_API_TOKEN: 'abc', NETBIRD_API_URL: url }), /Invalid NetBird/);
  }
  assert.throws(() => netbirdConfig({ NETBIRD_API_TOKEN: 'abc\nsecret' }));
});

test('NetBird inputs restrict IDs, write fields, addresses and routing peer selection', () => {
  for (const value of ['../users', '%2f', 'https://host', '', 'a'.repeat(65)]) assert.throws(() => identifier(value));
  assert.deepEqual(validate('peers', peer), peer);
  for (const body of [{ ...peer, token: 'x' }, { name: 'server' }, { ...peer, ssh_enabled: 'false' }, []]) assert.throws(() => validate('peers', body));
  for (const address of ['10.0.0.1', '10.0.0.0/8', '::1', '2001:db8::/64', 'example.com', '*.example.com']) {
    assert.equal(validate('resources', { ...resource, address }).address, address);
  }
  for (const address of ['https://host', '10.0.0.0/33', '::/129', '10.1.1.1/-1', '127.0.0.1/8/1', 'bad domain', '256.1.1.1']) assert.throws(() => validate('resources', { ...resource, address }));
  assert.deepEqual(validate('routers', router), router);
  assert.deepEqual(validate('routers', { ...router, peer: undefined, peer_groups: ['g1'] }).peer_groups, ['g1']);
  for (const body of [{ ...router, peer_groups: ['g1'] }, { ...router, peer: '' }, { ...router, metric: 0 }, { ...router, metric: 10000 }, { ...router, metric: 1.5 }, { ...router, enabled: 1 }]) assert.throws(() => validate('routers', body));
});

test('NetBird client authenticates server-side, times out, refuses redirects and handles empty deletes', async () => {
  const calls = [];
  const client = createNetbirdClient(config, async (url, options) => {
    calls.push({ url, options });
    return options.method === 'DELETE' ? new Response(null, { status: 204 }) : Response.json([]);
  });
  assert.deepEqual(await client.request('/peers'), []);
  assert.equal(await client.request('/peers/peer1', 'DELETE'), null);
  assert.equal(calls[0].url, config.apiUrl + '/peers');
  assert.equal(calls[0].options.headers.Authorization, 'Token private-token');
  assert.equal(calls[0].options.redirect, 'error');
  assert.ok(calls[0].options.signal instanceof AbortSignal);
});

test('NetBird failures never expose upstream bodies or credentials and bound response size', async () => {
  for (const [status, expected] of [[400,400], [401,502], [403,502], [404,404], [409,409], [429,503], [500,503], [302,503]]) {
    const client = createNetbirdClient(config, async () => new Response('private-token upstream detail', { status }));
    await assert.rejects(client.request('/peers'), error => error.statusCode === expected && !error.message.includes('private-token'));
  }
  for (const fetchImpl of [async () => { throw new Error('private-token'); }, async () => new Response('not json'), async () => new Response('x'.repeat(2 * 1024 * 1024 + 1))]) {
    await assert.rejects(createNetbirdClient(config, fetchImpl).request('/peers'), error => error.code === 'NETBIRD_UNAVAILABLE' && !error.message.includes('private-token'));
  }
});

test('NetBird admin API enforces real admin middleware, CSRF, validation, nested CRUD and audit', async t => {
  let actor;
  const db = require('../src/db');
  t.mock.method(db, 'findUserById', async () => actor);
  // Load the real middleware after mocking the repository lookup.
  const { createRouter } = require('../src/routes/netbird');
  const calls = [], audits = [];
  let upstreamError = null, auditError = false;
  const client = { request: async (path, method = 'GET', body) => {
    calls.push({ path, method, body });
    if (upstreamError) throw upstreamError;
    if (method === 'DELETE') return null;
    const row = { id: 'item1', ...peer, ...body, groups: [], api_token: 'private-token' };
    return method === 'GET' ? [row] : row;
  } };
  const app = express();
  app.use((req, _res, next) => { req.session = actor ? { user: actor } : {}; next(); });
  app.use(originCheck, express.json());
  app.use('/api/admin/netbird', createRouter({ config, client, audit: async (entry, outcome) => {
    if (auditError) throw new Error('DB unavailable');
    audits.push({ entry, outcome });
  } }));
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const request = (path, method = 'GET', body, headers = {}) => fetch(`http://127.0.0.1:${server.address().port}/api/admin/netbird${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...headers }, body: body && JSON.stringify(body),
  });
  for (const [method, path] of [['GET','/status'], ['GET','/peers'], ['PUT','/peers/p1'], ['POST','/networks'], ['DELETE','/networks/n1/resources/r1']]) {
    assert.equal((await request(path, method)).status, 401);
  }
  actor = { id: 'member', role_name: 'user' };
  assert.equal((await request('/networks')).status, 403);
  assert.equal(calls.length, 0);
  actor = { id: 'admin1', role_name: 'admin' };
  assert.equal((await request('/networks', 'POST', { name: 'LAN' }, { origin: 'https://evil.test' })).status, 403);
  const list = await request('/peers');
  assert.equal(list.headers.get('cache-control'), 'no-store');
  assert.equal(JSON.stringify(await list.json()).includes('private-token'), false);
  assert.deepEqual(await (await request('/status')).json(), { configured: true });
  const before = calls.length;
  assert.equal((await request('/peers/p1', 'PUT', { ...peer, api_token: 'bad' })).status, 400);
  assert.equal((await request('/networks/n%2F1/resources')).status, 400);
  assert.equal(calls.length, before);
  for (const [path, body] of [['/networks', { name: 'LAN', description: 'home' }], ['/networks/n1/resources', resource], ['/networks/n1/routers', router]]) {
    assert.equal((await request(path, 'POST', body)).status, 201);
    assert.equal((await request(path + '/item1', 'PUT', body)).status, 200);
    assert.equal((await request(path + '/item1', 'DELETE')).status, 204);
  }
  assert.equal((await request('/peers/p1', 'PUT', peer)).status, 200);
  assert.equal((await request('/peers/p1', 'DELETE')).status, 204);
  assert.equal(audits.at(-1).entry.actor, actor.id);
  assert.equal(audits.at(-1).entry.action, 'netbird_peers_delete');
  assert.equal(audits.at(-1).outcome, 'success');
  upstreamError = new AppError('gone', 404);
  assert.equal((await request('/peers/p1', 'DELETE')).status, 404);
  assert.equal(audits.at(-1).outcome, 'rejected');
  upstreamError = new AppError('timeout', 503);
  assert.equal((await request('/peers/p1', 'DELETE')).status, 503);
  assert.equal(audits.at(-1).outcome, 'failed');
  upstreamError = null; auditError = true;
  const failedAudit = await request('/peers/p1', 'DELETE');
  assert.equal(failedAudit.status, 503);
  assert.equal((await failedAudit.json()).code, 'NETBIRD_AUDIT_FAILED');
});

test('unconfigured NetBird reports status without making network requests', async t => {
  const { createRouter } = require('../src/routes/netbird');
  const app = express().use(createRouter({ config: null, adminAuth: (_req, _res, next) => next() }), errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  assert.deepEqual(await (await fetch(url + '/status')).json(), { configured: false });
  assert.equal((await fetch(url + '/peers')).status, 503);
});
