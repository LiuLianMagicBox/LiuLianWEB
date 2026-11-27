import { t, useLocale } from '../lib/i18n.mjs';
import { useEffect, useRef, useState } from 'react';
import { requestJSON } from '../lib/apiClient.mjs';
import { StatusMessage } from '../components/StatusMessage.jsx';
import { useAsyncAction } from '../hooks/useAsyncAction.mjs';

const EMPTY_DETAIL = { channels: [], languages: [], logTypes: [], log_channels: {} };

export function GuildManagerPage() {
  useLocale();
  const [guilds, setGuilds] = useState([]);
  const [selection, setSelection] = useState(null);
  const [loadingId, setLoadingId] = useState(null);
  const [status, setStatus] = useState({ message: '', tone: '' });
  const saveAction = useAsyncAction();
  const generation = useRef(0);
  const pendingLoad = useRef(0);
  const saving = useRef(false);
  const mounted = useRef(true);
  const selectedId = selection?.id || null;
  const detail = selection?.detail || null;
  const form = selection?.form || { language: '', privateVoiceTriggerId: '', logChannels: {} };
  const editingDisabled = loadingId !== null || saveAction.busy;
  const updateForm = updater => {
    if (saving.current || pendingLoad.current) return;
    setSelection(current => current && ({ ...current, form: updater(current.form) }));
  };

  const loadDetail = async guildId => {
    if (saving.current) return;
    const request = ++generation.current;
    pendingLoad.current = request;
    setLoadingId(guildId);
    setStatus({ message: 'Loading...', tone: '' });
    try {
      const data = await requestJSON(`/api/guild-manager/guilds/${encodeURIComponent(guildId)}`);
      if (!mounted.current || request !== generation.current) return;
      const next = { ...EMPTY_DETAIL, ...data.guild, logTypes: data.logTypes || [], languages: data.languages || [] };
      setSelection({
        id: String(guildId), token: Symbol('guild selection'), detail: next,
        form: {
          language: next.language || '',
          privateVoiceTriggerId: next.private_voice_trigger_channel_id ? String(next.private_voice_trigger_channel_id) : '',
          logChannels: Object.fromEntries(next.logTypes.map(type => [
            type,
            String(next.log_channels?.[type]
              ?? (type === 'all' ? next.fallback_log_channel_id : '') ?? ''),
          ])),
        },
      });
      setStatus({ message: next.language_sync_pending ? 'Language sync pending. The server will retry.' : '', tone: '' });
    } catch (error) {
      if (mounted.current && request === generation.current) setStatus({ message: error.message, tone: 'error' });
    } finally {
      if (request === generation.current) {
        pendingLoad.current = 0;
        if (mounted.current) setLoadingId(null);
      }
    }
  };

  useEffect(() => {
    let active = true;
    mounted.current = true;
    requestJSON('/api/guild-manager/guilds')
      .then(data => {
        if (!active) return;
        const items = data?.guilds || [];
        setGuilds(items);
        if (items.length === 0) {
          setStatus({ message: 'No manageable servers found.', tone: '' });
          return;
        }
        loadDetail(items[0].guild_id);
      })
      .catch(error => {
        if (active) setStatus({ message: error.message, tone: 'error' });
      });
    return () => {
      active = false;
      mounted.current = false;
      generation.current++;
      pendingLoad.current = 0;
    };
  }, []);

  const submit = event => {
    event.preventDefault();
    if (!selection || pendingLoad.current || saving.current) return;
    if (!form.logChannels.all) {
      setStatus({ message: 'Choose a channel for all logs.', tone: 'error' });
      return;
    }

    const editing = selection;
    const request = generation.current;
    saveAction.run(async () => {
      saving.current = true;
      try {
        const logChannels = { all: editing.form.logChannels.all };
        for (const [type, value] of Object.entries(editing.form.logChannels)) {
          if (type !== 'all' && value) logChannels[type] = value;
        }
        const data = await requestJSON(`/api/guild-manager/guilds/${encodeURIComponent(editing.id)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            language: editing.form.language,
            log_channels: logChannels,
            private_voice_trigger_channel_id: editing.form.privateVoiceTriggerId || null,
          }),
        });
        if (!mounted.current || request !== generation.current) return;
        setSelection(current => current?.token === editing.token
          ? { ...current, detail: { ...editing.detail, ...data.guild } } : current);
        setStatus(data.guild?.language_sync_pending
          ? { message: 'Language sync pending. The server will retry.', tone: '' }
          : { message: 'Settings saved.', tone: 'success' });
      } catch (error) {
        if (mounted.current && request === generation.current) setStatus({ message: error.message, tone: 'error' });
      } finally {
        saving.current = false;
      }
    });
  };

  const textChannels = (detail?.channels || []).filter(channel => channel.channel_type === 'text');
  const voiceChannels = (detail?.channels || []).filter(channel => channel.channel_type === 'voice');

  return (
    <main className="main-content guild-manager-page" id="main-content">
      <div className="page-heading">
        <h1>{t("Discord Server Manager")}</h1>
        <p>{t("Manage settings for Discord servers where your linked account is an owner or bot administrator.")}</p>
      </div>
      <StatusMessage id="managerStatus" message={status.message} tone={status.tone} />
      <section className="guild-manager-layout" aria-label={t("Discord server settings")}>
        <aside className="guild-list-panel">
          <h2>{t("Your servers")}</h2>
          <div id="guildList" className="guild-list">
            {guilds.map(guild => (
              <button
                key={guild.guild_id}
                className={`guild-list-item${String(guild.guild_id) === String(selectedId) ? ' active' : ''}`}
                type="button"
                title={guild.guild_id}
                data-guild-id={guild.guild_id}
                disabled={saveAction.busy}
                aria-busy={String(loadingId) === String(guild.guild_id)}
                onClick={() => loadDetail(guild.guild_id)}
              >
                {guild.guild_name}
              </button>
            ))}
          </div>
        </aside>

        {detail ? (
          <section id="guildSettings" className="guild-settings-panel">
            <h2 id="guildName">{detail.guild_name}</h2>
            <form id="guildSettingsForm" onSubmit={submit}>
              <label className="form-group" htmlFor="guildLanguage">
                {t('Bot language')}
                <select
                  id="guildLanguage"
                  required
                  value={form.language}
                  disabled={editingDisabled}
                  onChange={event => updateForm(current => ({ ...current, language: event.target.value }))}
                >
                  {(detail.languages || []).map(code => (
                    <option key={code} value={code}>{code}</option>
                  ))}
                </select>
              </label>

              <h3>{t("Private voice channels")}</h3>
              <label className="form-group" htmlFor="privateVoiceTriggerChannel">
                {t('Trigger voice channel')}
                <select
                  id="privateVoiceTriggerChannel"
                  value={form.privateVoiceTriggerId}
                  disabled={editingDisabled}
                  onChange={event => updateForm(current => ({ ...current, privateVoiceTriggerId: event.target.value }))}
                >
                  <option value="">{t("Disabled")}</option>
                  {voiceChannels.map(channel => (
                    <option key={channel.channel_id} value={channel.channel_id}>
                      {channel.channel_name}
                    </option>
                  ))}
                </select>
              </label>
              <p className="table-subtext">{t("When a member joins this channel, the bot creates a temporary private voice channel in the same category.")}</p>

              <h3>{t("Log channels")}</h3>
              <div id="logChannelFields" className="log-channel-fields">
                {(detail.logTypes || []).map(logType => (
                  <label className="form-group log-channel-field" key={logType}>
                    <span>{logType}</span>
                    <select
                      data-log-type={logType}
                      value={form.logChannels[logType] ?? ''}
                      disabled={editingDisabled}
                      onChange={event => updateForm(current => ({
                        ...current,
                        logChannels: { ...current.logChannels, [logType]: event.target.value },
                      }))}
                    >
                      <option value="">{t("Use all channel")}</option>
                      {textChannels.map(channel => (
                        <option key={channel.channel_id} value={channel.channel_id}>
                          {`#${channel.channel_name}`}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>

              <button className="btn btn-primary" type="submit" disabled={editingDisabled}>{t("Save settings")}</button>
            </form>
          </section>
        ) : (
          <section id="managerEmpty" className="guild-settings-panel">
            <h2>{t("Select a server")}</h2>
            <p>{t("Your Discord account must be linked from Account settings, then have server-owner or bot-admin access.")}</p>
          </section>
        )}
      </section>
    </main>
  );
}
