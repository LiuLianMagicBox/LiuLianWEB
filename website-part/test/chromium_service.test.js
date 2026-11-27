const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ChromiumInputError,
  chromiumConfig,
  dispatchInput,
  launchChromiumPage,
  normalizeStartUrl,
  screenSize,
  assertSafeDestination,
  guardChromiumRequest,
  CHROMIUM_WEBRTC_POLICY_FLAG,
} = require('../src/services/chromium');

const REMOTE_PROXY_ENV = {
  CHROMIUM_PROXY_BIND_HOST: '127.0.0.1', CHROMIUM_PROXY_ADVERTISED_HOST: '127.0.0.1',
  CHROMIUM_PROXY_ALLOWED_CLIENT_IPS: '127.0.0.1',
};
const remoteTarget = () => ({ createCDPSession: async () => ({
  send: async () => ({ arguments: [CHROMIUM_WEBRTC_POLICY_FLAG] }), detach: async () => {},
}) });

test('validates Chromium URLs, screen sizes, and configuration', () => {
  assert.equal(normalizeStartUrl(' https://example.com/ '), 'https://example.com/');
  assert.throws(() => normalizeStartUrl('javascript:alert(1)'), ChromiumInputError);
  assert.deepEqual(screenSize({ width: 1024, height: 768 }), { width: 1024, height: 768 });
  assert.throws(() => screenSize({ width: 320, height: 200 }), /screen size/);
  assert.deepEqual(chromiumConfig({ CHROME_EXECUTABLE_PATH: 'C:\\chrome.exe', CHROMIUM_SESSION_TIMEOUT_MS: '90000' }), {
    executablePath: 'C:\\chrome.exe', cdpUrl: undefined, sessionTimeoutMs: 90000,
  });
});

test('launches Chrome, starts CDP screencast, and closes cleanly', async () => {
  const calls = [];
  const cdp = {
    on: (event, handler) => { cdp.handler = handler; calls.push(['on', event]); },
    send: async (...args) => calls.push(args),
    detach: async () => calls.push(['detach']),
  };
  const page = {
    setViewport: async value => calls.push(['viewport', value]),
    target: () => ({ createCDPSession: async () => cdp }),
    goto: async (...args) => calls.push(['goto', ...args]),
    close: async () => calls.push(['page-close']),
    setBypassServiceWorker: async value => calls.push(['bypass-workers', value]),
    setRequestInterception: async () => assert.fail('Puppeteer interception must not attach worker Fetch clients'),
    on() {},
  };
  const context = { newPage: async () => page, close: async () => calls.push(['context-close']) };
  const browser = {
    createBrowserContext: async options => { calls.push(['context-options', options]); return context; },
    close: async () => calls.push(['close']),
  };
  const puppeteerImpl = { launch: async options => { calls.push(['launch', options]); return browser; } };
  const session = await launchChromiumPage({
    startUrl: 'https://203.0.113.10/',
    size: { width: 1024, height: 768 },
    puppeteerImpl,
    env: { CHROME_EXECUTABLE_PATH: 'C:\\chrome.exe', CHROMIUM_SESSION_TIMEOUT_MS: '90000' },
  });
  assert.equal(calls[0][0], 'launch');
  assert.equal(calls[0][1].executablePath, 'C:\\chrome.exe');
  assert.ok(calls[0][1].args.includes(CHROMIUM_WEBRTC_POLICY_FLAG));
  assert.match(calls.find(call => call[0] === 'context-options')[1].proxyServer, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.deepEqual(calls.find(call => call[0] === 'context-options')[1].proxyBypassList, ['<-loopback>']);
  assert.deepEqual(calls.find(call => call[0] === 'viewport'), ['viewport', { width: 1024, height: 768 }]);
  assert.ok(calls.some(call => call[0] === 'Page.startScreencast'));
  assert.deepEqual(calls.find(call => call[0] === 'Fetch.enable'), ['Fetch.enable', { patterns: [{ urlPattern: '*' }] }]);
  assert.ok(calls.some(call => call[0] === 'goto'));
  await session.close();
  assert.ok(calls.some(call => call[0] === 'Page.stopScreencast'));
  assert.ok(calls.some(call => call[0] === 'detach'));
  assert.deepEqual(calls.at(-2), ['context-close']);
  assert.deepEqual(calls.at(-1), ['close']);
});

test('dispatches bounded CDP mouse, wheel, and keyboard input', async () => {
  const calls = [];
  const cdp = { send: async (...args) => calls.push(args) };
  await dispatchInput(cdp, { type: 'mouse', eventType: 'mousePressed', x: 50, y: 60, button: 'left' }, { width: 100, height: 100 });
  await dispatchInput(cdp, { type: 'wheel', x: 50, y: 60, deltaY: 3000 }, { width: 100, height: 100 });
  await dispatchInput(cdp, { type: 'key', eventType: 'keyDown', key: 'a', code: 'KeyA' }, { width: 100, height: 100 });
  assert.equal(calls[0][0], 'Input.dispatchMouseEvent');
  assert.equal(calls[1][1].deltaY, 1200);
  assert.deepEqual(calls[2], ['Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA' }]);
  await assert.rejects(dispatchInput(cdp, { type: 'unknown' }, { width: 100, height: 100 }), /Unsupported/);
});

test('connects to a remote CDP browser without closing the shared browser', async () => {
  const calls = [];
  const cdp = { on() {}, send: async (...args) => calls.push(args), detach: async () => {} };
  const page = {
    setViewport: async () => {},
    target: () => ({ createCDPSession: async () => cdp }),
    goto: async () => {},
    close: async () => calls.push(['page-close']),
    setBypassServiceWorker: async () => {},
    setRequestInterception: async () => {},
    on() {},
  };
  const context = { newPage: async () => page, close: async () => calls.push(['context-close']) };
  const browser = {
    target: remoteTarget,
    createBrowserContext: async () => context,
    disconnect: async () => calls.push(['disconnect']),
  };
  const puppeteerImpl = {
    connect: async options => { calls.push(['connect', options]); return browser; },
  };
  const session = await launchChromiumPage({
    startUrl: 'https://203.0.113.10/',
    puppeteerImpl,
    env: { CHROME_CDP_URL: 'http://192.168.1.10:9222', ...REMOTE_PROXY_ENV },
  });
  assert.deepEqual(calls[0], ['connect', { browserURL: 'http://192.168.1.10:9222', protocolTimeout: 30000 }]);
  await session.close();
  await session.close();
  assert.deepEqual(calls.slice(-2), [['context-close'], ['disconnect']]);
  assert.equal(calls.filter(call => call[0] === 'disconnect').length, 1);
});

test('Chromium checks private IPv6 and DNS addresses, allowing only explicitly configured private hosts', async t => {
  for (const host of ['[::ffff:127.0.0.1]', '[0:0:0:0:0:0:0:1]', '[fe90::1]', '0.0.0.0']) {
    await assert.rejects(assertSafeDestination(`http://${host}/`, {}), /Private or unresolved/);
  }
  assert.deepEqual(await assertSafeDestination('http://[::ffff:192.168.0.42]/', { CHROMIUM_ALLOWED_HOSTS: '192.168.0.42' }), ['192.168.0.42']);
  t.mock.method(require('node:dns').promises, 'lookup', async () => [{ address: '::ffff:7f00:1', family: 6 }]);
  await assert.rejects(assertSafeDestination('https://public-name.example/', {}), /Private or unresolved/);
  assert.deepEqual(await assertSafeDestination('https://public-name.example/', { CHROMIUM_ALLOWED_HOSTS: 'public-name.example' }), ['127.0.0.1']);
});

test('the Page scheme gate replies to its own Fetch IDs while HTTP destinations are checked by the context proxy', async () => {
  const actions = [];
  const cdp = { send: async (...args) => actions.push(args) };
  for (const url of ['file:///etc/passwd', 'ftp://example.test/file', 'chrome://settings', 'invalid', 'about:srcdoc']) {
    await guardChromiumRequest(cdp, { requestId: 'page-id', request: { url } });
    assert.deepEqual(actions.at(-1), ['Fetch.failRequest', { requestId: 'page-id', errorReason: 'BlockedByClient' }], url);
  }
  for (const url of ['http://127.0.0.1/admin', 'https://203.0.113.10/asset', 'about:blank', 'data:text/plain,hello', 'blob:https://203.0.113.10/id']) {
    await guardChromiumRequest(cdp, { requestId: 'page-id', request: { url } });
    assert.deepEqual(actions.at(-1), ['Fetch.continueRequest', { requestId: 'page-id' }], url);
  }
});

test('a failed Page scheme-gate command closes the context instead of leaving a paused request alive', async () => {
  const { EventEmitter, once } = require('node:events');
  const calls = [];
  const cdp = new EventEmitter();
  cdp.send = async (...args) => {
    calls.push(args);
    if (args[0] === 'Fetch.failRequest') throw new Error('Fetch command failed');
  };
  cdp.detach = async () => {};
  const page = { setViewport: async () => {}, target: () => ({ createCDPSession: async () => cdp }), goto: async () => {} };
  const context = new EventEmitter();
  context.newPage = async () => page;
  context.close = async () => { context.emit('closed'); };
  let browserClosed = false;
  const browser = { createBrowserContext: async () => context, close: async () => { browserClosed = true; } };
  const session = await launchChromiumPage({ startUrl: 'http://203.0.113.10/', env: {}, puppeteerImpl: { launch: async () => browser } });
  try {
    const closed = once(context, 'closed', { signal: AbortSignal.timeout(1000) });
    cdp.emit('Fetch.requestPaused', { requestId: 'owned-request', request: { url: 'file:///private' } });
    await closed;
    await session.close();
    assert.ok(browserClosed);
    assert.ok(calls.some(([method, parameters]) => method === 'Fetch.failRequest' && parameters.requestId === 'owned-request'));
  } finally { await session.close(); }
});

test('failed shared-CDP navigation closes its context and disconnects its own transport', async () => {
  const calls = [];
  const page = {
    setBypassServiceWorker: async () => {}, setRequestInterception: async () => {}, on() {}, setViewport: async () => {},
    target: () => ({ createCDPSession: async () => ({ on() {}, send: async () => {}, detach: async () => {} }) }),
    goto: async () => { throw new Error('navigation failed'); },
  };
  const browser = {
    target: remoteTarget,
    createBrowserContext: async () => ({ newPage: async () => page, close: async () => calls.push('context-close') }),
    disconnect: () => calls.push('disconnect'), close: async () => assert.fail('must preserve shared browser'),
  };
  await assert.rejects(launchChromiumPage({ startUrl: 'http://203.0.113.10/', env: { CHROME_CDP_URL: 'http://cdp.test', ...REMOTE_PROXY_ENV },
    puppeteerImpl: { connect: async () => browser } }), /navigation failed/);
  assert.deepEqual(calls, ['context-close', 'disconnect']);
});

test('cancelling during shared-CDP page creation disposes the context and transport', async () => {
  const calls = [];
  let rejectPage;
  let started;
  const creating = new Promise(resolve => { started = resolve; });
  const context = {
    newPage: () => new Promise((resolve, reject) => { rejectPage = reject; started(); }),
    close: async () => { calls.push('context-close'); rejectPage(new Error('target closed')); },
  };
  const browser = { target: remoteTarget, createBrowserContext: async () => context, disconnect: () => calls.push('disconnect') };
  const controller = new AbortController();
  const launching = launchChromiumPage({ startUrl: 'http://203.0.113.10/', signal: controller.signal,
    env: { CHROME_CDP_URL: 'http://cdp.test', ...REMOTE_PROXY_ENV }, puppeteerImpl: { connect: async () => browser } });
  const rejected = assert.rejects(launching, /target closed|cancelled/);
  await creating;
  controller.abort();
  await rejected;
  assert.deepEqual(calls, ['context-close', 'disconnect']);
});

test('remote Chromium fails closed without a reachable restricted policy proxy', async () => {
  let connected = false;
  await assert.rejects(launchChromiumPage({ startUrl: 'http://203.0.113.10/', env: { CHROME_CDP_URL: 'http://remote.test:9222' },
    puppeteerImpl: { connect: async () => { connected = true; } } }), /CHROMIUM_PROXY_BIND_HOST/);
  assert.equal(connected, false);
});

for (const [label, commandLine] of [['missing', []], ['unverifiable', null],
  ['overridden', [CHROMIUM_WEBRTC_POLICY_FLAG, '--webrtc-ip-handling-policy=default']],
  ['overridden by a bare switch', [CHROMIUM_WEBRTC_POLICY_FLAG, '--webrtc-ip-handling-policy']],
  ['a positional flag after the terminator', ['--webrtc-ip-handling-policy=default', '--', CHROMIUM_WEBRTC_POLICY_FLAG]]]) {
  test(`remote Chromium rejects ${label} WebRTC proxy policy`, async () => {
    let disconnected = false;
    const browser = {
      target: () => ({ createCDPSession: async () => ({
        send: async () => { if (commandLine === null) throw new Error('automation not enabled'); return { arguments: commandLine }; },
        detach: async () => {},
      }) }),
      createBrowserContext: async () => assert.fail('must verify policy before creating a context'),
      disconnect: () => { disconnected = true; },
    };
    await assert.rejects(launchChromiumPage({ startUrl: 'http://203.0.113.10/', env: { CHROME_CDP_URL: 'http://remote.test:9222', ...REMOTE_PROXY_ENV },
      puppeteerImpl: { connect: async () => browser } }), /--enable-automation.*disable_non_proxied_udp/);
    assert.equal(disconnected, true);
  });
}
