const { Client } = require('ssh2');
const { WebSocketServer } = require('ws');
const { getSessionId, getStoredSession } = require('./websocket_session');
const { userHasRemoteAccess } = require('./middleware/remote_auth');
const { remoteFeatures } = require('./services/remote_features');
const {
  RemoteInputError,
  normalizeHost,
  normalizePort,
  assertResolvedRemoteHost,
  allowedSshHosts,
} = require('./services/remote_validation');

const MAX_MESSAGE_BYTES = 32 * 1024;

function send(socket, message) {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
}

async function sshConfig(message) {
  if (!message || message.type !== 'connect') throw new RemoteInputError('Connect request is required');
  const host = normalizeHost(message.host);
  const allowedHosts = allowedSshHosts();
  const addresses = await assertResolvedRemoteHost(host, allowedHosts, { allowPrivate: allowedHosts.size > 0 });
  const username = typeof message.username === 'string' ? message.username.trim() : '';
  if (!username || username.length > 256 || /[\r\n\0]/.test(username)) {
    throw new RemoteInputError('Username is invalid');
  }
  const privateKey = typeof message.privateKey === 'string' ? message.privateKey : '';
  const password = typeof message.password === 'string' ? message.password : '';
  if (!password && !privateKey) throw new RemoteInputError('Password or private key is required');
  if (password.length > 512 || privateKey.length > 16384) throw new RemoteInputError('Credentials are too long');
  return {
    host: addresses[0],
    port: normalizePort(message.port, 22),
    username,
    ...(privateKey ? { privateKey } : { password }),
    readyTimeout: 15000,
    keepaliveInterval: 15000,
  };
}

function attachSshServer(server, options) {
  const websocketServer = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  const upgradeSockets = new Set();
  let stopping = false;
  server.on('upgrade', async (req, socket, head) => {
    const requestUrl = new URL(req.url, 'http://localhost');
    if (requestUrl.pathname !== '/api/ssh') return;
    if (stopping) return socket.destroy();
    upgradeSockets.add(socket);
    socket.once('close', () => upgradeSockets.delete(socket));
    if (!remoteFeatures().ssh) {
      socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      return;
    }
    try {
      const sessionId = getSessionId(req.headers.cookie, options.sessionCookieName, options.sessionSecret);
      const sessionData = sessionId && await getStoredSession(options.sessionStore, sessionId);
      if (!sessionData?.user?.id) throw new Error('Unauthorized');
      if (!await userHasRemoteAccess(sessionData.user.id)) throw new Error('Forbidden');
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
    let client = null;
    let stream = null;
    let connecting = false;
    let closed = false;
    let generation = 0;
    const closeConnection = () => {
      generation++;
      connecting = false;
      stream?.close();
      client?.destroy();
      stream = null;
      client = null;
    };

    socket.on('message', async raw => {
      let message;
      try {
        message = JSON.parse(raw.toString());
        if (message.type === 'connect') {
          if (client || connecting) throw new RemoteInputError('An SSH connection is already open');
          const attempt = ++generation;
          connecting = true;
          let config;
          try { config = await sshConfig(message); }
          finally { if (generation === attempt) connecting = false; }
          if (closed || generation !== attempt) return;
          const current = new Client();
          client = current;
          current.on('ready', () => {
            if (closed || client !== current) return current.destroy();
            current.shell({ term: 'xterm-256color', cols: 120, rows: 32 }, (err, shell) => {
              if (err) return send(socket, { type: 'error', message: 'Unable to open SSH shell' });
              if (closed || client !== current) return shell.close();
              stream = shell;
              shell.on('data', data => send(socket, { type: 'data', data: data.toString('utf8') }));
              shell.on('close', () => send(socket, { type: 'closed' }));
              send(socket, { type: 'connected' });
            });
          });
          current.on('error', () => {
            if (client !== current) return;
            send(socket, { type: 'error', message: 'SSH connection failed' });
            stream = null;
            client = null;
          });
          current.on('close', () => {
            if (client !== current) return;
            stream = null;
            client = null;
            send(socket, { type: 'closed' });
          });
          current.connect(config);
        } else if (message.type === 'input' && stream && typeof message.data === 'string') {
          stream.write(message.data.slice(0, 8192));
        } else if (message.type === 'resize' && stream) {
          stream.setWindow(Math.max(1, Math.min(Number(message.rows) || 32, 200)), Math.max(1, Math.min(Number(message.cols) || 120, 300)), 0, 0);
        } else if (message.type === 'disconnect') {
          closeConnection();
        }
      } catch (err) {
        send(socket, { type: 'error', message: err instanceof RemoteInputError ? err.message : 'Invalid SSH request' });
      }
    });
    socket.on('close', () => { closed = true; closeConnection(); });
    socket.on('error', () => { closed = true; closeConnection(); });
  });
  websocketServer.closeAll = () => {
    stopping = true;
    for (const socket of websocketServer.clients) socket.terminate();
    for (const socket of upgradeSockets) socket.destroy();
  };
  return websocketServer;
}

module.exports = { attachSshServer, sshConfig };
