const session = require('express-session');
const { getPool } = require('./db');

const DEFAULT_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const persisted = Symbol('persisted session');
const sessionUser = "JSON_UNQUOTE(JSON_EXTRACT(s.data, '$.user.id'))";
const currentVersion = `u.session_version =
  CAST(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(s.data, '$.user.sessionVersion')), '0') AS UNSIGNED)`;

function invalidSession() {
  return Object.assign(new Error('Session expired; please log in again'), { code: 'SESSION_INVALIDATED' });
}

function sessionExpiry(sessionData, fallbackTtlMs) {
  const cookieExpiry = sessionData?.cookie?.expires;
  const expiresAt = cookieExpiry ? new Date(cookieExpiry).getTime() : NaN;
  return Number.isFinite(expiresAt) ? expiresAt : Date.now() + fallbackTtlMs;
}

async function writeValidatedSession(pool, sessionData, write, ignoreInvalid = false) {
  if (!sessionData.user) return write(pool);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // Always lock the user before the session row, including touch, so password
    // updates and session writes share one lock order.
    const [users] = await conn.execute(
      'SELECT session_version FROM website_users WHERE id = ? FOR UPDATE',
      [sessionData.user.id || '']
    );
    if (!users.length || Number(users[0].session_version) !== Number(sessionData.user.sessionVersion || 0)) {
      if (ignoreInvalid) {
        await conn.rollback();
        return;
      }
      throw invalidSession();
    }
    await write(conn);
    await conn.commit();
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

class MySqlSessionStore extends session.Store {
  constructor(options = {}) {
    super();
    this.getPool = options.getPool || getPool;
    this.fallbackTtlMs = options.fallbackTtlMs || DEFAULT_SESSION_TTL_MS;
    this.cleanupTimer = null;
  }

  createSession(req, data) {
    const loaded = super.createSession(req, data);
    Object.defineProperty(loaded, persisted, { value: req.sessionID, configurable: true });
    return loaded;
  }

  async get(sid, callback) {
    try {
      const pool = await this.getPool();
      const [rows] = await pool.execute(
        `SELECT s.data FROM website_sessions s
         LEFT JOIN website_users u ON u.id = ${sessionUser}
         WHERE s.sid = ? AND s.expires_at > ?
           AND (JSON_EXTRACT(s.data, '$.user') IS NULL OR
             (u.id IS NOT NULL AND ${currentVersion}))`,
        [sid, Date.now()]
      );

      if (rows.length === 0) {
        await pool.execute(
          'DELETE FROM website_sessions WHERE sid = ? AND expires_at <= ?',
          [sid, Date.now()]
        );
        return callback(null, null);
      }

      callback(null, JSON.parse(rows[0].data));
    } catch (err) {
      callback(err);
    }
  }

  async set(sid, sessionData, callback = () => {}) {
    try {
      const pool = await this.getPool();
      const data = JSON.stringify(sessionData);
      const expiry = sessionExpiry(sessionData, this.fallbackTtlMs);
      await writeValidatedSession(pool, sessionData, async writer => {
        if (sessionData[persisted] === sid) {
          // An in-flight request loaded before logout must never reinsert the deleted row.
          const [result] = await writer.execute(
            `UPDATE website_sessions SET data=?, expires_at=?, last_active_at=UTC_TIMESTAMP(3)
             WHERE sid=? AND expires_at>?`, [data, expiry, sid, Date.now()]);
          if (!result.affectedRows) throw invalidSession();
        } else {
          await writer.execute(
            `INSERT INTO website_sessions (sid, data, expires_at, last_active_at)
             VALUES (?, ?, ?, UTC_TIMESTAMP(3))
             ON DUPLICATE KEY UPDATE data=VALUES(data), expires_at=VALUES(expires_at), last_active_at=UTC_TIMESTAMP(3)`,
            [sid, data, expiry]);
        }
      });
      Object.defineProperty(sessionData, persisted, { value: sid, configurable: true });
      callback(null);
    } catch (err) {
      callback(err);
    }
  }

  async destroy(sid, callback = () => {}) {
    try {
      const pool = await this.getPool();
      await pool.execute('DELETE FROM website_sessions WHERE sid = ?', [sid]);
      this.emit('sessionRemoved', sid);
      callback(null);
    } catch (err) {
      callback(err);
    }
  }

  async destroyUserSessions(userId, exceptSid, callback = () => {}) {
    try {
      const pool = await this.getPool();
      await pool.execute(
        `DELETE FROM website_sessions
         WHERE JSON_UNQUOTE(JSON_EXTRACT(data, '$.user.id')) = ? AND sid <> ?`,
        [userId, exceptSid]
      );
      this.emit('sessionsChanged');
      callback(null);
    } catch (err) {
      callback(err);
    }
  }

  async listDevices(userId, currentSid) {
    const pool = await this.getPool();
    const [rows] = await pool.execute(
      `SELECT LOWER(SHA2(s.sid,256)) AS id, s.sid=? AS current,
              NULLIF(JSON_UNQUOTE(JSON_EXTRACT(s.data,'$.deviceLabel')), 'null') AS device, s.last_active_at
       FROM website_sessions s JOIN website_users u ON u.id=${sessionUser}
       WHERE u.id=? AND s.expires_at>? AND ${currentVersion}
       ORDER BY current DESC, s.last_active_at DESC, s.sid`, [currentSid, userId, Date.now()]);
    return rows.map(row => ({ ...row, current: Number(row.current) === 1 }));
  }

  async revokeDevice(userId, currentSid, id) {
    const pool = await this.getPool();
    const [result] = await pool.execute(
      `DELETE s FROM website_sessions s WHERE ${sessionUser}=? AND s.sid<>?
       AND SHA2(s.sid,256)=? AND s.expires_at>?`, [userId, currentSid, id, Date.now()]);
    if (result.affectedRows) this.emit('sessionsChanged');
    return Boolean(result.affectedRows);
  }

  async activeSessionIds(ids) {
    if (!ids.length) return new Set();
    const pool = await this.getPool();
    const [rows] = await pool.execute(
      `SELECT s.sid FROM website_sessions s JOIN website_users u ON u.id=${sessionUser}
       WHERE s.sid IN (${ids.map(() => '?').join(',')}) AND s.expires_at>? AND ${currentVersion}`,
      [...ids, Date.now()]);
    return new Set(rows.map(row => row.sid));
  }

  async cleanupExpired(now = Date.now()) {
    const pool = await this.getPool();
    await pool.execute(
      'DELETE FROM website_sessions WHERE expires_at <= ?',
      [now]
    );
    await pool.execute('DELETE FROM website_rate_limits WHERE expires_at <= UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000');
  }

  startCleanup(intervalMs = 60 * 60 * 1000) {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpired().catch(err => {
        console.error('[SessionStore] Expired-session cleanup failed:', err);
      });
    }, intervalMs);
    this.cleanupTimer.unref?.();
  }

  stopCleanup() {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.cleanupTimer = null;
  }

  async touch(sid, sessionData, callback = () => {}) {
    try {
      const pool = await this.getPool();
      await writeValidatedSession(pool, sessionData, writer => writer.execute(
        'UPDATE website_sessions SET expires_at = ?, last_active_at=UTC_TIMESTAMP(3) WHERE sid = ? AND expires_at > ?',
        [sessionExpiry(sessionData, this.fallbackTtlMs), sid, Date.now()]
      ), true);
      callback(null);
    } catch (err) {
      callback(err);
    }
  }
}

module.exports = { MySqlSessionStore, sessionExpiry };
