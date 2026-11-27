import { useEffect, useRef, useState } from 'react';
import { requestJSON } from '../lib/apiClient.mjs';
import { formatUtc8 } from '../lib/timeZone.mjs';
import { t } from '../lib/i18n.mjs';

const actions = { password_reset: 'Password reset', user_groups: 'Member groups changed', group_create: 'Group created',
  group_update: 'Group updated', group_delete: 'Group deleted', page_visibility: 'Page visibility changed' };
for (const [kind, label] of Object.entries({ peers: 'peer', networks: 'network', resources: 'resource', routers: 'routing peer' })) {
  for (const [method, action] of Object.entries({ post: 'created', put: 'updated', delete: 'deleted' })) {
    actions[`netbird_${kind}_${method}`] = `NetBird ${label} ${action}`;
  }
}
const outcomes = { success: 'Succeeded', rejected: 'Rejected', failed: 'Failed' };

export function AdminAudit() {
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState([]);
  const [next, setNext] = useState(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const request = useRef(null);

  async function load(filter, before = null) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const { signal } = controller;
    setBusy(true);
    setError('');
    if (!before) { setRows([]); setNext(null); setSearch(filter); }
    try {
      const query = new URLSearchParams();
      if (filter) query.set('search', filter);
      if (before) query.set('before', before);
      const data = await requestJSON('/api/admin/audit' + (query.size ? '?' + query : ''), { signal });
      if (!signal.aborted) {
        setRows(previous => before ? [...previous, ...data.entries] : data.entries);
        setNext(data.next);
      }
    } catch (failure) { if (!signal.aborted) setError(failure.message); }
    finally { if (!signal.aborted) setBusy(false); }
  }
  useEffect(() => { load(''); return () => request.current?.abort(); }, []);
  return <>
    <h2>{t('Admin audit log')}</h2>
    <form className="form-actions" onSubmit={e => { e.preventDefault(); load(draft.trim()); }}>
      <label htmlFor="auditSearch">{t('Username, ID or page key')}</label>
      <input id="auditSearch" type="search" maxLength={128} value={draft} onChange={e => setDraft(e.target.value)} />
      <button type="submit" className="btn btn-outline btn-sm">{t('Search')}</button>
    </form>
    {busy && <p role="status">{t('Loading...')}</p>}
    {error && <p role="alert">{t(error)} <button type="button" className="btn btn-outline btn-sm" onClick={() => load(search, next)}>{t('Retry')}</button></p>}
    {!busy && !error && !rows.length && <p>{t('No matching audit entries.')}</p>}
    {rows.length > 0 && <div className="data-table-wrapper"><table className="data-table">
      <thead><tr>{['Time (UTC+8)', 'Administrator', 'Action', 'Target', 'Result'].map(key => <th key={key} scope="col">{t(key)}</th>)}</tr></thead>
      <tbody>{rows.map(row => <tr key={row.id}>
        <td>{formatUtc8(row.created_at)}</td><td>{row.actor_name || row.actor_id}</td><td>{t(actions[row.action] || row.action)}</td>
        <td>{row.member_name ? row.member_name + ' (' + row.target + ')' : row.target}</td><td>{t(outcomes[row.outcome] || row.outcome)}</td>
      </tr>)}</tbody>
    </table></div>}
    {next && !error && <button type="button" disabled={busy} className="btn btn-outline btn-sm" onClick={() => load(search, next)}>{t('Older entries')}</button>}
  </>;
}
