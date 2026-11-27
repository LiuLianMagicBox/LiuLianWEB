// Run on the router from website-part: node deploy/router-vps/verify.js
// Creates only short-lived synthetic sessions and rate-limit buckets; cleans up.
require('dotenv').config();
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const signature = require('cookie-signature');
const { getPool, closePool } = require('../../src/db/pool');
const { MySqlSessionStore } = require('../../src/session_store');
const { MySqlRateLimitStore } = require('../../src/rate_limit_store');
const nodes = ['http://127.0.0.1:30012', 'http://127.0.0.1:30013'];
const run = randomBytes(12).toString('hex');
const sid = `deployment-${run}`;
const username = `dc${run.slice(0, 16)}`;
const testIps = Array.from({ length: 12 }, (_, i) => `198.18.0.${i + 101}`);
const sessions = new MySqlSessionStore();
const ipStore = new MySqlRateLimitStore('auth-ip');
const accountStore = new MySqlRateLimitStore('auth-account');
const concurrencyStore = new MySqlRateLimitStore('deploy-check');
const call = (method, ...args) => new Promise((resolve, reject) => sessions[method](...args, err => err ? reject(err) : resolve()));
(async () => {
  try {
    await getPool();
    await call('set', sid, { cookie: { expires: new Date(Date.now() + 60000), httpOnly: true, secure: true }, user: { id: sid } });
    const cookie = `${process.env.SESSION_COOKIE_NAME || 'connect.sid'}=${encodeURIComponent('s:' + signature.sign(sid, process.env.SESSION_SECRET))}`;
    for (const node of nodes) {
      const anonymous = await fetch(node + '/index.html', { redirect: 'manual' });
      assert.equal(anonymous.status, 302);
      const authenticated = await fetch(node + '/index.html', { redirect: 'manual', headers: { cookie } });
      assert.equal(authenticated.status, 200);
      await authenticated.arrayBuffer();
    }
    console.log('PASS: one synthetic session is accepted by both nodes; anonymous users are redirected');
    for (let i = 0; i < testIps.length; i++) {
      const response = await fetch(nodes[i % 2] + '/api/auth/login', {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': testIps[i] },
        body: JSON.stringify({ username, password: 'not-a-real-account-password' }),
      });
      await response.arrayBuffer();
      assert.equal(response.status, i < 10 ? 401 : 429, `cross-node account attempt ${i + 1}`);
    }
    console.log('PASS: failed logins across both nodes and different IPs share the account limit');
    concurrencyStore.init({ windowMs: 60000 });
    const counts = await Promise.all(Array.from({ length: 20 }, () => concurrencyStore.increment(run)));
    assert.deepEqual(counts.map(x => x.totalHits).sort((a, b) => a - b), Array.from({ length: 20 }, (_, i) => i + 1));
    console.log('PASS: 20 concurrent MySQL increments produce exactly 1..20');
  } finally {
    await call('destroy', sid);
    await accountStore.resetKey(username);
    await Promise.all(testIps.map(ip => ipStore.resetKey(ip)));
    await concurrencyStore.resetKey(run);
    await closePool();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
