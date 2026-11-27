const test = require('node:test');
const assert = require('node:assert/strict');
const { MySqlSessionStore } = require('../src/session_store');

function loadUsers(pool) {
  const poolModule = require('../src/db/pool');
  const original = poolModule.getPool;
  const usersPath = require.resolve('../src/db/users');
  const originalUsers = require.cache[usersPath];
  try {
    poolModule.getPool = async () => pool;
    delete require.cache[usersPath];
    return require(usersPath);
  } finally {
    poolModule.getPool = original;
    if (originalUsers) require.cache[usersPath] = originalUsers;
    else delete require.cache[usersPath];
  }
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function versionedDatabase() {
  const state = { password: 'old-hash', version: 0, sessions: new Map(), released: 0, rolledBack: 0 };
  let lockTail = Promise.resolve();
  const firstWrite = deferred();
  const allowWrite = deferred();
  let shouldHoldWrite = false;
  const pool = {
    async getConnection() {
      let unlock;
      let pendingPassword;
      let pendingSession;
      let revokeUser;
      return {
        async beginTransaction() {},
        async execute(sql, params) {
          if (sql.startsWith('SELECT session_version')) {
            assert.match(sql, /FOR UPDATE/);
            const previous = lockTail;
            lockTail = new Promise(done => { unlock = done; });
            await previous;
            return [[{ session_version: state.version }]];
          }
          if (sql.startsWith('UPDATE website_users')) {
            assert.match(sql, /session_version = session_version \+ 1/);
            pendingPassword = params[0];
          }
          if (sql.startsWith('DELETE FROM website_sessions')) {
            assert.match(sql, /JSON_UNQUOTE\(JSON_EXTRACT\(data, '\$\.user\.id'\)\) = \?/);
            [revokeUser] = params;
          }
          if (sql.startsWith('INSERT INTO website_sessions')) {
            if (shouldHoldWrite) {
              shouldHoldWrite = false;
              firstWrite.resolve();
              await allowWrite.promise;
            }
            pendingSession = params;
          }
          return [{ affectedRows: 1 }];
        },
        async commit() {
          if (pendingPassword) { state.password = pendingPassword; state.version += 1; }
          if (revokeUser) {
            for (const [sid, data] of state.sessions) {
              if (JSON.parse(data).user.id === revokeUser) state.sessions.delete(sid);
            }
          }
          if (pendingSession) state.sessions.set(pendingSession[0], pendingSession[1]);
          unlock?.();
        },
        async rollback() { state.rolledBack += 1; unlock?.(); },
        release() { state.released += 1; },
      };
    },
    async execute(sql, params) {
      if (sql.startsWith('SELECT s.data')) {
        assert.match(sql, /u\.session_version/);
        const data = state.sessions.get(params[0]);
        return [data && (JSON.parse(data).user.sessionVersion || 0) === state.version ? [{ data }] : []];
      }
      return [{ affectedRows: 1 }];
    },
  };
  return { state, pool, firstWrite, allowWrite, holdWrite() { shouldHoldWrite = true; } };
}

const call = (store, method, ...args) => new Promise((resolve, reject) => {
  store[method](...args, (err, value) => err ? reject(err) : resolve(value));
});

test('password and session version change together, while stale password changes roll back', async () => {
  const fixture = versionedDatabase();
  const { updatePasswordHash } = loadUsers(fixture.pool);
  assert.equal(await updatePasswordHash('u1', 'new-hash', 0), 1);
  assert.deepEqual([fixture.state.password, fixture.state.version], ['new-hash', 1]);
  await assert.rejects(updatePasswordHash('u1', 'stale-hash', 0), { code: 'SESSION_INVALIDATED' });
  assert.deepEqual([fixture.state.password, fixture.state.version], ['new-hash', 1]);
  assert.equal(fixture.state.rolledBack, 1);
  assert.equal(fixture.state.released, 2);
});

test('a password update serializes with an earlier session save and invalidates its result', async () => {
  const fixture = versionedDatabase();
  const { updatePasswordHash } = loadUsers(fixture.pool);
  const store = new MySqlSessionStore({ getPool: async () => fixture.pool });
  const oldSession = { cookie: {}, user: { id: 'u1', username: 'name', sessionVersion: 0 } };
  fixture.holdWrite();
  const saving = call(store, 'set', 'old-sid', oldSession);
  await fixture.firstWrite.promise;
  let changed = false;
  const changing = updatePasswordHash('u1', 'new-hash', 0).then(version => { changed = true; return version; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(changed, false, 'password transaction waits for the session writer user lock');
  assert.equal(fixture.state.version, 0);
  fixture.allowWrite.resolve();
  await saving;
  assert.equal(await changing, 1);
  assert.equal(await call(store, 'get', 'old-sid'), null);
  await assert.rejects(call(store, 'set', 'old-sid', oldSession), { code: 'SESSION_INVALIDATED' });
  assert.equal(JSON.parse(fixture.state.sessions.get('old-sid')).user.sessionVersion, 0);
  const current = { ...oldSession, user: { ...oldSession.user, sessionVersion: 1 } };
  await call(store, 'set', 'current-sid', current);
  assert.equal((await call(store, 'get', 'current-sid')).user.sessionVersion, 1);
});

test('admin reset removes only the target’s stored sessions in the password transaction', async () => {
  const { pool, state } = versionedDatabase();
  const { updatePasswordHash } = loadUsers(pool);
  for (const [sid, id] of [['phone', 'member'], ['desktop', 'member'], ['admin-session', 'admin']]) {
    state.sessions.set(sid, JSON.stringify({ user: { id } }));
  }
  await assert.rejects(updatePasswordHash('member', 'stale', 1, { revokeAllSessions: true }), { code: 'SESSION_INVALIDATED' });
  assert.equal(state.sessions.size, 3);
  await updatePasswordHash('member', 'new-hash', 0, { revokeAllSessions: true });
  assert.deepEqual([...state.sessions.keys()], ['admin-session']);
  assert.deepEqual([state.password, state.version], ['new-hash', 1]);
});
