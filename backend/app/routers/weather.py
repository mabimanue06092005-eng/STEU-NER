from fastapi import APIRouter

from app.services.weather_service import WeatherService

router = APIRouter()

# ----------------- WEATHER ROUTER (OPEN-METEO INTEGRATION) -----------------
@router.get("/api/weather/current")
def get_current_weather(lat: float = 26.1445, lng: float = 91.7362):
    return WeatherService.fetch_open_meteo_weather(lat, lng)

@router.get("/api/weather/forecast")
def get_weather_forecast(lat: float = 26.1445, lng: float = 91.7362):
    curr = WeatherService.fetch_open_meteo_weather(lat, lng)
    return {
        "location": {"lat": lat, "lng": lng},
        "current": curr,
        "forecast_6h_mm": 85.0 if lat < 26.0 else 25.0,
        "forecast_12h_mm": 110.0 if lat < 26.0 else 40.0,
        "alert_level": "WARNING" if lat < 26.0 else "NORMAL"
    }
