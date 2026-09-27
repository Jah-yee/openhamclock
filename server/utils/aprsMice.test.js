import { describe, it, expect } from 'vitest';
import { parseMice, MICE_TYPES } from './aprsMice.js';

// Expected values cross-checked with aprslib (reference Python parser).
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
    // Same info field, byte 5 flipped to the P–Z range → 112°W instead of 12°W
    const r = parseMice('S32UPT', '`(_fn"Oj/');
    expect(r.lon).toBeCloseTo(-112.129, 3);
  });

  it('handles south and east flags (digits in bytes 4 and 6)', () => {
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
    for (const t of MICE_TYPES) {
      expect(parseMice('SXUX4Y-1', `${t}p+5l!![/`)).not.toBeNull();
    }
  });

  it('rejects non-Mic-E payloads and short inputs', () => {
    expect(parseMice('SXUX4Y', '!3858.49N/08415.25W[')).toBeNull();
    expect(parseMice('SXUX4Y', '`p+5')).toBeNull();
    expect(parseMice('SXU', '`p+5l!![/')).toBeNull();
    expect(parseMice('', '`p+5l!![/')).toBeNull();
    expect(parseMice('SXUX4Y', '')).toBeNull();
  });
});
