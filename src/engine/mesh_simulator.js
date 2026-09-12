/**
 * SETU-NER - Bluetooth BLE / Wi-Fi Direct Mesh Relay Simulator (Section 2.7)
 * Implements epidemic gossip protocol for zero-connectivity disaster resilience
 */

const MeshRelaySimulator = {
  meshQueue: [
    {
      id: "MESH-001",
      road_id: "R-NH13-ITA-TAW",
      type: "Landslide",
      reporter: "Driver Phone #9842",
      hops: 2,
      originTime: "10 mins ago",
      synced: false
    },
    {
      id: "MESH-002",
      road_id: "R-NH06-SHI-SIL",
      type: "Bridge Damage",
      reporter: "Villager Phone #7002",
      hops: 1,
      originTime: "25 mins ago",
      synced: false
    }
  ],

  /**
   * Adds a new offline report into local BLE Mesh Queue
   */
  queueOfflineReport(report) {
    const meshItem = {
      id: "MESH-" + Math.floor(1000 + Math.random() * 9000),
      road_id: report.road_id,
      type: report.type,
      reporter: "Local Peer Device",
      hops: 0,
      originTime: "Just now",
      synced: false
    };
    this.meshQueue.push(meshItem);
    return meshItem;
  },

  /**
   * Simulates a Bluetooth P2P gossip hop to a neighboring phone
   */
  simulateHop() {
    if (this.meshQueue.length === 0) return { status: "empty", message: "Mesh queue empty." };

    let hopCount = 0;
    this.meshQueue.forEach(item => {
      if (!item.synced) {
        item.hops += 1;
        hopCount++;
      }
    });

    return {
      status: "relayed",
      message: `Relayed ${hopCount} report packets over BLE to nearby device. Hop count increased!`,
      queue: this.meshQueue
    };
  },

  /**
   * Flushes queue when any device reaches connectivity
   */
  flushToServer() {
    const unsynced = this.meshQueue.filter(item => !item.synced);
    this.meshQueue.forEach(item => item.synced = true);

    return {
      flushedCount: unsynced.length,
      syncedItems: unsynced
    };
  }
};
