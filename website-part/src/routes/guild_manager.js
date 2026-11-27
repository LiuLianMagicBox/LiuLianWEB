const express = require('express');
const { requireApiAuth } = require('../middleware/auth');
const { findUserById, listManagedGuilds, getManagedGuild, updateManagedGuild, LOG_TYPES, LANGUAGES } = require('../db');

const router = express.Router();
router.use(requireApiAuth);

async function linkedDiscordId(req) {
  return (await findUserById(req.session.user.id))?.discord_user_id || null;
}

router.get('/guilds', async (req, res, next) => {
  try {
    const discordUserId = await linkedDiscordId(req);
    if (!discordUserId) return res.status(403).json({ error: 'Link your Discord account before managing a server' });
    res.json({ guilds: await listManagedGuilds(discordUserId) });
  } catch (err) { next(err); }
});

router.get('/guilds/:guildId', async (req, res, next) => {
  try {
    const discordUserId = await linkedDiscordId(req);
    const guild = discordUserId && await getManagedGuild(discordUserId, req.params.guildId);
    if (!guild) return res.status(404).json({ error: 'Discord server not found or access denied' });
    res.json({ guild, logTypes: LOG_TYPES, languages: LANGUAGES });
  } catch (err) { next(err); }
});

router.put('/guilds/:guildId', async (req, res, next) => {
  // Only the node attached to the Bot's writable configuration may update it.
  // Reject before any SQL writes, avoiding a partially saved configuration.
  if (process.env.DISTRIBUTED_DEPLOYMENT === 'true' && process.env.GUILD_CONFIG_WRITER !== 'true') {
    return res.status(503).json({ error: 'Guild settings must be updated through the configured management node' });
  }
  try {
    const discordUserId = await linkedDiscordId(req);
    if (!discordUserId) return res.status(403).json({ error: 'Link your Discord account before managing a server' });
    const guild = await updateManagedGuild(discordUserId, req.params.guildId, req.body);
    if (!guild) return res.status(404).json({ error: 'Discord server not found or access denied' });
    res.status(guild.language_sync_pending ? 202 : 200).json({ success: true, guild: { ...guild, logTypes: LOG_TYPES, languages: LANGUAGES } });
  } catch (err) { next(err); }
});

module.exports = router;
