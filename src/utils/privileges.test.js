import { describe, it, expect } from 'vitest';
import {
  canTransmit,
  privilegeRanges,
  nonPrivilegedSlices,
  modeBucket,
  normalizeLicenseClass,
  inUsAmateurBand,
  PRIVILEGES,
  US_BAND_LIMITS,
  LICENSE_CLASSES,
} from './privileges.js';

describe('normalizeLicenseClass', () => {
  it('accepts the three US classes case-insensitively', () => {
    expect(normalizeLicenseClass('Technician')).toBe('technician');
    expect(normalizeLicenseClass('GENERAL')).toBe('general');
    expect(normalizeLicenseClass(' extra ')).toBe('extra');
  });

  it('maps other/none/unknown/empty to null (no restrictions)', () => {
    expect(normalizeLicenseClass('other')).toBeNull();
    expect(normalizeLicenseClass('none')).toBeNull();
    expect(normalizeLicenseClass('novice')).toBeNull();
    expect(normalizeLicenseClass('')).toBeNull();
    expect(normalizeLicenseClass(undefined)).toBeNull();
  });
});

describe('modeBucket', () => {
  it('classifies CW', () => {
    expect(modeBucket('CW')).toBe('cw');
    expect(modeBucket('cw-r')).toBe('cw');
  });

  it('classifies data modes including rig-mapped forms', () => {
    for (const m of ['DATA', 'FT8', 'FT4', 'JS8', 'WSPR', 'RTTY', 'PSK31', 'DATA-USB', 'DATA-LSB']) {
      expect(modeBucket(m)).toBe('data');
    }
  });

  it('classifies phone modes and defaults unknowns to phone', () => {
    for (const m of ['USB', 'LSB', 'SSB', 'AM', 'FM', 'WFM']) {
      expect(modeBucket(m)).toBe('phone');
    }
    expect(modeBucket('MYSTERY')).toBe('phone');
  });
});

describe('table shape', () => {
  it('exposes the documented license classes', () => {
    expect(LICENSE_CLASSES).toEqual(['other', 'technician', 'general', 'extra']);
  });

  it('every privilege row sits inside its US band limits', () => {
    for (const r of PRIVILEGES) {
      const band = US_BAND_LIMITS.find((b) => b.band === r.band);
      expect(band, `row band ${r.band} missing from US_BAND_LIMITS`).toBeDefined();
      expect(r.min_khz).toBeGreaterThanOrEqual(band.min_khz);
      expect(r.max_khz).toBeLessThanOrEqual(band.max_khz);
      expect(r.max_khz).toBeGreaterThan(r.min_khz);
      expect(r.modes.length).toBeGreaterThan(0);
    }
  });
});

describe('canTransmit — Other / non-US', () => {
  it('never restricts', () => {
    expect(canTransmit('other', 14200, 'SSB')).toBe(true);
    expect(canTransmit('none', 28600, 'SSB')).toBe(true);
    expect(canTransmit('', 7100, 'LSB')).toBe(true);
    expect(canTransmit(undefined, 3600, 'CW')).toBe(true);
  });
});

describe('canTransmit — outside modeled US bands', () => {
  it('passes for any class (nothing meaningful to say)', () => {
    expect(canTransmit('technician', 27185, 'AM')).toBe(true); // CB
    expect(canTransmit('extra', 5000, 'AM')).toBe(true); // WWV
    expect(canTransmit('general', 137000, 'FM')).toBe(true); // 2m airband-adjacent, not amateur
  });
});

describe('canTransmit — Technician', () => {
  it('has the 10m privileges: CW/data 28000–28300, SSB 28300–28500', () => {
    expect(canTransmit('technician', 28100, 'FT8')).toBe(true);
    expect(canTransmit('technician', 28050, 'CW')).toBe(true);
    expect(canTransmit('technician', 28400, 'SSB')).toBe(true);
    expect(canTransmit('technician', 28400, 'USB')).toBe(true);
    expect(canTransmit('technician', 28400, 'CW')).toBe(true);
    // Data not allowed in the SSB window, SSB not allowed below 28300
    expect(canTransmit('technician', 28400, 'FT8')).toBe(false);
    expect(canTransmit('technician', 28200, 'SSB')).toBe(false);
    // Above 28500: nothing for Technician
    expect(canTransmit('technician', 28600, 'SSB')).toBe(false);
    expect(canTransmit('technician', 29600, 'FM')).toBe(false);
  });

  it('has CW-only slivers on 80/40/15m', () => {
    expect(canTransmit('technician', 3550, 'CW')).toBe(true);
    expect(canTransmit('technician', 3510, 'CW')).toBe(false); // below 3525
    expect(canTransmit('technician', 3550, 'FT8')).toBe(false); // CW only
    expect(canTransmit('technician', 7050, 'CW')).toBe(true);
    expect(canTransmit('technician', 7200, 'CW')).toBe(false);
    expect(canTransmit('technician', 21100, 'CW')).toBe(true);
    expect(canTransmit('technician', 21300, 'CW')).toBe(false);
  });

  it('has no privileges on 160/60/30/20/17/12m', () => {
    expect(canTransmit('technician', 1850, 'CW')).toBe(false);
    expect(canTransmit('technician', 5357, 'USB')).toBe(false);
    expect(canTransmit('technician', 10136, 'FT8')).toBe(false);
    expect(canTransmit('technician', 14074, 'FT8')).toBe(false);
    expect(canTransmit('technician', 14200, 'SSB')).toBe(false);
    expect(canTransmit('technician', 18100, 'FT8')).toBe(false);
    expect(canTransmit('technician', 24915, 'FT8')).toBe(false);
  });

  it('has full privileges on 6m and up (50 MHz+), CW-only sub-bands aside', () => {
    expect(canTransmit('technician', 50125, 'SSB')).toBe(true);
    expect(canTransmit('technician', 50050, 'SSB')).toBe(false); // 50.0–50.1 CW only
    expect(canTransmit('technician', 50050, 'CW')).toBe(true);
    expect(canTransmit('technician', 146520, 'FM')).toBe(true);
    expect(canTransmit('technician', 144200, 'USB')).toBe(true);
    expect(canTransmit('technician', 223500, 'FM')).toBe(true);
    expect(canTransmit('technician', 446000, 'FM')).toBe(true);
  });
});

describe('canTransmit — General', () => {
  it('gets all of 160m, 60m, 30m, 12m, 10m', () => {
    expect(canTransmit('general', 1850, 'LSB')).toBe(true);
    expect(canTransmit('general', 1840, 'FT8')).toBe(true);
    expect(canTransmit('general', 5357, 'USB')).toBe(true);
    expect(canTransmit('general', 10136, 'FT8')).toBe(true);
    expect(canTransmit('general', 24915, 'FT8')).toBe(true);
    expect(canTransmit('general', 29600, 'FM')).toBe(true);
  });

  it('respects the General phone sub-band edges', () => {
    // 80m phone starts at 3800
    expect(canTransmit('general', 3900, 'LSB')).toBe(true);
    expect(canTransmit('general', 3700, 'LSB')).toBe(false);
    // 40m phone starts at 7175
    expect(canTransmit('general', 7180, 'LSB')).toBe(true);
    expect(canTransmit('general', 7150, 'LSB')).toBe(false);
    // 20m phone starts at 14225
    expect(canTransmit('general', 14250, 'SSB')).toBe(true);
    expect(canTransmit('general', 14200, 'SSB')).toBe(false);
    // 15m phone starts at 21275
    expect(canTransmit('general', 21300, 'SSB')).toBe(true);
    expect(canTransmit('general', 21250, 'SSB')).toBe(false);
  });

  it('respects the General CW/data sub-band edges', () => {
    expect(canTransmit('general', 14030, 'CW')).toBe(true);
    expect(canTransmit('general', 14010, 'CW')).toBe(false); // Extra-only 14000–14025
    expect(canTransmit('general', 14074, 'FT8')).toBe(true);
    expect(canTransmit('general', 7074, 'FT8')).toBe(true);
    expect(canTransmit('general', 7010, 'CW')).toBe(false);
    expect(canTransmit('general', 3573, 'FT8')).toBe(true);
    expect(canTransmit('general', 3510, 'CW')).toBe(false);
  });

  it('allows CW inside its phone segments (§97.305)', () => {
    expect(canTransmit('general', 7200, 'CW')).toBe(true);
    expect(canTransmit('general', 14300, 'CW')).toBe(true);
  });
});

describe('canTransmit — Extra', () => {
  it('has full band edges on HF', () => {
    expect(canTransmit('extra', 14010, 'CW')).toBe(true);
    expect(canTransmit('extra', 14151, 'SSB')).toBe(true);
    expect(canTransmit('extra', 3501, 'CW')).toBe(true);
    expect(canTransmit('extra', 3650, 'LSB')).toBe(true);
    expect(canTransmit('extra', 7001, 'CW')).toBe(true);
    expect(canTransmit('extra', 7130, 'LSB')).toBe(true);
    expect(canTransmit('extra', 21001, 'CW')).toBe(true);
    expect(canTransmit('extra', 21210, 'SSB')).toBe(true);
  });

  it('still respects mode segmentation (no phone in CW/data segments)', () => {
    expect(canTransmit('extra', 14074, 'SSB')).toBe(false);
    expect(canTransmit('extra', 10136, 'SSB')).toBe(false);
    expect(canTransmit('extra', 28100, 'SSB')).toBe(false);
    // and no data in phone segments on HF
    expect(canTransmit('extra', 14200, 'FT8')).toBe(false);
  });
});

describe('privilegeRanges', () => {
  it('returns nothing for Other', () => {
    expect(privilegeRanges('other', '20m')).toEqual([]);
  });

  it('returns nothing for a band the class has no access to', () => {
    expect(privilegeRanges('technician', '20m')).toEqual([]);
    expect(privilegeRanges('technician', '160m')).toEqual([]);
  });

  it('returns the General 80m rows', () => {
    const rows = privilegeRanges('general', '80m');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ min_khz: 3525, max_khz: 3600 });
    expect(rows[1]).toMatchObject({ min_khz: 3800, max_khz: 4000 });
  });

  it('covers the whole band for Extra on 20m', () => {
    const rows = privilegeRanges('extra', '20m');
    expect(Math.min(...rows.map((r) => r.min_khz))).toBe(14000);
    expect(Math.max(...rows.map((r) => r.max_khz))).toBe(14350);
  });
});

describe('nonPrivilegedSlices', () => {
  it('is empty for Other (no restriction UI)', () => {
    expect(nonPrivilegedSlices('other', 14100, 14350, 'USB')).toEqual([]);
  });

  it('marks a fully privileged segment as clean', () => {
    expect(nonPrivilegedSlices('extra', 3600, 4000, 'LSB')).toEqual([]);
    expect(nonPrivilegedSlices('technician', 144500, 148000, 'FM')).toEqual([]);
  });

  it('marks a fully out-of-privilege segment', () => {
    expect(nonPrivilegedSlices('technician', 14100, 14350, 'USB')).toEqual([{ min: 14100, max: 14350 }]);
  });

  it('splits a partially privileged segment (General 80m phone)', () => {
    // bandplan 80m SSB segment is 3600–4000; General phone starts at 3800
    expect(nonPrivilegedSlices('general', 3600, 4000, 'LSB')).toEqual([{ min: 3600, max: 3800 }]);
  });

  it('splits around the Technician 10m SSB window', () => {
    // bandplan 10m SSB segment is 28120–29000; Technician phone is 28300–28500
    expect(nonPrivilegedSlices('technician', 28120, 29000, 'USB')).toEqual([
      { min: 28120, max: 28300 },
      { min: 28500, max: 29000 },
    ]);
  });

  it('trims the CW-only band edge for General (20m CW segment)', () => {
    // bandplan 20m CW segment is 14000–14070; General CW starts at 14025
    expect(nonPrivilegedSlices('general', 14000, 14070, 'CW')).toEqual([{ min: 14000, max: 14025 }]);
  });
});

describe('inUsAmateurBand', () => {
  it('knows the modeled allocations', () => {
    expect(inUsAmateurBand(14200)).toBe(true);
    expect(inUsAmateurBand(27185)).toBe(false);
    expect(inUsAmateurBand(146520)).toBe(true);
  });
});

describe('60 m is a band plus four channels, not a continuous range (FCC rules from 2026-02-13)', () => {
  it('allows the 5351.5–5366.5 kHz band and the four channels for General and Extra', () => {
    for (const cls of ['general', 'extra']) {
      expect(canTransmit(cls, 5357, 'USB')).toBe(true); // inside the band
      expect(canTransmit(cls, 5351.5, 'CW')).toBe(true);
      expect(canTransmit(cls, 5366.5, 'CW')).toBe(true);
      // channels: USB dial (centre − 1.5 kHz) and CW/data on the centre
      for (const centre of [5332, 5348, 5373, 5405]) {
        expect(canTransmit(cls, centre - 1.5, 'USB')).toBe(true);
        expect(canTransmit(cls, centre, 'CW')).toBe(true);
        expect(canTransmit(cls, centre, 'FT8')).toBe(true);
      }
    }
  });

  it('rejects the gaps between channels that the old continuous range allowed', () => {
    for (const cls of ['general', 'extra']) {
      expect(canTransmit(cls, 5340, 'USB')).toBe(false);
      expect(canTransmit(cls, 5340, 'CW')).toBe(false);
      expect(canTransmit(cls, 5369, 'USB')).toBe(false);
      expect(canTransmit(cls, 5390, 'CW')).toBe(false);
    }
    expect(canTransmit('technician', 5357, 'USB')).toBe(false);
  });
});
