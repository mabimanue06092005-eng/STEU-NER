/**
 * SETU-NER - Offline-First Emergency Communication Queue (Phase 3)
 *
 * STORE -> CARRY -> FORWARD -> DELIVER
 *
 * A citizen/authority device can be completely offline (no cell signal, no wifi) when an
 * emergency needs to be recorded. This module lets the browser STORE the message locally
 * (localStorage survives app restarts), CARRY it until connectivity returns, then FORWARD
 * it to the SETU-NER backend, which DELIVERs it to authorities via the existing incident
 * pipeline (DB write + WebSocket broadcast + map/dashboard update) — no new backend
 * endpoint was invented; this reuses POST /api/incidents.
 *
 * This is a REAL, working local queue (not a simulation) — the thing it cannot do is
 * device-to-device relay without internet, which is a genuine browser/hardware limitation.
 * That gap is covered separately by the clearly-labeled MeshRelaySimulator (src/engine/mesh_simulator.js).
 */

const OfflineQueue = {
  STORAGE_KEY: "setu_ner_offline_queue_v1",
  DEVICE_ID_KEY: "setu_ner_device_id",
  DEFAULT_TTL_MS: 24 * 60 * 60 * 1000, // 24 hours
  PRIORITY_ORDER: { CRITICAL: 0, HIGH: 1, NORMAL: 2 },

  _deviceId: null,

  getDeviceId() {
    if (this._deviceId) return this._deviceId;
    try {
      let id = localStorage.getItem(this.DEVICE_ID_KEY);
      if (!id) {
        id = "DEVICE-" + (crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10)).toUpperCase();
        localStorage.setItem(this.DEVICE_ID_KEY, id);
      }
      this._deviceId = id;
      return id;
    } catch (err) {
      return "DEVICE-UNKNOWN";
    }
  },

  _read() {
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (err) {
      console.warn("[OfflineQueue] Failed to read local storage:", err);
      return [];
    }
  },

  _write(items) {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(items));
    } catch (err) {
      console.warn("[OfflineQueue] Failed to persist local storage (quota or private mode):", err);
    }
  },

  /**
   * STORE: add a new emergency message to the local queue.
   * message: { emergency_type, severity, message, location: {lat,lng} | null, priority }
   */
  enqueue(message) {
    const items = this._read();
    const id = "MSG-" + (crypto.randomUUID ? crypto.randomUUID().slice(0, 12) : Date.now() + "-" + Math.random().toString(36).slice(2, 8));
    const now = Date.now();
    const entry = {
      id,
      timestamp: new Date(now).toISOString(),
      sender_device_id: this.getDeviceId(),
      location: message.location || null,
      emergency_type: message.emergency_type || "General",
      severity: message.severity || "MODERATE",
      message: (message.message || "").slice(0, 160), // keep it SMS/offline-transport sized
      priority: message.priority && this.PRIORITY_ORDER.hasOwnProperty(message.priority) ? message.priority : "NORMAL",
      ttl_expires_at: new Date(now + (message.ttlMs || this.DEFAULT_TTL_MS)).toISOString(),
      synced: false
    };
    items.push(entry);
    this._write(items);
    return entry;
  },

  /**
   * Removes expired (TTL passed) messages. Returns how many were purged.
   */
  purgeExpired() {
    const items = this._read();
    const now = Date.now();
    const kept = items.filter(m => new Date(m.ttl_expires_at).getTime() > now);
    const purged = items.length - kept.length;
    if (purged > 0) this._write(kept);
    return purged;
  },

  /**
   * Pending (unsynced, unexpired) messages, high priority and oldest first.
   */
  getPending() {
    this.purgeExpired();
    return this._read()
      .filter(m => !m.synced)
      .sort((a, b) => {
        const pa = this.PRIORITY_ORDER[a.priority] ?? 2;
        const pb = this.PRIORITY_ORDER[b.priority] ?? 2;
        if (pa !== pb) return pa - pb;
        return new Date(a.timestamp) - new Date(b.timestamp);
      });
  },

  getAll() {
    return this._read();
  },

  _markSynced(id) {
    const items = this._read();
    const idx = items.findIndex(m => m.id === id);
    if (idx !== -1) {
      items[idx].synced = true;
      this._write(items);
    }
  },

  /**
   * CARRY -> FORWARD -> DELIVER: attempt to deliver every pending message to the backend
   * via the real incidents API. Message IDs prevent duplicate forwarding — a message is
   * only removed/marked once its POST succeeds. High-priority messages go first (getPending
   * already sorts them). Returns { delivered, failed, remaining }.
   */
  async sync() {
    const pending = this.getPending();
    let delivered = 0;
    let failed = 0;

    for (const msg of pending) {
      const payload = {
        type: msg.emergency_type,
        description: `[OFFLINE QUEUE ${msg.id} via ${msg.sender_device_id}] ${msg.message}`,
        latitude: msg.location ? msg.location.lat : 26.1445,
        longitude: msg.location ? msg.location.lng : 91.7362,
        severity: msg.severity
      };
      const res = await Api.incidents.create(payload);
      if (res.ok) {
        this._markSynced(msg.id);
        delivered++;
      } else {
        // Stop on first failure — backend is likely still unreachable, preserve order for next attempt.
        failed++;
        break;
      }
    }

    return { delivered, failed, remaining: this.getPending().length };
  }
};
