const test = require('node:test');
const assert = require('node:assert/strict');
const {
  establishUserSession,
  revokeOtherUserSessions,
} = require('../src/services/session');

test('establishUserSession regenerates before saving the user', async () => {
  const order = [];
  const req = {
    session: {
      cookie: {},
      regenerate(callback) {
        order.push('regenerate');
        callback();
      },
      save(callback) {
        order.push('save');
        callback();
      },
    },
  };

  await establishUserSession(req, { id: 'u1', username: 'name' }, 1234);

  assert.deepEqual(order, ['regenerate', 'save']);
  assert.deepEqual(req.session.user, { id: 'u1', username: 'name', sessionVersion: 0 });
  assert.equal(req.session.cookie.maxAge, 1234);
});

test('establishUserSession reports missing session middleware clearly', async () => {
  await assert.rejects(
    establishUserSession({}, { id: 'u1', username: 'name' }),
    /Session middleware is unavailable/
  );
});

test('password change revokes every other session for the user', async () => {
  const calls = [];
  const req = {
    sessionID: 'current-sid',
    sessionStore: {
      destroyUserSessions(userId, exceptSid, callback) {
        calls.push([userId, exceptSid]);
        callback();
      },
    },
  };

  await revokeOtherUserSessions(req, 'u1');

  assert.deepEqual(calls, [['u1', 'current-sid']]);
});

test('password change saves the current session at the new version before deleting others', async () => {
  const calls = [];
  const expires = new Date('2030-01-01');
  const req = {
    sessionID: 'current-sid',
    session: { user: { id: 'u1', sessionVersion: 2 }, cookie: { expires },
      save(callback) { calls.push(['save', this.user.sessionVersion]); callback(); } },
    sessionStore: { destroyUserSessions(userId, exceptSid, callback) {
      calls.push(['destroy', userId, exceptSid]); callback();
    } },
  };
  await revokeOtherUserSessions(req, 'u1', 3);
  assert.deepEqual(calls, [['save', 3], ['destroy', 'u1', 'current-sid']]);
  assert.equal(req.session.cookie.expires, expires);
});

test('a login invalidated while credentials were checked destroys the regenerated session', async () => {
  const error = Object.assign(new Error('revoked'), { code: 'SESSION_INVALIDATED' });
  const calls = [];
  const req = { session: { cookie: {},
    regenerate(callback) { calls.push('regenerate'); callback(); },
    save(callback) { calls.push('save'); callback(error); },
    destroy(callback) { calls.push('destroy'); callback(); },
  } };
  await assert.rejects(establishUserSession(req, { id: 'u1', username: 'name', session_version: 3 }), error);
  assert.deepEqual(calls, ['regenerate', 'save', 'destroy']);
});
