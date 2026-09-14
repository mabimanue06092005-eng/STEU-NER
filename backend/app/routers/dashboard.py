from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db_conn import get_db
from app.models.models import Road, Incident, Alert, Vehicle

router = APIRouter()

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
