const callbackPromise = fn => new Promise((resolve, reject) => {
  fn(err => (err ? reject(err) : resolve()));
});

async function establishUserSession(req, user, maxAge = null) {
  if (!req.session) {
    throw new Error('Session middleware is unavailable');
  }
  await callbackPromise(callback => req.session.regenerate(callback));
  req.session.cookie.maxAge = maxAge;
  req.session.user = { id: user.id, username: user.username, sessionVersion: Number(user.session_version || 0) };
  req.session.deviceLabel = deviceLabel(req.headers?.['user-agent']);
  try {
    await callbackPromise(callback => req.session.save(callback));
  } catch (err) {
    await callbackPromise(callback => req.session.destroy(callback)).catch(() => {});
    throw err;
  }
}

function deviceLabel(agent = '') {
  const browser = /Edg(?:A|iOS)?\//i.test(agent) ? 'Edge' : /(?:Firefox|FxiOS)\//i.test(agent) ? 'Firefox'
    : /(?:Chrome|CriOS|Chromium)\//i.test(agent) ? 'Chrome' : /Safari\//i.test(agent) ? 'Safari' : '';
  const platform = /Android/i.test(agent) ? 'Android' : /iPhone|iPad/i.test(agent) ? 'iOS'
    : /Windows/i.test(agent) ? 'Windows' : /Macintosh|Mac OS X/i.test(agent) ? 'macOS' : /Linux/i.test(agent) ? 'Linux' : '';
  return [browser, platform].filter(Boolean).join(' · ') || null;
}

async function revokeOtherUserSessions(req, userId, sessionVersion) {
  if (sessionVersion !== undefined) {
    req.session.user.sessionVersion = sessionVersion;
    await callbackPromise(callback => req.session.save(callback));
  }
  if (typeof req.sessionStore?.destroyUserSessions !== 'function') return;
  await callbackPromise(callback => {
    req.sessionStore.destroyUserSessions(userId, req.sessionID, callback);
  });
}

module.exports = { establishUserSession, revokeOtherUserSessions, deviceLabel };
