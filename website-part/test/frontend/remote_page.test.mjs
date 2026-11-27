import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';

import { RemotePage, sshEndpoint } from '../../frontend/src/pages/RemotePage.jsx';
import { click, flush, mockFetch, render, selectOption, setupDom, typeInto } from '../support/react.mjs';

function mount(routes) {
  const dom = setupDom('<div id="root"></div>', { url: 'https://example.test/remote.html' });
  const fetchMock = mockFetch({
    'GET /api/remote-profile': {
      payload: {
        serverStorageAvailable: true,
        profile: { ssh: null, rdp: { host: 'legacy.example.com', port: '3389', username: 'alice' } },
        features: { ssh: true, rdp: true },
      },
    },
    'GET /api/rdp/profiles': { payload: { available: true, profiles: [{ id: 'one', name: 'Home' }] } },
    'POST /api/rdp/profiles': { payload: { id: 'two' } },
    ...routes,
  });
  const view = render(<RemotePage socketFactory={() => ({ on() {}, once() {}, emit() {}, connect() {}, disconnect() {}, removeAllListeners() {}, connected: false })} />);
  return {
    dom,
    window: dom.window,
    document: dom.document,
    fetchMock,
    async teardown() {
      view.unmount();
      fetchMock.restore();
      dom.cleanup();
    },
  };
}

test('the remote page renders the WebRDP workspace and SSH terminal', async () => {
  const { document, teardown } = mount();
  try {
    await flush();

    const canvas = document.getElementById('rdpCanvas');
    assert.equal(canvas.tabIndex, 0);
    assert.ok(document.getElementById('rdpForm'));
    assert.ok(document.getElementById('sshForm'));
    assert.equal(document.getElementById('rdpPassword').getAttribute('autocomplete'), 'current-password');
    assert.equal(document.getElementById('rdpViewport').tabIndex, 0);
    assert.equal(document.getElementById('rdpPanel').hidden, false);
    assert.equal(document.getElementById('sshPanel').hidden, false);
    assert.equal(document.getElementById('rdpDisconnect').disabled, true);
    assert.equal(document.getElementById('sshDisconnect').disabled, true);
  } finally {
    await teardown();
  }
});

test('stored RDP profiles load into the connect form', async () => {
  const { document, window: windowRef, fetchMock, teardown } = mount({
    'GET /api/rdp/profiles/one': { payload: { profile: { id: 'one', name: 'Home', host: '192.168.0.10', port: '3389', username: 'alice', password: 'secret' } } },
  });

  try {
    await flush();

    const list = document.getElementById('rdpProfileList');
    assert.equal(list.disabled, false);
    assert.deepEqual([...list.options].map(option => option.textContent), ['新增連線設定', 'Home']);
    assert.match(document.getElementById('rdpProfileStatus').textContent, /舊版 RDP 設定|舊設定/);

    selectOption(list, 'one');
    await flush();

    assert.equal(document.getElementById('rdpHost').value, '192.168.0.10');
    assert.equal(document.getElementById('rdpPassword').value, 'secret');
    assert.match(document.getElementById('rdpProfileStatus').textContent, /已載入設定與密碼/);
    assert.equal(fetchMock.callsTo('GET', '/api/rdp/profiles/one').length, 1);
  } finally {
    await teardown();
  }
});

test('a server without credential encryption explains the missing setup', async () => {
  const { document, teardown } = mount({
    'GET /api/rdp/profiles': { payload: { available: false, profiles: [] } },
  });

  try {
    await flush();

    assert.equal(document.getElementById('saveRdp').disabled, true);
    assert.equal(document.getElementById('rdpProfileList').disabled, true);
    assert.match(document.getElementById('rdpProfileStatus').textContent, /REMOTE_CREDENTIAL_ENCRYPTION_KEY/);
  } finally {
    await teardown();
  }
});

test('missing remote features hide the RDP and SSH panels', async () => {
  const { document, teardown } = mount({
    'GET /api/remote-profile': {
      payload: { serverStorageAvailable: false, features: { ssh: false, rdp: false }, profile: null },
    },
  });

  try {
    await flush();

    assert.equal(document.getElementById('sshPanel').hidden, true);
    assert.equal(document.getElementById('rdpPanel').hidden, true);
    assert.equal(document.getElementById('rdpConnectPanel').hidden, true);
    assert.equal(document.getElementById('sshStorage').querySelector('option[value="server"]').disabled, true);
  } finally {
    await teardown();
  }
});

test('ssh connections target the same-origin websocket', () => {
  assert.equal(sshEndpoint({ protocol: 'https:', host: 'example.test' }), 'wss://example.test/api/ssh');
  assert.equal(sshEndpoint({ protocol: 'http:', host: 'localhost:3000' }), 'ws://localhost:3000/api/ssh');
});

test('a pending RDP selection keeps its credentials and save target atomic', async () => {
  let resolveProfile;
  const pending = new Promise(resolve => { resolveProfile = resolve; });
  const f = mount({
    'GET /api/rdp/profiles': { payload: { available: true, profiles: [{ id: 'one', name: 'Home' }, { id: 'two', name: 'Work' }] } },
    'GET /api/rdp/profiles/one': () => pending,
    'GET /api/rdp/profiles/two': { payload: { profile: { name: 'Work', host: 'work.example.com', username: 'bob', password: 'work-secret' } } },
    'PUT /api/rdp/profiles/one': { payload: { success: true } },
  });
  try {
    await flush();
    const list = f.document.getElementById('rdpProfileList');
    selectOption(list, 'one');
    await flush();
    assert.equal(list.disabled, true);
    assert.equal(f.document.getElementById('saveRdp').disabled, true);
    selectOption(list, 'two'); // Even a dispatched change cannot bypass the busy guard.
    resolveProfile({ payload: { profile: { name: 'Home', host: 'home.example.com', username: 'alice', password: 'home-secret' } } });
    await flush();
    assert.equal(list.value, 'one');
    assert.equal(f.document.getElementById('rdpHost').value, 'home.example.com');
    click(f.document.getElementById('saveRdp'));
    await flush();
    assert.equal(f.fetchMock.callsTo('GET', '/api/rdp/profiles/two').length, 0);
    assert.equal(f.fetchMock.callsTo('PUT', '/api/rdp/profiles/two').length, 0);
    assert.equal(f.fetchMock.callsTo('PUT', '/api/rdp/profiles/one')[0].body.password, 'home-secret');
  } finally { await f.teardown(); }
});

test('a failed RDP load preserves the previously loaded selection and credentials', async () => {
  const f = mount({
    'GET /api/rdp/profiles': { payload: { available: true, profiles: [{ id: 'one', name: 'Home' }, { id: 'two', name: 'Work' }] } },
    'GET /api/rdp/profiles/one': { payload: { profile: { name: 'Home', host: 'home.example.com', username: 'alice', password: 'home-secret' } } },
    'GET /api/rdp/profiles/two': { status: 500, payload: { error: 'Profile unavailable' } },
  });
  try {
    await flush();
    const list = f.document.getElementById('rdpProfileList');
    selectOption(list, 'one'); await flush();
    selectOption(list, 'two'); await flush();
    assert.equal(list.value, 'one');
    assert.equal(f.document.getElementById('rdpPassword').value, 'home-secret');
    assert.match(f.document.getElementById('rdpProfileStatus').textContent, /Profile unavailable/);
  } finally { await f.teardown(); }
});

class SshSocket {
  static instances = [];
  constructor() {
    this.listeners = new Map(); this.sent = []; this.closeCalls = 0; this.readyState = 0;
    SshSocket.instances.push(this);
  }
  addEventListener(name, handler) {
    if (!this.listeners.has(name)) this.listeners.set(name, []);
    this.listeners.get(name).push(handler);
  }
  send(value) { this.sent.push(JSON.parse(value)); }
  close() { this.closeCalls += 1; this.readyState = 3; }
  receive(name, message) {
    act(() => {
      for (const handler of this.listeners.get(name) || []) handler(message);
    });
  }
}

const submitSsh = f => act(() => f.document.getElementById('sshForm').dispatchEvent(new f.window.Event('submit', { bubbles: true, cancelable: true })));

test('server SSH settings restore their host, key and authentication mode', async () => {
  const f = mount({
    'GET /api/remote-profile': { payload: { serverStorageAvailable: true, features: { ssh: true, rdp: true }, profile: { ssh: { host: 'ssh.example.com', port: 2222, username: 'alice', privateKey: 'stored-key' }, rdp: null } } },
  });
  try {
    await flush();
    assert.equal(f.document.getElementById('sshHost').value, 'ssh.example.com');
    assert.equal(f.document.getElementById('sshPort').value, '2222');
    assert.equal(f.document.getElementById('sshKey').value, 'stored-key');
    assert.equal(f.document.getElementById('sshAuthType').value, 'key');
    assert.equal(f.document.getElementById('sshStorage').value, 'server');
    assert.equal(f.document.getElementById('sshPassword').value, '');
  } finally { await f.teardown(); }
});

test('SSH sends only credentials for the selected authentication method', async () => {
  const original = globalThis.WebSocket;
  globalThis.WebSocket = SshSocket; SshSocket.instances = [];
  const f = mount();
  try {
    await flush();
    typeInto(f.document.getElementById('sshHost'), 'ssh.example.com');
    typeInto(f.document.getElementById('sshUsername'), 'alice');
    typeInto(f.document.getElementById('sshPassword'), 'password-secret');
    selectOption(f.document.getElementById('sshAuthType'), 'key');
    typeInto(f.document.getElementById('sshKey'), 'key-secret');
    selectOption(f.document.getElementById('sshAuthType'), 'password');
    submitSsh(f);
    SshSocket.instances[0].receive('open');
    assert.equal(SshSocket.instances[0].sent[0].password, 'password-secret');
    assert.equal('privateKey' in SshSocket.instances[0].sent[0], false);
    selectOption(f.document.getElementById('sshAuthType'), 'key');
    submitSsh(f);
    SshSocket.instances[1].receive('open');
    assert.equal(SshSocket.instances[1].sent[0].privateKey, 'key-secret');
    assert.equal('password' in SshSocket.instances[1].sent[0], false);
  } finally { await f.teardown(); globalThis.WebSocket = original; }
});

test('late SSH events from a replaced socket cannot close or alter its replacement', async () => {
  const original = globalThis.WebSocket;
  globalThis.WebSocket = SshSocket; SshSocket.instances = [];
  const f = mount();
  try {
    await flush();
    typeInto(f.document.getElementById('sshHost'), 'ssh.example.com');
    typeInto(f.document.getElementById('sshUsername'), 'alice');
    typeInto(f.document.getElementById('sshPassword'), 'password-secret');
    submitSsh(f); submitSsh(f);
    const [previous, current] = SshSocket.instances;
    previous.receive('open');
    previous.receive('message', { data: JSON.stringify({ type: 'connected' }) });
    assert.equal(previous.sent.length, 0);
    assert.equal(f.document.getElementById('sshInput').disabled, true);
    current.receive('open');
    current.receive('message', { data: JSON.stringify({ type: 'connected' }) });
    previous.receive('message', { data: JSON.stringify({ type: 'closed' }) });
    previous.receive('error'); previous.receive('close');
    assert.equal(current.closeCalls, 0);
    assert.equal(f.document.getElementById('sshInput').disabled, false);
    assert.equal(f.document.getElementById('sshStatus').textContent, '已連線');
    click(f.document.getElementById('sshDisconnect'));
    assert.equal(current.closeCalls, 1);
    assert.equal(f.document.getElementById('sshInput').disabled, true);
  } finally { await f.teardown(); globalThis.WebSocket = original; }
});
