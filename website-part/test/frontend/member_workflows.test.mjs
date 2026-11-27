import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { EventCard } from '../../frontend/src/pages/EventsPage.jsx';
import { FileUploadQueue } from '../../frontend/src/components/FileUploadQueue.jsx';
import { AccountDevices } from '../../frontend/src/components/AccountDevices.jsx';
import { AdminAudit } from '../../frontend/src/components/AdminAudit.jsx';
import { click, flush, mockFetch, render, setupDom, typeInto } from '../support/react.mjs';

const button = label => [...document.querySelectorAll('button')].find(node => node.textContent === label);

test('expanding a roster fetches confirmed players and copying uses a fresh, balanced draw', async () => {
  const dom = setupDom();
  let names = ['A','B','Left'];
  const fetchMock = mockFetch({ 'GET /api/events/9/participants': () => ({ participants: names.map(name => ({id:name,username:name})) }) });
  let copied;
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: async value => { copied = value; } } });
  const view = render(<EventCard event={{id:9, title:'Friday', start_at:'2026-12-22', max_players:10, joined:1}} />);
  try {
    assert.equal(fetchMock.calls.length,0);
    click(button('Confirmed players')); await flush();
    assert.deepEqual([...document.querySelectorAll('.event-roster > ul li')].map(n => n.textContent), names);
    names=['A','B','C','D','Promoted'];
    click(button('Shuffle into two teams')); await flush();
    const teams=[...document.querySelectorAll('.event-teams section')].map(team => [...team.querySelectorAll('li')].map(n => n.textContent));
    assert.deepEqual(teams.map(team => team.length),[3,2]);
    assert.deepEqual(teams.flat().sort(),[...names].sort());
    click(button('Copy teams for Discord')); await flush();
    assert.equal(copied, 'Friday\n\nTeam 1\n'+teams[0].join('\n')+'\n\nTeam 2\n'+teams[1].join('\n'));
    click(button('Confirmed players'));
    names=[]; click(button('Confirmed players')); await flush();
    assert.match(view.container.textContent,/No confirmed players yet/);
  } finally { view.unmount(); fetchMock.restore(); dom.cleanup(); }
});

test('a full 99-player draw can be copied as two messages when clipboard access is unavailable', async () => {
  const dom = setupDom();
  const participants = Array.from({ length: 99 }, (_, id) => ({ id, username: 'player-' + String(id).padStart(13, '0') }));
  const fetchMock = mockFetch({ 'GET /api/events/8/participants': { participants } });
  const view = render(<EventCard event={{ id: 8, title: '@everyone match', start_at: '2026-12-22', joined: 1 }} />);
  try {
    click(button('Confirmed players')); await flush();
    click(button('Shuffle into two teams')); await flush();
    assert.equal(button('Copy teams for Discord'), undefined);
    for (const team of [1, 2]) {
      click(button('Copy team ' + team)); await flush();
      const text = document.querySelector('.event-roster textarea').value;
      assert.ok(text.length <= 2000);
      assert.ok(text.includes('Team ' + team));
      assert.ok(!text.includes('@everyone'));
    }
  } finally { view.unmount(); fetchMock.restore(); dom.cleanup(); }
});

test('retrying an earlier failed upload leaves the current file running and keeps the original destination', async () => {
  const dom = setupDom();
  const requests = [];
  const original = globalThis.XMLHttpRequest;
  globalThis.XMLHttpRequest = class {
    upload = {};
    headers = {};
    open(method,url) { Object.assign(this,{method,url}); }
    setRequestHeader(name,value) { this.headers[name]=value; }
    send(file) { this.file=file; requests.push(this); }
    abort() { this.aborted=true; this.onabort(); this.onloadend(); }
    finish(status) { this.status=status; this.response={error:'Storage busy'}; this.onload(); this.onloadend(); }
  };
  const refreshed=[];
  const done=dir=>refreshed.push(dir);
  const view=render(<FileUploadQueue directory="vol1/photos" onUploaded={done} />);
  const files=['good','again','later'].map(name=>new dom.window.File([name],name));
  try {
    const input=document.getElementById('uploadFile');
    assert.ok(input.multiple);
    Object.defineProperty(input,'files',{value:files});
    act(()=>input.dispatchEvent(new Event('change',{bubbles:true}))); await flush();
    assert.equal(requests.length,1);
    assert.equal(requests[0].headers['X-Files-Request'],'1');
    assert.equal(requests[0].method,'PUT');
    act(()=>requests[0].upload.onprogress({lengthComputable:true,loaded:1,total:4}));
    assert.equal(document.querySelector('progress').value,25);
    view.rerender(<FileUploadQueue directory="vol2" onUploaded={done} />);
    await act(async()=>requests[0].finish(201));
    await act(async()=>requests[1].finish(502));
    assert.equal(requests[2].file.name,'later');
    click(button('Retry failed files')); await flush();
    assert.equal(requests.length,3);
    assert.ok(!requests[2].aborted);
    await act(async()=>requests[2].finish(201));
    await act(async()=>requests[3].finish(201));
    assert.deepEqual(requests.map(request=>request.file.name),['good','again','later','again']);
    assert.ok(requests.every(request=>request.url.startsWith('/api/files/upload?path=vol1%2Fphotos%2F')));
    assert.deepEqual(refreshed,['vol1/photos','vol1/photos','vol1/photos']);
    assert.equal(button('Retry failed files'),undefined);
  } finally {
    view.unmount(); dom.cleanup();
    if (original===undefined) delete globalThis.XMLHttpRequest; else globalThis.XMLHttpRequest=original;
  }
});

test('account devices list current and legacy sessions and revoke only the chosen device', async () => {
  const dom=setupDom();
  const current={id:'c',device:'Chrome · Linux',current:true,last_active_at:'2026-11-22T00:00:00Z'};
  let list=[current,{id:'previous',device:null,current:false,last_active_at:null}];
  const fetchMock=mockFetch({
    'GET /api/auth/devices':()=>({devices:list}),
    'DELETE /api/auth/devices/previous':()=>{list=[current]; return new Response(null,{status:204});},
  });
  const view=render(<AccountDevices version={0}/>);
  try {
    await flush();
    assert.match(view.container.textContent,/Current device/);
    assert.match(view.container.textContent,/Unknown device/);
    assert.equal(document.querySelectorAll('.device-list button').length,1);
    click(button('Sign out device')); await flush();
    assert.equal(document.querySelectorAll('.device-list li').length,1);
    assert.equal(fetchMock.callsTo('DELETE','/api/auth/devices/previous').length,1);
  } finally { view.unmount(); fetchMock.restore(); dom.cleanup(); }
});

test('administrators can filter audit entries and load the next page of the same search', async () => {
  const dom=setupDom();
  const row={id:'60',created_at:'2026-11-22T00:00:00Z',actor_id:'a',actor_name:'Admin',action:'password_reset',target:'m',member_name:'Member',outcome:'success'};
  const fetchMock=mockFetch({ 'GET /api/admin/audit':({url})=>{
    const params=new URL(url,'https://example.test').searchParams;
    if (params.has('before')) return {entries:[{...row,id:'25',outcome:'rejected'}],next:null};
    return {entries:[row],next:params.get('search')==='Member' ? '60' : null};
  } });
  const view=render(<AdminAudit/>);
  try {
    await flush();
    typeInto(document.querySelector('#auditSearch'),'Member');
    click(button('Search')); await flush();
    click(button('Older entries')); await flush();
    assert.equal(document.querySelectorAll('tbody tr').length,2);
    assert.match(view.container.textContent,/Member \(m\)/);
    assert.match(view.container.textContent,/Rejected/);
    assert.ok(fetchMock.calls.at(-1).url.endsWith('?search=Member&before=60'));
  } finally { view.unmount(); fetchMock.restore(); dom.cleanup(); }
});
