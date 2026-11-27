const test = require('node:test');
const assert = require('node:assert/strict');
const { MIGRATIONS, runMigrations } = require('../src/db/migrate');

test('runMigrations applies only unrecorded versions', async () => {
  const calls = [];
  const conn = {
    async execute(sql, params = []) {
      calls.push([sql, params]);
      if (sql === 'SELECT version FROM website_schema_migrations') {
        return [[{ version: '001' }]];
      }
      return [[]];
    },
  };
  let oldRuns = 0;
  let newRuns = 0;

  await runMigrations(conn, [
    { version: '001', name: 'old', up: async () => { oldRuns += 1; } },
    { version: '002', name: 'new', up: async () => { newRuns += 1; } },
  ]);

  assert.equal(oldRuns, 0);
  assert.equal(newRuns, 1);
  assert.ok(calls.some(([sql, params]) =>
    sql.startsWith('INSERT INTO website_schema_migrations') && params[0] === '002'
  ));
});

test('migration 017 widens uuid user identifiers and restores foreign keys', async () => {
  const migration = MIGRATIONS.find(item => item.version === '017');
  assert.ok(migration, 'migration 017 must exist');

  const statements = [];
  const conn = {
    async execute(sql) {
      statements.push(sql);
      if (sql.includes('information_schema.KEY_COLUMN_USAGE')) {
        return [[{
          table_name: 'website_user_roles',
          column_name: 'user_id',
          constraint_name: 'website_user_roles_ibfk_1',
          delete_rule: 'CASCADE',
          update_rule: 'RESTRICT',
        }]];
      }
      if (sql.includes('CHARACTER_MAXIMUM_LENGTH')) return [[{ length: 30 }]];
      return [[]];
    },
  };

  await migration.up(conn);
  const sql = statements.join('\n');

  assert.match(sql, /DROP FOREIGN KEY `website_user_roles_ibfk_1`/);
  assert.match(sql, /ALTER TABLE `website_users` MODIFY COLUMN `id` VARCHAR\(64\) NOT NULL/);
  assert.match(sql, /ALTER TABLE `website_user_roles` MODIFY COLUMN `user_id` VARCHAR\(64\) NOT NULL/);
  assert.match(sql, /ADD CONSTRAINT `website_user_roles_ibfk_1`/);
  assert.match(sql, /ON DELETE CASCADE ON UPDATE RESTRICT/);
  assert.match(sql, /website_rdp_profiles/);
});

test('migration 017 leaves wide columns untouched', async () => {
  const migration = MIGRATIONS.find(item => item.version === '017');
  const statements = [];
  const conn = {
    async execute(sql) {
      statements.push(sql);
      if (sql.includes('CHARACTER_MAXIMUM_LENGTH')) return [[{ length: 64 }]];
      return [[]];
    },
  };

  await migration.up(conn);

  assert.equal(statements.some(sql => /MODIFY COLUMN/.test(sql)), false);
  assert.equal(statements.some(sql => /DROP FOREIGN KEY/.test(sql)), false);
});

test('migration 019 repeats the uuid widening for databases that recorded 017 as the file migration', async () => {
  const migration = MIGRATIONS.find(item => item.version === '019');
  assert.ok(migration, 'migration 019 must exist');

  const statements = [];
  const conn = {
    async execute(sql) {
      statements.push(sql);
      if (sql.includes('information_schema.KEY_COLUMN_USAGE')) {
        return [[{
          table_name: 'website_events',
          column_name: 'created_by',
          constraint_name: 'website_events_ibfk_1',
          delete_rule: 'SET NULL',
          update_rule: 'RESTRICT',
        }]];
      }
      if (sql.includes('CHARACTER_MAXIMUM_LENGTH')) return [[{ length: 30 }]];
      return [[]];
    },
  };

  await migration.up(conn);
  const sql = statements.join('\n');

  assert.match(sql, /ALTER TABLE `website_users` MODIFY COLUMN `id` VARCHAR\(64\) NOT NULL/);
  assert.match(sql, /ALTER TABLE `website_events` MODIFY COLUMN `created_by` VARCHAR\(64\) NOT NULL/);
  assert.match(sql, /ADD CONSTRAINT `website_events_ibfk_1`[\s\S]*ON DELETE SET NULL ON UPDATE RESTRICT/);
});

test('migration 019 is a no-op once the identifiers are wide enough', async () => {
  const migration = MIGRATIONS.find(item => item.version === '019');
  const statements = [];
  const conn = {
    async execute(sql) {
      statements.push(sql);
      if (sql.includes('CHARACTER_MAXIMUM_LENGTH')) return [[{ length: 64 }]];
      return [[]];
    },
  };

  await migration.up(conn);

  assert.equal(statements.some(sql => /MODIFY COLUMN/.test(sql)), false);
  assert.equal(statements.some(sql => /DROP FOREIGN KEY/.test(sql)), false);
});

function interruptedSchema(crashPhase) {
  const definitions = [
    { table: 'custom_owners', constraint: 'fk_custom_owner', columns: ['owner_id', 'owner_name'],
      referencedSchema: 'appdb', referencedTable: 'website_users', referencedColumns: ['id', 'username'],
      deleteRule: 'SET NULL', updateRule: 'CASCADE' },
    { table: 'website_user_roles', constraint: 'fk_membership', columns: ['user_id'],
      referencedSchema: 'appdb', referencedTable: 'website_users', referencedColumns: ['id'],
      deleteRule: 'CASCADE', updateRule: 'RESTRICT' },
  ];
  const state = { live: new Map(definitions.map(key => [key.constraint, key])), journal: new Map(),
    widths: new Map([['website_users.id', 30], ['custom_owners.owner_id', 30], ['website_user_roles.user_id', 30]]),
    crashed: false, statements: [], additions: 0 };
  const rowsFor = key => key.columns.map((column, index) => ({
    table_name: key.table, column_name: column, constraint_name: key.constraint, ordinal_position: index + 1,
    referenced_schema: key.referencedSchema, referenced_table: key.referencedTable,
    referenced_column: key.referencedColumns[index], delete_rule: key.deleteRule, update_rule: key.updateRule,
  }));
  return { state, connection: () => ({ async execute(sql, params = []) {
    state.statements.push(sql);
    if (sql.includes('information_schema.KEY_COLUMN_USAGE')) return [[...state.live.values()].flatMap(rowsFor)];
    if (sql.includes('INSERT IGNORE INTO website_migration_foreign_keys')) {
      if (!state.journal.has(params[2])) state.journal.set(params[2], params[3]);
      return [[]];
    }
    if (sql.startsWith('SELECT definition')) return [[...state.journal.values()].map(definition => ({ definition }))];
    if (sql.includes('CHARACTER_MAXIMUM_LENGTH')) {
      const length = state.widths.get(`${params[0]}.${params[1]}`);
      return [length === undefined ? [] : [{ length, ...(params[0] === 'custom_owners' ? { nullable: 'YES' } : {}) }]];
    }
    const drop = /DROP FOREIGN KEY `([^`]+)`/.exec(sql);
    if (drop) {
      assert.ok(state.journal.has(drop[1]), 'every FK must have a durable definition before DROP');
      state.live.delete(drop[1]); return [[]];
    }
    const modify = /ALTER TABLE `([^`]+)` MODIFY COLUMN `([^`]+)`/.exec(sql);
    const add = /ADD CONSTRAINT `([^`]+)`/.exec(sql);
    if (add) state.additions += 1;
    if (!state.crashed && ((crashPhase === 'widen' && modify) || (crashPhase === 'restore' && add && state.additions === 2))) {
      state.crashed = true; throw new Error('simulated process interruption');
    }
    if (modify) state.widths.set(`${modify[1]}.${modify[2]}`, 64);
    if (add) {
      assert.equal(state.live.has(add[1]), false, 'retry must not add an existing FK');
      state.live.set(add[1], JSON.parse(state.journal.get(add[1])));
    }
    if (sql.startsWith('DELETE FROM website_migration_foreign_keys')) state.journal.clear();
    return [[]];
  } }) };
}

for (const version of ['017', '019']) {
  for (const phase of ['widen', 'restore']) {
    test(`migration ${version} restores full composite FK definitions after restart during ${phase}`, async () => {
      const fixture = interruptedSchema(phase);
      const migration = MIGRATIONS.find(item => item.version === version);
      await assert.rejects(migration.up(fixture.connection()), /simulated process interruption/);
      assert.equal(fixture.state.journal.size, 2);
      await migration.up(fixture.connection());
      assert.equal(fixture.state.live.size, 2);
      assert.equal(fixture.state.journal.size, 0);
      const sql = fixture.state.statements.join('\n');
      assert.match(sql, /FOREIGN KEY \(`owner_id`, `owner_name`\)[\s\S]*REFERENCES `appdb`.`website_users` \(`id`, `username`\)/);
      assert.match(sql, /ON DELETE SET NULL ON UPDATE CASCADE/);
      assert.match(sql, /MODIFY COLUMN `owner_id` VARCHAR\(64\) NULL/);
      const drops = fixture.state.statements.filter(sql => sql.includes('DROP FOREIGN KEY')).length;
      await migration.up(fixture.connection());
      assert.equal(fixture.state.statements.filter(sql => sql.includes('DROP FOREIGN KEY')).length, drops);
    });
  }
}

test('migration 027 restores standard FK definitions missing from an already-wide legacy schema', async () => {
  const statements = [];
  const conn = { async execute(sql, params = []) {
    statements.push(sql);
    if (sql.includes('CHARACTER_MAXIMUM_LENGTH')) return [['website_users', 'website_user_roles', 'website_file_permissions', 'website_file_shares'].includes(params[0]) ? [{ length: 64 }] : []];
    return [[]];
  } };
  await MIGRATIONS.find(item => item.version === '027').up(conn);
  assert.ok(statements.some(sql => /ADD CONSTRAINT `fk_uuid_repair_website_user_roles`/.test(sql)));
  assert.ok(statements.some(sql => /ADD CONSTRAINT `fk_uuid_repair_website_file_permissions`/.test(sql)));
  assert.ok(statements.some(sql => /ADD CONSTRAINT `fk_uuid_repair_website_file_shares`/.test(sql)));
  assert.equal(statements.some(sql => sql.includes('DROP FOREIGN KEY')), false);
});
