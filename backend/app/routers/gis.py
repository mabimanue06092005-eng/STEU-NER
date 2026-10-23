import datetime
import json
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db_conn import get_db
from app.models.models import District, Road, Incident, Vehicle, ReliefCamp
from app.core.geo_utils import haversine_km
from app.core.hazard_zones import FLOOD_ZONES, LANDSLIDE_ZONES

router = APIRouter()

# ----------------- GIS GEOJSON ENDPOINTS -----------------
@router.get("/api/gis/roads")
@router.get("/api/map/roads")
def get_map_roads(bbox: Optional[str] = None, db: Session = Depends(get_db)):
    query = db.query(Road)
    roads = query.all()
    features = []

    # Check bounding box filter if provided: minLng,minLat,maxLng,maxLat
    bbox_filter = None
    if bbox:
        try:
            parts = [float(p) for p in bbox.split(",")]
            if len(parts) == 4:
                bbox_filter = parts # [min_lng, min_lat, max_lng, max_lat]
        except ValueError:
            pass

    for r in roads:
        coords = json.loads(r.coords_json) # [[lat, lng], ...]

        # Spatial bbox filter check
        if bbox_filter:
            min_lng, min_lat, max_lng, max_lat = bbox_filter
            in_view = any(min_lat <= pt[0] <= max_lat and min_lng <= pt[1] <= max_lng for pt in coords)
            if not in_view:
                continue

        features.append({
            "type": "Feature",
            "properties": {
                "id": r.id,
                "name": r.name,
                "status": r.current_status,
                "risk_score": r.risk_score,
                "distance_km": r.distance_km,
                "base_travel_time": r.base_travel_time,
                "rainfall_mm_last_6h": r.rainfall_mm_last_6h,
                "bridge_load_limit": r.bridge_load_limit,
                "updated_at": r.updated_at.isoformat() if r.updated_at else datetime.datetime.utcnow().isoformat()
            },
            "geometry": {
                "type": "LineString",
                "coordinates": [[pt[1], pt[0]] for pt in coords] # GeoJSON standard: [lng, lat]
            }
        })
    return {"type": "FeatureCollection", "features": features}

@router.get("/api/gis/roads/{id}")
def get_road_detail(id: str, db: Session = Depends(get_db)):
    r = db.query(Road).filter(Road.id == id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Road not found")

    incidents = db.query(Incident).all()
    nearby_inc = []
    coords = json.loads(r.coords_json)
    for inc in incidents:
        for pt in coords:
            if haversine_km(pt[0], pt[1], inc.latitude, inc.longitude) <= 15.0:
                nearby_inc.append({
                    "id": inc.id,
                    "type": inc.type,
                    "severity": inc.severity,
                    "description": inc.description,
                    "latitude": inc.latitude,
                    "longitude": inc.longitude
                })
                break

    return {
        "id": r.id,
        "name": r.name,
        "status": r.current_status,
        "risk_score": r.risk_score,
        "distance_km": r.distance_km,
        "base_travel_time": r.base_travel_time,
        "rainfall_mm_last_6h": r.rainfall_mm_last_6h,
        "bridge_load_limit": r.bridge_load_limit,
        "updated_at": r.updated_at.isoformat() if r.updated_at else None,
        "nearby_incidents": nearby_inc,
        "coords": coords
    }

@router.get("/api/gis/districts")
def get_gis_districts(db: Session = Depends(get_db)):
    districts = db.query(District).all()
    features = []
    for d in districts:
        geom = json.loads(d.geometry_json) if d.geometry_json else None
        features.append({
            "type": "Feature",
            "properties": {
                "id": d.id,
                "name": d.name,
                "state": d.state
            },
            "geometry": geom or {
                "type": "Point",
                "coordinates": [91.7362, 26.1445]
            }
        })
    return {"type": "FeatureCollection", "features": features}

@router.get("/api/gis/districts/{id}/summary")
def get_district_summary(id: int, db: Session = Depends(get_db)):
    district = db.query(District).filter(District.id == id).first()
    if not district:
        raise HTTPException(status_code=404, detail="District not found")

    roads = db.query(Road).all()
    incidents = db.query(Incident).all()
    vehicles = db.query(Vehicle).all()

    safe = len([r for r in roads if r.current_status == "SAFE"])
    risky = len([r for r in roads if r.current_status == "RISKY"])
    blocked = len([r for r in roads if r.current_status == "BLOCKED"])
    acc_score = round(100.0 - ((risky * 15.0 + blocked * 35.0) / max(len(roads), 1)), 1)

    return {
        "id": district.id,
        "district_name": district.name,
        "state": district.state,
        "total_roads": len(roads),
        "safe_roads": safe,
        "risky_roads": risky,
        "blocked_roads": blocked,
        "active_incidents": len(incidents),
        "vehicles_in_transit": len(vehicles),
        "accessibility_score": max(acc_score, 10.0),
        "rainfall_mm": 45.0 if "Meghalaya" in district.state else 15.0
    }

@router.get("/api/gis/incidents")
def get_gis_incidents(db: Session = Depends(get_db)):
    incidents = db.query(Incident).all()
    features = []
    for inc in incidents:
        features.append({
            "type": "Feature",
            "properties": {
                "id": inc.id,
                "type": inc.type,
                "severity": inc.severity,
                "status": inc.status,
                "description": inc.description,
                "reported_by": inc.reported_by,
                "created_at": inc.created_at.isoformat() if inc.created_at else None
            },
            "geometry": {
                "type": "Point",
                "coordinates": [inc.longitude, inc.latitude]
            }
        })
    return {"type": "FeatureCollection", "features": features}

@router.get("/api/gis/vehicles")
def get_gis_vehicles(db: Session = Depends(get_db)):
    vehicles = db.query(Vehicle).all()
    features = []
    for v in vehicles:
        features.append({
            "type": "Feature",
            "properties": {
                "id": v.id,
                "vehicle_number": v.vehicle_number,
                "vehicle_type": v.vehicle_type,
                "destination": v.destination,
                "status": v.status,
                "last_updated": v.last_updated.isoformat() if v.last_updated else None
            },
            "geometry": {
                "type": "Point",
                "coordinates": [v.current_longitude, v.current_latitude]
            }
        })
    return {"type": "FeatureCollection", "features": features}

@router.get("/api/gis/relief-camps")
def get_gis_relief_camps(db: Session = Depends(get_db)):
    camps = db.query(ReliefCamp).all()
    features = []
    for c in camps:
        features.append({
            "type": "Feature",
            "properties": {
                "id": c.id,
                "name": c.name,
                "capacity": c.capacity,
                "current_occupancy": c.current_occupancy,
                "status": c.status
            },
            "geometry": {
                "type": "Point",
                "coordinates": [c.longitude, c.latitude]
            }
        })
    return {"type": "FeatureCollection", "features": features}

@router.get("/api/gis/flood-zones")
def get_gis_flood_zones():
    # Development seed data (not a live authority feed) — see app/core/hazard_zones.py
    return FLOOD_ZONES

@router.get("/api/gis/landslide-zones")
def get_gis_landslide_zones():
    # Development seed data (not a live authority feed) — see app/core/hazard_zones.py
    return LANDSLIDE_ZONES

@router.get("/api/gis/summary")
def get_gis_summary(db: Session = Depends(get_db)):
    roads = db.query(Road).all()
    incidents = db.query(Incident).all()
    vehicles = db.query(Vehicle).all()

    safe = len([r for r in roads if r.current_status == "SAFE"])
    risky = len([r for r in roads if r.current_status == "RISKY"])
    blocked = len([r for r in roads if r.current_status == "BLOCKED"])

    return {
        "safe_roads": safe,
        "risky_roads": risky,
        "blocked_roads": blocked,
        "active_incidents": len(incidents),
        "vehicles_in_transit": len([v for v in vehicles if v.status == "IN_TRANSIT"]),
        "affected_districts": 4,
        "last_updated": datetime.datetime.utcnow().isoformat()
    }

@router.get("/api/gis/nearby")
def get_nearby_gis_entities(lat: float, lng: float, radius: float = 50.0, db: Session = Depends(get_db)):
    # Spatial proximity search for nearby incidents, roads, and relief camps
    incidents = db.query(Incident).all()
    roads = db.query(Road).all()
    camps = db.query(ReliefCamp).all()

    nearby_inc = []
    for inc in incidents:
        dist = haversine_km(lat, lng, inc.latitude, inc.longitude)
        if dist <= radius:
            nearby_inc.append({"id": inc.id, "type": inc.type, "dist_km": round(dist, 1), "lat": inc.latitude, "lng": inc.longitude, "severity": inc.severity})

    nearby_camps = []
    for c in camps:
        dist = haversine_km(lat, lng, c.latitude, c.longitude)
        if dist <= radius:
            nearby_camps.append({"id": c.id, "name": c.name, "dist_km": round(dist, 1), "occupancy": c.current_occupancy, "capacity": c.capacity})

    nearby_rds = []
    for r in roads:
        coords = json.loads(r.coords_json)
        min_d = min(haversine_km(lat, lng, pt[0], pt[1]) for pt in coords)
        if min_d <= radius:
            nearby_rds.append({"id": r.id, "name": r.name, "status": r.current_status, "risk_score": r.risk_score, "dist_km": round(min_d, 1)})

    return {
        "query_location": {"lat": lat, "lng": lng},
        "radius_km": radius,
        "nearby_incidents": nearby_inc,
        "nearby_roads": nearby_rds,
        "nearby_camps": nearby_camps
    }

@router.get("/api/gis/search")
def search_gis_entities(q: str, db: Session = Depends(get_db)):
    query_str = q.lower().strip()
    roads = db.query(Road).filter(Road.name.ilike(f"%{query_str}%")).all()
    districts = db.query(District).filter(District.name.ilike(f"%{query_str}%")).all()
    camps = db.query(ReliefCamp).filter(ReliefCamp.name.ilike(f"%{query_str}%")).all()

    results = []
    for r in roads:
        coords = json.loads(r.coords_json)
        results.append({"type": "road", "id": r.id, "title": r.name, "subtitle": f"Status: {r.current_status} | Risk: {r.risk_score}", "lat": coords[0][0], "lng": coords[0][1]})
    for d in districts:
        results.append({"type": "district", "id": str(d.id), "title": f"{d.name}, {d.state}", "subtitle": "District Headquarters", "lat": 26.1445 if "Guwahati" in d.name else 25.5788, "lng": 91.7362 if "Guwahati" in d.name else 91.8933})
    for c in camps:
        results.append({"type": "camp", "id": str(c.id), "title": c.name, "subtitle": f"Capacity: {c.current_occupancy}/{c.capacity}", "lat": c.latitude, "lng": c.longitude})

    return {"query": q, "results": results}
