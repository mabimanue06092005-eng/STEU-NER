/**
 * SETU-NER - Multi-Channel Disaster Communication Architecture (Phase 3)
 *
 * Notification Channel
 * ├── WebSocket   (REAL — backend already broadcasts over /ws/gis)
 * ├── SMS         (SIMULATED — no SMS gateway/carrier integrated in this prototype)
 * ├── Local Mesh  (SIMULATED — browsers cannot form an arbitrary BLE mesh between devices)
 * ├── LoRa        (HARDWARE/FUTURE — requires a LoRaWAN gateway, not present)
 * └── Satellite   (HARDWARE/FUTURE — requires a satellite modem/service, not present)
 *
 * This module does not pretend any channel works beyond what this deployment actually
 * has. `kind` on every channel tells the UI exactly what it's looking at.
 */

const NotificationChannels = {
  WEBSOCKET: {
    id: "websocket",
    label: "Internet + WebSocket",
    kind: "REAL",
    send(alert) {
      const delivered = typeof WsClient !== "undefined" && WsClient.state === "CONNECTED";
      return { channel: "websocket", kind: "REAL", attempted: true, delivered };
    }
  },

  SMS: {
    id: "sms",
    label: "SMS (Fallback)",
    kind: "SIMULATED",
    send(alert) {
      const parsed = (typeof SmsIvrEngine !== "undefined")
        ? SmsIvrEngine.parseSMS(`REPORT ${(alert.emergency_type || "ALERT").toUpperCase()} ${alert.message || ""}`)
        : null;
      return { channel: "sms", kind: "SIMULATED", attempted: true, delivered: false, detail: parsed };
    }
  },

  LOCAL_MESH: {
    id: "local_mesh",
    label: "Local Mesh (Bluetooth / Wi-Fi Direct)",
    kind: "SIMULATED",
    send(alert) {
      const queued = (typeof MeshRelaySimulator !== "undefined")
        ? MeshRelaySimulator.queueOfflineReport({ road_id: alert.road_id || "UNKNOWN", type: alert.emergency_type || "ALERT" })
        : null;
      return { channel: "local_mesh", kind: "SIMULATED", attempted: true, delivered: false, detail: queued };
    }
  },

  LORA: {
    id: "lora",
    label: "LoRa / LoRaWAN (Long Range)",
    kind: "HARDWARE_FUTURE",
    send() {
      return { channel: "lora", kind: "HARDWARE_FUTURE", attempted: false, delivered: false, reason: "Requires a LoRaWAN gateway — not present in this deployment." };
    }
  },

  SATELLITE: {
    id: "satellite",
    label: "Satellite (Extreme Isolation)",
    kind: "HARDWARE_FUTURE",
    send() {
      return { channel: "satellite", kind: "HARDWARE_FUTURE", attempted: false, delivered: false, reason: "Requires a satellite modem/service — not present in this deployment." };
    }
  },

  /**
   * Reports/attempts every channel in priority order for one alert. The backend write
   * (POST /api/alerts) is the actual real delivery — this documents which redundant
   * channels would also have been used, and honestly marks which ones are real vs
   * simulated vs hardware-dependent, for the UI to display.
   */
  broadcastAlert(alert, channelOrder = ["WEBSOCKET", "SMS", "LOCAL_MESH", "LORA", "SATELLITE"]) {
    return channelOrder
      .map(key => this[key])
      .filter(Boolean)
      .map(channel => {
        try {
          return channel.send(alert);
        } catch (err) {
          return { channel: channel.id, kind: channel.kind, attempted: true, delivered: false, error: String(err) };
        }
      });
  }
};
