import { useCallback, useEffect, useRef, useState } from 'react';
import { requestJSON } from '../lib/apiClient.mjs';
import { t } from '../lib/i18n.mjs';

function splitTeams(players) {
  const shuffled = [...players];
  for (let end = shuffled.length - 1; end > 0; end--) {
    const index = Math.floor(Math.random() * (end + 1));
    [shuffled[index], shuffled[end]] = [shuffled[end], shuffled[index]];
  }
  const half = Math.ceil(shuffled.length / 2);
  return [shuffled.slice(0, half), shuffled.slice(half)];
}

export function EventRoster({ event }) {
  const [players, setPlayers] = useState(null);
  const [teams, setTeams] = useState(null);
  const [error, setError] = useState('');
  const [copyState, setCopyState] = useState(null);
  const request = useRef(null);
  const load = useCallback(async (makeTeams = false) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setPlayers(null);
    setTeams(null);
    setError('');
    setCopyState(null);
    try {
      const { participants } = await requestJSON('/api/events/' + encodeURIComponent(event.id) + '/participants', { cache: 'no-store', signal: controller.signal });
      if (controller.signal.aborted) return;
      setPlayers(participants);
      if (makeTeams && participants.length >= 2) setTeams(splitTeams(participants));
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure.message);
    }
  }, [event]);
  useEffect(() => { load(); return () => request.current?.abort(); }, [load]);

  const teamName = index => t('Team {0}', { 0: index + 1 });
  // Keep names on one line and keep pasted names from pinging a Discord user or role.
  const plainName = value => value.replace(/[\r\n]+/g, ' ').replace(/@(?=everyone|here|[!&]?\d)/gi, '@\u200b');
  const sections = teams?.map((team, index) => teamName(index) + '\n' + team.map(player => plainName(player.username)).join('\n'));
  const title = plainName(event.title);
  const teamText = sections && [title, ...sections].join('\n\n');
  const copy = async text => {
    const { signal } = request.current;
    try {
      await navigator.clipboard.writeText(text);
      if (!signal.aborted) setCopyState({ copied: true });
    } catch {
      if (!signal.aborted) setCopyState({ manual: text });
    }
  };
  return (
    <div className="event-roster">
      {error ? <div role="alert">{t(error)} <button type="button" className="btn btn-outline btn-sm" onClick={() => load()}>{t('Retry')}</button></div>
        : !players ? <p role="status">{t('Loading...')}</p>
        : !players.length ? <p>{t('No confirmed players yet.')}</p>
        : <>
          <ul aria-label={t('Confirmed players')}>{players.map(player => <li key={player.id}>{player.username}</li>)}</ul>
          <button type="button" className="btn btn-outline btn-sm" disabled={players.length < 2} onClick={() => load(true)}>{t('Shuffle into two teams')}</button>
        </>}
      {teams && <>
        <div className="event-teams">{teams.map((team, index) => <section key={index}>
          <h3>{teamName(index)}</h3>
          <ul>{team.map(player => <li key={player.id}>{player.username}</li>)}</ul>
        </section>)}</div>
        {teamText.length <= 2000
          ? <button type="button" className="btn btn-primary btn-sm" onClick={() => copy(teamText)}>{t('Copy teams for Discord')}</button>
          : sections.map((section, index) => <button type="button" className="btn btn-primary btn-sm" key={index}
              onClick={() => copy(title + '\n\n' + section)}>{t('Copy team {0}', { 0: index + 1 })}</button>)}
        {copyState?.copied && <span role="status">{t('Teams copied.')}</span>}
        {copyState?.manual && <label>{t('Select and copy the teams')}<textarea readOnly value={copyState.manual} onFocus={e => e.target.select()} /></label>}
      </>}
    </div>
  );
}
