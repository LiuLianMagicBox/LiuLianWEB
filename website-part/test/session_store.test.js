const test = require('node:test');
const assert = require('node:assert/strict');
const { MySqlSessionStore, sessionExpiry } = require('../src/session_store');

function callStore(store, method, ...args) {
  return new Promise((resolve, reject) => {
    store[method](...args, (err, value) => err ? reject(err) : resolve(value));
  });
}

test('uses the cookie expiration when persisting a remembered session', () => {
  const expires = new Date(Date.now() + 30 * 86400000);
  assert.equal(sessionExpiry({ cookie: { expires } }, 1000), expires.getTime());
});

test('falls back to server TTL for browser-session cookies', () => {
  const before = Date.now() + 60000;
  const expiresAt = sessionExpiry({ cookie: {} }, 60000);
  const after = Date.now() + 60000;
  assert.ok(expiresAt >= before && expiresAt <= after);
});

test('stores, retrieves, touches, and destroys sessions with parameterized queries', async () => {
  const calls = [];
  const saved = JSON.stringify({ cookie: {}, user: { id: 'user-1' } });
  const pool = {
    execute: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.startsWith('SELECT session_version')) return [[{ session_version: 0 }]];
      if (sql.startsWith('SELECT')) return [[{ data: saved }]];
      return [{ affectedRows: 1 }];
    },
    getConnection: async () => ({
      execute: (...args) => pool.execute(...args),
      beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release() {},
    }),
  };
  const store = new MySqlSessionStore({ getPool: async () => pool });

  await callStore(store, 'set', 'session-1', JSON.parse(saved));
  assert.deepEqual(await callStore(store, 'get', 'session-1'), JSON.parse(saved));
  await callStore(store, 'touch', 'session-1', JSON.parse(saved));
  await callStore(store, 'destroy', 'session-1');

  assert.equal(calls.length, 6);
  assert.match(calls[0].sql, /FOR UPDATE/);
  assert.deepEqual(calls[1].params.slice(0, 2), ['session-1', saved]);
  assert.deepEqual(calls[2].params[0], 'session-1');
  assert.match(calls[3].sql, /FOR UPDATE/);
  assert.deepEqual(calls[4].params[1], 'session-1');
  assert.deepEqual(calls[5].params, ['session-1']);
});

test('late saves cannot restore revoked sessions or overwrite the preserved current session', async () => {
  const { getStoredSession } = require('../src/websocket_session');
  const sessions = new Map();
  let userVersion = 0;
  let touched = 0;
  let userExists = true;
  const events = [];
  const pool = { async execute(sql, params) {
    if (sql.startsWith('SELECT session_version')) {
      assert.match(sql, /FOR UPDATE/);
      events.push('lock-user');
      return [userExists ? [{ session_version: userVersion }] : []];
    }
    if (sql.startsWith('INSERT INTO website_sessions')) {
      events.push('write-session');
      sessions.set(params[0], { data: params[1], expires: params[2] });
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith('SELECT s.data')) {
      assert.match(sql, /u\.session_version =\s+CAST\(COALESCE/);
      const row = sessions.get(params[0]);
      const data = row && JSON.parse(row.data);
      const valid = data && row.expires > params[1] && (!data.user ||
        (userExists && Number(data.user.sessionVersion || 0) === userVersion));
      return [valid ? [{ data: row.data }] : []];
    }
    if (sql.startsWith('UPDATE website_sessions')) touched += 1;
    if (sql.includes('WHERE JSON_UNQUOTE')) {
      for (const [sid, row] of sessions) {
        if (JSON.parse(row.data).user?.id === params[0] && sid !== params[1]) sessions.delete(sid);
      }
    }
    return [{ affectedRows: 1 }];
  }, async getConnection() { return {
    execute: (...args) => pool.execute(...args),
    beginTransaction: async () => events.push('begin'),
    commit: async () => events.push('commit'),
    rollback: async () => events.push('rollback'),
    release: () => events.push('release'),
  }; } };
  const store = new MySqlSessionStore({ getPool: async () => pool });
  const legacy = { cookie: {}, user: { id: 'user-1', username: 'player' } };
  await callStore(store, 'set', 'current', legacy);
  await callStore(store, 'set', 'other', legacy);
  assert.ok(await getStoredSession(store, 'other'), 'legacy version zero remains compatible');
  assert.deepEqual(events.slice(0, 5), ['begin', 'lock-user', 'write-session', 'commit', 'release']);

  userVersion += 1; // the password transaction has committed
  const current = { ...legacy, user: { ...legacy.user, sessionVersion: 1 } };
  await callStore(store, 'set', 'current', current);
  assert.equal(await getStoredSession(store, 'other'), null, 'revocation applies even before physical deletion');
  await callStore(store, 'destroyUserSessions', 'user-1', 'current');
  await assert.rejects(callStore(store, 'set', 'other', legacy), { code: 'SESSION_INVALIDATED' });
  await assert.rejects(callStore(store, 'set', 'current', legacy), { code: 'SESSION_INVALIDATED' });
  await callStore(store, 'touch', 'current', legacy);
  assert.equal(touched, 0, 'a stale request cannot alter the preserved session expiration');
  await callStore(store, 'touch', 'current', current);
  assert.equal(touched, 1);
  assert.equal(sessions.has('other'), false);
  assert.equal((await getStoredSession(store, 'current')).user.sessionVersion, 1);
  userExists = false;
  assert.equal(await getStoredSession(store, 'current'), null, 'deleted accounts cannot retain authentication');
  await assert.rejects(callStore(store, 'set', 'current', current), { code: 'SESSION_INVALIDATED' });
});
