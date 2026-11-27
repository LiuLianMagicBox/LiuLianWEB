const { getPool, validateString } = require('./pool');
const { normalizeEventInput, validateSnowflake } = require('../services/event_validation');

function eventKey(value) {
  const text = String(value);
  if ((typeof value !== 'string' && !Number.isSafeInteger(value)) ||
      !/^[1-9]\d{0,18}$/.test(text) || BigInt(text) > 9223372036854775807n) throw new Error('Invalid event id');
  return value;
}

async function listEvents({ guildId, userId, eventId, includeHidden = false } = {}) {
  const p = await getPool();
  const params = [];
  const filters = [
    ...(includeHidden ? [] : ['e.visible = 1']),
    'e.status = \'open\'', 'e.start_at >= UTC_TIMESTAMP()'
  ];
  if (eventId != null) { filters.push('e.id = CAST(? AS SIGNED)'); params.push(eventKey(eventId)); }
  if (guildId != null) { filters.push('e.guild_id = ?'); params.push(validateSnowflake(guildId, 'Guild ID')); }
  const [rows] = await p.execute(
    `SELECT e.*, gm.guild_name, u.username AS creator_username,
            COUNT(ep.user_id) AS participant_count,
            MAX(ep.user_id = ?) AS joined,
            MAX(ep.user_id = ? AND ep.promoted_ticket IS NOT NULL) AS promoted,
            (SELECT COUNT(*) FROM website_event_waitlist w WHERE w.event_id=e.id) AS waitlist_count,
            (SELECT COUNT(*) FROM website_event_waitlist w WHERE w.event_id=e.id AND w.ticket <=
              (SELECT mine.ticket FROM website_event_waitlist mine WHERE mine.event_id=e.id AND mine.user_id=?)) AS waitlist_position
     FROM website_events e
     JOIN website_users u ON u.id = e.created_by
     LEFT JOIN discord_guild_metadata gm ON gm.guild_id = e.guild_id
     LEFT JOIN website_event_participants ep ON ep.event_id = e.id
     WHERE ${filters.join(' AND ')}
     GROUP BY e.id ORDER BY e.start_at ASC`,
    [userId || '', userId || '', userId || '', ...params]
  );
  return rows;
}

async function listAdminEvents() {
  const p = await getPool();
  const [rows] = await p.execute(
    `SELECT e.id, e.title, e.guild_id, gm.guild_name, e.start_at, e.status, e.visible,
            COUNT(ep.user_id) AS participant_count, u.username AS creator_username
     FROM website_events e JOIN website_users u ON u.id = e.created_by
     LEFT JOIN discord_guild_metadata gm ON gm.guild_id = e.guild_id
     LEFT JOIN website_event_participants ep ON ep.event_id = e.id
     GROUP BY e.id ORDER BY e.start_at DESC`
  );
  return rows;
}

async function updateEventVisibility(eventId, visible) {
  const p = await getPool();
  const [result] = await p.execute(
    'UPDATE website_events SET visible = ? WHERE id = CAST(? AS SIGNED)', [visible ? 1 : 0, eventKey(eventId)]
  );
  if (result.affectedRows === 0) throw new Error('Event not found');
  return true;
}

async function createEvent(userId, input) {
  const data = normalizeEventInput(input);
  const p = await getPool();
  const [result] = await p.execute(
    `INSERT INTO website_events
      (created_by, guild_id, channel_id, title, description, mode, start_at, max_players)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [validateString(userId, 'user id'), data.guildId, data.channelId, data.title,
      data.description, data.mode, data.startAt, data.maxPlayers]
  );
  return { id: result.insertId, ...data, status: 'open', participant_count: 0, joined: 0 };
}

async function changeRegistration(eventId, userId, join) {
  const id = eventKey(eventId);
  const conn = await (await getPool()).getConnection();
  try {
    await conn.beginTransaction();
    // Acquire the event lock before the first consistent read on either client.
    const [[event]] = await conn.execute(
      `SELECT max_players FROM website_events WHERE id=CAST(? AS SIGNED) AND visible=1
       AND status='open' AND start_at >= UTC_TIMESTAMP() FOR UPDATE`, [id]);
    if (!event) throw new Error('Event not found');
    const result = join ? await register(conn, id, userId, event.max_players)
      : await withdraw(conn, id, userId, event.max_players);
    await conn.commit();
    return result;
  } catch (err) { await conn.rollback(); throw err; }
  finally { conn.release(); }
}

async function register(conn, id, userId, capacity) {
  const [[count]] = await conn.execute(
    'SELECT COUNT(*) AS total, COUNT(CASE WHEN user_id=? THEN 1 END) AS mine FROM website_event_participants WHERE event_id=CAST(? AS SIGNED)',
    [userId, id]);
  if (Number(count.mine)) return { joined: true, alreadyJoined: true };
  const [[existing]] = await conn.execute(
    'SELECT ticket FROM website_event_waitlist WHERE event_id=CAST(? AS SIGNED) AND user_id=?', [id, userId]);
  if (!existing && Number(count.total) < capacity) {
    await conn.execute('INSERT INTO website_event_participants (event_id,user_id) VALUES (?,?)', [id, userId]);
    return { joined: true, alreadyJoined: false };
  }
  if (!existing) await conn.execute('INSERT INTO website_event_waitlist (event_id,user_id) VALUES (?,?)', [id, userId]);
  const [[row]] = await conn.execute(
    `SELECT COUNT(*) AS position FROM website_event_waitlist WHERE event_id=CAST(? AS SIGNED) AND ticket <=
     (SELECT ticket FROM website_event_waitlist WHERE event_id=CAST(? AS SIGNED) AND user_id=?)`, [id, id, userId]);
  return { joined: false, waitlist_position: Number(row.position) };
}

async function withdraw(conn, id, userId, capacity) {
  const [seat] = await conn.execute('DELETE FROM website_event_participants WHERE event_id=CAST(? AS SIGNED) AND user_id=?', [id, userId]);
  if (!seat.affectedRows) {
    const [waiting] = await conn.execute('DELETE FROM website_event_waitlist WHERE event_id=CAST(? AS SIGNED) AND user_id=?', [id, userId]);
    return { left: Boolean(waiting.affectedRows) };
  }
  const [[next]] = await conn.execute(
    `SELECT ticket,user_id FROM website_event_waitlist WHERE event_id=CAST(? AS SIGNED)
      AND (SELECT COUNT(*) FROM website_event_participants WHERE event_id=CAST(? AS SIGNED)) < ?
      ORDER BY ticket LIMIT 1`, [id, id, capacity]);
  if (next) {
    await conn.execute('INSERT INTO website_event_participants (event_id,user_id,promoted_ticket) VALUES (?,?,?)', [id, next.user_id, next.ticket]);
    await conn.execute('DELETE FROM website_event_waitlist WHERE ticket=?', [next.ticket]);
    await conn.execute(
      `INSERT INTO website_announcements (created_by,guild_id,promotion_ticket,content,scheduled_at)
       SELECT created_by,guild_id,?,CONCAT('候補已補上 / Seat confirmed: ',title,' (#',id,')'),UTC_TIMESTAMP()
       FROM website_events WHERE id=CAST(? AS SIGNED)`, [next.ticket, id]);
  }
  return { left: true };
}

function joinEvent(id, userId) { return changeRegistration(id, userId, true); }
function leaveEvent(id, userId) { return changeRegistration(id, userId, false); }

async function getEventParticipants(eventId) {
  const p = await getPool();
  const [rows] = await p.execute(
    `SELECT u.id, u.username, u.discord_user_id
     FROM website_event_participants ep JOIN website_users u ON u.id = ep.user_id
     JOIN website_events e ON e.id=ep.event_id
     WHERE ep.event_id = CAST(? AS SIGNED) AND e.visible=1 AND e.status='open' AND e.start_at >= UTC_TIMESTAMP() ORDER BY ep.joined_at, ep.user_id`, [eventKey(eventId)]
  );
  return rows;
}

module.exports = { normalizeEventInput, listEvents, listAdminEvents, updateEventVisibility, createEvent, joinEvent, leaveEvent, getEventParticipants };
