import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { GuildManagerPage } from '../../frontend/src/pages/GuildManagerPage.jsx';
import { click, flush, mockFetch, render, selectOption, setupDom } from '../support/react.mjs';

function payload(id) {
  return { guild: { guild_id: id, guild_name: `Guild ${id}`, language: 'en',
    channels: [{ channel_id: `${id}01`, channel_name: `logs-${id}`, channel_type: 'text' }],
    log_channels: { all: `${id}01` } }, logTypes: ['all'], languages: ['en', 'zh_TW'] };
}
function mount(routes = {}) {
  const dom = setupDom('<div id="root"></div>');
  const fetchMock = mockFetch({
    'GET /api/guild-manager/guilds': { payload: { guilds: ['1', '2', '3'].map(id => ({ guild_id: id, guild_name: `Guild ${id}` })) } },
    ...Object.fromEntries(['1', '2', '3'].map(id => [`GET /api/guild-manager/guilds/${id}`, { payload: payload(id) }])),
    ...routes,
  });
  const view = render(<GuildManagerPage />);
  return { ...dom, fetchMock, cleanup: () => { view.unmount(); fetchMock.restore(); dom.cleanup(); } };
}
function submit(f) {
  act(() => f.document.getElementById('guildSettingsForm').dispatchEvent(new f.window.Event('submit', { bubbles: true, cancelable: true })));
}

test('loading a different guild keeps selection and fields together and blocks saving until the new pair is ready', async () => {
  let complete;
  const pending = new Promise(resolve => { complete = resolve; });
  const f = mount({ 'GET /api/guild-manager/guilds/2': () => pending,
    'PUT /api/guild-manager/guilds/2': { payload: payload('2') } });
  try {
    await flush(); click(f.document.querySelector('[data-guild-id="2"]')); await flush();
    assert.equal(f.document.getElementById('guildName').textContent, 'Guild 1');
    assert.equal(f.document.querySelector('.guild-list-item.active').dataset.guildId, '1');
    assert.equal(f.document.querySelector('#guildSettingsForm button').disabled, true);
    assert.equal(f.document.getElementById('guildLanguage').disabled, true);
    submit(f); await flush();
    assert.equal(f.fetchMock.callsTo('PUT', '/api/guild-manager/guilds/2').length, 0);
    complete({ payload: payload('2') }); await flush();
    assert.equal(f.document.getElementById('guildName').textContent, 'Guild 2');
    assert.equal(f.document.querySelector('.guild-list-item.active').dataset.guildId, '2');
    assert.equal(f.document.querySelector('[data-log-type="all"]').value, '201');
    submit(f); await flush();
    assert.deepEqual(f.fetchMock.callsTo('PUT', '/api/guild-manager/guilds/2')[0].body,
      { language: 'en', log_channels: { all: '201' }, private_voice_trigger_channel_id: null });
  } finally { f.cleanup(); }
});

test('out-of-order guild details and failures cannot replace the latest selection', async () => {
  let complete;
  const pending = new Promise(resolve => { complete = resolve; });
  const f = mount({ 'GET /api/guild-manager/guilds/2': () => pending });
  try {
    await flush(); click(f.document.querySelector('[data-guild-id="2"]')); await flush();
    click(f.document.querySelector('[data-guild-id="3"]')); await flush();
    complete({ payload: payload('2') }); await flush();
    assert.equal(f.document.getElementById('guildName').textContent, 'Guild 3');
    assert.equal(f.document.querySelector('.guild-list-item.active').dataset.guildId, '3');
    assert.equal(f.document.querySelector('[data-log-type="all"]').value, '301');
    assert.equal(f.document.querySelector('#guildSettingsForm button').disabled, false);
  } finally { f.cleanup(); }
});

test('a failed guild lookup preserves the previous selection and a stale failure stays hidden', async () => {
  let complete;
  let completeLate;
  const pending = new Promise(resolve => { complete = resolve; });
  const late = new Promise(resolve => { completeLate = resolve; });
  let attempts = 0;
  const f = mount({ 'GET /api/guild-manager/guilds/2': () => ++attempts === 1 ? pending : late });
  try {
    await flush(); click(f.document.querySelector('[data-guild-id="2"]')); await flush();
    complete({ status: 500, payload: { error: 'Lookup failed' } }); await flush();
    assert.equal(f.document.getElementById('guildName').textContent, 'Guild 1');
    assert.equal(f.document.querySelector('[data-log-type="all"]').value, '101');
    assert.match(f.document.getElementById('managerStatus').textContent, /Lookup failed/);
    click(f.document.querySelector('[data-guild-id="2"]')); await flush();
    click(f.document.querySelector('[data-guild-id="3"]')); await flush();
    completeLate({ status: 500, payload: { error: 'Stale failure' } }); await flush();
    assert.equal(f.document.getElementById('managerStatus').textContent, '');
    assert.equal(f.document.getElementById('guildName').textContent, 'Guild 3');
  } finally { f.cleanup(); }
});

test('an in-flight guild save prevents switching or editing its target and restores controls after failure', async () => {
  let complete;
  const pending = new Promise(resolve => { complete = resolve; });
  const f = mount({ 'PUT /api/guild-manager/guilds/1': () => pending });
  try {
    await flush(); selectOption(f.document.getElementById('guildLanguage'), 'zh_TW'); submit(f); await flush();
    assert.equal(f.document.querySelector('[data-guild-id="2"]').disabled, true);
    assert.equal(f.document.getElementById('guildLanguage').disabled, true);
    click(f.document.querySelector('[data-guild-id="2"]')); submit(f); await flush();
    assert.equal(f.fetchMock.callsTo('GET', '/api/guild-manager/guilds/2').length, 0);
    assert.equal(f.fetchMock.callsTo('PUT', '/api/guild-manager/guilds/1').length, 1);
    assert.equal(f.fetchMock.callsTo('PUT', '/api/guild-manager/guilds/1')[0].body.language, 'zh_TW');
    complete({ status: 500, payload: { error: 'Save failed' } }); await flush();
    assert.equal(f.document.querySelector('[data-guild-id="2"]').disabled, false);
    assert.equal(f.document.getElementById('guildLanguage').value, 'zh_TW');
    assert.match(f.document.getElementById('managerStatus').textContent, /Save failed/);
  } finally { f.cleanup(); }
});
