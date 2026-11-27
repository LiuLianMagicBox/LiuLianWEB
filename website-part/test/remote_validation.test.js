const test = require('node:test');
const assert = require('node:assert/strict');
const {
  RemoteInputError,
  normalizeHost,
  normalizeRdpInput,
  normalizeWebRdpInput,
  assertAllowedSshHost,
  cidrMatches,
  canonicalizeRemoteAddress,
  isPrivateAddress,
  assertResolvedRemoteHost,
} = require('../src/services/remote_validation');
const { rdpFile } = require('../src/routes/rdp');

test('normalizes RDP connection details and rejects line injection', () => {
  assert.deepEqual(normalizeRdpInput({
    host: ' Windows.Example.com ', port: '3389', username: ' administrator ', domain: ' CONTOSO ',
  }), {
    host: 'Windows.Example.com', port: 3389, username: 'administrator', domain: 'CONTOSO',
  });
  assert.throws(
    () => normalizeRdpInput({ host: 'server\r\nusername:s:attacker', username: 'admin' }),
    RemoteInputError
  );
});

test('WebRDP input requires a transient password and preserves it without trimming', () => {
  assert.deepEqual(normalizeWebRdpInput({
    host: 'server.example.com', port: 3389, username: 'admin', password: ' pass ', domain: '',
  }), {
    host: 'server.example.com', port: 3389, username: 'admin', password: ' pass ', domain: '',
  });
  assert.throws(() => normalizeWebRdpInput({ host: 'server.example.com', username: 'admin' }), RemoteInputError);
  assert.throws(() => normalizeWebRdpInput({ host: 'server.example.com', username: 'admin', password: 'x\r\n' }), RemoteInputError);
});

test('SSH host allow list only permits configured hosts', () => {
  const allowed = new Set(['server.example.com']);
  assert.doesNotThrow(() => assertAllowedSshHost('SERVER.EXAMPLE.COM', allowed));
  assert.throws(() => assertAllowedSshHost('other.example.com', allowed), RemoteInputError);
});

test('SSH host allow list supports IPv4 CIDR ranges for server local networks', () => {
  assert.equal(cidrMatches('192.168.50.24', '192.168.50.0/24'), true);
  assert.equal(cidrMatches('192.168.51.24', '192.168.50.0/24'), false);
  assert.doesNotThrow(() => assertAllowedSshHost('10.20.30.40', new Set(['10.0.0.0/8'])));
});

test('numeric host spellings cannot disagree with OS octal, hex or shortened IPv4 parsing', async t => {
  const lookup = t.mock.method(require('node:dns').promises, 'lookup', async () => [{ address: '192.168.1.8', family: 4 }]);
  const allowed = new Set(['192.168.1.10/32']);
  for (const host of ['192.168.1.010', '127.1', '0177.0.0.1', '2130706433', '0x7f000001',
    '0X7F.0.0.1', '192.168.1.0x10', '127.0.0.1.', '999.1.1.1', '1.2.3.4.5']) {
    assert.throws(() => normalizeHost(host), /canonical IPv4 notation/, host);
    await assert.rejects(assertResolvedRemoteHost(host, allowed, { allowPrivate: true }), /canonical IPv4 notation/, host);
  }
  assert.equal(lookup.mock.callCount(), 0, 'ambiguous numeric literals must be rejected before DNS resolution');
  assert.equal(cidrMatches('192.168.1.010', '192.168.1.10/32'), false);
  assert.deepEqual(await assertResolvedRemoteHost('192.168.1.10', allowed, { allowPrivate: true }), ['192.168.1.10']);
  await assert.rejects(assertResolvedRemoteHost('192.168.1.8', allowed, { allowPrivate: true }), /not permitted/);
});

test('CIDR parsing requires canonical IPv4 networks and a complete prefix', () => {
  for (const cidr of ['192.168.001.0/24', '192.168.1.0/', '192.168.1.0/24/0', '192.168.1.0/+24', '192.168.1.0/33']) {
    assert.equal(cidrMatches('192.168.1.10', cidr), false, cidr);
  }
  assert.equal(cidrMatches('192.168.1.10', '192.168.1.20/24'), true, 'CIDR host bits retain their existing semantics');
  assert.equal(cidrMatches('192.168.1.10', '0.0.0.0/0'), true);
});

test('explicit hostname grants retain private DNS destinations and ordinary numeric domain labels', async t => {
  const lookup = t.mock.method(require('node:dns').promises, 'lookup', async () => [
    { address: '192.168.1.8', family: 4 }, { address: '::ffff:192.168.1.10', family: 6 },
  ]);
  const allowed = new Set(['123.server.example']);
  assert.equal(normalizeHost('123.Server.Example'), '123.Server.Example');
  assert.deepEqual(await assertResolvedRemoteHost('123.Server.Example', allowed, { allowPrivate: true }), ['192.168.1.8', '192.168.1.10']);
  assert.equal(lookup.mock.callCount(), 1);
  await assert.rejects(assertResolvedRemoteHost('123.Server.Example', allowed), /Private or unresolved/);
  await assert.rejects(assertResolvedRemoteHost('different.example', allowed, { allowPrivate: true }), /not permitted/);
});

test('RDP files include only supplied safe connection values', () => {
  const file = rdpFile({ host: 'server.example.com', port: 3390, username: 'admin', domain: 'CONTOSO' });
  assert.match(file, /full address:s:server\.example\.com:3390/);
  assert.match(file, /domain:s:CONTOSO/);
  assert.match(file, /username:s:admin/);
});

test('address policy canonicalizes mapped IPv6 and covers the complete link-local range', async () => {
  for (const address of ['::ffff:127.0.0.1', '0:0:0:0:0:ffff:7f00:1']) {
    assert.equal(canonicalizeRemoteAddress(address), '127.0.0.1');
    assert.equal(isPrivateAddress(address), true);
    await assert.rejects(assertResolvedRemoteHost(address, new Set()), /Private or unresolved/);
  }
  for (const address of ['::', '0.0.0.0', '0:0:0:0:0:0:0:1', '::1%lo', 'fe90::1', 'febf::1', 'fc00::1', 'fdff::1']) {
    assert.equal(isPrivateAddress(address), true, address);
  }
  assert.equal(isPrivateAddress('2001:4860:4860::8888'), false);
  assert.deepEqual(await assertResolvedRemoteHost('::ffff:8.8.8.8', new Set()), ['8.8.8.8']);
});

test('DNS answers are checked after IPv6 normalization before a destination is returned', async t => {
  const dns = require('node:dns').promises;
  t.mock.method(dns, 'lookup', async () => [{ address: '::ffff:7f00:1', family: 6 }]);
  await assert.rejects(assertResolvedRemoteHost('mapped.example', new Set()), /Private or unresolved/);
  assert.deepEqual(await assertResolvedRemoteHost('mapped.example', new Set(['mapped.example']), { allowPrivate: true }), ['127.0.0.1']);
});
