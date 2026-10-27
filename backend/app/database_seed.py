import json
import hashlib
import datetime
from sqlalchemy.orm import Session
from app.models.models import District, Road, Bridge, WeatherData, Vehicle, VehicleLocation, VehicleRoute, Delivery, ReliefCamp, VulnerablePerson, User, Alert

def seed_database(db: Session):
    if db.query(District).first():
        return # Already seeded

    # Seed Admin User
    admin = User(
        name="MDoNER Admin",
        email="admin@setuner.gov.in",
        password_hash=hashlib.sha256("admin123".encode()).hexdigest(),
        role="admin",
        language="EN"
    )
    db.add(admin)

    # Seed Districts
    districts = [
        District(name="Kamrup Metropolitan (Guwahati)", state="Assam"),
        District(name="East Khasi Hills (Shillong)", state="Meghalaya"),
        District(name="West Jaintia Hills", state="Meghalaya"),
        District(name="Cachar (Silchar)", state="Assam"),
        District(name="West Tripura (Agartala)", state="Tripura"),
        District(name="Kohima", state="Nagaland"),
        District(name="Imphal West", state="Manipur"),
        District(name="Aizawl", state="Mizoram"),
        District(name="Papum Pare (Itanagar)", state="Arunachal Pradesh"),
        District(name="East Sikkim (Gangtok)", state="Sikkim"),
    ]
    db.add_all(districts)
    db.commit()

    # Seed Complete Grid of All Major NER National Highways (NH27, NH40, NH06, NH08, NH29, NH37, NH102, NH54, NH13, NH10, NH415, NH15)
    roads = [
        Road(
            id="NH27",
            name="NH27 (Guwahati - Tezpur - Nagaon East-West Highway)",
            road_type="National Highway",
            coords_json=json.dumps([[26.1445, 91.7362], [26.2000, 92.2000], [26.6528, 92.7926]]),
            current_status="SAFE",
            risk_score=15.0,
            distance_km=180.0,
            base_travel_time=3.5,
            rainfall_mm_last_6h=12.0,
            bridge_load_limit=50.0
        ),
        Road(
            id="NH40",
            name="NH40 (Guwahati - Shillong Expressway Corridor)",
            road_type="National Highway",
            coords_json=json.dumps([[26.1445, 91.7362], [25.9000, 91.8000], [25.5788, 91.8933]]),
            current_status="RISKY",
            risk_score=28.0,
            distance_km=98.0,
            base_travel_time=2.5,
            rainfall_mm_last_6h=45.0,
            bridge_load_limit=40.0
        ),
        Road(
            id="NH06",
            name="NH06 (Shillong - Jaintia Hills - Silchar Lifeline)",
            road_type="National Highway",
            coords_json=json.dumps([[25.5788, 91.8933], [25.4500, 92.2000], [24.8333, 92.7789]]),
            current_status="BLOCKED",
            risk_score=88.5,
            distance_km=210.0,
            base_travel_time=6.0,
            rainfall_mm_last_6h=92.0,
            bridge_load_limit=25.0
        ),
        Road(
            id="NH08",
            name="NH08 (Silchar - Karimganj - Agartala Tripura Trade Route)",
            road_type="National Highway",
            coords_json=json.dumps([[24.8333, 92.7789], [24.2500, 92.0000], [23.8315, 91.2868]]),
            current_status="SAFE",
            risk_score=28.0,
            distance_km=245.0,
            base_travel_time=6.5,
            rainfall_mm_last_6h=18.0,
            bridge_load_limit=45.0
        ),
        Road(
            id="NH29",
            name="NH29 (Dimapur - Kohima Mountain Pass)",
            road_type="National Highway",
            coords_json=json.dumps([[25.9060, 93.7271], [25.8000, 93.9000], [25.6751, 94.1086]]),
            current_status="RISKY",
            risk_score=58.0,
            distance_km=74.0,
            base_travel_time=2.8,
            rainfall_mm_last_6h=65.0,
            bridge_load_limit=35.0
        ),
        Road(
            id="NH37",
            name="NH37 (Guwahati - Goalpara Brahmaputra Valley Trunk)",
            road_type="National Highway",
            coords_json=json.dumps([[26.1445, 91.7362], [26.1744, 90.6276]]),
            current_status="SAFE",
            risk_score=12.0,
            distance_km=130.0,
            base_travel_time=2.8,
            rainfall_mm_last_6h=8.0,
            bridge_load_limit=50.0
        ),
        Road(
            id="NH102",
            name="NH102 (Kohima - Senapati - Imphal Asian Highway Link)",
            road_type="National Highway",
            coords_json=json.dumps([[25.6751, 94.1086], [25.2500, 94.0000], [24.8170, 93.9368]]),
            current_status="RISKY",
            risk_score=48.0,
            distance_km=138.0,
            base_travel_time=4.5,
            rainfall_mm_last_6h=55.0,
            bridge_load_limit=30.0
        ),
        Road(
            id="NH54",
            name="NH54 (Silchar - Kolasib - Aizawl Mizoram Corridor)",
            road_type="National Highway",
            coords_json=json.dumps([[24.8333, 92.7789], [24.2000, 92.7500], [23.7271, 92.7176]]),
            current_status="RISKY",
            risk_score=62.0,
            distance_km=170.0,
            base_travel_time=5.5,
            rainfall_mm_last_6h=70.0,
            bridge_load_limit=22.0
        ),
        Road(
            id="NH13",
            name="NH13 (Itanagar - Bomdila - Tawang Trans-Arunachal Highway)",
            road_type="National Highway",
            coords_json=json.dumps([[27.0844, 93.6053], [27.3500, 92.7000], [27.5861, 91.8594]]),
            current_status="BLOCKED",
            risk_score=92.0,
            distance_km=440.0,
            base_travel_time=14.0,
            rainfall_mm_last_6h=110.0,
            bridge_load_limit=15.0
        ),
        Road(
            id="NH10",
            name="NH10 (Guwahati - Siliguri - Gangtok Sikkim Lifeline)",
            road_type="National Highway",
            coords_json=json.dumps([[26.1445, 91.7362], [26.7000, 89.5000], [27.3389, 88.6065]]),
            current_status="RISKY",
            risk_score=44.0,
            distance_km=530.0,
            base_travel_time=12.0,
            rainfall_mm_last_6h=40.0,
            bridge_load_limit=35.0
        ),
        Road(
            id="NH415",
            name="NH415 (Tezpur - Banderdewa - Itanagar Highway)",
            road_type="National Highway",
            coords_json=json.dumps([[26.6528, 92.7926], [26.9000, 93.2000], [27.0844, 93.6053]]),
            current_status="RISKY",
            risk_score=46.0,
            distance_km=155.0,
            base_travel_time=4.2,
            rainfall_mm_last_6h=60.0,
            bridge_load_limit=35.0
        ),
        Road(
            id="NH15",
            name="NH15 (Guwahati - Mangaldoi - Tezpur North Bank Arterial)",
            road_type="National Highway",
            coords_json=json.dumps([[26.1445, 91.7362], [26.4300, 92.0300], [26.6528, 92.7926]]),
            current_status="SAFE",
            risk_score=18.0,
            distance_km=175.0,
            base_travel_time=3.6,
            rainfall_mm_last_6h=14.0,
            bridge_load_limit=45.0
        )
    ]
    db.add_all(roads)

    # Seed Relief Camps
    camps = [
        ReliefCamp(name="Guwahati Stadium Camp 1", latitude=26.1445, longitude=91.7362, capacity=1000, current_occupancy=250),
        ReliefCamp(name="Silchar Central College Shelter", latitude=24.8333, longitude=92.7789, capacity=800, current_occupancy=640),
        ReliefCamp(name="Shillong Community Relief Hub", latitude=25.5788, longitude=91.8933, capacity=500, current_occupancy=120)
    ]
    db.add_all(camps)

    # Seed Realistic GPS Vehicles
    vehicles = [
        Vehicle(
            id="MED-102",
            vehicle_number="AS-01-AB-1234",
            vehicle_type="Medical Truck",
            driver_name="Raj Kumar",
            driver_phone="+91 9876543210",
            cargo_type="Emergency Medicines",
            cargo_description="Critical Antibiotics, Insulin & Vaccine Storage",
            origin="Guwahati",
            destination="Shillong",
            priority="HIGH",
            status="IN_TRANSIT",
            current_latitude=26.1445,
            current_longitude=91.7362,
            current_speed=42.5,
            current_heading=85.0,
            current_road_id="NH40",
            current_route_id="ROUTE-MED-102",
            eta="3:42 PM",
            distance_remaining=84.0,
            last_gps_update=datetime.datetime.utcnow()
        ),
        Vehicle(
            id="FOOD-221",
            vehicle_number="TR-01-B-8820",
            vehicle_type="Ration Truck 10T",
            driver_name="Animesh Das",
            driver_phone="+91 9876543211",
            cargo_type="Food Supplies",
            cargo_description="Grain, Rice & Clean Drinking Water Containers",
            origin="Guwahati",
            destination="Tura",
            priority="HIGH",
            status="DELAYED",
            current_latitude=25.9000,
            current_longitude=90.6000,
            current_speed=30.0,
            current_heading=210.0,
            current_road_id="NH37",
            current_route_id="ROUTE-FOOD-221",
            eta="4:10 PM",
            distance_remaining=112.0,
            last_gps_update=datetime.datetime.utcnow()
        ),
        Vehicle(
            id="CON-301",
            vehicle_number="AS-02-C-5091",
            vehicle_type="Heavy Carrier",
            driver_name="Bikram Singh",
            driver_phone="+91 9876543212",
            cargo_type="Construction Materials",
            cargo_description="Bailey Bridge Structural Steel & Cement",
            origin="Guwahati",
            destination="Itanagar",
            priority="NORMAL",
            status="IN_TRANSIT",
            current_latitude=26.6528,
            current_longitude=92.7926,
            current_speed=48.0,
            current_heading=45.0,
            current_road_id="NH27",
            current_route_id="ROUTE-CON-301",
            eta="5:30 PM",
            distance_remaining=155.0,
            last_gps_update=datetime.datetime.utcnow()
        ),
        Vehicle(
            id="RELIEF-009",
            vehicle_number="MN-01-E-9004",
            vehicle_type="Ambulance 4x4",
            driver_name="Tomba Meitei",
            driver_phone="+91 9876543213",
            cargo_type="Emergency Relief",
            cargo_description="Trauma Kits, Portable Oxygen & Resuscitation Equipment",
            origin="Imphal",
            destination="Ukhrul",
            priority="EMERGENCY",
            status="AT_RISK",
            current_latitude=24.8170,
            current_longitude=93.9368,
            current_speed=35.0,
            current_heading=30.0,
            current_road_id="NH102",
            current_route_id="ROUTE-RELIEF-009",
            eta="2:55 PM",
            distance_remaining=42.0,
            last_gps_update=datetime.datetime.utcnow()
        )
    ]
    db.add_all(vehicles)

    # Seed Deliveries
    deliveries = [
        Delivery(
            id=101,
            vehicle_id="MED-102",
            cargo_type="Emergency Medicines",
            origin="Guwahati",
            destination="Shillong",
            priority="HIGH",
            status="IN_TRANSIT",
            expected_delivery_time=datetime.datetime.utcnow() + datetime.timedelta(hours=2)
        ),
        Delivery(
            id=102,
            vehicle_id="FOOD-221",
            cargo_type="Food Supplies",
            origin="Guwahati",
            destination="Tura",
            priority="HIGH",
            status="DELAYED",
            expected_delivery_time=datetime.datetime.utcnow() + datetime.timedelta(hours=4)
        ),
        Delivery(
            id=103,
            vehicle_id="CON-301",
            cargo_type="Construction Materials",
            origin="Guwahati",
            destination="Itanagar",
            priority="NORMAL",
            status="IN_TRANSIT",
            expected_delivery_time=datetime.datetime.utcnow() + datetime.timedelta(hours=6)
        ),
        Delivery(
            id=104,
            vehicle_id="RELIEF-009",
            cargo_type="Emergency Relief",
            origin="Imphal",
            destination="Ukhrul",
            priority="EMERGENCY",
            status="IN_TRANSIT",
            expected_delivery_time=datetime.datetime.utcnow() + datetime.timedelta(hours=1.5)
        )
    ]
    db.add_all(deliveries)

    # Seed Vehicle Routes
    vehicle_routes = [
        VehicleRoute(
            id="VR-MED-102",
            vehicle_id="MED-102",
            route_id="ROUTE-MED-102",
            route_geometry=json.dumps([[91.7362, 26.1445], [91.8000, 25.9000], [91.8933, 25.5788]]),
            status="ACTIVE",
            eta="3:42 PM",
            risk_score=28.0
        ),
        VehicleRoute(
            id="VR-FOOD-221",
            vehicle_id="FOOD-221",
            route_id="ROUTE-FOOD-221",
            route_geometry=json.dumps([[91.7362, 26.1445], [90.6276, 26.1744], [90.2000, 25.5100]]),
            status="ACTIVE",
            eta="4:10 PM",
            risk_score=35.0
        ),
        VehicleRoute(
            id="VR-CON-301",
            vehicle_id="CON-301",
            route_id="ROUTE-CON-301",
            route_geometry=json.dumps([[91.7362, 26.1445], [92.7926, 26.6528], [93.6053, 27.0844]]),
            status="ACTIVE",
            eta="5:30 PM",
            risk_score=22.0
        ),
        VehicleRoute(
            id="VR-RELIEF-009",
            vehicle_id="RELIEF-009",
            route_id="ROUTE-RELIEF-009",
            route_geometry=json.dumps([[93.9368, 24.8170], [94.1086, 25.6751]]),
            status="ACTIVE",
            eta="2:55 PM",
            risk_score=68.0
        )
    ]
    db.add_all(vehicle_routes)

    # Seed Alerts
    alerts = [
        Alert(title="NH06 Landslide Closure", message="Landslide triggered at KM45 Jaintia Hills. Route severed. Detour via NH08 active.", severity="HIGH", target_area="Barak Valley"),
        Alert(title="Heavy Monsoon Warning", message="6-12h rainfall forecast exceeds 80mm in East Khasi Hills.", severity="WARNING", target_area="Meghalaya")
    ]
    db.add_all(alerts)

    db.commit()
    print("[SUCCESS] Database successfully seeded with NER GIS logistics data!")
