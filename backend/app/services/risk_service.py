import numpy as np
from sklearn.ensemble import RandomForestClassifier

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

    # ----------------- CANONICAL ROAD RISK FORMULA -----------------
    # Single authoritative risk calculation used by every endpoint that needs
    # a road's risk score, its category, or an explainable breakdown
    # (previously this logic was duplicated with different weights in
    # /api/risk/roads/{id} and /api/risk/calculate).
    #
    # Risk = 35% rainfall + 25% landslide susceptibility + 15% flood susceptibility
    #      + 15% current incident/status + 10% road condition (bridge load limit)
    LANDSLIDE_PRONE_ROAD_IDS = ("NH06", "NH13", "NH29")
    FLOOD_PRONE_ROAD_IDS = ("NH27", "NH37", "NH15")

    @classmethod
    def calculate_road_risk_breakdown(cls, road) -> dict:
        rainfall_score = min((road.rainfall_mm_last_6h / 100.0) * 100.0, 100.0)
        landslide_score = 85.0 if any(code in road.id for code in cls.LANDSLIDE_PRONE_ROAD_IDS) else 30.0
        flood_score = 70.0 if any(code in road.id for code in cls.FLOOD_PRONE_ROAD_IDS) else 20.0
        incident_score = 90.0 if road.current_status == "BLOCKED" else (50.0 if road.current_status == "RISKY" else 10.0)
        road_condition_score = 40.0 if road.bridge_load_limit < 30.0 else 80.0

        raw_risk = (0.35 * rainfall_score) + (0.25 * landslide_score) + (0.15 * flood_score) + (0.15 * incident_score) + (0.10 * (100 - road_condition_score))
        final_score = round(min(max(raw_risk, 5.0), 100.0), 1)

        return {
            "final_score": final_score,
            "breakdown": {
                "rainfall_risk": {"weight": "35%", "score": round(rainfall_score, 1), "value": f"{road.rainfall_mm_last_6h} mm/6h"},
                "landslide_risk": {"weight": "25%", "score": round(landslide_score, 1), "value": "Terrain Susceptibility"},
                "flood_risk": {"weight": "15%", "score": round(flood_score, 1), "value": "River Basin Inundation"},
                "incident_risk": {"weight": "15%", "score": round(incident_score, 1), "value": f"Status: {road.current_status}"},
                "road_condition": {"weight": "10%", "score": round(road_condition_score, 1), "value": f"Bridge Limit: {road.bridge_load_limit}T"}
            }
        }

    @staticmethod
    def get_risk_status(score: float) -> str:
        if score >= 71.0:
            return "BLOCKED"
        elif score >= 31.0:
            return "RISKY"
        return "SAFE"
