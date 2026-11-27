import { useState } from 'react';
import { sendJSON } from '../lib/apiClient.mjs';
import { t, useLocale } from '../lib/i18n.mjs';
import { useAsyncAction } from '../hooks/useAsyncAction.mjs';
import { Modal } from './Modal.jsx';
import { StatusMessage } from './StatusMessage.jsx';

export function AdminPasswordResetDialog({ user, onClose, onSuccess }) {
  useLocale();
  const [error, setError] = useState('');
  const action = useAsyncAction();

  function submit(event) {
    event.preventDefault();
    const fields = event.currentTarget.elements;
    const newPassword = fields.newPassword.value;
    const confirmPassword = fields.confirmPassword.value;
    if (newPassword !== confirmPassword) {
      setError('New passwords do not match.');
      return;
    }
    setError('');
    action.run(async () => {
      try {
        await sendJSON(`/api/admin/users/${encodeURIComponent(user.id)}/password`,
          { newPassword, confirmPassword }, { method: 'PUT' });
        onSuccess();
      } catch (err) {
        setError(err.message || 'Failed to reset password');
      }
    });
  }

  return (
    <Modal open labelledBy="resetPasswordTitle" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="modal-header">
          <h3 id="resetPasswordTitle">{t('Reset password for {0}', { 0: user.username })}</h3>
        </div>
        <div className="modal-body">
          <p>{t('This member will need to sign in again on all devices.')}</p>
          <input type="hidden" name="username" autoComplete="username" value={user.username} />
          <div className="form-group">
            <label htmlFor="adminNewPassword">{t('New password')}</label>
            <input type="password" id="adminNewPassword" name="newPassword" autoComplete="new-password"
              required minLength={8} maxLength={128} aria-describedby="adminPasswordHint" />
            <small id="adminPasswordHint">{t('Password must have at least 8 characters and at most 72 UTF-8 bytes.')}</small>
          </div>
          <div className="form-group">
            <label htmlFor="adminConfirmPassword">{t('Confirm new password')}</label>
            <input type="password" id="adminConfirmPassword" name="confirmPassword" autoComplete="new-password"
              required minLength={8} maxLength={128} />
          </div>
          <StatusMessage className="error-msg" role="alert" message={error} />
        </div>
        <div className="modal-footer">
          <button className="btn btn-outline" type="button" onClick={onClose}>{t('Cancel')}</button>
          <button className="btn btn-primary" type="submit" disabled={action.busy} aria-busy={action.busy}>
            {t('Reset password')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
