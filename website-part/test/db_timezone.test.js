const test = require('node:test');
const assert = require('node:assert/strict');

test('database DATETIME values are always interpreted as UTC', () => {
  const { buildPoolOptions } = require('../src/db/pool');
  const options = buildPoolOptions({});
  assert.equal(options.timezone, 'Z');
  assert.equal(options.supportBigNumbers, true);
  assert.equal(options.bigNumberStrings, true);
});

test('every new connection waits for SQL UTC initialization before checkout', async () => {
  const { initializePoolTimeZone } = require('../src/db/pool');
  const callbacks = [];
  const connections = [0, 1].map(() => ({
    query(sql, callback) { assert.equal(sql, "SET SESSION time_zone = '+00:00'"); callbacks.push(callback); },
    destroy() { assert.fail('healthy connection must stay open'); },
  }));
  let current = connections[0];
  const pool = initializePoolTimeZone({ pool: { getConnection(callback) { callback(null, current); } } });
  let acquired = false;
  pool.pool.getConnection((err, connection) => { assert.ifError(err); assert.equal(connection, current); acquired = true; });
  assert.equal(acquired, false);
  callbacks.shift()(null);
  assert.equal(acquired, true);
  pool.pool.getConnection(err => assert.ifError(err));
  assert.equal(callbacks.length, 0, 'reused connections are already initialized');
  current = connections[1];
  acquired = false;
  pool.pool.getConnection(err => { assert.ifError(err); acquired = true; });
  assert.equal(acquired, false);
  callbacks.shift()(null);
  assert.equal(acquired, true);
});

test('UTC initialization failures reject checkout and discard the connection', () => {
  const { initializePoolTimeZone } = require('../src/db/pool');
  const failure = new Error('SET failed');
  let destroyed = false;
  const connection = { query(_sql, callback) { callback(failure); }, destroy() { destroyed = true; } };
  const pool = initializePoolTimeZone({ pool: { getConnection(callback) { callback(null, connection); } } });
  pool.pool.getConnection(err => assert.equal(err, failure));
  assert.equal(destroyed, true);
});
