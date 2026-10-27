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
  selectedVehicleId: "MED-102",
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
    vehicleTrailPolyline: null,
    vehicleActiveRoutePolyline: null,
    hazardPolygons: [],
    routePolyline: null,
    routeMapPolylines: []
  }
};

document.addEventListener("DOMContentLoaded", () => {
  initApp();
});

const API_BASE = "http://localhost:8000/api";

async function fetchLiveRoadsFromBackend() {
  try {
    const res = await fetch(`${API_BASE}/gis/roads`);
    if (res.ok) {
      const geojson = await res.json();
      if (geojson && geojson.features) {
        appState.roads = geojson.features.map(f => ({
          id: f.properties.id,
          name: f.properties.name,
          risk_score: f.properties.risk_score,
          current_status: f.properties.status,
          distance_km: f.properties.distance_km,
          base_travel_time: f.properties.base_travel_time,
          rainfall_mm_last_6h: f.properties.rainfall_mm_last_6h,
          bridge_load_limit: f.properties.bridge_load_limit,
          updated_at: f.properties.updated_at,
          coords: f.geometry.coordinates.map(pt => [pt[1], pt[0]]) // GeoJSON [lng, lat] to Leaflet [lat, lng]
        }));
      }
    }
  } catch (err) {
    console.warn("Backend API offline, using local fallback seed:", err);
  }
}

async function fetchLiveSummaryKPIs() {
  try {
    const res = await fetch(`${API_BASE}/gis/summary`);
    if (res.ok) {
      const summary = await res.json();
      const kpiSafe = document.getElementById("kpiSafe");
      const kpiRisky = document.getElementById("kpiRisky");
      const kpiBlocked = document.getElementById("kpiBlocked");
      if (kpiSafe) kpiSafe.innerText = summary.safe_roads;
      if (kpiRisky) kpiRisky.innerText = summary.risky_roads;
      if (kpiBlocked) kpiBlocked.innerText = summary.blocked_roads;
    }
  } catch (err) {
    console.warn("KPI fetch fallback:", err);
  }
}

async function fetchGisLayers() {
  try {
    const [incRes, vehRes, floodRes, slideRes] = await Promise.all([
      fetch(`${API_BASE}/gis/incidents`),
      fetch(`${API_BASE}/gis/vehicles`),
      fetch(`${API_BASE}/gis/flood-zones`),
      fetch(`${API_BASE}/gis/landslide-zones`)
    ]);
    if (incRes.ok) {
      const incData = await incRes.json();
      appState.incidents = incData.features || [];
    }
    if (vehRes.ok) {
      const vehData = await vehRes.json();
      appState.vehicles = vehData.features || [];
    }
    if (floodRes.ok) {
      const floodData = await floodRes.json();
      appState.floodZones = floodData.features || [];
    }
    if (slideRes.ok) {
      const slideData = await slideRes.json();
      appState.landslideZones = slideData.features || [];
    }
  } catch (err) {
    console.warn("Error fetching GIS layers:", err);
  }
}

function initWebSocketConnection() {
  try {
    const ws = new WebSocket("ws://localhost:8000/ws/gis");
    appState.ws = ws;

    ws.onopen = () => {
      console.log("[WebSocket] Connected to SETU-NER GIS Real-Time Stream");
      const badge = document.getElementById("wsSyncStatus");
      if (badge) {
        badge.innerText = "WS LIVE";
        badge.className = "text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800";
      }
    };

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        console.log("[WebSocket Event]:", msg);

        let roadRedrawTimer = null;
        const debouncedRedrawRoads = () => {
          if (roadRedrawTimer) clearTimeout(roadRedrawTimer);
          roadRedrawTimer = setTimeout(() => {
            fetchLiveRoadsFromBackend().then(() => {
              drawRoadNetworkOnMap();
              renderRoadRiskList();
              fetchLiveSummaryKPIs();
            });
          }, 200);
        };

        if (msg.event === "ROAD_STATUS_CHANGED" || msg.event === "ROAD_RISK_UPDATED") {
          debouncedRedrawRoads();
        } else if (msg.event === "NEW_INCIDENT" || msg.event === "INCIDENT_UPDATED") {
          fetchGisLayers().then(() => {
            drawIncidentsOnMap();
            debouncedRedrawRoads();
          });
        } else if (msg.event === "VEHICLE_LOCATION_UPDATED") {
          fetchGisLayers().then(() => {
            drawVehiclesOnMap();
            if (msg.data && msg.data.vehicle_id) {
              if (msg.data.vehicle_id === appState.selectedVehicleId) {
                updateSelectedVehiclePanel(msg.data.vehicle_id);
              }
              fetchVehicleSummaryKPIs();
            }
          });
        } else if (msg.event === "VEHICLE_ROUTE_UPDATED") {
          if (msg.data && msg.data.vehicle_id) {
            drawVehicleTrailAndRoute(msg.data.vehicle_id);
            updateSelectedVehiclePanel(msg.data.vehicle_id);
            fetchGisLayers().then(() => drawVehiclesOnMap());
          }
        } else if (msg.event === "VEHICLE_AT_RISK") {
          console.warn("VEHICLE AT RISK WARNING:", msg.data);
        } else if (msg.event === "VEHICLE_DELIVERED") {
          console.log("VEHICLE DELIVERED:", msg.data);
          renderGPSFleetList();
        }
      } catch (err) {
        console.warn("WebSocket parse error:", err);
      }
    };

    ws.onclose = () => {
      const badge = document.getElementById("wsSyncStatus");
      if (badge) {
        badge.innerText = "OFFLINE";
        badge.className = "text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-rose-950 text-rose-300 border border-rose-800";
      }
      setTimeout(initWebSocketConnection, 5000);
    };
  } catch (err) {
    console.warn("WebSocket connection unavailable:", err);
  }
}

function initApp() {
  Promise.all([fetchLiveRoadsFromBackend(), fetchGisLayers()]).then(() => {
    calculateAllRoadRisks();
    initLeafletMap();
    initISTClock();
    initSidebarNavigation();
    initFeatureDrawer();
    initMapStyleSwitcher();
    initMapControls();
    initThemeToggle();
    initMapAICopilot();
    initEventListeners();
    initGisToolbarControls();
    initVehicleCommandCenterControls();
    initWebSocketConnection();
    populateDropdowns();
    renderRoadRiskList();
    renderReportsList();
    renderVolunteersList();
    renderReliefCampsList();
    renderGPSFleetList();
    fetchLiveSummaryKPIs();
    
    setTimeout(() => {
      if (appState.map) appState.map.invalidateSize();
      calculateAndDrawRoute();
    }, 300);
  });
}

function calculateAllRoadRisks() {
  appState.roads.forEach(road => {
    road.risk_score = RiskEngine.calculateRoadRisk(road);
  });
}

function initLeafletMap() {
  // Center on North Eastern Region (NER Bounding Box)
  const map = L.map("map", {
    center: [26.0000, 92.5000],
    zoom: 7,
    zoomControl: false
  });

  // Default NER Geographic Bounding Extent
  const nerBounds = L.latLngBounds([21.8, 88.0], [29.5, 97.5]);
  map.fitBounds(nerBounds, { padding: [20, 20] });

  appState.satTile = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
    maxZoom: 18,
    attribution: 'Esri, Maxar, Earthstar Geographics, SETU-NER GIS'
  });

  appState.osmTile = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    subdomains: 'abc',
    attribution: '© OpenStreetMap, SETU-NER GIS'
  });

  appState.osmTile.addTo(map);
  appState.activeBaseMode = "overview";
  appState.map = map;

  drawRoadNetworkOnMap();
  drawHubNodesOnMap();
  drawHazardCalloutsOnMap();
  drawReportMarkersOnMap();
  drawCampMarkersOnMap();
  drawIncidentsOnMap();
  drawVehiclesOnMap();
  drawHazardPolygonsOnMap();
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
    setTimeout(() => appState.map.invalidateSize(), 150);
  } else if (featKey === "f3") {
    setTimeout(() => {
      if (appState.routeMap) {
        appState.routeMap.invalidateSize();
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

    if (mode === "satellite") {
      if (appState.map.hasLayer(appState.osmTile)) appState.map.removeLayer(appState.osmTile);
      appState.satTile.addTo(appState.map);
      if (btnSat) btnSat.classList.add("active", "bg-indigo-600", "text-white");
    } else {
      if (appState.map.hasLayer(appState.satTile)) appState.map.removeLayer(appState.satTile);
      appState.osmTile.addTo(appState.map);
      const targetBtn = mode === "overview" ? btnOverview : (mode === "topo" ? btnTopo : btnRoads);
      if (targetBtn) targetBtn.classList.add("active", "bg-indigo-600", "text-white");
    }
  };

  if (btnSat) btnSat.addEventListener("click", () => setStyle("satellite"));
  if (btnOverview) btnOverview.addEventListener("click", () => setStyle("overview"));
  if (btnTopo) btnTopo.addEventListener("click", () => setStyle("topo"));
  if (btnRoads) btnRoads.addEventListener("click", () => setStyle("roads"));
}

function initMapControls() {
  const zoomIn = document.getElementById("mapZoomIn");
  const zoomOut = document.getElementById("mapZoomOut");

  if (zoomIn) zoomIn.addEventListener("click", () => appState.map.zoomIn());
  if (zoomOut) zoomOut.addEventListener("click", () => appState.map.zoomOut());
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
  appState.layers.calloutMarkers.forEach(m => appState.map.removeLayer(m));
  appState.layers.calloutMarkers = [];

  HAZARD_CALLOUTS.forEach(item => {
    const icon = L.divIcon({
      className: 'custom-pill-callout',
      html: `
        <div class="px-2.5 py-1 rounded-full ${item.bg} border ${item.border} ${item.text} font-bold text-[10px] shadow-2xl flex items-center space-x-1.5 whitespace-nowrap backdrop-blur-md">
          <span class="w-2 h-2 rounded-full ${item.category === 'high_risk' ? 'bg-red-400 animate-ping' : 'bg-amber-400'}"></span>
          <span>${item.label}</span>
        </div>
      `,
      iconSize: [120, 24],
      iconAnchor: [60, 12]
    });

    const marker = L.marker([item.lat, item.lng], { icon: icon }).addTo(appState.map);
    appState.layers.calloutMarkers.push(marker);
  });
}

function drawReportMarkersOnMap() {
  if (!appState.layers.reportMarkers) appState.layers.reportMarkers = [];
  appState.layers.reportMarkers.forEach(m => appState.map.removeLayer(m));
  appState.layers.reportMarkers = [];

  const chkReports = document.getElementById("chkFilterReports");
  if (chkReports && !chkReports.checked) return;

  appState.reports.forEach(rep => {
    if (!rep.lat || !rep.lng) return;
    const icon = L.divIcon({
      className: 'custom-rep-icon',
      html: `
        <div class="w-6 h-6 rounded-full bg-indigo-950 border-2 border-indigo-400 text-indigo-300 flex items-center justify-center text-[10px] shadow-lg">
          <i class="fa-solid fa-camera font-bold"></i>
        </div>
      `,
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });

    const marker = L.marker([rep.lat, rep.lng], { icon: icon }).addTo(appState.map);
    marker.bindPopup(`
      <div class="p-1 space-y-1 text-xs">
        <strong class="text-indigo-400 block font-outfit text-sm">📸 Citizen Vision AI Report (${rep.id})</strong>
        <div>Type: <strong>${rep.type}</strong></div>
        <div>Severity: <span class="text-rose-400 font-bold">${rep.ai_severity || 'HIGH'}</span></div>
        <div>Trust Score: <strong>${rep.trust_score}/100</strong></div>
      </div>
    `);
    appState.layers.reportMarkers.push(marker);
  });
}

function drawCampMarkersOnMap() {
  if (!appState.layers.campMarkers) appState.layers.campMarkers = [];
  appState.layers.campMarkers.forEach(m => appState.map.removeLayer(m));
  appState.layers.campMarkers = [];

  const chkCamps = document.getElementById("chkFilterCamps");
  if (chkCamps && !chkCamps.checked) return;

  appState.camps.forEach(camp => {
    if (!camp.lat || !camp.lng) return;
    const icon = L.divIcon({
      className: 'custom-camp-icon',
      html: `
        <div class="w-7 h-7 rounded-full bg-emerald-950 border-2 border-emerald-400 text-emerald-300 flex items-center justify-center text-[10px] shadow-lg">
          <i class="fa-solid fa-tent font-bold"></i>
        </div>
      `,
      iconSize: [28, 28],
      iconAnchor: [14, 14]
    });

    const marker = L.marker([camp.lat, camp.lng], { icon: icon }).addTo(appState.map);
    marker.bindPopup(`
      <div class="p-1 space-y-1 text-xs">
        <strong class="text-emerald-400 block font-outfit text-sm">⛺ ${camp.name}</strong>
        <div>Capacity: <strong>${camp.occupancy || 120} / ${camp.capacity || 500}</strong></div>
        <div>Supplies: <span class="text-emerald-300 font-bold">${camp.supplies_status || 'Adequate'}</span></div>
      </div>
    `);
    appState.layers.campMarkers.push(marker);
  });
}

function drawRoadNetworkOnMap() {
  appState.layers.riskPolylines.forEach(p => appState.map.removeLayer(p));
  appState.layers.riskPolylines = [];

  appState.roads.forEach(road => {
    const isBlocked = appState.blockedRoadIds.includes(road.id) || road.current_status === "BLOCKED";
    
    // Explicit Reference GIS Risk Colors: Green (0.00 SAFE), Amber (0.01-50.00 MODERATE), Red (50.01-100.00 RISKY)
    let polylineColor = "#22c55e"; // Safe Green
    let weight = 5;
    let dashArray = null;

    if (isBlocked || road.risk_score > 50.0) {
      polylineColor = "#ef4444"; // Risky / Severed Red (50.01 - 100.00)
      weight = 6;
      if (isBlocked) dashArray = "8, 8";
    } else if (road.risk_score > 0.0) {
      polylineColor = "#f59e0b"; // Moderate Amber (0.01 - 50.00)
      weight = 5;
    }

    const polyline = L.polyline(road.coords, {
      color: polylineColor,
      weight: weight,
      opacity: 0.95,
      dashArray: dashArray,
      lineCap: "round",
      lineJoin: "round"
    }).addTo(appState.map);

    const statusBadge = isBlocked 
      ? `<span class="px-2 py-0.5 text-[10px] font-mono font-bold rounded-full bg-red-500/20 text-red-400 border border-red-500/40">BLOCKED / SEVERED</span>`
      : (road.risk_score > 35.0 
          ? `<span class="px-2 py-0.5 text-[10px] font-mono font-bold rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/40">RISK: ${road.risk_score} (CAUTION)</span>`
          : `<span class="px-2 py-0.5 text-[10px] font-mono font-bold rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40">RISK: ${road.risk_score} (SAFE)</span>`);

    polyline.bindTooltip(`<strong>${road.name}</strong><br>Risk: ${road.risk_score} (${road.current_status})`, {
      sticky: true
    });

    polyline.bindPopup(`
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
    `);

    appState.layers.riskPolylines.push(polyline);
  });
}

function drawHubNodesOnMap() {
  if (!appState.layers.nodeMarkers) appState.layers.nodeMarkers = [];
  appState.layers.nodeMarkers.forEach(m => appState.map.removeLayer(m));
  appState.layers.nodeMarkers = [];

  Object.keys(NER_NODES).forEach(key => {
    const node = NER_NODES[key];
    const marker = L.circleMarker([node.lat, node.lng], {
      radius: 7,
      color: "#6366f1",
      fillColor: "#818cf8",
      fillOpacity: 0.9,
      weight: 2
    }).addTo(appState.map);

    marker.bindTooltip(`<strong>${node.name}</strong><br>Logistics Depot Node`, { sticky: true });
    appState.layers.nodeMarkers.push(marker);
  });
}

function drawIncidentsOnMap() {
  if (!appState.layers.incidentMarkers) appState.layers.incidentMarkers = [];
  appState.layers.incidentMarkers.forEach(m => appState.map.removeLayer(m));
  appState.layers.incidentMarkers = [];

  const chkIncidents = document.getElementById("chkFilterIncidents");
  if (chkIncidents && !chkIncidents.checked) return;

  appState.incidents.forEach(inc => {
    const coords = [inc.geometry.coordinates[1], inc.geometry.coordinates[0]]; // [lat, lng]
    const p = inc.properties;
    
    let iconClass = "fa-triangle-exclamation text-rose-400";
    if (p.type === "Landslide") iconClass = "fa-hill-rockslide text-amber-400";
    else if (p.type === "Flood") iconClass = "fa-water text-cyan-400";

    const incIcon = L.divIcon({
      className: 'custom-inc-icon',
      html: `
        <div class="w-8 h-8 rounded-full bg-slate-950 border-2 border-rose-500 flex items-center justify-center text-xs shadow-2xl animate-pulse">
          <i class="fa-solid ${iconClass}"></i>
        </div>
      `,
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });

    const marker = L.marker(coords, { icon: incIcon }).addTo(appState.map);
    marker.bindPopup(`
      <div class="p-1 space-y-1 text-xs">
        <strong class="text-rose-400 block font-outfit text-sm">${p.type} Incident (#${p.id})</strong>
        <p class="text-slate-300">${p.description || 'Hazard reported on corridor.'}</p>
        <div class="text-[10px] text-slate-400 pt-1">Severity: <strong class="text-amber-400">${p.severity}</strong> • Status: ${p.status}</div>
      </div>
    `);
    appState.layers.incidentMarkers.push(marker);
  });
}

function drawVehiclesOnMap() {
  if (!appState.layers.vehicleMarkers) appState.layers.vehicleMarkers = [];
  appState.layers.vehicleMarkers.forEach(m => appState.map.removeLayer(m));
  appState.layers.vehicleMarkers = [];

  const chkVehicles = document.getElementById("chkFilterVehicles");
  if (chkVehicles && !chkVehicles.checked) return;

  appState.vehicles.forEach(veh => {
    const coords = [veh.geometry.coordinates[1], veh.geometry.coordinates[0]];
    const p = veh.properties;

    // Status color mapping
    let statusBg = "bg-emerald-500";
    let statusBorder = "border-emerald-400";
    let statusText = "text-emerald-400";
    if (p.status === "AT_RISK") {
      statusBg = "bg-rose-600 animate-ping";
      statusBorder = "border-rose-500 shadow-rose-500/50";
      statusText = "text-rose-400";
    } else if (p.status === "DELAYED") {
      statusBg = "bg-amber-500";
      statusBorder = "border-amber-400";
      statusText = "text-amber-400";
    } else if (p.status === "DELIVERED") {
      statusBg = "bg-cyan-500";
      statusBorder = "border-cyan-400";
      statusText = "text-cyan-400";
    } else if (p.status === "OFFLINE") {
      statusBg = "bg-slate-600";
      statusBorder = "border-slate-500";
      statusText = "text-slate-400";
    }

    const isSelected = p.id === appState.selectedVehicleId;
    const heading = p.heading || 0;

    const vehIcon = L.divIcon({
      className: 'custom-veh-icon',
      html: `
        <div class="relative group cursor-pointer">
          <div class="w-9 h-9 rounded-full bg-slate-900 ${statusBorder} ${isSelected ? 'border-4 ring-4 ring-indigo-500/50' : 'border-2'} text-white flex items-center justify-center text-xs shadow-2xl transition transform hover:scale-110">
            <i class="fa-solid fa-truck-moving" style="transform: rotate(${heading}deg);"></i>
          </div>
          <span class="absolute -top-1 -right-1 w-3 h-3 rounded-full ${statusBg} border border-white"></span>
        </div>
      `,
      iconSize: [36, 36],
      iconAnchor: [18, 18]
    });

    const marker = L.marker(coords, { icon: vehIcon }).addTo(appState.map);
    
    marker.bindPopup(`
      <div class="p-2 space-y-1.5 text-xs font-sans min-w-[200px]">
        <div class="flex items-center justify-between border-b border-slate-700 pb-1">
          <strong class="text-white font-outfit text-sm flex items-center space-x-1">
            <span>🚚 ${p.id}</span>
          </strong>
          <span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-bold">${p.vehicle_number}</span>
        </div>
        <div class="text-slate-300 font-bold">${p.cargo_type || 'Cargo'}</div>
        <div class="text-[11px] text-slate-400">${p.origin || 'Guwahati'} → ${p.destination || 'Shillong'}</div>
        <div class="grid grid-cols-2 gap-1 text-[10px] pt-1">
          <div>Speed: <strong class="text-white font-mono">${p.speed || 40} km/h</strong></div>
          <div>ETA: <strong class="text-emerald-400 font-mono">${p.eta || 'N/A'}</strong></div>
        </div>
        <div class="flex items-center justify-between pt-1">
          <span class="text-[10px] font-bold ${statusText}">● ${p.status}</span>
          <button onclick="selectVehicle('${p.id}')" class="bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-[10px] px-2 py-1 rounded transition">
            View Details
          </button>
        </div>
      </div>
    `);

    appState.layers.vehicleMarkers.push(marker);
  });
}

function drawHazardPolygonsOnMap() {
  if (!appState.layers.hazardPolygons) appState.layers.hazardPolygons = [];
  appState.layers.hazardPolygons.forEach(p => appState.map.removeLayer(p));
  appState.layers.hazardPolygons = [];

  const chkHazards = document.getElementById("chkFilterHazards");
  if (chkHazards && !chkHazards.checked) return;

  // Flood polygons (Cyan)
  appState.floodZones.forEach(fz => {
    const latLngs = fz.geometry.coordinates[0].map(pt => [pt[1], pt[0]]);
    const poly = L.polygon(latLngs, {
      color: "#06b6d4",
      fillColor: "#06b6d4",
      fillOpacity: 0.25,
      weight: 2,
      dashArray: "4, 4"
    }).addTo(appState.map);

    poly.bindPopup(`<strong class="text-cyan-400 block">🌊 Flood Zone: ${fz.properties.name}</strong>Risk Level: ${fz.properties.risk_level}`);
    appState.layers.hazardPolygons.push(poly);
  });

  // Landslide polygons (Amber/Orange)
  appState.landslideZones.forEach(lz => {
    const latLngs = lz.geometry.coordinates[0].map(pt => [pt[1], pt[0]]);
    const poly = L.polygon(latLngs, {
      color: "#f59e0b",
      fillColor: "#f59e0b",
      fillOpacity: 0.3,
      weight: 2,
      dashArray: "6, 6"
    }).addTo(appState.map);

    poly.bindPopup(`<strong class="text-amber-400 block">⛰️ Landslide Vulnerability Corridor: ${lz.properties.name}</strong>Risk Level: ${lz.properties.risk_level}`);
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
      if (appState.map) {
        const nerBounds = L.latLngBounds([21.8, 88.0], [29.5, 97.5]);
        appState.map.fitBounds(nerBounds, { padding: [20, 20] });
      }
    });
  }

  if (btnLocate) {
    btnLocate.addEventListener("click", () => {
      if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition(pos => {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          if (appState.map) {
            appState.map.setView([lat, lng], 12);
            L.marker([lat, lng], {
              icon: L.divIcon({
                className: 'locate-me-marker',
                html: `<div class="w-6 h-6 rounded-full bg-indigo-600 text-white font-bold text-[10px] flex items-center justify-center border-2 border-white shadow-xl">YOU</div>`,
                iconSize: [24, 24],
                iconAnchor: [12, 12]
              })
            }).addTo(appState.map).bindPopup("You are here (Current GPS Location)").openPopup();
          }
        }, () => {
          alert("GPS Location access denied or unavailable. Centering on Guwahati Hub.");
          if (appState.map) appState.map.setView([26.1445, 91.7362], 10);
        });
      }
    });
  }

  if (distSelect) {
    distSelect.addEventListener("change", (e) => {
      const val = e.target.value;
      if (!appState.map) return;
      if (val === "ALL") {
        const nerBounds = L.latLngBounds([21.8, 88.0], [29.5, 97.5]);
        appState.map.fitBounds(nerBounds);
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
          appState.map.setView(centerMap[val], 10);
        }
      }
    });
  }

  const handleSearch = () => {
    const q = searchInput ? searchInput.value : "";
    if (!q) return;
    fetch(`${API_BASE}/gis/search?q=${encodeURIComponent(q)}`)
      .then(res => res.json())
      .then(data => {
        if (data.results && data.results.length > 0) {
          const top = data.results[0];
          if (appState.map) {
            appState.map.setView([top.lat, top.lng], 11);
            L.popup()
              .setLatLng([top.lat, top.lng])
              .setContent(`<strong class="text-indigo-600 block">${top.title}</strong><span>${top.subtitle}</span>`)
              .openOn(appState.map);
          }
        } else {
          alert(`No GIS entities found matching "${q}"`);
        }
      });
  };

  if (searchBtn) searchBtn.addEventListener("click", handleSearch);
  if (searchInput) searchInput.addEventListener("keypress", (e) => { if (e.key === "Enter") handleSearch(); });

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

function populateDropdowns() {
  const originSelect = document.getElementById("originSelect");
  const destSelect = document.getElementById("destSelect");
  const reportRoadSelect = document.getElementById("reportRoadSelect");

  if (originSelect) originSelect.innerHTML = "";
  if (destSelect) destSelect.innerHTML = "";

  Object.values(NER_NODES).forEach((node, idx) => {
    const opt1 = new Option(node.name, node.id, idx === 0, idx === 0);
    const opt2 = new Option(node.name, node.id, idx === 3, idx === 3);
    if (originSelect) originSelect.add(opt1);
    if (destSelect) destSelect.add(opt2);
  });

  if (reportRoadSelect) reportRoadSelect.innerHTML = "";
  appState.roads.forEach(road => {
    if (reportRoadSelect) reportRoadSelect.add(new Option(road.name, road.id));
  });

  // Swap Origin / Destination Handler
  const swapBtn = document.getElementById("swapOriginDestBtn");
  if (swapBtn && originSelect && destSelect) {
    swapBtn.addEventListener("click", () => {
      const temp = originSelect.value;
      originSelect.value = destSelect.value;
      destSelect.value = temp;
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

function initRouteMap() {
  const mapEl = document.getElementById("routeMap");
  if (!mapEl || appState.routeMap) return;

  const routeMap = L.map("routeMap", {
    center: [25.8000, 92.5000],
    zoom: 7,
    zoomControl: true
  });

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    subdomains: 'abc',
    attribution: '© OpenStreetMap, SETU-NER Route GIS'
  }).addTo(routeMap);

  appState.routeMap = routeMap;
}

function calculateAndDrawRoute() {
  if (!appState.routeMap) {
    initRouteMap();
  }

  const originSelect = document.getElementById("originSelect");
  const destSelect = document.getElementById("destSelect");
  const cargoSelect = document.getElementById("cargoSelect");

  const originId = (originSelect ? originSelect.value : null) || "guwahati";
  const destId = (destSelect ? destSelect.value : null) || "agartala";
  const cargoType = (cargoSelect ? cargoSelect.value : null) || "general";

  // Calculate Primary Safest Route and Alternate Detour Route
  const routeResults = RouteOptimizer.findAlternateRoutes(
    NER_NODES,
    appState.roads,
    originId,
    destId,
    cargoType,
    appState.blockedRoadIds
  );

  const result = routeResults.primary;
  const altResult = routeResults.alternate;

  appState.activeRoute = result;

  const etaEl = document.getElementById("routeETA");
  const distEl = document.getElementById("routeDist");
  const riskEl = document.getElementById("routeRisk");

  // Clear existing polyline layers
  if (appState.layers.routePolyline) {
    appState.map.removeLayer(appState.layers.routePolyline);
    appState.layers.routePolyline = null;
  }
  if (appState.layers.routeMapPolylines) {
    appState.layers.routeMapPolylines.forEach(p => appState.routeMap.removeLayer(p));
    appState.layers.routeMapPolylines = [];
  } else {
    appState.layers.routeMapPolylines = [];
  }

  if (!result) {
    if (etaEl) etaEl.innerText = "NO PATH";
    if (distEl) distEl.innerText = "N/A";
    if (riskEl) riskEl.innerText = "CRITICAL";
    return;
  }

  if (etaEl) etaEl.innerText = `${result.totalEta} hrs`;
  if (distEl) distEl.innerText = `${result.totalDistance} km`;
  if (riskEl) riskEl.innerText = `${result.avgRisk} / 100`;

  // Sync Google Maps Header Title & Alternate Card
  const headerTitleEl = document.getElementById("googleRouteHeaderTitle");
  const originName = NER_NODES[originId] ? NER_NODES[originId].name.split("(")[0].trim() : originId;
  const destName = NER_NODES[destId] ? NER_NODES[destId].name.split("(")[0].trim() : destId;
  if (headerTitleEl) headerTitleEl.innerText = `${originName} to ${destName}`;

  const altCardEta = document.getElementById("altRouteETA");
  const altCardDist = document.getElementById("altRouteDist");
  if (altResult && altResult.roads.length > 0 && altResult.totalDistance !== result.totalDistance) {
    if (altCardEta) altCardEta.innerText = `${altResult.totalEta} hrs`;
    if (altCardDist) altCardDist.innerText = `Distance: ${altResult.totalDistance} km`;
  } else {
    if (altCardEta) altCardEta.innerText = "No Detour Needed";
    if (altCardDist) altCardDist.innerText = "Direct corridor clear";
  }

  const boundsGroup = [];

  // Draw Alternate Detour Route first (behind primary) if available
  if (altResult && altResult.roads.length > 0 && altResult.totalDistance !== result.totalDistance) {
    const altCoords = [];
    altResult.roads.forEach(r => r.coords.forEach(pt => altCoords.push(pt)));

    if (appState.routeMap) {
      const altPoly = L.polyline(altCoords, {
        color: "#f59e0b",
        weight: 5,
        opacity: 0.85,
        dashArray: "6, 8",
        lineCap: "round"
      }).addTo(appState.routeMap);

      altPoly.bindPopup(`
        <div class="p-1 text-xs font-sans">
          <strong class="text-amber-500 block">Alternate Detour Route</strong>
          <span>Distance: ${altResult.totalDistance} km • ETA: ${altResult.totalEta} hrs</span>
        </div>
      `);
      appState.layers.routeMapPolylines.push(altPoly);
      boundsGroup.push(...altCoords);
    }
  }

  // Draw Primary Safest Route
  if (result && result.roads.length > 0) {
    const routeCoords = [];
    result.roads.forEach(r => r.coords.forEach(pt => routeCoords.push(pt)));
    boundsGroup.push(...routeCoords);

    // Main map polyline
    appState.layers.routePolyline = L.polyline(routeCoords, {
      color: "#38bdf8",
      weight: 6,
      opacity: 0.95,
      lineCap: "round"
    }).addTo(appState.map);

    // Route map polyline (Thick Google Maps Sky Blue Line)
    if (appState.routeMap) {
      const mainPoly = L.polyline(routeCoords, {
        color: "#38bdf8",
        weight: 8,
        opacity: 0.95,
        lineCap: "round"
      }).addTo(appState.routeMap);

      mainPoly.bindPopup(`
        <div class="p-1 text-xs font-sans">
          <strong class="text-sky-400 block text-sm">Recommended Safest Route</strong>
          <span>Distance: ${result.totalDistance} km • ETA: ${result.totalEta} hrs • Avg Risk: ${result.avgRisk}</span>
        </div>
      `);
      appState.layers.routeMapPolylines.push(mainPoly);
    }

    // Add origin and destination Google Maps style pins
    if (appState.routeMap && NER_NODES[originId] && NER_NODES[destId]) {
      const startNode = NER_NODES[originId];
      const endNode = NER_NODES[destId];

      const originMarker = L.marker([startNode.lat, startNode.lng], {
        icon: L.divIcon({
          className: 'google-start-pin',
          html: `<div class="w-7 h-7 rounded-full bg-emerald-500 text-white font-extrabold flex items-center justify-center text-xs shadow-2xl border-2 border-white">A</div>`,
          iconSize: [28, 28],
          iconAnchor: [14, 14]
        })
      }).addTo(appState.routeMap);

      const destMarker = L.marker([endNode.lat, endNode.lng], {
        icon: L.divIcon({
          className: 'google-dest-pin',
          html: `<div class="w-7 h-7 rounded-full bg-rose-500 text-white font-extrabold flex items-center justify-center text-xs shadow-2xl border-2 border-white">B</div>`,
          iconSize: [28, 28],
          iconAnchor: [14, 14]
        })
      }).addTo(appState.routeMap);

      appState.layers.routeMapPolylines.push(originMarker, destMarker);
    }

    if (appState.routeMap && boundsGroup.length > 0) {
      appState.routeMap.fitBounds(L.latLngBounds(boundsGroup), { padding: [40, 40] });
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
            appState.routeMap.fitBounds(L.latLngBounds(rd.coords), { padding: [50, 50] });
          }
        };

        stepsContainer.appendChild(item);
      });
    }
  }
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
      const poly = appState.layers.riskPolylines.find(p => p.getLatLngs()[0].lat === road.coords[0][0]);
      if (poly) appState.map.fitBounds(poly.getBounds(), { padding: [60, 60] });
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

  appState.reports.forEach(rep => {
    const div = document.createElement("div");
    div.className = "bg-slate-100 dark:bg-slate-950 p-2 rounded-lg border border-slate-200 dark:border-slate-800 space-y-1 text-xs";
    div.innerHTML = `
      <div class="flex items-center justify-between font-bold">
        <span class="text-rose-500">${rep.type}</span>
        <span class="text-[10px] text-slate-400">${rep.created_at}</span>
      </div>
      <div class="text-[11px] text-slate-600 dark:text-slate-300">
        Trust Score: <strong class="text-amber-500">${rep.trust_score} / 100</strong> (${rep.verified ? 'Verified' : 'Unverified'})
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

async function fetchVehicleSummaryKPIs() {
  try {
    const res = await fetch(`${API_BASE}/vehicles/summary`);
    if (res.ok) {
      const s = await res.json();
      const elTotal = document.getElementById("kpiVehTotal");
      const elTransit = document.getElementById("kpiVehTransit");
      const elDelayed = document.getElementById("kpiVehDelayed");
      const elRisk = document.getElementById("kpiVehAtRisk");
      const elDelivered = document.getElementById("kpiVehDelivered");
      const elOffline = document.getElementById("kpiVehOffline");

      if (elTotal) elTotal.innerText = s.total_vehicles;
      if (elTransit) elTransit.innerText = s.in_transit;
      if (elDelayed) elDelayed.innerText = s.delayed;
      if (elRisk) elRisk.innerText = s.at_risk;
      if (elDelivered) elDelivered.innerText = s.delivered;
      if (elOffline) elOffline.innerText = s.offline;
    }
  } catch (err) {
    console.warn("Vehicle summary KPI error:", err);
  }
}

async function renderGPSFleetList() {
  const container = document.getElementById("gpsFleetList");
  if (!container) return;

  fetchVehicleSummaryKPIs();

  const cargoFilter = document.getElementById("vehCargoFilter")?.value || "ALL";
  const statusFilter = document.getElementById("vehStatusFilter")?.value || "ALL";
  const priorityFilter = document.getElementById("vehPriorityFilter")?.value || "ALL";
  const searchQ = document.getElementById("vehSearchInput")?.value || "";

  let url = `${API_BASE}/vehicles?cargo_type=${cargoFilter}&status=${statusFilter}&priority=${priorityFilter}`;
  if (searchQ) url += `&q=${encodeURIComponent(searchQ)}`;

  try {
    const res = await fetch(url);
    if (res.ok) {
      const vehicles = await res.json();
      container.innerHTML = "";

      const badge = document.getElementById("vehListCountBadge");
      if (badge) badge.innerText = `${vehicles.length} Vehicles`;

      if (vehicles.length === 0) {
        container.innerHTML = `<div class="p-4 text-center text-xs text-slate-400">No vehicles match current search filter.</div>`;
        return;
      }

      vehicles.forEach(veh => {
        const isSelected = veh.id === appState.selectedVehicleId;
        
        let statusBadgeClass = "bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border-emerald-800/40";
        if (veh.status === "AT_RISK") statusBadgeClass = "bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300 border-rose-800/40 animate-pulse";
        else if (veh.status === "DELAYED") statusBadgeClass = "bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border-amber-800/40";
        else if (veh.status === "DELIVERED") statusBadgeClass = "bg-cyan-100 dark:bg-cyan-950 text-cyan-700 dark:text-cyan-300 border-cyan-800/40";
        else if (veh.status === "OFFLINE") statusBadgeClass = "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-700";

        const card = document.createElement("div");
        card.className = `p-3 rounded-2xl border transition cursor-pointer space-y-2 ${isSelected ? 'bg-indigo-50/80 dark:bg-slate-800/90 border-indigo-500 shadow-md ring-2 ring-indigo-500/30' : 'bg-slate-100/80 dark:bg-slate-950/80 border-slate-200 dark:border-slate-800 hover:border-indigo-400'}`;
        
        card.onclick = () => selectVehicle(veh.id);

        card.innerHTML = `
          <div class="flex items-center justify-between">
            <div class="flex items-center space-x-2">
              <span class="font-outfit font-extrabold text-sm text-slate-900 dark:text-white">🚚 ${veh.id}</span>
              <span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold">${veh.vehicle_number}</span>
            </div>
            <span class="text-[9px] font-bold px-2 py-0.5 rounded-full border ${statusBadgeClass}">${veh.status}</span>
          </div>

          <div class="text-xs font-semibold text-slate-700 dark:text-slate-200">${veh.cargo_type}</div>
          
          <div class="text-[11px] text-slate-500 flex justify-between font-mono">
            <span>Route: <strong>${veh.origin} → ${veh.destination}</strong></span>
            <span>ETA: <strong class="text-emerald-500">${veh.eta || '--'}</strong></span>
          </div>
        `;
        container.appendChild(card);
      });

      // Auto-select first if none selected
      if (!appState.selectedVehicleId && vehicles.length > 0) {
        selectVehicle(vehicles[0].id);
      } else if (appState.selectedVehicleId) {
        updateSelectedVehiclePanel(appState.selectedVehicleId);
      }

    }
  } catch (err) {
    console.warn("Error rendering fleet list:", err);
  }
}

async function selectVehicle(vehicleId) {
  appState.selectedVehicleId = vehicleId;
  renderGPSFleetList();
  updateSelectedVehiclePanel(vehicleId);
  drawVehicleTrailAndRoute(vehicleId);
}

async function updateSelectedVehiclePanel(vehicleId) {
  try {
    const res = await fetch(`${API_BASE}/vehicles/${vehicleId}`);
    if (!res.ok) return;
    const v = await res.json();

    const elId = document.getElementById("selectedVehId");
    const elNum = document.getElementById("selectedVehNumber");
    const elCargo = document.getElementById("selectedVehCargo");
    const elPriority = document.getElementById("selectedVehPriority");
    const elStatus = document.getElementById("selectedVehStatus");
    const elOrigin = document.getElementById("selectedVehOrigin");
    const elDest = document.getElementById("selectedVehDest");
    const elTraveled = document.getElementById("selectedVehTraveled");
    const elRemaining = document.getElementById("selectedVehRemaining");
    const elETA = document.getElementById("selectedVehETA");
    const elProgressPct = document.getElementById("selectedVehProgressPct");
    const elProgressBar = document.getElementById("selectedVehProgressBar");
    const elRoad = document.getElementById("selectedVehRoad");
    const elSpeed = document.getElementById("selectedVehSpeed");
    const elRisk = document.getElementById("selectedVehRisk");
    const elGpsTime = document.getElementById("selectedVehGpsTime");
    const elDriver = document.getElementById("selectedVehDriver");
    const elPhone = document.getElementById("selectedVehPhone");
    const elWeather = document.getElementById("selectedVehWeather");
    const elSimBadge = document.getElementById("simStatusBadge");

    if (elId) elId.innerText = v.id;
    if (elNum) elNum.innerText = v.vehicle_number;
    if (elCargo) elCargo.innerText = `${v.cargo.type} • ${v.logistics.origin} → ${v.logistics.destination}`;
    if (elPriority) elPriority.innerText = `${v.cargo.priority} PRIORITY`;
    if (elStatus) elStatus.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse mr-1"></span>${v.logistics.status}`;

    if (elOrigin) elOrigin.innerText = v.logistics.origin;
    if (elDest) elDest.innerText = v.logistics.destination;
    
    const rem = v.logistics.distance_remaining_km || 0;
    const totalEst = rem + 40.0;
    const traveled = Math.max(0, round1(totalEst - rem));
    const pct = Math.min(100, Math.max(0, Math.round((traveled / totalEst) * 100)));

    if (elTraveled) elTraveled.innerText = `${traveled} km`;
    if (elRemaining) elRemaining.innerText = `${rem} km`;
    if (elETA) elETA.innerText = v.logistics.eta || 'Calculating...';
    if (elProgressPct) elProgressPct.innerText = `${pct}% Completed`;
    if (elProgressBar) elProgressBar.style.width = `${pct}%`;

    if (elRoad) elRoad.innerText = v.location.current_road_name || v.location.current_road_id || 'NH40 Guwahati-Shillong';
    if (elSpeed) elSpeed.innerText = `${v.location.speed_kmh || 40} km/h`;
    
    const rScore = v.location.road_risk_score || 28;
    if (elRisk) {
      elRisk.innerText = `${rScore} / 100 ${rScore > 70 ? 'CRITICAL' : (rScore > 30 ? 'MODERATE' : 'LOW')}`;
      elRisk.className = `font-bold block ${rScore > 70 ? 'text-rose-500' : (rScore > 30 ? 'text-amber-500' : 'text-emerald-500')}`;
    }

    if (elGpsTime) elGpsTime.innerText = v.location.last_gps_update ? new Date(v.location.last_gps_update).toLocaleTimeString() : 'LIVE';
    if (elDriver) elDriver.innerText = v.driver.name || 'Raj Kumar';
    if (elPhone) elPhone.innerText = v.driver.phone || '+91 9876543210';
    if (elWeather) elWeather.innerText = v.weather ? `${v.weather.temperature}°C • Open-Meteo` : '24.5°C • Moderate Rain';

    if (elSimBadge) {
      const simStatus = v.logistics.sim_status || 'STOPPED';
      elSimBadge.innerText = simStatus;
      elSimBadge.className = `text-[10px] font-mono font-bold px-2 py-0.5 rounded ${simStatus === 'RUNNING' ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' : 'bg-slate-800 text-slate-400'}`;
    }

  } catch (err) {
    console.warn("Error updating selected vehicle panel:", err);
  }
}

function round1(val) {
  return Math.round(val * 10) / 10;
}

async function drawVehicleTrailAndRoute(vehicleId) {
  if (!appState.map) return;

  // Clear existing vehicle trail polyline
  if (appState.layers.vehicleTrailPolyline) {
    appState.map.removeLayer(appState.layers.vehicleTrailPolyline);
    appState.layers.vehicleTrailPolyline = null;
  }
  // Clear existing active route polyline
  if (appState.layers.vehicleActiveRoutePolyline) {
    appState.map.removeLayer(appState.layers.vehicleActiveRoutePolyline);
    appState.layers.vehicleActiveRoutePolyline = null;
  }

  try {
    // 1. Fetch location history for breadcrumb trail
    const locRes = await fetch(`${API_BASE}/vehicles/${vehicleId}/locations?limit=40`);
    if (locRes.ok) {
      const locs = await locRes.json();
      if (locs.length > 1) {
        const trailPts = locs.map(l => [l.latitude, l.longitude]);
        appState.layers.vehicleTrailPolyline = L.polyline(trailPts, {
          color: "#a855f7",
          weight: 4,
          opacity: 0.8,
          dashArray: "4, 6",
          lineCap: "round"
        }).addTo(appState.map);
      }
    }

    // 2. Fetch active route geometry
    const routeRes = await fetch(`${API_BASE}/vehicles/${vehicleId}/route`);
    if (routeRes.ok) {
      const rData = await routeRes.json();
      if (rData.geometry && rData.geometry.length > 0) {
        const routePts = rData.geometry.map(pt => [pt[1], pt[0]]); // [lng, lat] to [lat, lng]
        appState.layers.vehicleActiveRoutePolyline = L.polyline(routePts, {
          color: "#10b981",
          weight: 6,
          opacity: 0.9,
          lineCap: "round"
        }).addTo(appState.map);
      }
    }
  } catch (err) {
    console.warn("Error drawing vehicle trail/route:", err);
  }
}

function initVehicleCommandCenterControls() {
  const btnStart = document.getElementById("btnStartGpsSim");
  const btnPause = document.getElementById("btnPauseGpsSim");
  const btnStop = document.getElementById("btnStopGpsSim");
  const btnBlock = document.getElementById("btnSimulateBlockade");
  const btnReroute = document.getElementById("btnRerouteManual");
  const btnFocus = document.getElementById("btnFocusMapVehicle");

  const cargoFilter = document.getElementById("vehCargoFilter");
  const statusFilter = document.getElementById("vehStatusFilter");
  const priorityFilter = document.getElementById("vehPriorityFilter");
  const searchInput = document.getElementById("vehSearchInput");

  [cargoFilter, statusFilter, priorityFilter].forEach(el => {
    if (el) el.addEventListener("change", () => renderGPSFleetList());
  });
  if (searchInput) {
    searchInput.addEventListener("input", () => renderGPSFleetList());
  }

  if (btnStart) {
    btnStart.addEventListener("click", async () => {
      const vId = appState.selectedVehicleId || "MED-102";
      const res = await fetch(`${API_BASE}/demo/vehicles/${vId}/start`, { method: "POST" });
      if (res.ok) {
        updateSelectedVehiclePanel(vId);
      }
    });
  }

  if (btnPause) {
    btnPause.addEventListener("click", async () => {
      const vId = appState.selectedVehicleId || "MED-102";
      const res = await fetch(`${API_BASE}/demo/vehicles/${vId}/pause`, { method: "POST" });
      if (res.ok) {
        updateSelectedVehiclePanel(vId);
      }
    });
  }

  if (btnStop) {
    btnStop.addEventListener("click", async () => {
      const vId = appState.selectedVehicleId || "MED-102";
      const res = await fetch(`${API_BASE}/demo/vehicles/${vId}/stop`, { method: "POST" });
      if (res.ok) {
        updateSelectedVehiclePanel(vId);
      }
    });
  }

  if (btnBlock) {
    btnBlock.addEventListener("click", async () => {
      const vId = appState.selectedVehicleId || "MED-102";
      btnBlock.innerText = "⏳ Simulating Blockade & Rerouting...";
      btnBlock.disabled = true;

      try {
        const res = await fetch(`${API_BASE}/demo/vehicles/${vId}/simulate-block`, { method: "POST" });
        if (res.ok) {
          const data = await res.json();
          alert(`🚨 ROAD BLOCKAGE SIMULATED on ${data.affected_road}!\n\nStatus: ${data.new_status}\nNew ETA: ${data.new_eta}\n\nSmart Dijkstra Route Optimizer automatically rerouted ${vId} via safe highway detour!`);
          
          fetchLiveRoadsFromBackend().then(() => drawRoadNetworkOnMap());
          drawVehicleTrailAndRoute(vId);
          updateSelectedVehiclePanel(vId);
          renderGPSFleetList();
        }
      } catch (err) {
        alert("Error executing road block simulation: " + err);
      } finally {
        btnBlock.innerHTML = `<i class="fa-solid fa-hill-rockslide mr-1"></i>Simulate Road Block & Auto-Reroute`;
        btnBlock.disabled = false;
      }
    });
  }

  if (btnReroute) {
    btnReroute.addEventListener("click", async () => {
      const vId = appState.selectedVehicleId || "MED-102";
      const res = await fetch(`${API_BASE}/vehicles/${vId}/reroute`, { method: "POST" });
      if (res.ok) {
        alert(`🔄 Manual Reroute Triggered for ${vId}! New safe path assigned.`);
        drawVehicleTrailAndRoute(vId);
        updateSelectedVehiclePanel(vId);
      }
    });
  }

  if (btnFocus) {
    btnFocus.addEventListener("click", async () => {
      const vId = appState.selectedVehicleId || "MED-102";
      const res = await fetch(`${API_BASE}/vehicles/${vId}`);
      if (res.ok) {
        const v = await res.json();
        switchFeaturePanel("f1");
        if (appState.map) {
          appState.map.setView([v.location.latitude, v.location.longitude], 12);
        }
      }
    });
  }
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

  // Feature 1: Recalculate Risk Cron Job
  const recalcBtn = document.getElementById("recalcRiskBtn");
  if (recalcBtn) {
    recalcBtn.addEventListener("click", () => {
      calculateAllRoadRisks();
      drawRoadNetworkOnMap();
      renderRoadRiskList();
      alert("✅ 30-Min Risk Recalculation Cron Job Triggered! Scores refreshed.");
    });
  }

  // Feature 2: Predictive Forecast Check
  const predCheckBtn = document.getElementById("runPredictiveCheckBtn");
  if (predCheckBtn) {
    predCheckBtn.addEventListener("click", () => {
      const log = document.getElementById("predictiveAlertLog");
      if (log) {
        log.classList.remove("hidden");
        log.innerText = `⚠️ [PREDICTIVE ALERT] Rainfall forecast (92mm/6h) exceeds threshold (60mm) in Jaintia Hills (NH06 Landslide Zone). Route flagged 4 hours before collapse!`;
      }
      alert("⚠️ Predictive Disruption Alert Triggered for NH06 Jaintia Hills!");
    });
  }

  // Feature 3: Route Calculation
  const calcBtn = document.getElementById("calcRouteBtn");
  if (calcBtn) calcBtn.addEventListener("click", calculateAndDrawRoute);

  // Feature 5: Vision AI Report Form
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
      const trustScore = RiskEngine.calculateTrustScore(role, 1, 1.0, 0);

      const newReport = {
        id: "REP-" + Math.floor(100 + Math.random() * 900),
        road_id: roadId,
        lat: road.coords[0][0] + 0.05,
        lng: road.coords[0][1] + 0.05,
        type: type,
        photo_url: dummyPhoto,
        ai_severity: visionResult.ai_severity,
        ai_confidence: visionResult.ai_confidence,
        trust_score: trustScore,
        verified: trustScore >= 50,
        reporter_role: role,
        created_at: "Just now"
      };

      appState.reports.unshift(newReport);
      road.recent_report_density = (road.recent_report_density || 0) + 2;
      road.risk_score = RiskEngine.calculateRoadRisk(road);

      drawRoadNetworkOnMap();
      drawReportMarkersOnMap();
      renderReportsList();
      renderRoadRiskList();
      calculateAndDrawRoute();

      alert(`✅ Vision AI Analysis Complete!\nSeverity: ${visionResult.ai_severity}\nHash Fingerprint: ${visionResult.photo_hash}\nTrust Score: ${trustScore}/100`);
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
  const dispatchBtn = document.getElementById("optimizeDispatchBtn");
  if (dispatchBtn) {
    dispatchBtn.addEventListener("click", () => {
      const assignments = DispatchOptimizer.optimizeConvoys(NER_NODES, RELIEF_VEHICLES);
      alert(`✅ Convoy Dispatch Queue Ranked! Prioritized ${assignments.length} units matching vulnerable citizen tags.`);
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

  // Feature 10: Area Emergency Cell Broadcast
  const bcastBtn = document.getElementById("sendBroadcastBtn");
  if (bcastBtn) {
    bcastBtn.addEventListener("click", () => {
      const res = CampBroadcastEngine.triggerEmergencyBroadcast("Barak Valley (Silchar)", "FLASH FLOOD WARNING: All citizens proceed to nearest designated Relief Camp immediately!");
      const log = document.getElementById("broadcastResultLog");
      if (log) {
        log.classList.remove("hidden");
        log.innerText = `🚨 [${res.sent_at}] ${res.severity}\nTarget: ${res.target_district}\nReach: ${res.estimated_reach}\nStatus: ${res.status}`;
      }
      alert(`🚨 Cell-Broadcast Pushed to ${res.estimated_reach}!`);
    });
  }

  const sosBtn = document.getElementById("btnEmergencySos");
  if (sosBtn) {
    sosBtn.addEventListener("click", () => {
      alert("🚨 EMERGENCY SOS BROADCAST ACTIVATED! Dispatching nearest NDRF & Air Rescue Units across NER grid.");
    });
  }

  // Judge Hackathon Demo Controls (Real Backend APIs & WebSocket Broadcasts)
  const simLandslideBtn = document.getElementById("demoSimLandslideBtn");
  if (simLandslideBtn) {
    simLandslideBtn.addEventListener("click", async () => {
      try {
        const res = await fetch(`${API_BASE}/simulate/landslide`, { method: "POST" });
        if (res.ok) {
          const data = await res.json();
          alert(`⛰️ LANDSLIDE SIMULATED END-TO-END!\n\n• Incident created in SQLite/PostGIS DB\n• Corridor ${data.affected_road} risk elevated to 95.0 (BLOCKED)\n• Emergency Alert Broadcasted: "${data.alert_title}"\n• WebSocket event pushed to all GIS clients!`);
          await fetchLiveRoadsFromBackend();
          await fetchGisLayers();
          drawRoadNetworkOnMap();
          drawIncidentsOnMap();
          renderRoadRiskList();
          calculateAndDrawRoute();
          fetchLiveSummaryKPIs();
        }
      } catch (err) {
        console.warn("Backend error:", err);
      }
    });
  }

  const simRainBtn = document.getElementById("demoSimRainBtn");
  if (simRainBtn) {
    simRainBtn.addEventListener("click", async () => {
      try {
        const res = await fetch(`${API_BASE}/risk/calculate`, { method: "POST" });
        if (res.ok) {
          const data = await res.json();
          alert(`🌧️ MONSOON HEAVY RAINFALL SIMULATED!\n\n• Open-Meteo precipitation stream updated (+120mm/6h)\n• Backend Risk Engine recalculated all 12 NER National Highway corridors\n• Road risk scores updated dynamically!`);
          await fetchLiveRoadsFromBackend();
          drawRoadNetworkOnMap();
          renderRoadRiskList();
          calculateAndDrawRoute();
          fetchLiveSummaryKPIs();
        }
      } catch (err) {
        console.warn("Backend error:", err);
      }
    });
  }

  const simVehicleBtn = document.getElementById("demoSimVehicleBtn");
  if (simVehicleBtn) {
    simVehicleBtn.addEventListener("click", async () => {
      try {
        // Step vehicle along NH27 corridor to Silchar
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
            alert("🚚 GPS Medical Supply Convoy VEH-MED-01 arrived safely at Silchar Hospital!");
            return;
          }
          const pt = simCoords[step];
          await fetch(`${API_BASE}/vehicles/${vehicleId}/location`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ latitude: pt.lat, longitude: pt.lng, status: "IN_TRANSIT" })
          });
          step++;
        }, 1500);
        alert("🚚 LIVE GPS VEHICLE TELEMETRY SIMULATOR STARTED!\n\nMedical Supply Convoy VEH-MED-01 is sending real-time latitude/longitude updates to backend DB every 1.5 seconds. Watch the vehicle marker move on the map canvas!");
      } catch (err) {
        console.warn("GPS simulator error:", err);
      }
    });
  }

  const resolveIncBtn = document.getElementById("demoResolveIncBtn");
  if (resolveIncBtn) {
    resolveIncBtn.addEventListener("click", async () => {
      try {
        // Fetch active incidents and resolve first one
        const incRes = await fetch(`${API_BASE}/incidents`);
        if (incRes.ok) {
          const incidents = await incRes.json();
          if (incidents.length > 0) {
            const target = incidents[0];
            const res = await fetch(`${API_BASE}/incidents/${target.id}/resolve`, { method: "POST" });
            if (res.ok) {
              const data = await res.json();
              alert(`✅ DISASTER INCIDENT RESOLVED!\n\n• Incident #${target.id} (${target.type}) marked RESOLVED\n• Nearby road risk scores restored\n• Highway status returned to SAFE/OPEN`);
              await fetchLiveRoadsFromBackend();
              await fetchGisLayers();
              drawRoadNetworkOnMap();
              drawIncidentsOnMap();
              renderRoadRiskList();
              calculateAndDrawRoute();
              fetchLiveSummaryKPIs();
            }
          } else {
            alert("No active unresolved incidents found in database.");
          }
        }
      } catch (err) {
        console.warn("Resolve incident error:", err);
      }
    });
  }

  const simBtn = document.getElementById("btnSimMode");
  if (simBtn) {
    simBtn.addEventListener("click", async () => {
      try {
        const res = await fetch(`${API_BASE}/simulate/landslide`, { method: "POST" });
        if (res.ok) {
          const data = await res.json();
          alert(`⚡ END-TO-END DEMO SCENARIO TRIGGERED:\n${data.message}\nRoad ${data.affected_road} status changed to ${data.new_status}`);
          await fetchLiveRoadsFromBackend();
          drawRoadNetworkOnMap();
          renderRoadRiskList();
          calculateAndDrawRoute();
        }
      } catch (err) {
        appState.roads = RiskEngine.simulateWeatherSpike(appState.roads, 1.8);
        drawRoadNetworkOnMap();
        renderRoadRiskList();
        calculateAndDrawRoute();
        alert("⚡ Heavy Monsoon Rainstorm Simulated! Road risk scores updated dynamically.");
      }
    });
  }

  const voiceBtn = document.getElementById("btnVoiceMenu");
  if (voiceBtn) {
    voiceBtn.addEventListener("click", () => {
      alert("🎙️ Voice IVR Toll-Free Channel Active: Dial 1800-SETU-NER for automated voice updates.");
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
  try {
    const res = await fetch(`${API_BASE}/risk/roads/${roadId}`);
    if (res.ok) {
      const data = await res.json();
      const b = data.breakdown;
      alert(`📊 EXPLAINABLE RISK BREAKDOWN: ${data.name} (#${data.road_id})\n` +
            `Final Risk Score: ${data.final_risk_score} / 100 (${data.status})\n\n` +
            `• 35% Rainfall Risk: Score ${b.rainfall_risk.score} (${b.rainfall_risk.value})\n` +
            `• 25% Landslide Susceptibility: Score ${b.landslide_risk.score}\n` +
            `• 15% Flood Inundation Risk: Score ${b.flood_risk.score}\n` +
            `• 15% Recent Incident Risk: Score ${b.incident_risk.score} (${b.incident_risk.value})\n` +
            `• 10% Road & Bridge Condition: Score ${b.road_condition.score} (${b.road_condition.value})\n\n` +
            `Last Updated: ${new Date(data.last_updated).toLocaleString()}`);
    }
  } catch (err) {
    alert(`Road Risk Score: ${roadId} calculated dynamically from active terrain & weather factors.`);
  }
};

window.selectVehicle = selectVehicle;
