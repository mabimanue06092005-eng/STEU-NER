from fastapi import APIRouter

from app.routers import ws, auth, gis, risk, routes, vehicles, incidents, alerts, relief, weather, dashboard, config

router = APIRouter()
router.include_router(ws.router)
router.include_router(auth.router)
router.include_router(gis.router)
router.include_router(risk.router)
router.include_router(routes.router)
router.include_router(vehicles.router)
router.include_router(incidents.router)
router.include_router(alerts.router)
router.include_router(relief.router)
router.include_router(weather.router)
router.include_router(dashboard.router)
router.include_router(config.router)
