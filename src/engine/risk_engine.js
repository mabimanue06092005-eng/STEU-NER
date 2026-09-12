/**
 * SETU-NER - Live Road Risk Engine & Trust Scoring Algorithm
 * Implements weighted scoring model (Section 2.1) + Trust Scoring (Section 2.4)
 */

const RiskEngine = {
  // Weights defined by judge-friendly, explainable scoring model
  WEIGHTS: {
    w1_rainfall: 0.40,
    w2_terrain: 0.30,
    w3_reports: 0.20,
    w4_recency: 0.10
  },

  /**
   * Calculates dynamic 0-100 risk score for a single road segment
   * @param {Object} road 
   * @returns {Number} risk_score (0..100)
   */
  calculateRoadRisk(road) {
    // 1. Rainfall intensity normalized (0..100mm scaled to 0..1)
    const rainfall_norm = Math.min(1.0, (road.rainfall_mm_last_6h || 0) / 100.0);

    // 2. Terrain / Landslide susceptibility score (0.0 to 1.0)
    const terrain_score = road.terrain_susceptibility || 0.5;

    // 3. Recent crowd report density (0..10 count scaled to 0..1)
    const report_density = Math.min(1.0, (road.recent_report_density || 0) / 10.0);

    // 4. Days since last incident inverse (0..30 days -> 1.0 to 0.0)
    const days = Math.max(1, road.days_since_last_incident || 30);
    const recency_inverse = Math.min(1.0, 1.0 / (days * 0.2));

    // Weighted formula
    const raw_score = (this.WEIGHTS.w1_rainfall * rainfall_norm)
                    + (this.WEIGHTS.w2_terrain * terrain_score)
                    + (this.WEIGHTS.w3_reports * report_density)
                    + (this.WEIGHTS.w4_recency * recency_inverse);

    const final_score = Math.round(Math.min(100, Math.max(0, raw_score * 100)));
    return final_score;
  },

  /**
   * Helper to categorize numerical score into Risk Band
   */
  getRiskCategory(score) {
    if (score < 36) return { label: "LOW", color: "#22c55e", bgClass: "bg-emerald-500" };
    if (score < 66) return { label: "MODERATE", color: "#eab308", bgClass: "bg-amber-500" };
    return { label: "HIGH RISK", color: "#ef4444", bgClass: "bg-rose-500" };
  },

  /**
   * Calculates Reporter Credibility / Report Trust Score
   * Formula: trust_score = base_score + (corroborating * 5) + (history * 10) - age_penalty
   */
  calculateTrustScore(reporterRole, corroboratingCount = 0, historyAccuracy = 1.0, ageHours = 0) {
    let baseScore = 40;
    if (reporterRole === "panchayat") baseScore = 65;
    if (reporterRole === "official") baseScore = 85;

    const corroborationBonus = Math.min(25, corroboratingCount * 5);
    const historyBonus = Math.min(20, historyAccuracy * 10);
    const agePenalty = Math.min(30, ageHours * 2);

    const totalTrust = Math.round(Math.min(100, Math.max(0, baseScore + corroborationBonus + historyBonus - agePenalty)));
    return totalTrust;
  },

  /**
   * Weather Simulator - Triggers rain intensity boost across mountain roads
   */
  simulateWeatherSpike(roads, multiplier = 2.0) {
    return roads.map(road => {
      // High terrain susceptibility roads get much heavier rainfall in a flash monsoon
      const rainDelta = road.terrain_susceptibility > 0.6 ? 40 * multiplier : 15 * multiplier;
      const newRainfall = Math.round((road.rainfall_mm_last_6h || 20) + rainDelta);
      
      const updatedRoad = { ...road, rainfall_mm_last_6h: newRainfall };
      updatedRoad.risk_score = this.calculateRoadRisk(updatedRoad);
      return updatedRoad;
    });
  }
};
