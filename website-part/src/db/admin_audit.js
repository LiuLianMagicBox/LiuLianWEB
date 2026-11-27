const { getPool } = require('./pool');

async function writeAudit(conn, entry, outcome = 'success') {
  if (!entry) return;
  await conn.execute(`INSERT INTO website_admin_audit (actor_id,action,target,outcome) VALUES (?,?,?,?)`,
    [entry.actor, entry.action, entry.target, outcome]);
}

async function auditedRoleChange(entry, change) {
  const pool = await getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await change(conn);
    await writeAudit(conn, entry && { ...entry, target: String(result?.id || entry.target) });
    await conn.commit();
    return result;
  } catch (error) { await conn.rollback(); throw error; }
  finally { conn.release(); }
}

async function recordAuditFailure(entry, status) {
  await writeAudit(await getPool(), entry, status >= 500 ? 'failed' : 'rejected');
}

async function listAudit(before, search) {
  const pool = await getPool();
  const filters = [];
  const params = [];
  if (before) { filters.push('a.id < CAST(? AS UNSIGNED)'); params.push(before); }
  if (search) {
    filters.push('(a.actor_id=? OR a.target=? OR actor.username=? OR member.username=?)');
    params.push(search, search, search, search);
  }
  const [rows] = await pool.execute(
    `SELECT a.id,a.actor_id,actor.username AS actor_name,a.action,a.target,member.username AS member_name,a.outcome,a.created_at
     FROM website_admin_audit a LEFT JOIN website_users actor ON actor.id=a.actor_id
     LEFT JOIN website_users member ON member.id=a.target AND a.action IN ('password_reset','user_groups')
     ${filters.length ? 'WHERE ' + filters.join(' AND ') : ''} ORDER BY a.id DESC LIMIT 51`, params);
  return { entries: rows.slice(0, 50), next: rows.length > 50 ? String(rows[49].id) : null };
}

module.exports = { writeAudit, auditedRoleChange, recordAuditFailure, listAudit };
