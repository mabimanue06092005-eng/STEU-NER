/**
 * SETU-NER - Relief Camp Finder & Area-Wide Emergency Cell Broadcast Engine (Feature 10)
 */

const CampBroadcastEngine = {

  /**
   * Calculates occupancy percentage and availability status for a relief camp
   */
  getCampOccupancyStatus(camp) {
    const percent = Math.round((camp.current_occupancy / camp.total_capacity) * 100);
    let status = "Available";
    let color = "#22c55e"; // Green

    if (percent >= 90) {
      status = "FULL / OVERCROWDED";
      color = "#ef4444"; // Red
    } else if (percent >= 70) {
      status = "Filling Fast";
      color = "#eab308"; // Yellow
    }

    return {
      occupancy_percent: percent,
      open_beds: Math.max(0, camp.total_capacity - camp.current_occupancy),
      status_label: status,
      color: color
    };
  },

  /**
   * Simulates Area-Wide Emergency Cell Broadcast SMS / Alert Push
   */
  triggerEmergencyBroadcast(districtName, warningText) {
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    return {
      broadcast_id: "EMERGENCY-BC-" + Math.floor(1000 + Math.random() * 9000),
      target_district: districtName,
      severity: "EXTREME CRITICAL ALERT",
      message: warningText,
      estimated_reach: "142,500 Mobile Subscribers in " + districtName,
      sent_at: timestamp,
      status: "BROADCAST DELIVERED VIA CELL TOWER CHANNELS"
    };
  }
};
