from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db_conn import get_db
from app.models.models import ReliefCamp, VulnerablePerson

router = APIRouter()

# ----------------- RELIEF CAMPS & VULNERABLE POPULATION -----------------
@router.get("/api/relief/camps")
def get_relief_camps(db: Session = Depends(get_db)):
    return db.query(ReliefCamp).all()

@router.get("/api/vulnerable")
def get_vulnerable_people(db: Session = Depends(get_db)):
    return db.query(VulnerablePerson).all()
