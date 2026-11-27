const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig, buildPoolOptions } = require('../src/db/pool');
const { buildTrustProxy } = require('../src/config/server');
const { MySqlRateLimitStore } = require('../src/rate_limit_store');

test('environment database config requires an explicit account and database', () => {
  assert.throws(() => loadConfig({ DB_HOST: 'db.internal' }), /DB_USER/);
  assert.throws(() => loadConfig({ DB_HOST: 'db.internal', DB_USER: 'web' }), /DB_NAME/);
  assert.throws(() => loadConfig({ DB_HOST: 'db', DB_USER: 'web', DB_NAME: 'web', DB_PORT: 'bad' }), /DB_PORT/);
  const cfg = loadConfig({ DB_HOST: 'db.internal', DB_USER: 'web', DB_NAME: 'liulian', DB_PASSWORD: ' secret ', DB_PORT: '3307' });
  assert.equal(buildPoolOptions(cfg).host, 'db.internal');
  assert.equal(buildPoolOptions(cfg).port, 3307);
  assert.equal(buildPoolOptions(cfg).password, ' secret ');
  const ssl = { ca: 'test-ca', rejectUnauthorized: true };
  assert.deepEqual(buildPoolOptions({ ...cfg, ssl }).ssl, ssl);
});

test('proxy trust can be constrained to actual ingress addresses', () => {
  assert.equal(buildTrustProxy({}, false), false);
  assert.equal(buildTrustProxy({}, true), 1);
  assert.equal(buildTrustProxy({ TRUST_PROXY: 'false' }, true), false);
  assert.equal(buildTrustProxy({ TRUST_PROXY: '2' }), 2);
  assert.deepEqual(buildTrustProxy({ TRUST_PROXY: '127.0.0.1, 10.1.0.0/16' }), ['127.0.0.1', '10.1.0.0/16']);
  assert.throws(() => buildTrustProxy({ TRUST_PROXY: 'true' }), /TRUST_PROXY/);
});

test('rate-limit buckets agree across nodes and isolate IPs from usernames', () => {
  const first = new MySqlRateLimitStore('auth-account');
  const second = new MySqlRateLimitStore('auth-account');
  const ip = new MySqlRateLimitStore('auth-ip');
  assert.equal(first.bucket('alice'), second.bucket('alice'));
  assert.notEqual(first.bucket('alice'), ip.bucket('alice'));
  assert.notEqual(first.bucket('Alice'), first.bucket('alice'));
  assert.ok(first.bucket('alice').length <= 96);
  assert.ok(!first.bucket('alice').includes('alice'));
});

test('store commits before exposing database counts and always releases connections', async () => {
  const events = [];
  const conn = {
    beginTransaction: async () => events.push('begin'),
    execute: async sql => sql.startsWith('SELECT') ? [[{ hits: 11, expires_at: '1900000000000' }]] : [{}],
    commit: async () => events.push('commit'),
    rollback: async () => events.push('rollback'),
    release: () => events.push('release'),
  };
  const store = new MySqlRateLimitStore('test', async () => ({ getConnection: async () => conn }));
  store.init({ windowMs: 900000 });
  assert.deepEqual(await store.increment('alice'), { totalHits: 11, resetTime: new Date(1900000000000) });
  assert.deepEqual(events, ['begin', 'commit', 'release']);
  events.length = 0;
  conn.execute = async () => { throw new Error('database unavailable'); };
  await assert.rejects(store.increment('alice'), /database unavailable/);
  assert.deepEqual(events, ['begin', 'rollback', 'release']);
});
