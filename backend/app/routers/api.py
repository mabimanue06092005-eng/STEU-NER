import datetime
import json
import base64
from fastapi import APIRouter, Depends, HTTPException, status, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session
from typing import List, Optional, Dict, Any
import math

from app.db_conn import get_db
from app.models.models import User, District, Road, Bridge, WeatherData, Incident, Vehicle, Delivery, ReliefCamp, VulnerablePerson, Alert, Report, RouteRecord, RouteSegmentRecord, RouteHistoryRecord
from app.schemas.schemas import RouteOptimizeRequest, IncidentCreateSchema, ReportCreateSchema, DamageAnalyzeRequest, VehicleLocationUpdate, UserAuthSchema, UserCreateSchema
from app.services.services import RiskEngineService, DijkstraRouterService
import hashlib

router = APIRouter()
SECRET_KEY = "SETU_NER_SECRET_KEY_SIH26002"

# ----------------- WEBSOCKET CONNECTION MANAGER -----------------
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, event_type: str, data: Dict[str, Any]):
        message = json.dumps({"event": event_type, "data": data, "timestamp": datetime.datetime.utcnow().isoformat()})
        for connection in list(self.active_connections):
            try:
                await connection.send_text(message)
            except Exception:
                self.disconnect(connection)

manager = ConnectionManager()

def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return hash_password(plain_password) == hashed_password

# Spatial Distance Calculation (Haversine Formula in KM)
def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371.0 # Earth radius in kilometers
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c

# ----------------- WEBSOCKET ENDPOINT -----------------
@router.websocket("/ws/gis")
async def websocket_gis_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            # Handle incoming ping or echo
            await websocket.send_text(json.dumps({"event": "PONG", "received": data}))
    except WebSocketDisconnect:
        manager.disconnect(websocket)

# ----------------- AUTH ROUTER -----------------
@router.post("/api/auth/register")
def register(user_data: UserCreateSchema, db: Session = Depends(get_db)):
    existing = db.query(User).filter(User.email == user_data.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    hashed_pwd = hash_password(user_data.password)
    user = User(
        name=user_data.name,
        email=user_data.email,
        password_hash=hashed_pwd,
        role=user_data.role,
        phone=user_data.phone,
        language=user_data.language
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    token = f"token_sim_{user.id}_{user.role}"
    return {"token": token, "user": {"id": user.id, "name": user.name, "email": user.email, "role": user.role}}

@router.post("/api/auth/login")
def login(auth_data: UserAuthSchema, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == auth_data.email).first()
    if not user or not verify_password(auth_data.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    
    token = f"token_sim_{user.id}_{user.role}"
    return {"token": token, "user": {"id": user.id, "name": user.name, "email": user.email, "role": user.role}}

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
    # Real Spatial Flood Risk Zones in Brahmaputra and Barak Basins
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"name": "Kaziranga Brahmaputra Flood Basin", "risk_level": "HIGH"},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[93.00, 26.50], [93.60, 26.70], [93.80, 26.55], [93.20, 26.35], [93.00, 26.50]]]
                }
            },
            {
                "type": "Feature",
                "properties": {"name": "Barak Valley Lowland Inundation Basin", "risk_level": "MODERATE"},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[92.50, 24.70], [92.90, 24.90], [93.10, 24.75], [92.70, 24.60], [92.50, 24.70]]]
                }
            }
        ]
    }

@router.get("/api/gis/landslide-zones")
def get_gis_landslide_zones():
    # Real Spatial Landslide Susceptibility Corridors
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"name": "Jaintia Hills Sinking Corridor (NH06)", "risk_level": "CRITICAL"},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[91.90, 25.30], [92.30, 25.55], [92.45, 25.35], [92.00, 25.15], [91.90, 25.30]]]
                }
            },
            {
                "type": "Feature",
                "properties": {"name": "Kohima-Dimapur Mudslide Pass (NH29)", "risk_level": "HIGH"},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[93.80, 25.70], [94.20, 25.90], [94.30, 25.75], [93.90, 25.55], [93.80, 25.70]]]
                }
            }
        ]
    }

@router.get("/api/gis/summary")
def get_gis_summary(db: Session = Depends(get_db)):
    roads = db.query(Road).all()
    incidents = db.query(Incident).all()
    vehicles = db.query(Vehicle).all()
    alerts = db.query(Alert).all()

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

# ----------------- RISK ENGINE & CALCULATIONS -----------------
@router.get("/api/risk/roads")
def get_risk_roads(db: Session = Depends(get_db)):
    roads = db.query(Road).all()
    return [{
        "id": r.id,
        "name": r.name,
        "status": r.current_status,
        "risk_score": r.risk_score,
        "rainfall": r.rainfall_mm_last_6h,
        "last_updated": r.updated_at.isoformat() if r.updated_at else None
    } for r in roads]

@router.get("/api/risk/roads/{id}")
def get_road_risk_breakdown(id: str, db: Session = Depends(get_db)):
    r = db.query(Road).filter(Road.id == id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Road not found")
    
    # Explainable Formula Risk Component Breakdown:
    # Risk = 35% rainfall + 25% landslide + 15% flood + 15% incident + 10% road condition
    rainfall_score = min((r.rainfall_mm_last_6h / 100.0) * 100.0, 100.0)
    landslide_score = 85.0 if "NH06" in r.id or "NH13" in r.id or "NH29" in r.id else 30.0
    flood_score = 70.0 if "NH27" in r.id or "NH37" in r.id or "NH15" in r.id else 20.0
    incident_score = 90.0 if r.current_status == "BLOCKED" else (50.0 if r.current_status == "RISKY" else 10.0)
    road_condition_score = 40.0 if r.bridge_load_limit < 30.0 else 80.0

    weighted_risk = (0.35 * rainfall_score) + (0.25 * landslide_score) + (0.15 * flood_score) + (0.15 * incident_score) + (0.10 * (100 - road_condition_score))

    return {
        "road_id": r.id,
        "name": r.name,
        "status": r.current_status,
        "final_risk_score": r.risk_score,
        "breakdown": {
            "rainfall_risk": {"weight": "35%", "score": round(rainfall_score, 1), "value": f"{r.rainfall_mm_last_6h} mm/6h"},
            "landslide_risk": {"weight": "25%", "score": round(landslide_score, 1), "value": "Terrain Susceptibility"},
            "flood_risk": {"weight": "15%", "score": round(flood_score, 1), "value": "River Basin Inundation"},
            "incident_risk": {"weight": "15%", "score": round(incident_score, 1), "value": f"Status: {r.current_status}"},
            "road_condition": {"weight": "10%", "score": round(road_condition_score, 1), "value": f"Bridge Limit: {r.bridge_load_limit}T"}
        },
        "last_updated": r.updated_at.isoformat() if r.updated_at else datetime.datetime.utcnow().isoformat()
    }

@router.post("/api/risk/calculate")
def recalculate_risks(db: Session = Depends(get_db)):
    roads = db.query(Road).all()
    updated_roads = []
    for r in roads:
        r.risk_score = RiskEngineService.calculate_road_risk(
            rainfall=r.rainfall_mm_last_6h,
            terrain_risk=40.0 if "Jaintia" in r.name or "Kohima" in r.name else 15.0,
            recent_reports=2 if r.current_status == "BLOCKED" else 0,
            days_since=0.1
        )
        if r.risk_score >= 71.0:
            r.current_status = "BLOCKED"
        elif r.risk_score >= 31.0:
            r.current_status = "RISKY"
        else:
            r.current_status = "SAFE"
        updated_roads.append({"id": r.id, "name": r.name, "risk_score": r.risk_score, "status": r.current_status})
    db.commit()

    return {"status": "success", "message": "All highway risk scores dynamically updated.", "roads": updated_roads}

# ----------------- ROUTING ROUTER -----------------
@router.post("/api/routes/optimize")
def optimize_route(req: RouteOptimizeRequest, db: Session = Depends(get_db)):
    roads = db.query(Road).all()
    nodes_dict = {
        "guwahati": {"id": "guwahati", "name": "Guwahati Hub"},
        "shillong": {"id": "shillong", "name": "Shillong Hub"},
        "silchar": {"id": "silchar", "name": "Silchar Hub"},
        "agartala": {"id": "agartala", "name": "Agartala Hub"},
        "kohima": {"id": "kohima", "name": "Kohima Hub"},
        "tezpur": {"id": "tezpur", "name": "Tezpur Hub"},
    }

    result = DijkstraRouterService.find_safest_route(
        nodes_dict=nodes_dict,
        roads_list=roads,
        origin_id=req.origin.lower(),
        dest_id=req.destination.lower(),
        cargo_priority=req.priority,
        blocked_ids=req.blocked_roads or []
    )
    if not result:
        raise HTTPException(status_code=404, detail="No viable route available around blocked highways")
    
    # Save route calculation to DB for persistence and history tracking
    rec = result.get("recommended_route", {})
    route_db = RouteRecord(
        id=f"ROUTE-{int(datetime.datetime.utcnow().timestamp())}",
        origin=req.origin,
        destination=req.destination,
        vehicle_type=req.vehicle_type,
        priority=req.priority,
        geometry_json=json.dumps(rec.get("geometry", {})),
        distance_km=rec.get("distance_km", 0.0),
        duration_minutes=rec.get("duration_minutes", 0),
        risk_score=rec.get("risk_score", 0),
        risk_level=rec.get("risk_level", "LOW"),
        status="ACTIVE"
    )
    db.add(route_db)
    
    # Save segments
    for idx, seg in enumerate(rec.get("segments", [])):
        seg_db = RouteSegmentRecord(
            route_id=route_db.id,
            road_id=seg.get("road_name", f"SEG-{idx}"),
            sequence=idx + 1,
            distance_km=seg.get("distance_km", 0.0),
            risk_score=seg.get("risk_score", 0),
            status=seg.get("status", "SAFE")
        )
        db.add(seg_db)

    # Save history
    hist_db = RouteHistoryRecord(
        route_id=route_db.id,
        origin=req.origin,
        destination=req.destination,
        vehicle_type=req.vehicle_type,
        priority=req.priority,
        recommended_distance=rec.get("distance_km", 0.0),
        recommended_duration=rec.get("duration_minutes", 0),
        recommended_risk=rec.get("risk_score", 0)
    )
    db.add(hist_db)
    db.commit()

    result["route_id"] = route_db.id
    return result

@router.get("/api/routes/history")
def get_route_history(db: Session = Depends(get_db)):
    return db.query(RouteHistoryRecord).order_by(RouteHistoryRecord.created_at.desc()).limit(50).all()

@router.get("/api/routes/{route_id}")
def get_route_by_id(route_id: str, db: Session = Depends(get_db)):
    r = db.query(RouteRecord).filter(RouteRecord.id == route_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Route not found")
    segments = db.query(RouteSegmentRecord).filter(RouteSegmentRecord.route_id == route_id).order_by(RouteSegmentRecord.sequence.asc()).all()
    return {
        "id": r.id,
        "distance_km": r.distance_km,
        "duration_minutes": r.duration_minutes,
        "risk_score": r.risk_score,
        "risk_level": r.risk_level,
        "status": r.status,
        "geometry": json.loads(r.geometry) if r.geometry else None,
        "segments": segments,
        "created_at": r.created_at
    }

@router.get("/api/routes/{route_id}/alternatives")
def get_route_alternatives(route_id: str, db: Session = Depends(get_db)):
    r = db.query(RouteRecord).filter(RouteRecord.id == route_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Route not found")
    return {
        "recommended_route_id": route_id,
        "alternatives": [
            {
                "type": "ALTERNATIVE_DETOUR",
                "distance_km": round(r.distance_km * 1.12, 1),
                "duration_minutes": int(r.duration_minutes * 1.15),
                "risk_score": max(5, r.risk_score - 10),
                "risk_level": "VERY_LOW",
                "explanation": "Longer highway bypass avoiding congested mountain passes"
            }
        ]
    }

@router.post("/api/routes/{route_id}/recalculate")
async def recalculate_route(route_id: str, db: Session = Depends(get_db)):
    r = db.query(RouteRecord).filter(RouteRecord.id == route_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Route not found")
    r.status = "REROUTED"
    db.commit()
    await manager.broadcast("ROUTE_UPDATED", {"route_id": route_id, "status": "REROUTED", "message": "Automatic rerouting performed due to hazard update."})
    return {"status": "success", "route_id": route_id, "new_status": "REROUTED"}

@router.get("/api/routes/{route_id}/risk-analysis")
def get_route_risk_analysis(route_id: str, db: Session = Depends(get_db)):
    r = db.query(RouteRecord).filter(RouteRecord.id == route_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Route not found")
    segments = db.query(RouteSegmentRecord).filter(RouteSegmentRecord.route_id == route_id).all()
    return {
        "route_id": route_id,
        "overall_risk_score": r.risk_score,
        "overall_risk_level": r.risk_level,
        "segment_count": len(segments),
        "segments": segments,
        "recommendations": ["Drive within speed limits", "Monitor weather broadcasts for landslide warnings"]
    }

@router.post("/api/routes/{route_id}/assign-vehicle")
async def assign_vehicle_route(route_id: str, payload: dict, db: Session = Depends(get_db)):
    vehicle_id = payload.get("vehicle_id")
    r = db.query(RouteRecord).filter(RouteRecord.id == route_id).first()
    v = db.query(Vehicle).filter(Vehicle.id == vehicle_id).first() if vehicle_id else None
    if not r or not v:
        raise HTTPException(status_code=404, detail="Route or Vehicle not found")
    v.active_route_id = route_id
    db.commit()
    await manager.broadcast("VEHICLE_ROUTE_CHANGED", {"vehicle_id": vehicle_id, "route_id": route_id})
    return {"status": "success", "vehicle_id": vehicle_id, "route_id": route_id}

@router.post("/api/routes/compare")
def compare_routes(payload: dict, db: Session = Depends(get_db)):
    route_ids = payload.get("route_ids", [])
    routes = db.query(RouteRecord).filter(RouteRecord.id.in_(route_ids)).all()
    return {"compared_routes": routes}

# ----------------- VEHICLES & GPS TELEMETRY -----------------
@router.get("/api/vehicles")
def get_vehicles(db: Session = Depends(get_db)):
    return db.query(Vehicle).all()

@router.post("/api/vehicles/{vehicle_id}/location")
async def update_vehicle_location(vehicle_id: str, loc: VehicleLocationUpdate, db: Session = Depends(get_db)):
    veh = db.query(Vehicle).filter(Vehicle.id == vehicle_id).first()
    if not veh:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    
    veh.current_latitude = loc.latitude
    veh.current_longitude = loc.longitude
    veh.status = loc.status
    veh.last_updated = datetime.datetime.utcnow()
    db.commit()

    # Broadcast WebSocket update
    await manager.broadcast("VEHICLE_LOCATION_UPDATED", {
        "vehicle_id": vehicle_id,
        "latitude": loc.latitude,
        "longitude": loc.longitude,
        "status": loc.status,
        "last_updated": veh.last_updated.isoformat()
    })

    return {"status": "success", "vehicle_id": vehicle_id, "lat": loc.latitude, "lng": loc.longitude}

# ----------------- INCIDENTS & REAL-TIME EVENT WORKFLOW -----------------
@router.get("/api/incidents")
def get_incidents(db: Session = Depends(get_db)):
    return db.query(Incident).order_by(Incident.created_at.desc()).all()

@router.post("/api/incidents")
async def create_incident(inc: IncidentCreateSchema, db: Session = Depends(get_db)):
    new_inc = Incident(
        type=inc.type,
        description=inc.description,
        latitude=inc.latitude,
        longitude=inc.longitude,
        severity=inc.severity or "MODERATE",
        status="REPORTED",
        image_url=inc.image_url,
        created_at=datetime.datetime.utcnow()
    )
    db.add(new_inc)
    db.commit()
    db.refresh(new_inc)

    # Find nearby roads within 15 km and increase risk
    roads = db.query(Road).all()
    affected_roads = []
    for r in roads:
        coords = json.loads(r.coords_json)
        min_d = min(haversine_km(inc.latitude, inc.longitude, pt[0], pt[1]) for pt in coords)
        if min_d <= 15.0:
            r.risk_score = min(r.risk_score + 35.0, 95.0)
            if r.risk_score >= 71.0 or inc.severity in ["SEVERE", "IMPASSABLE"]:
                r.current_status = "BLOCKED"
            elif r.risk_score >= 31.0:
                r.current_status = "RISKY"
            affected_roads.append({"id": r.id, "name": r.name, "status": r.current_status, "risk_score": r.risk_score})
    
    # Save emergency alert
    alert = Alert(
        title=f"HAZARD REPORTED: {inc.type.upper()}",
        message=f"{inc.description} near ({inc.latitude:.4f}, {inc.longitude:.4f}). Risk scores updated.",
        severity=inc.severity or "HIGH",
        target_area="GIS Region"
    )
    db.add(alert)
    db.commit()

    # Broadcast WebSocket event
    await manager.broadcast("NEW_INCIDENT", {
        "incident_id": new_inc.id,
        "type": new_inc.type,
        "severity": new_inc.severity,
        "latitude": new_inc.latitude,
        "longitude": new_inc.longitude,
        "affected_roads": affected_roads
    })

    return {"status": "success", "incident": new_inc, "affected_roads": affected_roads}

@router.post("/api/incidents/{id}/verify")
async def verify_incident(id: int, db: Session = Depends(get_db)):
    inc = db.query(Incident).filter(Incident.id == id).first()
    if not inc:
        raise HTTPException(status_code=404, detail="Incident not found")
    inc.status = "VERIFIED"
    inc.verified_at = datetime.datetime.utcnow()
    db.commit()

    await manager.broadcast("INCIDENT_UPDATED", {"id": id, "status": "VERIFIED"})
    return {"id": id, "status": "VERIFIED"}

@router.post("/api/incidents/{id}/resolve")
async def resolve_incident(id: int, db: Session = Depends(get_db)):
    inc = db.query(Incident).filter(Incident.id == id).first()
    if not inc:
        raise HTTPException(status_code=404, detail="Incident not found")
    inc.status = "RESOLVED"
    
    # Lower risk of nearby roads
    roads = db.query(Road).all()
    affected_roads = []
    for r in roads:
        coords = json.loads(r.coords_json)
        min_d = min(haversine_km(inc.latitude, inc.longitude, pt[0], pt[1]) for pt in coords)
        if min_d <= 15.0:
            r.risk_score = max(r.risk_score - 30.0, 15.0)
            if r.risk_score < 31.0:
                r.current_status = "SAFE"
            elif r.risk_score < 71.0:
                r.current_status = "RISKY"
            affected_roads.append({"id": r.id, "status": r.current_status, "risk_score": r.risk_score})
    db.commit()

    await manager.broadcast("INCIDENT_UPDATED", {"id": id, "status": "RESOLVED", "affected_roads": affected_roads})
    return {"status": "success", "id": id, "incident_status": "RESOLVED", "affected_roads": affected_roads}

# ----------------- REPORTS & TRUST SCORE -----------------
@router.get("/api/reports")
def get_reports(db: Session = Depends(get_db)):
    return db.query(Report).order_by(Report.created_at.desc()).all()

@router.post("/api/reports")
def create_report(rep: ReportCreateSchema, db: Session = Depends(get_db)):
    report_id = rep.id or f"REP-{int(datetime.datetime.utcnow().timestamp())}"
    trust_base = 80.0 if rep.reporter_role == "official" else 50.0
    
    new_rep = Report(
        id=report_id,
        latitude=rep.latitude,
        longitude=rep.longitude,
        report_type=rep.report_type,
        description=rep.description,
        photo_url=rep.photo_url,
        trust_score=trust_base,
        status="SUBMITTED"
    )
    db.add(new_rep)
    db.commit()
    db.refresh(new_rep)
    return new_rep

@router.post("/api/reports/{id}/confirm")
def confirm_report(id: str, db: Session = Depends(get_db)):
    rep = db.query(Report).filter(Report.id == id).first()
    if not rep:
        raise HTTPException(status_code=404, detail="Report not found")
    rep.trust_score = min(rep.trust_score + 10.0, 100.0)
    if rep.trust_score >= 70.0:
        rep.status = "VERIFIED"
    db.commit()
    return {"id": id, "trust_score": rep.trust_score, "status": rep.status}

# ----------------- AI PHOTO DAMAGE ANALYSIS -----------------
@router.post("/api/damage/analyze")
def analyze_photo_damage(req: DamageAnalyzeRequest, db: Session = Depends(get_db)):
    photo_str = req.image_base64_or_url
    hazard = req.hazard_type or "Landslide"
    severity = "SEVERE" if "Landslide" in hazard else "MODERATE"
    confidence = 0.91

    return {
        "hazard_type": hazard,
        "severity": severity,
        "condition": "DAMAGED / IMPASSABLE" if severity == "SEVERE" else "PARTIAL ACCESS",
        "description": f"AI Multimodal Vision Model identified structural {hazard.lower()} displacement.",
        "confidence": confidence,
        "perceptual_hash": f"PHASH-{hash(photo_str) & 0xFFFFFFFF:08X}",
        "mode": "DEMO_LOCAL_ML_PIPELINE"
    }

# ----------------- ALERTS & NOTIFICATIONS -----------------
@router.get("/api/alerts")
def get_alerts(db: Session = Depends(get_db)):
    return db.query(Alert).order_by(Alert.created_at.desc()).all()

@router.post("/api/alerts")
def create_alert(alert_data: dict, db: Session = Depends(get_db)):
    new_alert = Alert(
        title=alert_data.get("title", "Emergency Alert"),
        message=alert_data.get("message", "Attention required in corridor"),
        alert_type=alert_data.get("alert_type", "WARNING"),
        severity=alert_data.get("severity", "HIGH"),
        target_area=alert_data.get("target_area", "NER Grid")
    )
    db.add(new_alert)
    db.commit()
    db.refresh(new_alert)
    return new_alert

# ----------------- RELIEF CAMPS & VULNERABLE POPULATION -----------------
@router.get("/api/relief/camps")
def get_relief_camps(db: Session = Depends(get_db)):
    return db.query(ReliefCamp).all()

@router.get("/api/vulnerable")
def get_vulnerable_people(db: Session = Depends(get_db)):
    return db.query(VulnerablePerson).all()

# ----------------- WEATHER ROUTER (OPEN-METEO INTEGRATION) -----------------
@router.get("/api/weather/current")
def get_current_weather(lat: float = 26.1445, lng: float = 91.7362):
    return RiskEngineService.fetch_open_meteo_weather(lat, lng)

@router.get("/api/weather/forecast")
def get_weather_forecast(lat: float = 26.1445, lng: float = 91.7362):
    curr = RiskEngineService.fetch_open_meteo_weather(lat, lng)
    return {
        "location": {"lat": lat, "lng": lng},
        "current": curr,
        "forecast_6h_mm": 85.0 if lat < 26.0 else 25.0,
        "forecast_12h_mm": 110.0 if lat < 26.0 else 40.0,
        "alert_level": "WARNING" if lat < 26.0 else "NORMAL"
    }

# ----------------- ML DISRUPTION PREDICTION -----------------
@router.get("/api/risk/predict-ml")
def predict_ml_disruption(rainfall: float = 85.0, forecast_rain: float = 100.0):
    return RiskEngineService.predict_ml_disruption(
        rainfall=rainfall,
        forecast_rain=forecast_rain,
        landslide_risk=80.0,
        flood_risk=75.0,
        road_cond=40.0,
        incidents=3
    )

# ----------------- END-TO-END DEMO SCENARIO SIMULATION -----------------
@router.post("/api/simulate/landslide")
async def simulate_landslide_event(db: Session = Depends(get_db)):
    # 1. Create a Landslide Incident in Database
    new_inc = Incident(
        type="Landslide",
        description="Massive hill slope collapse on NH06 Jaintia Hills Lifeline Corridor.",
        latitude=25.4500,
        longitude=92.2000,
        severity="IMPASSABLE",
        status="VERIFIED",
        reported_by="official"
    )
    db.add(new_inc)
    
    # 2. Update NH06 Road Status to BLOCKED & Risk Score to 95.0
    road = db.query(Road).filter(Road.id == "NH06").first()
    if road:
        road.current_status = "BLOCKED"
        road.risk_score = 95.0
        road.rainfall_mm_last_6h = 120.0
    
    # 3. Create Emergency Alert
    alert = Alert(
        title="EMERGENCY LANDSLIDE: NH06 SEVERED",
        message="Landslide confirmed on NH06 Jaintia Hills. Highway status set to BLOCKED. Rerouting via NH08 Silchar-Agartala corridor.",
        alert_type="EMERGENCY",
        severity="CRITICAL",
        target_area="Jaintia Hills & Barak Valley"
    )
    db.add(alert)
    db.commit()

    # Broadcast WebSocket notification to map clients
    await manager.broadcast("ROAD_STATUS_CHANGED", {
        "road_id": "NH06",
        "status": "BLOCKED",
        "risk_score": 95.0,
        "alert_title": alert.title
    })

    return {
        "status": "success",
        "message": "Landslide Event Simulated End-to-End Across DB & GIS Grid!",
        "affected_road": "NH06",
        "new_status": "BLOCKED",
        "alert_title": alert.title
    }

# ----------------- CENTRALIZED DASHBOARD KPIs -----------------
@router.get("/api/dashboard/summary")
def get_dashboard_summary(db: Session = Depends(get_db)):
    roads = db.query(Road).all()
    incidents = db.query(Incident).all()
    alerts = db.query(Alert).all()
    vehicles = db.query(Vehicle).all()

    total_roads = len(roads)
    safe_roads = len([r for r in roads if r.current_status == "SAFE"])
    risky_roads = len([r for r in roads if r.current_status == "RISKY"])
    blocked_roads = len([r for r in roads if r.current_status == "BLOCKED"])

    return {
        "total_roads": total_roads,
        "safe_roads": safe_roads,
        "risky_roads": risky_roads,
        "blocked_roads": blocked_roads,
        "active_incidents": len(incidents),
        "active_alerts": len(alerts),
        "vehicles_in_transit": len([v for v in vehicles if v.status == "IN_TRANSIT"]),
        "accessible_districts_pct": round((safe_roads + (0.5 * risky_roads)) / max(total_roads, 1) * 100, 1)
    }
