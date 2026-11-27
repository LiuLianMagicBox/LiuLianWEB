const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { findUserById, getVisiblePageKeys } = require('../db');
const { MySqlRateLimitStore } = require('../rate_limit_store');
const { termsRequired } = require('../services/terms_config');
const { mailConfig, createMailuClient } = require('../services/mailu');
const { createRepository } = require('../db/mailboxes');
const { createMailboxService } = require('../services/mailboxes');

function createRouter({ env = process.env, findUser = findUserById, visiblePages = getVisiblePageKeys, service } = {}) {
  const config = service ? null : mailConfig(env);
  service ||= createMailboxService({ config, client: config && createMailuClient(config), repo: createRepository() });
  const router = express.Router();
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const userId = req.session?.user?.id;
    if (!userId) return res.status(401).json({ error: 'Login required' });
    Promise.all([findUser(userId), visiblePages(userId)]).then(([user, pages]) => {
      if (!user) return res.status(401).json({ error: 'Login required' });
      if (!pages.mail) return res.status(403).json({ error: 'You do not have access to this page' });
      if (termsRequired(env) && !user.terms_accepted_at) return res.status(403).json({ error: 'Please accept the website terms first.', code: 'TERMS_REQUIRED' });
      next();
    }, next);
  });
  router.get('/', (req, res, next) => service.status(req.session.user.id).then(data => res.json(data), next));
  router.post('/', (req, res, next) => {
    if (req.get('X-Mail-Request') !== '1' || !req.is('application/json')) return res.status(403).json({ error: 'Please use the mailbox page.' });
    next();
  }, rateLimit({
    windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false,
    keyGenerator: req => req.session.user.id,
    ...(env.DISTRIBUTED_DEPLOYMENT === 'true' ? { store: new MySqlRateLimitStore('mail-create') } : {}),
    message: { error: 'Too many mailbox attempts. Please try again later.' },
  }), (req, res, next) => service.create(req.session.user.id, req.body).then(data => res.json(data), next));
  return router;
}
module.exports = { createRouter };
