const { isIP } = require('node:net');
const { AppError, InputError } = require('../errors');

function netbirdConfig(env = process.env) {
  const token = env.NETBIRD_API_TOKEN?.trim();
  if (!token) return null;
  let url;
  try { url = new URL(env.NETBIRD_API_URL || 'https://api.netbird.io/api'); } catch { /* validated below */ }
  if (!url || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
      || !url.pathname.replace(/\/+$/, '').endsWith('/api') || /[\s\x00-\x1f\x7f]/.test(token)) {
    throw new Error('Invalid NetBird configuration: use an HTTPS API URL ending in /api and a valid token');
  }
  return { apiUrl: url.href.replace(/\/+$/, ''), token };
}

function identifier(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(value)) throw new InputError('Invalid NetBird ID.');
  return value;
}
function text(value, max, required = true) {
  if (!required && value === undefined) return '';
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim()) || /[\x00-\x1f\x7f]/.test(value)) {
    throw new InputError('Invalid NetBird name, description or address.');
  }
  return value.trim();
}
function bool(value) {
  if (typeof value !== 'boolean') throw new InputError('NetBird switches must be true or false.');
  return value;
}
function ids(value) {
  if (!Array.isArray(value) || value.length > 100) throw new InputError('Select up to 100 NetBird groups.');
  return [...new Set(value.map(identifier))];
}
function resourceAddress(value) {
  const address = text(value, 253);
  const [host, prefix, ...rest] = address.split('/');
  const family = isIP(host);
  if (family && !rest.length && (prefix === undefined || (/^\d{1,3}$/.test(prefix) && Number(prefix) <= (family === 4 ? 32 : 128)))) return address;
  if (!address.includes('/') && /^(?:\*\.)?(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(address)) return address;
  throw new InputError('Use an IP address, CIDR subnet or domain for the resource.');
}

const fields = {
  peers: ['name', 'ssh_enabled', 'login_expiration_enabled', 'inactivity_expiration_enabled', 'approval_required'],
  networks: ['name', 'description'],
  resources: ['name', 'description', 'address', 'enabled', 'groups'],
  routers: ['peer', 'peer_groups', 'metric', 'masquerade', 'enabled'],
};
function validate(kind, body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !fields[kind].includes(key))) {
    throw new InputError('Unsupported NetBird fields.');
  }
  if (kind === 'peers') return {
    name: text(body.name, 253), ssh_enabled: bool(body.ssh_enabled),
    login_expiration_enabled: bool(body.login_expiration_enabled), inactivity_expiration_enabled: bool(body.inactivity_expiration_enabled),
    ...(body.approval_required === undefined ? {} : { approval_required: bool(body.approval_required) }),
  };
  if (kind === 'networks') return { name: text(body.name, 100), description: text(body.description, 1000, false) };
  if (kind === 'resources') return {
    name: text(body.name, 100), description: text(body.description, 1000, false),
    address: resourceAddress(body.address), enabled: bool(body.enabled), groups: ids(body.groups),
  };
  if (body.peer !== undefined && body.peer_groups !== undefined) throw new InputError('Select one routing peer or one or more peer groups.');
  if (Boolean(body.peer) === Boolean(body.peer_groups?.length)) throw new InputError('Select one routing peer or one or more peer groups.');
  if (!Number.isInteger(body.metric) || body.metric < 1 || body.metric > 9999) throw new InputError('Route metric must be between 1 and 9999.');
  return {
    ...(body.peer ? { peer: identifier(body.peer) } : { peer_groups: ids(body.peer_groups) }),
    metric: body.metric, masquerade: bool(body.masquerade), enabled: bool(body.enabled),
  };
}

const unavailable = () => new AppError('NetBird is unavailable or the result is uncertain. Refresh before retrying changes.', 503, 'NETBIRD_UNAVAILABLE');
function createNetbirdClient(config, fetchImpl = globalThis.fetch) {
  return {
    async request(path, method = 'GET', body) {
      try {
        const response = await fetchImpl(config.apiUrl + path, {
          method, redirect: 'error', signal: AbortSignal.timeout(15000),
          headers: { Authorization: `Token ${config.token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        if (!response.ok) {
          await response.body?.cancel();
          const errors = {
            400: [400, 'NetBird rejected these settings. Check the selected peers, groups and addresses.', 'NETBIRD_INVALID'],
            401: [502, 'NetBird API token is invalid or expired.', 'NETBIRD_AUTH'],
            403: [502, 'NetBird API token does not have permission for this operation.', 'NETBIRD_PERMISSION'],
            404: [404, 'NetBird item or API endpoint was not found. Refresh the list.', 'NETBIRD_NOT_FOUND'],
            409: [409, 'NetBird reports a conflict. Refresh before retrying.', 'NETBIRD_CONFLICT'],
            422: [400, 'NetBird rejected these settings. Check the selected peers, groups and addresses.', 'NETBIRD_INVALID'],
            429: [503, 'NetBird rate limit reached. Please try again later.', 'NETBIRD_RATE_LIMIT'],
          };
          const error = errors[response.status];
          if (error) throw new AppError(error[1], error[0], error[2]);
          throw unavailable();
        }
        // DELETE may return 200 with an empty body or 204. It needs no JSON.
        if (method === 'DELETE') { await response.body?.cancel(); return null; }
        const chunks = [];
        let size = 0;
        for await (const chunk of response.body) {
          size += chunk.length;
          if (size > 2 * 1024 * 1024) throw unavailable();
          chunks.push(chunk);
        }
        return JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch (error) {
        if (error instanceof AppError) throw error;
        // Neither upstream bodies nor fetch errors may expose the server token.
        throw unavailable();
      }
    },
  };
}

const outputFields = {
  peers: [...fields.peers, 'id', 'ip', 'ipv6', 'connected', 'last_seen', 'os', 'version', 'hostname', 'dns_label'],
  networks: [...fields.networks, 'id', 'routing_peers_count'],
  groups: ['id', 'name'],
  resources: ['id', 'name', 'description', 'address', 'enabled', 'type'],
  routers: ['id', 'peer', 'metric', 'masquerade', 'enabled'],
};
function project(kind, item) {
  if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item.id !== 'string') throw unavailable();
  const result = Object.fromEntries(outputFields[kind].filter(key => ['string', 'boolean', 'number'].includes(typeof item[key])).map(key => [key, item[key]]));
  if (kind === 'resources' || kind === 'peers') result.groups = (item.groups || []).map(group => project('groups', group));
  if (kind === 'routers') result.peer_groups = (item.peer_groups || []).filter(id => typeof id === 'string');
  return result;
}
module.exports = { netbirdConfig, createNetbirdClient, identifier, validate, project };
