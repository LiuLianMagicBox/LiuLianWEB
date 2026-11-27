import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';

import { canvasPoint, ChromiumSession, normalizeUrl, websocketUrl } from '../../frontend/src/lib/chromiumSession.mjs';
import { ChromiumPage } from '../../frontend/src/pages/ChromiumPage.jsx';
import { click, flush, render, setupDom, typeInto } from '../support/react.mjs';

class FakeWebSocket {
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    FakeWebSocket.instances.push(this);
  }

  send(value) {
    this.sent.push(JSON.parse(value));
  }

  open() {
    this.readyState = 1;
    this.onopen?.();
  }

  message(value) {
    this.onmessage?.({ data: JSON.stringify(value) });
  }

  close() {
    this.readyState = 3;
    this.onclose?.();
  }
}

class FakeImage {
  static instances = [];

  constructor() {
    FakeImage.instances.push(this);
    this.width = 800;
    this.height = 600;
  }

  set src(value) {
    this._src = value;
    this.onload?.();
  }

  get src() {
    return this._src;
  }
}

function canvasFixture() {
  const drawn = [];
  const context = {
    clearRect: (...args) => drawn.push(['clear', ...args]),
    drawImage: (...args) => drawn.push(['draw', ...args]),
  };
  const canvas = { width: 1280, height: 720, getContext: () => context };
  return { canvas, drawn };
}

function sessionFactory(overrides = {}) {
  FakeWebSocket.instances = [];
  FakeImage.instances = [];
  const { canvas, drawn } = canvasFixture();
  const states = [];
  const session = new ChromiumSession(canvas, {
    WebSocketImpl: FakeWebSocket,
    ImageImpl: FakeImage,
    locationRef: { protocol: 'https:', host: 'portal.example.org' },
    onState: state => states.push(state),
    ...overrides,
  });
  return { session, canvas, drawn, states };
}

test('normalizes only http and https URLs', () => {
  assert.equal(normalizeUrl(' https://example.com/path '), 'https://example.com/path');
  assert.throws(() => normalizeUrl('javascript:alert(1)'), /只支援/);
  assert.throws(() => normalizeUrl(''), /請輸入網址/);
  assert.equal(websocketUrl({ protocol: 'http:', host: 'example.test' }), 'ws://example.test/api/chromium/ws');
  assert.equal(websocketUrl({ protocol: 'https:', host: 'example.test' }), 'wss://example.test/api/chromium/ws');
});

test('opens a CDP screencast socket, draws frames and resolves on ready', async () => {
  const { session, canvas, drawn, states } = sessionFactory();

  const opened = session.open('https://example.com/', { size: { width: 1280, height: 720 } });
  const socket = FakeWebSocket.instances[0];
  assert.equal(socket.url, 'wss://portal.example.org/api/chromium/ws');
  socket.open();
  assert.deepEqual(socket.sent[0], {
    type: 'open',
    url: 'https://example.com/',
    size: { width: 1280, height: 720 },
  });

  socket.message({ type: 'status', status: 'opening' });
  socket.message({ type: 'frame', data: 'ZmFrZQ==', metadata: { deviceWidth: 1024, deviceHeight: 768 } });
  assert.equal(canvas.width, 1024);
  assert.equal(canvas.height, 768);
  assert.equal(drawn.some(entry => entry[0] === 'draw'), true);

  socket.message({ type: 'ready', url: 'https://example.com/' });
  assert.equal(await opened, 'https://example.com/');
  assert.deepEqual(states.at(-1), { state: 'ready', message: 'Chromium 已連線。' });
});

test('socket errors reject the open call and report an error state', async () => {
  const { session, states } = sessionFactory();

  const opened = session.open('https://example.com/');
  const socket = FakeWebSocket.instances[0];
  socket.onerror?.();

  await assert.rejects(opened, /無法連線/);
  assert.deepEqual(states.at(-1), { state: 'error', message: '無法連線到伺服器 Chromium。' });
});

test('destroy closes the socket, clears the canvas and ignores late frames', async () => {
  const { session, canvas, drawn } = sessionFactory();

  const opened = session.open('https://example.com/');
  opened.catch(() => {});
  const socket = FakeWebSocket.instances[0];
  socket.open();
  session.destroy();

  assert.equal(socket.readyState, 3);
  assert.equal(drawn.at(-1)[0], 'clear');
  const drawsBefore = drawn.length;
  socket.message({ type: 'frame', data: 'ZmFrZQ==', metadata: { deviceWidth: 10, deviceHeight: 10 } });
  assert.equal(drawn.length, drawsBefore, 'late frames from a destroyed session are ignored');
  assert.equal(canvas.width, 1280, 'a late ready message never resizes the canvas');
});

test('without WebSocket support the session reports an immediate error', async () => {
  const { session } = sessionFactory({ WebSocketImpl: null });
  await assert.rejects(session.open('https://example.com/'), /WebSocket/);
});

test('replacement cancels the previous open and ignores its late socket callbacks', async () => {
  const { session, states } = sessionFactory();
  const first = session.open('https://first.example/');
  const cancelled = assert.rejects(first, { name: 'AbortError' });
  const previous = FakeWebSocket.instances[0];
  const second = session.open('https://second.example/');
  const current = FakeWebSocket.instances[1];
  current.open(); current.message({ type: 'ready' });
  assert.equal(await second, 'https://second.example/');
  await cancelled;
  const stateCount = states.length;
  previous.open(); previous.onerror?.(); previous.close(); previous.message({ type: 'ready' });
  assert.equal(previous.sent.length, 0);
  assert.equal(states.length, stateCount);
  assert.equal(states.at(-1).state, 'ready');
  assert.equal(session.socket, current);
  session.destroy();
});

test('destroy and premature server close settle pending open promises', async () => {
  const { session } = sessionFactory();
  const first = session.open('https://first.example/');
  const cancelled = assert.rejects(first, { name: 'AbortError' });
  session.destroy(); session.destroy();
  await cancelled;
  const second = session.open('https://second.example/');
  const disconnected = assert.rejects(second, /工作階段已結束/);
  FakeWebSocket.instances[1].close();
  await disconnected;
  assert.equal(session.pendingOpen, null);
  assert.equal(session.socket, null);
});

test('decoded frames cannot rewind newer frames or repaint after destroy or replacement', async () => {
  class DelayedImage {
    static instances = [];
    constructor() { DelayedImage.instances.push(this); this.width = 100; this.height = 100; }
    set src(value) { this._src = value; }
    finish() { this.onload?.(); }
  }
  const { session, canvas, drawn } = sessionFactory({ ImageImpl: DelayedImage });
  const opening = session.open('https://first.example/');
  const socket = FakeWebSocket.instances[0]; socket.open(); socket.message({ type: 'ready' }); await opening;
  socket.message({ type: 'frame', data: 'older', metadata: { deviceWidth: 100, deviceHeight: 100 } });
  socket.message({ type: 'frame', data: 'newer', metadata: { deviceWidth: 200, deviceHeight: 200 } });
  DelayedImage.instances[1].finish(); DelayedImage.instances[0].finish();
  assert.equal(drawn.filter(entry => entry[0] === 'draw').length, 1);
  assert.equal(canvas.width, 200);
  socket.message({ type: 'frame', data: 'queued' });
  session.destroy();
  const countAfterClear = drawn.length;
  DelayedImage.instances[2].finish();
  assert.equal(drawn.length, countAfterClear);
  const replacement = session.open('https://second.example/');
  FakeWebSocket.instances[1].open(); FakeWebSocket.instances[1].message({ type: 'ready' }); await replacement;
  DelayedImage.instances[2].finish();
  assert.equal(drawn.filter(entry => entry[0] === 'draw').length, 1);
  session.destroy();
});

test('ending or replacing a pending Chromium page open keeps cancellation out of the visible status', async () => {
  const dom = setupDom('<div id="root"></div>');
  const original = globalThis.WebSocket;
  globalThis.WebSocket = FakeWebSocket; FakeWebSocket.instances = [];
  const view = render(<ChromiumPage />);
  try {
    const canvas = dom.document.getElementById('chromiumFrame');
    canvas.getContext = () => ({ clearRect() {} });
    click(dom.document.querySelector('[data-chromium-url]'));
    const previous = FakeWebSocket.instances[0];
    click(dom.document.querySelectorAll('[data-chromium-url]')[1]);
    const current = FakeWebSocket.instances[1];
    act(() => { current.open(); current.message({ type: 'ready' }); }); await flush();
    act(() => { previous.onerror?.(); }); await flush();
    assert.match(dom.document.getElementById('chromiumStatus').textContent, /已連線/);
    assert.equal(dom.document.getElementById('chromiumAddress').value, 'https://github.com/');
    click(dom.document.querySelector('[data-chromium-url]'));
    click(dom.document.getElementById('chromiumHomeButton')); await flush();
    assert.equal(dom.document.getElementById('chromiumHome').hidden, false);
    assert.equal(dom.document.getElementById('chromiumStatus').textContent, 'Chromium 已就緒。');
  } finally { view.unmount(); globalThis.WebSocket = original; dom.cleanup(); }
});

test('the Chromium page renders the address bar, canvas and quick links', async () => {
  const dom = setupDom('<div id="root"></div>', { url: 'https://portal.example.org/chromium.html' });
  const originalWebSocket = globalThis.WebSocket;
  globalThis.WebSocket = FakeWebSocket;
  FakeWebSocket.instances = [];

  try {
    render(<ChromiumPage />);
    const canvas = dom.document.getElementById('chromiumFrame');
    canvas.getContext = () => ({ clearRect() {}, drawImage() {} });
    assert.equal(canvas.tabIndex, 0);
    assert.equal(dom.document.getElementById('chromiumAddress').type, 'url');
    assert.deepEqual(
      [...dom.document.querySelectorAll('.chromium-quick-links a')].map(link => link.getAttribute('data-chromium-url')),
      ['https://www.google.com/', 'https://github.com/', 'https://developer.mozilla.org/'],
    );

    const address = dom.document.getElementById('chromiumAddress');
    typeInto(address, 'javascript:alert(1)');
    click(dom.document.querySelector('#chromiumAddressForm button[type="submit"]'));
    await flush();
    assert.match(dom.document.getElementById('chromiumStatus').textContent, /只支援/);

    typeInto(address, 'https://example.com/');
    click(dom.document.querySelector('#chromiumAddressForm button[type="submit"]'));
    await flush();
    assert.equal(FakeWebSocket.instances.length, 1);
    assert.equal(dom.document.getElementById('chromiumFramePanel').hidden, false);
  } finally {
    globalThis.WebSocket = originalWebSocket;
    dom.cleanup();
  }
});

test('Chromium forwards shortcut modifiers on key down and up without typing their letters', async () => {
  const dom = setupDom('<div id="root"></div>');
  const original = globalThis.WebSocket;
  globalThis.WebSocket = FakeWebSocket; FakeWebSocket.instances = [];
  const view = render(<ChromiumPage />);
  try {
    const canvas = dom.document.getElementById('chromiumFrame');
    canvas.getContext = () => ({ clearRect() {} });
    click(dom.document.querySelector('[data-chromium-url]'));
    const socket = FakeWebSocket.instances[0];
    act(() => { socket.open(); socket.message({ type: 'ready' }); });
    await flush();
    for (const [flags, modifiers] of [[{ ctrlKey: true }, 2], [{ metaKey: true }, 4], [{ altKey: true, shiftKey: true }, 9]]) {
      for (const type of ['keydown', 'keyup']) {
        act(() => canvas.dispatchEvent(new dom.window.KeyboardEvent(type, { key: 'a', code: 'KeyA', keyCode: 65, ...flags, bubbles: true, cancelable: true })));
        const input = socket.sent.at(-1).input;
        assert.equal(input.modifiers, modifiers);
        assert.equal(input.eventType, type === 'keydown' ? 'keyDown' : 'keyUp');
        assert.equal('text' in input, false);
      }
    }
    act(() => canvas.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'A', code: 'KeyA', shiftKey: true, bubbles: true, cancelable: true })));
    assert.equal(socket.sent.at(-1).input.modifiers, 8);
    assert.equal(socket.sent.at(-1).input.text, 'A');
  } finally { view.unmount(); globalThis.WebSocket = original; dom.cleanup(); }
});

test('canvas input coordinates exclude contain letterboxes, borders and padding', () => {
  const dom = setupDom('<canvas width="1280" height="720"></canvas>');
  try {
    const canvas = dom.document.querySelector('canvas');
    canvas.style.cssText = 'object-fit: contain; border: 1px solid; padding: 0;';
    canvas.getBoundingClientRect = () => ({ left: 40, top: 90, width: 640, height: 520 });
    const point = canvasPoint(canvas, { clientX: 45.984375, clientY: 175.546875 });
    assert.ok(Math.abs(point.x - 10) < 1e-9);
    assert.ok(Math.abs(point.y - 10) < 1e-9);
    assert.deepEqual(canvasPoint(canvas, { clientX: 0, clientY: 0 }), { x: 0, y: 0 });
    assert.deepEqual(canvasPoint(canvas, { clientX: 9999, clientY: 9999 }), { x: 1279, y: 719 });

    canvas.style.cssText = 'object-fit: contain; padding: 10px;';
    canvas.getBoundingClientRect = () => ({ left: 40, top: 90, width: 1020, height: 320 });
    const scale = 300 / 720;
    const horizontal = canvasPoint(canvas, { clientX: 50 + (1000 - 1280 * scale) / 2 + 10 * scale, clientY: 100 + 10 * scale });
    assert.ok(Math.abs(horizontal.x - 10) < 1e-9);
    assert.ok(Math.abs(horizontal.y - 10) < 1e-9);
  } finally { dom.cleanup(); }
});
