/**
 * aprsMice — decoder for APRS Mic-E position packets (APRS 1.01 chapter 10).
 *
 * Mic-E is the default beacon format on Yaesu and Kenwood radios (FT-5D,
 * FT-3D, FTM-400, TH-D74, …). Half of the position lives in the AX.25
 * destination address: six characters that encode the latitude digits,
 * three message bits, the N/S flag, the longitude +100° offset flag and the
 * W/E flag. The information field (data type ` ' 0x1c 0x1d) carries the
 * longitude, speed, course, symbol and an optional base-91 altitude.
 *
 * Verified against aprslib (the reference Python parser) on real and
 * synthetic packets — see aprsMice.test.js. A copy of this decoder lives in
 * rig-bridge/lib/aprs-parser.js because rig-bridge ships separately; keep
 * the two in step.
 */

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

module.exports = { parseMice, MICE_TYPES };
