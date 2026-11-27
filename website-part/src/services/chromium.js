const fs = require('fs');
const dns = require('dns').promises;
const net = require('net');
const { canonicalizeRemoteAddress, isPrivateAddress } = require('./remote_validation');
const { createChromiumPolicyProxy } = require('./chromium_policy_proxy');

const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 720;
const MAX_WIDTH = 1920;
const MAX_HEIGHT = 1080;
const CHROMIUM_WEBRTC_POLICY_FLAG = '--webrtc-ip-handling-policy=disable_non_proxied_udp';

class ChromiumInputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ChromiumInputError';
  }
}

function normalizeStartUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) throw new ChromiumInputError('A start URL is required');
  let url;
  try {
    url = new URL(raw);
  } catch (_) {
    throw new ChromiumInputError('Start URL must use http:// or https://');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new ChromiumInputError('Start URL must use http:// or https://');
  }
  return url.toString();
}

async function assertSafeDestination(urlText, env = process.env) {
  const url = new URL(urlText);
  if (!['http:', 'https:'].includes(url.protocol)) throw new ChromiumInputError('Only HTTP destinations are permitted');
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const allowed = new Set(String(env.CHROMIUM_ALLOWED_HOSTS || '').split(',').map(x => {
    const host = x.trim().toLowerCase().replace(/^\[|\]$/g, '');
    return canonicalizeRemoteAddress(host) || host;
  }).filter(Boolean));
  const rawAddresses = net.isIP(hostname) ? [hostname] : (await dns.lookup(hostname, { all: true })).map(x => x.address);
  const addresses = rawAddresses.map(canonicalizeRemoteAddress);
  if (!addresses.length || addresses.includes(null)
    || (addresses.some(isPrivateAddress) && !allowed.has(canonicalizeRemoteAddress(hostname) || hostname))) {
    throw new ChromiumInputError('Private or unresolved destinations are not permitted');
  }
  return addresses;
}

async function guardChromiumRequest(cdp, event) {
  let permitted = false;
  try {
    const url = new URL(event.request.url);
    permitted = ['http:', 'https:', 'data:', 'blob:'].includes(url.protocol) || url.href === 'about:blank';
  } catch (_) { /* Malformed destinations fail closed. */ }
  await cdp.send(permitted ? 'Fetch.continueRequest' : 'Fetch.failRequest', {
    requestId: event.requestId,
    ...(!permitted ? { errorReason: 'BlockedByClient' } : {}),
  });
}

function screenSize(value = {}) {
  const width = Number(value.width) || DEFAULT_WIDTH;
  const height = Number(value.height) || DEFAULT_HEIGHT;
  if (!Number.isInteger(width) || !Number.isInteger(height)
    || width < 640 || width > MAX_WIDTH || height < 480 || height > MAX_HEIGHT) {
    throw new ChromiumInputError('Invalid Chromium screen size');
  }
  return { width, height };
}

function chromiumConfig(env = process.env) {
  const candidates = process.platform === 'win32'
    ? [
      `${env.PROGRAMFILES || 'C:\\Program Files'}\\Google\\Chrome\\Application\\chrome.exe`,
      `${env.LOCALAPPDATA || ''}\\Google\\Chrome\\Application\\chrome.exe`,
    ]
    : ['/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  const detectedPath = candidates.find(candidate => candidate && fs.existsSync(candidate));
  return {
    executablePath: String(env.CHROME_EXECUTABLE_PATH || '').trim() || detectedPath,
    cdpUrl: String(env.CHROME_CDP_URL || '').trim() || undefined,
    sessionTimeoutMs: Math.max(60000, Number(env.CHROMIUM_SESSION_TIMEOUT_MS) || 1800000),
  };
}

function launchOptions(config) {
  return {
    ...(config.executablePath ? { executablePath: config.executablePath } : {}),
    headless: true,
    args: [
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      CHROMIUM_WEBRTC_POLICY_FLAG,
    ],
  };
}

async function verifyRemoteNetworkPolicy(browser) {
  let inspector;
  try {
    inspector = await browser.target().createCDPSession();
    const commandLine = await inspector.send('Browser.getBrowserCommandLine');
    const argumentsList = commandLine.arguments || [];
    const terminator = argumentsList.indexOf('--');
    const switches = terminator < 0 ? argumentsList : argumentsList.slice(0, terminator);
    const effective = switches.filter(argument => argument === '--webrtc-ip-handling-policy'
      || argument.startsWith('--webrtc-ip-handling-policy='))?.at(-1);
    if (effective !== CHROMIUM_WEBRTC_POLICY_FLAG) throw new Error('WebRTC proxy policy is missing');
  } catch (_) {
    throw new ChromiumInputError(`Remote Chromium must run with --enable-automation and ${CHROMIUM_WEBRTC_POLICY_FLAG}`);
  } finally {
    if (inspector) await inspector.detach().catch(() => {});
  }
}

async function launchChromiumPage({
  startUrl,
  size,
  onFrame,
  puppeteerImpl,
  signal,
  env = process.env,
} = {}) {
  const url = normalizeStartUrl(startUrl);
  await assertSafeDestination(url, env);
  const viewport = screenSize(size);
  const puppeteer = puppeteerImpl || require('puppeteer-core');
  const config = chromiumConfig(env);
  const ownsBrowser = !config.cdpUrl;
  if (signal?.aborted) throw new ChromiumInputError('Chromium session was cancelled');
  const policyProxy = await createChromiumPolicyProxy({ env, cdpUrl: config.cdpUrl, assertDestination: assertSafeDestination });
  let browser;
  let context = null;
  let page = null;
  let cdp = null;
  let closing = null;
  const checkCancelled = () => {
    if (signal?.aborted) throw new ChromiumInputError('Chromium session was cancelled');
  };
  const cancel = () => { close().catch(() => {}); };
  const close = () => {
    if (!closing) closing = (async () => {
      signal?.removeEventListener('abort', cancel);
      if (cdp) {
        try { await cdp.send('Page.stopScreencast'); } catch (_) { /* target may be gone */ }
        try { await cdp.detach(); } catch (_) { /* target may be gone */ }
      }
      if (context) await context.close().catch(() => {});
      await policyProxy.close();
      if (browser && ownsBrowser) await browser.close().catch(() => {});
      else if (browser) { try { await browser.disconnect(); } catch (_) { /* transport may be gone */ } }
    })();
    return closing;
  };
  try {
    checkCancelled();
    browser = ownsBrowser
      ? await puppeteer.launch({ ...launchOptions(config), ...(signal ? { signal } : {}), protocolTimeout: 30000 })
      : await puppeteer.connect({ browserURL: config.cdpUrl, protocolTimeout: 30000 });
    checkCancelled();
    if (!ownsBrowser) await verifyRemoteNetworkPolicy(browser);
    checkCancelled();
    context = await browser.createBrowserContext({ proxyServer: policyProxy.proxyServer, proxyBypassList: policyProxy.proxyBypassList });
    checkCancelled();
    signal?.addEventListener('abort', cancel, { once: true });
    page = await context.newPage();
    checkCancelled();
    await page.setViewport(viewport);
    cdp = await page.target().createCDPSession();
    // Use this Page session's own Fetch IDs for the scheme gate. Puppeteer's
    // request interception also attaches worker clients and can route a paused
    // request to a worker where Fetch is unavailable, leaving it stuck. HTTP
    // destination checks and DNS pinning belong to the context-wide proxy.
    cdp.on('Fetch.requestPaused', event => {
      guardChromiumRequest(cdp, event).catch(() => { close().catch(() => {}); });
    });
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
    await cdp.send('Page.enable');
    cdp.on('Page.screencastFrame', event => {
      Promise.resolve().then(() => onFrame?.(event)).catch(() => {}).finally(() => (
        cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => {})
      ));
    });
    await cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 75,
      maxWidth: viewport.width,
      maxHeight: viewport.height,
      everyNthFrame: 1,
    });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    return { browser, context, page, cdp, close, size: viewport, timeoutMs: config.sessionTimeoutMs };
  } catch (error) {
    await close();
    throw error;
  }
}

function assertFiniteCoordinate(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new ChromiumInputError(`Invalid ${name}`);
  return number;
}

async function dispatchInput(cdp, message, size) {
  if (!message || typeof message.type !== 'string') throw new ChromiumInputError('Invalid Chromium input');
  if (message.type === 'mouse') {
    const eventType = ['mousePressed', 'mouseReleased', 'mouseMoved'].includes(message.eventType)
      ? message.eventType : null;
    if (!eventType) throw new ChromiumInputError('Invalid mouse event');
    const params = {
      type: eventType,
      x: Math.min(assertFiniteCoordinate(message.x, 'mouse x'), size.width),
      y: Math.min(assertFiniteCoordinate(message.y, 'mouse y'), size.height),
      button: ['none', 'left', 'middle', 'right', 'back', 'forward'].includes(message.button)
        ? message.button : 'none',
      clickCount: Math.max(1, Math.min(Number(message.clickCount) || 1, 3)),
    };
    await cdp.send('Input.dispatchMouseEvent', params);
    return;
  }
  if (message.type === 'wheel') {
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: Math.min(assertFiniteCoordinate(message.x, 'wheel x'), size.width),
      y: Math.min(assertFiniteCoordinate(message.y, 'wheel y'), size.height),
      deltaX: Math.max(-1200, Math.min(Number(message.deltaX) || 0, 1200)),
      deltaY: Math.max(-1200, Math.min(Number(message.deltaY) || 0, 1200)),
    });
    return;
  }
  if (message.type === 'key') {
    const eventType = ['keyDown', 'keyUp', 'char'].includes(message.eventType)
      ? message.eventType : null;
    if (!eventType) throw new ChromiumInputError('Invalid keyboard event');
    const params = { type: eventType };
    if (message.modifiers !== undefined) {
      if (!Number.isInteger(message.modifiers) || message.modifiers < 0 || message.modifiers > 15) throw new ChromiumInputError('Invalid keyboard modifiers');
      params.modifiers = message.modifiers;
    }
    for (const field of ['key', 'code', 'text', 'unmodifiedText']) {
      if (typeof message[field] === 'string') params[field] = message[field].slice(0, 64);
    }
    if (Number.isInteger(message.windowsVirtualKeyCode)) params.windowsVirtualKeyCode = message.windowsVirtualKeyCode;
    await cdp.send('Input.dispatchKeyEvent', params);
    return;
  }
  throw new ChromiumInputError('Unsupported Chromium input');
}

module.exports = {
  DEFAULT_HEIGHT,
  DEFAULT_WIDTH,
  CHROMIUM_WEBRTC_POLICY_FLAG,
  ChromiumInputError,
  chromiumConfig,
  dispatchInput,
  launchChromiumPage,
  normalizeStartUrl,
  assertSafeDestination,
  guardChromiumRequest,
  screenSize,
};
