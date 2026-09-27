import { describe, it, expect } from 'vitest';
import { getModeFromFreq, mapModeToRig, getBandForFreq, getMarkerPosition, getSegmentClass } from './bandPlan';

describe('getBandForFreq', () => {
  it('groups contiguous ranges into a single band with edges', () => {
    const band = getBandForFreq(14074000); // 20m FT8
    expect(band).not.toBeNull();
    expect(band.name).toBe('20m');
    expect(band.min).toBe(14000);
    expect(band.max).toBe(14350);
    expect(band.segments.length).toBe(4); // CW, Data, Data/RTTY (14.100–14.150), SSB
  });

  it('includes the split data segments on classic HF bands', () => {
    const b40 = getBandForFreq(7074000);
    expect(b40.name).toBe('40m');
    const seg = b40.segments.find((s) => 7074 >= s.min && 7074 <= s.max);
    expect(seg.mode).toBe('DATA');

    const b10 = getBandForFreq(28074000);
    expect(b10.segments.some((s) => s.mode === 'DATA')).toBe(true);
    expect(b10.segments.some((s) => s.mode === 'FM')).toBe(true);
  });

  it('finds bands at their exact edges', () => {
    expect(getBandForFreq(1800000)?.name).toBe('160m');
    expect(getBandForFreq(2000000)?.name).toBe('160m');
    expect(getBandForFreq(29700000)?.name).toBe('10m');
  });

  it('returns null when out of any known band', () => {
    expect(getBandForFreq(15000000)).toBeNull(); // between 20m and 17m
    expect(getBandForFreq(1000000)).toBeNull();
    expect(getBandForFreq(0)).toBeNull();
    expect(getBandForFreq(null)).toBeNull();
    expect(getBandForFreq(NaN)).toBeNull();
  });
});

describe('getMarkerPosition', () => {
  it('maps band edges to 0 and 100', () => {
    const band = getBandForFreq(14074000);
    expect(getMarkerPosition(14000000, band)).toBe(0);
    expect(getMarkerPosition(14350000, band)).toBe(100);
  });

  it('maps a mid-band frequency proportionally', () => {
    const band = getBandForFreq(14074000); // 14000–14350 kHz
    expect(getMarkerPosition(14175000, band)).toBeCloseTo(50, 5);
    expect(getMarkerPosition(14074000, band)).toBeCloseTo(((14074 - 14000) / 350) * 100, 5);
  });

  it('clamps positions outside the band', () => {
    const band = getBandForFreq(14074000);
    expect(getMarkerPosition(13900000, band)).toBe(0);
    expect(getMarkerPosition(14500000, band)).toBe(100);
  });

  it('returns null for invalid inputs', () => {
    const band = getBandForFreq(14074000);
    expect(getMarkerPosition(0, band)).toBeNull();
    expect(getMarkerPosition(14074000, null)).toBeNull();
    expect(getMarkerPosition(14074000, { min: 100, max: 100 })).toBeNull();
  });
});

describe('getSegmentClass', () => {
  it('maps band plan modes to display classes', () => {
    expect(getSegmentClass('CW')).toBe('cw');
    expect(getSegmentClass('DATA')).toBe('data');
    expect(getSegmentClass('USB')).toBe('phone');
    expect(getSegmentClass('LSB')).toBe('phone');
    expect(getSegmentClass('FM')).toBe('fm');
    expect(getSegmentClass('')).toBe('phone');
  });
});

// Regression: the display split of bandplan.json must not break mode mapping
describe('getModeFromFreq (after display segments added)', () => {
  it('keeps CW segments correct', () => {
    expect(getModeFromFreq(1810000)).toBe('CW');
    expect(getModeFromFreq(3520000)).toBe('CW');
    expect(getModeFromFreq(7020000)).toBe('CW');
    expect(getModeFromFreq(14020000)).toBe('CW');
    expect(getModeFromFreq(21020000)).toBe('CW');
    expect(getModeFromFreq(28020000)).toBe('CW');
  });

  it('returns DATA in the digital sub-bands', () => {
    expect(getModeFromFreq(1840500)).toBe('DATA'); // 160m FT8
    expect(getModeFromFreq(3573000)).toBe('DATA'); // 80m FT8
    expect(getModeFromFreq(7074000)).toBe('DATA'); // 40m FT8
    expect(getModeFromFreq(10136000)).toBe('DATA'); // 30m FT8
    expect(getModeFromFreq(14074000)).toBe('DATA'); // 20m FT8
    expect(getModeFromFreq(18100500)).toBe('DATA'); // 17m FT8
    expect(getModeFromFreq(21074000)).toBe('DATA'); // 15m FT8
    expect(getModeFromFreq(24915500)).toBe('DATA'); // 12m FT8
    expect(getModeFromFreq(28074000)).toBe('DATA'); // 10m FT8
  });

  it('keeps phone segments correct', () => {
    expect(getModeFromFreq(1900000)).toBe('LSB');
    expect(getModeFromFreq(3800000)).toBe('LSB');
    expect(getModeFromFreq(7200000)).toBe('LSB');
    expect(getModeFromFreq(14200000)).toBe('USB');
    expect(getModeFromFreq(21300000)).toBe('USB');
    expect(getModeFromFreq(28400000)).toBe('USB');
  });

  it('keeps the digital stretch below the US phone boundary as DATA (#1193)', () => {
    // 14.100–14.150, 21.110–21.200 and 28.120–28.300 are CW/data for every US
    // class; labelling them SSB made the privilege bar flag 14.105 as
    // "outside Amateur Extra privileges".
    expect(getModeFromFreq(14105000)).toBe('DATA');
    expect(getModeFromFreq(14149000)).toBe('DATA');
    expect(getModeFromFreq(14151000)).toBe('USB');
    expect(getModeFromFreq(21150000)).toBe('DATA');
    expect(getModeFromFreq(28200000)).toBe('DATA');
    expect(getModeFromFreq(28301000)).toBe('USB');
    expect(getModeFromFreq(29600000)).toBe('FM');
  });
});

describe('mapModeToRig (regression)', () => {
  it('passes CW through unchanged', () => {
    expect(mapModeToRig('CW', 14020000)).toBe('CW');
    expect(mapModeToRig('CW-R', 7020000)).toBe('CW-R');
  });

  it('maps digital modes to DATA-USB/DATA-LSB by sideband convention', () => {
    expect(mapModeToRig('FT8', 14074000)).toBe('DATA-USB');
    expect(mapModeToRig('FT8', 7074000)).toBe('DATA-LSB');
    expect(mapModeToRig('DATA', 3573000)).toBe('DATA-LSB');
  });

  it('resolves generic SSB to the band sideband', () => {
    expect(mapModeToRig('SSB', 7200000)).toBe('LSB');
    expect(mapModeToRig('SSB', 14200000)).toBe('USB');
    expect(mapModeToRig('SSB', 5357000)).toBe('USB'); // 60m exception
  });

  it('passes FM/AM and unknown modes through', () => {
    expect(mapModeToRig('FM', 29600000)).toBe('FM');
    expect(mapModeToRig('AM', 3885000)).toBe('AM');
    expect(mapModeToRig('WEIRD', 14200000)).toBe('WEIRD');
  });
});
