import datetime
import json
from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, Boolean, Text
from sqlalchemy.orm import relationship
from app.db_conn import Base

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    phone = Column(String, nullable=True)
    email = Column(String, unique=True, index=True, nullable=False)
    password_hash = Column(String, nullable=False)
    role = Column(String, default="citizen") # admin, official, driver, citizen
    language = Column(String, default="EN")
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

class District(Base):
    __tablename__ = "districts"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    state = Column(String, nullable=False)
    geometry_json = Column(Text, nullable=True)

class Road(Base):
    __tablename__ = "roads"

    id = Column(String, primary_key=True, index=True) # e.g. NH06
    name = Column(String, nullable=False)
    road_type = Column(String, default="Highway")
    district_id = Column(Integer, ForeignKey("districts.id"), nullable=True)
    coords_json = Column(Text, nullable=False) # Store [[lat, lng], ...]
    current_status = Column(String, default="SAFE") # SAFE, RISKY, BLOCKED
    risk_score = Column(Float, default=15.0)
    speed_limit = Column(Integer, default=60)
    distance_km = Column(Float, default=100.0)
    base_travel_time = Column(Float, default=2.5)
    rainfall_mm_last_6h = Column(Float, default=10.0)
    bridge_load_limit = Column(Float, default=40.0)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

class Bridge(Base):
    __tablename__ = "bridges"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    road_id = Column(String, ForeignKey("roads.id"), nullable=False)
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    condition = Column(String, default="Good")
    status = Column(String, default="OPERATIONAL")
    updated_at = Column(DateTime, default=datetime.datetime.utcnow)

class WeatherData(Base):
    __tablename__ = "weather_data"

    id = Column(Integer, primary_key=True, index=True)
    location = Column(String, nullable=False)
    rainfall = Column(Float, default=0.0)
    forecast_rainfall = Column(Float, default=0.0)
    temperature = Column(Float, default=24.0)
    timestamp = Column(DateTime, default=datetime.datetime.utcnow)

class Incident(Base):
    __tablename__ = "incidents"

    id = Column(Integer, primary_key=True, index=True)
    type = Column(String, nullable=False) # Landslide, Bridge Damage, Waterlogging
    description = Column(Text, nullable=True)
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    severity = Column(String, default="MODERATE") # MINOR, MODERATE, SEVERE, IMPASSABLE
    status = Column(String, default="REPORTED")
    reported_by = Column(String, default="citizen")
    image_url = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    verified_at = Column(DateTime, nullable=True)

class Vehicle(Base):
    __tablename__ = "vehicles"

    id = Column(String, primary_key=True, index=True)
    vehicle_number = Column(String, nullable=False)
    vehicle_type = Column(String, default="Truck")
    driver_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    current_latitude = Column(Float, nullable=False)
    current_longitude = Column(Float, nullable=False)
    destination = Column(String, nullable=True)
    status = Column(String, default="IN_TRANSIT") # NOT_STARTED, IN_TRANSIT, DELAYED, DELIVERED
    last_updated = Column(DateTime, default=datetime.datetime.utcnow)

class Delivery(Base):
    __tablename__ = "deliveries"

    id = Column(Integer, primary_key=True, index=True)
    vehicle_id = Column(String, ForeignKey("vehicles.id"), nullable=False)
    commodity_type = Column(String, nullable=False)
    origin = Column(String, nullable=False)
    destination = Column(String, nullable=False)
    priority = Column(String, default="NORMAL") # URGENT, HIGH, NORMAL
    status = Column(String, default="IN_TRANSIT")
    eta_hours = Column(Float, default=4.5)

class ReliefCamp(Base):
    __tablename__ = "relief_camps"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    capacity = Column(Integer, default=500)
    current_occupancy = Column(Integer, default=120)
    medical_staff_present = Column(Boolean, default=True)
    status = Column(String, default="OPEN")

class VulnerablePerson(Base):
    __tablename__ = "vulnerable_people"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    category = Column(String, nullable=False) # Elderly, Pregnant, PwD, Medical Emergency
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    urgency = Column(Integer, default=80)
    status = Column(String, default="PENDING")

class Alert(Base):
    __tablename__ = "alerts"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, nullable=False)
    message = Column(Text, nullable=False)
    alert_type = Column(String, default="WARNING")
    severity = Column(String, default="HIGH")
    target_area = Column(String, default="NER Grid")
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

class Report(Base):
    __tablename__ = "reports"

    id = Column(String, primary_key=True, index=True)
    reporter_id = Column(String, default="ANONYMOUS")
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    report_type = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    photo_url = Column(String, nullable=True)
    trust_score = Column(Float, default=50.0)
    status = Column(String, default="SUBMITTED")
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

class RouteRecord(Base):
    __tablename__ = "routes"

    id = Column(String, primary_key=True, index=True)
    origin = Column(String, nullable=False)
    destination = Column(String, nullable=False)
    vehicle_type = Column(String, default="TRUCK")
    priority = Column(String, default="NORMAL")
    distance_km = Column(Float, nullable=False)
    duration_minutes = Column(Float, nullable=False)
    risk_score = Column(Float, nullable=False)
    risk_level = Column(String, default="LOW")
    geometry_json = Column(Text, nullable=False)
    avoided_roads_json = Column(Text, default="[]")
    status = Column(String, default="ACTIVE")
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

class RouteSegmentRecord(Base):
    __tablename__ = "route_segments"

    id = Column(Integer, primary_key=True, index=True)
    route_id = Column(String, ForeignKey("routes.id"), nullable=False)
    road_id = Column(String, nullable=False)
    sequence = Column(Integer, default=0)
    distance_km = Column(Float, default=0.0)
    risk_score = Column(Float, default=15.0)
    status = Column(String, default="SAFE")

class RouteHistoryRecord(Base):
    __tablename__ = "route_history"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String, default="DISPATCH-OFFICER-1")
    route_id = Column(String, nullable=False)
    origin = Column(String, nullable=False)
    destination = Column(String, nullable=False)
    vehicle_type = Column(String, default="TRUCK")
    priority = Column(String, default="NORMAL")
    recommended_distance = Column(Float, default=0.0)
    recommended_duration = Column(Float, default=0.0)
    recommended_risk = Column(Float, default=0.0)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

