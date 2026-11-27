import test from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { MailPage } from '../../frontend/src/pages/MailPage.jsx';
import { flush, mockFetch, render, setupDom, typeInto } from '../support/react.mjs';

test('mail page creates a member mailbox then shows webmail and clears the password form', async () => {
  const dom = setupDom('<div id="root"></div>');
  const state = { configured: true, domain: 'example.com', quotaBytes: 1073741824, webmailUrl: 'https://mail.example.com/webmail/', mailbox: null };
  const mock = mockFetch({
    'GET /api/mail': { payload: state },
    'POST /api/mail': { payload: { ...state, mailbox: { email: 'alice@example.com', status: 'ready' } } },
  });
  const view = render(<MailPage />);
  try {
    await flush();
    typeInto(dom.document.getElementById('mailboxName'), 'alice');
    typeInto(dom.document.getElementById('mailboxPassword'), 'mail-password-123');
    typeInto(dom.document.getElementById('mailboxConfirm'), 'mail-password-123');
    act(() => dom.document.getElementById('mailboxForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await flush();
    assert.equal(mock.callsTo('POST', '/api/mail').length, 1);
    assert.equal(dom.document.querySelector('a').href, state.webmailUrl);
    assert.equal(dom.document.querySelector('input[type="password"]'), null);
    assert.match(dom.document.body.textContent, /alice@example.com/);
  } finally { view.unmount(); mock.restore(); dom.cleanup(); }
});

test('pending mailbox keeps its reserved name and unavailable configuration hides creation', async () => {
  for (const data of [{ configured: false }, { configured: true, domain: 'example.com', quotaBytes: 1073741824, mailbox: { email: 'reserved@example.com', status: 'pending' } }]) {
    const dom = setupDom('<div id="root"></div>');
    const mock = mockFetch({ 'GET /api/mail': { payload: data } });
    const view = render(<MailPage />);
    try {
      await flush();
      if (!data.configured) assert.equal(dom.document.querySelector('form'), null);
      else { const field = dom.document.getElementById('mailboxName'); assert.equal(field.value, 'reserved'); assert.equal(field.disabled, true); }
    } finally { view.unmount(); mock.restore(); dom.cleanup(); }
  }
});
