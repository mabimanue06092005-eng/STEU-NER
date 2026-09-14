import json
import heapq

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
