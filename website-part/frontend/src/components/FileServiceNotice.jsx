import { useEffect, useState } from 'react';
import { requestJSON } from '../lib/apiClient.mjs';
import { t, useLocale } from '../lib/i18n.mjs';

export function FileServiceNotice({ showLogin = false }) {
  useLocale();
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const view = window;
    let timer;
    async function check() {
      try {
        const result = await requestJSON('/api/files/status', { signal: controller.signal });
        if (!controller.signal.aborted) setUnavailable(result?.status === 'unavailable');
      } catch {
        // A failed website request alone tells us nothing about the NAS.
      }
      if (!controller.signal.aborted) timer = view.setTimeout(check, 30_000);
    }
    check();
    return () => {
      controller.abort();
      view.clearTimeout(timer);
    };
  }, []);

  if (!unavailable) return null;
  return (
    <aside className="status-msg" role="status">
      {t('File storage is temporarily unavailable. Members can still sign in.')}
      {showLogin && <> <a href="/login.html">{t('Sign in')}</a></>}
    </aside>
  );
}
