// Per-account login throttle. The IP rate limiter in `auth_rate_limit.js`
// already caps total attempts from one address; this layer additionally counts
// failed attempts for a username so a botnet spreading guesses across many IPs
// still hits a wall. A successful login clears the counter, and only failed
// (401) responses count, which keeps accidental lockouts unlikely.
const DEFAULT_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_LIMIT = 10;
const MAX_TRACKED_ACCOUNTS = 5000;
const { AccountInputError, normalizeUsername } = require('../services/account_validation');

function accountKey(req) {
  if (req.loginAccountKey !== undefined) return req.loginAccountKey;
  const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
  return username ? `name:${username.normalize('NFKC').toLowerCase()}` : '';
}

function resolveLoginAccount({ findUser = require('../db/users').findUserByUsername } = {}) {
  return async (req, _res, next) => {
    try {
      let username;
      try {
        username = normalizeUsername(req.body?.username);
      } catch (err) {
        if (!(err instanceof AccountInputError)) throw err;
        req.loginAccountKey = '';
        return next();
      }
      // Database collation also treats accents and other spelling variants as
      // equal. Resolve once and share the canonical identity with login itself.
      req.loginUser = await findUser(username);
      req.loginAccountKey = req.loginUser ? `user:${req.loginUser.id}` : accountKey(req);
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

function createLoginThrottle({
  windowMs = DEFAULT_WINDOW_MS,
  limit = DEFAULT_LIMIT,
  now = Date.now,
} = {}) {
  const failures = new Map();

  function prune(current) {
    if (failures.size <= MAX_TRACKED_ACCOUNTS) return;
    for (const [key, entry] of failures) {
      if (current - entry.start >= windowMs) failures.delete(key);
    }
  }

  function middleware(req, res, next) {
    const key = accountKey(req);
    const current = now();
    const entry = key ? failures.get(key) : undefined;

    if (entry && current - entry.start < windowMs && entry.count >= limit) {
      const retryAfter = Math.ceil((entry.start + windowMs - current) / 1000);
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({
        error: 'Too many failed login attempts for this account. Please try again later.',
      });
    }

    if (key && typeof res.on === 'function') {
      res.on('finish', () => {
        if (res.statusCode === 200) {
          failures.delete(key);
          return;
        }
        if (res.statusCode !== 401) return;
        const stamp = now();
        const existing = failures.get(key);
        if (!existing || stamp - existing.start >= windowMs) {
          failures.set(key, { start: stamp, count: 1 });
        } else {
          existing.count += 1;
        }
        prune(stamp);
      });
    }

    return next();
  }

  middleware.reset = () => failures.clear();
  middleware.size = () => failures.size;

  return middleware;
}

module.exports = {
  createLoginThrottle,
  resolveLoginAccount,
  accountKey,
  DEFAULT_WINDOW_MS,
  DEFAULT_LIMIT,
};
