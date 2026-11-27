const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { validateMailbox, createMailuClient, mailConfig } = require('../src/services/mailu');
const { createMailboxService } = require('../src/services/mailboxes');
const { errorHandler } = require('../src/middleware/error_handler');
const { AppError } = require('../src/errors');
const config = { domain: 'example.com', webmailUrl: 'https://mail.example.com/webmail/', quotaBytes: 1073741824 };
const input = { localpart: 'alice', password: 'mail-password-123', confirmPassword: 'mail-password-123' };

function fixture() {
  const rows = new Map(), users = new Map();
  let creates = 0, alias = null, failAfterCreate = false;
  const store = {
    get: async id => rows.get(id),
    reserve: async (id, email) => {
      if ([...rows.values()].some(row => row.email === email)) throw new AppError('taken', 409);
      const row = { user_id: id, email, provision_id: `random-${id}`, status: 'pending' };
      rows.set(id, row); return row;
    },
    ready: async id => { rows.get(id).status = 'ready'; },
    release: async id => rows.delete(id),
  };
  const client = {
    getUser: async email => users.get(email), getAlias: async () => alias,
    createUser: async row => {
      creates++;
      users.set(row.email, { comment: `LiuLianWEB:${row.provision_id}`, global_admin: false });
      if (failAfterCreate) throw new AppError('timeout', 503);
    },
  };
  return { rows, users, client, get creates() { return creates; }, set alias(value) { alias = value; },
    set failAfterCreate(value) { failAfterCreate = value; },
    service: createMailboxService({ config, client, repo: { ...store, withLock: async (_id, fn) => fn(store) } }) };
}

test('mailbox input rejects domain injection, reserved names and weak/mismatched passwords', () => {
  for (const localpart of ['admin', 'postmaster', 'a@example.net', '../x', 'ab', '.abc', 'abc.', 'a..b', 'a+b']) {
    assert.throws(() => validateMailbox({ ...input, localpart }));
  }
  assert.throws(() => validateMailbox({ ...input, password: 'short' }));
  assert.throws(() => validateMailbox({ ...input, confirmPassword: 'other' }));
  assert.equal(validateMailbox({ ...input, localpart: ' Alice.Smith ' }).localpart, 'alice.smith');
});

test('one mailbox per member, no password persistence or ownership marker exposure', async () => {
  const f = fixture();
  const result = await f.service.create('member-1', { ...input, global_admin: true, email: 'root@example.net', quota_bytes: 0 });
  assert.deepEqual(result.mailbox, { email: 'alice@example.com', status: 'ready' });
  assert.equal(JSON.stringify(result).includes('random-member'), false);
  assert.equal(JSON.stringify([...f.rows.values()]).includes(input.password), false);
  await f.service.create('member-1', { ...input, localpart: 'another' });
  assert.equal(f.creates, 1);
  await assert.rejects(f.service.create('member-2', input), { statusCode: 409 });
});

test('cannot claim an existing mailbox, administrator or alias', async () => {
  for (const existing of [{ global_admin: true }, { global_admin: false, comment: 'LiuLianWEB:someone-else' }]) {
    const f = fixture(); f.users.set('alice@example.com', existing);
    await assert.rejects(f.service.create('member-1', input), { statusCode: 409 });
    assert.equal(f.creates, 0); assert.equal(f.rows.size, 0);
  }
  const f = fixture(); f.alias = { email: 'alice@example.com' };
  await assert.rejects(f.service.create('member-1', input), { statusCode: 409 });
  assert.equal(f.creates, 0);
});

test('timeout after creation retains reservation and reconciles without resetting credentials', async () => {
  const f = fixture(); f.failAfterCreate = true;
  await assert.rejects(f.service.create('member-1', input), { statusCode: 503 });
  assert.equal(f.rows.get('member-1').status, 'pending');
  await assert.rejects(f.service.create('member-1', { ...input, localpart: 'another' }), { statusCode: 409 });
  const result = await f.service.create('member-1', input);
  assert.equal(result.mailbox.status, 'ready'); assert.equal(f.creates, 1);
});

test('Mailu client enforces least privilege and sanitizes upstream errors', async () => {
  let request;
  const client = createMailuClient({ ...config, apiUrl: 'https://mail.example.com/api/v1', token: 'private-token' }, async (url, options) => {
    request = { url, options }; return { ok: true, status: 200, json: async () => ({ code: 200 }) };
  });
  await client.createUser({ email: 'alice@example.com', provision_id: 'opaque' }, input.password);
  const payload = JSON.parse(request.options.body);
  assert.equal(payload.global_admin, false); assert.equal(payload.allow_spoofing, false);
  assert.equal(payload.quota_bytes, config.quotaBytes); assert.equal(request.options.redirect, 'error');
  const broken = createMailuClient({ apiUrl: 'https://example.com', token: 'secret' }, async () => { throw new Error('secret password'); });
  await assert.rejects(broken.getUser('alice@example.com'), err => err.statusCode === 503 && !err.message.includes('secret'));
  assert.equal(mailConfig({}), null);
  assert.throws(() => mailConfig({ MAILU_API_URL: 'http://example.com', MAILU_API_TOKEN: 'x', MAILU_DOMAIN: 'example.com', MAILU_WEBMAIL_URL: config.webmailUrl }));
});

test('mail routes enforce membership, page grants, terms and non-simple mutation header', async t => {
  const { createRouter } = require('../src/routes/mail');
  let member = true, allowed = true, terms = true, called = 0;
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.session = req.get('X-Test-User') ? { user: { id: 'member' } } : {}; next(); });
  app.use('/api/mail', createRouter({ env: {},
    findUser: async () => member ? { terms_accepted_at: terms ? new Date() : null } : null,
    visiblePages: async () => ({ mail: allowed }),
    service: { status: async () => ({ configured: true }), create: async id => { called++; return { id }; } },
  }));
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}/api/mail`;
  assert.equal((await fetch(url)).status, 401);
  const headers = { 'X-Test-User': '1', 'Content-Type': 'application/json' };
  member = false; assert.equal((await fetch(url, { headers })).status, 401); member = true;
  allowed = false; assert.equal((await fetch(url, { headers })).status, 403); allowed = true;
  terms = false; assert.equal((await fetch(url, { headers })).status, 403); terms = true;
  assert.equal((await fetch(url, { headers, method: 'POST', body: '{}' })).status, 403);
  const response = await fetch(url, { headers: { ...headers, 'X-Mail-Request': '1' }, method: 'POST', body: JSON.stringify({ userId: 'victim' }) });
  assert.deepEqual(await response.json(), { id: 'member' }); assert.equal(called, 1);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});
