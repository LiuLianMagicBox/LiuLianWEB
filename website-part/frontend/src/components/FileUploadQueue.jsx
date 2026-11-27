import { useEffect, useRef, useState } from 'react';
import { entryName, joinPath, uploadFile, UPLOAD_LIMIT } from '../lib/filesApi.mjs';
import { t } from '../lib/i18n.mjs';

const labels = { queued: 'Queued', uploading: 'Uploading', done: 'Uploaded', failed: 'Failed', invalid: 'Failed' };

export function FileUploadQueue({ directory, onUploaded }) {
  const [items, setItems] = useState([]);
  const serial = useRef(0);
  const next = items.find(item => item.state === 'uploading') || items.find(item => item.state === 'queued');
  const id = next?.id;
  const file = next?.file;
  const path = next?.path;
  const destination = next?.directory;

  useEffect(() => {
    if (!file) return;
    const controller = new AbortController();
    const update = patch => {
      if (!controller.signal.aborted) setItems(rows => rows.map(row => row.id === id ? { ...row, ...patch } : row));
    };
    update({ state: 'uploading' });
    uploadFile(path, file, percent => update({ percent }), controller.signal).then(() => {
      if (controller.signal.aborted) return;
      update({ state: 'done', file: null, percent: 100 });
      onUploaded(destination);
    }, error => update({ state: 'failed', error: error.message }));
    return () => controller.abort();
  }, [id, file, path, destination, onUploaded]);

  function enqueue(event) {
    const batch = Array.from(event.target.files || [], file => {
      const row = { id: ++serial.current, directory, name: file.name, file, percent: 0, state: 'queued' };
      try {
        if (file.size > UPLOAD_LIMIT) throw new Error('Each file must be 1 GiB or smaller.');
        row.path = joinPath(directory, entryName(file.name));
      } catch (error) { Object.assign(row, { file: null, state: 'invalid', error: error.message }); }
      return row;
    });
    event.target.value = '';
    setItems(rows => [...rows, ...batch]);
  }
  function retry(id) {
    setItems(rows => rows.map(row => row.state === 'failed' && (id === undefined || row.id === id)
      ? { ...row, state: 'queued', percent: 0, error: '' } : row));
  }
  return <>
    {directory && <div className="file-toolbar">
      <label htmlFor="uploadFile">{t('Upload files')}</label>
      <input id="uploadFile" type="file" multiple onChange={enqueue} />
      <span>{t('最多 1 GiB，同名檔案不會被覆蓋。')}</span>
    </div>}
    {items.length > 0 && <section className="upload-queue" aria-label={t('Upload queue')}>
      <h3>{t('Upload queue')}</h3>
      <ul>{items.map(item => <li key={item.id}>
        <span>{joinPath(item.directory, item.name)}</span>
        <span>{t(labels[item.state])}{item.state === 'uploading' && ' · ' + item.percent + '%'}</span>
        {item.state === 'uploading' && <progress max="100" value={item.percent} aria-label={item.name} />}
        {item.error && <span role="alert">{t(item.error)}</span>}
        {item.state === 'failed' && <button type="button" className="btn btn-outline btn-sm" onClick={() => retry(item.id)}>{t('Retry')}</button>}
      </li>)}</ul>
      {items.some(item => item.state === 'failed') &&
        <button type="button" className="btn btn-outline btn-sm" onClick={() => retry()}>{t('Retry failed files')}</button>}
      {items.some(item => item.state === 'done' || item.state === 'invalid') &&
        <button type="button" className="btn btn-outline btn-sm" onClick={() => setItems(rows => rows.filter(row => row.state !== 'done' && row.state !== 'invalid'))}>{t('Clear finished files')}</button>}
    </section>}
  </>;
}
