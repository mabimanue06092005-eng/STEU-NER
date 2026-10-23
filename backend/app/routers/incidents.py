import datetime
import json
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db_conn import get_db
from app.models.models import Incident, Road, Alert, Report
from app.schemas.schemas import IncidentCreateSchema, ReportCreateSchema, DamageAnalyzeRequest
from app.core.geo_utils import haversine_km
from app.core.ws_manager import manager
from app.services.risk_service import RiskEngineService

router = APIRouter()

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
            r.current_status = "BLOCKED" if inc.severity in ["SEVERE", "IMPASSABLE"] else RiskEngineService.get_risk_status(r.risk_score)
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
            r.current_status = RiskEngineService.get_risk_status(r.risk_score)
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
