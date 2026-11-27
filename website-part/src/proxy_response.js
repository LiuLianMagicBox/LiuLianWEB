const { pipeline } = require('node:stream/promises');
const { createGunzip, createInflate, createBrotliDecompress } = require('node:zlib');
const { rewriteSetCookies, rewriteLocation, rewriteHtmlRootUrls } = require('./proxy_helpers');

function rewriteResponseHeaders(headers, req) {
  const target = req.connectionOriginalTargetUrl || req.connectionTarget.target_url;
  if (headers['set-cookie']) {
    headers['set-cookie'] = headers['set-cookie'].flatMap(cookie =>
      rewriteSetCookies(cookie, req.params.slug, target, req.websiteSessionCookieName));
  }
  if (headers.location) {
    headers.location = rewriteLocation(headers.location, target, req.params.slug, req.connectionUpstreamRequestUrl);
  }
}

const decoders = { gzip: createGunzip, deflate: createInflate, br: createBrotliDecompress };

async function forwardProxyResponse(upstream, req, res) {
  const cancel = () => { if (!res.writableFinished) upstream.destroy(); };
  res.once('close', cancel);
  try {
    if (res.destroyed) return upstream.destroy();
    const headers = { ...upstream.headers };
    rewriteResponseHeaders(headers, req);
    const hopHeaders = ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
      'proxy-connection', 'te', 'trailer', 'transfer-encoding', 'upgrade'];
    for (const token of String(headers.connection || '').split(',')) hopHeaders.push(token.trim().toLowerCase());
    for (const name of hopHeaders) delete headers[name];
    const encoding = String(headers['content-encoding'] || 'identity').toLowerCase();
    const html = /^text\/html(?:\s*;|\s*$)/i.test(headers['content-type'] || '');
    const transformHtml = html && !/^attachment\b/i.test(headers['content-disposition'] || '')
      && ![204, 205, 206, 304].includes(upstream.statusCode)
      && (encoding === 'identity' || Object.hasOwn(decoders, encoding));
    const rewrite = transformHtml && req.method !== 'HEAD';

    if (/^text\/event-stream(?:\s*;|\s*$)/i.test(headers['content-type'] || '')) {
      upstream.setTimeout(0);
      res.setTimeout(0);
      headers['x-accel-buffering'] = 'no';
    }
    if (transformHtml) {
      for (const name of ['content-encoding', 'content-length', 'etag', 'content-md5', 'digest', 'accept-ranges']) delete headers[name];
      headers['cache-control'] = 'no-store';
    }

    let body;
    if (rewrite) {
      const chunks = [];
      const transforms = encoding === 'identity' ? [] : [decoders[encoding]()];
      await pipeline(upstream, ...transforms, async source => {
        for await (const chunk of source) chunks.push(chunk);
      });
      body = Buffer.from(rewriteHtmlRootUrls(Buffer.concat(chunks).toString('utf8'), req.params.slug,
        req.connectionUpstreamRequestUrl || req.url, req.connectionProxyUsesUpstreamRoot,
        req.connectionOriginalTargetUrl || req.connectionTarget.target_url));
      headers['content-length'] = String(body.length);
    }
    if (res.destroyed) return;
    res.statusCode = upstream.statusCode;
    if (upstream.statusMessage) res.statusMessage = upstream.statusMessage;
    for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
    if (rewrite) return res.end(body);
    res.flushHeaders();
    await pipeline(upstream, res);
  } catch {
    if (res.destroyed) return;
    if (res.headersSent) return res.destroy();
    res.status(502).send('The target website is unavailable');
  } finally {
    res.off('close', cancel);
  }
}

module.exports = { forwardProxyResponse, rewriteResponseHeaders };
