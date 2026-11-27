const { createHash } = require('node:crypto');
const { getPool } = require('./db/pool');

// InnoDB serializes increments for a bucket across all website nodes. Use the
// database clock so regional node clock skew cannot extend or shorten a window.
class MySqlRateLimitStore {
  constructor(prefix, poolProvider = getPool) {
    this.prefix = prefix;
    this.poolProvider = poolProvider;
    this.localKeys = false;
  }

  init(options) { this.windowMs = options.windowMs; }

  bucket(key) {
    return `${this.prefix}:${createHash('sha256').update(key).digest('hex')}`;
  }

  async increment(key) {
    const pool = await this.poolProvider();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute(`INSERT INTO website_rate_limits (bucket, hits, expires_at)
        VALUES (?, 1, UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000 + ?)
        ON DUPLICATE KEY UPDATE
          hits = IF(expires_at <= UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000, 1, hits + 1),
          expires_at = IF(expires_at <= UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000,
            UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000 + ?, expires_at)`,
      [this.bucket(key), this.windowMs, this.windowMs]);
      const [[row]] = await conn.execute(
        'SELECT hits, expires_at FROM website_rate_limits WHERE bucket = ?', [this.bucket(key)]);
      await conn.commit();
      return { totalHits: Number(row.hits), resetTime: new Date(Number(row.expires_at)) };
    } catch (error) {
      await conn.rollback().catch(() => {});
      throw error;
    } finally {
      conn.release();
    }
  }

  async decrement(key) {
    const pool = await this.poolProvider();
    await pool.execute('UPDATE website_rate_limits SET hits = GREATEST(1, hits) - 1 WHERE bucket = ?', [this.bucket(key)]);
  }

  async resetKey(key) {
    const pool = await this.poolProvider();
    await pool.execute('DELETE FROM website_rate_limits WHERE bucket = ?', [this.bucket(key)]);
  }
}

module.exports = { MySqlRateLimitStore };
