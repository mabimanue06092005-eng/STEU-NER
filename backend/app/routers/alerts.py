from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db_conn import get_db
from app.models.models import Alert

router = APIRouter()

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
