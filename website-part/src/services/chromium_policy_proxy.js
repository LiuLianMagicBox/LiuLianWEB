const http = require('node:http');
const net = require('node:net');
const { canonicalizeRemoteAddress } = require('./remote_validation');

function localHost(host) {
  return host === 'localhost' || ['127.0.0.1', '::1'].includes(canonicalizeRemoteAddress(host));
}

function proxySettings(env, cdpUrl) {
  const bindHost = String(env.CHROMIUM_PROXY_BIND_HOST || '127.0.0.1').trim();
  const advertisedHost = String(env.CHROMIUM_PROXY_ADVERTISED_HOST || bindHost).trim().replace(/^\[|\]$/g, '');
  const remote = cdpUrl && !localHost(new URL(cdpUrl).hostname.replace(/^\[|\]$/g, '').toLowerCase());
  if (remote && (!env.CHROMIUM_PROXY_BIND_HOST || !env.CHROMIUM_PROXY_ADVERTISED_HOST || !env.CHROMIUM_PROXY_ALLOWED_CLIENT_IPS)) {
    throw new Error('Remote Chromium requires CHROMIUM_PROXY_BIND_HOST, CHROMIUM_PROXY_ADVERTISED_HOST and CHROMIUM_PROXY_ALLOWED_CLIENT_IPS');
  }
  if (!(net.isIP(bindHost) || bindHost === 'localhost')
    || !(net.isIP(advertisedHost) || /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(advertisedHost))) {
    throw new Error('Invalid Chromium policy proxy host');
  }
  const configured = String(env.CHROMIUM_PROXY_ALLOWED_CLIENT_IPS || '').split(',').map(value => value.trim()).filter(Boolean);
  const allowed = new Set(configured.length ? configured.map(canonicalizeRemoteAddress) : ['127.0.0.1', '::1']);
  if (allowed.has(null)) throw new Error('CHROMIUM_PROXY_ALLOWED_CLIENT_IPS must contain IP addresses');
  return { bindHost, advertisedHost, allowed };
}

// Reuse only the addresses approved by the destination check. Neither HTTP
// requests nor CONNECT tunnels perform a second DNS lookup after validation.
function pinnedLookup(addresses) {
  return (_hostname, options, callback) => {
    const records = addresses.map(address => ({ address, family: net.isIP(address) }));
    if (options?.all) callback(null, records);
    else callback(null, records[0].address, records[0].family);
  };
}

async function createChromiumPolicyProxy({ env = process.env, cdpUrl, assertDestination }) {
  const settings = proxySettings(env, cdpUrl);
  const sockets = new Set();
  let closed = false;
  const track = socket => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.once('close', () => sockets.delete(socket));
    return socket;
  };
  const admitted = socket => !closed && settings.allowed.has(canonicalizeRemoteAddress(socket.remoteAddress));
  const rejectSocket = (socket, code = 403) => {
    if (!socket.destroyed) socket.end(`HTTP/1.1 ${code} Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  };
  const destination = async value => {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Unsupported proxy destination');
    const addresses = await assertDestination(url.href, env);
    return { url, lookup: pinnedLookup(addresses) };
  };
  const requestOptions = ({ url, lookup }, req) => {
    const headers = { ...req.headers, host: url.host };
    delete headers['proxy-authorization'];
    delete headers['proxy-connection'];
    return { hostname: url.hostname.replace(/^\[|\]$/g, ''), port: url.port || 80,
      method: req.method, path: `${url.pathname}${url.search}`, headers, lookup,
      autoSelectFamily: true, agent: false };
  };
  const server = http.createServer(async (req, res) => {
    let outgoing;
    try {
      if (!admitted(req.socket)) throw new Error('Proxy client is not permitted');
      const target = await destination(req.url);
      if (closed || req.socket.destroyed || res.destroyed) return;
      // HTTPS is handled by CONNECT, keeping browser TLS validation intact.
      if (target.url.protocol !== 'http:') throw new Error('HTTPS requires CONNECT');
      outgoing = http.request(requestOptions(target, req), upstream => {
        if (res.destroyed) return upstream.destroy();
        res.writeHead(upstream.statusCode, upstream.headers);
        upstream.on('error', error => res.destroy(error));
        upstream.pipe(res);
      });
      outgoing.on('socket', track);
      outgoing.on('error', () => { if (!res.destroyed) res.destroy(); });
      req.on('error', () => outgoing.destroy());
      res.on('close', () => outgoing.destroy());
      req.pipe(outgoing);
    } catch (_) {
      // A policy rejection is a network failure, including for opaque no-cors
      // fetches. Allowed upstream HTTP error responses are forwarded above.
      res.destroy();
    }
  });
  server.on('connection', socket => {
    track(socket);
    if (!admitted(socket)) socket.destroy();
  });
  server.on('connect', async (req, socket, head) => {
    let upstream;
    try {
      if (!admitted(socket)) throw new Error('Proxy client is not permitted');
      const { url, lookup } = await destination(`https://${req.url}/`);
      if (closed || socket.destroyed) return;
      upstream = track(net.connect({ host: url.hostname.replace(/^\[|\]$/g, ''), port: Number(url.port || 443), lookup, autoSelectFamily: true }));
      socket.once('close', () => upstream.destroy());
      upstream.once('error', () => socket.destroy());
      upstream.once('connect', () => {
        if (closed || socket.destroyed) return upstream.destroy();
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length) upstream.write(head);
        socket.pipe(upstream).pipe(socket);
      });
    } catch (_) { upstream?.destroy(); rejectSocket(socket); }
  });
  server.on('upgrade', async (req, socket, head) => {
    let outgoing;
    try {
      if (!admitted(socket)) throw new Error('Proxy client is not permitted');
      const value = req.url.replace(/^ws:/i, 'http:');
      const target = await destination(value);
      if (target.url.protocol !== 'http:') throw new Error('Secure WebSockets require CONNECT');
      if (closed || socket.destroyed) return;
      outgoing = http.request(requestOptions(target, req));
      outgoing.on('socket', track);
      socket.once('close', () => outgoing.destroy());
      outgoing.once('error', () => socket.destroy());
      outgoing.once('response', response => { response.destroy(); rejectSocket(socket, 502); });
      outgoing.once('upgrade', (response, upstream, upstreamHead) => {
        track(upstream);
        if (closed || socket.destroyed) return upstream.destroy();
        const headers = Object.entries(response.headers).flatMap(([name, values]) => [].concat(values).map(value => `${name}: ${value}`));
        socket.write(`HTTP/1.1 101 Switching Protocols\r\n${headers.join('\r\n')}\r\n\r\n`);
        if (head.length) upstream.write(head);
        if (upstreamHead.length) socket.write(upstreamHead);
        socket.once('close', () => upstream.destroy());
        upstream.once('error', () => socket.destroy());
        socket.pipe(upstream).pipe(socket);
      });
      outgoing.end();
    } catch (_) { outgoing?.destroy(); rejectSocket(socket); }
  });
  server.on('clientError', (_error, socket) => socket.destroy());
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, settings.bindHost, () => { server.off('error', reject); resolve(); });
  });
  const advertised = net.isIP(settings.advertisedHost) === 6 ? `[${settings.advertisedHost}]` : settings.advertisedHost;
  let closing;
  return {
    proxyServer: `http://${advertised}:${server.address().port}`,
    proxyBypassList: ['<-loopback>'],
    close() {
      if (!closing) {
        closed = true;
        for (const socket of sockets) socket.destroy();
        closing = new Promise(resolve => server.close(resolve));
      }
      return closing;
    },
  };
}

module.exports = { createChromiumPolicyProxy, proxySettings };
