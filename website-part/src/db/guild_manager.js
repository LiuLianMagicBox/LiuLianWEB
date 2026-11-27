const path = require('path');
const { getPool, validateString } = require('./pool');
const { readConfig, flushGuildConfig } = require('../services/guild_config_sync');
const { AppError, InputError } = require('../errors');

const CONFIG_PATH = process.env.DISCORD_CONFIG_PATH || path.join(__dirname, '..', '..', '..', 'shared', 'discord', 'config.json');
const LOG_TYPES = ['all', 'useraction', 'voiceaction', 'groupaction', 'messageaction', 'channelaction', 'roleaction'];
const LANGUAGES = ['en', 'zh_TW'];

function loadConfig(required = false) {
  try { return readConfig(CONFIG_PATH); }
  catch (error) {
    if (!required && error.code === 'ENOENT') return {};
    throw new AppError('Discord configuration is unavailable. Please retry.', 503, 'GUILD_CONFIG_UNAVAILABLE');
  }
}

async function syncGuildConfig() { return flushGuildConfig(await getPool(), CONFIG_PATH); }

function canManage(config, discordUserId, guild) {
  const userId = String(discordUserId || '');
  return userId && (
    String(guild.owner_id || '') === userId ||
    (config.guild_admins?.[String(guild.guild_id)] || []).map(String).includes(userId) ||
    (config.bot_admin || []).map(String).includes(userId) ||
    (config.bot_owner || []).map(String).includes(userId)
  );
}

async function listManagedGuilds(discordUserId) {
  const p = await getPool();
  const [guilds] = await p.execute('SELECT guild_id, guild_name, owner_id FROM discord_guild_metadata ORDER BY guild_name');
  const config = loadConfig();
  return guilds.filter(guild => canManage(config, discordUserId, guild)).map(guild => ({
    guild_id: String(guild.guild_id), guild_name: guild.guild_name,
  }));
}

async function getManagedGuild(discordUserId, guildId, requireConfig = false) {
  const safeGuildId = validateString(String(guildId), 'guild id');
  const p = await getPool();
  const [[guilds], [channels], [logChannels], [privateVoiceRows], [pending]] = await Promise.all([
    p.execute('SELECT guild_id, guild_name, owner_id FROM discord_guild_metadata WHERE guild_id = ?', [safeGuildId]),
    p.execute('SELECT channel_id, channel_name, channel_type FROM discord_guild_channels WHERE guild_id = ? ORDER BY channel_type, channel_name', [safeGuildId]),
    p.execute('SELECT log_type, channel_id FROM guild_log_channel_settings WHERE guild_id = ?', [safeGuildId]),
    p.execute("SELECT channel_id FROM private_voice_channels WHERE guild_id = ? AND config_type = 'trigger' LIMIT 1", [safeGuildId]),
    p.execute('SELECT language FROM website_guild_config_pending WHERE guild_id=?', [safeGuildId]),
  ]);
  const guild = guilds[0];
  const config = loadConfig(requireConfig);
  if (!guild || !canManage(config, discordUserId, guild)) return null;
  const logChannelsByType = Object.fromEntries(logChannels.map(row => [row.log_type, String(row.channel_id)]));
  const [fallbackRows] = await p.execute('SELECT channel_id FROM guild_log_channels WHERE guild_id = ?', [safeGuildId]);
  return {
    guild_id: safeGuildId, guild_name: guild.guild_name,
    language: pending[0]?.language || config.guild_languages?.[safeGuildId] || 'en',
    language_sync_pending: Boolean(pending.length),
    log_channels: logChannelsByType, fallback_log_channel_id: fallbackRows[0] ? String(fallbackRows[0].channel_id) : null,
    private_voice_trigger_channel_id: privateVoiceRows[0] ? String(privateVoiceRows[0].channel_id) : null,
    channels: channels.map(row => ({ channel_id: String(row.channel_id), channel_name: row.channel_name, channel_type: row.channel_type })),
  };
}

async function updateManagedGuild(discordUserId, guildId, input) {
  const detail = await getManagedGuild(discordUserId, guildId, true);
  if (!detail) return null;
  const language = input?.language;
  const logChannels = input?.log_channels;
  const privateVoiceTriggerChannelId = input?.private_voice_trigger_channel_id == null ? null : String(input.private_voice_trigger_channel_id);
  if (!LANGUAGES.includes(language) || !logChannels || typeof logChannels !== 'object' || Array.isArray(logChannels)) throw new InputError('Invalid guild settings');
  const validTextChannels = new Set(detail.channels.filter(channel => channel.channel_type === 'text').map(channel => channel.channel_id));
  const validVoiceChannels = new Set(detail.channels.filter(channel => channel.channel_type === 'voice').map(channel => channel.channel_id));
  const updates = Object.entries(logChannels);
  if (updates.some(([type, channelId]) => !LOG_TYPES.includes(type) || !validTextChannels.has(String(channelId)))) throw new InputError('Every log channel must be a text channel in this Discord server');
  if (privateVoiceTriggerChannelId && !validVoiceChannels.has(privateVoiceTriggerChannelId)) throw new InputError('The private voice trigger must be a voice channel in this Discord server');
  const p = await getPool();
  const conn = await p.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(`INSERT INTO website_guild_config_pending (guild_id,language) VALUES (?,?)
      ON DUPLICATE KEY UPDATE language=VALUES(language)`, [detail.guild_id, language]);
    await conn.execute('DELETE FROM guild_log_channel_settings WHERE guild_id = ?', [detail.guild_id]);
    for (const [type, channelId] of updates) {
      await conn.execute('INSERT INTO guild_log_channel_settings (guild_id, log_type, channel_id) VALUES (?, ?, ?)', [detail.guild_id, type, String(channelId)]);
    }
    if (logChannels.all) {
      await conn.execute('INSERT INTO guild_log_channels (guild_id, channel_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE channel_id=VALUES(channel_id)', [detail.guild_id, String(logChannels.all)]);
    }
    await conn.execute("DELETE FROM private_voice_channels WHERE guild_id = ? AND config_type = 'trigger'", [detail.guild_id]);
    if (privateVoiceTriggerChannelId) {
      await conn.execute(
        "INSERT INTO private_voice_channels (guild_id, channel_id, owner_id, config_json, config_type, trigger_guild_id) VALUES (?, ?, ?, ?, 'trigger', ?) ON DUPLICATE KEY UPDATE guild_id=VALUES(guild_id), owner_id=VALUES(owner_id), config_json=VALUES(config_json), config_type='trigger', trigger_guild_id=VALUES(trigger_guild_id), updated_at=NOW()",
        [detail.guild_id, privateVoiceTriggerChannelId, String(discordUserId), JSON.stringify({ type: 'trigger' }), detail.guild_id],
      );
    }
    await conn.commit();
  } catch (err) { await conn.rollback(); throw err; } finally { conn.release(); }
  const synced = await syncGuildConfig().catch(() => false);
  return { ...detail, language, language_sync_pending: !synced, log_channels: logChannels,
    fallback_log_channel_id: logChannels.all || detail.fallback_log_channel_id,
    private_voice_trigger_channel_id: privateVoiceTriggerChannelId };
}

module.exports = { listManagedGuilds, getManagedGuild, updateManagedGuild, syncGuildConfig, LOG_TYPES, LANGUAGES };
