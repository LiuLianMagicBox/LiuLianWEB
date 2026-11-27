const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

test('the packaged roller serves both operator sides, a map and the catalogue', async t => {
  const app = express().use('/api/roller', require('../src/routes/roller'));
  const server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const get = async path => {
    const response = await fetch('http://127.0.0.1:' + server.address().port + '/api/roller/' + path);
    assert.equal(response.status, 200);
    return response.json();
  };
  const catalogue = await get('operators');
  for (const [side, label] of [['Att', 'Attacker'], ['Def', 'Defender']]) {
    const operator = await get('operator?side=' + side);
    assert.ok(catalogue[side][operator.name]);
    assert.equal(operator.side, label);
  }
  assert.ok((await get('map')).name);
});
