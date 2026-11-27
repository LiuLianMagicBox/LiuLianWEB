const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const { requireAdmin } = require('../middleware/admin_auth');
const {
  listAudit,
  recordAuditFailure,
  getAllUsers,
  findUserCredentialsById,
  updatePasswordHash,
  updateUserRoles,
  deleteUser,
  getAllRoles,
  createRole,
  updateRole,
  deleteRole,
  getAllGuilds,
  getGuildDetail,
  listAdminEvents,
  updateEventVisibility,
  getGuildStats,
  listAnnouncementTargets,
  listAnnouncements,
  createAnnouncement,
  cancelAnnouncement,
  resolveAnnouncement,
  getAllPageVisibility,
  updatePageVisibility,
} = require('../db');
const {
  UserGroupInputError,
  normalizeRoleIds,
} = require('../services/user_group_validation');
const { InputError, ConflictError } = require('../errors');
const { AccountInputError, validateConfirmedPassword } = require('../services/account_validation');
const { normalizeGroupInput } = require('../services/group_validation');
const { normalizeEventVisibility } = require('../services/event_visibility_validation');
const { normalizePageVisibility, PageVisibilityInputError } = require('../services/page_visibility');

function groupErrorStatus(err) {
  if (err instanceof InputError) return 400;
  if (err instanceof ConflictError || err.code === 'ER_DUP_ENTRY') return 409;
  if (err.message === 'Role not found') return 404;
  if (err.message.includes('still assigned')) return 409;
  return 500;
}

// All routes require admin
router.use(requireAdmin);

function auditAction(action) {
  return (req, _res, next) => {
    req.audit = {
      actor: req.session.user.id, action,
      target: Array.from((req.params.id || req.params.pageKey || 'new').trim()).slice(0, 128).join('') || 'unknown',
    };
    next();
  };
}

async function rejectChange(req, res, status, error) {
  try { await recordAuditFailure(req.audit, status); }
  catch (failure) { console.error('[Admin] Could not record audit outcome', failure.code || failure.name); }
  return res.status(status).json({ error });
}

router.get('/audit', async (req, res, next) => {
  const { before, search = '' } = req.query;
  if ((before !== undefined && (typeof before !== 'string' || !/^[1-9][0-9]{0,19}$/.test(before) || BigInt(before) > 18446744073709551615n)) ||
      typeof search !== 'string' || search.length > 128) {
    return res.status(400).json({ error: 'Invalid audit filter' });
  }
  try { res.set('Cache-Control', 'no-store').json(await listAudit(before, search.trim())); }
  catch (error) { next(error); }
});

// ======================== Users ========================

// GET /api/admin/users — list all users
router.get('/users', async (req, res) => {
  try {
    const users = await getAllUsers();
    res.json({ users });
  } catch (err) {
    console.error('[Admin] GET /users error:', err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// PUT /api/admin/users/:id — replace user group memberships
router.put('/users/:id', auditAction('user_groups'), async (req, res) => {
  try {
    const roleIds = normalizeRoleIds(req.body?.role_ids);

    // Administrators may add their own groups but cannot remove admin access.
    if (req.params.id === req.session.user.id) {
      const roles = await getAllRoles();
      const adminRole = roles.find(role => role.name === 'admin');
      if (!adminRole || !roleIds.includes(Number(adminRole.id))) {
        return rejectChange(req, res, 400, 'Cannot remove your own admin group');
      }
    }

    const user = await updateUserRoles(req.params.id, roleIds, req.audit);
    res.json({ success: true, user });
  } catch (err) {
    const status = err instanceof UserGroupInputError
      || err.message === 'One or more groups do not exist'
      || err.message === 'At least one group is required'
      ? 400
      : err.message === 'User not found' ? 404 : 500;
    if (status === 500) console.error('[Admin] PUT /users/:id error:', err);
    return rejectChange(req, res, status, status === 500 ? 'Failed to update group settings' : err.message);
  }
});

router.put('/users/:id/password', auditAction('password_reset'), async (req, res) => {
  try {
    const id = req.params.id.trim();
    if (!id || Array.from(id).length > 64) return rejectChange(req, res, 404, 'User not found');
    const password = validateConfirmedPassword(req.body?.newPassword, req.body?.confirmPassword);
    const user = await findUserCredentialsById(id);
    if (!user) return rejectChange(req, res, 404, 'User not found');
    req.audit.target = user.id;
    if (user.id === req.adminUser.id) {
      return rejectChange(req, res, 400, 'Change your own password in Account settings');
    }
    if (await bcrypt.compare(password, user.password)) {
      return rejectChange(req, res, 400, 'New password must be different');
    }
    const hash = await bcrypt.hash(password, 10);
    await updatePasswordHash(user.id, hash, user.session_version, { revokeAllSessions: true, audit: req.audit });
    req.sessionStore?.emit?.('sessionsChanged');
    res.json({ success: true });
  } catch (err) {
    if (err instanceof AccountInputError) return rejectChange(req, res, 400, err.message);
    if (err.message === 'User not found') return rejectChange(req, res, 404, err.message);
    if (err.code === 'SESSION_INVALIDATED') {
      return rejectChange(req, res, 409, 'The password changed during the reset. Please try again.');
    }
    console.error('[Admin] Password reset failed', err.code || err.name);
    return rejectChange(req, res, 500, 'Failed to reset password');
  }
});

// DELETE /api/admin/users/:id — delete a user
router.delete('/users/:id', async (req, res) => {
  try {
    // Prevent self-deletion
    if (req.params.id === req.session.user.id) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    await deleteUser(req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('[Admin] DELETE /users/:id error:', err);
    const status = err.message === 'User not found' ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

// ======================== Groups / Roles ========================

// GET /api/admin/groups — list all roles
router.get('/groups', async (req, res) => {
  try {
    const roles = await getAllRoles();
    res.json({ groups: roles });
  } catch (err) {
    console.error('[Admin] GET /groups error:', err);
    res.status(500).json({ error: 'Failed to fetch groups' });
  }
});

// POST /api/admin/groups — create a new role
router.post('/groups', auditAction('group_create'), async (req, res) => {
  try {
    const { name, description } = normalizeGroupInput(req.body);
    const role = await createRole(name, description, req.audit);
    res.json({ success: true, group: role });
  } catch (err) {
    const status = groupErrorStatus(err);
    return rejectChange(req, res, status, status === 500 ? 'Failed to update group settings' : err.message);
  }
});

// PUT /api/admin/groups/:id — update a role
router.put('/groups/:id', auditAction('group_update'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) {
      return rejectChange(req, res, 400, 'Invalid group ID');
    }

    const { name, description } = normalizeGroupInput(req.body);
    const role = await updateRole(id, name, description, req.audit);
    res.json({ success: true, group: role });
  } catch (err) {
    const status = groupErrorStatus(err);
    return rejectChange(req, res, status, status === 500 ? 'Failed to update group settings' : err.message);
  }
});

// DELETE /api/admin/groups/:id — delete a role
router.delete('/groups/:id', auditAction('group_delete'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) {
      return rejectChange(req, res, 400, 'Invalid group ID');
    }

    await deleteRole(id, req.audit);
    res.json({ success: true });
  } catch (err) {
    const status = groupErrorStatus(err);
    return rejectChange(req, res, status, status === 500 ? 'Failed to update group settings' : err.message);
  }
});

// ======================== Guilds (read-only) ========================

// GET /api/admin/guilds — list all guilds
router.get('/guilds', async (req, res) => {
  try {
    const guilds = await getAllGuilds();
    res.json({ guilds });
  } catch (err) {
    console.error('[Admin] GET /guilds error:', err);
    res.status(500).json({ error: 'Failed to fetch guilds' });
  }
});

// GET /api/admin/guilds/:id — guild detail
router.get('/guilds/:id', async (req, res) => {
  try {
    const guild = await getGuildDetail(req.params.id);
    res.json({ guild });
  } catch (err) {
    console.error('[Admin] GET /guilds/:id error:', err);
    res.status(500).json({ error: 'Failed to fetch guild details' });
  }
});

// ======================== Events ========================

router.get('/events', async (_req, res, next) => {
  try { res.json({ events: await listAdminEvents() }); }
  catch (err) { next(err); }
});

router.put('/events/:id/visibility', async (req, res) => {
  try {
    const visible = normalizeEventVisibility(req.body?.visible);
    await updateEventVisibility(req.params.id, visible);
    res.json({ success: true, visible });
  } catch (err) {
    const status = err.message === 'Event not found' ? 404 : 400;
    res.status(status).json({ error: err.message });
  }
});

router.get('/stats', async (_req, res, next) => {
  try { res.json({ stats: await getGuildStats() }); }
  catch (err) { next(err); }
});

router.get('/announcements', async (_req, res, next) => {
  try { res.json({ announcements: await listAnnouncements() }); }
  catch (err) { next(err); }
});

router.get('/announcement-targets', async (_req, res, next) => {
  try { res.json({ guilds: await listAnnouncementTargets() }); }
  catch (err) { next(err); }
});

router.get('/page-visibility', async (_req, res, next) => {
  try {
    const [pages, groups, users] = await Promise.all([
      getAllPageVisibility(),
      getAllRoles(),
      getAllUsers(),
    ]);
    res.json({ pages, groups, users });
  } catch (err) {
    next(err);
  }
});

router.put('/page-visibility/:pageKey', auditAction('page_visibility'), async (req, res) => {
  try {
    const data = normalizePageVisibility(req.params.pageKey, req.body);
    await updatePageVisibility(data.page_key, data, req.audit);
    res.json({ success: true, page_key: data.page_key });
  } catch (err) {
    if (err instanceof PageVisibilityInputError) {
      return rejectChange(req, res, err.statusCode, err.message);
    }
    if (err.code === 'ER_NO_REFERENCED_ROW_2') {
      return rejectChange(req, res, 400, 'A selected group or user no longer exists');
    }
    return rejectChange(req, res, 500, 'Failed to update page visibility');
  }
});

router.post('/announcements', async (req, res) => {
  try { res.status(201).json({ announcement: await createAnnouncement(req.session.user.id, req.body || {}) }); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

router.put('/announcements/:id/review', async (req, res, next) => {
  try {
    await resolveAnnouncement(req.params.id, req.body?.decision);
    res.json({ success: true });
  } catch (error) {
    if (error instanceof InputError || error instanceof ConflictError) return res.status(error.statusCode).json({ error: error.message });
    next(error);
  }
});

router.delete('/announcements/:id', async (req, res) => {
  try { await cancelAnnouncement(req.params.id); res.json({ success: true }); }
  catch (err) { res.status(409).json({ error: err.message }); }
});

module.exports = router;
