const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');

test('manual reconciliation only changes unreviewed ambiguous deliveries once', async t => {
  let status = 'review';
  t.mock.method(pool, 'getPool', async () => ({
    execute: async (sql, [next, id]) => {
      assert.match(sql, /claim_token=NULL/);
      assert.match(sql, /status='review'/);
      if (id !== 42 || status !== 'review') return [{ affectedRows: 0 }];
      status = next;
      return [{ affectedRows: 1 }];
    },
  }));
  const path = require.resolve('../src/db/announcements');
  delete require.cache[path];
  t.after(() => delete require.cache[path]);
  const { resolveAnnouncement } = require(path);
  await assert.rejects(resolveAnnouncement(42, ['delivered']), { statusCode: 400 });
  await resolveAnnouncement(42, 'delivered');
  assert.equal(status, 'sent');
  await assert.rejects(resolveAnnouncement(42, 'not_delivered'), { statusCode: 409 });
  status = 'review';
  await resolveAnnouncement(42, 'not_delivered');
  assert.equal(status, 'scheduled');
});
