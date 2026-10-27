/**
 * SETU-NER - Community Resource & Volunteer Pooling Engine (Feature 9)
 * Matches local citizen volunteers (boats, tractors, 4x4 jeeps) with emergency relief requests
 */

const CommunityPoolEngine = {

  /**
   * Registers a new volunteer resource
   */
  registerVolunteer(volunteersList, newVol) {
    const volItem = {
      id: "VOL-" + Math.floor(100 + Math.random() * 900),
      name: newVol.name,
      contact: newVol.contact,
      vehicle_type: newVol.vehicle_type, // "4x4 Jeep", "Tractor", "Rescue Boat", "Winch Truck"
      location_hub: newVol.location_hub,
      status: "available"
    };
    volunteersList.unshift(volItem);
    return volItem;
  },

  /**
   * Matches stranded demand location with nearest available volunteer resource
   */
  matchNearestVolunteer(demandHubId, volunteersList) {
    const available = volunteersList.filter(v => v.status === "available");
    if (available.length === 0) return null;

    // Direct match by hub first, then pick first available
    const sameHubMatch = available.find(v => v.location_hub === demandHubId);
    if (sameHubMatch) {
      sameHubMatch.status = "DISPATCHED";
      return sameHubMatch;
    }

    const matched = available[0];
    matched.status = "DISPATCHED";
    return matched;
  }
};
