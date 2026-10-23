/**
 * SETU-NER - WebSocket client module (Phase 3)
 * Wraps the /ws/gis connection: connect, reconnect, disconnect, error, and a clean
 * normalized event shape ({ type, event, data, timestamp }) delivered to subscribers.
 * Connection state is exposed so the UI can show an accurate LIVE/CONNECTING/OFFLINE badge
 * instead of hardcoding "LIVE".
 */

const WsClient = {
  socket: null,
  state: "DISCONNECTED", // CONNECTING | CONNECTED | DISCONNECTED
  reconnectDelayMs: 5000,
  _messageListeners: [],
  _stateListeners: [],
  _reconnectTimer: null,

  connect() {
    if (this.socket && (this.state === "CONNECTED" || this.state === "CONNECTING")) return;
    this._setState("CONNECTING");
    try {
      const ws = new WebSocket(ApiClient.WS_URL);
      this.socket = ws;

      ws.onopen = () => {
        this._setState("CONNECTED");
      };

      ws.onmessage = (evt) => {
        let raw;
        try {
          raw = JSON.parse(evt.data);
        } catch (err) {
          console.warn("[WsClient] Failed to parse message:", err);
          return;
        }
        // Normalize backend's {event, data, timestamp} into a clean {type, event, data, timestamp}
        // shape. `event` (backend's original UPPER_SNAKE name) is kept for existing consumers.
        const normalized = {
          type: (raw.event || "unknown").toLowerCase(),
          event: raw.event || "UNKNOWN",
          data: raw.data || {},
          timestamp: raw.timestamp || new Date().toISOString()
        };
        this._messageListeners.forEach(fn => {
          try { fn(normalized); } catch (err) { console.warn("[WsClient] listener error:", err); }
        });
      };

      ws.onerror = () => {
        // onclose always follows onerror for a WebSocket; state transition happens there.
      };

      ws.onclose = () => {
        this.socket = null;
        this._setState("DISCONNECTED");
        this._scheduleReconnect();
      };
    } catch (err) {
      console.warn("[WsClient] Connection unavailable:", err);
      this.socket = null;
      this._setState("DISCONNECTED");
      this._scheduleReconnect();
    }
  },

  _scheduleReconnect() {
    if (this._reconnectTimer) return;
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this.connect();
    }, this.reconnectDelayMs);
  },

  onMessage(fn) {
    this._messageListeners.push(fn);
  },

  onStateChange(fn) {
    this._stateListeners.push(fn);
    fn(this.state); // immediately report current state to the new subscriber
  },

  _setState(state) {
    this.state = state;
    this._stateListeners.forEach(fn => {
      try { fn(state); } catch (err) { console.warn("[WsClient] state listener error:", err); }
    });
  }
};
