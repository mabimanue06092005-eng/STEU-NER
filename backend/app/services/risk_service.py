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

    @staticmethod
    def calculate_road_risk(rainfall: float, terrain_risk: float, recent_reports: int, days_since: float) -> float:
        rain_score = min((rainfall / 100.0) * 100.0, 100.0)
        report_score = min(recent_reports * 25.0, 100.0)
        recency_penalty = max(0.0, 30.0 - (days_since * 5.0))

        raw_risk = (0.35 * rain_score) + (0.25 * terrain_risk) + (0.20 * report_score) + (0.20 * recency_penalty)
        return round(min(max(raw_risk, 5.0), 100.0), 1)
