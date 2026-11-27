const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const express = require('express');
const db = require('../src/db');

test('device and audit APIs enforce account ownership, administrator access and cursor bounds', async t => {
  let actor;
  const sessionId = 'current';
  const publicId = sid => createHash('sha256').update(sid).digest('hex');
  const other = publicId('second device');
  const dbAudit = t.mock.method(db, 'listAudit', async () => ({ entries: [], next: null }));
  t.mock.method(db, 'findUserById', async () => actor);
  const app = express();
  let deletions = 0;
  app.use((req, _res, next) => {
    req.session = actor ? { user: actor, deviceLabel: 'Firefox · Linux' } : {};
    req.sessionID = sessionId;
    req.sessionStore = {
      listDevices: async (user, sid) => {
        assert.equal(user, 'member'); assert.equal(sid, sessionId);
        return [{ id: publicId(sid), current: true, device: null, last_active_at: null }];
      },
      revokeDevice: async (user, sid, id) => {
        assert.equal(user, 'member'); assert.equal(sid, sessionId);
        deletions++;
        return id === other;
      },
    };
    next();
  });
  app.use('/api/auth', require('../src/routes/account'));
  app.use('/api/admin', require('../src/routes/admin'));
  const server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const get = (path, method = 'GET') => fetch('http://127.0.0.1:' + server.address().port + '/api/' + path, { method });

  assert.equal((await get('auth/devices')).status, 401);
  assert.equal((await get('admin/audit')).status, 401);
  actor = { id: 'member', role_name: 'user' };
  const devices = await get('auth/devices');
  assert.equal(devices.headers.get('cache-control'), 'no-store');
  assert.equal((await devices.json()).devices[0].device, 'Firefox · Linux');
  assert.equal((await get('auth/devices/' + publicId(sessionId), 'DELETE')).status, 409);
  assert.equal((await get('auth/devices/invalid', 'DELETE')).status, 404);
  assert.equal(deletions, 0);
  assert.equal((await get('auth/devices/' + publicId('unavailable'), 'DELETE')).status, 404);
  assert.equal((await get('auth/devices/' + other, 'DELETE')).status, 204);
  assert.equal((await get('admin/audit')).status, 403);
  actor = { id: 'owner', role_name: 'admin' };
  for (const before of ['0','-1','1.5','18446744073709551616']) {
    assert.equal((await get('admin/audit?before=' + before)).status, 400);
  }
  const audit = await get('admin/audit?before=9007199254740994&search=Member');
  assert.equal(audit.status, 200);
  assert.equal(audit.headers.get('cache-control'), 'no-store');
  assert.deepEqual(dbAudit.mock.calls.map(call => call.arguments), [['9007199254740994','Member']]);
});
