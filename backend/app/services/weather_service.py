import requests

class WeatherService:
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
