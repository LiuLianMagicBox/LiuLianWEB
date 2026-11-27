const { AppError, ConflictError } = require('../errors');
const { validateMailbox } = require('./mailu');

const ownMailbox = (user, row) => user?.comment === `LiuLianWEB:${row.provision_id}` && user.global_admin === false;
function createMailboxService({ config, client, repo }) {
  function publicState(row) {
    return { configured: true, domain: config.domain, webmailUrl: config.webmailUrl,
      quotaBytes: config.quotaBytes, mailbox: row ? { email: row.email, status: row.status } : null };
  }
  return {
    async status(userId) { return config ? publicState(await repo.get(userId)) : { configured: false, mailbox: null }; },
    async create(userId, input) {
      if (!config) throw new AppError('Mailbox registration is not available yet.', 503, 'MAIL_DISABLED');
      const { localpart, password } = validateMailbox(input);
      const email = `${localpart}@${config.domain}`;
      return repo.withLock(userId, async store => {
        let row = await store.get(userId);
        if (row?.status === 'ready') return publicState(row);
        if (row && row.email !== email) throw new ConflictError('Retry the pending mailbox before choosing another name.');
        if (!row) row = await store.reserve(userId, email);
        const finish = async existing => {
          if (!existing) throw new AppError('Mail service is temporarily unavailable. Please retry.', 503, 'MAIL_UNAVAILABLE');
          if (!ownMailbox(existing, row)) {
            await store.release(userId);
            throw new ConflictError('This mailbox name is unavailable.');
          }
          await store.ready(userId);
          return publicState({ ...row, status: 'ready' });
        };
        // Persist the random ownership marker before contacting Mailu. If a request
        // times out after creation, retry reconciles that exact account, never an
        // existing administrator/account merely sharing the requested name.
        const existing = await client.getUser(email);
        if (existing) return finish(existing);
        if (await client.getAlias(email)) {
          await store.release(userId);
          throw new ConflictError('This mailbox name is unavailable.');
        }
        try { await client.createUser(row, password); }
        catch (err) {
          if (err.code === 'MAIL_CONFLICT') {
            const recovered = await client.getUser(email);
            if (recovered) return finish(recovered);
            await store.release(userId);
          }
          // Unknown results retain the reservation for a safe retry.
          throw err;
        }
        return finish(await client.getUser(email));
      });
    },
  };
}
module.exports = { createMailboxService };
