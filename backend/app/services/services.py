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
