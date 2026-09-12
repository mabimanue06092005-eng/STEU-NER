/**
 * SETU-NER - Dynamic AI Route Optimizer Engine
 * Dijkstra's shortest path with dynamic risk & cargo weighted edges (Section 2.3)
 */

const RouteOptimizer = {

  /**
   * Calculates cargo penalty factor based on cargo type and bridge weight limits
   */
  getCargoPenalty(cargoType, road, riskScore) {
    let penalty = 1.0;

    if (cargoType === "medical") {
      // Ambulance routes bypass moderate traffic/minor risk penalties to reach hospital fast
      penalty = 0.7;
    } else if (cargoType === "heavy_relief") {
      // Heavy 15-ton trucks cannot traverse weak bridges (< 25 tons load limit)
      if (road.bridge_load_limit && road.bridge_load_limit < 25) {
        penalty = 8.0; // Extreme penalty / detour trigger
      } else {
        penalty = 1.3; // Higher caution on mountain roads
      }
    } else if (cargoType === "perishable") {
      // Prioritize avoiding time delays
      penalty = 1.1;
    }

    return penalty;
  },

  /**
   * Calculates dynamic edge travel cost
   */
  calculateEdgeWeight(road, cargoType = "general", blockedRoadIds = []) {
    if (blockedRoadIds.includes(road.id)) {
      return Infinity; // Completely severed road
    }

    const riskScore = road.risk_score || RiskEngine.calculateRoadRisk(road);
    
    // Severely impassable roads (risk >= 90 or impassable reports)
    if (riskScore >= 95) {
      return Infinity;
    }

    const cargoFactor = this.getCargoPenalty(cargoType, road, riskScore);
    const timeWeight = road.base_travel_time * (1 + (riskScore / 100.0) * 1.5) * cargoFactor;
    return timeWeight;
  },

  /**
   * Dijkstra's Algorithm for safest route calculation
   */
  findSafestRoute(nodes, roads, startNodeId, endNodeId, cargoType = "general", blockedRoadIds = []) {
    if (startNodeId === endNodeId) {
      return { path: [startNodeId], totalDistance: 0, totalEta: 0, avgRisk: 0, roads: [] };
    }

    // Build Adjacency List
    const adj = {};
    Object.keys(nodes).forEach(id => adj[id] = []);

    roads.forEach(road => {
      const weight = this.calculateEdgeWeight(road, cargoType, blockedRoadIds);
      if (weight !== Infinity) {
        adj[road.from]?.push({ to: road.to, weight, road });
        adj[road.to]?.push({ to: road.from, weight, road }); // Undirected road network
      }
    });

    const distances = {};
    const previous = {};
    const roadUsed = {};
    const unvisited = new Set(Object.keys(nodes));

    Object.keys(nodes).forEach(id => distances[id] = Infinity);
    distances[startNodeId] = 0;

    while (unvisited.size > 0) {
      // Find node with min distance
      let minNode = null;
      unvisited.forEach(node => {
        if (minNode === null || distances[node] < distances[minNode]) {
          minNode = node;
        }
      });

      if (minNode === null || distances[minNode] === Infinity) break;
      if (minNode === endNodeId) break;

      unvisited.delete(minNode);

      adj[minNode].forEach(neighbor => {
        if (unvisited.has(neighbor.to)) {
          const alt = distances[minNode] + neighbor.weight;
          if (alt < distances[neighbor.to]) {
            distances[neighbor.to] = alt;
            previous[neighbor.to] = minNode;
            roadUsed[neighbor.to] = neighbor.road;
          }
        }
      });
    }

    if (distances[endNodeId] === Infinity) {
      return null; // Route disconnected
    }

    // Reconstruct Path
    const pathNodes = [];
    const pathRoads = [];
    let curr = endNodeId;

    while (curr) {
      pathNodes.unshift(curr);
      if (roadUsed[curr]) {
        pathRoads.unshift(roadUsed[curr]);
      }
      curr = previous[curr];
    }

    // Aggregate statistics
    let totalDist = 0;
    let totalRiskSum = 0;
    let bridgeCount = 0;

    pathRoads.forEach(r => {
      totalDist += r.distance_km;
      totalRiskSum += (r.risk_score || RiskEngine.calculateRoadRisk(r));
      if (r.bridge_load_limit) bridgeCount++;
    });

    const totalEta = Math.round(distances[endNodeId] * 10) / 10;
    const avgRisk = pathRoads.length > 0 ? Math.round(totalRiskSum / pathRoads.length) : 0;

    return {
      path: pathNodes,
      roads: pathRoads,
      totalDistance: Math.round(totalDist),
      totalEta: totalEta,
      avgRisk: avgRisk,
      bridgeCount: bridgeCount
    };
  },

  /**
   * Finds alternative routes by temporarily penalizing or blocking primary route segments
   */
  findAlternateRoutes(nodes, roads, startNodeId, endNodeId, cargoType = "general", blockedRoadIds = []) {
    const primaryRoute = this.findSafestRoute(nodes, roads, startNodeId, endNodeId, cargoType, blockedRoadIds);
    if (!primaryRoute || primaryRoute.roads.length === 0) return { primary: null, alternate: null };

    // To find an alternate detour route, block the longest / key edge of the primary route
    let keyRoad = primaryRoute.roads[0];
    primaryRoute.roads.forEach(r => {
      if (r.distance_km > keyRoad.distance_km) keyRoad = r;
    });

    const tempBlocked = [...blockedRoadIds, keyRoad.id];
    const altRoute = this.findSafestRoute(nodes, roads, startNodeId, endNodeId, cargoType, tempBlocked);

    return {
      primary: primaryRoute,
      alternate: altRoute
    };
  },

  /**
   * "What-If" Disaster Simulation (Section 2.11)
   * Simulates blocking a road, re-calculates graph connectivity & isolated hubs
   */
  simulateRoadBlockage(nodes, roads, blockedRoadId) {
    const blockedRoad = roads.find(r => r.id === blockedRoadId);
    if (!blockedRoad) return null;

    const blockedIds = [blockedRoadId];
    const isolatedHubs = [];
    let totalDelayHoursSum = 0;
    let evaluablePairsCount = 0;

    // Test connectivity between main hub (Guwahati) and all other hubs
    const hubIds = Object.keys(nodes).filter(id => id !== "guwahati");

    hubIds.forEach(targetId => {
      const normalRoute = this.findSafestRoute(nodes, roads, "guwahati", targetId, "general", []);
      const simRoute = this.findSafestRoute(nodes, roads, "guwahati", targetId, "general", blockedIds);

      if (normalRoute) {
        if (!simRoute) {
          // Village / hub completely cut off!
          isolatedHubs.push(nodes[targetId].name);
        } else {
          evaluablePairsCount++;
          totalDelayHoursSum += (simRoute.totalEta - normalRoute.totalEta);
        }
      }
    });

    const avgDelayHours = evaluablePairsCount > 0 ? Math.round((totalDelayHoursSum / evaluablePairsCount) * 10) / 10 : 0;

    return {
      blockedRoad: blockedRoad,
      isolatedHubs: isolatedHubs,
      avgDelayHours: avgDelayHours,
      affectedCount: isolatedHubs.length
    };
  }
};
