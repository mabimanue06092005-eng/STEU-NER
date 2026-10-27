"""
SETU-NER - Flood & Landslide Hazard Zone Development Seed Data (Phase 3, Part 12)

These polygons are DEVELOPMENT/SEED DATA maintained by this project for demonstration
and route-scoring purposes — they are NOT sourced from a live government flood/landslide
authority feed. Every feature carries "data_source": "DEVELOPMENT_SEED" so nothing here
can be mistaken for live authority data by a client. Locations are geographically
plausible NER flood/landslide corridors (chosen to align with known monsoon/terrain risk
areas already reflected in the seeded Road data), not arbitrary placeholders.

Used by:
  - GET /api/gis/flood-zones / /api/gis/landslide-zones (map display)
  - RouteScoringService (route risk scoring — a route passing near one of these
    contributes to that candidate route's disaster/hazard risk component)
"""

FLOOD_ZONES = {
    "type": "FeatureCollection",
    "features": [
        {
            "type": "Feature",
            "properties": {"name": "Kaziranga Brahmaputra Flood Basin", "risk_level": "HIGH", "data_source": "DEVELOPMENT_SEED"},
            "geometry": {"type": "Polygon", "coordinates": [[[93.00, 26.50], [93.60, 26.70], [93.80, 26.55], [93.20, 26.35], [93.00, 26.50]]]}
        },
        {
            "type": "Feature",
            "properties": {"name": "Barak Valley Lowland Inundation Basin", "risk_level": "MODERATE", "data_source": "DEVELOPMENT_SEED"},
            "geometry": {"type": "Polygon", "coordinates": [[[92.50, 24.70], [92.90, 24.90], [93.10, 24.75], [92.70, 24.60], [92.50, 24.70]]]}
        },
        {
            "type": "Feature",
            "properties": {"name": "Majuli-Dhemaji Brahmaputra Floodplain", "risk_level": "HIGH", "data_source": "DEVELOPMENT_SEED"},
            "geometry": {"type": "Polygon", "coordinates": [[[94.00, 27.00], [94.50, 27.25], [94.70, 27.05], [94.20, 26.85], [94.00, 27.00]]]}
        },
        {
            "type": "Feature",
            "properties": {"name": "Agartala Howrah River Lowland Basin", "risk_level": "MODERATE", "data_source": "DEVELOPMENT_SEED"},
            "geometry": {"type": "Polygon", "coordinates": [[[91.20, 23.75], [91.45, 23.95], [91.55, 23.80], [91.30, 23.65], [91.20, 23.75]]]}
        }
    ]
}

LANDSLIDE_ZONES = {
    "type": "FeatureCollection",
    "features": [
        {
            "type": "Feature",
            "properties": {"name": "Jaintia Hills Sinking Corridor (NH06)", "risk_level": "CRITICAL", "data_source": "DEVELOPMENT_SEED"},
            "geometry": {"type": "Polygon", "coordinates": [[[91.90, 25.30], [92.30, 25.55], [92.45, 25.35], [92.00, 25.15], [91.90, 25.30]]]}
        },
        {
            "type": "Feature",
            "properties": {"name": "Kohima-Dimapur Mudslide Pass (NH29)", "risk_level": "HIGH", "data_source": "DEVELOPMENT_SEED"},
            "geometry": {"type": "Polygon", "coordinates": [[[93.80, 25.70], [94.20, 25.90], [94.30, 25.75], [93.90, 25.55], [93.80, 25.70]]]}
        },
        {
            "type": "Feature",
            "properties": {"name": "Sela-Tawang High Pass Corridor (NH13)", "risk_level": "CRITICAL", "data_source": "DEVELOPMENT_SEED"},
            "geometry": {"type": "Polygon", "coordinates": [[[91.90, 27.35], [92.30, 27.60], [92.50, 27.45], [92.10, 27.20], [91.90, 27.35]]]}
        },
        {
            "type": "Feature",
            "properties": {"name": "Aizawl Hill Slope Instability Zone (NH54)", "risk_level": "HIGH", "data_source": "DEVELOPMENT_SEED"},
            "geometry": {"type": "Polygon", "coordinates": [[[92.55, 23.65], [92.90, 23.85], [93.00, 23.70], [92.65, 23.50], [92.55, 23.65]]]}
        }
    ]
}
