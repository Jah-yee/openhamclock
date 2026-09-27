import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseAprsPacket, parseMice, MICE_TYPES } from './aprsParser.js';

// Expected values cross-checked with aprslib (the reference Python parser)
// wherever it supports the format; third-party and item formats follow APRS 1.01.

describe('parseMice', () => {
  it('decodes a real Yaesu FT-5D beacon (the packet from the bug report)', () => {
    const r = parseMice('SXUX4Y', '`p+5l!![/`"6E}');
    expect(r.lat).toBeCloseTo(38.9748, 4);
    expect(r.lon).toBeCloseTo(-84.2542, 4);
    expect(r.speed).toBe(0);
    expect(r.course).toBe(105);
    expect(r.symbolTable).toBe('/');
    expect(r.symbolCode).toBe('[');
    expect(r.altitude).toBe(748); // 228 m → feet, matching the /A= convention
    expect(r.comment).toBe('`');
  });

  it('decodes the north-west case with speed and course (aprslib: 33.4273, -12.129, 20 kt, 251°)', () => {
    const r = parseMice('S32U6T', '`(_fn"Oj/');
    expect(r.lat).toBeCloseTo(33.4273, 4);
    expect(r.lon).toBeCloseTo(-12.129, 3);
    expect(r.speed).toBe(20);
    expect(r.course).toBe(251);
    expect(r.symbolTable).toBe('/');
    expect(r.symbolCode).toBe('j');
    expect(r.altitude).toBeNull();
  });

  it('applies the +100° longitude offset from destination byte 5', () => {
    expect(parseMice('S32UPT', '`(_fn"Oj/').lon).toBeCloseTo(-112.129, 3);
  });

  it('handles south and east flags', () => {
    const r = parseMice('S32064', '`(_fn"Oj/');
    expect(r.lat).toBeCloseTo(-33.344, 3);
    expect(r.lon).toBeCloseTo(12.129, 3);
  });

  it('decodes the base-91 altitude field and strips it from the comment', () => {
    const r = parseMice('S32U6T', '`(_fn"Oj/"4T}rest');
    expect(r.altitude).toBe(Math.round(61 * 3.28084));
    expect(r.comment).toBe('rest');
  });

  it('accepts all four Mic-E type bytes and an SSID on the destination', () => {
    for (const t of MICE_TYPES) expect(parseMice('SXUX4Y-1', `${t}p+5l!![/`)).not.toBeNull();
  });

  it('rejects non-Mic-E payloads and short inputs', () => {
    expect(parseMice('SXUX4Y', '!3858.49N/08415.25W[')).toBeNull();
    expect(parseMice('SXUX4Y', '`p+5')).toBeNull();
    expect(parseMice('SXU', '`p+5l!![/')).toBeNull();
    expect(parseMice('', '`p+5l!![/')).toBeNull();
  });
});

describe('parseAprsPacket', () => {
  it('parses an uncompressed position with CSE/SPD and /A= altitude', () => {
    const s = parseAprsPacket('N0CALL-9>APRS,WIDE1-1:!3858.49N/08415.25W>090/010/A=000750 test');
    expect(s.call).toBe('N0CALL');
    expect(s.ssid).toBe('N0CALL-9');
    expect(s.lat).toBeCloseTo(38.9748, 4);
    expect(s.lon).toBeCloseTo(-84.2542, 4);
    expect(s.symbol).toBe('/>');
    expect(s.course).toBe(90);
    expect(s.speed).toBe(10);
    expect(s.altitude).toBe(750);
    expect(s.packetType).toBe('position');
    expect(s.positionAmbiguity).toBe(0);
  });

  it('parses a timestamped position and rejects a malformed timestamp', () => {
    const ok = parseAprsPacket('K9XYZ-9>APRS:/092345z3858.49N/08415.25W>090/010/A=000750 ts');
    expect(ok.lat).toBeCloseTo(38.9748, 4);
    expect(ok.comment).toBe('090/010/A=000750 ts');
    expect(parseAprsPacket('K9XYZ-9>APRS:/99xx45z3858.49N/08415.25W>')).toBeNull();
  });

  it('parses a Mic-E beacon end to end', () => {
    const s = parseAprsPacket('N8TAG-12>SXUX4Y,WIDE1-1,WIDE2-1:`p+5l!![/`"6E}');
    expect(s.call).toBe('N8TAG');
    expect(s.lat).toBeCloseTo(38.9748, 4);
    expect(s.lon).toBeCloseTo(-84.2542, 4);
    expect(s.symbol).toBe('/[');
    expect(s.altitude).toBe(748);
    expect(s.packetType).toBe('mic-e');
  });

  it('parses compressed positions (APRS 1.01 example: 49.5N 72.75W, 88°, 36 kt)', () => {
    const s = parseAprsPacket('K9XYZ-9>APRS:=/5L!!<*e7>7P[');
    expect(s.lat).toBeCloseTo(49.5, 4);
    expect(s.lon).toBeCloseTo(-72.75, 4);
    expect(s.symbol).toBe('/>');
    expect(s.course).toBe(88);
    expect(s.speed).toBeCloseTo(36.2, 0);
    // filler cs/T bytes → no course/speed, comment preserved
    const f = parseAprsPacket('K9XYZ-9>APRS:!/5L!!<*e7>  !comment');
    expect(f.lat).toBeCloseTo(49.5, 4);
    expect(f.speed).toBeNull();
    expect(f.comment).toBe('comment');
  });

  it('parses object reports at the right offset (the old parser read the timestamp as latitude)', () => {
    const s = parseAprsPacket('N8TAG-1>APRS,TCPIP*:;OBJNAME  *092345z3858.49N/08415.25W-object comment');
    expect(s.lat).toBeCloseTo(38.9748, 4);
    expect(s.lon).toBeCloseTo(-84.2542, 4);
    expect(s.objectName).toBe('OBJNAME');
    expect(s.packetType).toBe('object');
    expect(s.comment).toBe('object comment');
    // keyed by the object's own name; the transmitting station is kept as sender
    expect(s.ssid).toBe('OBJNAME');
    expect(s.call).toBe('OBJNAME');
    expect(s.sender).toBe('N8TAG-1');
  });

  it('keeps a repeater object separate from the digipeater that sends it', () => {
    const own = parseAprsPacket('W8VFR-3>APRS:!3955.00N/08348.00W#digi');
    const obj = parseAprsPacket('W8VFR-3>APRS:;KA8OCG-2 *092345z3955.66N/08348.37W& object');
    expect(own.ssid).toBe('W8VFR-3');
    expect(obj.ssid).toBe('KA8OCG-2');
    expect(obj.call).toBe('KA8OCG');
    expect(obj.sender).toBe('W8VFR-3');
  });

  it('ignores killed objects and items', () => {
    expect(parseAprsPacket('N8TAG-1>APRS:;OBJNAME  _092345z3858.49N/08415.25W-gone')).toBeNull();
    expect(parseAprsPacket('N8TAG-1>APRS:)ITEM1_3858.49N/08415.25W-gone')).toBeNull();
  });

  it('parses item reports', () => {
    const s = parseAprsPacket('N8TAG-1>APRS:)ITEM1!3858.49N/08415.25W-item comment');
    expect(s.itemName).toBe('ITEM1');
    expect(s.ssid).toBe('ITEM1');
    expect(s.sender).toBe('N8TAG-1');
    expect(s.lat).toBeCloseTo(38.9748, 4);
    expect(s.packetType).toBe('item');
  });

  it('unwraps third-party frames re-transmitted by an igate', () => {
    const s = parseAprsPacket(
      'N8TAG-1>APRS,TCPIP*:}K1JBP-9>APMAIL,TCPIP,N8TAG-1*:!3801.56N/08430.09Wk in service mobile winlink',
    );
    expect(s.call).toBe('K1JBP');
    expect(s.ssid).toBe('K1JBP-9');
    expect(s.lat).toBeCloseTo(38.026, 3);
    expect(s.lon).toBeCloseTo(-84.5015, 3);
    expect(s.symbol).toBe('/k');
    expect(s.thirdPartyVia).toEqual(['N8TAG-1']);
    expect(s.raw.startsWith('N8TAG-1>')).toBe(true);
    // Mic-E inside a third-party wrapper still gets its latitude from the inner destination
    const m = parseAprsPacket('N8TAG-1>APRS,TCPIP*:}N8TAG-12>SXUX4Y,WIDE1-1:`p+5l!![/`"6E}');
    expect(m.ssid).toBe('N8TAG-12');
    expect(m.lat).toBeCloseTo(38.9748, 4);
  });

  it('honours position ambiguity by centring the cell (aprslib agrees)', () => {
    const one = parseAprsPacket('K9XYZ-9>APRS:!3858.4 N/08415.2 W- ambiguity');
    expect(one.lat).toBeCloseTo(38.97417, 4);
    expect(one.lon).toBeCloseTo(-84.25417, 4);
    expect(one.positionAmbiguity).toBe(1);
    const three = parseAprsPacket('K9XYZ-9>APRS:!385 .  N/0841 .  W- ambiguity');
    expect(three.lat).toBeCloseTo(38.91667, 4);
    expect(three.lon).toBeCloseTo(-84.25, 4);
    expect(three.positionAmbiguity).toBe(3);
  });

  it('keeps EmComm resource tokens working, including inside a Mic-E comment', () => {
    const s = parseAprsPacket('N8TAG-12>SXUX4Y:`p+5l!![/[Beds 12/20] [Water OK]');
    expect(s.tokens).toEqual([
      { key: 'Beds', current: 12, max: 20, type: 'capacity' },
      { key: 'Water', value: 'OK', type: 'status' },
    ]);
    expect(s.cleanComment).toBe('');
  });

  it('returns null for non-position packets and junk', () => {
    expect(parseAprsPacket('N8TAG-12>APRS::N0CALL   :hello{1')).toBeNull();
    expect(parseAprsPacket('N8TAG-12>APRS:>status text')).toBeNull();
    expect(parseAprsPacket('N8TAG-12>APRS:T#001,1,2,3,4,5,00000000')).toBeNull();
    expect(parseAprsPacket('no header here')).toBeNull();
    expect(parseAprsPacket('')).toBeNull();
    expect(parseAprsPacket(null)).toBeNull();
    expect(parseAprsPacket('N8TAG-12>AP:`p+5l!![/')).toBeNull(); // Mic-E with a too-short destination
    expect(parseAprsPacket('A>B:!3858.49N/08415.25W-')).toBeNull(); // callsign too short
  });
});

describe('rig-bridge copy stays in step', () => {
  it('rig-bridge/lib/aprs-parser.js is a verbatim copy of server/utils/aprsParser.js (banner aside)', () => {
    const root = path.resolve(__dirname, '..', '..');
    const strip = (src) =>
      src
        .replace(/^'use strict';\n/, '')
        .replace(/^(\/\/ [^\n]*\n)+/, '') // rig-bridge banner
        .trim();
    const server = strip(fs.readFileSync(path.join(root, 'server/utils/aprsParser.js'), 'utf8'));
    const bridge = strip(fs.readFileSync(path.join(root, 'rig-bridge/lib/aprs-parser.js'), 'utf8'));
    expect(bridge).toBe(server);
  });
});
