const test = require('node:test');
const assert = require('node:assert/strict');
const dns = require('node:dns').promises;
const { sshConfig } = require('../src/ssh_server');

const request = host => ({ type: 'connect', host, username: 'test-user', password: 'test-only' });
function allowlist(t, value) {
  const original = process.env.SSH_ALLOWED_HOSTS;
  process.env.SSH_ALLOWED_HOSTS = value;
  t.after(() => {
    if (original === undefined) delete process.env.SSH_ALLOWED_HOSTS;
    else process.env.SSH_ALLOWED_HOSTS = original;
  });
}

test('SSH pins the validated DNS result instead of resolving its hostname at connect time', async t => {
  allowlist(t, 'ssh.example');
  const lookup = t.mock.method(dns, 'lookup', async () => [{ address: '203.0.113.10', family: 4 }]);
  const config = await sshConfig(request('ssh.example'));
  assert.equal(config.host, '203.0.113.10');
  assert.equal(lookup.mock.callCount(), 1);
});

test('SSH allows only explicitly granted private hosts and IPv4 CIDR addresses', async t => {
  allowlist(t, '192.168.0.0/24');
  assert.equal((await sshConfig(request('192.168.0.42'))).host, '192.168.0.42');
  await assert.rejects(sshConfig(request('192.168.1.42')), /not permitted/);
  process.env.SSH_ALLOWED_HOSTS = '';
  await assert.rejects(sshConfig(request('192.168.0.42')), /Private or unresolved/);
  await assert.rejects(sshConfig(request('0:0:0:0:0:ffff:7f00:1')), /Private or unresolved/);
});

test('SSH rejects the octal /32 bypass before DNS and connects only to the granted canonical IP', async t => {
  allowlist(t, '192.168.1.10/32');
  const lookup = t.mock.method(dns, 'lookup', async () => [{ address: '192.168.1.8', family: 4 }]);
  await assert.rejects(sshConfig(request('192.168.1.010')), /canonical IPv4 notation/);
  assert.equal(lookup.mock.callCount(), 0);
  assert.equal((await sshConfig(request('192.168.1.10'))).host, '192.168.1.10');
  await assert.rejects(sshConfig(request('192.168.1.8')), /not permitted/);
});

test('an explicitly granted SSH domain can still resolve to its private destination', async t => {
  allowlist(t, 'private-ssh.example');
  t.mock.method(dns, 'lookup', async () => [{ address: '192.168.1.8', family: 4 }]);
  assert.equal((await sshConfig(request('PRIVATE-SSH.EXAMPLE'))).host, '192.168.1.8');
  await assert.rejects(sshConfig(request('different.example')), /not permitted/);
});
