const mysql = require('mysql2/promise');
const path = require('path');
const fs = require('fs');
const { runMigrations } = require('./migrate');

const CONFIG_PATH = path.join(__dirname, '..', '..', '..', 'shared', 'database', 'config.json');
const MAX_STRING_LEN = 255;

let pool = null;
let poolInitialization = null;

function validateString(value, label) {
  if (typeof value !== 'string') {
    throw new Error(`[DB] ${label}: expected string, got ${typeof value}`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new Error(`[DB] ${label}: cannot be empty`);
  if (trimmed.length > MAX_STRING_LEN) {
    throw new Error(`[DB] ${label}: exceeds max length (${MAX_STRING_LEN})`);
  }
  return trimmed;
}

function validateInt(value, label) {
  const num = Number(value);
  if (!Number.isInteger(num) || num < 0) {
    throw new Error(`[DB] ${label}: expected non-negative integer, got ${value}`);
  }
  return num;
}

function loadConfig(env = process.env) {
  if (env.DB_HOST) {
    for (const key of ['DB_USER', 'DB_NAME']) {
      if (!env[key]?.trim()) throw new Error('[DB] ' + key + ' is required with DB_HOST');
    }
    const port = Number(env.DB_PORT || 3306);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('[DB] Invalid DB_PORT');
    return {
      host: env.DB_HOST, port, user: env.DB_USER, password: env.DB_PASSWORD || '', database: env.DB_NAME,
      ...(env.DB_SSL_CA_FILE ? { ssl: { ca: fs.readFileSync(env.DB_SSL_CA_FILE, 'utf8'), rejectUnauthorized: true } } : {}),
    };
  }
  const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  const config = JSON.parse(raw);
  return config.mysql || config.mysql_config || {};
}

function buildPoolOptions(cfg = {}) {
  return {
    host: cfg.host || 'localhost',
    port: cfg.port || 3306,
    user: cfg.user || 'root',
    password: cfg.password || '',
    database: cfg.database || 'discordbot',
    charset: cfg.charset || 'utf8mb4',
    ...(cfg.ssl ? { ssl: cfg.ssl } : {}),
    timezone: 'Z',
    supportBigNumbers: true,
    bigNumberStrings: true,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  };
}

// mysql2's connection event does not wait for async listeners. Gate every
// checkout instead, including the checkouts made internally by execute/query.
function initializePoolTimeZone(candidate) {
  const rawPool = candidate.pool;
  const getConnection = rawPool.getConnection.bind(rawPool);
  const initialized = new WeakSet();
  rawPool.getConnection = callback => getConnection((err, connection) => {
    if (err) return callback(err);
    if (initialized.has(connection)) return callback(null, connection);
    connection.query("SET SESSION time_zone = '+00:00'", setupError => {
      if (setupError) {
        connection.destroy();
        return callback(setupError);
      }
      initialized.add(connection);
      return callback(null, connection);
    });
  });
  return candidate;
}

async function getPool() {
  if (poolInitialization) return poolInitialization;
  if (pool) return pool;

  const cfg = loadConfig();
  const candidate = initializePoolTimeZone(mysql.createPool(buildPoolOptions(cfg)));
  pool = candidate;
  poolInitialization = (async () => {
    const conn = await candidate.getConnection();
    try {
      const [[lock]] = await conn.execute("SELECT GET_LOCK('liulian-website-migrations', 120) AS acquired");
      if (Number(lock.acquired) !== 1) throw new Error('[DB] Migration lock timeout');
      try {
        await runMigrations(conn);
      } finally {
        await conn.execute("SELECT RELEASE_LOCK('liulian-website-migrations')");
      }
    } finally {
      conn.release();
    }
    return candidate;
  })();

  try {
    return await poolInitialization;
  } catch (err) {
    pool = null;
    await candidate.end().catch(() => {});
    throw err;
  } finally {
    poolInitialization = null;
  }
}

async function closePool() {
  const activePool = pool;
  pool = null;
  poolInitialization = null;
  if (activePool) await activePool.end();
}

module.exports = { getPool, closePool, validateString, validateInt, buildPoolOptions, loadConfig, initializePoolTimeZone };
