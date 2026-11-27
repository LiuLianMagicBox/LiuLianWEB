function referrerConnectionSlug(req) {
  const header = req.get('referer') || req.get('referrer');
  if (!header) return null;

  try {
    const host = req.get('host');
    const referrer = new URL(header, `${req.protocol}://${host || 'localhost'}`);
    if (host && referrer.host !== host) return null;
    const match = referrer.pathname.match(
      /^\/connect\/([a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?)(?=\/|$)/i
    );
    return match ? match[1].toLowerCase() : null;
  } catch (_) {
    return null;
  }
}

function getUpstreamCookies(cookieHeader, slug, sessionCookieName = process.env.SESSION_COOKIE_NAME || 'connect.sid') {
  if (!cookieHeader) return '';
  const prefix = `llb_${slug}_`;
  return cookieHeader
    .split(';')
    .map(part => part.trim())
    .filter(part => {
      const separator = part.indexOf('=');
      if (separator < 1) return false;
      const name = part.slice(0, separator);
      if (name === sessionCookieName || name === 'connect.sid') return false;
      if (part.startsWith(prefix)) return true;
      return !/^llb_[a-z0-9-]+_/i.test(part);
    })
    .map(part => part.startsWith(prefix) ? part.slice(prefix.length) : part)
    .join('; ');
}

function cookieProxyPaths(upstreamPath, slug, targetUrl) {
  const proxyBase = `/connect/${slug}`;
  const targetPath = new URL(targetUrl).pathname.replace(/\/$/, '');
  const normalizedPath = upstreamPath.startsWith('/') ? upstreamPath : `/${upstreamPath}`;
  // A root cookie covers both the mounted app and its upstream-root alias.
  if (normalizedPath === '/') return [`${proxyBase}/`];
  const rootPath = `${proxyBase}/__upstream_root__${normalizedPath}`;
  const withinTarget = !targetPath || normalizedPath === targetPath || normalizedPath.startsWith(`${targetPath}/`);
  if (!withinTarget) return [rootPath];
  const mountedPath = `${proxyBase}${normalizedPath.slice(targetPath.length) || '/'}`;
  // Absolute links can reach the same upstream path through either alias.
  // Keep narrow cookies on both paths, including expiry/deletion attributes.
  const mountedCoversRoot = rootPath === mountedPath || rootPath.startsWith(`${mountedPath.replace(/\/$/, '')}/`);
  return mountedCoversRoot ? [mountedPath] : [mountedPath, rootPath];
}

function rewriteSetCookies(cookie, slug, targetUrl, sessionCookieName = process.env.SESSION_COOKIE_NAME || 'connect.sid') {
  const proxyBase = `/connect/${slug}`;
  const parts = cookie.split(';').map(part => part.trim());
  const [nameValue, ...attributes] = parts;
  const separator = nameValue.indexOf('=');
  const name = nameValue.slice(0, separator);
  // Rename reserved session names, while preserving other cookie names that
  // upstream JavaScript reads through document.cookie. Paths isolate those.
  const reserved = name === sessionCookieName || name === 'connect.sid'
    || /^llb_[a-z0-9-]+_/i.test(name) || /^__Host-/i.test(name);
  const rewritten = [reserved ? `llb_${slug}_${nameValue}` : nameValue];
  let paths = [`${proxyBase}/`];
  let pathIndex = -1;

  for (const part of attributes) {
    if (/^domain=/i.test(part)) continue;
    if (/^path=/i.test(part)) {
      const upstreamPath = part.slice(part.indexOf('=') + 1).trim();
      paths = cookieProxyPaths(upstreamPath, slug, targetUrl);
      if (pathIndex < 0) pathIndex = rewritten.push(`Path=${paths[0]}`) - 1;
    } else {
      rewritten.push(part);
    }
  }

  if (pathIndex < 0) pathIndex = rewritten.push(`Path=${paths[0]}`) - 1;
  return paths.map(path => {
    const attributes = [...rewritten];
    attributes[pathIndex] = `Path=${path}`;
    return attributes.join('; ');
  });
}

function rewriteSetCookie(cookie, slug, targetUrl, sessionCookieName) {
  return rewriteSetCookies(cookie, slug, targetUrl, sessionCookieName)[0];
}

function effectivePort(url) {
  if (url.port) return url.port;
  if (url.protocol === 'https:') return '443';
  if (url.protocol === 'http:') return '80';
  return '';
}

function isLoopbackHostname(hostname) {
  const normalized = hostname.toLowerCase();
  return normalized === 'localhost'
    || normalized === '127.0.0.1'
    || normalized === '::1'
    || normalized === '[::1]';
}

function isSameUpstreamOrigin(target, redirected) {
  if (redirected.origin === target.origin) return true;

  return redirected.protocol === target.protocol
    && effectivePort(redirected) === effectivePort(target)
    && isLoopbackHostname(redirected.hostname);
}

function rewriteLocation(location, targetUrl, slug, requestUrl = targetUrl) {
  if (!location) return location;

  try {
    const target = new URL(targetUrl);
    const redirected = new URL(location, requestUrl);
    if (!isSameUpstreamOrigin(target, redirected)) return location;

    const targetPath = target.pathname.replace(/\/$/, '');
    const withinTargetPath = !targetPath
      || redirected.pathname === targetPath
      || redirected.pathname.startsWith(`${targetPath}/`);
    if (!withinTargetPath) {
      return `/connect/${slug}/__upstream_root__${redirected.pathname}${redirected.search}${redirected.hash}`;
    }

    const path = redirected.pathname.slice(targetPath.length) || '/';
    return `/connect/${slug}${path}${redirected.search}${redirected.hash}`;
  } catch (_) {
    return location;
  }
}

function rewriteHtmlAssetUrl(value, slug, requestUrl = '/', upstreamRoot = false, targetUrl) {
  if (!value
    || value.startsWith('#')
    || value.startsWith('//')
    || value.startsWith('/connect/')
    || /^[a-z][a-z0-9+.-]*:/i.test(value)) {
    return value;
  }

  if (value.startsWith('/')) {
    return `/connect/${slug}/__upstream_root__${value}`;
  }

  if (targetUrl) return rewriteLocation(value, targetUrl, slug, requestUrl);

  try {
    const resolved = new URL(value, `http://upstream.local${requestUrl || '/'}`);
    return `/connect/${slug}${upstreamRoot ? '/__upstream_root__' : ''}${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch (_) {
    return value;
  }
}

function rewriteHtmlRootUrls(html, slug, requestUrl = '/', upstreamRoot = false, targetUrl) {
  if (!html) return html;
  return html.replace(
    /\b(src|href|action|poster)=("|')([^"']*)\2/gi,
    (_, attribute, quote, value) =>
      `${attribute}=${quote}${rewriteHtmlAssetUrl(value, slug, requestUrl, upstreamRoot, targetUrl)}${quote}`
  );
}

module.exports = {
  referrerConnectionSlug,
  getUpstreamCookies,
  rewriteSetCookie,
  rewriteSetCookies,
  rewriteLocation,
  rewriteHtmlRootUrls,
};
