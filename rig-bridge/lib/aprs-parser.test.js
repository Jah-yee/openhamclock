import { describe, it, expect } from 'vitest';
import { parseAprsPacket } from './aprs-parser.js';

describe('rig-bridge aprs-parser', () => {
  it('still parses uncompressed positions', () => {
    const s = parseAprsPacket('N0CALL-9>APRS,WIDE1-1:!3858.49N/08415.25W>090/010/A=000750 test');
    expect(s.call).toBe('N0CALL');
    expect(s.lat).toBeCloseTo(38.9748, 4);
    expect(s.lon).toBeCloseTo(-84.2542, 4);
    expect(s.symbol).toBe('/>');
    expect(s.course).toBe(90);
    expect(s.speed).toBe(10);
    expect(s.altitude).toBe(750);
  });

  it('parses a Mic-E beacon from a Yaesu HT (was dropped before — reported by a user)', () => {
    const s = parseAprsPacket('N8TAG-12>SXUX4Y,WIDE1-1,WIDE2-1:`p+5l!![/`"6E}');
    expect(s).not.toBeNull();
    expect(s.call).toBe('N8TAG');
    expect(s.ssid).toBe('N8TAG-12');
    expect(s.lat).toBeCloseTo(38.9748, 4);
    expect(s.lon).toBeCloseTo(-84.2542, 4);
    expect(s.symbol).toBe('/[');
    expect(s.course).toBe(105);
    expect(s.speed).toBe(0);
    expect(s.altitude).toBe(748);
  });

  it('keeps EmComm resource tokens working inside a Mic-E comment', () => {
    const s = parseAprsPacket('N8TAG-12>SXUX4Y:`p+5l!![/[Beds 12/20] [Water OK]');
    expect(s.tokens).toEqual([
      { key: 'Beds', current: 12, max: 20, type: 'capacity' },
      { key: 'Water', value: 'OK', type: 'status' },
    ]);
  });

  it('returns null for a Mic-E payload with a malformed destination', () => {
    expect(parseAprsPacket('N8TAG-12>AP:`p+5l!![/')).toBeNull();
  });

  it('returns null for non-position packets', () => {
    expect(parseAprsPacket('N8TAG-12>APRS::N0CALL   :hello{1')).toBeNull();
    expect(parseAprsPacket('N8TAG-12>APRS:>status text')).toBeNull();
  });
});
