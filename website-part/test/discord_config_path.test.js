const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

for (const name of ['guilds', 'guild_manager']) {
  for (const configured of [false, true]) {
    test(name + ' reads ' + (configured ? 'external bot config' : 'local integration config'), async () => {
      const dirname = path.join(__dirname, '../src/db');
      const expected = configured ? '/external/LiuLianBot/discord-part/config.json'
        : path.resolve(dirname, '../../../shared/discord/config.json');
      let readPath;
      const module = { exports: {} };
      const pool = { execute: async sql => [sql.includes('discord_guild_metadata')
        ? [{ guild_id: '123', guild_name: 'Guild', owner_id: 'owner' }] : []] };
      vm.runInNewContext(fs.readFileSync(path.join(dirname, name + '.js'), 'utf8'), {
        module, __dirname: dirname,
        process: { env: configured ? { DISCORD_CONFIG_PATH: expected } : {} },
        require: id => id === 'path' ? path : id === 'fs'
          ? { readFileSync: file => { readPath = file; return JSON.stringify({ bot_admin: ['admin'], guild_languages: { '123': 'zh_TW' } }); } }
          : id === '../services/guild_config_sync' ? { readConfig: file => { readPath = file; return { bot_admin: ['admin'] }; } }
          : { getPool: async () => pool },
      });
      if (name === 'guilds') {
        const result = await module.exports.getAllGuilds();
        assert.equal(result[0].language, 'zh_TW');
      } else {
        const result = await module.exports.listManagedGuilds('admin');
        assert.equal(result[0].guild_id, '123');
      }
      assert.equal(readPath, expected);
    });
  }
}
