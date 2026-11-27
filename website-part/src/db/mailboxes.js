const crypto = require('node:crypto');
const { getPool } = require('./pool');
const { AppError, ConflictError } = require('../errors');

function createRepository(pool = getPool) {
  function operations(conn) {
    return {
      async get(userId) {
        const [rows] = await conn.execute('SELECT user_id, email, provision_id, status FROM website_mailboxes WHERE user_id = ?', [userId]);
        return rows[0] || null;
      },
      async reserve(userId, email) {
        const row = { user_id: userId, email, provision_id: crypto.randomUUID(), status: 'pending' };
        try {
          await conn.execute('INSERT INTO website_mailboxes (user_id, email, provision_id, status) VALUES (?, ?, ?, ?)', [userId, email, row.provision_id, row.status]);
        } catch (err) {
          if (err.code === 'ER_DUP_ENTRY') throw new ConflictError('This mailbox name is unavailable.');
          throw err;
        }
        return row;
      },
      async ready(userId) {
        await conn.execute("UPDATE website_mailboxes SET status = 'ready' WHERE user_id = ?", [userId]);
      },
      async release(userId) {
        await conn.execute("DELETE FROM website_mailboxes WHERE user_id = ? AND status = 'pending'", [userId]);
      },
    };
  }
  return {
    async get(userId) { return operations(await pool()).get(userId); },
    async withLock(userId, action) {
      const conn = await (await pool()).getConnection();
      const key = `mail:${crypto.createHash('sha256').update(userId).digest('hex').slice(0, 56)}`;
      let locked = false;
      try {
        const [[row]] = await conn.execute('SELECT GET_LOCK(?, 0) AS acquired', [key]);
        locked = Number(row.acquired) === 1;
        if (!locked) throw new AppError('Mailbox creation is in progress. Please retry shortly.', 409, 'MAIL_BUSY');
        return await action(operations(conn));
      } finally {
        // A failed unlock must not return a connection holding a named lock to the pool.
        try {
          if (locked) await conn.execute('SELECT RELEASE_LOCK(?)', [key]);
          conn.release();
        } catch { conn.destroy(); }
      }
    },
  };
}
module.exports = { createRepository };
