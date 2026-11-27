import { useEffect, useRef, useState } from 'react';
import { requestJSON, sendJSON } from '../lib/apiClient.mjs';
import { t, useLocale } from '../lib/i18n.mjs';
import { formatUtc8 } from '../lib/timeZone.mjs';
import { Modal } from './Modal.jsx';

const API = '/api/admin/netbird';
const titles = { peers: 'Peers', networks: 'Networks', resources: 'Network resources', routers: 'Routing peers' };
const defaults = {
  peers: { name: '', ssh_enabled: false, login_expiration_enabled: false, inactivity_expiration_enabled: false },
  networks: { name: '', description: '' },
  resources: { name: '', description: '', address: '', groups: [], enabled: true },
  routers: { peer: '', peer_groups: [], metric: 100, masquerade: true, enabled: true },
};
const flags = { ssh_enabled: 'NetBird SSH', login_expiration_enabled: 'Login expiration', inactivity_expiration_enabled: 'Inactivity expiration',
  approval_required: 'Requires approval (Cloud)', enabled: 'Enabled', masquerade: 'Masquerade' };
const groupIds = groups => (groups || []).map(group => typeof group === 'string' ? group : group.id);

function Editor({ kind, item, groups, peers, busy, onSave, onCancel }) {
  const [value, setValue] = useState(() => {
    const data = { ...defaults[kind] };
    for (const key of Object.keys(data)) if (item?.[key] !== undefined) data[key] = item[key];
    if (kind === 'resources') data.groups = groupIds(data.groups);
    if (kind === 'peers' && typeof item?.approval_required === 'boolean') data.approval_required = item.approval_required;
    return data;
  });
  const [routeMode, setRouteMode] = useState(item?.peer_groups?.length ? 'groups' : 'peer');
  const field = (key, label, maxLength) => <div className="form-group">
    <label htmlFor={'nb-' + key}>{t(label)}</label>
    <input id={'nb-' + key} value={value[key]} maxLength={maxLength} required={key !== 'description'} onChange={e => setValue({ ...value, [key]: e.target.value })} />
  </div>;
  const chooseGroups = key => {
    const options = [...groups];
    for (const id of value[key]) if (!options.some(group => group.id === id)) options.push({ id, name: id });
    return <fieldset className="form-group"><legend>{t('NetBird groups')}</legend>
      {!options.length && <p>{t('No NetBird groups available.')}</p>}
      {options.map(group => <label className="toggle-row" key={group.id}>
        <input type="checkbox" checked={value[key].includes(group.id)} onChange={e => setValue({ ...value,
          [key]: e.target.checked ? [...value[key], group.id] : value[key].filter(id => id !== group.id) })} />{group.name}
      </label>)}
    </fieldset>;
  };
  return <form onSubmit={e => {
    e.preventDefault();
    const payload = { ...value };
    if (kind === 'routers') {
      if (routeMode === 'peer') delete payload.peer_groups;
      else delete payload.peer;
    }
    onSave(payload);
  }}>
    <fieldset disabled={busy}>
      <legend>{t(item ? 'Edit' : 'Add')} · {t(titles[kind])}</legend>
      {kind !== 'routers' && field('name', 'Name', kind === 'peers' ? 253 : 100)}
      {['networks', 'resources'].includes(kind) && field('description', 'Description', 1000)}
      {kind === 'resources' && <>{field('address', 'IP address, CIDR or domain', 253)}{chooseGroups('groups')}</>}
      {kind === 'routers' && <>
        <div className="form-group"><label htmlFor="nb-mode">{t('Route through')}</label>
          <select id="nb-mode" value={routeMode} onChange={e => setRouteMode(e.target.value)}>
            <option value="peer">{t('Single peer')}</option><option value="groups">{t('NetBird groups')}</option>
          </select>
        </div>
        {routeMode === 'peer' ? <div className="form-group"><label htmlFor="nb-peer">{t('Routing peer')}</label>
          <select id="nb-peer" required value={value.peer} onChange={e => setValue({ ...value, peer: e.target.value })}>
            <option value="">{t('Select a peer')}</option>
            {value.peer && !peers.some(peer => peer.id === value.peer) && <option value={value.peer}>{value.peer}</option>}
            {peers.map(peer => <option value={peer.id} key={peer.id}>{peer.name} · {peer.ip}</option>)}
          </select>
        </div> : chooseGroups('peer_groups')}
        <div className="form-group"><label htmlFor="nb-metric">{t('Route metric (1–9999)')}</label>
          <input id="nb-metric" type="number" min="1" max="9999" required value={value.metric} onChange={e => setValue({ ...value, metric: Number(e.target.value) })} />
        </div>
      </>}
      {Object.keys(flags).filter(key => key in value).map(key => <label key={key} className="toggle-row">
        <input type="checkbox" checked={value[key]} onChange={e => setValue({ ...value, [key]: e.target.checked })} />{t(flags[key])}
      </label>)}
      <div className="form-actions">
        <button type="submit" className="btn btn-primary">{t(busy ? 'Saving...' : 'Save')}</button>
        <button type="button" className="btn btn-outline" onClick={onCancel}>{t('Cancel')}</button>
      </div>
    </fieldset>
  </form>;
}

function NetbirdLists({ network, groups, peers, onNetwork, onPeers }) {
  const nested = Boolean(network);
  const kinds = nested ? ['resources', 'routers'] : ['peers', 'networks'];
  const base = nested ? `${API}/networks/${encodeURIComponent(network.id)}` : API;
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editor, setEditor] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const alive = useRef(true);
  const request = useRef(null);
  const path = (kind, item) => `${base}/${kind}${item ? '/' + encodeURIComponent(item.id) : ''}`;
  async function load() {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true); setError('');
    try {
      const values = await Promise.all(kinds.map(kind => requestJSON(path(kind), { signal: controller.signal })));
      if (!controller.signal.aborted && alive.current) {
        setData(Object.assign({}, ...values));
        if (!nested) onPeers(values[0].peers);
      }
    } catch (failure) { if (!controller.signal.aborted && alive.current) setError(failure.message); }
    finally { if (!controller.signal.aborted && alive.current) setLoading(false); }
  }
  useEffect(() => {
    alive.current = true;
    load();
    return () => { alive.current = false; request.current?.abort(); };
  }, []);
  async function change(kind, item, payload) {
    if (busy.current) return;
    busy.current = true; setSaving(true); setError(''); setNotice('');
    try {
      if (payload === undefined) await requestJSON(path(kind, item), { method: 'DELETE' });
      else await sendJSON(path(kind, item), payload, { method: item ? 'PUT' : 'POST' });
      if (alive.current) {
        setEditor(null); setConfirm(null); setNotice('NetBird changes saved.');
        await load();
      }
    } catch (failure) {
      if (alive.current) { setError(failure.message); setConfirm(null); }
    } finally { busy.current = false; if (alive.current) setSaving(false); }
  }
  const buttons = (kind, item) => <div className="btn-group">
    {kind === 'networks' && <button type="button" className="btn btn-outline btn-sm" disabled={saving || loading || Boolean(editor)} onClick={() => onNetwork(item)}>{t('Manage network')}</button>}
    <button type="button" data-action="edit" className="btn btn-outline btn-sm" disabled={saving || loading} onClick={() => { setNotice(''); setEditor({ kind, item }); }}>{t('Edit')}</button>
    <button type="button" data-action="delete" className="btn btn-danger btn-sm" disabled={saving || loading} onClick={() => setConfirm({ kind, item })}>{t('Delete')}</button>
  </div>;
  return <>
    <div className="form-actions">
      {nested && <button type="button" className="btn btn-outline" disabled={saving} onClick={() => onNetwork(null)}>{t('Back to networks')}</button>}
      <button type="button" className="btn btn-outline" disabled={loading || saving} onClick={load}>{t('Refresh')}</button>
    </div>
    {nested && <h3>{network.name}</h3>}
    {loading && <p role="status">{t('Loading...')}</p>}
    {error && <p role="alert" className="status-error">{t(error)}</p>}
    {notice && <p role="status">{t(notice)}</p>}
    {editor && <Editor key={editor.kind + (editor.item?.id || 'new')} {...editor} groups={groups} peers={nested ? peers : (data.peers || [])} busy={saving}
      onCancel={() => setEditor(null)} onSave={payload => change(editor.kind, editor.item, payload)} />}
    {kinds.map(kind => <section key={kind} data-netbird={kind} className="section">
      <div className="clash-list-header"><h3>{t(titles[kind])}</h3>
        {kind !== 'peers' && <button type="button" className="btn btn-primary btn-sm" disabled={loading || saving} onClick={() => setEditor({ kind, item: null })}>{t('Add')}</button>}
      </div>
      {!loading && data[kind]?.length === 0 && <p>{t('No NetBird items yet.')}</p>}
      {Boolean(data[kind]?.length) && <div className="data-table-wrapper"><table className="data-table">
        <thead><tr>{['Name', 'Details', 'Actions'].map(label => <th key={label} scope="col">{t(label)}</th>)}</tr></thead>
        <tbody>{data[kind].map(item => <tr key={item.id}>
          <td>{item.name || peers.find(peer => peer.id === item.peer)?.name || item.peer || t('NetBird groups')}<div className="table-subtext">{item.id}</div></td>
          <td>{kind === 'peers' ? <>
            <span>{t(item.connected ? 'Online' : 'Offline')} · {item.ip}{item.ipv6 ? ' · ' + item.ipv6 : ''}</span>
            <div className="table-subtext">{item.hostname} · {item.os} · {item.version}</div>
            <div className="table-subtext">{t('Last seen (UTC+8)')}: {item.last_seen ? formatUtc8(item.last_seen) : '—'}</div>
            {item.approval_required && <div>{t('Requires approval (Cloud)')}</div>}
          </> : kind === 'networks' ? item.description : kind === 'resources' ? <>
            {item.address} · {t(item.enabled ? 'Enabled' : 'Disabled')}<div className="table-subtext">{(item.groups || []).map(group => group.name).join(', ')}</div>
          </> : <>
            {t(item.enabled ? 'Enabled' : 'Disabled')} · {item.metric} · {t(item.masquerade ? 'Masquerade' : 'No masquerade')}
            <div className="table-subtext">{(item.peer_groups || []).map(id => groups.find(group => group.id === id)?.name || id).join(', ')}</div>
          </>}</td><td>{buttons(kind, item)}</td>
        </tr>)}</tbody>
      </table></div>}
    </section>)}
    <Modal open={Boolean(confirm)} labelledBy="nb-delete-title" onClose={() => { if (!saving) setConfirm(null); }}>
      <div className="modal-header"><h3 id="nb-delete-title">{t('Delete NetBird item')}</h3></div>
      <div className="modal-body"><p>{confirm?.item.name || confirm?.item.id}</p><p>{t('Deletion may interrupt network access. This cannot be undone.')}</p></div>
      <div className="modal-footer">
        <button type="button" className="btn btn-outline" disabled={saving} onClick={() => setConfirm(null)}>{t('Cancel')}</button>
        <button type="button" className="btn btn-danger" disabled={saving} onClick={() => change(confirm.kind, confirm.item)}>{t('Delete')}</button>
      </div>
    </Modal>
  </>;
}

export function NetbirdAdmin() {
  useLocale();
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [groups, setGroups] = useState([]);
  const [peers, setPeers] = useState([]);
  const [network, setNetwork] = useState(null);
  const request = useRef(null);
  async function connect() {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setStatus('loading'); setError('');
    try {
      const result = await requestJSON(API + '/status', { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (!result.configured) { setStatus('disabled'); return; }
      const resultGroups = await requestJSON(API + '/groups', { signal: controller.signal });
      if (!controller.signal.aborted) { setGroups(resultGroups.groups); setStatus('ready'); }
    } catch (failure) { if (!controller.signal.aborted) { setError(failure.message); setStatus('error'); } }
  }
  useEffect(() => { connect(); return () => request.current?.abort(); }, []);
  return <section>
    <h2>NetBird</h2>
    <p>{t('Manage peers and private networks through NetBird.')}</p>
    {status === 'loading' && <p role="status">{t('Loading...')}</p>}
    {status === 'disabled' && <p>{t('NetBird is not configured on this server.')}</p>}
    {error && <p role="alert">{t(error)} <button type="button" className="btn btn-outline" onClick={connect}>{t('Retry')}</button></p>}
    {status === 'ready' && <NetbirdLists key={network?.id || 'overview'} network={network} groups={groups} peers={peers} onNetwork={setNetwork} onPeers={setPeers} />}
  </section>;
}
