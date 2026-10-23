import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db_conn import get_db
from app.models.models import Road
from app.services.risk_service import RiskEngineService
from app.core.ws_manager import manager

router = APIRouter()

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

    # Explainable Formula Risk Component Breakdown (single authoritative formula,
    # shared with /api/risk/calculate via RiskEngineService.calculate_road_risk_breakdown):
    # Risk = 35% rainfall + 25% landslide + 15% flood + 15% incident + 10% road condition
    result = RiskEngineService.calculate_road_risk_breakdown(r)

    return {
        "road_id": r.id,
        "name": r.name,
        "status": r.current_status,
        "final_risk_score": result["final_score"],
        "breakdown": result["breakdown"],
        "last_updated": r.updated_at.isoformat() if r.updated_at else datetime.datetime.utcnow().isoformat()
    }

@router.post("/api/risk/calculate")
async def recalculate_risks(db: Session = Depends(get_db)):
    roads = db.query(Road).all()
    updated_roads = []
    for r in roads:
        result = RiskEngineService.calculate_road_risk_breakdown(r)
        r.risk_score = result["final_score"]
        r.current_status = RiskEngineService.get_risk_status(r.risk_score)
        updated_roads.append({"id": r.id, "name": r.name, "risk_score": r.risk_score, "status": r.current_status})
    db.commit()

    # Broadcast so connected clients (map, dashboard) refresh without polling —
    # every other risk/road mutation in this app already broadcasts; this bulk
    # recalculation was the one gap (noted at the end of Phase 2).
    await manager.broadcast("RISK_UPDATED", {"roads": updated_roads})

    return {"status": "success", "message": "All highway risk scores dynamically updated.", "roads": updated_roads}

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
