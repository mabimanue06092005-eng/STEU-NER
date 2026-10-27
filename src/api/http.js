/**
 * SETU-NER - Central Frontend API Layer (Phase 3)
 * Every backend HTTP call in this app goes through ApiClient. Nothing else in the
 * frontend should call fetch() directly against the FastAPI backend.
 */

const ApiClient = {
  BASE: "http://localhost:8000/api",
  WS_URL: "ws://localhost:8000/ws/gis",

  /**
   * Low-level request helper. Never throws — always resolves to a normalized
   * { ok, status, data, error } result so callers can handle failure without try/catch.
   */
  async request(path, options = {}) {
    const url = `${this.BASE}${path}`;
    let res;
    try {
      res = await fetch(url, {
        headers: { "Content-Type": "application/json", ...(options.headers || {}) },
        ...options
      });
    } catch (err) {
      return { ok: false, status: 0, data: null, error: "Network error: backend unreachable" };
    }

    let data = null;
    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      try { data = await res.json(); } catch (err) { data = null; }
    }

    if (!res.ok) {
      const message = (data && (data.detail || data.message)) || `Request failed (HTTP ${res.status})`;
      return { ok: false, status: res.status, data, error: message };
    }

    return { ok: true, status: res.status, data, error: null };
  },

  get(path) {
    return this.request(path, { method: "GET" });
  },
  post(path, body) {
    return this.request(path, { method: "POST", body: body !== undefined ? JSON.stringify(body) : undefined });
  },
  put(path, body) {
    return this.request(path, { method: "PUT", body: body !== undefined ? JSON.stringify(body) : undefined });
  },
  del(path) {
    return this.request(path, { method: "DELETE" });
  }
};
