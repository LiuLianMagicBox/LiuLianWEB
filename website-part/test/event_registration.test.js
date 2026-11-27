const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');

function fixture(t, replies) {
  const queries = [];
  const conn = {
    beginTransaction: t.mock.fn(), commit: t.mock.fn(), rollback: t.mock.fn(), release: t.mock.fn(),
    execute: async (sql, args) => {
      const [pattern, result] = replies.shift();
      assert.match(sql, pattern);
      queries.push(args);
      if (result instanceof Error) throw result;
      return [result];
    },
  };
  t.mock.method(pool, 'getPool', async () => ({ getConnection: async () => conn }));
  const path = require.resolve('../src/db/events');
  delete require.cache[path];
  t.after(() => delete require.cache[path]);
  return { events: require(path), conn, queries };
}

test('a full event checks its locked capacity and preserves an existing waitlist position', async t => {
  const { events, conn, queries } = fixture(t, [
    [/visible=1[\s\S]*FOR UPDATE/, [{ max_players: 2 }]],
    [/COUNT\(\*\)/, [{ total: 2, mine: 0 }]],
    [/SELECT ticket FROM website_event_waitlist/, [{ ticket: 17 }]],
    [/COUNT\(\*\) AS position/, [{ position: 3 }]],
  ]);
  assert.deepEqual(await events.joinEvent(7, 'user'), { joined: false, waitlist_position: 3 });
  assert.deepEqual(queries, [[7], ['user', 7], [7, 'user'], [7, 7, 'user']]);
  assert.equal(conn.commit.mock.callCount(), 1);
});

test('withdrawal rolls back both seat changes if the promotion notification cannot be saved', async t => {
  const { events, conn } = fixture(t, [
    [/FOR UPDATE/, [{ max_players: 2 }]], [/DELETE FROM website_event_participants/, { affectedRows: 1 }],
    [/ORDER BY ticket LIMIT 1/, [{ ticket: 32, user_id: 'next' }]],
    [/INSERT INTO website_event_participants/, {}], [/DELETE FROM website_event_waitlist/, {}],
    [/INSERT INTO website_announcements/, new Error('outbox unavailable')],
  ]);
  await assert.rejects(events.leaveEvent(7, 'member'), /outbox unavailable/);
  assert.equal(conn.commit.mock.callCount(), 0);
  assert.equal(conn.rollback.mock.callCount(), 1);
  assert.equal(conn.release.mock.callCount(), 1);
});
