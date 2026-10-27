/**
 * SETU-NER - API endpoint definitions (Phase 3)
 * Thin, named wrappers over every backend route the frontend actually uses.
 * Grouped by backend router (see backend/app/routers/). Depends on ApiClient (http.js).
 */

const Api = {
  config: {
    get: () => ApiClient.get("/config")
  },

  gis: {
    roads: () => ApiClient.get("/gis/roads"),
    roadDetail: (id) => ApiClient.get(`/gis/roads/${encodeURIComponent(id)}`),
    summary: () => ApiClient.get("/gis/summary"),
    incidents: () => ApiClient.get("/gis/incidents"),
    vehicles: () => ApiClient.get("/gis/vehicles"),
    reliefCamps: () => ApiClient.get("/gis/relief-camps"),
    floodZones: () => ApiClient.get("/gis/flood-zones"),
    landslideZones: () => ApiClient.get("/gis/landslide-zones"),
    search: (q) => ApiClient.get(`/gis/search?q=${encodeURIComponent(q)}`)
  },

  risk: {
    roads: () => ApiClient.get("/risk/roads"),
    roadBreakdown: (id) => ApiClient.get(`/risk/roads/${encodeURIComponent(id)}`),
    recalculate: () => ApiClient.post("/risk/calculate"),
    predictMl: (params = {}) => {
      const qs = new URLSearchParams(params).toString();
      return ApiClient.get(`/risk/predict-ml${qs ? `?${qs}` : ""}`);
    }
  },

  routes: {
    optimize: (payload) => ApiClient.post("/routes/optimize", payload),
    history: () => ApiClient.get("/routes/history"),
    get: (id) => ApiClient.get(`/routes/${encodeURIComponent(id)}`),
    alternatives: (id) => ApiClient.get(`/routes/${encodeURIComponent(id)}/alternatives`),
    recalculate: (id) => ApiClient.post(`/routes/${encodeURIComponent(id)}/recalculate`),
    riskAnalysis: (id) => ApiClient.get(`/routes/${encodeURIComponent(id)}/risk-analysis`),
    assignVehicle: (id, vehicleId) => ApiClient.post(`/routes/${encodeURIComponent(id)}/assign-vehicle`, { vehicle_id: vehicleId }),
    compare: (routeIds) => ApiClient.post("/routes/compare", { route_ids: routeIds }),
    // Phase 3 Part 4: score a Google-generated candidate route with SETU-NER's own
    // disaster-intelligence layer (Phase 2 risk data). points = [[lat,lng], ...].
    score: (payload) => ApiClient.post("/routes/score", payload)
  },

  vehicles: {
    list: () => ApiClient.get("/vehicles"),
    updateLocation: (id, payload) => ApiClient.post(`/vehicles/${encodeURIComponent(id)}/location`, payload)
  },

  incidents: {
    list: () => ApiClient.get("/incidents"),
    create: (payload) => ApiClient.post("/incidents", payload),
    verify: (id) => ApiClient.post(`/incidents/${encodeURIComponent(id)}/verify`),
    resolve: (id) => ApiClient.post(`/incidents/${encodeURIComponent(id)}/resolve`)
  },

  reports: {
    list: () => ApiClient.get("/reports"),
    create: (payload) => ApiClient.post("/reports", payload),
    confirm: (id) => ApiClient.post(`/reports/${encodeURIComponent(id)}/confirm`)
  },

  damage: {
    analyze: (payload) => ApiClient.post("/damage/analyze", payload)
  },

  alerts: {
    list: () => ApiClient.get("/alerts"),
    create: (payload) => ApiClient.post("/alerts", payload)
  },

  relief: {
    camps: () => ApiClient.get("/relief/camps")
  },

  vulnerable: {
    list: () => ApiClient.get("/vulnerable")
  },

  weather: {
    current: (lat, lng) => ApiClient.get(`/weather/current${lat != null ? `?lat=${lat}&lng=${lng}` : ""}`),
    forecast: (lat, lng) => ApiClient.get(`/weather/forecast${lat != null ? `?lat=${lat}&lng=${lng}` : ""}`)
  },

  simulate: {
    landslide: () => ApiClient.post("/simulate/landslide")
  },

  dashboard: {
    summary: () => ApiClient.get("/dashboard/summary")
  }
};
