from pydantic import BaseModel
from typing import List, Optional, Any, Dict
import datetime

class UserAuthSchema(BaseModel):
    email: str
    password: str

class UserCreateSchema(BaseModel):
    name: str
    email: str
    password: str
    role: Optional[str] = "citizen"
    phone: Optional[str] = None
    language: Optional[str] = "EN"

class UserResponseSchema(BaseModel):
    id: int
    name: str
    email: str
    role: str
    language: str

class LocationPoint(BaseModel):
    latitude: float
    longitude: float
    name: Optional[str] = None

class RouteOptimizeRequest(BaseModel):
    origin: Optional[str] = "guwahati" # Hub ID string, e.g. "guwahati" (matches frontend NER_NODES keys)
    destination: Optional[str] = "agartala" # Hub ID string, e.g. "agartala" (matches frontend NER_NODES keys)
    vehicle_type: Optional[str] = "TRUCK" # CAR, TRUCK, AMBULANCE, RELIEF_VEHICLE, 4X4
    priority: Optional[str] = "NORMAL" # NORMAL, EMERGENCY, ESSENTIAL_SUPPLY
    avoid_high_risk: Optional[bool] = True
    avoid_blocked: Optional[bool] = True
    blocked_roads: Optional[List[str]] = []

class IncidentCreateSchema(BaseModel):
    type: str
    description: Optional[str] = ""
    latitude: float
    longitude: float
    severity: Optional[str] = "MODERATE"
    image_url: Optional[str] = None

class ReportCreateSchema(BaseModel):
    id: Optional[str] = None
    report_type: str
    latitude: float
    longitude: float
    description: Optional[str] = ""
    reporter_role: Optional[str] = "citizen"
    photo_url: Optional[str] = None

class DamageAnalyzeRequest(BaseModel):
    image_base64_or_url: str
    hazard_type: Optional[str] = "Landslide"

class VehicleLocationUpdate(BaseModel):
    latitude: float
    longitude: float
    status: Optional[str] = "IN_TRANSIT"

class RouteScoreRequest(BaseModel):
    # points: [[lat, lng], ...] sampled from a Google Directions/Routes candidate polyline
    points: List[List[float]]
    distance_km: float
    duration_min: float
    priority: Optional[str] = "NORMAL"  # NORMAL, EMERGENCY, ESSENTIAL_SUPPLY
    label: Optional[str] = None  # caller-supplied label (e.g. "Route A") echoed back
