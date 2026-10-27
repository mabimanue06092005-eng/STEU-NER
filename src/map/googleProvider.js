/**
 * SETU-NER - Google Maps provider (Phase 3, Part 2)
 *
 * The ONLY map renderer in this app, used once GOOGLE_MAPS_API_KEY is configured (see
 * googleMapsLoader.js). app.js's drawing functions (drawRoadNetworkOnMap, etc.) call
 * only this small MapProvider interface (createMap/addMarker/addPolyline/addPolygon/
 * fitBounds/setView/setMapType/zoomIn/zoomOut/openInfoWindow) — nothing in app.js talks
 * to the google.maps namespace directly except the Directions/Places calls in the
 * routing workflow.
 *
 * Markers use classic google.maps.Marker with a vector circle Symbol (no custom
 * FontAwesome divIcon HTML — that would require Advanced Markers + a Cloud-configured
 * Map ID, extra setup this project doesn't require you to do). Full detail is still
 * available via InfoWindow on click.
 */

const GoogleMapProvider = {
  name: "google",

  createMap(elementId, { center, zoom }) {
    const map = new google.maps.Map(document.getElementById(elementId), {
      center: { lat: center[0], lng: center[1] },
      zoom,
      mapTypeId: google.maps.MapTypeId.ROADMAP,
      streetViewControl: false,
      fullscreenControl: false,
      mapTypeControl: false,
      zoomControl: false
    });
    const infoWindow = new google.maps.InfoWindow();
    return { map, infoWindow };
  },

  setMapType(handle, mode) {
    const T = google.maps.MapTypeId;
    const map_ = { satellite: T.HYBRID, overview: T.ROADMAP, topo: T.TERRAIN, roads: T.ROADMAP };
    handle.map.setMapTypeId(map_[mode] || T.ROADMAP);
  },

  zoomIn(handle) { handle.map.setZoom(handle.map.getZoom() + 1); },
  zoomOut(handle) { handle.map.setZoom(handle.map.getZoom() - 1); },
  invalidateSize(handle) {
    if (handle && handle.map) google.maps.event.trigger(handle.map, "resize");
  },

  setView(handle, lat, lng, zoom) {
    handle.map.setCenter({ lat, lng });
    handle.map.setZoom(zoom);
  },

  fitBounds(handle, points, paddingPx) {
    if (!points || !points.length) return;
    const bounds = new google.maps.LatLngBounds();
    points.forEach(pt => bounds.extend({ lat: pt[0], lng: pt[1] }));
    const pad = Array.isArray(paddingPx) ? Math.max(...paddingPx) : (paddingPx || 20);
    handle.map.fitBounds(bounds, pad);
  },

  addMarker(handle, lat, lng, style, popupHtml) {
    const marker = new google.maps.Marker({
      position: { lat, lng },
      map: handle.map,
      label: style && style.label ? { text: style.label, color: "#ffffff", fontWeight: "bold", fontSize: "11px" } : null,
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        fillColor: (style && style.color) || "#6366f1",
        fillOpacity: 0.95,
        strokeColor: "#ffffff",
        strokeWeight: 2,
        scale: (style && style.radius ? style.radius / 2 : 8)
      },
      zIndex: (style && style.zIndex) || 1
    });
    if (popupHtml) {
      marker.addListener("click", () => {
        handle.infoWindow.setContent(popupHtml);
        handle.infoWindow.open(handle.map, marker);
      });
    }
    return { remove: () => marker.setMap(null), raw: marker };
  },

  addPolyline(handle, points, style, popupHtml) {
    const path = points.map(pt => ({ lat: pt[0], lng: pt[1] }));
    const line = new google.maps.Polyline({
      path,
      map: handle.map,
      strokeColor: style.color,
      strokeWeight: style.weight || 5,
      strokeOpacity: style.dashed ? 0 : (style.opacity != null ? style.opacity : 0.95),
      icons: style.dashed ? [{
        icon: { path: "M 0,-1 0,1", strokeOpacity: 1, scale: 3 },
        offset: "0",
        repeat: "12px"
      }] : undefined
    });
    if (popupHtml) {
      line.addListener("click", (e) => {
        handle.infoWindow.setContent(popupHtml);
        handle.infoWindow.setPosition(e.latLng);
        handle.infoWindow.open(handle.map);
      });
    }
    return { remove: () => line.setMap(null), raw: line };
  },

  addPolygon(handle, rings, style, popupHtml) {
    const paths = rings.map(pt => ({ lat: pt[0], lng: pt[1] }));
    const poly = new google.maps.Polygon({
      paths,
      map: handle.map,
      strokeColor: style.color,
      strokeWeight: style.weight || 2,
      fillColor: style.fillColor || style.color,
      fillOpacity: style.fillOpacity != null ? style.fillOpacity : 0.25
    });
    if (popupHtml) {
      poly.addListener("click", (e) => {
        handle.infoWindow.setContent(popupHtml);
        handle.infoWindow.setPosition(e.latLng);
        handle.infoWindow.open(handle.map);
      });
    }
    return { remove: () => poly.setMap(null), raw: poly };
  },

  openInfoWindow(handle, lat, lng, html) {
    handle.infoWindow.setContent(html);
    handle.infoWindow.setPosition({ lat, lng });
    handle.infoWindow.open(handle.map);
  }
};
