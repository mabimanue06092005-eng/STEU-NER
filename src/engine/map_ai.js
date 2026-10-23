/**
 * SETU-NER - Map AI Copilot & Natural Language Logistics Assistant
 * Answers queries about road risk, safe routes, isolated hubs, relief camps, and volunteer equipment
 */

const MapAIEngine = {
  
  /**
   * Processes natural language query against current platform state
   */
  async processQuery(query, state) {
    if (!query || typeof query !== 'string') return "Please enter a valid query.";

    const q = query.toLowerCase().trim();
    await new Promise(res => setTimeout(res, 400)); // AI thinking delay simulation

    if (q.includes("route") || q.includes("path") || q.includes("go to") || q.includes("agartala") || q.includes("silchar")) {
      const activeRoute = state.activeRoute;
      if (activeRoute) {
        // activeRoute comes straight from the backend (Dijkstra fallback or Google+SETU-NER
        // scoring) — it has distance/eta/risk but no client-side "path" array to join, so
        // describe it from the fields that actually exist rather than a field that never did.
        const originText = (document.getElementById("originSelect") || {}).value || "Origin";
        const destText = (document.getElementById("destSelect") || {}).value || "Destination";
        return `🤖 **Map AI Advice**: The safest route from ${originText} to ${destText} is estimated ETA **${activeRoute.totalEta} hrs**, total distance: **${activeRoute.totalDistance} km** with average risk score of **${activeRoute.avgRisk}/100**.`;
      }
      return "🤖 **Map AI Advice**: Please select an Origin and Destination in the header bar and click 'Optimize Route' to compute the safest path.";
    }

    if (q.includes("cut off") || q.includes("isolated") || q.includes("block") || q.includes("landslide")) {
      const blockedCount = state.blockedRoadIds.length;
      if (blockedCount === 0) {
        return "🤖 **Map AI Status**: All primary national highways (NH27, NH06, NH08, NH29) are currently **OPEN**. No settlements are isolated.";
      }
      return `🤖 **Map AI Warning**: **${blockedCount} road segment(s)** are currently severed. Use the **What-If Simulator** tab to view affected isolated villages and alternative supply routes.`;
    }

    if (q.includes("camp") || q.includes("shelter") || q.includes("food") || q.includes("occupancy")) {
      return "🤖 **Map AI Info**: Relief Camps in Shillong and Silchar are operating at **62% average capacity**. Available beds: **140 in Shillong Primary School**, **85 in Silchar Stadium Camp**.";
    }

    if (q.includes("volunteer") || q.includes("boat") || q.includes("tractor") || q.includes("4x4")) {
      return "🤖 **Map AI Volunteer Pool**: **12 community volunteers** registered nearby with 4x4 winches, rescue boats, and heavy tractors available for instant dispatch.";
    }

    if (q.includes("vulnerable") || q.includes("elderly") || q.includes("pwd") || q.includes("pregnant")) {
      return "🤖 **Map AI Registry**: **2,110 vulnerable citizens** (elderly, pregnant women, PwD) tagged across 12 hubs. They receive priority boost (+15) in convoy dispatch queuing.";
    }

    return `🤖 **Map AI Assistant**: I can help you with live road risks, optimal ambulance routes, relief camp availability, and volunteer equipment. Try asking: *"What is the safest route to Agartala?"* or *"Show relief camp beds in Silchar"*`;
  }
};
