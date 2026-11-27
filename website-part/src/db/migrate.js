async function addColumnIfMissing(conn, sql) {
  try {
    await conn.execute(sql);
  } catch (err) {
    if (err.code !== 'ER_DUP_FIELDNAME') throw err;
  }
}

function quoteIdentifier(value) {
  return `\`${String(value).replace(/`/g, '``')}\``;
}

async function columnInfo(conn, table, column) {
  const [rows] = await conn.execute(
    `SELECT CHARACTER_MAXIMUM_LENGTH AS length, IS_NULLABLE AS nullable,
            CHARACTER_SET_NAME AS character_set, COLLATION_NAME AS collation,
            COLUMN_DEFAULT AS default_value, COLUMN_COMMENT AS comment
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return rows[0] || null;
}

async function columnLength(conn, table, column) {
  const info = await columnInfo(conn, table, column);
  const value = info?.length;
  return value === null || value === undefined ? null : Number(value);
}

// Widens a column only when it is still too short, so the migration is safe to
// replay on databases that already store longer identifiers.
async function widenColumn(conn, table, column, definition, minimumLength = 64) {
  const info = await columnInfo(conn, table, column);
  if (info?.length === null || info?.length === undefined || Number(info.length) >= minimumLength) return false;
  if (info.nullable !== undefined) {
    const escape = require('mysql2').escape;
    definition = `VARCHAR(${minimumLength})`;
    if (info.character_set) definition += ` CHARACTER SET ${quoteIdentifier(info.character_set)}`;
    if (info.collation) definition += ` COLLATE ${quoteIdentifier(info.collation)}`;
    definition += info.nullable === 'YES' ? ' NULL' : ' NOT NULL';
    if (info.default_value !== null && info.default_value !== undefined) definition += ` DEFAULT ${escape(info.default_value)}`;
    if (info.comment) definition += ` COMMENT ${escape(info.comment)}`;
  }
  await conn.execute(
    `ALTER TABLE ${quoteIdentifier(table)} MODIFY COLUMN ${quoteIdentifier(column)} ${definition}`
  );
  return true;
}

// User ids are `crypto.randomUUID()` values (36 characters) while migration 001
// declared 30 character columns, so every insert failed with ER_DATA_TOO_LONG.
const USER_ID_COLUMNS = [
  ['website_user_roles', 'user_id'],
  ['website_connection_users', 'user_id'],
  ['website_page_visibility_users', 'user_id'],
  ['website_remote_profiles', 'user_id'],
  ['website_rdp_profiles', 'user_id'],
  ['website_event_participants', 'user_id'],
  ['website_link_codes', 'user_id'],
  ['website_events', 'created_by'],
  ['website_announcements', 'created_by'],
  ['website_file_permissions', 'user_id'],
  ['website_file_shares', 'owner_id'],
];

const USER_FK_JOURNAL_SCOPE = 'website-user-id-width-v1';

async function loadUserForeignKeys(conn) {
  const [rows] = await conn.execute(
    `SELECT k.TABLE_NAME AS table_name, k.COLUMN_NAME AS column_name,
            k.CONSTRAINT_NAME AS constraint_name, k.ORDINAL_POSITION AS ordinal_position,
            k.REFERENCED_TABLE_SCHEMA AS referenced_schema,
            k.REFERENCED_TABLE_NAME AS referenced_table,
            k.REFERENCED_COLUMN_NAME AS referenced_column,
            r.DELETE_RULE AS delete_rule, r.UPDATE_RULE AS update_rule
       FROM information_schema.KEY_COLUMN_USAGE k
       JOIN information_schema.REFERENTIAL_CONSTRAINTS r
         ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA
        AND r.TABLE_NAME = k.TABLE_NAME AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
      WHERE k.TABLE_SCHEMA = DATABASE() AND k.REFERENCED_TABLE_NAME = 'website_users'
        AND k.REFERENCED_TABLE_SCHEMA = DATABASE()
      ORDER BY k.TABLE_NAME, k.CONSTRAINT_NAME, k.ORDINAL_POSITION`
  );
  const keys = new Map();
  for (const row of rows) {
    const table = row.table_name ?? row.TABLE_NAME;
    const constraint = row.constraint_name ?? row.CONSTRAINT_NAME;
    const name = `${table}.${constraint}`;
    if (!keys.has(name)) keys.set(name, {
      table, constraint, columns: [], referencedColumns: [],
      referencedSchema: row.referenced_schema ?? row.REFERENCED_TABLE_SCHEMA ?? null,
      referencedTable: row.referenced_table ?? row.REFERENCED_TABLE_NAME ?? 'website_users',
      deleteRule: row.delete_rule ?? row.DELETE_RULE,
      updateRule: row.update_rule ?? row.UPDATE_RULE,
    });
    const key = keys.get(name);
    key.columns.push(row.column_name ?? row.COLUMN_NAME);
    key.referencedColumns.push(row.referenced_column ?? row.REFERENCED_COLUMN_NAME ?? 'id');
  }
  return keys;
}

async function addUserForeignKey(conn, key) {
  const rules = new Set(['CASCADE', 'SET NULL', 'RESTRICT', 'NO ACTION', 'SET DEFAULT']);
  if (!rules.has(key.deleteRule) || !rules.has(key.updateRule)) {
    throw new Error('Invalid foreign key rules in migration journal');
  }
  const target = key.referencedSchema
    ? `${quoteIdentifier(key.referencedSchema)}.${quoteIdentifier(key.referencedTable)}`
    : quoteIdentifier(key.referencedTable);
  await conn.execute(`ALTER TABLE ${quoteIdentifier(key.table)}
    ADD CONSTRAINT ${quoteIdentifier(key.constraint)}
    FOREIGN KEY (${key.columns.map(quoteIdentifier).join(', ')})
    REFERENCES ${target} (${key.referencedColumns.map(quoteIdentifier).join(', ')})
    ON DELETE ${key.deleteRule} ON UPDATE ${key.updateRule}`);
}

// DDL auto-commits. Persist complete ordered FK definitions before dropping
// any key, so an interrupted migration can restore them after a process restart.
async function widenUserIdColumns(conn) {
  await conn.execute(`CREATE TABLE IF NOT EXISTS website_migration_foreign_keys (
    scope VARCHAR(64) NOT NULL, table_name VARCHAR(64) NOT NULL,
    constraint_name VARCHAR(64) NOT NULL, definition MEDIUMTEXT NOT NULL,
    PRIMARY KEY (scope, table_name, constraint_name)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`);
  const keys = await loadUserForeignKeys(conn);
  for (const key of keys.values()) {
    await conn.execute(`INSERT IGNORE INTO website_migration_foreign_keys
      (scope, table_name, constraint_name, definition) VALUES (?, ?, ?, ?)`,
    [USER_FK_JOURNAL_SCOPE, key.table, key.constraint, JSON.stringify(key)]);
  }
  const [saved] = await conn.execute(
    'SELECT definition FROM website_migration_foreign_keys WHERE scope = ?', [USER_FK_JOURNAL_SCOPE]
  );
  const recoverable = new Map(keys);
  for (const row of saved) {
    const key = JSON.parse(row.definition);
    recoverable.set(`${key.table}.${key.constraint}`, key);
  }

  const columns = new Map(USER_ID_COLUMNS.map(([table, column]) => [`${table}.${column}`, [table, column]]));
  for (const key of recoverable.values()) {
    key.columns.forEach((column, index) => {
      if (key.referencedColumns[index] === 'id') columns.set(`${key.table}.${column}`, [key.table, column]);
    });
  }
  const parentLength = await columnLength(conn, 'website_users', 'id');
  const narrow = new Set();
  for (const [name, [table, column]] of columns) {
    const length = await columnLength(conn, table, column);
    if (length !== null && length < 64) narrow.add(name);
  }
  for (const [name, key] of keys) {
    if (!(parentLength !== null && parentLength < 64) &&
        !key.columns.some(column => narrow.has(`${key.table}.${column}`))) continue;
    await conn.execute(`ALTER TABLE ${quoteIdentifier(key.table)} DROP FOREIGN KEY ${quoteIdentifier(key.constraint)}`);
    keys.delete(name);
  }
  await widenColumn(conn, 'website_users', 'id', 'VARCHAR(64) NOT NULL');
  for (const [table, column] of columns.values()) {
    await widenColumn(conn, table, column, 'VARCHAR(64) NOT NULL');
  }
  for (const [name, key] of recoverable) {
    if (!keys.has(name)) await addUserForeignKey(conn, key);
  }
  await conn.execute('DELETE FROM website_migration_foreign_keys WHERE scope = ?', [USER_FK_JOURNAL_SCOPE]);
}

// Earlier releases had no journal. Restore the known schema constraints for
// databases that already recorded 017/019 after an interrupted widening.
async function repairKnownUserForeignKeys(conn) {
  await widenUserIdColumns(conn);
  const keys = await loadUserForeignKeys(conn);
  for (const [table, column] of USER_ID_COLUMNS) {
    if (await columnLength(conn, table, column) === null) continue;
    const present = [...keys.values()].some(key => key.table === table &&
      key.columns.some((name, index) => name === column && key.referencedColumns[index] === 'id'));
    if (present) continue;
    await addUserForeignKey(conn, {
      table, constraint: `fk_uuid_repair_${table}`, columns: [column],
      referencedTable: 'website_users', referencedColumns: ['id'],
      deleteRule: 'CASCADE', updateRule: 'RESTRICT',
    });
  }
}

const MIGRATIONS = [
  {
    version: '001',
    name: 'website roles and users',
    async up(conn) {
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS website_roles (
          id INT AUTO_INCREMENT PRIMARY KEY,
          name VARCHAR(50) NOT NULL UNIQUE,
          description VARCHAR(255) DEFAULT '',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      await conn.execute(`
        INSERT IGNORE INTO website_roles (name, description) VALUES
          ('admin', 'Administrator with full access to admin panel'),
          ('user', 'Regular user with basic access')
      `);
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS website_users (
          id VARCHAR(30) PRIMARY KEY,
          username VARCHAR(20) NOT NULL UNIQUE,
          password VARCHAR(255) NOT NULL,
          role_id INT DEFAULT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (role_id) REFERENCES website_roles(id) ON DELETE SET NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      await addColumnIfMissing(
        conn,
        'ALTER TABLE website_users ADD COLUMN role_id INT DEFAULT NULL'
      );
      const [roles] = await conn.execute(
        'SELECT id FROM website_roles WHERE name = ?',
        ['user']
      );
      if (roles.length > 0) {
        await conn.execute(
          'UPDATE website_users SET role_id = ? WHERE role_id IS NULL',
          [roles[0].id]
        );
      }
    },
  },
  {
    version: '002',
    name: 'role memberships and sessions',
    async up(conn) {
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS website_user_roles (
          user_id VARCHAR(30) NOT NULL,
          role_id INT NOT NULL,
          assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (user_id, role_id),
          FOREIGN KEY (user_id) REFERENCES website_users(id) ON DELETE CASCADE,
          FOREIGN KEY (role_id) REFERENCES website_roles(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      await conn.execute(`
        INSERT IGNORE INTO website_user_roles (user_id, role_id)
        SELECT id, role_id FROM website_users WHERE role_id IS NOT NULL
      `);
      const [roles] = await conn.execute(
        'SELECT id FROM website_roles WHERE name = ?',
        ['user']
      );
      if (roles.length > 0) {
        await conn.execute(
          `INSERT IGNORE INTO website_user_roles (user_id, role_id)
           SELECT u.id, ? FROM website_users u
           LEFT JOIN website_user_roles ur ON ur.user_id = u.id
           WHERE ur.user_id IS NULL`,
          [roles[0].id]
        );
      }
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS website_sessions (
          sid VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
          data MEDIUMTEXT NOT NULL,
          expires_at BIGINT UNSIGNED NOT NULL,
          INDEX idx_website_sessions_expires (expires_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
    },
  },
  {
    version: '003',
    name: 'website connections',
    async up(conn) {
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS website_connections (
          id INT AUTO_INCREMENT PRIMARY KEY,
          name VARCHAR(80) NOT NULL,
          slug VARCHAR(50) NOT NULL UNIQUE,
          target_url TEXT NOT NULL,
          description VARCHAR(255) DEFAULT '',
          enabled TINYINT(1) NOT NULL DEFAULT 1,
          hidden TINYINT(1) NOT NULL DEFAULT 0,
          legacy_proxy_routing TINYINT(1) NOT NULL DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      await addColumnIfMissing(
        conn,
        'ALTER TABLE website_connections ADD COLUMN hidden TINYINT(1) NOT NULL DEFAULT 0 AFTER enabled'
      );
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS website_connection_roles (
          connection_id INT NOT NULL,
          role_id INT NOT NULL,
          PRIMARY KEY (connection_id, role_id),
          FOREIGN KEY (connection_id) REFERENCES website_connections(id) ON DELETE CASCADE,
          FOREIGN KEY (role_id) REFERENCES website_roles(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS website_connection_users (
          connection_id INT NOT NULL,
          user_id VARCHAR(30) NOT NULL,
          PRIMARY KEY (connection_id, user_id),
          FOREIGN KEY (connection_id) REFERENCES website_connections(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES website_users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
    },
  },
  {
    version: '004',
    name: 'events and Discord account links',
    async up(conn) {
      await addColumnIfMissing(
        conn,
        'ALTER TABLE website_users ADD COLUMN discord_user_id VARCHAR(32) DEFAULT NULL UNIQUE'
      );
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS website_link_codes (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          user_id VARCHAR(30) NOT NULL,
          code_hash CHAR(64) NOT NULL,
          expires_at DATETIME NOT NULL,
          used_at DATETIME DEFAULT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_link_codes_hash (code_hash),
          FOREIGN KEY (user_id) REFERENCES website_users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS website_events (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          created_by VARCHAR(30) NOT NULL,
          guild_id BIGINT NOT NULL,
          channel_id BIGINT DEFAULT NULL,
          title VARCHAR(100) NOT NULL,
          description VARCHAR(500) DEFAULT '',
          mode VARCHAR(30) DEFAULT 'Custom match',
          start_at DATETIME NOT NULL,
          max_players SMALLINT UNSIGNED NOT NULL DEFAULT 10,
          status ENUM('draft', 'open', 'closed', 'cancelled') NOT NULL DEFAULT 'open',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_events_guild_start (guild_id, start_at),
          FOREIGN KEY (created_by) REFERENCES website_users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS website_event_participants (
          event_id BIGINT NOT NULL,
          user_id VARCHAR(30) NOT NULL,
          joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (event_id, user_id),
          FOREIGN KEY (event_id) REFERENCES website_events(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES website_users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
    },
  },
  {
    version: '005',
    name: 'event visibility controls',
    async up(conn) {
      await addColumnIfMissing(
        conn,
        'ALTER TABLE website_events ADD COLUMN visible TINYINT(1) NOT NULL DEFAULT 1 AFTER status'
      );
    },
  },
  {
    version: '006',
    name: 'guild activity statistics',
    async up(conn) {
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS guild_activity_stats (
          guild_id BIGINT NOT NULL,
          day DATE NOT NULL,
          command_count INT NOT NULL DEFAULT 0,
          voice_joins INT NOT NULL DEFAULT 0,
          PRIMARY KEY (guild_id, day)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
    },
  },
  {
    version: '007',
    name: 'scheduled announcements',
    async up(conn) {
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS website_announcements (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          created_by VARCHAR(30) NOT NULL,
          guild_id BIGINT NOT NULL,
          channel_id BIGINT NOT NULL,
          content VARCHAR(2000) NOT NULL,
          scheduled_at DATETIME NOT NULL,
          status ENUM('scheduled', 'sent', 'cancelled') NOT NULL DEFAULT 'scheduled',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_announcements_due (status, scheduled_at),
          FOREIGN KEY (created_by) REFERENCES website_users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
    },
  },
  {
    version: '008',
    name: 'Discord guild metadata',
    async up(conn) {
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS discord_guild_metadata (
          guild_id BIGINT PRIMARY KEY,
          guild_name VARCHAR(100) NOT NULL,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
    },
  },
  {
    version: '009',
    name: 'Discord guild channels',
    async up(conn) {
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS discord_guild_channels (
          guild_id BIGINT NOT NULL,
          channel_id BIGINT NOT NULL,
          channel_name VARCHAR(100) NOT NULL,
          PRIMARY KEY (guild_id, channel_id),
          INDEX idx_guild_channel_name (guild_id, channel_name)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
    },
  },
  {
    version: '010',
    name: 'connection proxy routing mode',
    async up(conn) {
      await addColumnIfMissing(
        conn,
        'ALTER TABLE website_connections ADD COLUMN legacy_proxy_routing TINYINT(1) NOT NULL DEFAULT 0 AFTER hidden'
      );
    },
  },
  {
    version: '011',
    name: 'terms acceptance and encrypted remote profiles',
    async up(conn) {
      await addColumnIfMissing(
        conn,
        'ALTER TABLE website_users ADD COLUMN terms_accepted_at DATETIME DEFAULT NULL'
      );
      await addColumnIfMissing(
        conn,
        "ALTER TABLE website_users ADD COLUMN terms_version VARCHAR(32) DEFAULT NULL"
      );
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS website_remote_profiles (
          user_id VARCHAR(30) PRIMARY KEY,
          encrypted_data MEDIUMTEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES website_users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
    },
  },
  {
    version: '012',
    name: 'website page visibility controls',
    async up(conn) {
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS website_page_visibility (
          page_key VARCHAR(50) PRIMARY KEY,
          public_access TINYINT(1) NOT NULL DEFAULT 0,
          authenticated_access TINYINT(1) NOT NULL DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS website_page_visibility_roles (
          page_key VARCHAR(50) NOT NULL,
          role_id INT NOT NULL,
          PRIMARY KEY (page_key, role_id),
          FOREIGN KEY (page_key) REFERENCES website_page_visibility(page_key) ON DELETE CASCADE,
          FOREIGN KEY (role_id) REFERENCES website_roles(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS website_page_visibility_users (
          page_key VARCHAR(50) NOT NULL,
          user_id VARCHAR(30) NOT NULL,
          PRIMARY KEY (page_key, user_id),
          FOREIGN KEY (page_key) REFERENCES website_page_visibility(page_key) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES website_users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      await conn.execute(`
        INSERT IGNORE INTO website_page_visibility
          (page_key, public_access, authenticated_access) VALUES
          ('roller', 1, 1),
          ('events', 0, 1),
          ('account', 0, 1),
          ('remote', 0, 1),
          ('chromium', 0, 1)
      `);
    },
  },
  {
    version: '013',
    name: 'guild manager and categorized log channels',
    async up(conn) {
      await addColumnIfMissing(conn, 'ALTER TABLE discord_guild_metadata ADD COLUMN owner_id BIGINT NULL AFTER guild_name');
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS guild_log_channel_settings (
          guild_id BIGINT NOT NULL, log_type VARCHAR(30) NOT NULL, channel_id BIGINT NOT NULL,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (guild_id, log_type)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
    },
  },
  {
    version: '014',
    name: 'Discord guild channel types for private voice settings',
    async up(conn) {
      await addColumnIfMissing(
        conn,
        "ALTER TABLE discord_guild_channels ADD COLUMN channel_type VARCHAR(16) NOT NULL DEFAULT 'text' AFTER channel_name"
      );
    },
  },
  {
    version: '015',
    name: 'VLESS tunnel page visibility',
    async up(conn) {
      await conn.execute(`
        INSERT IGNORE INTO website_page_visibility
          (page_key, public_access, authenticated_access)
        VALUES ('vless-tunnel', 0, 1)
      `);
    },
  },
  {
    version: '016',
    name: 'per-user named encrypted RDP profiles',
    async up(conn) {
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS website_rdp_profiles (
          id CHAR(36) NOT NULL PRIMARY KEY,
          user_id VARCHAR(30) NOT NULL,
          name VARCHAR(100) NOT NULL,
          encrypted_data MEDIUMTEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_rdp_profiles_user (user_id),
          FOREIGN KEY (user_id) REFERENCES website_users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
    },
  },
  {
    version: '017',
    name: 'widen website user identifiers for uuid ids',
    up: widenUserIdColumns,
  },
  {
    version: '018',
    name: 'FnOS file permissions and expiring shares',
    async up(conn) {
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS website_file_permissions (
          user_id VARCHAR(64) NOT NULL PRIMARY KEY,
          can_read TINYINT(1) NOT NULL DEFAULT 0,
          can_write TINYINT(1) NOT NULL DEFAULT 0,
          can_share TINYINT(1) NOT NULL DEFAULT 0,
          requested_at DATETIME NULL,
          FOREIGN KEY (user_id) REFERENCES website_users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS website_file_shares (
          id CHAR(36) NOT NULL PRIMARY KEY,
          owner_id VARCHAR(64) NOT NULL,
          code_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
          source_path TEXT NOT NULL,
          name VARCHAR(255) NOT NULL,
          is_directory TINYINT(1) NOT NULL,
          expires_at DATETIME NOT NULL,
          revoked_at DATETIME NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_file_shares_owner (owner_id),
          FOREIGN KEY (owner_id) REFERENCES website_users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
    },
  },
  {
    // A deployment that ran the unreleased file-browser migration recorded 017
    // as the file migration, so the uuid widening was skipped on that database.
    // Re-running it here is safe: every column is only widened when it is short.
    version: '019',
    name: 'ensure uuid-wide user identifiers after the file-browser migration',
    up: widenUserIdColumns,
  },
  {
    version: '020',
    name: 'Clash VPN servers and per-user subscriptions',
    async up(conn) {
      await conn.execute(`CREATE TABLE IF NOT EXISTS website_clash_servers (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL UNIQUE,
        enabled TINYINT(1) NOT NULL DEFAULT 1,
        proxy_json TEXT NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
      await conn.execute(`CREATE TABLE IF NOT EXISTS website_clash_subscriptions (
        user_id VARCHAR(64) NOT NULL PRIMARY KEY,
        token CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
        expires_at DATETIME NOT NULL,
        enabled TINYINT(1) NOT NULL DEFAULT 1,
        FOREIGN KEY (user_id) REFERENCES website_users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
      await conn.execute(`CREATE TABLE IF NOT EXISTS website_clash_grants (
        user_id VARCHAR(64) NOT NULL,
        server_id INT NOT NULL,
        PRIMARY KEY (user_id, server_id),
        FOREIGN KEY (user_id) REFERENCES website_clash_subscriptions(user_id) ON DELETE CASCADE,
        FOREIGN KEY (server_id) REFERENCES website_clash_servers(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    },
  },
  {
    version: '021',
    name: 'SSH-managed Clash accounts and synchronization status',
    async up(conn) {
      for (const definition of [
        'management_profile VARCHAR(64) NULL', "sync_status VARCHAR(16) NOT NULL DEFAULT 'unmanaged'",
        'synced_at DATETIME NULL', 'sync_error VARCHAR(255) NULL', 'deleted_at DATETIME NULL',
      ]) await addColumnIfMissing(conn, 'ALTER TABLE website_clash_servers ADD COLUMN ' + definition);
      await conn.execute(`CREATE TABLE IF NOT EXISTS website_clash_accounts (
        server_id INT NOT NULL, user_id VARCHAR(64) NOT NULL,
        credential_encrypted TEXT NOT NULL, applied TINYINT(1) NOT NULL DEFAULT 0,
        PRIMARY KEY (server_id, user_id),
        FOREIGN KEY (server_id) REFERENCES website_clash_servers(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
      // No user foreign key: deleted users must still be revoked on the VPS.
    },
  },
  {
    version: '022',
    name: 'Independent Clash VPN users',
    async up(conn) {
      await conn.execute(`CREATE TABLE IF NOT EXISTS website_clash_users (
        id VARCHAR(64) NOT NULL PRIMARY KEY, username VARCHAR(100) NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
      // Preserve IDs, URLs, grants and encrypted credentials while separating identities.
      await conn.execute(`INSERT INTO website_clash_users (id, username)
        SELECT s.user_id, LEFT(u.username,100) FROM website_clash_subscriptions s
        JOIN website_users u ON u.id=s.user_id
        ON DUPLICATE KEY UPDATE id=VALUES(id)`);
      const [foreignKeys] = await conn.execute(`SELECT CONSTRAINT_NAME, REFERENCED_TABLE_NAME
        FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE()
        AND TABLE_NAME='website_clash_subscriptions' AND COLUMN_NAME='user_id'
        AND REFERENCED_TABLE_NAME IS NOT NULL`);
      for (const key of foreignKeys.filter(key => key.REFERENCED_TABLE_NAME === 'website_users')) {
        await conn.execute('ALTER TABLE website_clash_subscriptions DROP FOREIGN KEY `' + key.CONSTRAINT_NAME.replaceAll('`', '``') + '`');
      }
      if (!foreignKeys.some(key => key.REFERENCED_TABLE_NAME === 'website_clash_users')) {
        await conn.execute(`ALTER TABLE website_clash_subscriptions ADD CONSTRAINT fk_clash_subscription_vpn_user
          FOREIGN KEY (user_id) REFERENCES website_clash_users(id) ON DELETE CASCADE`);
      }
    },
  },
  {
    version: '023',
    name: 'Per-user Clash routing rule sets',
    async up(conn) {
      await addColumnIfMissing(conn, "ALTER TABLE website_clash_subscriptions ADD COLUMN ruleset_id VARCHAR(32) NOT NULL DEFAULT 'all-vpn'");
    },
  },
  {
    version: '024',
    name: 'Custom per-user Clash routing YAML',
    async up(conn) {
      await addColumnIfMissing(conn, 'ALTER TABLE website_clash_subscriptions ADD COLUMN custom_rules_yaml TEXT NULL');
    },
  },
  {
    version: '025',
    name: 'Shared authentication rate limits',
    async up(conn) {
      await conn.execute(`CREATE TABLE IF NOT EXISTS website_rate_limits (
        bucket VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
        hits INT UNSIGNED NOT NULL,
        expires_at BIGINT NOT NULL,
        INDEX idx_rate_limit_expiry (expires_at)
      ) ENGINE=InnoDB`);
    },
  },
  {
    version: '026',
    name: 'Member mailboxes',
    async up(conn) {
      // Retain ownership reservations after website account deletion. Mailboxes
      // are not deleted implicitly and can never be claimed by a new account.
      await conn.execute(`CREATE TABLE IF NOT EXISTS website_mailboxes (
        user_id VARCHAR(64) NOT NULL PRIMARY KEY,
        email VARCHAR(254) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL UNIQUE,
        provision_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
        status VARCHAR(16) NOT NULL DEFAULT 'pending',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
      await conn.execute(`INSERT IGNORE INTO website_page_visibility
        (page_key, public_access, authenticated_access) VALUES ('mail', 0, 1)`);
    },
  },
  {
    version: '027',
    name: 'recover resumable user identifier foreign keys',
    up: repairKnownUserForeignKeys,
  },
  {
    version: '028',
    name: 'version authenticated website sessions',
    async up(conn) {
      await addColumnIfMissing(conn,
        'ALTER TABLE website_users ADD COLUMN session_version INT UNSIGNED NOT NULL DEFAULT 0');
    },
  },
  {
    version: '029',
    name: 'event waitlists, promotion receipts and announcement reconciliation',
    async up(conn) {
      await conn.execute(`CREATE TABLE IF NOT EXISTS website_event_waitlist (
        ticket BIGINT AUTO_INCREMENT PRIMARY KEY,
        event_id BIGINT NOT NULL, user_id VARCHAR(64) NOT NULL,
        UNIQUE KEY uq_event_waiter (event_id, user_id),
        INDEX idx_event_ticket (event_id, ticket),
        FOREIGN KEY (event_id) REFERENCES website_events(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES website_users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
      await addColumnIfMissing(conn, 'ALTER TABLE website_event_participants ADD COLUMN promoted_ticket BIGINT NULL UNIQUE');
      await addColumnIfMissing(conn, 'ALTER TABLE website_announcements ADD COLUMN promotion_ticket BIGINT NULL UNIQUE');
      await addColumnIfMissing(conn, 'ALTER TABLE website_announcements ADD COLUMN claim_token CHAR(32) NULL');
      await addColumnIfMissing(conn, 'ALTER TABLE website_announcements ADD COLUMN claimed_at DATETIME NULL');
      await addColumnIfMissing(conn, 'ALTER TABLE website_announcements ADD COLUMN retry_after DATETIME NULL');
      await addColumnIfMissing(conn, 'ALTER TABLE website_announcements ADD COLUMN discord_message_id VARCHAR(32) NULL');
      await conn.execute(`ALTER TABLE website_announcements MODIFY channel_id BIGINT NULL,
        MODIFY status ENUM('scheduled','sending','sent','cancelled','review') NOT NULL DEFAULT 'scheduled'`);
    },
  },
  {
    version: '030',
    name: 'device activity, administrator audit log and pending guild configuration',
    async up(conn) {
      await addColumnIfMissing(conn, 'ALTER TABLE website_sessions ADD COLUMN last_active_at DATETIME(3) NULL');
      await conn.execute(`CREATE TABLE IF NOT EXISTS website_admin_audit (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        actor_id VARCHAR(64) NOT NULL, action VARCHAR(32) NOT NULL, target VARCHAR(128) NOT NULL,
        outcome ENUM('success','rejected','failed') NOT NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        INDEX idx_audit_actor (actor_id,id), INDEX idx_audit_target (target,id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
      await conn.execute(`CREATE TABLE IF NOT EXISTS website_guild_config_pending (
        guild_id BIGINT PRIMARY KEY, language VARCHAR(8) NOT NULL
      ) ENGINE=InnoDB`);
    },
  },
];

async function runMigrations(conn, migrations = MIGRATIONS) {
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS website_schema_migrations (
      version VARCHAR(32) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  const [rows] = await conn.execute('SELECT version FROM website_schema_migrations');
  const applied = new Set(rows.map(row => String(row.version)));

  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    await migration.up(conn);
    await conn.execute(
      'INSERT INTO website_schema_migrations (version, name) VALUES (?, ?)',
      [migration.version, migration.name]
    );
  }
}

module.exports = { runMigrations, MIGRATIONS };
