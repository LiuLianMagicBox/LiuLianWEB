const { WebSocketServer } = require('ws');
const { getSessionId, getStoredSession } = require('./websocket_session');
const { getVisiblePageKeys } = require('./db');
const {
  ChromiumInputError,
  dispatchInput,
  launchChromiumPage,
  assertSafeDestination,
  normalizeStartUrl,
  screenSize,
} = require('./services/chromium');

const MAX_MESSAGE_BYTES = 32 * 1024;

function send(socket, message) {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
}

function bindChromiumSession(socket, options = {}) {
  const launchPage = options.launchPage || launchChromiumPage;
  let chromium = null;
  let closed = false;
  let timer = null;
  let generation = 0;
  let opening = null;
  let controller = null;

  const closeChromium = async () => {
    generation++;
    controller?.abort();
    clearTimeout(timer);
    timer = null;
    const current = chromium;
    chromium = null;
    if (current) await current.close();
  };
  const refreshTimeout = () => {
    clearTimeout(timer);
    if (chromium) {
      timer = setTimeout(() => { closeChromium().catch(() => {}); }, chromium.timeoutMs);
      timer.unref?.();
    }
  };
  const open = async message => {
    if (opening) throw new ChromiumInputError('Chromium session is already opening');
    const url = normalizeStartUrl(message.url);
    const size = screenSize(message.size);
    const attempt = ++generation;
    controller = new AbortController();
    const signal = controller.signal;
    opening = (async () => {
      clearTimeout(timer);
      const previous = chromium;
      chromium = null;
      if (previous) await previous.close();
      if (closed || generation !== attempt) return;
      send(socket, { type: 'status', status: 'opening' });
      const created = await launchPage({
        startUrl: url, size, signal, env: options.env, puppeteerImpl: options.puppeteerImpl,
        onFrame: frame => {
          if (!closed && generation === attempt) send(socket, {
            type: 'frame', data: frame.data, metadata: frame.metadata,
          });
        },
      });
      if (closed || generation !== attempt) {
        await created.close();
        return;
      }
      chromium = created;
      refreshTimeout();
      send(socket, { type: 'ready', url, size: chromium.size });
    })();
    try { await opening; }
    catch (error) { if (!closed && generation === attempt) throw error; }
    finally { opening = null; }
  };
  socket.on('message', async raw => {
    try {
      const message = JSON.parse(raw.toString());
      if (closed) return;
      if (message.type === 'open') return await open(message);
      // Closing also cancels a pending launch, before a page exists.
      if (message.type === 'close') {
        await closeChromium();
        send(socket, { type: 'closed' });
        return;
      }
      const current = chromium;
      if (!current) throw new ChromiumInputError('Chromium session is not open');
      const attempt = generation;
      refreshTimeout();
      if (message.type === 'navigate') {
        const url = normalizeStartUrl(message.url);
        await assertSafeDestination(url, options.env);
        if (closed || generation !== attempt) return;
        await current.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        if (!closed && generation === attempt) send(socket, { type: 'navigated', url });
      } else if (message.type === 'input') {
        await dispatchInput(current.cdp, message.input, current.size);
      } else throw new ChromiumInputError('Unsupported Chromium message');
    } catch (error) {
      if (closed) return;
      console.error('[Chromium] Session request failed:', error);
      const detail = typeof error?.message === 'string' ? error.message.slice(0, 300) : '';
      send(socket, {
        type: 'error',
        message: error instanceof ChromiumInputError ? error.message
          : detail ? `Chromium session failed: ${detail}` : 'Chromium session failed',
      });
    }
  });
  const close = () => {
    closed = true;
    return Promise.allSettled([closeChromium(), opening]);
  };
  socket.on('close', () => { close(); });
  socket.on('error', () => { close(); });
  return { close };
}

function attachChromiumServer(server, options) {
  const websocketServer = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  const sessions = new Set();
  const upgradeSockets = new Set();
  let stopping = false;

  server.on('upgrade', async (req, socket, head) => {
    const requestUrl = new URL(req.url, 'http://localhost');
    if (requestUrl.pathname !== '/api/chromium/ws') return;
    if (stopping) return socket.destroy();
    upgradeSockets.add(socket);
    socket.once('close', () => upgradeSockets.delete(socket));
    try {
      const sessionId = getSessionId(req.headers.cookie, options.sessionCookieName, options.sessionSecret);
      const sessionData = sessionId && await getStoredSession(options.sessionStore, sessionId);
      if (!sessionData?.user?.id) throw new Error('Unauthorized');
      const pages = await getVisiblePageKeys(sessionData.user.id);
      if (pages.chromium !== true) throw new Error('Chromium access is disabled');
      if (stopping || socket.destroyed) return socket.destroy();
      websocketServer.handleUpgrade(req, socket, head, ws => {
        options.sessionConnections?.track(sessionId, ws, 'close', () => ws.terminate());
        websocketServer.emit('connection', ws, req);
      });
    } catch (_) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    }
  });

  websocketServer.on('connection', socket => {
    const session = bindChromiumSession(socket, options);
    sessions.add(session);
    socket.on('close', () => {
      session.close().finally(() => sessions.delete(session));
    });
  });

  websocketServer.closeAll = () => {
    stopping = true;
    const cleanups = [...sessions].map(session => session.close());
    for (const socket of websocketServer.clients) socket.terminate();
    for (const socket of upgradeSockets) socket.destroy();
    return Promise.allSettled(cleanups);
  };
  return websocketServer;
}

module.exports = { attachChromiumServer, bindChromiumSession, MAX_MESSAGE_BYTES };
