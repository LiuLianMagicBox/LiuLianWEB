const DEFAULT_PORT = 3000;
const MAX_PORT = 65535;

function parsePort(value) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return DEFAULT_PORT;
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > MAX_PORT) {
    throw new Error(`PORT must be an integer between 0 and ${MAX_PORT}`);
  }
  return port;
}

function buildListenOptions(env = process.env) {
  const options = { port: parsePort(env.PORT) };
  const bindIp = env.BIND_IP?.trim();

  if (bindIp) options.host = bindIp;

  return options;
}

function buildTrustProxy(env = process.env, secure = false) {
  const value = env.TRUST_PROXY?.trim();
  if (!value) return secure ? 1 : false;
  if (value === 'false' || value === '0') return false;
  if (/^\d+$/.test(value)) return Number(value);
  if (value === 'true') throw new Error('TRUST_PROXY must specify trusted hops or proxy IP/CIDR ranges');
  return value.split(',').map(item => item.trim()).filter(Boolean);
}

module.exports = { buildListenOptions, parsePort, buildTrustProxy };
