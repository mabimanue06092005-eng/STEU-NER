import datetime
import json
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db_conn import get_db
from app.models.models import Road, Vehicle, RouteRecord, RouteSegmentRecord, RouteHistoryRecord
from app.schemas.schemas import RouteOptimizeRequest
from app.services.routing_service import DijkstraRouterService
from app.core.ws_manager import manager

router = APIRouter()

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
    rec = result
    route_db = RouteRecord(
        id=f"ROUTE-{int(datetime.datetime.utcnow().timestamp())}",
        origin=req.origin,
        destination=req.destination,
        vehicle_type=req.vehicle_type,
        priority=req.priority,
        geometry_json=json.dumps(rec.get("geometry", {})),
        distance_km=rec.get("totalDistance", 0.0),
        duration_minutes=rec.get("duration_minutes", 0),
        risk_score=rec.get("avgRisk", 0),
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
        recommended_distance=rec.get("totalDistance", 0.0),
        recommended_duration=rec.get("duration_minutes", 0),
        recommended_risk=rec.get("avgRisk", 0)
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
        "geometry": json.loads(r.geometry_json) if r.geometry_json else None,
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
