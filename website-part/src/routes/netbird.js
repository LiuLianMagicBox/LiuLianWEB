const express = require('express');
const { requireAdmin } = require('../middleware/admin_auth');
const { AppError } = require('../errors');
const { getPool } = require('../db/pool');
const { writeAudit } = require('../db/admin_audit');
const { netbirdConfig, createNetbirdClient, identifier, validate, project } = require('../services/netbird');

function createRouter({ config = netbirdConfig(), client = config && createNetbirdClient(config), adminAuth = requireAdmin,
  audit = async (entry, outcome) => writeAudit(await getPool(), entry, outcome) } = {}) {
  const router = express.Router();
  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.use(adminAuth);
  router.get('/status', (_req, res) => res.json({ configured: Boolean(client) }));
  router.use((_req, _res, next) => next(client ? undefined : new AppError('NetBird is not configured on this server.', 503, 'NETBIRD_DISABLED')));

  function register(kind, base, { create = true, edit = true } = {}) {
    const pathFor = req => base.replace(':networkId', req.params.networkId ? identifier(req.params.networkId) : '')
      + (req.params.id === undefined ? '' : '/' + identifier(req.params.id));
    const handle = fn => async (req, res, next) => { try { await fn(req, res); } catch (error) { next(error); } };
    router.get(base, handle(async (req, res) => {
      const data = await client.request(pathFor(req));
      if (!Array.isArray(data)) throw new AppError('Invalid NetBird response.', 502, 'NETBIRD_RESPONSE');
      res.json({ [kind]: data.map(item => project(kind, item)) });
    }));
    if (!edit) return;
    const mutate = method => handle(async (req, res) => {
      const path = pathFor(req);
      const entry = { actor: req.adminUser.id, action: `netbird_${kind}_${method.toLowerCase()}`, target: path.replace(/^\//, '').slice(0, 128) };
      let result;
      try {
        const body = method === 'DELETE' ? undefined : validate(kind, req.body);
        result = await client.request(path, method, body);
      } catch (error) {
        try { await audit(entry, error.statusCode < 500 ? 'rejected' : 'failed'); }
        catch { console.error('[NetBird] Failed to record unsuccessful operation'); }
        throw error;
      }
      // Remote changes cannot be rolled back with a local DB transaction.
      // Report an audit failure explicitly so callers do not blindly repeat it.
      if (method === 'POST' && typeof result?.id === 'string') entry.target = result.id.slice(0, 128);
      try { await audit(entry, 'success'); } catch {
        throw new AppError('NetBird change succeeded, but its audit log could not be saved. Refresh before continuing.', 503, 'NETBIRD_AUDIT_FAILED');
      }
      if (method === 'DELETE') return res.status(204).end();
      res.status(method === 'POST' ? 201 : 200).json({ item: project(kind, result) });
    });
    if (create) router.post(base, mutate('POST'));
    router.put(base + '/:id', mutate('PUT'));
    router.delete(base + '/:id', mutate('DELETE'));
  }
  register('peers', '/peers', { create: false });
  register('groups', '/groups', { edit: false });
  register('networks', '/networks');
  register('resources', '/networks/:networkId/resources');
  register('routers', '/networks/:networkId/routers');
  return router;
}
module.exports = { createRouter };
