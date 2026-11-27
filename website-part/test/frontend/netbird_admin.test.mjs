import assert from 'node:assert/strict';
import test from 'node:test';
import { NetbirdAdmin } from '../../frontend/src/components/NetbirdAdmin.jsx';
import { click, flush, mockFetch, render, setupDom, typeInto } from '../support/react.mjs';

const base = '/api/admin/netbird';
function mount(overrides = {}) {
  const dom = setupDom();
  const fetchMock = mockFetch({
    ['GET ' + base + '/status']: { configured: true },
    ['GET ' + base + '/groups']: { groups: [{ id: 'g1', name: 'Servers' }] },
    ['GET ' + base + '/peers']: { peers: [{ id: 'p1', name: 'Router', ip: '192.0.2.10', connected: true, ssh_enabled: true, login_expiration_enabled: true, inactivity_expiration_enabled: false }] },
    ['GET ' + base + '/networks']: { networks: [{ id: 'n1', name: 'Home', description: 'LAN' }, { id: 'n2', name: 'Office' }] },
    ['PUT ' + base + '/peers/p1']: { item: { id: 'p1' } },
    ['DELETE ' + base + '/peers/p1']: () => new Response(null, { status: 204 }),
    ['GET ' + base + '/networks/n1/resources']: { resources: [{ id: 'r1', name: 'NAS', address: '198.51.100.20', description: '', groups: [{ id: 'g1', name: 'Servers' }], enabled: true }] },
    ['GET ' + base + '/networks/n1/routers']: { routers: [] },
    ['GET ' + base + '/networks/n2/resources']: { resources: [] },
    ['GET ' + base + '/networks/n2/routers']: { routers: [] },
    ['PUT ' + base + '/networks/n1/resources/r1']: { item: { id: 'r1' } },
    ['POST ' + base + '/networks/n1/routers']: { item: { id: 'route1' } },
    ...overrides,
  });
  const view = render(<NetbirdAdmin />);
  return { ...dom, fetchMock, cleanup: () => { view.unmount(); fetchMock.restore(); dom.cleanup(); } };
}
const findButton = (document, text) => [...document.querySelectorAll('button')].find(button => button.textContent === text);

test('NetBird disabled state is explicit and never requests peers or groups', async () => {
  const f = mount({ ['GET ' + base + '/status']: { configured: false } });
  try {
    await flush();
    assert.match(f.document.body.textContent, /not configured/);
    assert.equal(f.fetchMock.callsTo('GET', base + '/groups').length, 0);
    assert.equal(f.fetchMock.callsTo('GET', base + '/peers').length, 0);
  } finally { f.cleanup(); }
});

test('peer editing preserves security switches and deletion requires confirmation', async () => {
  const f = mount();
  try {
    await flush();
    click(f.document.querySelector('[data-netbird="peers"] [data-action="edit"]'));
    typeInto(f.document.getElementById('nb-name'), 'New router');
    click(findButton(f.document, 'Save'));
    await flush();
    assert.deepEqual(f.fetchMock.callsTo('PUT', base + '/peers/p1')[0].body, {
      name: 'New router', ssh_enabled: true, login_expiration_enabled: true, inactivity_expiration_enabled: false,
    });
    click(f.document.querySelector('[data-netbird="peers"] [data-action="delete"]'));
    assert.equal(f.fetchMock.callsTo('DELETE', base + '/peers/p1').length, 0);
    const dialog = f.document.querySelector('[role="dialog"]');
    click(findButton(dialog, 'Cancel'));
    assert.equal(f.fetchMock.callsTo('DELETE', base + '/peers/p1').length, 0);
    click(f.document.querySelector('[data-netbird="peers"] [data-action="delete"]'));
    click(findButton(dialog, 'Delete'));
    await flush();
    assert.equal(f.fetchMock.callsTo('DELETE', base + '/peers/p1').length, 1);
  } finally { f.cleanup(); }
});

test('network resource editing uses the selected network and retains group IDs', async () => {
  const f = mount();
  try {
    await flush(); click(findButton(f.document, 'Manage network')); await flush();
    click(f.document.querySelector('[data-netbird="resources"] [data-action="edit"]'));
    typeInto(f.document.getElementById('nb-address'), '198.51.100.0/24');
    click(findButton(f.document, 'Save')); await flush();
    assert.deepEqual(f.fetchMock.callsTo('PUT', base + '/networks/n1/resources/r1')[0].body, {
      name: 'NAS', description: '', address: '198.51.100.0/24', groups: ['g1'], enabled: true,
    });
    click(findButton(f.document, 'Back to networks')); await flush();
    click([...f.document.querySelectorAll('button')].filter(button => button.textContent === 'Manage network')[1]); await flush();
    assert.equal(f.document.querySelector('[data-netbird="resources"] tbody'), null);
    assert.match(f.document.body.textContent, /Office/);
  } finally { f.cleanup(); }
});

test('failed NetBird writes retain the editor and expose a retryable error', async () => {
  const f = mount({ ['PUT ' + base + '/peers/p1']: { status: 503, payload: { error: 'NetBird rate limit reached. Please try again later.' } } });
  try {
    await flush(); click(f.document.querySelector('[data-netbird="peers"] [data-action="edit"]'));
    typeInto(f.document.getElementById('nb-name'), 'Keep this edit');
    click(findButton(f.document, 'Save')); await flush();
    assert.equal(f.document.getElementById('nb-name').value, 'Keep this edit');
    assert.match(f.document.querySelector('[role="alert"]').textContent, /rate limit/);
    assert.equal(findButton(f.document, 'Save').disabled, false);
  } finally { f.cleanup(); }
});

test('new routing assignments submit one peer selector and preserve routing controls', async () => {
  const { selectOption, toggle } = await import('../support/react.mjs');
  const f = mount();
  try {
    await flush(); click(findButton(f.document, 'Manage network')); await flush();
    click(f.document.querySelector('[data-netbird="routers"] button'));
    selectOption(f.document.getElementById('nb-peer'), 'p1');
    typeInto(f.document.getElementById('nb-metric'), '25');
    click(findButton(f.document, 'Save')); await flush();
    assert.deepEqual(f.fetchMock.callsTo('POST', base + '/networks/n1/routers')[0].body, {
      peer: 'p1', metric: 25, masquerade: true, enabled: true,
    });
    click(f.document.querySelector('[data-netbird="routers"] button'));
    selectOption(f.document.getElementById('nb-mode'), 'groups');
    toggle(f.document.querySelector('form fieldset.form-group input[type="checkbox"]'));
    click(findButton(f.document, 'Save')); await flush();
    assert.deepEqual(f.fetchMock.callsTo('POST', base + '/networks/n1/routers')[1].body, {
      peer_groups: ['g1'], metric: 100, masquerade: true, enabled: true,
    });
  } finally { f.cleanup(); }
});

test('late results from a previous network cannot replace the active network', async () => {
  let finish;
  const f = mount({ ['GET ' + base + '/networks/n1/resources']: () => new Promise(resolve => { finish = resolve; }) });
  try {
    await flush(); click(findButton(f.document, 'Manage network')); await flush();
    click(findButton(f.document, 'Back to networks')); await flush();
    click([...f.document.querySelectorAll('button')].filter(button => button.textContent === 'Manage network')[1]); await flush();
    finish({ resources: [{ id: 'old', name: 'Wrong network resource' }] }); await flush();
    assert.equal(f.document.body.textContent.includes('Wrong network resource'), false);
    assert.match(f.document.body.textContent, /Office/);
  } finally { f.cleanup(); }
});
