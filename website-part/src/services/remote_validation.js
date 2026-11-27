const dns = require('dns').promises;
const net = require('net');

class RemoteInputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RemoteInputError';
    this.statusCode = 400;
  }
}

function requiredText(value, label, maxLength) {
  if (typeof value !== 'string') throw new RemoteInputError(`${label} must be a string`);
  const result = value.trim();
  if (!result) throw new RemoteInputError(`${label} is required`);
  if (result.length > maxLength) throw new RemoteInputError(`${label} is too long`);
  if (/[\r\n\0]/.test(result)) throw new RemoteInputError(`${label} contains invalid characters`);
  return result;
}

function normalizeHost(value) {
  const host = requiredText(value, 'Host', 253);
  if (net.isIP(host)) return canonicalizeRemoteAddress(host);
  // getaddrinfo accepts inet_aton forms such as 192.168.1.010, 127.1 and
  // 0x7f000001. A CIDR comparison must never interpret those as decimal DNS
  // names while the connector interprets them as octal/hexadecimal addresses.
  if (/^(?:\d+|0x[\da-f]+)(?:\.(?:\d+|0x[\da-f]+))*\.?$/i.test(host)) {
    throw new RemoteInputError('Numeric hosts must use canonical IPv4 notation');
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(host)) {
    throw new RemoteInputError('Host contains invalid characters');
  }
  return host;
}

function normalizePort(value, defaultPort) {
  const port = value === undefined || value === '' ? defaultPort : Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new RemoteInputError('Port must be between 1 and 65535');
  }
  return port;
}

function normalizeRdpInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new RemoteInputError('Invalid RDP connection data');
  }
  return {
    host: normalizeHost(input.host),
    port: normalizePort(input.port, 3389),
    username: requiredText(input.username, 'Username', 256),
    domain: input.domain === undefined || input.domain === ''
      ? ''
      : requiredText(input.domain, 'Domain', 256),
  };
}

function normalizeWebRdpInput(input) {
  const connection = normalizeRdpInput(input);
  if (!input || typeof input.password !== 'string' || !input.password.trim()) {
    throw new RemoteInputError('Password is required');
  }
  if (input.password.length > 512 || /[\r\n\0]/.test(input.password)) {
    throw new RemoteInputError('Password contains invalid characters');
  }
  return { ...connection, password: input.password };
}

function allowedSshHosts(value = process.env.SSH_ALLOWED_HOSTS) {
  return new Set(String(value || '').split(',').map(host => host.trim().toLowerCase()).filter(Boolean));
}

function ipv4Number(value) {
  const text = String(value);
  if (net.isIP(text) !== 4) return null;
  const parts = text.split('.');
  const numbers = parts.map(Number);
  return (((numbers[0] * 256 + numbers[1]) * 256 + numbers[2]) * 256 + numbers[3]) >>> 0;
}

function cidrMatches(host, cidr) {
  const parts = String(cidr).split('/');
  if (parts.length !== 2 || !/^\d{1,2}$/.test(parts[1])) return false;
  const [network, prefixText] = parts;
  const prefix = Number(prefixText);
  const hostNumber = ipv4Number(host);
  const networkNumber = ipv4Number(network);
  if (hostNumber === null || networkNumber === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (hostNumber & mask) === (networkNumber & mask);
}

function assertAllowedSshHost(host, allowedHosts = allowedSshHosts()) {
  assertAllowedRemoteHost(host, allowedHosts);
}

function allowedRemoteHosts(value) {
  return new Set(String(value || '').split(',').map(host => host.trim().toLowerCase()).filter(Boolean));
}

function assertAllowedRemoteHost(host, allowedHosts) {
  const safeHost = normalizeHost(host);
  const normalized = canonicalizeRemoteAddress(safeHost) || safeHost.toLowerCase();
  const allowed = [...allowedHosts].some(entry =>
    (canonicalizeRemoteAddress(entry) || entry.toLowerCase()) === normalized || cidrMatches(normalized, entry));
  if (allowedHosts.size > 0 && !allowed) {
    throw new RemoteInputError('This SSH host is not permitted');
  }
}

function canonicalizeRemoteAddress(address) {
  if (typeof address !== 'string') return null;
  if (net.isIP(address) === 4) return address;
  if (net.isIP(address) !== 6) return null;
  const [literal, zone] = address.split('%');
  const canonical = new URL(`http://[${literal}]/`).hostname.slice(1, -1);
  const mapped = canonical.match(/^::ffff:([a-f0-9]+):([a-f0-9]+)$/i);
  if (!mapped) return canonical + (zone ? `%${zone}` : '');
  const high = parseInt(mapped[1], 16);
  const low = parseInt(mapped[2], 16);
  return [high >>> 8, high & 255, low >>> 8, low & 255].join('.');
}

function isPrivateAddress(value) {
  const address = canonicalizeRemoteAddress(value)?.split('%', 1)[0];
  if (!address) return true;
  if (net.isIP(address) === 6) {
    const prefix = parseInt(address.split(':', 1)[0], 16);
    return address === '::' || address === '::1' || (prefix >= 0xfc00 && prefix <= 0xfdff)
      || (prefix >= 0xfe80 && prefix <= 0xfebf);
  }
  return cidrMatches(address, '0.0.0.0/8') || cidrMatches(address, '10.0.0.0/8') || cidrMatches(address, '172.16.0.0/12')
    || cidrMatches(address, '192.168.0.0/16') || cidrMatches(address, '127.0.0.0/8')
    || cidrMatches(address, '169.254.0.0/16') || cidrMatches(address, '100.64.0.0/10');
}

async function assertResolvedRemoteHost(host, allowedHosts, { allowPrivate = false } = {}) {
  const safeHost = normalizeHost(host);
  assertAllowedRemoteHost(safeHost, allowedHosts);
  const hostnameGranted = !net.isIP(safeHost) && [...allowedHosts].some(entry => entry.toLowerCase() === safeHost.toLowerCase());
  const resolved = net.isIP(safeHost) ? [safeHost] : (await dns.lookup(safeHost, { all: true })).map(result => result.address);
  const addresses = [...new Set(resolved.map(canonicalizeRemoteAddress))];
  if (!addresses.length || addresses.includes(null) || (!allowPrivate && addresses.some(isPrivateAddress))) {
    throw new RemoteInputError('Private or unresolved remote destinations are not permitted');
  }
  // A hostname grant intentionally authorizes that name's DNS answers. IP/CIDR
  // grants authorize only the canonical addresses actually returned to callers.
  if (allowedHosts.size > 0 && !hostnameGranted) {
    for (const address of addresses) assertAllowedRemoteHost(address, allowedHosts);
  }
  return addresses;
}

module.exports = {
  RemoteInputError,
  normalizeHost,
  normalizePort,
  normalizeRdpInput,
  normalizeWebRdpInput,
  allowedSshHosts,
  cidrMatches,
  assertAllowedSshHost,
  allowedRemoteHosts,
  assertAllowedRemoteHost,
  assertResolvedRemoteHost,
  canonicalizeRemoteAddress,
  isPrivateAddress,
};
