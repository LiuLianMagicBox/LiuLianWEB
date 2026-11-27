import { useEffect, useRef, useState } from 'react';
import { t, useLocale } from '../lib/i18n.mjs';
import { requestJSON, sendJSON } from '../lib/apiClient.mjs';
import { StatusMessage } from '../components/StatusMessage.jsx';

export function MailPage() {
  useLocale();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState('');
  const [localpart, setLocalpart] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [termsNeeded, setTermsNeeded] = useState(false);

  function handleError(err) {
    if (err.status === 401) { globalThis.location.href = '/login.html?next=%2Fmail.html'; return; }
    setTermsNeeded(err.code === 'TERMS_REQUIRED');
    setError(err.message);
  }
  async function load() {
    setLoading(true);
    setError('');
    try { setData(await requestJSON('/api/mail')); }
    catch (err) { handleError(err); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);
  const pending = data?.mailbox?.status === 'pending';
  const ready = data?.mailbox?.status === 'ready';
  const pendingName = pending ? data.mailbox.email.split('@')[0] : '';
  async function submit(event) {
    event.preventDefault();
    if (submitting.current) return;
    setError('');
    if (password !== confirmPassword) { setError('Mailbox passwords do not match.'); return; }
    submitting.current = true;
    setBusy(true);
    try {
      setData(await sendJSON('/api/mail', { localpart: pending ? pendingName : localpart, password, confirmPassword }, {
        headers: { 'X-Mail-Request': '1' },
      }));
    } catch (err) {
      // A timed-out upstream operation may already have created the mailbox.
      // Reload the durable reservation so the next attempt uses the same name.
      try { setData(await requestJSON('/api/mail')); } catch { /* retain the original error */ }
      handleError(err);
    } finally {
      setPassword(''); setConfirmPassword('');
      submitting.current = false; setBusy(false);
    }
  }

  return <main className="main-content" id="main-content">
    <div className="account-container">
      <h2>{t('Mail')}</h2>
      <p className="account-desc">{t('Create your own mailbox, then open webmail to read and send email.')}</p>
      <StatusMessage message={error} tone="error" />
      {termsNeeded && <a className="btn btn-primary" href="/terms.html?next=%2Fmail.html">{t('Review terms')}</a>}
      {loading && <p role="status">{t('Loading…')}</p>}
      {!loading && !data && !termsNeeded && <button className="btn btn-outline" onClick={load}>{t('Retry')}</button>}
      {!loading && data && !data.configured && <section className="settings-card">
        <p>{t('Mailbox registration is not available yet.')}</p>
      </section>}
      {!loading && data?.configured && <section className="settings-card" aria-labelledby="mailHeading">
        <h3 id="mailHeading">{t(ready ? 'Your mailbox' : 'Create mailbox')}</h3>
        {ready ? <>
          <p><strong>{data.mailbox.email}</strong></p>
          <p className="account-desc">{t('Sign in to webmail with this full email address and your mailbox password.')}</p>
          <a className="btn btn-primary" href={data.webmailUrl} target="_blank" rel="noopener noreferrer">{t('Open webmail')}</a>
          <p className="account-desc">{t('Manage your mailbox password in the mail account settings. Changing your website password does not change it.')}</p>
        </> : <form onSubmit={submit} id="mailboxForm">
          <p>{t('One mailbox per website member. Your mailbox password is separate from your website password.')}</p>
          {pending && <p role="status">{t('Creation is pending. Retry with the same mailbox name and the password you originally chose.')}</p>}
          <div className="form-group">
            <label htmlFor="mailboxName">{t('Mailbox name')}</label>
            <input id="mailboxName" value={pending ? pendingName : localpart} onChange={e => setLocalpart(e.target.value)}
              required minLength={3} maxLength={32} pattern="[a-zA-Z0-9][a-zA-Z0-9._\-]{1,30}[a-zA-Z0-9]"
              autoComplete="off" autoCapitalize="none" spellCheck={false} disabled={busy || pending} aria-describedby="mailboxNameHint" />
            <p id="mailboxNameHint" className="account-desc">{t('Use 3–32 letters, numbers, dots, hyphens or underscores; start and end with a letter or number.')}</p>
            <p aria-live="polite">{(pending ? pendingName : localpart.trim().toLowerCase()) || 'yourname'}@{data.domain}</p>
          </div>
          <div className="form-group">
            <label htmlFor="mailboxPassword">{t('Mailbox password')}</label>
            <input id="mailboxPassword" type="password" autoComplete="new-password" required minLength={12} maxLength={128}
              value={password} onChange={e => setPassword(e.target.value)} disabled={busy} />
            <p className="account-desc">{t('Use a mailbox password of 12–128 characters.')}</p>
          </div>
          <div className="form-group">
            <label htmlFor="mailboxConfirm">{t('Confirm mailbox password')}</label>
            <input id="mailboxConfirm" type="password" autoComplete="new-password" required minLength={12} maxLength={128}
              value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} disabled={busy} />
          </div>
          <p className="account-desc">{t('Mailbox storage')}: {(data.quotaBytes / 1073741824).toFixed(1)} GiB</p>
          <button className="btn btn-primary" type="submit" disabled={busy} aria-busy={busy}>{t(busy ? 'Creating mailbox…' : pending ? 'Retry mailbox creation' : 'Create mailbox')}</button>
        </form>}
      </section>}
    </div>
  </main>;
}
