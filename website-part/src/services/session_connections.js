// Every node checks the shared session table. Idle SSH shells and browser
// sockets therefore follow the same expiry and revocations as HTTP requests.
function createSessionConnections(store, intervalMs = 2000, timeoutMs = 10000) {
  const connections = new Map();
  let timer;
  let pending;
  let unresponsive = false;
  let stopped = false;

  function disconnect(id) {
    const callbacks = connections.get(id);
    if (!callbacks) return;
    connections.delete(id);
    for (const close of callbacks) close();
  }

  async function validate() {
    const ids = [...connections.keys()];
    for (let offset = 0; offset < ids.length; offset += 200) {
      const batch = ids.slice(offset, offset + 200);
      let active;
      const deadline = setTimeout(() => {
        unresponsive = true;
        for (const id of connections.keys()) disconnect(id);
      }, timeoutMs);
      deadline.unref();
      try { active = await store.activeSessionIds(batch); }
      catch { active = new Set(); }
      finally { clearTimeout(deadline); unresponsive = false; }
      for (const id of batch) if (!active.has(id)) disconnect(id);
    }
  }
  function check() {
    if (!pending) pending = validate().finally(() => { pending = null; });
    return pending;
  }
  function track(id, transport, event, close) {
    if (unresponsive || stopped) { close(); return; }
    if (!connections.has(id)) connections.set(id, new Set());
    const callbacks = connections.get(id);
    callbacks.add(close);
    transport.once(event, () => {
      callbacks.delete(close);
      if (!callbacks.size && connections.get(id) === callbacks) connections.delete(id);
    });
  }
  store.on('sessionRemoved', disconnect);
  store.on('sessionsChanged', check);
  timer = setInterval(check, intervalMs);
  timer.unref();
  return {
    track, check,
    stop() {
      stopped = true;
      clearInterval(timer);
      store.off('sessionRemoved', disconnect);
      store.off('sessionsChanged', check);
      for (const id of connections.keys()) disconnect(id);
    },
  };
}

module.exports = { createSessionConnections };
