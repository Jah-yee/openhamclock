'use strict';
/**
 * aprs-parser.js — Lightweight APRS position packet parser
 *
 * Parses a raw APRS line ("CALLSIGN>PATH:payload") into a station object
 * with lat/lon, symbol, comment, speed, course, and altitude.
 * Returns null for non-position packets (messages, telemetry, status, etc.).
 *
 * Supported APRS position formats:
 *   !  =  Position without timestamp (uncompressed)
 *   /  @  Position with timestamp    (uncompressed)
 *   ;     Object report
 *   ` '   Mic-E (Yaesu / Kenwood radios — latitude rides in the destination)
 *
 * The Mic-E decoder below is a copy of server/utils/aprsMice.js (rig-bridge
 * ships on its own, so it cannot require the server tree). Keep them in step.
 */

// Parse APRS uncompressed latitude: DDMM.MMN
function parseAprsLat(s) {
  if (!s || s.length < 8) return NaN;
  const deg = parseInt(s.substring(0, 2));
  const min = parseFloat(s.substring(2, 7));
  const hemi = s.charAt(7);
  const lat = deg + min / 60;
  return hemi === 'S' ? -lat : lat;
}

// Parse APRS uncompressed longitude: DDDMM.MMW
function parseAprsLon(s) {
  if (!s || s.length < 9) return NaN;
  const deg = parseInt(s.substring(0, 3));
  const min = parseFloat(s.substring(3, 8));
  const hemi = s.charAt(8);
  const lon = deg + min / 60;
  return hemi === 'W' ? -lon : lon;
}

// ── Mic-E (APRS 1.01 chapter 10) ─────────────────────────────────────
const MICE_TYPES = new Set(['`', "'", '\x1c', '\x1d']);

/** Destination character → latitude digit (0–9). K, L, Z stand for "space" → 0. */
function destDigit(ch) {
  const c = ch ? ch.charCodeAt(0) : 0;
  if (c >= 0x30 && c <= 0x39) return c - 0x30; // 0-9
  if (c >= 0x41 && c <= 0x4a) return c - 0x41; // A-J (custom message set)
  if (c >= 0x50 && c <= 0x59) return c - 0x50; // P-Y (standard message set)
  return 0; // K, L, Z
}

/** Destination characters P–Z carry a set indicator bit (North, +100°, West). */
function destFlag(ch) {
  const c = ch ? ch.charCodeAt(0) : 0;
  return c >= 0x50 && c <= 0x5a;
}

/**
 * Decode a Mic-E packet.
 * @param {string} destination — the AX.25 destination address (SSID tolerated)
 * @param {string} info — the information field, starting with the data type byte
 * @returns {{ lat, lon, symbolTable, symbolCode, comment, speed, course, altitude }|null}
 *   speed in knots, altitude in feet (converted from Mic-E metres so it matches
 *   the /A= convention used by the uncompressed formats), or null when the
 *   packet is not Mic-E or does not decode to a sane position.
 */
function parseMice(destination, info) {
  if (!destination || !info || info.length < 9) return null;
  if (!MICE_TYPES.has(info.charAt(0))) return null;
  const dest = destination.split('-')[0];
  if (dest.length < 6) return null;

  const d = [...dest.substring(0, 6)].map(destDigit);
  const latDeg = d[0] * 10 + d[1];
  const latMin = d[2] * 10 + d[3] + (d[4] * 10 + d[5]) / 100;
  let lat = latDeg + latMin / 60;
  if (!destFlag(dest.charAt(3))) lat = -lat; // 0-9 / L → South

  // Longitude degrees: byte-28, then the +100 offset from destination byte 5,
  // THEN the wrap-around corrections (this order is what the encoding table
  // in APRS 1.01 requires; aprslib and direwolf do the same).
  let lonDeg = info.charCodeAt(1) - 28;
  if (destFlag(dest.charAt(4))) lonDeg += 100;
  if (lonDeg >= 180 && lonDeg <= 189) lonDeg -= 80;
  else if (lonDeg >= 190 && lonDeg <= 199) lonDeg -= 190;

  let lonMin = info.charCodeAt(2) - 28;
  if (lonMin >= 60) lonMin -= 60;
  const lonHun = info.charCodeAt(3) - 28;
  let lon = lonDeg + (lonMin + lonHun / 100) / 60;
  if (destFlag(dest.charAt(5))) lon = -lon; // P-Z → West

  // Speed and course are packed across three bytes.
  const sp = info.charCodeAt(4) - 28;
  const dc = info.charCodeAt(5) - 28;
  const se = info.charCodeAt(6) - 28;
  let speed = sp * 10 + Math.floor(dc / 10);
  let course = (dc % 10) * 100 + se;
  if (speed >= 800) speed -= 800;
  if (course >= 400) course -= 400;

  const symbolCode = info.charAt(7);
  const symbolTable = info.charAt(8);
  let comment = info.substring(9);

  // Optional altitude: three base-91 chars followed by '}', value − 10000 = metres.
  let altitude = null;
  const altMatch = comment.match(/([\x21-\x7b]{3})\}/);
  if (altMatch) {
    const a = altMatch[1];
    const metres = (a.charCodeAt(0) - 33) * 91 * 91 + (a.charCodeAt(1) - 33) * 91 + (a.charCodeAt(2) - 33) - 10000;
    altitude = Math.round(metres * 3.28084);
    comment = comment.replace(altMatch[0], '').trim();
  }

  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;

  return { lat, lon, symbolTable, symbolCode, comment, speed, course, altitude };
}

// Parse resource tokens from APRS comment field (EmComm bracket notation)
// e.g. "[Beds 12/20] [Water OK]" → tokens array + clean comment
function parseResourceTokens(comment) {
  if (!comment) return { tokens: [], cleanComment: '' };
  const tokens = [];
  const regex = /\[([A-Za-z]+)\s+([^\]]+)\]/g;
  let match;
  while ((match = regex.exec(comment)) !== null) {
    const key = match[1];
    const val = match[2].trim();
    const capacityMatch = val.match(/^(\d+)\/(\d+)$/);
    if (capacityMatch) {
      tokens.push({ key, current: parseInt(capacityMatch[1]), max: parseInt(capacityMatch[2]), type: 'capacity' });
    } else if (val === '!') {
      tokens.push({ key, value: '!', type: 'critical' });
    } else if (val.toUpperCase() === 'OK') {
      tokens.push({ key, value: 'OK', type: 'status' });
    } else if (/^-\d+$/.test(val)) {
      tokens.push({ key, value: parseInt(val), type: 'need' });
    } else if (/^\d+$/.test(val)) {
      tokens.push({ key, value: parseInt(val), type: 'quantity' });
    } else {
      tokens.push({ key, value: val, type: 'text' });
    }
  }
  const cleanComment = comment.replace(regex, '').trim();
  return { tokens, cleanComment };
}

/**
 * Parse a raw APRS packet line into a position station object.
 * @param {string} line  Raw APRS line: "CALLSIGN>PATH:payload"
 * @returns {{ call, ssid, lat, lon, symbol, comment, tokens, cleanComment,
 *             speed, course, altitude, raw } | null}
 */
function parseAprsPacket(line) {
  try {
    const headerEnd = line.indexOf(':');
    if (headerEnd < 0) return null;

    const header = line.substring(0, headerEnd);
    const payload = line.substring(headerEnd + 1);
    const callsign = header.split('>')[0].split('-')[0].trim();
    const ssid = header.split('>')[0].trim();
    // Destination address (first path element) — Mic-E encodes latitude in it
    const destination = (header.split('>')[1] || '').split(',')[0].trim();

    if (!callsign || callsign.length < 3) return null;

    const dataType = payload.charAt(0);
    let lat, lon, symbolTable, symbolCode, comment, rest;
    let speed = null,
      course = null,
      altitude = null;

    if (dataType === '!' || dataType === '=') {
      // Position without timestamp: !DDMM.MMN/DDDMM.MMW$...
      lat = parseAprsLat(payload.substring(1, 9));
      symbolTable = payload.charAt(9);
      lon = parseAprsLon(payload.substring(10, 19));
      symbolCode = payload.charAt(19);
      comment = payload.substring(20).trim();
    } else if (dataType === '/' || dataType === '@') {
      // Position with timestamp: /HHMMSSh DDMM.MMN/DDDMM.MMW$...
      lat = parseAprsLat(payload.substring(8, 16));
      symbolTable = payload.charAt(16);
      lon = parseAprsLon(payload.substring(17, 26));
      symbolCode = payload.charAt(26);
      comment = payload.substring(27).trim();
    } else if (dataType === ';') {
      // Object: ;NAME_____*HHMMSSh DDMM.MMN/DDDMM.MMW$...
      const objPayload = payload.substring(11);
      const ts = objPayload.charAt(0) === '*' ? 8 : 0;
      rest = objPayload.substring(ts);
      if (rest.length >= 19) {
        lat = parseAprsLat(rest.substring(0, 8));
        symbolTable = rest.charAt(8);
        lon = parseAprsLon(rest.substring(9, 18));
        symbolCode = rest.charAt(18);
        comment = rest.substring(19).trim();
      }
    } else if (MICE_TYPES.has(dataType)) {
      // Mic-E: latitude from the destination, everything else in the payload
      const mice = parseMice(destination, payload);
      if (!mice) return null;
      ({ lat, lon, symbolTable, symbolCode, comment, speed, course, altitude } = mice);
    } else {
      return null; // Not a position packet we handle
    }

    if (isNaN(lat) || isNaN(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;

    if (speed == null) {
      const csMatch = comment?.match(/^(\d{3})\/(\d{3})/);
      if (csMatch) {
        course = parseInt(csMatch[1]);
        speed = parseInt(csMatch[2]); // knots
      }
    }
    if (altitude == null) {
      const altMatch = comment?.match(/\/A=(\d{6})/);
      if (altMatch) {
        altitude = parseInt(altMatch[1]); // feet
      }
    }

    const { tokens, cleanComment } = parseResourceTokens(comment);

    return {
      call: callsign,
      ssid,
      lat,
      lon,
      symbol: `${symbolTable}${symbolCode}`,
      comment: comment || '',
      tokens,
      cleanComment,
      speed,
      course,
      altitude,
      raw: line,
    };
  } catch (e) {
    return null;
  }
}

module.exports = { parseAprsPacket, parseMice };
