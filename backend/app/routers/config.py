import os
from fastapi import APIRouter

router = APIRouter()

# ----------------- FRONTEND RUNTIME CONFIG -----------------
# The frontend is a plain static site with no build/bundler step, so it cannot read a
# .env file directly. It fetches this endpoint once at startup to learn whether Google
# Maps is configured and, if so, load the Maps JS API with the key — the key itself
# lives only in backend/.env (gitignored) and is never written into any frontend file.
@router.get("/api/config")
def get_frontend_config():
    key = os.getenv("GOOGLE_MAPS_API_KEY", "").strip()
    return {
        "google_maps_enabled": bool(key),
        "google_maps_api_key": key
    }
