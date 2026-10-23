/**
 * SETU-NER - Google Maps JS API loader (Phase 3, Part 2/22)
 *
 * The API key is NEVER hardcoded here or anywhere in the frontend. It is fetched at
 * runtime from the backend (GET /api/config, which reads GOOGLE_MAPS_API_KEY from
 * backend/.env — see backend/.env.example) and used only to build the script URL that
 * gets injected into the page. If no key is configured, ready() resolves to
 * { enabled: false } and every caller is expected to render a clear "map unavailable"
 * state rather than a blank/broken map — never a fake map.
 */

const GoogleMapsLoader = {
  _readyPromise: null,

  ready() {
    if (this._readyPromise) return this._readyPromise;
    this._readyPromise = (async () => {
      const cfgRes = await Api.config.get();
      if (!cfgRes.ok || !cfgRes.data || !cfgRes.data.google_maps_enabled) {
        return { enabled: false, reason: cfgRes.ok ? "GOOGLE_MAPS_API_KEY not configured on backend" : cfgRes.error };
      }

      if (window.google && window.google.maps) {
        return { enabled: true };
      }

      try {
        await this._injectScript(cfgRes.data.google_maps_api_key);
        return { enabled: true };
      } catch (err) {
        return { enabled: false, reason: "Failed to load Google Maps script (check key restrictions / enabled APIs / network)" };
      }
    })();
    return this._readyPromise;
  },

  _injectScript(apiKey) {
    return new Promise((resolve, reject) => {
      window.__setuNerGMapsReady = () => resolve();
      const script = document.createElement("script");
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places,geometry&v=weekly&callback=__setuNerGMapsReady`;
      script.async = true;
      script.defer = true;
      script.onerror = () => reject(new Error("Google Maps script failed to load"));
      document.head.appendChild(script);
    });
  }
};
