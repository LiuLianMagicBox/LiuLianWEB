const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { bindChromiumSession } = require('../src/chromium_server');

class Socket extends EventEmitter {
  OPEN = 1;
  readyState = 1;
  sent = [];
  send(value) { this.sent.push(JSON.parse(value)); }
  receive(value) { this.emit('message', Buffer.from(JSON.stringify(value))); }
}
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const socket = new Socket();
  let complete;
  let launched = 0;
  let closed = 0;
  let signal;
  const session = bindChromiumSession(socket, { launchPage: options => {
    signal = options.signal;
    launched++;
    return new Promise(resolve => { complete = () => resolve({ close: async () => { closed++; }, size: options.size, timeoutMs: 60000 }); });
  } });
  return { socket, session, complete: () => complete(), launched: () => launched, closed: () => closed, signal: () => signal };
}
const open = { type: 'open', url: 'https://203.0.113.10/' };

test('duplicate opens cannot create overlapping browsers; close during opening disposes the late result', async () => {
  const f = fixture();
  f.socket.receive(open);
  f.socket.receive(open);
  await tick();
  assert.equal(f.launched(), 1);
  f.socket.receive({ type: 'close' });
  await tick();
  assert.equal(f.signal().aborted, true);
  f.complete();
  await tick();
  assert.equal(f.closed(), 1);
  assert.equal(f.socket.sent.some(message => message.type === 'ready'), false);
  assert.equal(f.socket.sent.at(-1).type, 'closed');
  await f.session.close();
});

test('disconnect while opening waits for cleanup and never announces a late browser as ready', async () => {
  const f = fixture();
  f.socket.receive(open);
  await tick();
  f.socket.readyState = 3;
  f.socket.emit('close');
  const cleanup = f.session.close();
  f.complete();
  await cleanup;
  assert.equal(f.closed(), 1);
  assert.equal(f.socket.sent.some(message => message.type === 'ready'), false);
});

test('a connected Chromium session closes once on repeated teardown', async () => {
  const f = fixture();
  f.socket.receive(open);
  await tick();
  f.complete();
  await tick();
  assert.equal(f.socket.sent.at(-1).type, 'ready');
  await f.session.close();
  await f.session.close();
  assert.equal(f.closed(), 1);
});
