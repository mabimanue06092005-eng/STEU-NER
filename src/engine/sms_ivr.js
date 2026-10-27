/**
 * SETU-NER - SMS Shortcode Parser & IVR Fallback Telephony Engine (Section 2.6)
 */

const SmsIvrEngine = {

  /**
   * Parses natural shortcode SMS strings e.g. "BLOCK NH27 KM45 LANDSLIDE"
   */
  parseSMS(smsString) {
    if (!smsString || typeof smsString !== 'string') {
      return { success: false, error: "Empty SMS payload" };
    }

    const clean = smsString.trim().toUpperCase();
    const parts = clean.split(/\s+/);

    const command = parts[0];

    if (command === "BLOCK" || command === "REPORT") {
      const roadCode = parts[1] || "UNKNOWN";
      const kmMarker = parts[2] && parts[2].startsWith("KM") ? parts[2] : "N/A";
      const hazardType = parts.slice(parts[2] && parts[2].startsWith("KM") ? 3 : 2).join(" ") || "Blockage";

      return {
        success: true,
        action: "FILE_REPORT",
        parsed: {
          road: roadCode,
          km: kmMarker,
          type: hazardType,
          channel: "SMS_SHORTCODE",
          confidence: 0.96
        }
      };
    } else if (command === "STATUS" || command === "ROAD") {
      const roadCode = parts[1] || "ALL";
      return {
        success: true,
        action: "CHECK_STATUS",
        parsed: {
          road: roadCode,
          channel: "SMS_QUERY"
        }
      };
    } else {
      return {
        success: false,
        error: "Unrecognized shortcode format. Example: BLOCK NH27 KM45 LANDSLIDE"
      };
    }
  },

  /**
   * IVR Dialpad Menu State Handler
   */
  handleIVRKeyPress(key) {
    const keyNum = String(key);

    if (keyNum === "1") {
      return {
        audioPrompt: "Press 1 for Landslide, Press 2 for Bridge Failure, Press 3 for Flood.",
        menuLevel: 2,
        action: "RECORD_HAZARD_TYPE"
      };
    } else if (keyNum === "2") {
      return {
        audioPrompt: "Highway NH06 Shillong-Silchar is currently HIGH RISK (Score 88). Detour via NH08 recommended.",
        menuLevel: 1,
        action: "PLAY_STATUS_AUDIO"
      };
    } else if (keyNum === "3") {
      return {
        audioPrompt: "Relief Convoy A1 is currently dispatched towards Silchar Hospital. Estimated ETA: 4.2 hours.",
        menuLevel: 1,
        action: "PLAY_CONVOY_AUDIO"
      };
    } else {
      return {
        audioPrompt: "Welcome to SETU Emergency Toll-Free IVR. Press 1 to report, Press 2 for road status, Press 3 for convoy info.",
        menuLevel: 1,
        action: "MAIN_MENU"
      };
    }
  }
};
