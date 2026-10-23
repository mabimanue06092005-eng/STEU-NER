import math

# Spatial Distance Calculation (Haversine Formula in KM)
def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371.0 # Earth radius in kilometers
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c

def polygon_centroid_lnglat(ring):
    """Simple average-of-vertices centroid for a GeoJSON polygon ring ([[lng,lat], ...]).
    Good enough for the small, roughly-convex hazard zone polygons used in this project —
    not a true area-weighted centroid, which these zones don't need."""
    lng_sum = sum(pt[0] for pt in ring)
    lat_sum = sum(pt[1] for pt in ring)
    n = len(ring)
    return [lng_sum / n, lat_sum / n]
