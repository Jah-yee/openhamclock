'use strict';
// ┌─────────────────────────────────────────────────────────────────────┐
// │ VERBATIM COPY of server/utils/aprsParser.js — do not edit here.     │
// │ rig-bridge ships on its own and cannot require the server tree.     │
// │ Edit the server file and copy it over; a guard test enforces this.  │
// └─────────────────────────────────────────────────────────────────────┘
/**
 * aprsParser — APRS position packet parser shared by the server (APRS-IS feed
 * and the cloud-relay endpoint) and rig-bridge (direct TNC path).
 *
 * rig-bridge ships on its own and cannot require the server tree, so
 * rig-bridge/lib/aprs-parser.js is a verbatim copy of this file (plus a
 * banner). A guard test (aprsParser.test.js) fails when the two drift.
 *
 * Parses a raw APRS line ("SRC>DEST,PATH:payload") into a station object with
 * lat/lon, symbol, comment, speed (knots), course and altitude (feet).
 * Returns null for anything that is not a position we can place on a map.
 *
 * Supported (APRS 1.01):
 *   !  =        Position without timestamp — uncompressed or compressed
 *   /  @        Position with timestamp    — uncompressed or compressed
 *   ;           Object report (killed objects are ignored)
 *   )           Item report   (killed items are ignored)
 *   ` ' 1c 1d   Mic-E — Yaesu / Kenwood radios; latitude rides in the destination
 *   }           Third-party wrapper — igates re-transmit internet traffic over
 *               RF inside this; the inner packet is parsed (depth-limited)
 *   Position ambiguity (spaces in the minutes) is honoured by placing the
 *   station at the centre of the ambiguous cell.
 *
 * Expected values in the tests were cross-checked against aprslib, the
 * reference Python parser, wherever it supports the format.
 */

const MICE_TYPES = new Set(['`', "'", '\x1c', '\x1d']);
const MAX_THIRD_PARTY_DEPTH = 4;

// ── Uncompressed / compressed position body ─────────────────────────────

/**
 * Minutes from a 4-digit "MMmm" field that may carry ambiguity spaces.
 * Ambiguous digits place the value at the centre of the cell they describe.
 */
function minutesWithAmbiguity(digits) {
  if (!/^\d{4}$|^\d{0,3} {1,4}$/.test(digits)) return null;
  const ambiguity = (digits.match(/ /g) || []).length;
  const low = Number(digits.replace(/ /g, '0')) / 100;
  if (low >= 60) return null;
  const halfCell = [0, 0.1, 1, 10, 60][ambiguity] / 2;
  return { minutes: low + halfCell, ambiguity };
}

const validTable = (s) => /^[/\\0-9A-Z]$/.test(s);
const validSymbol = (s) => /^[\x21-\x7e]$/.test(s);
const decode91 = (s) => [...s].reduce((n, c) => n * 91 + c.charCodeAt(0) - 33, 0);

/**
 * Parse a position body (everything after the data type / timestamp / name).
 * Uncompressed: DDMM.MMN<table>DDDMM.MMW<symbol>comment
 * Compressed:   <table>YYYYXXXX<symbol>csT comment   (base-91)
 */
function parsePositionBody(body) {
  if (!body) return null;
  if (/^\d/.test(body)) {
    const m = body.match(/^(\d{2})([\d ]{2})\.([\d ]{2})([NS])(.)(\d{3})([\d ]{2})\.([\d ]{2})([EW])(.)([\s\S]*)$/i);
    if (!m || !validTable(m[5]) || !validSymbol(m[10])) return null;
    const a = minutesWithAmbiguity(m[2] + m[3]);
    const b = minutesWithAmbiguity(m[7] + m[8]);
    if (!a || !b) return null;
    return {
      lat: (Number(m[1]) + a.minutes / 60) * (m[4].toUpperCase() === 'S' ? -1 : 1),
      lon: (Number(m[6]) + b.minutes / 60) * (m[9].toUpperCase() === 'W' ? -1 : 1),
      symbolTable: m[5],
      symbolCode: m[10],
      comment: m[11].trim(),
      positionAmbiguity: Math.max(a.ambiguity, b.ambiguity),
    };
  }

  // Compressed: table byte, 4 lat + 4 lon base-91 chars, symbol, then cs + T
  if (body.length < 13 || !/^[/\\A-Za-j]$/.test(body[0])) return null;
  if (!/^[\x21-\x7b]{8}$/.test(body.slice(1, 9)) || !validSymbol(body[9])) return null;
  const table = /^[a-j]$/.test(body[0]) ? String(body.charCodeAt(0) - 97) : body[0]; // a-j → overlay 0-9
  const out = {
    lat: 90 - decode91(body.slice(1, 5)) / 380926,
    lon: -180 + decode91(body.slice(5, 9)) / 190463,
    symbolTable: table,
    symbolCode: body[9],
    comment: body.slice(13).trim(),
    positionAmbiguity: 0,
  };
  if (body[10] === ' ') return out; // cs/T bytes are fillers
  if (!/^[\x21-\x7b]{3}$/.test(body.slice(10, 13))) return null;
  const c = body.charCodeAt(10) - 33;
  const s = body.charCodeAt(11) - 33;
  const t = body.charCodeAt(12) - 33;
  if ((t & 0x18) === 0x10) {
    out.altitude = Math.round(Math.pow(1.002, c * 91 + s)); // feet
  } else if (c <= 89) {
    out.course = c * 4;
    out.speed = Math.round((Math.pow(1.08, s) - 1) * 10) / 10; // knots
  }
  return out;
}

/**
 * "DDHHMMz" / "HHMMSSh" / "DDHHMM/" timestamps — only checked for shape.
 * "000000z" is accepted: igates and some trackers send it as "no timestamp"
 * (seen in the wild on third-party frames; direwolf accepts it too).
 */
function timestampLooksValid(s) {
  if (!/^\d{6}[zh/]$/.test(s)) return false;
  if (s.startsWith('000000')) return true;
  const a = Number(s.slice(0, 2));
  const b = Number(s.slice(2, 4));
  const c = Number(s.slice(4, 6));
  return s[6] === 'h' ? a < 24 && b < 60 && c < 60 : a >= 1 && a <= 31 && b < 24 && c < 60;
}

// ── Mic-E (APRS 1.01 chapter 10) ─────────────────────────────────────────

/** Destination character → latitude digit (0–9). K, L, Z stand for "space" → 0. */
function miceDigit(ch) {
  const c = ch ? ch.charCodeAt(0) : 0;
  if (c >= 0x30 && c <= 0x39) return c - 0x30; // 0-9
  if (c >= 0x41 && c <= 0x4a) return c - 0x41; // A-J (custom message set)
  if (c >= 0x50 && c <= 0x59) return c - 0x50; // P-Y (standard message set)
  return 0; // K, L, Z
}

/** Destination characters P–Z carry a set indicator bit (North, +100°, West). */
function miceFlag(ch) {
  const c = ch ? ch.charCodeAt(0) : 0;
  return c >= 0x50 && c <= 0x5a;
}

/**
 * Decode a Mic-E packet: latitude from the destination address, the rest from
 * the information field. Speed in knots, altitude converted to feet.
 */
function parseMice(destination, info) {
  if (!destination || !info || info.length < 9) return null;
  if (!MICE_TYPES.has(info.charAt(0))) return null;
  const dest = destination.split('-')[0];
  if (dest.length < 6) return null;

  const d = [...dest.substring(0, 6)].map(miceDigit);
  const latDeg = d[0] * 10 + d[1];
  const latMin = d[2] * 10 + d[3] + (d[4] * 10 + d[5]) / 100;
  let lat = latDeg + latMin / 60;
  if (!miceFlag(dest.charAt(3))) lat = -lat; // 0-9 / L → South

  // Longitude degrees: byte-28, then the +100 offset from destination byte 5,
  // THEN the wrap-around corrections — the order the APRS 1.01 encoding table
  // requires (aprslib and direwolf do the same).
  let lonDeg = info.charCodeAt(1) - 28;
  if (miceFlag(dest.charAt(4))) lonDeg += 100;
  if (lonDeg >= 180 && lonDeg <= 189) lonDeg -= 80;
  else if (lonDeg >= 190 && lonDeg <= 199) lonDeg -= 190;

  let lonMin = info.charCodeAt(2) - 28;
  if (lonMin >= 60) lonMin -= 60;
  const lonHun = info.charCodeAt(3) - 28;
  let lon = lonDeg + (lonMin + lonHun / 100) / 60;
  if (miceFlag(dest.charAt(5))) lon = -lon; // P-Z → West

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
    const metres = decode91(altMatch[1]) - 10000;
    altitude = Math.round(metres * 3.28084);
    comment = comment.replace(altMatch[0], '').trim();
  }

  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon, symbolTable, symbolCode, comment, speed, course, altitude, positionAmbiguity: 0 };
}

// ── EmComm resource tokens ──────────────────────────────────────────────

/**
 * Resource tokens in the comment (EmComm bracket notation):
 * "[Beds 12/20] [Water OK]" → tokens array + comment with the tokens removed.
 */
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

// ── Packet ──────────────────────────────────────────────────────────────

/**
 * Parse a raw APRS packet line into a position station object.
 * @param {string} line  "SRC>DEST,PATH:payload"
 * @returns {{ call, ssid, lat, lon, symbol, comment, tokens, cleanComment,
 *             speed, course, altitude, raw, packetType, positionAmbiguity,
 *             objectName?, itemName?, thirdPartyVia? } | null}
 */
function parseAprsPacket(line) {
  try {
    if (typeof line !== 'string' || line.length > 8192) return null;
    const raw = line;
    const thirdPartyVia = [];
    let src;
    let destination;
    let payload;

    // Unwrap third-party frames: "IGATE>APRS:}REAL>DEST,PATH:payload"
    for (let depth = 0; ; depth++) {
      if (depth > MAX_THIRD_PARTY_DEPTH) return null;
      const headerEnd = line.indexOf(':');
      const arrow = line.indexOf('>');
      if (arrow < 1 || headerEnd <= arrow + 1) return null;
      src = line.slice(0, arrow).replace(/\0/g, '').trim();
      destination = line
        .slice(arrow + 1, headerEnd)
        .split(',')[0]
        .replace(/\0/g, '')
        .trim();
      payload = line.slice(headerEnd + 1).replace(/[\r\n]+$/, '');
      if (payload.charAt(0) !== '}') break;
      thirdPartyVia.push(src);
      line = payload.slice(1);
    }

    const senderCall = src.split('-')[0].trim();
    if (!senderCall || senderCall.length < 3) return null;

    const dataType = payload.charAt(0);
    let parsed = null;
    let packetType = null;
    let objectName;
    let itemName;

    if (dataType === '!' || dataType === '=') {
      parsed = parsePositionBody(payload.slice(1));
      packetType = 'position';
    } else if (dataType === '/' || dataType === '@') {
      if (!timestampLooksValid(payload.slice(1, 8))) return null;
      parsed = parsePositionBody(payload.slice(8));
      packetType = 'position';
    } else if (dataType === ';') {
      // ;NAME_____*DDHHMMz<position>  — name is 9 bytes, then live(*)/killed(_), then a 7-byte timestamp
      objectName = payload.slice(1, 10).trim();
      if (!objectName || payload.charAt(10) !== '*' || !timestampLooksValid(payload.slice(11, 18))) return null;
      parsed = parsePositionBody(payload.slice(18));
      packetType = 'object';
    } else if (dataType === ')') {
      // )NAME!<position>  — name is 3–9 bytes, then live(!)/killed(_)
      const item = payload.match(/^\)([\x20-\x7e]{3,9}?)([!_])([\s\S]*)$/);
      if (!item || item[2] !== '!' || !item[1].trim()) return null;
      itemName = item[1].trim();
      parsed = parsePositionBody(item[3]);
      packetType = 'item';
    } else if (MICE_TYPES.has(dataType)) {
      parsed = parseMice(destination, payload);
      packetType = 'mic-e';
    } else {
      return null; // messages, telemetry, status, … — not a position
    }
    if (!parsed) return null;

    const { lat, lon, symbolTable, symbolCode } = parsed;
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;

    const comment = parsed.comment || '';
    let speed = parsed.speed ?? null;
    let course = parsed.course ?? null;
    let altitude = parsed.altitude ?? null;

    // Uncompressed extensions in the comment: CSE/SPD and /A=FFFFFF (feet)
    if (speed == null) {
      const csMatch = comment.match(/^(\d{3})\/(\d{3})/);
      if (csMatch && Number(csMatch[1]) <= 360) {
        course = parseInt(csMatch[1]);
        speed = parseInt(csMatch[2]); // knots
      }
    }
    if (altitude == null) {
      const altMatch = comment.match(/\/A=(-\d{5}|\d{6})/);
      if (altMatch) altitude = parseInt(altMatch[1]); // feet
    }

    const { tokens, cleanComment } = parseResourceTokens(comment);
    // Objects and items are things a station reports (a repeater, a shelter,
    // a net), not the station itself: key them by their own name so they sit
    // beside the sender on the map instead of overwriting its position.
    const name = objectName || itemName;
    const ssid = name || src;
    const callsign = name ? name.split('-')[0].trim() || name : senderCall;
    return {
      call: callsign,
      ssid,
      ...(name ? { sender: src } : {}),
      lat,
      lon,
      symbol: `${symbolTable}${symbolCode}`,
      comment,
      tokens,
      cleanComment,
      speed,
      course,
      altitude,
      raw,
      packetType,
      positionAmbiguity: parsed.positionAmbiguity ?? 0,
      ...(objectName ? { objectName } : {}),
      ...(itemName ? { itemName } : {}),
      ...(thirdPartyVia.length ? { thirdPartyVia } : {}),
    };
  } catch {
    return null;
  }
}

module.exports = { parseAprsPacket, parseMice, parsePositionBody, parseResourceTokens, MICE_TYPES };
