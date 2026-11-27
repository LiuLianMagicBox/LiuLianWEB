const { AppError, InputError } = require('../errors');

function mailConfig(env = process.env) {
  if (!env.MAILU_API_URL || !env.MAILU_API_TOKEN || !env.MAILU_DOMAIN || !env.MAILU_WEBMAIL_URL) return null;
  const api = new URL(env.MAILU_API_URL);
  const webmail = new URL(env.MAILU_WEBMAIL_URL);
  if ([api, webmail].some(url => url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)) {
    throw new Error('Mailu URLs must use HTTPS without credentials, query or fragment');
  }
  const domain = env.MAILU_DOMAIN.toLowerCase();
  if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(domain)) throw new Error('Invalid MAILU_DOMAIN');
  const quotaBytes = Number(env.MAILU_QUOTA_BYTES || 1073741824);
  if (!Number.isSafeInteger(quotaBytes) || quotaBytes < 1048576) throw new Error('Invalid MAILU_QUOTA_BYTES');
  return { apiUrl: api.href.replace(/\/$/, ''), token: env.MAILU_API_TOKEN, domain, webmailUrl: webmail.href, quotaBytes };
}

const RESERVED = new Set(['admin', 'administrator', 'root', 'postmaster', 'abuse', 'hostmaster', 'webmaster', 'mailer-daemon', 'noreply', 'no-reply', 'dmarc', 'security', 'support']);
function validateMailbox(input) {
  const localpart = typeof input?.localpart === 'string' ? input.localpart.trim().toLowerCase() : '';
  if (!/^[a-z0-9](?:[a-z0-9._-]{1,30}[a-z0-9])$/.test(localpart) || localpart.includes('..')) {
    throw new InputError('Use 3–32 letters, numbers, dots, hyphens or underscores; start and end with a letter or number.');
  }
  if (RESERVED.has(localpart)) throw new InputError('This mailbox name is reserved.');
  const password = input.password;
  if (typeof password !== 'string' || password.length < 12 || password.length > 128 || /[\x00-\x1f\x7f]/.test(password)) {
    throw new InputError('Use a mailbox password of 12–128 characters.');
  }
  if (input.confirmPassword !== password) throw new InputError('Mailbox passwords do not match.');
  return { localpart, password };
}

function createMailuClient(config, fetchImpl = globalThis.fetch) {
  async function request(path, options = {}) {
    let response;
    try {
      response = await fetchImpl(`${config.apiUrl}${path}`, {
        ...options, redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
      });
      if (response.status === 404 && options.method !== 'POST') return null;
      if (response.status === 409) throw new AppError('This mailbox name is unavailable or the mail server is full.', 409, 'MAIL_CONFLICT');
      if (!response.ok) throw new Error('Upstream error');
      return await response.json();
    } catch (err) {
      if (err instanceof AppError) throw err;
      // Never propagate upstream bodies, credentials, password hashes or fetch errors.
      throw new AppError('Mail service is temporarily unavailable. Please retry.', 503, 'MAIL_UNAVAILABLE');
    }
  }
  return {
    getUser: email => request(`/user/${encodeURIComponent(email)}`),
    getAlias: email => request(`/alias/${encodeURIComponent(email)}`),
    createUser: (row, password) => request('/user', {
      method: 'POST', body: JSON.stringify({
        email: row.email, raw_password: password, comment: `LiuLianWEB:${row.provision_id}`,
        quota_bytes: config.quotaBytes, global_admin: false, enabled: true,
        change_pw_next_login: false, enable_imap: true, enable_pop: false,
        allow_spoofing: false, forward_enabled: false, reply_enabled: false, spam_enabled: true,
      }),
    }),
  };
}

module.exports = { mailConfig, validateMailbox, createMailuClient };
