const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

function readConfig(file) {
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!config || typeof config !== 'object' || Array.isArray(config) ||
      (config.guild_languages !== undefined && (!config.guild_languages ||
        typeof config.guild_languages !== 'object' || Array.isArray(config.guild_languages)))) {
    throw new Error('Invalid Discord configuration');
  }
  return config;
}

function writeLanguages(filename, rows) {
  const file = fs.realpathSync(filename);
  const original = fs.statSync(file, { bigint: true });
  const config = readConfig(file);
  config.guild_languages ||= {};
  for (const row of rows) config.guild_languages[row.guild_id] = row.language;
  const temp = path.join(path.dirname(file), '.guild-config-' + randomUUID() + '.tmp');
  const fd = fs.openSync(temp, 'wx', 0o600);
  try {
    try {
      fs.writeFileSync(fd, JSON.stringify(config, null, 2) + '\n');
      const created = fs.fstatSync(fd, { bigint: true });
      if (created.uid !== original.uid || created.gid !== original.gid) {
        fs.fchownSync(fd, Number(original.uid), Number(original.gid));
      }
      fs.fchmodSync(fd, Number(original.mode & 0o777n));
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    const latest = fs.statSync(file, { bigint: true });
    if (latest.ino !== original.ino || latest.ctimeNs !== original.ctimeNs) throw new Error('Discord configuration changed');
    fs.renameSync(temp, file);
    if (process.platform !== 'win32') {
      const dir = fs.openSync(path.dirname(file), 'r');
      try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
    }
  } finally { fs.rmSync(temp, { force: true }); }
}

async function flushGuildConfig(pool, filename) {
  const conn = await pool.getConnection();
  let locked = false;
  try {
    const [[row]] = await conn.execute("SELECT GET_LOCK('liulian-guild-config',0) AS acquired");
    locked = Number(row.acquired) === 1;
    if (!locked) return false;
    await conn.beginTransaction();
    try {
      const [rows] = await conn.execute('SELECT guild_id,language FROM website_guild_config_pending ORDER BY guild_id FOR UPDATE');
      if (rows.length) {
        writeLanguages(filename, rows);
        await conn.execute(`DELETE FROM website_guild_config_pending WHERE guild_id IN (${rows.map(() => '?').join(',')})`,
          rows.map(item => item.guild_id));
      }
      await conn.commit();
      return true;
    } catch (error) { await conn.rollback(); throw error; }
  } finally {
    try {
      if (locked) await conn.execute("SELECT RELEASE_LOCK('liulian-guild-config')");
      conn.release();
    } catch { conn.destroy(); }
  }
}

function startGuildConfigSync(flush, env = process.env) {
  const enabled = env.DISTRIBUTED_DEPLOYMENT !== 'true' || env.GUILD_CONFIG_WRITER === 'true';
  let pending;
  const tick = () => {
    pending ||= flush().catch(() => console.error('[GuildConfig] Pending settings will be retried.'))
      .finally(() => { pending = null; });
  };
  const timer = enabled && setInterval(tick, 30000);
  if (enabled) { timer.unref(); tick(); }
  return { async stop() { clearInterval(timer); await pending; } };
}

module.exports = { readConfig, flushGuildConfig, startGuildConfigSync };
