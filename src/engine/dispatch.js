/**
 * SETU-NER - Relief Convoy & Dispatch Optimizer (Section 2.9 & 2.10)
 * Greedy VRP Solver incorporating vulnerable population tagging
 */

const DispatchOptimizer = {

  /**
   * Calculates priority score for stranded location
   */
  calculatePriorityScore(demand) {
    let cargoWeight = 1.0;
    if (demand.cargo_type === "medical") cargoWeight = 3.0;
    else if (demand.cargo_type === "perishable") cargoWeight = 2.0;

    const popScore = (demand.population || 1000) / 1000.0;
    const vulnerableBoost = (demand.vulnerableCount || 0) * 0.15;
    const distancePenalty = (demand.distanceFromHub || 10) * 0.1;

    const score = (cargoWeight * 20) + popScore + vulnerableBoost - distancePenalty;
    return Math.round(Math.max(5, score));
  },

  /**
   * Optimizes convoy vehicle allocation to highest priority stranded points
   */
  optimizeConvoys(nodes, vehicles) {
    // 1. Identify demand points (isolated or stranded hubs)
    const demandPoints = [
      { id: "dem-01", hub_id: "silchar", name: "Silchar Medical Base", cargo_type: "medical", population: 230000, vulnerableCount: 310, status: "pending" },
      { id: "dem-02", hub_id: "kohima", name: "Kohima Relief Camp", cargo_type: "perishable", population: 100000, vulnerableCount: 110, status: "pending" },
      { id: "dem-03", hub_id: "tawang", name: "Tawang Isolated Village", cargo_type: "medical", population: 12000, vulnerableCount: 65, status: "pending" },
      { id: "dem-04", hub_id: "aizawl", name: "Aizawl Emergency Hub", cargo_type: "heavy_relief", population: 290000, vulnerableCount: 210, status: "pending" }
    ];

    // 2. Score demand points
    demandPoints.forEach(dp => {
      dp.priority_score = this.calculatePriorityScore(dp);
    });

    // Sort descending by priority
    demandPoints.sort((a, b) => b.priority_score - a.priority_score);

    // 3. Match available vehicles
    const assignments = [];
    const availableVehicles = vehicles.filter(v => v.status === "ready");

    demandPoints.forEach(dp => {
      if (availableVehicles.length > 0) {
        // Find best vehicle match
        let bestVehIndex = 0;
        if (dp.cargo_type === "medical") {
          const medIndex = availableVehicles.findIndex(v => v.type === "medical");
          if (medIndex !== -1) bestVehIndex = medIndex;
        }

        const assignedVeh = availableVehicles.splice(bestVehIndex, 1)[0];
        assignments.push({
          demand: dp,
          assignedVehicle: assignedVeh,
          status: "ASSIGNED & DISPATCHED"
        });
      } else {
        assignments.push({
          demand: dp,
          assignedVehicle: null,
          status: "QUEUED (Awaiting Vehicle)"
        });
      }
    });

    return assignments;
  }
};
