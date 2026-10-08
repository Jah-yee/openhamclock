/**
 * US FCC license-class frequency privileges (Part 97 / §97.301, §97.305).
 *
 * Data-driven table of transmit privileges per license class, encoded from
 * the ARRL "US Amateur Radio Bands" chart (FCC Part 97). Three mode buckets
 * are used, matching the bandplan.json segment classes:
 *   'cw'    — CW (permitted anywhere the class has any privilege, per §97.305)
 *   'data'  — RTTY/data (FT8, PSK, RTTY, …)
 *   'phone' — phone/image (SSB, AM, FM)
 *
 * Simplifications (documented deliberately):
 *  - 60m (FCC rules effective 2026-02-13): a 5351.5–5366.5 kHz band (2.8 kHz
 *    max bandwidth, 9.15 W ERP) plus four channels centred on 5332, 5348,
 *    5373 and 5405 kHz (100 W ERP). Each channel is modelled from its USB
 *    dial frequency (centre − 1.5 kHz) to the top of its 2.8 kHz occupancy,
 *    so both a USB dial reading and a CW/data carrier on the centre pass.
 *    Nothing in between — 5340 kHz is not an amateur frequency.
 *  - Power limits (e.g. 200 W for Technician 10m data, 30m) are not modeled.
 *  - The Advanced and Novice legacy classes are not offered; holders can pick
 *    General/Technician respectively for a conservative view, or Other.
 *
 * License class 'other' (non-US or undisclosed) means: no restriction UI at
 * all — every canTransmit() check returns true and no ranges are reported.
 *
 * Frequencies outside the known US amateur allocations (US_BAND_LIMITS) are
 * treated as unrestricted: the table can't say anything meaningful there, so
 * the UI stays quiet rather than nagging about e.g. SWL frequencies.
 */

export const LICENSE_CLASSES = ['other', 'technician', 'general', 'extra'];

// US amateur allocations this table knows about (kHz). Checks outside these
// ranges always pass — the privilege model only applies inside a US band.
export const US_BAND_LIMITS = [
  { band: '160m', min_khz: 1800, max_khz: 2000 },
  { band: '80m', min_khz: 3500, max_khz: 4000 },
  { band: '60m', min_khz: 5330, max_khz: 5407 }, // top channel occupies up to 5406.4
  { band: '40m', min_khz: 7000, max_khz: 7300 },
  { band: '30m', min_khz: 10100, max_khz: 10150 },
  { band: '20m', min_khz: 14000, max_khz: 14350 },
  { band: '17m', min_khz: 18068, max_khz: 18168 },
  { band: '15m', min_khz: 21000, max_khz: 21450 },
  { band: '12m', min_khz: 24890, max_khz: 24990 },
  { band: '10m', min_khz: 28000, max_khz: 29700 },
  { band: '6m', min_khz: 50000, max_khz: 54000 },
  { band: '2m', min_khz: 144000, max_khz: 148000 },
  { band: '1.25m', min_khz: 222000, max_khz: 225000 },
  { band: '70cm', min_khz: 420000, max_khz: 450000 },
];

// Row helper: { class, band, min_khz, max_khz, modes }
const row = (cls, band, min_khz, max_khz, modes) => ({ class: cls, band, min_khz, max_khz, modes });

// 60 m — see the header note. Channel rows run from the USB dial frequency
// (centre − 1.5 kHz) to centre + 1.4 kHz.
const SIXTY_M_CHANNEL_CENTRES_KHZ = [5332, 5348, 5373, 5405];
const rows60m = (cls) => [
  row(cls, '60m', 5351.5, 5366.5, ['cw', 'data', 'phone']),
  ...SIXTY_M_CHANNEL_CENTRES_KHZ.map((c) => row(cls, '60m', c - 1.5, c + 1.4, ['cw', 'data', 'phone'])),
];

// VHF/UHF (50 MHz and up): identical full privileges for Technician and above.
const vhfRows = (cls) => [
  row(cls, '6m', 50000, 50100, ['cw']),
  row(cls, '6m', 50100, 54000, ['cw', 'data', 'phone']),
  row(cls, '2m', 144000, 144100, ['cw']),
  row(cls, '2m', 144100, 148000, ['cw', 'data', 'phone']),
  row(cls, '1.25m', 222000, 225000, ['cw', 'data', 'phone']),
  row(cls, '70cm', 420000, 450000, ['cw', 'data', 'phone']),
];

export const PRIVILEGES = [
  // ── Technician ── HF: CW slivers on 80/40/15m; 10m CW/data + narrow SSB; full VHF+.
  row('technician', '80m', 3525, 3600, ['cw']),
  row('technician', '40m', 7025, 7125, ['cw']),
  row('technician', '15m', 21025, 21200, ['cw']),
  row('technician', '10m', 28000, 28300, ['cw', 'data']),
  row('technician', '10m', 28300, 28500, ['cw', 'phone']),
  ...vhfRows('technician'),

  // ── General ──
  row('general', '160m', 1800, 2000, ['cw', 'data', 'phone']),
  row('general', '80m', 3525, 3600, ['cw', 'data']),
  row('general', '80m', 3800, 4000, ['cw', 'phone']),
  ...rows60m('general'),
  row('general', '40m', 7025, 7125, ['cw', 'data']),
  row('general', '40m', 7175, 7300, ['cw', 'phone']),
  row('general', '30m', 10100, 10150, ['cw', 'data']),
  row('general', '20m', 14025, 14150, ['cw', 'data']),
  row('general', '20m', 14225, 14350, ['cw', 'phone']),
  row('general', '17m', 18068, 18110, ['cw', 'data']),
  row('general', '17m', 18110, 18168, ['cw', 'phone']),
  row('general', '15m', 21025, 21200, ['cw', 'data']),
  row('general', '15m', 21275, 21450, ['cw', 'phone']),
  row('general', '12m', 24890, 24930, ['cw', 'data']),
  row('general', '12m', 24930, 24990, ['cw', 'phone']),
  row('general', '10m', 28000, 28300, ['cw', 'data']),
  row('general', '10m', 28300, 29700, ['cw', 'phone']),
  ...vhfRows('general'),

  // ── Amateur Extra ── full US amateur privileges.
  row('extra', '160m', 1800, 2000, ['cw', 'data', 'phone']),
  row('extra', '80m', 3500, 3600, ['cw', 'data']),
  row('extra', '80m', 3600, 4000, ['cw', 'phone']),
  ...rows60m('extra'),
  row('extra', '40m', 7000, 7125, ['cw', 'data']),
  row('extra', '40m', 7125, 7300, ['cw', 'phone']),
  row('extra', '30m', 10100, 10150, ['cw', 'data']),
  row('extra', '20m', 14000, 14150, ['cw', 'data']),
  row('extra', '20m', 14150, 14350, ['cw', 'phone']),
  row('extra', '17m', 18068, 18110, ['cw', 'data']),
  row('extra', '17m', 18110, 18168, ['cw', 'phone']),
  row('extra', '15m', 21000, 21200, ['cw', 'data']),
  row('extra', '15m', 21200, 21450, ['cw', 'phone']),
  row('extra', '12m', 24890, 24930, ['cw', 'data']),
  row('extra', '12m', 24930, 24990, ['cw', 'phone']),
  row('extra', '10m', 28000, 28300, ['cw', 'data']),
  row('extra', '10m', 28300, 29700, ['cw', 'phone']),
  ...vhfRows('extra'),
];

/**
 * Normalize a license-class value. Returns one of 'technician' | 'general' |
 * 'extra', or null for 'other'/'none'/unknown (meaning: no restrictions).
 */
export const normalizeLicenseClass = (licenseClass) => {
  const cls = String(licenseClass || '')
    .trim()
    .toLowerCase();
  return cls === 'technician' || cls === 'general' || cls === 'extra' ? cls : null;
};

/**
 * Map a mode string (bandplan.json or rig-style) to a privilege bucket.
 * @param {string} mode - 'CW', 'DATA', 'USB', 'LSB', 'FM', 'FT8', 'DATA-USB', …
 * @returns {'cw'|'data'|'phone'}
 */
export const modeBucket = (mode) => {
  const m = String(mode || '')
    .trim()
    .toUpperCase();
  if (m === 'CW' || m === 'CW-R') return 'cw';
  const dataModes = [
    'DATA',
    'DATA-USB',
    'DATA-LSB',
    'DIGITAL',
    'FT8',
    'FT4',
    'FT2',
    'JS8',
    'WSPR',
    'JT65',
    'JT9',
    'PSK31',
    'PSK63',
    'PSK',
    'RTTY',
    'PKT',
    'MFSK',
    'OLIVIA',
  ];
  if (dataModes.includes(m)) return 'data';
  // USB / LSB / SSB / AM / FM / WFM and anything else voice-shaped
  return 'phone';
};

/**
 * Whether a frequency falls inside a US amateur band this table models.
 * @param {number} khz
 * @returns {boolean}
 */
export const inUsAmateurBand = (khz) => US_BAND_LIMITS.some((b) => khz >= b.min_khz && khz <= b.max_khz);

/**
 * Can this license class transmit at khz with the given mode?
 * Frequencies outside the modeled US bands always return true (the table has
 * nothing to say there), as does class 'other'/'none'/unknown.
 *
 * @param {string} licenseClass - 'other' | 'technician' | 'general' | 'extra'
 * @param {number} khz - Frequency in kHz
 * @param {string} mode - Mode string ('CW', 'SSB', 'USB', 'FT8', 'DATA-USB', …)
 * @returns {boolean}
 */
export const canTransmit = (licenseClass, khz, mode) => {
  const cls = normalizeLicenseClass(licenseClass);
  if (!cls) return true;
  if (!Number.isFinite(khz)) return true;
  if (!inUsAmateurBand(khz)) return true;
  const bucket = modeBucket(mode);
  return PRIVILEGES.some((r) => r.class === cls && khz >= r.min_khz && khz <= r.max_khz && r.modes.includes(bucket));
};

/**
 * Privilege rows for a class on a band.
 * @param {string} licenseClass
 * @param {string} band - Band name, e.g. '20m'
 * @returns {Array<{class: string, band: string, min_khz: number, max_khz: number, modes: string[]}>}
 *          Empty when the class has no privileges there (or class is 'other').
 */
export const privilegeRanges = (licenseClass, band) => {
  const cls = normalizeLicenseClass(licenseClass);
  if (!cls) return [];
  return PRIVILEGES.filter((r) => r.class === cls && r.band === band);
};

/**
 * Sub-ranges of [minKhz, maxKhz] where the class may NOT transmit with the
 * given mode. Used by BandPlanBar to hatch/dim out-of-privilege stretches of
 * a band-plan segment (a segment can be partially privileged, e.g. General
 * phone starts at 3800 inside the 3600–4000 SSB segment).
 *
 * @param {string} licenseClass
 * @param {number} minKhz - Segment start (kHz)
 * @param {number} maxKhz - Segment end (kHz)
 * @param {string} mode - Segment mode ('CW', 'DATA', 'USB', 'LSB', 'FM', …)
 * @returns {Array<{min: number, max: number}>} kHz slices outside privileges
 */
export const nonPrivilegedSlices = (licenseClass, minKhz, maxKhz, mode) => {
  const cls = normalizeLicenseClass(licenseClass);
  if (!cls || !Number.isFinite(minKhz) || !Number.isFinite(maxKhz) || maxKhz <= minKhz) return [];
  const bucket = modeBucket(mode);
  const allowed = PRIVILEGES.filter(
    (r) => r.class === cls && r.modes.includes(bucket) && r.max_khz > minKhz && r.min_khz < maxKhz,
  )
    .map((r) => [Math.max(r.min_khz, minKhz), Math.min(r.max_khz, maxKhz)])
    .sort((a, b) => a[0] - b[0]);

  const out = [];
  let cursor = minKhz;
  for (const [start, end] of allowed) {
    if (start > cursor) out.push({ min: cursor, max: start });
    cursor = Math.max(cursor, end);
  }
  if (cursor < maxKhz) out.push({ min: cursor, max: maxKhz });
  return out;
};

/**
 * Read the configured license class from the saved OpenHamClock config.
 * Returns 'other' when unset/unavailable (no restriction UI).
 */
export const getLicenseClass = () => {
  try {
    const saved = localStorage.getItem('openhamclock_config');
    if (!saved) return 'other';
    const cls = normalizeLicenseClass(JSON.parse(saved)?.licenseClass);
    return cls || 'other';
  } catch {
    return 'other';
  }
};
