export function normalizeUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('請輸入網址。');
  let url;
  try {
    url = new URL(raw);
  } catch (_) {
    throw new Error('網址格式不正確，請使用 http:// 或 https://。');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('只支援 http:// 或 https:// 網址。');
  }
  return url.toString();
}

export function websocketUrl(locationRef = globalThis.location) {
  const protocol = locationRef.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${locationRef.host}/api/chromium/ws`;
}

export function canvasPoint(canvas, event) {
  const rect = canvas.getBoundingClientRect();
  const style = canvas.ownerDocument?.defaultView?.getComputedStyle(canvas);
  const pixels = property => parseFloat(style?.[property]) || 0;
  let left = rect.left + pixels('borderLeftWidth') + pixels('paddingLeft');
  let top = rect.top + pixels('borderTopWidth') + pixels('paddingTop');
  let width = rect.width - pixels('borderLeftWidth') - pixels('borderRightWidth') - pixels('paddingLeft') - pixels('paddingRight');
  let height = rect.height - pixels('borderTopWidth') - pixels('borderBottomWidth') - pixels('paddingTop') - pixels('paddingBottom');
  if (width <= 0 || height <= 0 || !canvas.width || !canvas.height) return { x: 0, y: 0 };
  // The workspace centers the bitmap with object-fit: contain. Its letterbox
  // margins belong to the canvas element, but not to the remote screen.
  if (style?.objectFit === 'contain') {
    const scale = Math.min(width / canvas.width, height / canvas.height);
    const imageWidth = canvas.width * scale;
    const imageHeight = canvas.height * scale;
    left += (width - imageWidth) / 2;
    top += (height - imageHeight) / 2;
    width = imageWidth;
    height = imageHeight;
  }
  return {
    x: Math.max(0, Math.min(canvas.width - 1, (event.clientX - left) * canvas.width / width)),
    y: Math.max(0, Math.min(canvas.height - 1, (event.clientY - top) * canvas.height / height)),
  };
}

// Owns the server side Chromium screencast socket. The React page only renders
// the address bar, the canvas and the input handlers.
export class ChromiumSession {
  constructor(canvas, {
    WebSocketImpl = globalThis.WebSocket,
    ImageImpl = globalThis.Image,
    locationRef = globalThis.location,
    onState = () => {},
  } = {}) {
    this.canvas = canvas;
    this.WebSocketImpl = WebSocketImpl;
    this.ImageImpl = ImageImpl;
    this.locationRef = locationRef;
    this.onState = onState;
    this.socket = null;
    this.opening = 0;
    this.pendingOpen = null;
    this.frameSequence = 0;
    this.drawnFrame = 0;
  }

  send(message) {
    if (this.socket?.readyState === 1) this.socket.send(JSON.stringify(message));
  }

  drawFrame(frame, requestId = this.opening) {
    const ctx = this.canvas?.getContext?.('2d');
    if (!ctx || !this.ImageImpl) return;
    const image = new this.ImageImpl();
    const sequence = ++this.frameSequence;
    image.onload = () => {
      if (requestId !== this.opening || !this.socket || sequence < this.drawnFrame) return;
      this.drawnFrame = sequence;
      const width = Number(frame.metadata?.deviceWidth) || image.width;
      const height = Number(frame.metadata?.deviceHeight) || image.height;
      this.canvas.width = width;
      this.canvas.height = height;
      ctx.drawImage(image, 0, 0, width, height);
    };
    image.src = `data:image/jpeg;base64,${frame.data}`;
  }

  destroy() {
    this.opening += 1;
    const pending = this.pendingOpen;
    this.pendingOpen = null;
    if (pending) {
      const error = new Error('Chromium opening was cancelled');
      error.name = 'AbortError';
      pending.reject(error);
    }
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    const ctx = this.canvas?.getContext?.('2d');
    ctx?.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  open(value, { size } = {}) {
    const url = normalizeUrl(value);
    this.destroy();
    const requestId = ++this.opening;

    if (typeof this.WebSocketImpl !== 'function') {
      const error = new Error('WebSocket is unavailable');
      this.onState({ state: 'error', message: '瀏覽器不支援 WebSocket。' });
      return Promise.reject(error);
    }

    this.onState({ state: 'opening', message: '正在啟動伺服器 Chromium...' });
    return new Promise((resolve, reject) => {
      const socket = new this.WebSocketImpl(websocketUrl(this.locationRef));
      this.socket = socket;
      const current = () => requestId === this.opening && this.socket === socket;
      const pending = { reject };
      this.pendingOpen = pending;
      const finish = (error, value) => {
        if (this.pendingOpen !== pending) return;
        this.pendingOpen = null;
        if (error) reject(error);
        else resolve(value);
      };
      socket.onopen = () => {
        if (!current()) return;
        socket.send(JSON.stringify({
          type: 'open', url,
          size: size || { width: this.canvas?.width || 1280, height: this.canvas?.height || 720 },
        }));
      };
      socket.onmessage = event => {
        if (!current()) return;
        let message;
        try {
          message = JSON.parse(event.data);
        } catch (_) {
          return;
        }
        if (message.type === 'status' && message.status === 'opening') return;
        if (message.type === 'frame') {
          this.drawFrame(message, requestId);
        } else if (message.type === 'ready') {
          this.onState({ state: 'ready', message: 'Chromium 已連線。' });
          finish(null, url);
        } else if (message.type === 'error') {
          const error = new Error(message.message || 'Chromium session failed');
          this.onState({ state: 'error', message: error.message });
          finish(error);
        }
      };
      socket.onerror = () => {
        if (!current()) return;
        const error = new Error('無法連線到伺服器 Chromium。');
        this.onState({ state: 'error', message: error.message });
        finish(error);
      };
      socket.onclose = () => {
        if (current()) {
          this.socket = null;
          this.onState({ state: 'closed', message: 'Chromium 工作階段已結束。' });
          finish(new Error('Chromium 工作階段已結束。'));
        }
      };
    });
  }
}
