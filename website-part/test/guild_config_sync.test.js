const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { flushGuildConfig } = require('../src/services/guild_config_sync');

test('a writer retries the durable language batch without losing unrelated bot settings', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guild-settings-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir,'config.json');
  const rows = [{ guild_id: '123', language: 'zh_TW' },{ guild_id: '456', language: 'en' }];
  let available = false;
  let batch = rows;
  let acknowledged = false;
  const conn = {
    execute: async sql => {
      if (sql.includes('GET_LOCK')) return [[{ acquired: Number(available) }]];
      if (sql.startsWith('SELECT guild_id')) return [batch];
      if (sql.startsWith('DELETE')) acknowledged = true;
      return [[]];
    },
    beginTransaction: async () => { acknowledged = false; },
    commit: async () => { if (acknowledged) batch = []; },
    rollback: async () => { acknowledged = false; },
    release() {},
  };
  const pool = { getConnection: async () => conn };
  assert.equal(await flushGuildConfig(pool,file), false);
  available = true;
  for (const invalid of ['bad JSON','[]','{"guild_languages":null}']) {
    fs.writeFileSync(file,invalid);
    await assert.rejects(flushGuildConfig(pool,file));
    assert.equal(fs.readFileSync(file,'utf8'),invalid);
    assert.deepEqual(batch,rows);
  }
  const config = { bot_admin: ['owner'], guild_languages: { '789':'en' }, bot: { extra:true } };
  fs.writeFileSync(file,JSON.stringify(config));
  assert.equal(await flushGuildConfig(pool,file),true);
  assert.deepEqual(JSON.parse(fs.readFileSync(file)), { ...config, guild_languages:{ '123':'zh_TW','456':'en','789':'en' } });
  assert.deepEqual(batch,[]);
  assert.equal(await flushGuildConfig(pool,file),true);
  assert.deepEqual(fs.readdirSync(dir),['config.json']);
});
