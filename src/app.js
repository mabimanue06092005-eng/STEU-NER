/**
 * SETU-NER - Main Interactive Application Controller
 * Handles OpenFreeMap & Esri Satellite Cartography, Govt Ops Dashboard UI, Floating Hazard Pill Callouts, and 10 Core Mechanics
 */

let appState = {
  map: null,
  routeMap: null,
  satTile: null,
  osmTile: null,
  activeBaseMode: "satellite",
  isDarkMode: false,
  roads: [...NER_ROADS],
  reports: [...INITIAL_REPORTS],
  volunteers: [...COMMUNITY_VOLUNTEERS],
  camps: [...RELIEF_CAMPS],
  vehicles: [],
  incidents: [],
  floodZones: [],
  landslideZones: [],
  activeRoute: null,
  networkMode: "LIVE",
  blockedRoadIds: [],
  ws: null,
  layers: {
    riskPolylines: [],
    reportMarkers: [],
    nodeMarkers: [],
    calloutMarkers: [],
    campMarkers: [],
    vehicleMarkers: [],
    hazardPolygons: [],
    routePolyline: null,
    routeMapPolylines: [],
    facilityMarkers: []
  }
};

document.addEventListener("DOMContentLoaded", () => {
  initApp();
});

const API_BASE = ApiClient.BASE; // kept as an alias — all new code should use the Api.* layer directly

async function fetchLiveRoadsFromBackend() {
  const res = await Api.gis.roads();
  if (res.ok && res.data && res.data.features) {
    appState.roads = res.data.features.map(f => ({
      id: f.properties.id,
      name: f.properties.name,
      risk_score: f.properties.risk_score,
      current_status: f.properties.status,
      distance_km: f.properties.distance_km,
      base_travel_time: f.properties.base_travel_time,
      rainfall_mm_last_6h: f.properties.rainfall_mm_last_6h,
      bridge_load_limit: f.properties.bridge_load_limit,
      updated_at: f.properties.updated_at,
      coords: f.geometry.coordinates.map(pt => [pt[1], pt[0]]) // GeoJSON [lng, lat] to [lat, lng]
    }));
  } else if (!res.ok) {
    console.warn("Backend API offline, using local fallback seed:", res.error);
  }
}

async function fetchLiveSummaryKPIs() {
  const res = await Api.gis.summary();
  if (res.ok && res.data) {
    const summary = res.data;
    const kpiSafe = document.getElementById("kpiSafe");
    const kpiRisky = document.getElementById("kpiRisky");
    const kpiBlocked = document.getElementById("kpiBlocked");
    if (kpiSafe) kpiSafe.innerText = summary.safe_roads;
    if (kpiRisky) kpiRisky.innerText = summary.risky_roads;
    if (kpiBlocked) kpiBlocked.innerText = summary.blocked_roads;
  } else {
    console.warn("KPI fetch fallback:", res.error);
  }
}

async function fetchGisLayers() {
  const [incRes, vehRes, floodRes, slideRes, campRes] = await Promise.all([
    Api.gis.incidents(),
    Api.gis.vehicles(),
    Api.gis.floodZones(),
    Api.gis.landslideZones(),
    Api.gis.reliefCamps()
  ]);
  if (incRes.ok) appState.incidents = incRes.data.features || [];
  if (vehRes.ok) appState.vehicles = vehRes.data.features || [];
  if (floodRes.ok) appState.floodZones = floodRes.data.features || [];
  if (slideRes.ok) appState.landslideZones = slideRes.data.features || [];
  if (campRes.ok) {
    // Backend GeoJSON -> flat objects consumed by drawCampMarkersOnMap/renderReliefCampsList.
    // Backend fields are current_occupancy/capacity — replaces the old client-hardcoded
    // RELIEF_CAMPS seed, which used different field names (total_capacity) that the
    // renderers never actually read, so occupancy always silently showed defaults.
    appState.camps = campRes.data.features.map(f => ({
      id: f.properties.id,
      name: f.properties.name,
      capacity: f.properties.capacity,
      current_occupancy: f.properties.current_occupancy,
      total_capacity: f.properties.capacity,
      status: f.properties.status,
      medical_staff_present: true,
      lat: f.geometry.coordinates[1],
      lng: f.geometry.coordinates[0]
    }));
  }
  if (!incRes.ok && !vehRes.ok && !floodRes.ok && !slideRes.ok) {
    console.warn("Error fetching GIS layers — backend unreachable");
  }
}

async function fetchAndRenderDashboardSummary() {
  const res = await Api.dashboard.summary();
  if (!res.ok) return;
  const d = res.data;
  const alertsEl = document.getElementById("kpiAlerts");
  const vehEl = document.getElementById("kpiVehicles");
  const accessEl = document.getElementById("kpiAccessPct");
  if (alertsEl) alertsEl.innerText = d.active_alerts;
  if (vehEl) vehEl.innerText = d.vehicles_in_transit;
  if (accessEl) accessEl.innerText = `${d.accessible_districts_pct}%`;
}

async function fetchLiveReportsFromBackend() {
  const res = await Api.reports.list();
  if (res.ok) {
    appState.reports = res.data;
  } else {
    console.warn("Reports fetch failed:", res.error);
  }
}

async function fetchAndRenderWeather() {
  const el = document.getElementById("weatherWidget");
  const res = await Api.weather.current();
  if (!el) return;
  if (res.ok && res.data) {
    const w = res.data;
    const modeTag = w.mode === "REAL_OPEN_METEO_API" ? "" : " (fallback)";
    el.innerText = `Weather: ${w.temperature}°C, wind ${w.windspeed}km/h${modeTag}`;
  } else {
    el.innerText = "Weather: unavailable";
  }
}

async function fetchAndRenderVulnerableCount() {
  const el = document.getElementById("vulnerableCountDisplay");
  if (!el) return;
  const res = await Api.vulnerable.list();
  if (res.ok) {
    el.innerText = `${res.data.length} registered vulnerable citizens in backend registry`;
  } else {
    el.innerText = "Registry unavailable (backend unreachable)";
  }
}

async function fetchAndRenderAlerts() {
  const container = document.getElementById("liveAlertsFeed");
  if (!container) return;
  const res = await Api.alerts.list();
  if (!res.ok) {
    container.innerHTML = `<div class="text-rose-400 text-[11px]">Could not load alerts: ${res.error}</div>`;
    return;
  }
  const alerts = res.data;
  if (!alerts.length) {
    container.innerHTML = `<div class="text-slate-400 text-[11px]">No active alerts.</div>`;
    return;
  }
  container.innerHTML = alerts.slice(0, 20).map(a => `
    <div class="p-2 bg-slate-100 dark:bg-slate-950 rounded-lg border border-slate-200 dark:border-slate-800">
      <div class="flex items-center justify-between font-bold">
        <span class="text-rose-500">${a.title}</span>
        <span class="text-[9px] font-mono text-slate-400">${a.severity}</span>
      </div>
      <p class="text-[11px] text-slate-600 dark:text-slate-300">${a.message}</p>
      <div class="text-[9px] text-slate-400 mt-0.5">${a.target_area} • ${a.created_at ? new Date(a.created_at).toLocaleString() : ""}</div>
    </div>
  `).join("");
}

let _wsRoadRedrawTimer = null;
function _debouncedRedrawRoads() {
  if (_wsRoadRedrawTimer) clearTimeout(_wsRoadRedrawTimer);
  _wsRoadRedrawTimer = setTimeout(() => {
    fetchLiveRoadsFromBackend().then(() => {
      drawRoadNetworkOnMap();
      renderRoadRiskList();
      fetchLiveSummaryKPIs();
    });
  }, 200);
}

// Badge states for the WS connection indicator. Connection state comes only from
// WsClient's actual socket lifecycle — this never claims LIVE while disconnected.
const WS_BADGE_STYLES = {
  CONNECTED: { text: "WS LIVE", cls: "text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800" },
  CONNECTING: { text: "CONNECTING…", cls: "text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-800" },
  DISCONNECTED: { text: "OFFLINE", cls: "text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-rose-950 text-rose-300 border border-rose-800" }
};

function initWebSocketConnection() {
  WsClient.onStateChange((state) => {
    const badge = document.getElementById("wsSyncStatus");
    const style = WS_BADGE_STYLES[state] || WS_BADGE_STYLES.DISCONNECTED;
    if (badge) {
      badge.innerText = style.text;
      badge.className = style.cls;
    }
  });

  WsClient.onMessage((msg) => {
    console.log("[WebSocket Event]:", msg.event, msg.data);

    if (msg.event === "ROAD_STATUS_CHANGED" || msg.event === "RISK_UPDATED") {
      _debouncedRedrawRoads();
    } else if (msg.event === "NEW_INCIDENT" || msg.event === "INCIDENT_UPDATED") {
      fetchGisLayers().then(() => {
        drawIncidentsOnMap();
        _debouncedRedrawRoads();
      });
    } else if (msg.event === "VEHICLE_LOCATION_UPDATED") {
      fetchGisLayers().then(() => {
        drawVehiclesOnMap();
        renderGPSFleetList();
      });
    } else if (msg.event === "ROUTE_UPDATED" || msg.event === "VEHICLE_ROUTE_CHANGED") {
      calculateAndDrawRoute();
    }
  });

  WsClient.connect();
}

function initApp() {
  Promise.all([fetchLiveRoadsFromBackend(), fetchGisLayers(), fetchLiveReportsFromBackend()]).then(async () => {
    // Backend is the single source of truth for road risk scores (RiskEngineService).
    // calculateAllRoadRisks() used to overwrite the backend-provided risk_score with a
    // client-side recalculation here; that formula depended on fields (terrain_susceptibility,
    // recent_report_density, days_since_last_incident) that don't exist on backend road data,
    // so it silently replaced real per-road risk with a generic guess. Removed from the live
    // path; the function itself is still used by the citizen photo-report demo flow below.
    await initMap();
    initISTClock();
    initSidebarNavigation();
    initFeatureDrawer();
    initMapStyleSwitcher();
    initMapControls();
    initThemeToggle();
    initMapAICopilot();
    initEventListeners();
    initGisToolbarControls();
    initRouteSearchInputs();
    initWebSocketConnection();
    populateDropdowns();
    renderRoadRiskList();
    renderReportsList();
    renderVolunteersList();
    renderReliefCampsList();
    renderGPSFleetList();
    fetchLiveSummaryKPIs();
    fetchAndRenderDashboardSummary();
    fetchAndRenderWeather();
    fetchAndRenderVulnerableCount();
    fetchAndRenderAlerts();
    initOfflineQueueUI();

    setTimeout(() => {
      if (appState.map && appState.mapProvider) appState.mapProvider.invalidateSize(appState.map);
      calculateAndDrawRoute();
    }, 300);
  });
}

function calculateAllRoadRisks() {
  appState.roads.forEach(road => {
    road.risk_score = RiskEngine.calculateRoadRisk(road);
  });
}

// Google Maps is the ONLY user-facing map provider (Phase 3, Part 2) — used once
// backend/.env has a working GOOGLE_MAPS_API_KEY. There is no second map engine to fall
// back to: if Google Maps can't load/authorize, the map panels show a clear "unavailable"
// state (see _showMapUnavailable) instead of a broken or substituted map. Every drawing
// function in this file goes through appState.mapProvider (src/map/googleProvider.js) and
// is guarded to no-op when appState.map is null.
async function initMap() {
  const gmaps = await GoogleMapsLoader.ready();
  if (!gmaps.enabled) {
    appState.mapProvider = null;
    appState.map = null;
    console.warn("[Map] Google Maps unavailable: " + gmaps.reason);
    _updateMapProviderBadge(false, gmaps.reason);
    _showMapUnavailable(gmaps.reason);
    return;
  }

  appState.mapProvider = GoogleMapProvider;

  // Center on North Eastern Region (NER Bounding Box)
  appState.map = appState.mapProvider.createMap("map", { center: [26.0000, 92.5000], zoom: 7 });
  appState.mapProvider.fitBounds(appState.map, [[21.8, 88.0], [29.5, 97.5]], [20, 20]);
  appState.mapProvider.setMapType(appState.map, "overview");
  appState.activeBaseMode = "overview";

  _updateMapProviderBadge(true);

  drawRoadNetworkOnMap();
  drawHubNodesOnMap();
  drawHazardCalloutsOnMap();
  drawReportMarkersOnMap();
  drawCampMarkersOnMap();
  drawIncidentsOnMap();
  drawVehiclesOnMap();
  drawHazardPolygonsOnMap();
}

function _updateMapProviderBadge(enabled, reason) {
  const el = document.getElementById("mapProviderBadge");
  if (el) {
    if (enabled) {
      el.innerText = "GOOGLE MAPS";
      el.className = "text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800";
      el.title = "Live map rendered by Google Maps JavaScript API.";
    } else {
      el.innerText = "MAP UNAVAILABLE";
      el.className = "text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-rose-950 text-rose-300 border border-rose-800";
      el.title = reason || "Google Maps could not be loaded.";
    }
  }
}

// Shown when GOOGLE_MAPS_API_KEY is missing/invalid or the Maps JS script failed to
// load — replaces both map canvases with a clear message instead of any map at all.
function _showMapUnavailable(reason) {
  const humanReason = reason || "GOOGLE_MAPS_API_KEY is not configured or is invalid.";
  [
    { overlay: "mapUnavailableOverlay", text: "mapUnavailableReason" },
    { overlay: "routeMapUnavailableOverlay", text: "routeMapUnavailableReason" }
  ].forEach(({ overlay, text }) => {
    const overlayEl = document.getElementById(overlay);
    const textEl = document.getElementById(text);
    if (textEl) textEl.innerText = `${humanReason} Ask an administrator to set GOOGLE_MAPS_API_KEY in backend/.env and enable the Maps JavaScript, Places and Directions APIs in Google Cloud Console, then reload.`;
    if (overlayEl) { overlayEl.classList.remove("hidden"); overlayEl.classList.add("flex"); }
  });
}

function initISTClock() {
  const clockEl = document.getElementById("istClockDisplay");
  if (!clockEl) return;

  const update = () => {
    const now = new Date();
    clockEl.innerText = now.toLocaleTimeString('en-US', { hour12: false }) + " IST";
  };
  update();
  setInterval(update, 1000);
}

function initSidebarNavigation() {
  const navBtns = document.querySelectorAll(".feat-nav-btn");
  navBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      navBtns.forEach(b => {
        b.classList.remove("active", "bg-indigo-50", "dark:bg-slate-800", "text-indigo-600", "dark:text-indigo-400");
        b.classList.add("text-slate-600", "dark:text-slate-300");
      });

      btn.classList.add("active", "bg-indigo-50", "dark:bg-slate-800", "text-indigo-600", "dark:text-indigo-400");

      const feat = btn.dataset.feat;
      if (feat) switchFeaturePanel(feat);
    });
  });
}

function initFeatureDrawer() {
  const toggleBtn = document.getElementById("toggleOpsHubBtn");
  const closeBtn = document.getElementById("closeOpsDrawerBtn");
  const drawer = document.getElementById("opsHubDrawer");

  if (toggleBtn && drawer) {
    toggleBtn.addEventListener("click", () => {
      drawer.classList.toggle("hidden");
    });
  }

  if (closeBtn && drawer) {
    closeBtn.addEventListener("click", () => {
      drawer.classList.add("hidden");
    });
  }
}

function switchFeaturePanel(featKey) {
  const titleEl = document.getElementById("activePageTitle");
  
  // Hide all full-page views
  document.querySelectorAll(".page-view").forEach(p => p.classList.add("hidden"));

  let targetId = "page-f1";
  let titleText = "1. Live Accessibility GIS Map & Highway Risk Index";

  if (featKey === "f1") {
    targetId = "page-f1";
    titleText = "1. Live Accessibility GIS Map & Highway Risk Index";
  } else if (featKey === "f2") {
    targetId = "page-f2";
    titleText = "2. Predictive Disruption Early Warnings Engine";
  } else if (featKey === "f3") {
    targetId = "page-f3";
    titleText = "3. Smart AI Route Optimizer (Dijkstra Solver)";
  } else if (featKey === "f4") {
    targetId = "page-f4";
    titleText = "4. Crowdsourced Incident Trust Score Verification";
  } else if (featKey === "f5") {
    targetId = "page-f5";
    titleText = "5. Multimodal Vision AI Photo Damage Assessment";
  } else if (featKey === "gpstracking") {
    targetId = "page-gpstracking";
    titleText = "GPS Essential Commodities Fleet Telemetry";
  } else if (featKey === "f6") {
    targetId = "page-f6";
    titleText = "6. Offline SMS Gateway & Toll-Free IVR System";
  } else if (featKey === "f7") {
    targetId = "page-f7";
    titleText = "7. Bluetooth BLE Mesh Gossip Relay Simulator";
  } else if (featKey === "f8") {
    targetId = "page-f8";
    titleText = "8. Vulnerable Population Evacuation Priority System";
  } else if (featKey === "f9") {
    targetId = "page-f9";
    titleText = "9. Community Volunteer & Equipment Pool";
  } else if (featKey === "f10") {
    targetId = "page-f10";
    titleText = "10. Relief Camp Occupancy Tracker & Emergency Cell Broadcast";
  }

  const targetPage = document.getElementById(targetId);
  if (targetPage) targetPage.classList.remove("hidden");
  if (titleEl) titleEl.innerText = titleText;

  if (featKey === "f1" && appState.map) {
    setTimeout(() => appState.mapProvider.invalidateSize(appState.map), 150);
  } else if (featKey === "f3") {
    setTimeout(() => {
      if (appState.routeMap) {
        appState.mapProvider.invalidateSize(appState.routeMap);
      }
      calculateAndDrawRoute();
    }, 150);
  }
}

function initMapStyleSwitcher() {
  const btnSat = document.getElementById("mapStyleSatellite");
  const btnOverview = document.getElementById("mapStyleOverview");
  const btnTopo = document.getElementById("mapStyleTopo");
  const btnRoads = document.getElementById("mapStyleRoads");

  const setStyle = (mode) => {
    appState.activeBaseMode = mode;
    [btnSat, btnOverview, btnTopo, btnRoads].forEach(b => {
      if (b) {
        b.classList.remove("active", "bg-indigo-600", "text-white");
        b.classList.add("hover:bg-slate-100", "dark:hover:bg-slate-800");
      }
    });
    if (appState.map && appState.mapProvider) appState.mapProvider.setMapType(appState.map, mode);
    const targetBtn = mode === "satellite" ? btnSat : (mode === "overview" ? btnOverview : (mode === "topo" ? btnTopo : btnRoads));
    if (targetBtn) targetBtn.classList.add("active", "bg-indigo-600", "text-white");
  };

  if (btnSat) btnSat.addEventListener("click", () => setStyle("satellite"));
  if (btnOverview) btnOverview.addEventListener("click", () => setStyle("overview"));
  if (btnTopo) btnTopo.addEventListener("click", () => setStyle("topo"));
  if (btnRoads) btnRoads.addEventListener("click", () => setStyle("roads"));
}

function initMapControls() {
  const zoomIn = document.getElementById("mapZoomIn");
  const zoomOut = document.getElementById("mapZoomOut");

  if (zoomIn) zoomIn.addEventListener("click", () => { if (appState.map && appState.mapProvider) appState.mapProvider.zoomIn(appState.map); });
  if (zoomOut) zoomOut.addEventListener("click", () => { if (appState.map && appState.mapProvider) appState.mapProvider.zoomOut(appState.map); });
}

function initThemeToggle() {
  const btn = document.getElementById("themeToggleBtn");
  const icon = document.getElementById("themeIcon");
  const text = document.getElementById("themeText");
  const html = document.documentElement;

  if (!btn) return;

  btn.addEventListener("click", () => {
    appState.isDarkMode = !appState.isDarkMode;

    if (appState.isDarkMode) {
      html.classList.add("dark");
      html.classList.remove("light");
      icon.className = "fa-solid fa-moon text-indigo-400";
      text.innerText = "Dark";
    } else {
      html.classList.remove("dark");
      html.classList.add("light");
      icon.className = "fa-solid fa-sun text-amber-500";
      text.innerText = "Light";
    }
  });
}

function drawHazardCalloutsOnMap() {
  if (!appState.map || !appState.mapProvider) return;
  appState.layers.calloutMarkers.forEach(m => m.remove());
  appState.layers.calloutMarkers = [];

  HAZARD_CALLOUTS.forEach(item => {
    const color = item.category === "high_risk" ? "#ef4444" : "#f59e0b";
    const divHtml = `
      <div class="px-2.5 py-1 rounded-full ${item.bg} border ${item.border} ${item.text} font-bold text-[10px] shadow-2xl flex items-center space-x-1.5 whitespace-nowrap backdrop-blur-md">
        <span class="w-2 h-2 rounded-full ${item.category === 'high_risk' ? 'bg-red-400 animate-ping' : 'bg-amber-400'}"></span>
        <span>${item.label}</span>
      </div>
    `;
    const marker = appState.mapProvider.addMarker(appState.map, item.lat, item.lng, { divHtml, size: [120, 24], anchor: [60, 12], color, label: null }, item.label);
    appState.layers.calloutMarkers.push(marker);
  });
}

function drawReportMarkersOnMap() {
  if (!appState.map || !appState.mapProvider) return;
  if (!appState.layers.reportMarkers) appState.layers.reportMarkers = [];
  appState.layers.reportMarkers.forEach(m => m.remove());
  appState.layers.reportMarkers = [];

  const chkReports = document.getElementById("chkFilterReports");
  if (chkReports && !chkReports.checked) return;

  appState.reports.forEach(rep => {
    const lat = rep.latitude;
    const lng = rep.longitude;
    if (lat == null || lng == null) return;
    const divHtml = `<div class="w-6 h-6 rounded-full bg-indigo-950 border-2 border-indigo-400 text-indigo-300 flex items-center justify-center text-[10px] shadow-lg"><i class="fa-solid fa-camera font-bold"></i></div>`;
    const popupHtml = `
      <div class="p-1 space-y-1 text-xs">
        <strong class="text-indigo-400 block font-outfit text-sm">📸 Citizen Report (${rep.id})</strong>
        <div>Type: <strong>${rep.report_type}</strong></div>
        <div>Status: <span class="text-rose-400 font-bold">${rep.status}</span></div>
        <div>Trust Score: <strong>${rep.trust_score}/100</strong></div>
      </div>
    `;
    const marker = appState.mapProvider.addMarker(appState.map, lat, lng, { divHtml, size: [24, 24], anchor: [12, 12], color: "#6366f1", radius: 20 }, popupHtml);
    appState.layers.reportMarkers.push(marker);
  });
}

function drawCampMarkersOnMap() {
  if (!appState.map || !appState.mapProvider) return;
  if (!appState.layers.campMarkers) appState.layers.campMarkers = [];
  appState.layers.campMarkers.forEach(m => m.remove());
  appState.layers.campMarkers = [];

  const chkCamps = document.getElementById("chkFilterCamps");
  if (chkCamps && !chkCamps.checked) return;

  appState.camps.forEach(camp => {
    if (!camp.lat || !camp.lng) return;
    const divHtml = `<div class="w-7 h-7 rounded-full bg-emerald-950 border-2 border-emerald-400 text-emerald-300 flex items-center justify-center text-[10px] shadow-lg"><i class="fa-solid fa-tent font-bold"></i></div>`;
    const popupHtml = `
      <div class="p-1 space-y-1 text-xs">
        <strong class="text-emerald-400 block font-outfit text-sm">⛺ ${camp.name}</strong>
        <div>Occupancy: <strong>${camp.current_occupancy ?? '--'} / ${camp.capacity ?? '--'}</strong></div>
        <div>Status: <span class="text-emerald-300 font-bold">${camp.status || 'OPEN'}</span></div>
      </div>
    `;
    const marker = appState.mapProvider.addMarker(appState.map, camp.lat, camp.lng, { divHtml, size: [28, 28], anchor: [14, 14], color: "#10b981", radius: 24 }, popupHtml);
    appState.layers.campMarkers.push(marker);
  });
}

function drawRoadNetworkOnMap() {
  if (!appState.map || !appState.mapProvider) return;
  appState.layers.riskPolylines.forEach(p => p.remove());
  appState.layers.riskPolylines = [];

  const chkRoads = document.getElementById("chkFilterRoads");
  if (chkRoads && !chkRoads.checked) return;

  appState.roads.forEach(road => {
    const isBlocked = appState.blockedRoadIds.includes(road.id) || road.current_status === "BLOCKED";

    // Explicit Reference GIS Risk Colors: Green (0.00 SAFE), Amber (0.01-50.00 MODERATE), Red (50.01-100.00 RISKY)
    let polylineColor = "#22c55e"; // Safe Green
    let weight = 5;
    let dashed = false;

    if (isBlocked || road.risk_score > 50.0) {
      polylineColor = "#ef4444"; // Risky / Severed Red (50.01 - 100.00)
      weight = 6;
      if (isBlocked) dashed = true;
    } else if (road.risk_score > 0.0) {
      polylineColor = "#f59e0b"; // Moderate Amber (0.01 - 50.00)
      weight = 5;
    }

    const statusBadge = isBlocked
      ? `<span class="px-2 py-0.5 text-[10px] font-mono font-bold rounded-full bg-red-500/20 text-red-400 border border-red-500/40">BLOCKED / SEVERED</span>`
      : (road.risk_score > 35.0
          ? `<span class="px-2 py-0.5 text-[10px] font-mono font-bold rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/40">RISK: ${road.risk_score} (CAUTION)</span>`
          : `<span class="px-2 py-0.5 text-[10px] font-mono font-bold rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40">RISK: ${road.risk_score} (SAFE)</span>`);

    const popupHtml = `
      <div class="space-y-2 p-1.5 text-xs font-sans max-w-xs">
        <div class="font-outfit font-bold text-sm text-slate-100 flex items-center justify-between border-b border-slate-700 pb-1.5">
          <span>${road.name}</span>
          ${statusBadge}
        </div>
        <div class="grid grid-cols-2 gap-1.5 text-[11px] text-slate-300 pt-1">
          <div><span class="text-slate-400">Length:</span> ${road.distance_km} km</div>
          <div><span class="text-slate-400">Base ETA:</span> ${road.base_travel_time} hrs</div>
          <div><span class="text-slate-400">Rainfall:</span> ${road.rainfall_mm_last_6h} mm/6h</div>
          <div><span class="text-slate-400">Bridge Limit:</span> ${road.bridge_load_limit || 40} Tons</div>
        </div>
        <div class="text-[10px] text-slate-400 border-t border-slate-800 pt-1">Last Updated: ${road.updated_at ? new Date(road.updated_at).toLocaleTimeString() : 'Just now'}</div>
        <div class="grid grid-cols-2 gap-1 pt-1">
          <button onclick="fetchRoadRiskBreakdown('${road.id}')" class="bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl py-1 text-[10px] transition">
            View Risk Formula
          </button>
          <button onclick="quickBlockRoad('${road.id}')" class="bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-slate-950 font-extrabold rounded-xl py-1 text-[10px] transition">
            ${isBlocked ? "Restore Road" : "Simulate Blockage"}
          </button>
        </div>
      </div>
    `;

    const polyline = appState.mapProvider.addPolyline(appState.map, road.coords, {
      color: polylineColor, weight, dashed, opacity: 0.95,
      tooltip: `<strong>${road.name}</strong><br>Risk: ${road.risk_score} (${road.current_status})`
    }, popupHtml);

    appState.layers.riskPolylines.push(polyline);
  });
}

function drawHubNodesOnMap() {
  if (!appState.map || !appState.mapProvider) return;
  if (!appState.layers.nodeMarkers) appState.layers.nodeMarkers = [];
  appState.layers.nodeMarkers.forEach(m => m.remove());
  appState.layers.nodeMarkers = [];

  Object.keys(NER_NODES).forEach(key => {
    const node = NER_NODES[key];
    const marker = appState.mapProvider.addMarker(appState.map, node.lat, node.lng,
      { color: "#818cf8", radius: 14 },
      `<strong>${node.name}</strong><br>Logistics Depot Node`);
    appState.layers.nodeMarkers.push(marker);
  });
}

function drawIncidentsOnMap() {
  if (!appState.map || !appState.mapProvider) return;
  if (!appState.layers.incidentMarkers) appState.layers.incidentMarkers = [];
  appState.layers.incidentMarkers.forEach(m => m.remove());
  appState.layers.incidentMarkers = [];

  const chkIncidents = document.getElementById("chkFilterIncidents");
  if (chkIncidents && !chkIncidents.checked) return;

  appState.incidents.forEach(inc => {
    const lat = inc.geometry.coordinates[1];
    const lng = inc.geometry.coordinates[0];
    const p = inc.properties;

    let iconClass = "fa-triangle-exclamation text-rose-400";
    if (p.type === "Landslide") iconClass = "fa-hill-rockslide text-amber-400";
    else if (p.type === "Flood") iconClass = "fa-water text-cyan-400";

    const divHtml = `<div class="w-8 h-8 rounded-full bg-slate-950 border-2 border-rose-500 flex items-center justify-center text-xs shadow-2xl animate-pulse"><i class="fa-solid ${iconClass}"></i></div>`;
    const popupHtml = `
      <div class="p-1 space-y-1 text-xs">
        <strong class="text-rose-400 block font-outfit text-sm">${p.type} Incident (#${p.id})</strong>
        <p class="text-slate-300">${p.description || 'Hazard reported on corridor.'}</p>
        <div class="text-[10px] text-slate-400 pt-1">Severity: <strong class="text-amber-400">${p.severity}</strong> • Status: ${p.status}</div>
      </div>
    `;
    const marker = appState.mapProvider.addMarker(appState.map, lat, lng, { divHtml, size: [32, 32], anchor: [16, 16], color: "#f43f5e", radius: 28, zIndex: 5 }, popupHtml);
    appState.layers.incidentMarkers.push(marker);
  });
}

function drawVehiclesOnMap() {
  if (!appState.map || !appState.mapProvider) return;
  if (!appState.layers.vehicleMarkers) appState.layers.vehicleMarkers = [];
  appState.layers.vehicleMarkers.forEach(m => m.remove());
  appState.layers.vehicleMarkers = [];

  const chkVehicles = document.getElementById("chkFilterVehicles");
  if (chkVehicles && !chkVehicles.checked) return;

  appState.vehicles.forEach(veh => {
    const lat = veh.geometry.coordinates[1];
    const lng = veh.geometry.coordinates[0];
    const p = veh.properties;

    const divHtml = `<div class="w-8 h-8 rounded-full bg-slate-900 border-2 border-emerald-400 text-emerald-300 flex items-center justify-center text-xs shadow-xl"><i class="fa-solid fa-truck-moving"></i></div>`;
    const popupHtml = `
      <div class="p-1 space-y-1 text-xs">
        <strong class="text-emerald-400 block font-outfit text-sm">🚚 ${p.vehicle_number} (${p.id})</strong>
        <div>Type: ${p.vehicle_type}</div>
        <div>Destination: <strong>${p.destination || 'Logistics Depot'}</strong></div>
        <div class="text-[10px] font-mono text-emerald-400">Status: ${p.status}</div>
      </div>
    `;
    const marker = appState.mapProvider.addMarker(appState.map, lat, lng, { divHtml, size: [32, 32], anchor: [16, 16], color: "#34d399", radius: 28, zIndex: 5 }, popupHtml);
    appState.layers.vehicleMarkers.push(marker);
  });
}

function drawHazardPolygonsOnMap() {
  if (!appState.map || !appState.mapProvider) return;
  if (!appState.layers.hazardPolygons) appState.layers.hazardPolygons = [];
  appState.layers.hazardPolygons.forEach(p => p.remove());
  appState.layers.hazardPolygons = [];

  const chkHazards = document.getElementById("chkFilterHazards");
  if (chkHazards && !chkHazards.checked) return;

  // Flood polygons (Cyan) — development seed data, see backend/app/core/hazard_zones.py
  appState.floodZones.forEach(fz => {
    const latLngs = fz.geometry.coordinates[0].map(pt => [pt[1], pt[0]]);
    const poly = appState.mapProvider.addPolygon(appState.map, latLngs,
      { color: "#06b6d4", fillColor: "#06b6d4", fillOpacity: 0.25, weight: 2, dashed: true },
      `<strong class="text-cyan-400 block">🌊 Flood Zone (Development Data): ${fz.properties.name}</strong>Risk Level: ${fz.properties.risk_level}`);
    appState.layers.hazardPolygons.push(poly);
  });

  // Landslide polygons (Amber/Orange) — development seed data
  appState.landslideZones.forEach(lz => {
    const latLngs = lz.geometry.coordinates[0].map(pt => [pt[1], pt[0]]);
    const poly = appState.mapProvider.addPolygon(appState.map, latLngs,
      { color: "#f59e0b", fillColor: "#f59e0b", fillOpacity: 0.3, weight: 2, dashed: true },
      `<strong class="text-amber-400 block">⛰️ Landslide Vulnerability Corridor (Development Data): ${lz.properties.name}</strong>Risk Level: ${lz.properties.risk_level}`);
    appState.layers.hazardPolygons.push(poly);
  });
}

function initGisToolbarControls() {
  const btnReset = document.getElementById("btnResetNerView");
  const btnLocate = document.getElementById("btnLocateMe");
  const distSelect = document.getElementById("districtFilterSelect");
  const searchInput = document.getElementById("gisSearchInput");
  const searchBtn = document.getElementById("gisSearchBtn");

  if (btnReset) {
    btnReset.addEventListener("click", () => {
      if (appState.map) appState.mapProvider.fitBounds(appState.map, [[21.8, 88.0], [29.5, 97.5]], [20, 20]);
    });
  }

  if (btnLocate) {
    btnLocate.addEventListener("click", () => {
      if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition(pos => {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          if (appState.map) {
            appState.mapProvider.setView(appState.map, lat, lng, 12);
            appState.mapProvider.addMarker(appState.map, lat, lng,
              { divHtml: `<div class="w-6 h-6 rounded-full bg-indigo-600 text-white font-bold text-[10px] flex items-center justify-center border-2 border-white shadow-xl">YOU</div>`, size: [24, 24], anchor: [12, 12], color: "#4f46e5", radius: 20, label: null },
              "You are here (Current GPS Location — real browser Geolocation)");
          }
        }, () => {
          alert("GPS Location access denied or unavailable. Centering on Guwahati Hub.");
          if (appState.map) appState.mapProvider.setView(appState.map, 26.1445, 91.7362, 10);
        });
      }
    });
  }

  if (distSelect) {
    distSelect.addEventListener("change", (e) => {
      const val = e.target.value;
      if (!appState.map) return;
      if (val === "ALL") {
        appState.mapProvider.fitBounds(appState.map, [[21.8, 88.0], [29.5, 97.5]], [20, 20]);
      } else {
        const centerMap = {
          kamrup: [26.1445, 91.7362],
          khasi: [25.5788, 91.8933],
          jaintia: [25.4500, 92.2000],
          cachar: [24.8333, 92.7789],
          tripura: [23.8315, 91.2868],
          kohima: [25.6751, 94.1086],
          imphal: [24.8170, 93.9368],
          aizawl: [23.7271, 92.7176],
          papumpare: [27.0844, 93.6053],
          gangtok: [27.3389, 88.6065]
        };
        if (centerMap[val]) {
          appState.mapProvider.setView(appState.map, centerMap[val][0], centerMap[val][1], 10);
        }
      }
    });
  }

  // Real-world place search (Part 3): Google Places Autocomplete when Google Maps is
  // active — shows live suggestions as the user types, selecting one pans the map there
  // using real coordinates from Google, not a hardcoded location list.
  if (appState.mapProvider === GoogleMapProvider && searchInput && window.google && google.maps.places) {
    const autocomplete = new google.maps.places.Autocomplete(searchInput, {
      componentRestrictions: { country: "in" },
      fields: ["geometry", "name", "formatted_address", "types"]
    });
    autocomplete.addListener("place_changed", () => {
      const place = autocomplete.getPlace();
      if (!place.geometry || !place.geometry.location) {
        alert(`No location details available for "${searchInput.value}"`);
        return;
      }
      const lat = place.geometry.location.lat();
      const lng = place.geometry.location.lng();
      appState.mapProvider.setView(appState.map, lat, lng, 13);
      appState.mapProvider.openInfoWindow(appState.map, lat, lng, `<strong class="text-indigo-600 block">${place.name}</strong><span>${place.formatted_address || ""}</span>`);
    });
  }

  // Internal SETU-NER entity search (roads/districts/relief camps) — always available,
  // independent of Google Places (which doesn't know internal corridor names like "NH06").
  const handleSearch = async () => {
    const q = searchInput ? searchInput.value : "";
    if (!q) return;
    const res = await Api.gis.search(q);
    if (!res.ok) {
      alert(`Search failed: ${res.error}`);
      return;
    }
    const data = res.data;
    if (data.results && data.results.length > 0) {
      const top = data.results[0];
      if (appState.map) {
        appState.mapProvider.setView(appState.map, top.lat, top.lng, 11);
        appState.mapProvider.openInfoWindow(appState.map, top.lat, top.lng, `<strong class="text-indigo-600 block">${top.title}</strong><span>${top.subtitle}</span>`);
      }
    } else {
      alert(`No SETU-NER road/district/camp found matching "${q}". Try the map suggestions dropdown for real-world places.`);
    }
  };

  if (searchBtn) searchBtn.addEventListener("click", handleSearch);
  if (searchInput) searchInput.addEventListener("keypress", (e) => { if (e.key === "Enter" && !e.target.value.match(/^\s*$/)) handleSearch(); });

  // Layer filter checkboxes
  ["chkFilterRoads", "chkFilterIncidents", "chkFilterVehicles", "chkFilterHazards"].forEach(id => {
    const chk = document.getElementById(id);
    if (chk) {
      chk.addEventListener("change", () => {
        if (id === "chkFilterRoads") drawRoadNetworkOnMap();
        else if (id === "chkFilterIncidents") drawIncidentsOnMap();
        else if (id === "chkFilterVehicles") drawVehiclesOnMap();
        else if (id === "chkFilterHazards") drawHazardPolygonsOnMap();
      });
    }
  });
}

// Resolves free-typed origin/destination text (from the search inputs, or a Places
// selection) back to a known SETU-NER hub id — used for the Dijkstra fallback workflow,
// which only understands the fixed 12-hub graph (see backend routes.py nodes_dict).
function resolveHubId(text) {
  if (!text) return "guwahati";
  const lower = text.toLowerCase().trim();
  const direct = NER_NODES[lower];
  if (direct) return direct.id;
  const match = Object.values(NER_NODES).find(n => n.name.toLowerCase().includes(lower) || lower.includes(n.id));
  return match ? match.id : "guwahati";
}

function populateDropdowns() {
  // originSelect/destSelect are free-text inputs (Places Autocomplete attaches to them
  // when Google Maps is active — see initGisToolbarControls/initRouteSearchInputs).
  // Defaults are already set via the value="" attribute in index.html.
  const reportRoadSelect = document.getElementById("reportRoadSelect");

  if (reportRoadSelect) reportRoadSelect.innerHTML = "";
  appState.roads.forEach(road => {
    if (reportRoadSelect) reportRoadSelect.add(new Option(road.name, road.id));
  });

  // Swap Origin / Destination Handler
  const swapBtn = document.getElementById("swapOriginDestBtn");
  const originInput = document.getElementById("originSelect");
  const destInput = document.getElementById("destSelect");
  if (swapBtn && originInput && destInput) {
    swapBtn.addEventListener("click", () => {
      const temp = originInput.value;
      originInput.value = destInput.value;
      destInput.value = temp;
      // swap any Places-selected coordinates too, so a swap after a search still uses real coords
      const tLat = originInput.dataset.lat, tLng = originInput.dataset.lng, tName = originInput.dataset.placeName;
      originInput.dataset.lat = destInput.dataset.lat || ""; originInput.dataset.lng = destInput.dataset.lng || ""; originInput.dataset.placeName = destInput.dataset.placeName || "";
      destInput.dataset.lat = tLat || ""; destInput.dataset.lng = tLng || ""; destInput.dataset.placeName = tName || "";
      calculateAndDrawRoute();
    });
  }

  // Transport Mode Switchers
  const modeDriveBtn = document.getElementById("modeDriveBtn");
  const modeTruckBtn = document.getElementById("modeTruckBtn");
  const modeEmergencyBtn = document.getElementById("modeEmergencyBtn");
  const cargoSelect = document.getElementById("cargoSelect");

  const setRouteMode = (btn, cargoVal) => {
    [modeDriveBtn, modeTruckBtn, modeEmergencyBtn].forEach(b => {
      if (b) {
        b.classList.remove("active", "bg-indigo-600", "text-white");
        b.classList.add("hover:bg-slate-200", "dark:hover:bg-slate-700");
      }
    });
    if (btn) {
      btn.classList.add("active", "bg-indigo-600", "text-white");
      btn.classList.remove("hover:bg-slate-200", "dark:hover:bg-slate-700");
    }
    if (cargoSelect) cargoSelect.value = cargoVal;
    calculateAndDrawRoute();
  };

  if (modeDriveBtn) modeDriveBtn.addEventListener("click", () => setRouteMode(modeDriveBtn, "general"));
  if (modeTruckBtn) modeTruckBtn.addEventListener("click", () => setRouteMode(modeTruckBtn, "heavy_relief"));
  if (modeEmergencyBtn) modeEmergencyBtn.addEventListener("click", () => setRouteMode(modeEmergencyBtn, "medical"));
}

// Attaches Google Places Autocomplete to the route Origin/Destination inputs (Part 3/4)
// so a real place selection carries real coordinates into calculateGoogleSafeRoute.
// Editing the text manually (without reselecting) clears the stale coordinates so a
// half-typed query never silently reuses an old location.
function initRouteSearchInputs() {
  const originInput = document.getElementById("originSelect");
  const destInput = document.getElementById("destSelect");
  if (!originInput || !destInput) return;

  [originInput, destInput].forEach(input => {
    input.addEventListener("input", () => {
      delete input.dataset.lat; delete input.dataset.lng; delete input.dataset.placeName;
    });
  });

  if (appState.mapProvider !== GoogleMapProvider || !window.google || !google.maps.places) return;

  [originInput, destInput].forEach(input => {
    const autocomplete = new google.maps.places.Autocomplete(input, {
      componentRestrictions: { country: "in" },
      fields: ["geometry", "name"]
    });
    autocomplete.addListener("place_changed", () => {
      const place = autocomplete.getPlace();
      if (place.geometry && place.geometry.location) {
        input.dataset.lat = place.geometry.location.lat();
        input.dataset.lng = place.geometry.location.lng();
        input.dataset.placeName = place.name;
      }
    });
  });
}

function initRouteMap() {
  const mapEl = document.getElementById("routeMap");
  if (!mapEl || appState.routeMap || !appState.mapProvider) return;
  appState.routeMap = appState.mapProvider.createMap("routeMap", { center: [25.8000, 92.5000], zoom: 7 });

  const centerBtn = document.getElementById("routeMapCenterBtn");
  if (centerBtn) {
    centerBtn.addEventListener("click", () => {
      if (!appState.routeMap) return;
      if (appState.activeRoute && appState.activeRoute.points && appState.activeRoute.points.length) {
        appState.mapProvider.fitBounds(appState.routeMap, appState.activeRoute.points, [40, 40]);
      }
    });
  }
}

// Maps the UI cargo selector to the backend's vehicle_type/priority contract
// (POST /api/routes/optimize — see backend/app/schemas/schemas.py RouteOptimizeRequest)
const CARGO_TYPE_TO_BACKEND = {
  general: { vehicle_type: "TRUCK", priority: "NORMAL" },
  medical: { vehicle_type: "AMBULANCE", priority: "EMERGENCY" },
  heavy_relief: { vehicle_type: "TRUCK", priority: "ESSENTIAL_SUPPLY" }
};

// Route mode -> badge text/label shown on the recommended-route card (Part 8)
function _setRouteModeBadge(usingSetuNerSafety) {
  const el = document.getElementById("routeModeBadge");
  if (!el) return;
  el.innerText = usingSetuNerSafety ? "SETU-NER SAFE ROUTE" : "NORMAL ROUTE";
  el.className = usingSetuNerSafety
    ? "text-[10px] font-mono font-bold text-emerald-500 uppercase tracking-widest block"
    : "text-[10px] font-mono font-bold text-sky-500 uppercase tracking-widest block";
}

function _renderExplanationBox(lines) {
  const box = document.getElementById("routeExplanationBox");
  if (!box) return;
  if (!lines || !lines.length) { box.classList.add("hidden"); box.innerHTML = ""; return; }
  box.classList.remove("hidden");
  box.innerHTML = `<div class="font-bold text-slate-700 dark:text-slate-300 text-[10px] uppercase tracking-wider">Why this route</div>` +
    lines.map(l => `<div class="flex items-start space-x-1.5"><i class="fa-solid fa-circle-info text-indigo-400 text-[9px] mt-1"></i><span>${l}</span></div>`).join("");
}

// Top-level dispatcher: Google Directions + SETU-NER backend safety scoring is the
// PRIMARY workflow (Part 4) when Google Maps is active; the Phase 2 Dijkstra hub-graph
// remains the automatic fallback otherwise (offline / no API key / Directions failure).
// Translates a Google Maps service status code (DirectionsStatus / PlacesServiceStatus —
// both use the same string vocabulary for the codes that matter here) into a message an
// operator can act on, instead of a bare status string in the console (Section 12/13).
function _googleApiErrorMessage(serviceName, code) {
  switch (code) {
    case "REQUEST_DENIED":
      return `Google ${serviceName} API is not enabled/authorized for this project's API key. Enable it in Google Cloud Console.`;
    case "OVER_QUERY_LIMIT":
      return `Google ${serviceName} API quota has been exceeded.`;
    case "ZERO_RESULTS":
      return `Google ${serviceName} returned no results.`;
    case "INVALID_REQUEST":
      return `Google ${serviceName} request was invalid.`;
    case undefined:
    case null:
      return `Google ${serviceName} request failed (network error or the Maps script did not load).`;
    default:
      return `Google ${serviceName} error: ${code}.`;
  }
}

function _setRouteApiWarning(msg) {
  const banner = document.getElementById("routeApiWarningBanner");
  const textEl = document.getElementById("routeApiWarningText");
  if (!banner || !textEl) return;
  if (!msg) { banner.classList.add("hidden"); textEl.innerText = ""; return; }
  textEl.innerText = msg;
  banner.classList.remove("hidden");
}

async function calculateAndDrawRoute() {
  _setRouteApiWarning(null);

  // No live Google map to draw on — surface a clear message instead of silently doing
  // nothing (or, worse, rendering a route on a second map engine).
  if (!appState.mapProvider) {
    const etaEl = document.getElementById("routeETA");
    const distEl = document.getElementById("routeDist");
    const riskEl = document.getElementById("routeRisk");
    if (etaEl) etaEl.innerText = "--";
    if (distEl) distEl.innerText = "--";
    if (riskEl) riskEl.innerText = "--";
    _setRouteApiWarning("Google Maps is unavailable, so routing cannot run. Fix GOOGLE_MAPS_API_KEY in backend/.env and reload.");
    _renderExplanationBox(null);
    return;
  }

  if (!appState.routeMap) initRouteMap();

  // Clear existing polyline/marker layers — shared by both routing paths below.
  if (appState.layers.routePolyline) { appState.layers.routePolyline.remove(); appState.layers.routePolyline = null; }
  if (appState.layers.routeMapPolylines) { appState.layers.routeMapPolylines.forEach(p => p.remove()); appState.layers.routeMapPolylines = []; }
  else { appState.layers.routeMapPolylines = []; }
  const facilitiesCard = document.getElementById("nearbyFacilitiesCard");
  if (facilitiesCard) facilitiesCard.classList.add("hidden");

  const originInput = document.getElementById("originSelect");
  const destInput = document.getElementById("destSelect");
  const cargoSelect = document.getElementById("cargoSelect");
  const cargoType = (cargoSelect ? cargoSelect.value : null) || "general";
  const backendCargo = CARGO_TYPE_TO_BACKEND[cargoType] || CARGO_TYPE_TO_BACKEND.general;

  const originText = (originInput ? originInput.value : "").trim() || "Guwahati";
  const destText = (destInput ? destInput.value : "").trim() || "Agartala";

  if (window.google && google.maps.DirectionsService) {
    const handled = await calculateGoogleSafeRoute(originInput, destInput, originText, destText, backendCargo);
    if (handled) return;
    console.warn("[Route] Google Directions workflow unavailable for this request — falling back to SETU-NER internal Dijkstra hub routing.");
  }

  await calculateDijkstraRoute(originText, destText, cargoType, backendCargo);
}

/**
 * PRIMARY workflow (Phase 3, Part 4/5/6/7/8): Google Directions supplies real candidate
 * routes; SETU-NER's backend (RouteScoringService, reusing Phase 2's risk data) scores
 * each one; the safest practical candidate is recommended, with a data-driven explanation
 * and a shortest-vs-safest comparison. Nearby hospitals/clinics (Places) are shown for
 * the recommended route. Returns false if this workflow can't complete (caller falls
 * back to the Dijkstra hub-graph workflow) — never renders a half-finished result.
 */
async function calculateGoogleSafeRoute(originInput, destInput, originText, destText, backendCargo) {
  const originArg = (originInput && originInput.dataset.lat) ? { lat: parseFloat(originInput.dataset.lat), lng: parseFloat(originInput.dataset.lng) } : originText;
  const destArg = (destInput && destInput.dataset.lat) ? { lat: parseFloat(destInput.dataset.lat), lng: parseFloat(destInput.dataset.lng) } : destText;

  const directionsService = new google.maps.DirectionsService();
  let response;
  try {
    response = await directionsService.route({
      origin: originArg,
      destination: destArg,
      travelMode: google.maps.TravelMode.DRIVING,
      provideRouteAlternatives: true,
      region: "in"
    });
  } catch (err) {
    const code = err && err.code;
    console.warn("[Route] Google Directions request failed:", code || (err && err.message));
    _setRouteApiWarning(_googleApiErrorMessage("Directions", code) + " Showing the SETU-NER internal route estimate instead.");
    return false;
  }
  if (!response || !response.routes || !response.routes.length) {
    _setRouteApiWarning("Google Directions returned no route for this origin/destination. Showing the SETU-NER internal route estimate instead.");
    return false;
  }

  // Score up to 3 candidate routes through the backend (Part 4) — the backend never sees
  // Google's API key and Google never sees SETU-NER's risk data; each stays in its lane.
  const candidates = response.routes.slice(0, 3);
  const scored = [];
  for (let i = 0; i < candidates.length; i++) {
    const route = candidates[i];
    const leg = route.legs[0];
    const points = route.overview_path.map(p => [p.lat(), p.lng()]);
    const distanceKm = leg.distance.value / 1000;
    const durationMin = leg.duration.value / 60;
    const scoreRes = await Api.routes.score({ points, distance_km: distanceKm, duration_min: durationMin, priority: backendCargo.priority, label: `Route ${String.fromCharCode(65 + i)}` });
    scored.push({ googleRoute: route, points, distanceKm, durationMin, score: scoreRes.ok ? scoreRes.data : null, label: `Route ${String.fromCharCode(65 + i)}` });
  }

  const valid = scored.filter(s => s.score);
  if (!valid.length) {
    _setRouteApiWarning("SETU-NER backend risk scoring is unreachable — cannot safely recommend a route right now.");
    return false; // backend unreachable for scoring — don't show an unscored "safe" route
  }

  const nonBlocked = valid.filter(s => !s.score.blocked);
  const pool = nonBlocked.length ? nonBlocked : valid;
  const recommended = pool.reduce((best, cur) => (cur.score.risk_score < best.score.risk_score ? cur : best), pool[0]);
  const shortest = valid.reduce((best, cur) => (cur.distanceKm < best.distanceKm ? cur : best), valid[0]);
  const usedSafetyOverride = recommended !== shortest;

  appState.activeRoute = {
    totalDistance: Math.round(recommended.distanceKm * 10) / 10,
    totalEta: Math.round((recommended.durationMin / 60) * 10) / 10,
    avgRisk: recommended.score.risk_score,
    points: recommended.points,
    route_id: null,
    provider: "google"
  };

  const etaEl = document.getElementById("routeETA");
  const distEl = document.getElementById("routeDist");
  const riskEl = document.getElementById("routeRisk");
  if (etaEl) etaEl.innerText = `${appState.activeRoute.totalEta} hrs`;
  if (distEl) distEl.innerText = `${appState.activeRoute.totalDistance} km`;
  if (riskEl) riskEl.innerText = `${recommended.score.risk_score} / 100 (${recommended.score.risk_level})`;

  const headerTitleEl = document.getElementById("googleRouteHeaderTitle");
  if (headerTitleEl) headerTitleEl.innerText = `${originInput && originInput.dataset.placeName ? originInput.dataset.placeName : originText} to ${destInput && destInput.dataset.placeName ? destInput.dataset.placeName : destText}`;

  _setRouteModeBadge(true);

  // Shortest vs Safest comparison (Part 5)
  const altCardEta = document.getElementById("altRouteETA");
  const altCardDist = document.getElementById("altRouteDist");
  const altCardTitle = document.querySelector("#googleAltRouteCard span.text-amber-500 span");
  if (usedSafetyOverride) {
    if (altCardTitle) altCardTitle.innerText = `${shortest.label} — Shortest (Higher Risk)`;
    if (altCardEta) altCardEta.innerText = `${Math.round((shortest.durationMin / 60) * 10) / 10} hrs`;
    if (altCardDist) altCardDist.innerText = `Distance: ${Math.round(shortest.distanceKm * 10) / 10} km • Risk ${shortest.score.risk_score}`;
    _renderExplanationBox([
      `Recommended <strong>${recommended.label}</strong> (${Math.round(recommended.distanceKm)}km, risk ${recommended.score.risk_score}) over the shorter <strong>${shortest.label}</strong> (${Math.round(shortest.distanceKm)}km, risk ${shortest.score.risk_score}).`,
      ...recommended.score.explanation.map(e => `<strong>${recommended.label}:</strong> ${e}`),
      ...(shortest !== recommended ? shortest.score.explanation.map(e => `<strong>${shortest.label} avoided because:</strong> ${e}`) : [])
    ]);
  } else {
    if (altCardTitle) altCardTitle.innerText = "Alternate Detour Route";
    if (altCardEta) altCardEta.innerText = "No Safer Alternate";
    if (altCardDist) altCardDist.innerText = "Shortest route is already the safest option";
    _renderExplanationBox(recommended.score.explanation);
  }

  // Draw the recommended route
  appState.layers.routePolyline = appState.mapProvider.addPolyline(appState.map, recommended.points, { color: "#38bdf8", weight: 6, opacity: 0.95 });
  const mainPoly = appState.mapProvider.addPolyline(appState.routeMap, recommended.points, { color: "#38bdf8", weight: 8, opacity: 0.95 }, `
    <div class="p-1 text-xs font-sans">
      <strong class="text-sky-400 block text-sm">SETU-NER Recommended Route</strong>
      <span>Distance: ${appState.activeRoute.totalDistance} km • ETA: ${appState.activeRoute.totalEta} hrs • Risk: ${recommended.score.risk_score}/100</span>
    </div>
  `);
  appState.layers.routeMapPolylines.push(mainPoly);

  // Draw the shortest alternate (dashed amber) if different from the recommendation —
  // this IS real Google geometry (unlike the Dijkstra fallback's alt estimate, which has none).
  if (usedSafetyOverride) {
    const altPoly = appState.mapProvider.addPolyline(appState.routeMap, shortest.points, { color: "#f59e0b", weight: 5, opacity: 0.85, dashed: true }, `
      <div class="p-1 text-xs font-sans">
        <strong class="text-amber-500 block">${shortest.label} — Shortest, Higher Risk</strong>
        <span>Distance: ${Math.round(shortest.distanceKm)} km • Risk: ${shortest.score.risk_score}/100</span>
      </div>
    `);
    appState.layers.routeMapPolylines.push(altPoly);
  }

  const startPt = recommended.points[0];
  const endPt = recommended.points[recommended.points.length - 1];
  const originMarker = appState.mapProvider.addMarker(appState.routeMap, startPt[0], startPt[1],
    { divHtml: `<div class="w-7 h-7 rounded-full bg-emerald-500 text-white font-extrabold flex items-center justify-center text-xs shadow-2xl border-2 border-white">A</div>`, size: [28, 28], anchor: [14, 14], color: "#10b981", radius: 24, label: "A" });
  const destMarker = appState.mapProvider.addMarker(appState.routeMap, endPt[0], endPt[1],
    { divHtml: `<div class="w-7 h-7 rounded-full bg-rose-500 text-white font-extrabold flex items-center justify-center text-xs shadow-2xl border-2 border-white">B</div>`, size: [28, 28], anchor: [14, 14], color: "#f43f5e", radius: 24, label: "B" });
  appState.layers.routeMapPolylines.push(originMarker, destMarker);

  appState.mapProvider.fitBounds(appState.routeMap, recommended.points, [40, 40]);

  // Turn-by-turn steps from Google's own leg steps (real navigation instructions)
  const stepsContainer = document.getElementById("routeStepsList");
  if (stepsContainer) {
    stepsContainer.innerHTML = "";
    const steps = recommended.googleRoute.legs[0].steps || [];
    steps.forEach((step, idx) => {
      const item = document.createElement("div");
      item.className = "p-3 bg-slate-100 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800 text-xs space-y-0.5 hover:border-indigo-400 transition cursor-pointer";
      const instruction = (step.instructions || "Continue").replace(/<[^>]+>/g, " ");
      item.innerHTML = `
        <div class="font-semibold text-slate-800 dark:text-slate-200">${idx + 1}. ${instruction}</div>
        <div class="text-[10px] text-slate-500">${step.distance ? step.distance.text : ""} • ${step.duration ? step.duration.text : ""}</div>
      `;
      item.onclick = () => appState.mapProvider.setView(appState.routeMap, step.start_location.lat(), step.start_location.lng(), 14);
      stepsContainer.appendChild(item);
    });
  }

  // Nearby hospitals/clinics along the recommended route (Part 7)
  findNearbyMedicalFacilities(recommended.points).catch(err => console.warn("[Route] Nearby facilities lookup failed:", err));

  return true;
}

/**
 * FALLBACK workflow (Phase 2, unchanged logic): SETU-NER's own Dijkstra hub-graph.
 * Used automatically when Google Maps/Directions isn't available. originText/destText
 * are resolved to the nearest known hub via resolveHubId since this graph only
 * understands the fixed 12-hub network (backend routers/routes.py nodes_dict).
 */
async function calculateDijkstraRoute(originText, destText, cargoType, backendCargo) {
  const originId = resolveHubId(originText);
  const destId = resolveHubId(destText);

  // Backend (DijkstraRouterService) is the single source of truth for route + risk
  // calculation. The local RouteOptimizer engine only runs as an offline fallback
  // when the backend is genuinely unreachable, mirroring the fallback pattern already
  // used elsewhere in this file (e.g. the monsoon simulation button).
  let result = null;
  let altSummary = null;
  let routeError = null;
  const optRes = await Api.routes.optimize({
    origin: originId,
    destination: destId,
    vehicle_type: backendCargo.vehicle_type,
    priority: backendCargo.priority,
    avoid_high_risk: true,
    blocked_roads: appState.blockedRoadIds
  });

  if (optRes.ok) {
    result = optRes.data;
    const altRes = await Api.routes.alternatives(result.route_id);
    if (altRes.ok) {
      altSummary = altRes.data.alternatives && altRes.data.alternatives[0];
    }
  } else if (optRes.status === 0) {
    // Genuine network failure (backend unreachable) — fall back to the local demo engine.
    console.warn("Backend route optimizer unreachable, using local fallback engine:", optRes.error);
    const fallback = RouteOptimizer.findAlternateRoutes(
      NER_NODES,
      appState.roads,
      originId,
      destId,
      cargoType,
      appState.blockedRoadIds
    );
    result = fallback.primary;
    if (fallback.alternate && fallback.alternate.roads.length > 0) {
      altSummary = { distance_km: fallback.alternate.totalDistance, duration_minutes: fallback.alternate.totalEta * 60 };
    }
  } else {
    // Backend responded but genuinely found no route (e.g. blocked corridor cuts off the
    // destination) — this is a real answer, not a network problem, so we show it honestly
    // instead of silently substituting a fabricated local route.
    routeError = optRes.error;
  }

  appState.activeRoute = result;

  const etaEl = document.getElementById("routeETA");
  const distEl = document.getElementById("routeDist");
  const riskEl = document.getElementById("routeRisk");

  if (!result) {
    if (etaEl) etaEl.innerText = "NO PATH";
    if (distEl) distEl.innerText = "N/A";
    if (riskEl) riskEl.innerText = "CRITICAL";
    _renderExplanationBox(null);
    const headerTitleEl = document.getElementById("googleRouteHeaderTitle");
    if (headerTitleEl && routeError) headerTitleEl.innerText = routeError;
    return;
  }

  _setRouteModeBadge(true);
  _renderExplanationBox([`Google Directions could not supply a route for this request, so this is SETU-NER's internal hub-graph estimate (not a real Google road route) — risk score ${result.avgRisk} computed from live backend road data.`]);

  if (etaEl) etaEl.innerText = `${result.totalEta} hrs`;
  if (distEl) distEl.innerText = `${result.totalDistance} km`;
  if (riskEl) riskEl.innerText = `${result.avgRisk} / 100`;

  // Sync Google Maps Header Title & Alternate Card
  const headerTitleEl = document.getElementById("googleRouteHeaderTitle");
  const originName = NER_NODES[originId] ? NER_NODES[originId].name.split("(")[0].trim() : originId;
  const destName = NER_NODES[destId] ? NER_NODES[destId].name.split("(")[0].trim() : destId;
  if (headerTitleEl) headerTitleEl.innerText = `${originName} to ${destName}`;

  // Alternate route: the backend's /alternatives endpoint returns a distance/duration
  // estimate but no drawable geometry, so we show the estimate as text and do not draw
  // a fabricated detour polyline.
  const altCardEta = document.getElementById("altRouteETA");
  const altCardDist = document.getElementById("altRouteDist");
  if (altSummary && altSummary.distance_km && altSummary.distance_km !== result.totalDistance) {
    const altEtaHrs = altSummary.duration_minutes ? Math.round((altSummary.duration_minutes / 60) * 10) / 10 : null;
    if (altCardEta) altCardEta.innerText = altEtaHrs ? `${altEtaHrs} hrs` : "Estimated Detour";
    if (altCardDist) altCardDist.innerText = `Distance: ${altSummary.distance_km} km`;
  } else {
    if (altCardEta) altCardEta.innerText = "No Detour Needed";
    if (altCardDist) altCardDist.innerText = "Direct corridor clear";
  }

  const boundsGroup = [];

  // Draw Primary Safest Route
  if (result && result.roads.length > 0) {
    const routeCoords = [];
    result.roads.forEach(r => r.coords.forEach(pt => routeCoords.push(pt)));
    boundsGroup.push(...routeCoords);
    appState.activeRoute.points = routeCoords;

    // Main map polyline
    appState.layers.routePolyline = appState.mapProvider.addPolyline(appState.map, routeCoords, { color: "#38bdf8", weight: 6, opacity: 0.95 });

    // Route map polyline (Thick Sky Blue Line)
    if (appState.routeMap) {
      const mainPoly = appState.mapProvider.addPolyline(appState.routeMap, routeCoords, { color: "#38bdf8", weight: 8, opacity: 0.95 }, `
        <div class="p-1 text-xs font-sans">
          <strong class="text-sky-400 block text-sm">Recommended Safest Route</strong>
          <span>Distance: ${result.totalDistance} km • ETA: ${result.totalEta} hrs • Avg Risk: ${result.avgRisk}</span>
        </div>
      `);
      appState.layers.routeMapPolylines.push(mainPoly);
    }

    // Add origin and destination "A"/"B" pins
    if (appState.routeMap && NER_NODES[originId] && NER_NODES[destId]) {
      const startNode = NER_NODES[originId];
      const endNode = NER_NODES[destId];

      const originMarker = appState.mapProvider.addMarker(appState.routeMap, startNode.lat, startNode.lng,
        { divHtml: `<div class="w-7 h-7 rounded-full bg-emerald-500 text-white font-extrabold flex items-center justify-center text-xs shadow-2xl border-2 border-white">A</div>`, size: [28, 28], anchor: [14, 14], color: "#10b981", radius: 24, label: "A" });
      const destMarker = appState.mapProvider.addMarker(appState.routeMap, endNode.lat, endNode.lng,
        { divHtml: `<div class="w-7 h-7 rounded-full bg-rose-500 text-white font-extrabold flex items-center justify-center text-xs shadow-2xl border-2 border-white">B</div>`, size: [28, 28], anchor: [14, 14], color: "#f43f5e", radius: 24, label: "B" });

      appState.layers.routeMapPolylines.push(originMarker, destMarker);
    }

    if (appState.routeMap && boundsGroup.length > 0) {
      appState.mapProvider.fitBounds(appState.routeMap, boundsGroup, [40, 40]);
    }

    const stepsContainer = document.getElementById("routeStepsList");
    if (stepsContainer) {
      stepsContainer.innerHTML = "";
      result.roads.forEach((rd, idx) => {
        const item = document.createElement("div");
        item.className = "p-3 bg-slate-100 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs space-x-2 hover:border-indigo-400 transition cursor-pointer";
        
        let turnIcon = "fa-location-arrow";
        if (idx === 0) turnIcon = "fa-play text-emerald-500";
        else if (idx === result.roads.length - 1) turnIcon = "fa-flag-checkered text-rose-500";
        else if (idx % 2 === 0) turnIcon = "fa-turn-right text-indigo-400";
        else turnIcon = "fa-turn-left text-indigo-400";

        item.innerHTML = `
          <div class="flex items-center space-x-3">
            <div class="w-7 h-7 rounded-xl bg-indigo-50 dark:bg-slate-800 flex items-center justify-center shrink-0">
              <i class="fa-solid ${turnIcon} text-xs"></i>
            </div>
            <div>
              <span class="font-bold text-slate-800 dark:text-slate-200 block">${rd.name}</span>
              <span class="text-[10px] text-slate-500">${rd.distance_km} km • ${rd.base_travel_time} hrs • Bridge: ${rd.bridge_load_limit || 40}T</span>
            </div>
          </div>
          <span class="text-[11px] font-mono font-bold px-2 py-0.5 rounded-full ${rd.risk_score > 50 ? 'bg-rose-100 dark:bg-rose-950 text-rose-600 dark:text-rose-400' : 'bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400'}">
            Risk ${rd.risk_score}
          </span>
        `;

        item.onclick = () => {
          if (appState.routeMap && rd.coords && rd.coords.length > 0) {
            appState.mapProvider.fitBounds(appState.routeMap, rd.coords, [50, 50]);
          }
        };

        stepsContainer.appendChild(item);
      });
    }
  }
}

/**
 * Nearby hospitals/clinics along the recommended route (Phase 3, Part 7). Samples a
 * handful of points along the route's own geometry (not the user's current location)
 * and runs a Google Places nearby search around each, so results are genuinely
 * relevant to the journey rather than wherever the browser happens to be.
 */
async function findNearbyMedicalFacilities(routePoints) {
  const listEl = document.getElementById("nearbyFacilitiesList");
  const cardEl = document.getElementById("nearbyFacilitiesCard");
  if (!listEl || !cardEl || !appState.routeMap) return;
  if (!window.google || !google.maps.places) {
    cardEl.classList.remove("hidden");
    listEl.innerHTML = `<div class="text-[11px] text-amber-600 dark:text-amber-400">Google Places is not available, so nearby hospitals/clinics can't be looked up.</div>`;
    return;
  }

  const placesService = new google.maps.places.PlacesService(appState.routeMap.map);
  const sampleIdxs = [...new Set([0, Math.floor(routePoints.length * 0.33), Math.floor(routePoints.length * 0.66), routePoints.length - 1])];

  let lastBadStatus = null;
  const searchAt = (lat, lng) => new Promise((resolve) => {
    placesService.nearbySearch({ location: { lat, lng }, radius: 8000, type: "hospital" }, (results, status) => {
      if (status === google.maps.places.PlacesServiceStatus.OK) {
        resolve(results || []);
      } else {
        if (status !== google.maps.places.PlacesServiceStatus.ZERO_RESULTS) lastBadStatus = status;
        resolve([]);
      }
    });
  });

  const allResults = [];
  for (const idx of sampleIdxs) {
    const [lat, lng] = routePoints[idx];
    allResults.push(...await searchAt(lat, lng));
  }

  const seen = new Set();
  const deduped = allResults.filter(r => !seen.has(r.place_id) && seen.add(r.place_id)).slice(0, 8);

  if (appState.layers.facilityMarkers) appState.layers.facilityMarkers.forEach(m => m.remove());
  appState.layers.facilityMarkers = [];

  if (!deduped.length) {
    if (lastBadStatus) {
      cardEl.classList.remove("hidden");
      listEl.innerHTML = `<div class="text-[11px] text-amber-600 dark:text-amber-400">${_googleApiErrorMessage("Places", lastBadStatus)}</div>`;
    } else {
      cardEl.classList.add("hidden");
    }
    return;
  }

  cardEl.classList.remove("hidden");
  listEl.innerHTML = deduped.map((place, i) => `
    <div class="flex items-center justify-between p-1.5 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 cursor-pointer hover:border-rose-400" data-facility-idx="${i}">
      <div>
        <div class="font-semibold text-slate-800 dark:text-slate-200">${place.name}</div>
        <div class="text-[10px] text-slate-500">${place.vicinity || "Emergency medical facility"} • Near selected route</div>
      </div>
      <i class="fa-solid fa-location-crosshairs text-rose-400"></i>
    </div>
  `).join("");

  appState.layers.facilityMarkers = deduped.map(place => appState.mapProvider.addMarker(
    appState.routeMap, place.geometry.location.lat(), place.geometry.location.lng(),
    { divHtml: `<div class="w-6 h-6 rounded-full bg-white border-2 border-rose-500 text-rose-500 flex items-center justify-center text-[10px] shadow-lg"><i class="fa-solid fa-hospital"></i></div>`, size: [24, 24], anchor: [12, 12], color: "#f43f5e", radius: 20 },
    `<strong>${place.name}</strong><br>${place.vicinity || ""}`
  ));

  listEl.querySelectorAll("[data-facility-idx]").forEach(el => {
    el.addEventListener("click", () => {
      const place = deduped[parseInt(el.dataset.facilityIdx, 10)];
      appState.mapProvider.setView(appState.routeMap, place.geometry.location.lat(), place.geometry.location.lng(), 15);
    });
  });
}

function renderRoadRiskList() {
  const container = document.getElementById("roadRiskList");
  if (!container) return;
  container.innerHTML = "";

  appState.roads.forEach(road => {
    const isBlocked = appState.blockedRoadIds.includes(road.id);
    const category = RiskEngine.getRiskCategory(road.risk_score);

    const div = document.createElement("div");
    div.className = "bg-slate-100 dark:bg-slate-950 p-2 rounded-lg border border-slate-200 dark:border-slate-800 flex items-center justify-between hover:border-slate-400 transition cursor-pointer";
    div.onclick = () => {
      if (appState.map && road.coords && road.coords.length > 0) {
        appState.mapProvider.fitBounds(appState.map, road.coords, [60, 60]);
      }
    };

    div.innerHTML = `
      <div class="space-y-0.5">
        <div class="font-outfit font-bold text-slate-800 dark:text-slate-200 text-xs flex items-center space-x-1.5">
          <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background:${isBlocked ? '#ef4444' : category.color}"></span>
          <span class="truncate max-w-[200px]">${road.name}</span>
        </div>
        <div class="text-[10px] text-slate-500">Rain: ${road.rainfall_mm_last_6h}mm • Bridge: ${road.bridge_load_limit || 40}T</div>
      </div>
      <span class="text-xs font-mono font-extrabold px-2 py-0.5 rounded-full" style="background:${category.color}20; color:${category.color}">
        ${isBlocked ? "BLOCKED" : road.risk_score}
      </span>
    `;
    container.appendChild(div);
  });
}

function renderReportsList() {
  const container = document.getElementById("reportsList");
  if (!container) return;
  container.innerHTML = "";

  if (!appState.reports.length) {
    container.innerHTML = `<div class="text-slate-400 text-[11px] col-span-2">No citizen reports yet. Submit one from the Vision AI Photo page.</div>`;
    return;
  }

  appState.reports.forEach(rep => {
    const div = document.createElement("div");
    div.className = "bg-slate-100 dark:bg-slate-950 p-2 rounded-lg border border-slate-200 dark:border-slate-800 space-y-1 text-xs";
    const createdAt = rep.created_at ? new Date(rep.created_at).toLocaleTimeString() : "Just now";
    div.innerHTML = `
      <div class="flex items-center justify-between font-bold">
        <span class="text-rose-500">${rep.report_type}</span>
        <span class="text-[10px] text-slate-400">${createdAt}</span>
      </div>
      <div class="text-[11px] text-slate-600 dark:text-slate-300">
        Trust Score: <strong class="text-amber-500">${rep.trust_score} / 100</strong> (${rep.status})
      </div>
    `;
    container.appendChild(div);
  });
}

function renderVolunteersList() {
  const container = document.getElementById("volunteerList");
  if (!container) return;
  container.innerHTML = "";

  appState.volunteers.forEach(vol => {
    const div = document.createElement("div");
    div.className = "bg-slate-100 dark:bg-slate-950 p-2 rounded-lg border border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs";
    div.innerHTML = `
      <div>
        <span class="font-bold text-slate-800 dark:text-slate-200 block">${vol.name}</span>
        <span class="text-[10px] text-teal-600 dark:text-teal-400 capitalize">${vol.vehicle_type} • Hub: ${vol.location_hub}</span>
      </div>
      <span class="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full ${vol.status === 'available' ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300' : 'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300'}">
        ${vol.status}
      </span>
    `;
    container.appendChild(div);
  });
}

function renderReliefCampsList() {
  const container = document.getElementById("reliefCampsList");
  if (!container) return;
  container.innerHTML = "";

  appState.camps.forEach(camp => {
    const occ = CampBroadcastEngine.getCampOccupancyStatus(camp);
    const div = document.createElement("div");
    div.className = "bg-slate-100 dark:bg-slate-950 p-2 rounded-lg border border-slate-200 dark:border-slate-800 space-y-1 text-xs";
    div.innerHTML = `
      <div class="flex justify-between font-bold">
        <span class="text-cyan-600 dark:text-cyan-300 truncate max-w-[200px]">${camp.name}</span>
        <span style="color:${occ.color}">${occ.status_label}</span>
      </div>
      <div class="text-[11px] text-slate-500 flex justify-between">
        <span>Beds Open: <strong class="text-emerald-500">${occ.open_beds}</strong></span>
        <span>Medical Staff: ${camp.medical_staff_present ? 'Yes' : 'No'}</span>
      </div>
    `;
    container.appendChild(div);
  });
}

function renderGPSFleetList() {
  const container = document.getElementById("gpsFleetList");
  if (!container) return;
  container.innerHTML = "";

  if (!appState.vehicles.length) {
    container.innerHTML = `<div class="text-slate-400 text-xs col-span-3">No vehicles returned by backend (/api/gis/vehicles).</div>`;
    return;
  }

  appState.vehicles.forEach(veh => {
    const p = veh.properties;
    const [lng, lat] = veh.geometry.coordinates;
    const statusColor = p.status === "IN_TRANSIT" ? "bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400"
      : p.status === "DELAYED" ? "bg-amber-100 dark:bg-amber-950 text-amber-600 dark:text-amber-400"
      : "bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300";
    const div = document.createElement("div");
    div.className = "bg-slate-100 dark:bg-slate-950 p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 space-y-1 text-xs cursor-pointer hover:border-emerald-400 transition";
    div.onclick = () => {
      if (appState.map) appState.mapProvider.setView(appState.map, lat, lng, 10);
    };
    div.innerHTML = `
      <div class="flex justify-between font-bold text-slate-800 dark:text-slate-200">
        <span>${p.vehicle_number} <span class="text-slate-400 font-normal">(${p.id})</span></span>
        <span class="text-[10px] font-mono px-1.5 py-0.5 rounded ${statusColor}">${p.status}</span>
      </div>
      <div class="text-[11px] text-slate-500 flex justify-between">
        <span>Type: <strong class="text-slate-700 dark:text-slate-300">${p.vehicle_type}</strong></span>
        <span>Dest: ${p.destination || "—"}</span>
      </div>
      <div class="text-[9px] text-slate-400">Last update: ${p.last_updated ? new Date(p.last_updated).toLocaleTimeString() : "—"} • ${lat.toFixed(3)}, ${lng.toFixed(3)}</div>
    `;
    container.appendChild(div);
  });
}

function initMapAICopilot() {
  const form = document.getElementById("aiQueryForm");
  const input = document.getElementById("aiQueryInput");
  const box = document.getElementById("aiResponseBox");
  const toggleBtn = document.getElementById("btnMapAiToggle");
  const drawer = document.getElementById("aiDrawer");
  const closeBtn = document.getElementById("closeAiDrawerBtn");

  if (toggleBtn && drawer) {
    toggleBtn.addEventListener("click", () => {
      drawer.classList.toggle("hidden");
    });
  }

  if (closeBtn && drawer) {
    closeBtn.addEventListener("click", () => {
      drawer.classList.add("hidden");
    });
  }

  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const query = input.value;
    if (!query) return;

    box.innerText = "⏳ Map AI is analyzing spatial road data...";
    const answer = await MapAIEngine.processQuery(query, appState);
    box.innerHTML = answer;
    input.value = "";
  });
}

function initEventListeners() {
  // District Connectivity Matrix Modal
  const matrixBtn = document.getElementById("btnStateMatrix");
  const matrixModal = document.getElementById("districtMatrixModal");
  const closeMatrixBtn = document.getElementById("closeMatrixModalBtn");

  if (matrixBtn && matrixModal) {
    matrixBtn.addEventListener("click", () => matrixModal.classList.remove("hidden"));
  }
  if (closeMatrixBtn && matrixModal) {
    closeMatrixBtn.addEventListener("click", () => matrixModal.classList.add("hidden"));
  }

  // Feature 1: Recalculate Risk Cron Job (backend RiskEngineService is authoritative;
  // this used to call the client-side RiskEngine engine directly, bypassing the backend)
  const recalcBtn = document.getElementById("recalcRiskBtn");
  if (recalcBtn) {
    recalcBtn.addEventListener("click", async () => {
      const res = await Api.risk.recalculate();
      if (res.ok) {
        await fetchLiveRoadsFromBackend();
        drawRoadNetworkOnMap();
        renderRoadRiskList();
        calculateAndDrawRoute();
        fetchLiveSummaryKPIs();
        alert("✅ Backend Risk Recalculation Triggered! Scores refreshed from server.");
      } else if (res.status === 0) {
        console.warn("Backend risk recalculation unreachable:", res.error);
        calculateAllRoadRisks();
        drawRoadNetworkOnMap();
        renderRoadRiskList();
        alert("⚠️ Backend unreachable — showed local fallback estimate instead.");
      } else {
        alert(`❌ Risk recalculation failed: ${res.error}`);
      }
    });
  }

  // Feature 2: Predictive Forecast Check — real backend ML prediction (/api/risk/predict-ml)
  const predCheckBtn = document.getElementById("runPredictiveCheckBtn");
  if (predCheckBtn) {
    predCheckBtn.addEventListener("click", async () => {
      const log = document.getElementById("predictiveAlertLog");
      const res = await Api.risk.predictMl();
      if (!res.ok) {
        if (log) {
          log.classList.remove("hidden");
          log.innerText = `❌ Predictive check failed: ${res.error}`;
        }
        alert(`❌ Predictive Disruption Check failed: ${res.error}`);
        return;
      }
      const d = res.data;
      if (log) {
        log.classList.remove("hidden");
        log.innerText = `🤖 [ML PREDICTION] ${d.prediction} (confidence ${(d.confidence * 100).toFixed(0)}%)\nFactors: rainfall ${d.factors.rainfall_weight * 100}%, landslide ${d.factors.landslide_weight * 100}%, flood ${d.factors.flood_weight * 100}%, incidents ${d.factors.incidents_weight * 100}%, road condition ${d.factors.road_condition_weight * 100}%`;
      }
      alert(`🤖 Backend ML Disruption Prediction: ${d.prediction} (${(d.confidence * 100).toFixed(0)}% confidence)`);
    });
  }

  // Feature 3: Route Calculation
  const calcBtn = document.getElementById("calcRouteBtn");
  if (calcBtn) calcBtn.addEventListener("click", calculateAndDrawRoute);

  // Feature 5: Vision AI Report Form — client Vision AI simulation for severity/fraud-hash
  // (no real vision model integrated), but the report itself is now REALLY persisted via
  // POST /api/reports, so it appears in the DB, the Crowd Trust Score page, and the map
  // for every client — not just this browser tab.
  const reportForm = document.getElementById("reportForm");
  if (reportForm) {
    reportForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const roadId = document.getElementById("reportRoadSelect").value;
      const type = document.getElementById("reportTypeSelect").value;
      const role = document.getElementById("reporterRole").value;
      const photoInput = document.getElementById("reportPhotoInput");

      const road = appState.roads.find(r => r.id === roadId);
      if (!road) return;

      const dummyPhoto = photoInput.files.length > 0
        ? URL.createObjectURL(photoInput.files[0])
        : "https://images.unsplash.com/photo-1541888946425-d0fbb186a5b3?w=500&q=80";

      const visionResult = await VisionAIEngine.analyzeDamagePhoto(dummyPhoto, type, appState.reports);

      const res = await Api.reports.create({
        report_type: type,
        latitude: road.coords[0][0] + 0.05,
        longitude: road.coords[0][1] + 0.05,
        description: visionResult.description,
        reporter_role: role,
        photo_url: dummyPhoto
      });

      if (!res.ok) {
        alert(`❌ Report submission failed: ${res.error}`);
        return;
      }

      await fetchLiveReportsFromBackend();
      drawReportMarkersOnMap();
      renderReportsList();

      alert(`✅ Report Submitted to Backend!\nVision AI Severity (local demo): ${visionResult.ai_severity}\nHash Fingerprint: ${visionResult.photo_hash}\nBackend Trust Score: ${res.data.trust_score}/100 (${res.data.status})`);
    });
  }

  // Feature 6: SMS Parser & IVR
  const parseSmsBtn = document.getElementById("parseSmsBtn");
  if (parseSmsBtn) {
    parseSmsBtn.addEventListener("click", () => {
      const str = document.getElementById("smsInput").value;
      const res = SmsIvrEngine.parseSMS(str);
      const out = document.getElementById("smsOutput");
      if (out) {
        out.classList.remove("hidden");
        out.innerText = JSON.stringify(res, null, 2);
      }
    });
  }

  document.querySelectorAll(".ivr-key").forEach(btn => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.key;
      const response = SmsIvrEngine.handleIVRKeyPress(key);
      const ivrText = document.getElementById("ivrText");
      if (ivrText) ivrText.innerText = response.audioPrompt;
    });
  });

  // Feature 7: Bluetooth Mesh Hop
  const meshHopBtn = document.getElementById("triggerMeshHopBtn");
  if (meshHopBtn) {
    meshHopBtn.addEventListener("click", () => {
      const res = MeshRelaySimulator.simulateHop();
      alert(`📶 ${res.message}`);
    });
  }

  // Feature 8: Vulnerable Convoy Optimization
  // Ranking algorithm itself is a local demo VRP (RELIEF_VEHICLES has no backend model —
  // see backend/app/models/models.py Vehicle, which has no capacity/hub fields to match it).
  // The registered vulnerable-citizen count shown alongside it is real (/api/vulnerable).
  const dispatchBtn = document.getElementById("optimizeDispatchBtn");
  if (dispatchBtn) {
    dispatchBtn.addEventListener("click", () => {
      const assignments = DispatchOptimizer.optimizeConvoys(NER_NODES, RELIEF_VEHICLES);
      alert(`✅ [DEMO ALGORITHM] Convoy Dispatch Queue Ranked! Prioritized ${assignments.length} units matching vulnerable citizen tags.`);
    });
  }

  // Feature 9: Volunteer Registration
  const volForm = document.getElementById("volunteerRegForm");
  if (volForm) {
    volForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const name = document.getElementById("volName").value;
      const type = document.getElementById("volType").value;
      if (!name) return;
      CommunityPoolEngine.registerVolunteer(appState.volunteers, {
        name: name,
        contact: "+91 98000-XXXXX",
        vehicle_type: type,
        location_hub: "shillong"
      });
      renderVolunteersList();
      alert(`✅ PostGIS Distance Match: ${name} (${type}) registered to Shillong Pool!`);
      document.getElementById("volName").value = "";
    });
  }

  // Feature 10: Area Emergency Cell Broadcast — hybrid: a REAL Alert is persisted and
  // WebSocket-broadcast via the backend (/api/alerts), then the simulated cell-tower reach
  // estimate is shown as a clearly-labeled illustration of what a real telecom Cell
  // Broadcast integration would additionally deliver.
  const bcastBtn = document.getElementById("sendBroadcastBtn");
  if (bcastBtn) {
    bcastBtn.addEventListener("click", async () => {
      const message = "FLASH FLOOD WARNING: All citizens proceed to nearest designated Relief Camp immediately!";
      const alertRes = await Api.alerts.create({
        title: "AREA EMERGENCY BROADCAST",
        message,
        alert_type: "EMERGENCY",
        severity: "CRITICAL",
        target_area: "Barak Valley (Silchar)"
      });
      const simulated = CampBroadcastEngine.triggerEmergencyBroadcast("Barak Valley (Silchar)", message);
      const log = document.getElementById("broadcastResultLog");
      if (log) {
        log.classList.remove("hidden");
        log.innerText = `${alertRes.ok ? "✅ REAL: Alert #" + alertRes.data.id + " persisted + WebSocket broadcast" : "❌ REAL alert failed: " + alertRes.error}\n\n[SIMULATED cell-tower reach] ${simulated.sent_at} ${simulated.severity}\nTarget: ${simulated.target_district}\nReach: ${simulated.estimated_reach}\nStatus: ${simulated.status}`;
      }
      fetchAndRenderAlerts();
      alert(alertRes.ok
        ? `🚨 Real alert broadcast via backend + WebSocket.\n(Cell-tower reach of ${simulated.estimated_reach} is a simulated illustration — no telecom integration exists.)`
        : `❌ Alert broadcast failed: ${alertRes.error}`);
    });
  }

  // Emergency SOS — real backend alert (+ real browser GPS if the user grants permission),
  // reported through every NotificationChannels channel so the UI can show honestly which
  // ones actually delivered (WebSocket) vs are simulated/hardware-future.
  const sosBtn = document.getElementById("btnEmergencySos");
  if (sosBtn) {
    sosBtn.addEventListener("click", async () => {
      const sendSos = async (lat, lng) => {
        const res = await Api.alerts.create({
          title: "EMERGENCY SOS ACTIVATED",
          message: lat != null
            ? `Emergency SOS triggered from device location (${lat.toFixed(4)}, ${lng.toFixed(4)}). Nearest response units should be dispatched.`
            : "Emergency SOS triggered (device location unavailable).",
          alert_type: "EMERGENCY",
          severity: "CRITICAL",
          target_area: "NER Grid"
        });
        const channelResults = NotificationChannels.broadcastAlert({ emergency_type: "SOS", message: "Emergency SOS activated" });
        const channelSummary = channelResults.map(c => `${c.channel} [${c.kind}]: ${c.delivered ? "delivered" : (c.attempted ? "attempted (not delivered)" : "skipped — " + (c.reason || "unavailable"))}`).join("\n");
        fetchAndRenderAlerts();
        alert(res.ok
          ? `🚨 EMERGENCY SOS sent to backend (Alert #${res.data.id}).\n\nChannel status:\n${channelSummary}`
          : `❌ EMERGENCY SOS FAILED to reach backend: ${res.error}\n\nIt has NOT been queued offline automatically — use the Offline Emergency Queue panel on the Live Map page if you are without connectivity.`);
      };

      if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition(
          pos => sendSos(pos.coords.latitude, pos.coords.longitude),
          () => sendSos(null, null),
          { timeout: 4000 }
        );
      } else {
        sendSos(null, null);
      }
    });
  }

  // Judge Hackathon Demo Controls (Real Backend APIs & WebSocket Broadcasts)
  const simLandslideBtn = document.getElementById("demoSimLandslideBtn");
  if (simLandslideBtn) {
    simLandslideBtn.addEventListener("click", async () => {
      const res = await Api.simulate.landslide();
      if (res.ok) {
        const data = res.data;
        alert(`⛰️ LANDSLIDE SIMULATED END-TO-END!\n\n• Incident created in DB\n• Corridor ${data.affected_road} risk elevated to 95.0 (BLOCKED)\n• Emergency Alert Broadcasted: "${data.alert_title}"\n• WebSocket event pushed to all GIS clients!`);
        await fetchLiveRoadsFromBackend();
        await fetchGisLayers();
        drawRoadNetworkOnMap();
        drawIncidentsOnMap();
        renderRoadRiskList();
        calculateAndDrawRoute();
        fetchLiveSummaryKPIs();
        fetchAndRenderAlerts();
      } else {
        alert(`❌ Landslide simulation failed: ${res.error}`);
      }
    });
  }

  const simRainBtn = document.getElementById("demoSimRainBtn");
  if (simRainBtn) {
    simRainBtn.addEventListener("click", async () => {
      const res = await Api.risk.recalculate();
      if (res.ok) {
        alert(`🌧️ MONSOON HEAVY RAINFALL SIMULATED!\n\n• Open-Meteo precipitation stream updated (+120mm/6h)\n• Backend Risk Engine recalculated all 12 NER National Highway corridors\n• Road risk scores updated dynamically!`);
        await fetchLiveRoadsFromBackend();
        drawRoadNetworkOnMap();
        renderRoadRiskList();
        calculateAndDrawRoute();
        fetchLiveSummaryKPIs();
      } else {
        alert(`❌ Rain simulation failed: ${res.error}`);
      }
    });
  }

  // SIMULATED movement path (no physical GPS tracker on this vehicle) writing to the
  // REAL backend vehicle-location endpoint — every write is real, the motion is scripted.
  const simVehicleBtn = document.getElementById("demoSimVehicleBtn");
  if (simVehicleBtn) {
    simVehicleBtn.addEventListener("click", () => {
      const vehicleId = "VEH-MED-01";
      const simCoords = [
        { lat: 26.1445, lng: 91.7362 },
        { lat: 25.9000, lng: 91.8000 },
        { lat: 25.5788, lng: 91.8933 },
        { lat: 25.1000, lng: 92.5000 },
        { lat: 24.8333, lng: 92.7789 }
      ];
      let step = 0;
      const interval = setInterval(async () => {
        if (step >= simCoords.length) {
          clearInterval(interval);
          alert("🚚 [SIMULATED PATH] GPS Medical Supply Convoy VEH-MED-01 arrived safely at Silchar Hospital!");
          return;
        }
        const pt = simCoords[step];
        const res = await Api.vehicles.updateLocation(vehicleId, { latitude: pt.lat, longitude: pt.lng, status: "IN_TRANSIT" });
        if (res.ok) {
          fetchGisLayers().then(() => { drawVehiclesOnMap(); renderGPSFleetList(); });
        }
        step++;
      }, 1500);
      alert("🚚 [SIMULATED MOVEMENT PATH] GPS Vehicle Telemetry Started!\n\nNo physical GPS tracker exists on this vehicle — this button drives a scripted route, but every position update is a REAL write to the backend (/api/vehicles/{id}/location) and broadcasts over WebSocket. Watch the vehicle marker move on the map canvas!");
    });
  }

  const resolveIncBtn = document.getElementById("demoResolveIncBtn");
  if (resolveIncBtn) {
    resolveIncBtn.addEventListener("click", async () => {
      const incRes = await Api.incidents.list();
      if (!incRes.ok) {
        alert(`❌ Could not load incidents: ${incRes.error}`);
        return;
      }
      const incidents = incRes.data;
      if (!incidents.length) {
        alert("No active unresolved incidents found in database.");
        return;
      }
      const target = incidents[0];
      const res = await Api.incidents.resolve(target.id);
      if (res.ok) {
        alert(`✅ DISASTER INCIDENT RESOLVED!\n\n• Incident #${target.id} (${target.type}) marked RESOLVED\n• Nearby road risk scores restored\n• Highway status returned to SAFE/OPEN`);
        await fetchLiveRoadsFromBackend();
        await fetchGisLayers();
        drawRoadNetworkOnMap();
        drawIncidentsOnMap();
        renderRoadRiskList();
        calculateAndDrawRoute();
        fetchLiveSummaryKPIs();
      } else {
        alert(`❌ Resolve failed: ${res.error}`);
      }
    });
  }

  const simBtn = document.getElementById("btnSimMode");
  if (simBtn) {
    simBtn.addEventListener("click", async () => {
      const res = await Api.simulate.landslide();
      if (res.ok) {
        const data = res.data;
        alert(`⚡ END-TO-END DEMO SCENARIO TRIGGERED:\n${data.message}\nRoad ${data.affected_road} status changed to ${data.new_status}`);
        await fetchLiveRoadsFromBackend();
        drawRoadNetworkOnMap();
        renderRoadRiskList();
        calculateAndDrawRoute();
      } else if (res.status === 0) {
        appState.roads = RiskEngine.simulateWeatherSpike(appState.roads, 1.8);
        drawRoadNetworkOnMap();
        renderRoadRiskList();
        calculateAndDrawRoute();
        alert("⚠️ Backend unreachable — showed local fallback weather spike instead.");
      } else {
        alert(`❌ Simulation failed: ${res.error}`);
      }
    });
  }

  const voiceBtn = document.getElementById("btnVoiceMenu");
  if (voiceBtn) {
    voiceBtn.addEventListener("click", () => {
      alert("🎙️ [SIMULATED] Toll-Free IVR is architecturally defined (see SMS & IVR Access page) but no telephony provider is connected in this prototype — dialing 1800-SETU-NER would require a real carrier/IVR gateway integration.");
    });
  }
}

window.quickBlockRoad = function(roadId) {
  if (appState.blockedRoadIds.includes(roadId)) {
    appState.blockedRoadIds = appState.blockedRoadIds.filter(id => id !== roadId);
  } else {
    appState.blockedRoadIds.push(roadId);
  }
  drawRoadNetworkOnMap();
  renderRoadRiskList();
  calculateAndDrawRoute();
};

window.fetchRoadRiskBreakdown = async function(roadId) {
  const res = await Api.risk.roadBreakdown(roadId);
  if (!res.ok) {
    // Was previously a fake "calculated dynamically" success message even when this
    // request failed — now shows the real failure so a dead backend isn't mistaken for a result.
    alert(`❌ Could not load risk breakdown for ${roadId}: ${res.error}`);
    return;
  }
  const data = res.data;
  const b = data.breakdown;
  alert(`📊 EXPLAINABLE RISK BREAKDOWN: ${data.name} (#${data.road_id})\n` +
        `Final Risk Score: ${data.final_risk_score} / 100 (${data.status})\n\n` +
        `• 35% Rainfall Risk: Score ${b.rainfall_risk.score} (${b.rainfall_risk.value})\n` +
        `• 25% Landslide Susceptibility: Score ${b.landslide_risk.score}\n` +
        `• 15% Flood Inundation Risk: Score ${b.flood_risk.score}\n` +
        `• 15% Recent Incident Risk: Score ${b.incident_risk.score} (${b.incident_risk.value})\n` +
        `• 10% Road & Bridge Condition: Score ${b.road_condition.score} (${b.road_condition.value})\n\n` +
        `Last Updated: ${new Date(data.last_updated).toLocaleString()}`);
};

/**
 * Offline-First Emergency Communication Queue UI (Phase 3, section 12).
 * STORE (localStorage, real) -> CARRY (survives offline time) -> FORWARD/DELIVER
 * (real POST /api/incidents once online). Connectivity badge only ever reports what
 * navigator.onLine + actual sync attempts observe — never hardcodes "ONLINE".
 */
let _offlineSyncInFlight = false;
let _lastSyncAt = null;

function _renderOfflineQueueStatus() {
  const pendingEl = document.getElementById("offlineQueuePendingCount");
  const lastSyncEl = document.getElementById("offlineQueueLastSync");
  if (pendingEl) pendingEl.innerText = `${OfflineQueue.getPending().length} pending`;
  if (lastSyncEl) lastSyncEl.innerText = _lastSyncAt ? `Last sync: ${_lastSyncAt.toLocaleTimeString()}` : "Last sync: never";
}

function _setConnectivityBadge(state) {
  const el = document.getElementById("connectivityStatus");
  if (!el) return;
  const styles = {
    ONLINE: "font-bold px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800",
    OFFLINE: "font-bold px-1.5 py-0.5 rounded bg-rose-950 text-rose-300 border border-rose-800",
    SYNCING: "font-bold px-1.5 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-800"
  };
  el.innerText = state;
  el.className = styles[state] || styles.OFFLINE;
}

async function attemptOfflineQueueSync() {
  if (_offlineSyncInFlight) return;
  if (!navigator.onLine) {
    _setConnectivityBadge("OFFLINE");
    return;
  }
  const pending = OfflineQueue.getPending();
  if (!pending.length) {
    _setConnectivityBadge("ONLINE");
    return;
  }
  _offlineSyncInFlight = true;
  _setConnectivityBadge("SYNCING");
  const result = await OfflineQueue.sync();
  _lastSyncAt = new Date();
  _offlineSyncInFlight = false;
  _setConnectivityBadge(navigator.onLine ? "ONLINE" : "OFFLINE");
  _renderOfflineQueueStatus();
  if (result.delivered > 0) {
    await fetchGisLayers();
    drawIncidentsOnMap();
  }
  return result;
}

function initOfflineQueueUI() {
  _setConnectivityBadge(navigator.onLine ? "ONLINE" : "OFFLINE");
  _renderOfflineQueueStatus();

  window.addEventListener("online", () => attemptOfflineQueueSync());
  window.addEventListener("offline", () => _setConnectivityBadge("OFFLINE"));

  const queueBtn = document.getElementById("offlineQueueBtn");
  if (queueBtn) {
    queueBtn.addEventListener("click", () => {
      const type = document.getElementById("offlineMsgType").value;
      const priority = document.getElementById("offlineMsgPriority").value;
      const textEl = document.getElementById("offlineMsgText");
      const text = textEl.value.trim();
      if (!text) {
        alert("Enter a short emergency message before queuing.");
        return;
      }

      const queueIt = (lat, lng) => {
        const entry = OfflineQueue.enqueue({
          emergency_type: type,
          severity: priority === "CRITICAL" ? "IMPASSABLE" : (priority === "HIGH" ? "SEVERE" : "MODERATE"),
          message: text,
          location: lat != null ? { lat, lng } : null,
          priority
        });
        textEl.value = "";
        _renderOfflineQueueStatus();
        alert(`📥 Message ${entry.id} stored locally (device ${entry.sender_device_id}).\nIt will forward to the backend automatically once online, or press "Sync Now".`);
        attemptOfflineQueueSync();
      };

      if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition(
          pos => queueIt(pos.coords.latitude, pos.coords.longitude),
          () => queueIt(null, null),
          { timeout: 3000 }
        );
      } else {
        queueIt(null, null);
      }
    });
  }

  const syncBtn = document.getElementById("offlineSyncBtn");
  if (syncBtn) {
    syncBtn.addEventListener("click", async () => {
      if (!navigator.onLine) {
        alert("⚠️ Device reports OFFLINE — cannot sync until connectivity returns. Messages remain safely queued locally.");
        return;
      }
      const result = await attemptOfflineQueueSync();
      if (!result) return;
      if (result.delivered === 0 && result.remaining > 0) {
        alert(`❌ Sync failed — backend unreachable. ${result.remaining} message(s) remain queued.`);
      } else {
        alert(`✅ Synced ${result.delivered} message(s) to backend. ${result.remaining} remaining.`);
      }
    });
  }

  // Best-effort periodic retry — never claims delivery it can't verify.
  setInterval(() => attemptOfflineQueueSync(), 30000);
}
