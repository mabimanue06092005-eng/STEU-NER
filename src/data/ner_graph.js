/**
 * Jeevan Setu / SETU-NER - North Eastern Region GIS Data & Callouts Dataset
 */

const NER_NODES = {
  "guwahati": { id: "guwahati", name: "Guwahati Hub (Assam)", lat: 26.1445, lng: 91.7362, state: "Assam", population: 1100000, vulnerableCount: 420 },
  "shillong": { id: "shillong", name: "Shillong (Meghalaya)", lat: 25.5788, lng: 91.8933, state: "Meghalaya", population: 350000, vulnerableCount: 180 },
  "silchar": { id: "silchar", name: "Silchar (Barak Valley, Assam)", lat: 24.8333, lng: 92.7789, state: "Assam", population: 230000, vulnerableCount: 310 },
  "agartala": { id: "agartala", name: "Agartala (Tripura)", lat: 23.8315, lng: 91.2868, state: "Tripura", population: 400000, vulnerableCount: 250 },
  "tezpur": { id: "tezpur", name: "Tezpur (Assam)", lat: 26.6528, lng: 92.7926, state: "Assam", population: 105000, vulnerableCount: 95 },
  "itanagar": { id: "itanagar", name: "Itanagar (Arunachal Pradesh)", lat: 27.0844, lng: 93.6053, state: "Arunachal Pradesh", population: 60000, vulnerableCount: 85 },
  "dimapur": { id: "dimapur", name: "Dimapur (Nagaland)", lat: 25.9060, lng: 93.7271, state: "Nagaland", population: 120000, vulnerableCount: 140 },
  "kohima": { id: "kohima", name: "Kohima (Nagaland)", lat: 25.6751, lng: 94.1086, state: "Nagaland", population: 100000, vulnerableCount: 110 },
  "imphal": { id: "imphal", name: "Imphal (Manipur)", lat: 24.8170, lng: 93.9368, state: "Manipur", population: 270000, vulnerableCount: 290 },
  "aizawl": { id: "aizawl", name: "Aizawl (Mizoram)", lat: 23.7271, lng: 92.7176, state: "Mizoram", population: 290000, vulnerableCount: 210 },
  "tawang": { id: "tawang", name: "Tawang (High Risk Altitude)", lat: 27.5861, lng: 91.8594, state: "Arunachal Pradesh", population: 12000, vulnerableCount: 65 },
  "gangtok": { id: "gangtok", name: "Gangtok (Sikkim)", lat: 27.3389, lng: 88.6065, state: "Sikkim", population: 100000, vulnerableCount: 90 }
};

const HAZARD_CALLOUTS = [
  { id: "CALL-01", label: "NEPAL GLACIAL & FLOOD INFLUX", lat: 27.2000, lng: 87.8000, category: "high_risk", bg: "bg-red-950/90", border: "border-red-600", text: "text-red-300" },
  { id: "CALL-02", label: "Chungthang Dam", lat: 27.6000, lng: 88.6500, category: "high_risk", bg: "bg-red-950/90", border: "border-red-600", text: "text-red-300" },
  { id: "CALL-03", label: "NH-13 Sela Pass", lat: 27.5000, lng: 92.1000, category: "high_risk", bg: "bg-red-950/90", border: "border-red-600", text: "text-red-300" },
  { id: "CALL-04", label: "Melli Landslide Washout", lat: 27.0900, lng: 88.4200, category: "moderate", bg: "bg-amber-950/90", border: "border-amber-600", text: "text-amber-300" },
  { id: "CALL-05", label: "Majuli Island Floodplain", lat: 26.9500, lng: 94.1700, category: "high_risk", bg: "bg-purple-950/90", border: "border-purple-600", text: "text-purple-300" },
  { id: "CALL-06", label: "Dhubri Lower Basin", lat: 26.0200, lng: 89.9700, category: "moderate", bg: "bg-amber-950/90", border: "border-amber-600", text: "text-amber-300" },
  { id: "CALL-07", label: "Tura Sinking Zone", lat: 25.5100, lng: 90.2200, category: "high_risk", bg: "bg-red-950/90", border: "border-red-600", text: "text-red-300" },
  { id: "CALL-08", label: "Sohra (Cherrapunji)", lat: 25.3000, lng: 91.7300, category: "high_risk", bg: "bg-purple-950/90", border: "border-purple-600", text: "text-purple-300" },
  { id: "CALL-09", label: "NH-37 Imphal-Jiribam", lat: 24.8000, lng: 93.4000, category: "high_risk", bg: "bg-red-950/90", border: "border-red-600", text: "text-red-300" },
  { id: "CALL-10", label: "Aizawl-Kolasib", lat: 23.9000, lng: 92.6800, category: "moderate", bg: "bg-amber-950/90", border: "border-amber-600", text: "text-amber-300" },
  { id: "CALL-11", label: "Agartala Howrah Basin", lat: 23.8300, lng: 91.2800, category: "moderate", bg: "bg-amber-950/90", border: "border-amber-600", text: "text-amber-300" },
  { id: "CALL-12", label: "Lunglei Southern Slopes", lat: 22.8800, lng: 92.7300, category: "moderate", bg: "bg-amber-950/90", border: "border-amber-600", text: "text-amber-300" }
];

const NER_ROADS = [
  {
    id: "R-NH27-GUW-SHI",
    name: "NH27 (Guwahati to Shillong Expressway)",
    from: "guwahati",
    to: "shillong",
    distance_km: 99,
    base_travel_time: 2.5,
    bridge_load_limit: 40,
    terrain_susceptibility: 0.65,
    rainfall_mm_last_6h: 45,
    recent_report_density: 2,
    days_since_last_incident: 4,
    coords: [
      [26.1445, 91.7362],
      [25.9800, 91.8100],
      [25.7500, 91.8500],
      [25.5788, 91.8933]
    ]
  },
  {
    id: "R-NH06-SHI-SIL",
    name: "NH06 / East-West Corridor (Shillong to Silchar)",
    from: "shillong",
    to: "silchar",
    distance_km: 215,
    base_travel_time: 6.0,
    bridge_load_limit: 25,
    terrain_susceptibility: 0.85,
    rainfall_mm_last_6h: 92,
    recent_report_density: 6,
    days_since_last_incident: 1,
    coords: [
      [25.5788, 91.8933],
      [25.3500, 92.2000],
      [25.1000, 92.5000],
      [24.8333, 92.7789]
    ]
  },
  {
    id: "R-NH08-SIL-AGA",
    name: "NH08 (Silchar to Agartala - Tripura Supply Lifeline)",
    from: "silchar",
    to: "agartala",
    distance_km: 250,
    base_travel_time: 7.5,
    bridge_load_limit: 30,
    terrain_susceptibility: 0.50,
    rainfall_mm_last_6h: 30,
    recent_report_density: 1,
    days_since_last_incident: 7,
    coords: [
      [24.8333, 92.7789],
      [24.3000, 92.1500],
      [24.0000, 91.6000],
      [23.8315, 91.2868]
    ]
  },
  {
    id: "R-NH27-GUW-TEZ",
    name: "NH27 (Guwahati to Tezpur via Brahmaputra Corridor)",
    from: "guwahati",
    to: "tezpur",
    distance_km: 178,
    base_travel_time: 3.8,
    bridge_load_limit: 50,
    terrain_susceptibility: 0.30,
    rainfall_mm_last_6h: 20,
    recent_report_density: 0,
    days_since_last_incident: 15,
    coords: [
      [26.1445, 91.7362],
      [26.3500, 92.2500],
      [26.6528, 92.7926]
    ]
  },
  {
    id: "R-NH415-TEZ-ITA",
    name: "NH415 (Tezpur to Itanagar Capital Highway)",
    from: "tezpur",
    to: "itanagar",
    distance_km: 155,
    base_travel_time: 4.2,
    bridge_load_limit: 35,
    terrain_susceptibility: 0.70,
    rainfall_mm_last_6h: 60,
    recent_report_density: 3,
    days_since_last_incident: 3,
    coords: [
      [26.6528, 92.7926],
      [26.9000, 93.2000],
      [27.0844, 93.6053]
    ]
  },
  {
    id: "R-NH29-GUW-DIM",
    name: "NH29 (Guwahati to Dimapur Logistics Hub)",
    from: "guwahati",
    to: "dimapur",
    distance_km: 280,
    base_travel_time: 6.5,
    bridge_load_limit: 45,
    terrain_susceptibility: 0.40,
    rainfall_mm_last_6h: 25,
    recent_report_density: 1,
    days_since_last_incident: 10,
    coords: [
      [26.1445, 91.7362],
      [26.1000, 92.8000],
      [25.9060, 93.7271]
    ]
  },
  {
    id: "R-NH29-DIM-KOH",
    name: "NH29 (Dimapur to Kohima Mountain Pass)",
    from: "dimapur",
    to: "kohima",
    distance_km: 74,
    base_travel_time: 2.8,
    bridge_load_limit: 20,
    terrain_susceptibility: 0.90,
    rainfall_mm_last_6h: 85,
    recent_report_density: 5,
    days_since_last_incident: 2,
    coords: [
      [25.9060, 93.7271],
      [25.8000, 93.9000],
      [25.6751, 94.1086]
    ]
  },
  {
    id: "R-NH102-KOH-IMP",
    name: "NH102 (Kohima to Imphal International Route)",
    from: "kohima",
    to: "imphal",
    distance_km: 138,
    base_travel_time: 4.5,
    bridge_load_limit: 30,
    terrain_susceptibility: 0.75,
    rainfall_mm_last_6h: 55,
    recent_report_density: 2,
    days_since_last_incident: 5,
    coords: [
      [25.6751, 94.1086],
      [25.2500, 94.0000],
      [24.8170, 93.9368]
    ]
  },
  {
    id: "R-NH06-SIL-AIZ",
    name: "NH06 / NH54 (Silchar to Aizawl Mizoram Corridor)",
    from: "silchar",
    to: "aizawl",
    distance_km: 170,
    base_travel_time: 5.5,
    bridge_load_limit: 22,
    terrain_susceptibility: 0.80,
    rainfall_mm_last_6h: 70,
    recent_report_density: 4,
    days_since_last_incident: 2,
    coords: [
      [24.8333, 92.7789],
      [24.2000, 92.7500],
      [23.7271, 92.7176]
    ]
  },
  {
    id: "R-NH13-ITA-TAW",
    name: "NH13 (Itanagar to Tawang Trans-Arunachal Highway)",
    from: "itanagar",
    to: "tawang",
    distance_km: 440,
    base_travel_time: 14.0,
    bridge_load_limit: 15,
    terrain_susceptibility: 0.95,
    rainfall_mm_last_6h: 110,
    recent_report_density: 7,
    days_since_last_incident: 1,
    coords: [
      [27.0844, 93.6053],
      [27.3500, 92.7000],
      [27.5861, 91.8594]
    ]
  },
  {
    id: "R-NH10-GUW-GAN",
    name: "NH10 Corridor (Guwahati to Gangtok via Siliguri link)",
    from: "guwahati",
    to: "gangtok",
    distance_km: 530,
    base_travel_time: 12.0,
    bridge_load_limit: 35,
    terrain_susceptibility: 0.70,
    rainfall_mm_last_6h: 40,
    recent_report_density: 1,
    days_since_last_incident: 8,
    coords: [
      [26.1445, 91.7362],
      [26.7000, 89.5000],
      [27.3389, 88.6065]
    ]
  }
];

const INITIAL_REPORTS = [
  {
    id: "REP-101",
    road_id: "R-NH06-SHI-SIL",
    lat: 25.3500,
    lng: 92.2000,
    type: "Landslide",
    photo_url: "https://images.unsplash.com/photo-1541888946425-d0fbb186a5b3?w=500&q=80",
    ai_severity: "Impassable",
    ai_confidence: 0.94,
    trust_score: 85,
    verified: true,
    reporter_role: "official",
    created_at: "15 mins ago"
  },
  {
    id: "REP-102",
    road_id: "R-NH29-DIM-KOH",
    lat: 25.8000,
    lng: 93.9000,
    type: "Road Sinkhole",
    photo_url: "https://images.unsplash.com/photo-1515162816999-a0c47dc192f7?w=500&q=80",
    ai_severity: "Moderate",
    ai_confidence: 0.88,
    trust_score: 62,
    verified: true,
    reporter_role: "panchayat",
    created_at: "45 mins ago"
  }
];

const RELIEF_VEHICLES = [
  { id: "VEH-01", name: "Ambulance Convoy-A1", type: "medical", capacity_tons: 2.5, current_hub: "guwahati", status: "ready" },
  { id: "VEH-02", name: "Heavy Relief Truck Fleet #4", type: "heavy_relief", capacity_tons: 15.0, current_hub: "tezpur", status: "ready" },
  { id: "VEH-03", name: "4x4 Offroad Utility Unit", type: "perishable", capacity_tons: 4.0, current_hub: "shillong", status: "in_transit" }
];

const COMMUNITY_VOLUNTEERS = [
  { id: "VOL-01", name: "Ramesh Sharma (4x4 Winch Jeep)", contact: "+91 98310-XXXXX", vehicle_type: "4x4 Jeep", location_hub: "shillong", status: "available" },
  { id: "VOL-02", name: "Barak River Rescue Club (2 Motorboats)", contact: "+91 94350-XXXXX", vehicle_type: "Rescue Boat", location_hub: "silchar", status: "available" }
];

const RELIEF_CAMPS = [
  {
    id: "CAMP-01",
    name: "Shillong Central Higher Secondary School Camp",
    hub_id: "shillong",
    lat: 25.5720,
    lng: 91.8880,
    total_capacity: 400,
    current_occupancy: 260,
    medical_staff_present: true,
    food_supply_days: 5,
    contact: "In-charge: Maj. P. Roy (NDRF)"
  },
  {
    id: "CAMP-02",
    name: "Silchar District Indoor Stadium Shelter",
    hub_id: "silchar",
    lat: 24.8380,
    lng: 92.7710,
    total_capacity: 650,
    current_occupancy: 565,
    medical_staff_present: true,
    food_supply_days: 3,
    contact: "In-charge: Dr. K. Das (ASDMA)"
  }
];
