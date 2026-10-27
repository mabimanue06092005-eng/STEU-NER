import json
import heapq
from app.models.models import Road, Incident, WeatherData, Alert

import numpy as np
from sklearn.ensemble import RandomForestClassifier
import requests

class RiskEngineService:
    _model = None

    @classmethod
    def get_or_train_ml_model(cls):
        if cls._model is None:
            # Seed training data [rainfall, forecast_rain, landslide_history, flood_history, road_condition, incidents] -> [0: SAFE, 1: RISKY, 2: DISRUPTION_LIKELY]
            X = np.array([
                [10, 15, 10, 5, 90, 0],
                [45, 60, 40, 30, 70, 1],
                [90, 110, 85, 80, 40, 3],
                [5, 10, 5, 0, 95, 0],
                [80, 95, 75, 60, 50, 2],
                [30, 35, 20, 15, 80, 0],
                [120, 140, 90, 90, 30, 4],
            ])
            y = np.array([0, 1, 2, 0, 2, 0, 2])
            cls._model = RandomForestClassifier(n_estimators=10, random_state=42)
            cls._model.fit(X, y)
        return cls._model

    @classmethod
    def predict_ml_disruption(cls, rainfall: float, forecast_rain: float, landslide_risk: float, flood_risk: float, road_cond: float, incidents: int):
        model = cls.get_or_train_ml_model()
        features = np.array([[rainfall, forecast_rain, landslide_risk, flood_risk, road_cond, incidents]])
        pred_idx = model.predict(features)[0]
        probs = model.predict_proba(features)[0]
        
        labels = ["SAFE", "RISKY", "DISRUPTION_LIKELY"]
        return {
            "prediction": labels[pred_idx],
            "confidence": round(float(probs[pred_idx]), 2),
            "factors": {
                "rainfall_weight": 0.35,
                "landslide_weight": 0.25,
                "flood_weight": 0.15,
                "incidents_weight": 0.15,
                "road_condition_weight": 0.10
            }
        }

    @staticmethod
    def fetch_open_meteo_weather(lat: float = 26.1445, lng: float = 91.7362):
        try:
            url = f"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lng}&current_weather=true&hourly=precipitation"
            resp = requests.get(url, timeout=3)
            if resp.status_code == 200:
                data = resp.json()
                curr = data.get("current_weather", {})
                return {
                    "temperature": curr.get("temperature", 24.5),
                    "windspeed": curr.get("windspeed", 12.0),
                    "weathercode": curr.get("weathercode", 0),
                    "mode": "REAL_OPEN_METEO_API"
                }
        except Exception:
            pass
        return {
            "temperature": 24.5,
            "windspeed": 12.0,
            "weathercode": 61,
            "mode": "DEMO_FALLBACK_WEATHER"
        }

    @staticmethod
    def calculate_road_risk(rainfall: float, terrain_risk: float, recent_reports: int, days_since: float) -> float:
        rain_score = min((rainfall / 100.0) * 100.0, 100.0)
        report_score = min(recent_reports * 25.0, 100.0)
        recency_penalty = max(0.0, 30.0 - (days_since * 5.0))
        
        raw_risk = (0.35 * rain_score) + (0.25 * terrain_risk) + (0.20 * report_score) + (0.20 * recency_penalty)
        return round(min(max(raw_risk, 5.0), 100.0), 1)

class RoutingService:
    @staticmethod
    def calculate_cost_function(road, vehicle_type: str = "TRUCK", priority: str = "NORMAL", avoid_high_risk: bool = True) -> float:
        risk = road.risk_score
        
        # Vehicle Type Multiplier
        veh_mult = 1.0
        if vehicle_type == "AMBULANCE":
            veh_mult = 0.65 # Priority speed
        elif vehicle_type == "TRUCK" and road.bridge_load_limit < 25.0:
            veh_mult = 4.0 # High penalty for heavy trucks on weak bridges
        elif vehicle_type == "4X4":
            veh_mult = 0.85 # Can traverse rough mountain passes

        # Priority Weights
        if priority == "EMERGENCY":
            distance_w, time_w, risk_w = 0.15, 0.25, 0.60
        elif priority == "ESSENTIAL_SUPPLY":
            distance_w, time_w, risk_w = 0.20, 0.30, 0.50
        else:
            distance_w, time_w, risk_w = 0.30, 0.25, 0.45

        risk_penalty = (risk / 100.0) * 150.0 if avoid_high_risk and risk > 70.0 else (risk / 100.0) * 50.0
        blocked_penalty = 10000.0 if road.current_status == "BLOCKED" else 0.0

        effective_cost = (distance_w * road.distance_km) + (time_w * road.base_travel_time * 60.0) + (risk_w * risk_penalty) + blocked_penalty
        return round(effective_cost * veh_mult, 2)

class DijkstraRouterService:

    @staticmethod
    def find_safest_route(nodes_dict: dict, roads_list: list, origin_id: str, dest_id: str, cargo_priority: str = "NORMAL", vehicle_type: str = "TRUCK", blocked_ids: list = [], avoid_high_risk: bool = True):
        graph = {}
        for nid in nodes_dict:
            graph[nid] = []

        for r in roads_list:
            if r.id in blocked_ids or r.current_status == "BLOCKED":
                continue

            cost = RoutingService.calculate_cost_function(r, vehicle_type=vehicle_type, priority=cargo_priority, avoid_high_risk=avoid_high_risk)
            
            # Map road ends to known hub node IDs
            name_lower = r.name.lower()
            u_key = next((k for k in nodes_dict if k in name_lower), "guwahati")
            v_key = next((k for k in nodes_dict if k in name_lower and k != u_key), "shillong")

            if u_key not in graph: graph[u_key] = []
            if v_key not in graph: graph[v_key] = []

            graph[u_key].append((v_key, cost, r))
            graph[v_key].append((u_key, cost, r))

        distances = {node: float('inf') for node in graph}
        distances[origin_id] = 0
        pq = [(0, origin_id, [], [])]

        best_path_nodes = []
        best_path_roads = []

        while pq:
            cost, current, path, r_path = heapq.heappop(pq)
            if cost > distances[current]:
                continue
            
            new_path = path + [current]
            if current == dest_id:
                best_path_nodes = new_path
                best_path_roads = r_path
                break

            for neighbor, weight, road_obj in graph.get(current, []):
                if neighbor in path:
                    continue
                if cost + weight < distances[neighbor]:
                    distances[neighbor] = cost + weight
                    heapq.heappush(pq, (cost + weight, neighbor, new_path, r_path + [road_obj]))

        if not best_path_roads:
            # Fallback if no direct route avoids blockage: find shortest path without blocking
            return None

        total_dist = sum(r.distance_km for r in best_path_roads)
        total_eta = sum(r.base_travel_time * (1.0 + (r.risk_score / 100.0)) for r in best_path_roads)
        avg_risk = sum(r.risk_score for r in best_path_roads) / max(len(best_path_roads), 1)

        segments = []
        for seq, r in enumerate(best_path_roads):
            segments.append({
                "sequence": seq + 1,
                "road_id": r.id,
                "name": r.name,
                "distance_km": r.distance_km,
                "risk_score": r.risk_score,
                "status": r.current_status
            })

        # GeoJSON LineString coordinates
        route_coords = []
        for r in best_path_roads:
            coords = json.loads(r.coords_json)
            for pt in coords:
                route_coords.append([pt[1], pt[0]]) # [lng, lat]

        return {
            "origin": origin_id,
            "destination": dest_id,
            "totalDistance": round(total_dist, 1),
            "totalEta": round(total_eta, 1),
            "duration_minutes": round(total_eta * 60, 0),
            "avgRisk": round(avg_risk, 1),
            "risk_level": "LOW" if avg_risk <= 30 else ("MODERATE" if avg_risk <= 70 else "HIGH_RISK"),
            "geometry": {
                "type": "LineString",
                "coordinates": route_coords
            },
            "segments": segments,
            "roads": [{"id": r.id, "name": r.name, "distance_km": r.distance_km, "risk_score": r.risk_score, "coords": json.loads(r.coords_json)} for r in best_path_roads]
        }

import math
import datetime
import threading
import time
import asyncio
from app.models.models import Vehicle, VehicleLocation, VehicleRoute, Delivery

def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c

class GeofenceService:
    @staticmethod
    def check_destination_geofence(current_lat: float, current_lng: float, dest_lat: float, dest_lng: float, radius_km: float = 0.5) -> bool:
        dist = haversine_km(current_lat, current_lng, dest_lat, dest_lng)
        return dist <= radius_km

class ETAService:
    @staticmethod
    def calculate_remaining_distance(current_lat: float, current_lng: float, route_coords: list) -> float:
        if not route_coords:
            return 0.0
        
        # Find index of closest route point
        closest_idx = 0
        min_dist = float('inf')
        for idx, pt in enumerate(route_coords):
            # pt is [lng, lat] or [lat, lng]
            lat = pt[1] if pt[1] < 50 else pt[0]
            lng = pt[0] if pt[1] < 50 else pt[1]
            d = haversine_km(current_lat, current_lng, lat, lng)
            if d < min_dist:
                min_dist = d
                closest_idx = idx

        # Sum remaining segment distances
        rem_dist = min_dist
        for i in range(closest_idx, len(route_coords) - 1):
            pt1 = route_coords[i]
            pt2 = route_coords[i+1]
            lat1, lng1 = (pt1[1], pt1[0]) if pt1[1] < 50 else (pt1[0], pt1[1])
            lat2, lng2 = (pt2[1], pt2[0]) if pt2[1] < 50 else (pt2[0], pt2[1])
            rem_dist += haversine_km(lat1, lng1, lat2, lng2)

        return round(rem_dist, 1)

    @staticmethod
    def format_eta_string(distance_km: float, speed_kmh: float = 40.0) -> str:
        if speed_kmh <= 0:
            speed_kmh = 35.0
        hours = distance_km / speed_kmh
        eta_time = datetime.datetime.utcnow() + datetime.timedelta(hours=hours) + datetime.timedelta(hours=5, minutes=30) # IST
        return eta_time.strftime("%I:%M %p")

class VehicleRiskService:
    @staticmethod
    def check_road_risk_and_blockage(db, current_road_id: str, route_road_ids: list = []):
        if not current_road_id:
            return {"status": "SAFE", "risk_score": 15.0, "blocked": False}
        
        road = db.query(Road).filter(Road.id == current_road_id).first()
        if not road:
            return {"status": "SAFE", "risk_score": 15.0, "blocked": False}

        is_blocked = road.current_status == "BLOCKED" or road.risk_score >= 70.0
        return {
            "road_id": road.id,
            "name": road.name,
            "status": road.current_status,
            "risk_score": road.risk_score,
            "blocked": is_blocked
        }

class VehicleTrackingService:
    @staticmethod
    def find_nearest_road(db, lat: float, lng: float) -> str:
        roads = db.query(Road).all()
        nearest_road_id = None
        min_dist = float('inf')
        for r in roads:
            coords = json.loads(r.coords_json)
            for pt in coords:
                d = haversine_km(lat, lng, pt[0], pt[1])
                if d < min_dist:
                    min_dist = d
                    nearest_road_id = r.id
        return nearest_road_id if min_dist <= 25.0 else None

    @staticmethod
    def update_location(db, vehicle_id: str, lat: float, lng: float, speed: float = 40.0, heading: float = 0.0, accuracy: float = 10.0, timestamp_str: str = None):
        # 1. Validation
        if not (-90 <= lat <= 90 and -180 <= lng <= 180):
            raise ValueError("Invalid coordinates")
        if speed < 0 or not (0 <= heading <= 360):
            raise ValueError("Invalid telemetry data")

        veh = db.query(Vehicle).filter(Vehicle.id == vehicle_id).first()
        if not veh:
            raise ValueError("Vehicle not found")

        # 2. Save Vehicle Location History
        wkt_point = f"POINT({lng} {lat})"
        loc_db = VehicleLocation(
            vehicle_id=vehicle_id,
            latitude=lat,
            longitude=lng,
            geometry_wkt=wkt_point,
            speed=speed,
            heading=heading,
            accuracy=accuracy,
            timestamp=datetime.datetime.utcnow()
        )
        db.add(loc_db)

        # 3. Detect Nearest Road
        nearest_road = VehicleTrackingService.find_nearest_road(db, lat, lng)
        if nearest_road:
            veh.current_road_id = nearest_road

        # 4. Update Vehicle Telemetry
        veh.current_latitude = lat
        veh.current_longitude = lng
        veh.current_speed = speed
        veh.current_heading = heading
        veh.last_gps_update = datetime.datetime.utcnow()

        # 5. Route Distance & ETA Calculation
        route_rec = db.query(VehicleRoute).filter(VehicleRoute.vehicle_id == vehicle_id, VehicleRoute.status == "ACTIVE").first()
        if route_rec and route_rec.route_geometry:
            coords = json.loads(route_rec.route_geometry)
            rem_dist = ETAService.calculate_remaining_distance(lat, lng, coords)
            veh.distance_remaining = rem_dist
            veh.eta = ETAService.format_eta_string(rem_dist, speed)
            
            # Destination Geofence check
            if coords:
                dest_pt = coords[-1]
                dest_lat, dest_lng = (dest_pt[1], dest_pt[0]) if dest_pt[1] < 50 else (dest_pt[0], dest_pt[1])
                if GeofenceService.check_destination_geofence(lat, lng, dest_lat, dest_lng, radius_km=0.6):
                    veh.status = "DELIVERED"
                    deliv = db.query(Delivery).filter(Delivery.vehicle_id == vehicle_id).first()
                    if deliv:
                        deliv.status = "DELIVERED"
                        deliv.actual_delivery_time = datetime.datetime.utcnow()

        # 6. Road Risk Check
        if veh.current_road_id:
            road_info = VehicleRiskService.check_road_risk_and_blockage(db, veh.current_road_id)
            if road_info.get("blocked") and veh.status != "DELIVERED":
                veh.status = "AT_RISK"

        db.commit()
        db.refresh(veh)

        return veh

class VehicleSimulationService:
    _active_threads = {}
    _simulation_states = {}

    @classmethod
    def start_simulation(cls, db_session_factory, vehicle_id: str, broadcast_callback=None):
        if cls._simulation_states.get(vehicle_id) == "RUNNING":
            return {"status": "ALREADY_RUNNING", "vehicle_id": vehicle_id}

        cls._simulation_states[vehicle_id] = "RUNNING"

        def sim_loop():
            db = db_session_factory()
            try:
                veh = db.query(Vehicle).filter(Vehicle.id == vehicle_id).first()
                if not veh:
                    cls._simulation_states[vehicle_id] = "STOPPED"
                    return

                # Get route geometry
                route_rec = db.query(VehicleRoute).filter(VehicleRoute.vehicle_id == vehicle_id, VehicleRoute.status == "ACTIVE").first()
                if not route_rec or not route_rec.route_geometry:
                    # Fallback interpolator points between Guwahati & Shillong/Destination
                    coords = [[91.7362, 26.1445], [91.7600, 26.0500], [91.8000, 25.9000], [91.8500, 25.7500], [91.8933, 25.5788]]
                else:
                    coords = json.loads(route_rec.route_geometry)

                step = 0
                num_points = len(coords)
                while cls._simulation_states.get(vehicle_id) == "RUNNING" and step < num_points:
                    pt = coords[step]
                    lng, lat = (pt[0], pt[1]) if pt[0] > 50 else (pt[1], pt[0])
                    
                    # Calculate heading to next point
                    heading = 85.0
                    if step < num_points - 1:
                        next_pt = coords[step + 1]
                        nlng, nlat = (next_pt[0], next_pt[1]) if next_pt[0] > 50 else (next_pt[1], next_pt[0])
                        angle = math.degrees(math.atan2(nlat - lat, nlng - lng))
                        heading = round((90.0 - angle) % 360.0, 1)

                    speed = round(38.0 + (step % 5) * 3.5, 1)
                    
                    # Update Location via service
                    updated_veh = VehicleTrackingService.update_location(
                        db=db,
                        vehicle_id=vehicle_id,
                        lat=lat,
                        lng=lng,
                        speed=speed,
                        heading=heading,
                        accuracy=8.0
                    )

                    # Trigger broadcast if callback provided
                    if broadcast_callback:
                        payload = {
                            "event": "VEHICLE_LOCATION_UPDATED",
                            "vehicle_id": vehicle_id,
                            "latitude": lat,
                            "longitude": lng,
                            "speed": speed,
                            "heading": heading,
                            "current_road_id": updated_veh.current_road_id,
                            "status": updated_veh.status,
                            "eta": updated_veh.eta,
                            "distance_remaining": updated_veh.distance_remaining,
                            "timestamp": datetime.datetime.utcnow().isoformat()
                        }
                        try:
                            if asyncio.iscoroutinefunction(broadcast_callback):
                                asyncio.run(broadcast_callback("VEHICLE_LOCATION_UPDATED", payload))
                            else:
                                broadcast_callback("VEHICLE_LOCATION_UPDATED", payload)
                        except Exception:
                            pass

                    if updated_veh.status == "DELIVERED":
                        cls._simulation_states[vehicle_id] = "COMPLETED"
                        break

                    step += 1
                    time.sleep(4.0)

            except Exception as e:
                print(f"[GPS SIMULATOR ERROR] {vehicle_id}: {e}")
            finally:
                db.close()
                if cls._simulation_states.get(vehicle_id) == "RUNNING":
                    cls._simulation_states[vehicle_id] = "STOPPED"

        t = threading.Thread(target=sim_loop, daemon=True)
        cls._active_threads[vehicle_id] = t
        t.start()

        return {"status": "STARTED", "vehicle_id": vehicle_id}

    @classmethod
    def pause_simulation(cls, vehicle_id: str):
        cls._simulation_states[vehicle_id] = "PAUSED"
        return {"status": "PAUSED", "vehicle_id": vehicle_id}

    @classmethod
    def stop_simulation(cls, vehicle_id: str):
        cls._simulation_states[vehicle_id] = "STOPPED"
        return {"status": "STOPPED", "vehicle_id": vehicle_id}

    @classmethod
    def get_simulation_status(cls, vehicle_id: str):
        return {
            "vehicle_id": vehicle_id,
            "status": cls._simulation_states.get(vehicle_id, "STOPPED")
        }

