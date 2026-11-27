import assert from 'node:assert/strict';
import test from 'node:test';

import { AdminPage } from '../../frontend/src/pages/AdminPage.jsx';
import { click, flush, mockFetch, render, setupDom, stubLocation, toggle, typeInto } from '../support/react.mjs';

const USERS = [
  { id: 1, username: 'alice', roles: [{ id: 1, name: 'admin' }], created_at: '2026-01-02T03:04:05.000Z' },
  { id: 2, username: 'bob', roles: [{ id: 2, name: 'user' }], created_at: '2026-02-03T04:05:06.000Z' },
];

const GROUPS = [
  { id: 1, name: 'admin', description: 'Administrators', user_count: 1 },
  { id: 2, name: 'user', description: 'Regular users', user_count: 1 },
];

function routes(overrides = {}) {
  return {
    'GET /api/auth/me': { payload: { loggedIn: true, user: USERS[0] } },
    'GET /api/admin/users': { payload: { users: USERS } },
    'GET /api/admin/groups': { payload: { groups: GROUPS } },
    'GET /api/admin/guilds': { payload: { guilds: [] } },
    'GET /api/admin/connections': { payload: { connections: [] } },
    'GET /api/admin/page-visibility': {
      payload: {
        pages: [{
          key: 'roller',
          name: 'Roller',
          path: '/roller.html',
          public_access: true,
          authenticated_access: true,
          role_ids: [2],
          user_ids: ['bob'],
          roles: [{ id: 2, name: 'user' }],
          users: [{ id: 'bob', username: 'bob' }],
        }],
        groups: GROUPS,
        users: USERS,
      },
    },
    'GET /api/admin/events': { payload: { events: [] } },
    'GET /api/admin/stats': { payload: { stats: [] } },
    'GET /api/admin/announcements': { payload: { announcements: [] } },
    'GET /api/admin/announcement-targets': { payload: { guilds: [] } },
    'PUT /api/admin/users/2': { payload: { success: true } },
    'DELETE /api/admin/users/2': { payload: { success: true } },
    'PUT /api/admin/page-visibility/roller': { payload: { success: true } },
    ...overrides,
  };
}

function mount(overrides) {
  const dom = setupDom('<div id="root"></div>', { location: stubLocation() });
  const fetchMock = mockFetch(routes(overrides));
  const view = render(<AdminPage />);
  return {
    dom,
    document: dom.document,
    fetchMock,
    view,
    async teardown() {
      view.unmount();
      fetchMock.restore();
      dom.cleanup();
    },
  };
}

test('the users table renders group badges and updates a user through the modal', async () => {
  const { document, fetchMock, teardown } = mount();
  try {
    await flush();

    const rows = [...document.querySelectorAll('#usersTableBody tr')];
    assert.equal(rows.length, 2);
    assert.equal(rows[0].querySelector('strong').textContent, 'alice');
    assert.equal(rows[0].querySelector('.badge').className.includes('badge-admin'), true);
    assert.equal(rows[1].querySelector('.badge').className.includes('badge-user'), true);

    const editButton = rows[1].querySelector('[data-action="edit-user"]');
    click(editButton);
    await flush();

    const modal = document.querySelector('#editUserRoles');
    assert.ok(modal);
    assert.equal(document.getElementById('editUserUsername').value, 'bob');

    // Move bob into the admin group as well and save.
    const adminCheckbox = document.querySelector('input[name="userGroup"][value="1"]');
    toggle(adminCheckbox);
    click(document.getElementById('saveUserGroupsBtn'));
    await flush();

    const updates = fetchMock.callsTo('PUT', '/api/admin/users/2');
    assert.equal(updates.length, 1);
    assert.deepEqual(updates[0].body, { role_ids: [2, 1] });
  } finally {
    await teardown();
  }
});

test('an admin resets a member password from their row and uses account settings for their own', async () => {
  const endpoint = '/api/admin/users/2/password';
  const { document, fetchMock, teardown } = mount({ ['PUT ' + endpoint]: { payload: { success: true } } });
  try {
    await flush();
    const rows = document.querySelectorAll('#usersTableBody tr');
    assert.ok(rows[0].querySelector('a[href="/account.html#passwordForm"]'));
    click(rows[1].querySelector('[data-action="reset-password"]'));
    const dialog = document.getElementById('resetPasswordTitle').closest('[role="dialog"]');
    assert.match(dialog.textContent, /bob/);
    const password = dialog.querySelector('[name="newPassword"]');
    const confirm = dialog.querySelector('[name="confirmPassword"]');
    const submit = dialog.querySelector('[type="submit"]');
    typeInto(password, 'A website password');
    typeInto(confirm, 'Another password');
    click(submit);
    assert.match(dialog.querySelector('[role="alert"]').textContent, /do not match/);
    assert.equal(fetchMock.callsTo('PUT', endpoint).length, 0);
    typeInto(confirm, password.value);
    click(submit);
    await flush();
    assert.deepEqual(fetchMock.callsTo('PUT', endpoint).map(call => call.body), [
      { newPassword: 'A website password', confirmPassword: 'A website password' },
    ]);
    assert.equal(dialog.isConnected, false);
    assert.match(document.querySelector('.toast-success').textContent, /bob/);
    click(rows[1].querySelector('[data-action="reset-password"]'));
    assert.equal(document.getElementById('adminNewPassword').value, '');
  } finally { await teardown(); }
});

test('a failing users request renders an error row instead of stale data', async () => {
  const { document, teardown } = mount({
    'GET /api/admin/users': { status: 500, payload: { error: 'database offline' } },
  });
  try {
    await flush();

    const cell = document.querySelector('#usersTableBody td');
    assert.equal(cell.classList.contains('empty-state'), true);
    assert.equal(cell.querySelector('.status-error')?.textContent, 'Failed to load users');
  } finally {
    await teardown();
  }
});

test('page visibility loads lazily and saves the edited audience', async () => {
  const { document, fetchMock, teardown } = mount();
  try {
    await flush();
    assert.equal(fetchMock.callsTo('GET', '/api/admin/page-visibility').length, 0);

    click(document.querySelector('[data-tab], #page-visibility-tab') || document.getElementById('page-visibility-tab'));
    await flush();

    assert.equal(fetchMock.callsTo('GET', '/api/admin/page-visibility').length, 1);
    const row = document.querySelector('#pageVisibilityTableBody tr');
    assert.equal(row.querySelector('strong').textContent, 'Roller');

    click(row.querySelector('[data-action="edit-page-visibility"]'));
    await flush();

    assert.equal(document.getElementById('pageVisibilityPath').textContent, '/roller.html');
    assert.equal(document.getElementById('editPageVisibilityPublic').checked, true);

    click(document.getElementById('editPageVisibilityPublic'));
    toggle(document.querySelector('input[name="pageVisibilityUser"][value="1"]'));
    click(document.getElementById('savePageVisibilityBtn'));
    await flush();

    const updates = fetchMock.callsTo('PUT', '/api/admin/page-visibility/roller');
    assert.equal(updates.length, 1);
    assert.deepEqual(updates[0].body, {
      public_access: false,
      authenticated_access: true,
      role_ids: [2],
      user_ids: ['bob', '1'],
    });
  } finally {
    await teardown();
  }
});

test('deleting a user runs through the confirmation dialog once', async () => {
  const { document, fetchMock, teardown } = mount();
  try {
    await flush();

    click(document.querySelector('[data-action="delete-user"][data-id="2"]'));
    await flush();

    const confirmDialog = document.getElementById('confirmTitle');
    assert.equal(confirmDialog.textContent, 'Delete User');
    assert.match(document.getElementById('confirmMsg').textContent, /bob/);

    click(document.getElementById('confirmOkBtn'));
    await flush();

    assert.equal(fetchMock.callsTo('DELETE', '/api/admin/users/2').length, 1);
    assert.equal(document.querySelector('#confirmTitle').closest('[role="dialog"]').hidden, true);
  } finally {
    await teardown();
  }
});

test('group creation validates the name before sending a request', async () => {
  const { document, fetchMock, teardown } = mount({
    'POST /api/admin/groups': { payload: { success: true } },
  });
  try {
    await flush();

    click(document.getElementById('createGroupBtn'));
    click(document.getElementById('saveGroupBtn'));
    await flush();

    assert.equal(document.getElementById('groupEditError').textContent, 'Name is required');
    assert.equal(fetchMock.callsTo('POST', '/api/admin/groups').length, 0);

    typeInto(document.getElementById('editGroupName'), 'moderator');
    click(document.getElementById('saveGroupBtn'));
    await flush();

    const created = fetchMock.callsTo('POST', '/api/admin/groups');
    assert.equal(created.length, 1);
    assert.deepEqual(created[0].body, { name: 'moderator', description: '' });
  } finally {
    await teardown();
  }
});

const EDITORS = [
  {
    name: 'user groups', url: 'PUT /api/admin/users/2', title: 'userEditModalTitle', save: 'saveUserGroupsBtn',
    open: async document => { click(document.querySelector('[data-action="edit-user"][data-id="2"]')); await flush(); },
  },
  {
    name: 'groups', url: 'POST /api/admin/groups', title: 'groupModalTitle', save: 'saveGroupBtn',
    open: async document => { click(document.getElementById('createGroupBtn')); typeInto(document.getElementById('editGroupName'), 'team'); },
  },
  {
    name: 'websites', url: 'PUT /api/admin/connections/7', title: 'connectionModalTitle', save: 'saveConnectionBtn',
    routes: { 'GET /api/admin/connections': { payload: { connections: [{ id: 7, name: 'Site', slug: 'site', target_url: 'https://example.com/', roles: [{ id: 2 }], users: [] }] } } },
    open: async document => {
      click(document.getElementById('connections-tab')); await flush();
      click(document.querySelector('[data-action="edit-connection"]')); await flush();
    },
  },
  {
    name: 'page visibility', url: 'PUT /api/admin/page-visibility/roller', title: 'pageVisibilityModalTitle', save: 'savePageVisibilityBtn',
    open: async document => {
      click(document.getElementById('page-visibility-tab')); await flush();
      click(document.querySelector('[data-action="edit-page-visibility"]')); await flush();
    },
  },
];

for (const editor of EDITORS) {
  test(`a late ${editor.name} save error cannot reopen a cancelled editor`, async () => {
    let complete;
    const pending = new Promise(resolve => { complete = resolve; });
    const f = mount({ ...editor.routes, [editor.url]: () => pending });
    try {
      await flush(); await editor.open(f.document);
      click(f.document.getElementById(editor.save)); await flush();
      const modal = f.document.getElementById(editor.title).closest('[role="dialog"]');
      click(modal.querySelector('[data-dialog-close]')); await flush();
      assert.equal(modal.hidden, true);
      complete({ status: 500, payload: { error: 'database offline' } }); await flush();
      assert.equal(modal.hidden, true);
      assert.ok(f.document.getElementById('usersTableBody'));
      assert.equal(f.document.querySelector('.error-boundary'), null);
      assert.equal(modal.textContent.includes('database offline'), false);
    } finally { await f.teardown(); }
  });
}

test('an old response cannot change a newly opened editor for the same user', async () => {
  let complete;
  const pending = new Promise(resolve => { complete = resolve; });
  const f = mount({ 'PUT /api/admin/users/2': () => pending });
  try {
    await flush(); await EDITORS[0].open(f.document);
    click(f.document.getElementById('saveUserGroupsBtn')); await flush();
    const modal = f.document.getElementById('userEditModalTitle').closest('[role="dialog"]');
    click(modal.querySelector('[data-dialog-close]')); await flush();
    await EDITORS[0].open(f.document);
    toggle(f.document.querySelector('input[name="userGroup"][value="1"]'));
    complete({ status: 500, payload: { error: 'old request failed' } }); await flush();
    assert.equal(modal.hidden, false);
    assert.equal(f.document.querySelector('input[name="userGroup"][value="1"]').checked, true);
    assert.equal(f.document.getElementById('userEditError').textContent, '');
  } finally { await f.teardown(); }
});

test('a completed save does not close a replacement group draft', async () => {
  let complete;
  const pending = new Promise(resolve => { complete = resolve; });
  const f = mount({ 'POST /api/admin/groups': () => pending });
  try {
    await flush(); await EDITORS[1].open(f.document);
    click(f.document.getElementById('saveGroupBtn')); await flush();
    const modal = f.document.getElementById('groupModalTitle').closest('[role="dialog"]');
    click(modal.querySelector('[data-dialog-close]')); await flush();
    click(f.document.getElementById('createGroupBtn'));
    typeInto(f.document.getElementById('editGroupName'), 'new draft');
    complete({ payload: { success: true } }); await flush();
    assert.equal(modal.hidden, false);
    assert.equal(f.document.getElementById('editGroupName').value, 'new draft');
  } finally { await f.teardown(); }
});
