const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const http = require('node:http');
const { EventEmitter } = require('node:events');
const { createRequire } = require('node:module');
const express = require('express');

test('cancelled scans release all eight storage slots and allow a later ZIP download', { timeout: 5000 }, async () => {
  let ended = 0;
  let scanStarted;
  let settled;
  const directory = { mtime: 1700000000, isDirectory: () => true, isFile: () => false, isSymbolicLink: () => false };
  const sftp = {
    realpath: (target, done) => done(null, target),
    lstat: (_target, done) => done(null, directory),
    stat: (_target, done) => done(null, directory),
    readdir: (_target, done) => {
      scanStarted?.();
      setTimeout(() => done(null, []), 25);
    },
  };
  class Client extends EventEmitter {
    connect() { queueMicrotask(() => this.emit('ready')); }
    sftp(done) { done(null, sftp); }
    end() { ended++; this.emit('close'); }
  }
  const filename = require.resolve('../src/services/file_storage');
  const sourceRequire = createRequire(filename);
  const context = { module: { exports: {} }, Buffer, AbortController,
    require: name => name === 'ssh2' ? { Client } : sourceRequire(name) };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  const storage = context.module.exports.createStorage({
    FILES_SFTP_HOST: 'fixture', FILES_SFTP_USER: 'fixture', FILES_SFTP_PASSWORD: 'fixture',
    FILES_SFTP_HOST_SHA256: 'a'.repeat(64),
  });
  const app = express();
  app.get('/archive', async (_req, res) => {
    try { await storage.archive(['vol1/share'], res); }
    catch (error) { if (!res.destroyed) res.status(error.statusCode || 500).json({ error: error.message }); }
    finally { settled?.(); }
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}/archive`;
  try {
    for (let index = 0; index < 8; index++) {
      const scanning = new Promise(resolve => { scanStarted = resolve; });
      const complete = new Promise(resolve => { settled = resolve; });
      const request = http.get(url);
      request.on('error', () => {});
      await scanning;
      request.destroy();
      await complete;
    }
    assert.equal(ended, 8, 'every cancelled scan closes its SFTP client');
    scanStarted = settled = null;
    const response = await fetch(url);
    assert.equal(response.status, 200);
    const archive = Buffer.from(await response.arrayBuffer());
    assert.equal(archive.readUInt32LE(archive.length - 22), 0x06054b50);
    assert.equal(ended, 9, 'a later successful archive also releases its slot');
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
