const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const express = require('express');

test('only admins can reset another member’s website password', async t => {
  const admin = { id: 'admin-id', role_name: 'admin' };
  const member = { id: 'member-id', role_name: 'user', password: await bcrypt.hash('Before-reset-27', 4), session_version: 3 };
  const calls = [];
  let actor = null;
  let conflict = false;
  const db = require('../src/db');
  const rejected = [];
  t.mock.method(db, 'recordAuditFailure', async (entry, status) => rejected.push({ entry, status }));
  t.mock.method(db, 'findUserById', async () => actor);
  t.mock.method(db, 'findUserCredentialsById', async id => {
    if (id.toLowerCase() === admin.id) return admin;
    return id === member.id ? member : null;
  });
  t.mock.method(db, 'updatePasswordHash', async (id, hash, version, options) => {
    if (conflict) throw Object.assign(new Error('stale'), { code: 'SESSION_INVALIDATED' });
    calls.push({ id, hash, version, options });
  });
  const app = express().use(express.json());
  app.use((req, res, next) => {
    req.session = actor ? { user: { id: actor.id } } : {};
    next();
  });
  app.use('/api/admin', require('../src/routes/admin'));
  const server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const password = 'After-reset-28';
  const reset = (id = member.id, newPassword = password, confirmPassword = newPassword) =>
    fetch(`http://127.0.0.1:${server.address().port}/api/admin/users/${id}/password`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newPassword, confirmPassword }),
    });

  assert.equal((await reset()).status, 401);
  actor = member;
  assert.equal((await reset()).status, 403);
  actor = admin;
  assert.equal((await reset('missing')).status, 404);
  assert.equal((await reset('%20')).status, 404);
  assert.equal((await reset('a'.repeat(65))).status, 404);
  assert.equal((await reset('ADMIN-ID')).status, 400);
  for (const invalid of ['short', 'password123', '密'.repeat(25), 'Before-reset-27']) {
    assert.equal((await reset(member.id, invalid)).status, 400);
  }
  assert.equal((await reset(member.id, password, 'different')).status, 400);
  assert.equal(calls.length, 0);
  conflict = true;
  assert.equal((await reset()).status, 409);
  conflict = false;
  const response = await reset();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true });
  assert.equal(calls.length, 1);
  const { hash, ...change } = calls[0];
  const audit = { actor: admin.id, action: 'password_reset', target: member.id };
  assert.deepEqual(change, { id: member.id, version: 3, options: { revokeAllSessions: true, audit } });
  assert.deepEqual(rejected.at(-1), { entry: audit, status: 409 });
  assert.equal(rejected.length, 10);
  assert.equal(await bcrypt.compare(password, hash), true);
});
