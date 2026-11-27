const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const puppeteer = require('puppeteer-core');
const net = require('node:net');
const dgram = require('node:dgram');
const { WebSocketServer } = require('ws');
const { launchChromiumPage, CHROMIUM_WEBRTC_POLICY_FLAG } = require('../src/services/chromium');

// Optional real-browser security regression; ordinary unit tests need no Chrome.
test('shared CDP contexts isolate cookies and block redirected/private frame resources', {
  skip: !process.env.CHROMIUM_TEST_BROWSER_PATH, timeout: 30000,
}, async () => {
  let privateHits = 0;
  let browser;
  const sessions = [];
  const requests = [];
  const serverRequests = [];
  let frameFailureTimer;
  const server = http.createServer((req, res) => {
    serverRequests.push(req.url);
    res.setHeader('Content-Type', 'text/html');
    if (req.url === '/set-cookie') {
      res.setHeader('Set-Cookie', 'private_login=user-A; HttpOnly; Path=/; SameSite=Strict');
      res.end('signed in');
    } else if (req.url === '/read-cookie') res.end(req.headers.cookie || 'no cookie');
    else if (req.url === '/redirect') {
      res.writeHead(302, { Location: `http://127.0.0.1:${server.address().port}/private` }); res.end();
    } else if (req.url === '/frame') {
      const privateUrl = `http://127.0.0.1:${server.address().port}/private`;
      res.end(`<!doctype html><body><script>
        window.fixtureDone = { frame: false, image: null, worker: null };
        window.fixtureEvents = [];
        const record = (kind, value) => {
          window.fixtureDone[kind] = value;
          window.fixtureEvents.push({ kind, value, visibility: document.visibilityState, time: performance.now() });
        };
        window.startFixture = () => {
          const frame = document.createElement('iframe');
          frame.onload = frame.onerror = event => { record('frame', event.type); };
          frame.src = ${JSON.stringify(privateUrl)};
          document.body.append(frame);
          const image = new Image();
          image.onload = () => { record('image', 'loaded'); };
          image.onerror = () => { record('image', 'blocked'); };
          image.src = ${JSON.stringify(privateUrl)};
          document.body.append(image);
          const worker = new Worker('/worker.js');
          worker.onmessage = event => {
            record('worker', event.data);
            worker.terminate();
          };
          worker.onerror = () => { record('worker', 'worker-script-error'); };
        };
      </script>`);
    } else if (req.url === '/worker.js') {
      res.setHeader('Content-Type', 'application/javascript');
      res.end(`let outcome = 'loaded';
        fetch('http://127.0.0.1:${server.address().port}/private', { mode: 'no-cors' })
          .catch(() => { outcome = 'blocked'; })
          .finally(() => { self.postMessage(outcome); });`);
    } else if (req.url === '/private') { privateHits++; res.end('private data'); }
    else { res.writeHead(404); res.end(); }
  });
  server.listen(0, '::'); await once(server, 'listening');
  try {
    browser = await puppeteer.launch({ executablePath: process.env.CHROMIUM_TEST_BROWSER_PATH, headless: true,
      args: [CHROMIUM_WEBRTC_POLICY_FLAG, ...(process.env.CHROMIUM_TEST_NO_SANDBOX === '1' ? ['--no-sandbox', '--disable-dev-shm-usage'] : [])] });
    const env = { CHROME_CDP_URL: `http://${new URL(browser.wsEndpoint()).host}`, CHROMIUM_ALLOWED_HOSTS: 'localhost' };
    const base = `http://localhost:${server.address().port}`;
    const a = await launchChromiumPage({ startUrl: `${base}/set-cookie`, env }); sessions.push(a);
    const b = await launchChromiumPage({ startUrl: `${base}/read-cookie`, env }); sessions.push(b);
    assert.equal(await b.page.evaluate(() => document.body.textContent), 'no cookie');
    assert.notEqual(a.context.id, b.context.id);
    await a.close();
    assert.equal(a.browser.isConnected(), false);
    assert.equal(browser.isConnected(), true, 'the external shared browser must stay alive');
    await assert.rejects(launchChromiumPage({ startUrl: `${base}/redirect`, env }));
    assert.equal(privateHits, 0);
    const frame = await launchChromiumPage({ startUrl: `${base}/frame`, env }); sessions.push(frame);
    let privateFrameId;
    let resolveFrameFailure;
    const frameFailure = new Promise((resolve, reject) => {
      resolveFrameFailure = resolve;
      frameFailureTimer = setTimeout(() => reject(new Error('Blocked iframe did not report a network failure')), 10000);
    });
    frameFailure.catch(() => {});
    frame.cdp.on('Network.requestWillBeSent', event => {
      requests.push({ event: 'request', id: event.requestId, url: event.request.url.slice(0, 200), type: event.type });
      if (event.type === 'Document' && event.request.url === `http://127.0.0.1:${server.address().port}/private`) privateFrameId = event.requestId;
    });
    frame.cdp.on('Network.loadingFailed', event => {
      requests.push({ event: 'failed', id: event.requestId, error: event.errorText, blockedReason: event.blockedReason });
      if (event.requestId === privateFrameId) { clearTimeout(frameFailureTimer); resolveFrameFailure(event); }
    });
    frame.cdp.on('Network.loadingFinished', event => { requests.push({ event: 'finished', id: event.requestId }); });
    await frame.cdp.send('Network.enable');
    // Install observers before creating the resources. A blocked iframe need
    // not dispatch a DOM load/error event; its actual network failure is proof.
    await frame.page.evaluate(() => window.startFixture());
    try {
      await Promise.all([frameFailure, frame.page.waitForFunction(() => window.fixtureDone
        && window.fixtureDone.image !== null && window.fixtureDone.worker !== null, { timeout: 10000, polling: 100 })]);
    } catch (error) {
      const state = await frame.page.evaluate(() => ({ done: window.fixtureDone, events: window.fixtureEvents,
        visibility: document.visibilityState, readyState: document.readyState })).catch(e => ({ error: e.message }));
      error.message += `; fixture diagnostics: ${JSON.stringify({ state, requests, serverRequests, privateHits })}`;
      throw error;
    }
    const fixture = await frame.page.evaluate(() => window.fixtureDone);
    assert.deepEqual({ image: fixture.image, worker: fixture.worker }, { image: 'blocked', worker: 'blocked' });
    assert.equal(privateHits, 0, 'blocked iframe, image and worker requests must never reach the private service');
  } finally {
    clearTimeout(frameFailureTimer);
    await Promise.allSettled(sessions.map(session => session.close()));
    if (browser) await browser.close();
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  }
});

test('context policy guards shared/service workers, popups and WebSockets while allowed traffic still works', {
  skip: !process.env.CHROMIUM_TEST_BROWSER_PATH, timeout: 30000,
}, async () => {
  const hits = [];
  let browser;
  let session;
  let privateTlsConnections = 0;
  let stunPackets = 0;
  const privateTls = net.createServer(socket => { privateTlsConnections++; socket.destroy(); });
  privateTls.listen(0, '127.0.0.1'); await once(privateTls, 'listening');
  const stun = dgram.createSocket('udp4');
  stun.on('message', () => { stunPackets++; });
  stun.bind(0, '127.0.0.1'); await once(stun, 'listening');
  const workerScript = (kind, respond) => `async function run() {
    const allowed = await fetch('/allowed-${kind}').then(response => response.text());
    const denied = await fetch('http://127.0.0.1:${server.address().port}/private-${kind}').then(() => 'loaded').catch(() => 'blocked');
    return { allowed, denied };
  } ${respond}`;
  const server = http.createServer((req, res) => {
    hits.push(req.url);
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.url === '/shared.js') {
      res.setHeader('Content-Type', 'application/javascript');
      res.end(workerScript('shared', 'onconnect = event => run().then(result => event.ports[0].postMessage(result));'));
    } else if (req.url === '/service.js') {
      res.setHeader('Content-Type', 'application/javascript');
      res.end(workerScript('service', "addEventListener('install', () => skipWaiting()); addEventListener('activate', event => event.waitUntil(clients.claim())); onmessage = event => run().then(result => event.ports[0].postMessage(result));"));
    } else if (req.url === '/dedicated.js') {
      res.setHeader('Content-Type', 'application/javascript');
      res.end(workerScript('dedicated', 'run().then(result => postMessage(result));'));
    } else if (req.url.startsWith('/allowed-')) res.end('allowed');
    else if (req.url.startsWith('/private-')) res.end('private');
    else { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Policy fixture</title>'); }
  });
  const websocketServer = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    hits.push(req.url);
    websocketServer.handleUpgrade(req, socket, head, ws => ws.on('error', () => {}));
  });
  server.listen(0, '::'); await once(server, 'listening');
  try {
    browser = await puppeteer.launch({ executablePath: process.env.CHROMIUM_TEST_BROWSER_PATH, headless: true,
      args: [CHROMIUM_WEBRTC_POLICY_FLAG, ...(process.env.CHROMIUM_TEST_NO_SANDBOX === '1' ? ['--no-sandbox', '--disable-dev-shm-usage'] : [])] });
    session = await launchChromiumPage({ startUrl: `http://localhost:${server.address().port}/`,
      env: { CHROME_CDP_URL: `http://${new URL(browser.wsEndpoint()).host}`, CHROMIUM_ALLOWED_HOSTS: 'localhost' } });
    const outcomes = await session.page.evaluate(async ({ port, tlsPort, stunPort }) => {
      const dedicated = Promise.all(Array.from({ length: 8 }, () => new Promise(resolve => {
        const worker = new Worker('/dedicated.js');
        worker.onmessage = event => { worker.terminate(); resolve(event.data); };
      })));
      const sharedWorker = new SharedWorker('/shared.js');
      const shared = new Promise(resolve => { sharedWorker.port.onmessage = event => { sharedWorker.port.close(); resolve(event.data); }; });
      const service = (async () => {
        const registration = await navigator.serviceWorker.register('/service.js');
        await navigator.serviceWorker.ready;
        const channel = new MessageChannel();
        const result = new Promise(resolve => { channel.port1.onmessage = event => { channel.port1.close(); resolve(event.data); }; });
        registration.active.postMessage('run', [channel.port2]);
        return result;
      })();
      const socketResult = url => new Promise(resolve => {
        const socket = new WebSocket(url);
        socket.onopen = () => { socket.close(); resolve('opened'); };
        socket.onerror = () => resolve('blocked');
      });
      const allowedWs = socketResult(`ws://localhost:${port}/allowed-ws`);
      const deniedWs = socketResult(`ws://127.0.0.1:${port}/private-ws`);
      const deniedWss = socketResult(`wss://127.0.0.1:${tlsPort}/private-wss`);
      window.open(`http://localhost:${port}/allowed-popup`);
      window.open(`http://127.0.0.1:${port}/private-popup`);
      const rtc = new RTCPeerConnection({ iceServers: [{ urls: `stun:127.0.0.1:${stunPort}` }] });
      rtc.createDataChannel('fixture');
      await rtc.setLocalDescription(await rtc.createOffer());
      // Give ICE enough time to send its first STUN packet if direct UDP were enabled.
      await new Promise(resolve => setTimeout(resolve, 750));
      rtc.close();
      return { dedicated: await dedicated, shared: await shared, service: await service,
        allowedWs: await allowedWs, deniedWs: await deniedWs, deniedWss: await deniedWss };
    }, { port: server.address().port, tlsPort: privateTls.address().port, stunPort: stun.address().port });
    for (const result of outcomes.dedicated) assert.deepEqual(result, { allowed: 'allowed', denied: 'blocked' });
    assert.equal(hits.filter(path => path === '/allowed-dedicated').length, 8, 'all concurrent allowed workers must complete their requests');
    for (const kind of ['shared', 'service']) assert.deepEqual(outcomes[kind], { allowed: 'allowed', denied: 'blocked' });
    assert.deepEqual([outcomes.allowedWs, outcomes.deniedWs, outcomes.deniedWss], ['opened', 'blocked', 'blocked']);
    await session.browser.waitForTarget(target => target.url().includes('/allowed-popup'), { timeout: 5000 });
    assert.ok(hits.includes('/allowed-popup'), 'allowed popups remain usable');
    assert.ok(hits.includes('/allowed-ws'), 'allowed WebSockets remain usable');
    assert.equal(hits.some(path => path.startsWith('/private-')), false, `forbidden server hits: ${hits}`);
    assert.equal(privateTlsConnections, 0, 'forbidden WSS never reaches its TCP endpoint');
    assert.equal(stunPackets, 0, 'WebRTC cannot bypass the proxy with direct UDP');
  } finally {
    if (session) await session.close();
    if (browser) await browser.close();
    for (const client of websocketServer.clients) client.terminate();
    websocketServer.close(); stun.close();
    await Promise.all([new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }), new Promise(resolve => privateTls.close(resolve))]);
  }
});
