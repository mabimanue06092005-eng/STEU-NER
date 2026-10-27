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
    origin: Optional[Any] = "guwahati" # Can be string ID ("guwahati") or LocationPoint dict
    destination: Optional[Any] = "agartala" # Can be string ID ("agartala") or LocationPoint dict
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
    speed: Optional[float] = 0.0
    heading: Optional[float] = 0.0
    accuracy: Optional[float] = 10.0
    timestamp: Optional[str] = None
    status: Optional[str] = None

class VehicleCreateSchema(BaseModel):
    id: Optional[str] = None
    vehicle_number: str
    vehicle_type: Optional[str] = "Truck"
    driver_name: Optional[str] = "Driver"
    driver_phone: Optional[str] = None
    cargo_type: Optional[str] = "Emergency Medicines"
    cargo_description: Optional[str] = ""
    origin: Optional[str] = "Guwahati"
    destination: Optional[str] = "Shillong"
    priority: Optional[str] = "HIGH"
    status: Optional[str] = "IN_TRANSIT"
    current_latitude: float
    current_longitude: float
    current_speed: Optional[float] = 40.0
    current_heading: Optional[float] = 90.0

class VehicleUpdateSchema(BaseModel):
    vehicle_number: Optional[str] = None
    vehicle_type: Optional[str] = None
    driver_name: Optional[str] = None
    driver_phone: Optional[str] = None
    cargo_type: Optional[str] = None
    cargo_description: Optional[str] = None
    origin: Optional[str] = None
    destination: Optional[str] = None
    priority: Optional[str] = None
    status: Optional[str] = None

class DeliveryStatusUpdate(BaseModel):
    status: str

