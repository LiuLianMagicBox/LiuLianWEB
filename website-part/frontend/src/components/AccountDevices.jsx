import { useEffect, useRef, useState } from 'react';
import { requestJSON } from '../lib/apiClient.mjs';
import { t } from '../lib/i18n.mjs';
import { formatUtc8 } from '../lib/timeZone.mjs';

export function AccountDevices({ version }) {
  const [devices, setDevices] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const request = useRef(null);
  async function refresh(revokeId) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const { signal } = controller;
    setBusy(true);
    setError('');
    try {
      if (revokeId) {
        try { await requestJSON('/api/auth/devices/' + revokeId, { method: 'DELETE', signal }); }
        catch (failure) { if (failure.status !== 404) throw failure; }
      }
      const data = await requestJSON('/api/auth/devices', { signal });
      if (!signal.aborted) setDevices(data.devices);
    } catch (failure) { if (!signal.aborted) setError(failure.message); }
    finally { if (!signal.aborted) setBusy(false); }
  }
  useEffect(() => {
    refresh();
    return () => request.current?.abort();
  }, [version]);
  return <section className="settings-card" aria-labelledby="devicesHeading">
    <h3 id="devicesHeading">{t('My sign-in devices')}</h3>
    {busy && <p role="status">{t('Loading...')}</p>}
    {error && <p role="alert">{t(error)}</p>}
    <ul className="device-list">{devices.map(device => <li key={device.id}>
      <strong>{device.device || t('Unknown device')}</strong>
      <span>{t('Last active (UTC+8)')} · {device.last_active_at ? formatUtc8(device.last_active_at) : '—'}</span>
      {device.current ? <span>{t('Current device')}</span> :
        <button className="btn btn-outline btn-sm" type="button" disabled={busy} onClick={() => refresh(device.id)}>{t('Sign out device')}</button>}
    </li>)}</ul>
    <button className="btn btn-outline btn-sm" type="button" disabled={busy} onClick={() => refresh()}>{t('Refresh')}</button>
  </section>;
}
