import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db_conn import get_db
from app.models.models import Road
from app.services.risk_service import RiskEngineService

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
