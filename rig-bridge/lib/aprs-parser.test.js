import { describe, it, expect } from 'vitest';
import { parseAprsPacket } from './aprs-parser.js';

// The full suite lives in server/utils/aprsParser.test.js (this file is a
// verbatim copy of that module, enforced by a guard test). These are smoke
// tests that the copy rig-bridge actually ships still handles the formats a
// TNC hears over RF.
describe('rig-bridge aprs-parser', () => {
  it('uncompressed position', () => {
    const s = parseAprsPacket('N0CALL-9>APRS,WIDE1-1:!3858.49N/08415.25W>090/010/A=000750 test');
    expect(s.lat).toBeCloseTo(38.9748, 4);
    expect(s.altitude).toBe(750);
  });
  it('Mic-E beacon from a Yaesu HT (was dropped before — reported by a user)', () => {
    const s = parseAprsPacket('N8TAG-12>SXUX4Y,WIDE1-1,WIDE2-1:`p+5l!![/`"6E}');
    expect(s.ssid).toBe('N8TAG-12');
    expect(s.lat).toBeCloseTo(38.9748, 4);
    expect(s.lon).toBeCloseTo(-84.2542, 4);
    expect(s.altitude).toBe(748);
  });
  it('third-party frame from an igate, object report, compressed position', () => {
    expect(parseAprsPacket('N8TAG-1>APRS:}K1JBP-9>APMAIL,TCPIP,N8TAG-1*:!3801.56N/08430.09Wk x').ssid).toBe('K1JBP-9');
    expect(parseAprsPacket('N8TAG-1>APRS:;OBJNAME  *092345z3858.49N/08415.25W-c').lat).toBeCloseTo(38.9748, 4);
    expect(parseAprsPacket('K9XYZ-9>APRS:=/5L!!<*e7>7P[').lon).toBeCloseTo(-72.75, 4);
  });
  it('non-position packets are null', () => {
    expect(parseAprsPacket('N8TAG-12>APRS::N0CALL   :hello{1')).toBeNull();
  });
});
