"""
SETU-NER - Route Scoring Service (Phase 3, Part 4)

Google Maps/Directions supplies the real road-network geometry for a candidate route
(distance, duration, and a polyline of lat/lng points). This service is where SETU-NER
adds the disaster-intelligence layer on top of that: it checks the candidate route's
polyline against the SAME data Phase 2 already made authoritative —

  - Road.risk_score, via RiskEngineService.calculate_road_risk_breakdown (Phase 2's one
    canonical risk formula — this file does not invent a second one)
  - active Incidents (same 15km proximity convention already used in
    routers/incidents.py for incident -> road risk propagation)
  - the flood/landslide hazard zone development seed data (app/core/hazard_zones.py)

and produces one blended 0-100 risk score, a risk_level using the same LOW/MODERATE/
HIGH_RISK vocabulary DijkstraRouterService already returns, and a plain-language
explanation built only from what was actually matched — never invented text.

The backend remains the sole authority for this score; Google only supplies geometry.
"""

import json
from app.core.geo_utils import haversine_km, polygon_centroid_lnglat
from app.models.models import Road, Incident
from app.services.risk_service import RiskEngineService

CORRIDOR_PROXIMITY_KM = 8.0    # tighter than the incident radius on purpose — see _road_near_points
INCIDENT_PROXIMITY_KM = 15.0   # same convention as incident->road propagation (Phase 2)
HAZARD_ZONE_PROXIMITY_KM = 20.0
MAX_SAMPLE_POINTS = 40         # keep proximity checks fast for long polylines

# Mirrors RoutingService.calculate_cost_function's priority weighting shape (Phase 2
# routing_service.py) so a Google-scored route and a Dijkstra-scored fallback route are
# weighted the same way for the same priority tier.
PRIORITY_WEIGHTS = {
    "EMERGENCY": {"distance": 0.15, "time": 0.25, "risk": 0.60},
    "ESSENTIAL_SUPPLY": {"distance": 0.20, "time": 0.30, "risk": 0.50},
    "NORMAL": {"distance": 0.30, "time": 0.25, "risk": 0.45},
}


class RouteScoringService:

    @staticmethod
    def _sample(points):
        if len(points) <= MAX_SAMPLE_POINTS:
            return points
        step = max(1, len(points) // MAX_SAMPLE_POINTS)
        return points[::step]

    @staticmethod
    def _road_near_points(sample, road):
        # Require at least 3 distinct sampled route points within a tight 8km radius, not
        # just 1. A single (or even double, at wider radii) nearby point usually just means
        # two roads share a junction town (e.g. NH06 and NH08 both terminate at Silchar) —
        # not that the route actually follows that corridor. This is a proximity heuristic,
        # not real geometric route-matching (that would need the full un-sampled polyline
        # and a proper line-to-line distance calculation) — documented as a known
        # simplification, not claimed to be exact.
        road_coords = json.loads(road.coords_json)
        matches = 0
        for pt in sample:
            if any(haversine_km(pt[0], pt[1], rc[0], rc[1]) <= CORRIDOR_PROXIMITY_KM for rc in road_coords):
                matches += 1
                if matches >= 3:
                    return True
        return False

    @staticmethod
    def _zone_near_points(sample, zone_feature):
        centroid = polygon_centroid_lnglat(zone_feature["geometry"]["coordinates"][0])  # [lng, lat]
        return any(haversine_km(pt[0], pt[1], centroid[1], centroid[0]) <= HAZARD_ZONE_PROXIMITY_KM for pt in sample)

    @classmethod
    def score_route(cls, db, points, distance_km, duration_min, priority="NORMAL", flood_zones=None, landslide_zones=None):
        sample = cls._sample(points)

        roads = db.query(Road).all()
        matched_roads = [r for r in roads if cls._road_near_points(sample, r)]
        blocked_roads = [r for r in matched_roads if r.current_status == "BLOCKED"]
        risky_roads = [r for r in matched_roads if r.current_status == "RISKY"]

        active_incidents = db.query(Incident).filter(Incident.status != "RESOLVED").all()
        matched_incidents = [
            i for i in active_incidents
            if any(haversine_km(pt[0], pt[1], i.latitude, i.longitude) <= INCIDENT_PROXIMITY_KM for pt in sample)
        ]

        matched_flood = [fz for fz in (flood_zones or []) if cls._zone_near_points(sample, fz)]
        matched_landslide = [lz for lz in (landslide_zones or []) if cls._zone_near_points(sample, lz)]

        # --- Component scores (0-100), reusing Phase 2's canonical road risk formula ---
        if matched_roads:
            road_risk = sum(RiskEngineService.calculate_road_risk_breakdown(r)["final_score"] for r in matched_roads) / len(matched_roads)
        else:
            road_risk = 15.0  # no monitored corridor nearby: baseline low, not zero — unmonitored isn't proven safe

        incident_risk = min(100.0, sum(
            90.0 if i.severity in ("SEVERE", "IMPASSABLE") else (55.0 if i.severity == "MODERATE" else 30.0)
            for i in matched_incidents
        ))

        hazard_risk = min(100.0, len(matched_flood) * 40.0 + len(matched_landslide) * 45.0)
        accessibility_penalty = 100.0 if blocked_roads else 0.0

        disaster_component = (0.40 * road_risk) + (0.25 * incident_risk) + (0.25 * hazard_risk) + (0.10 * accessibility_penalty)

        # distance/time normalized against a generous NER-scale ceiling (500km / 600min)
        # so they land in the same 0-100 range as the risk components before blending —
        # same idea as RoutingService.calculate_cost_function blending distance/time/risk.
        distance_cost = min(100.0, (distance_km / 500.0) * 100.0)
        time_cost = min(100.0, (duration_min / 600.0) * 100.0)

        weights = PRIORITY_WEIGHTS.get(priority, PRIORITY_WEIGHTS["NORMAL"])
        total_score = round(
            (weights["distance"] * distance_cost) +
            (weights["time"] * time_cost) +
            (weights["risk"] * disaster_component),
            1
        )
        total_score = min(max(total_score, 0.0), 100.0)
        risk_level = "LOW" if total_score <= 30 else ("MODERATE" if total_score <= 70 else "HIGH_RISK")

        explanation = []
        if blocked_roads:
            explanation.append(f"Passes near BLOCKED corridor(s): {', '.join(r.name for r in blocked_roads)}")
        for i in matched_incidents:
            explanation.append(f"Active {i.severity} {i.type} incident reported within {INCIDENT_PROXIMITY_KM:.0f}km of this route")
        for fz in matched_flood:
            explanation.append(f"Passes near flood risk zone: {fz['properties']['name']} ({fz['properties']['risk_level']})")
        for lz in matched_landslide:
            explanation.append(f"Passes near landslide risk zone: {lz['properties']['name']} ({lz['properties']['risk_level']})")
        if risky_roads and not blocked_roads:
            explanation.append(f"Runs alongside monitored corridor(s) at elevated risk: {', '.join(r.name for r in risky_roads)}")
        if not explanation:
            explanation.append("No known hazards, active incidents, or blocked corridors detected near this route.")

        return {
            "risk_score": total_score,
            "risk_level": risk_level,
            "blocked": bool(blocked_roads),
            "distance_km": distance_km,
            "duration_min": duration_min,
            "components": {
                "distance_cost": round(distance_cost, 1),
                "time_cost": round(time_cost, 1),
                "road_risk": round(road_risk, 1),
                "incident_risk": round(incident_risk, 1),
                "hazard_risk": round(hazard_risk, 1),
                "accessibility_penalty": accessibility_penalty
            },
            "matched_roads": [{"id": r.id, "name": r.name, "status": r.current_status, "risk_score": r.risk_score} for r in matched_roads],
            "matched_incidents": [{"id": i.id, "type": i.type, "severity": i.severity} for i in matched_incidents],
            "matched_flood_zones": [fz["properties"]["name"] for fz in matched_flood],
            "matched_landslide_zones": [lz["properties"]["name"] for lz in matched_landslide],
            "explanation": explanation
        }
