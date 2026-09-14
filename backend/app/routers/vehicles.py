import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db_conn import get_db
from app.models.models import Vehicle
from app.schemas.schemas import VehicleLocationUpdate
from app.core.ws_manager import manager

router = APIRouter()

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
